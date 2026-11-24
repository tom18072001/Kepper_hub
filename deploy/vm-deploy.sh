#!/bin/sh
# Cài / nâng cấp Kepler Hub trên máy ảo Ubuntu (Hyper-V) có HTTPS nội bộ bằng Caddy — docs/deploy-vm.md
#   sh deploy/vm-deploy.sh <tên-máy> [tệp-tổ-chức.json]      vd. sh deploy/vm-deploy.sh hub.keplerholdings.vn /tmp/org.json
# Chạy trong thư mục mã nguồn, bằng tài khoản có sudo + nhóm docker. Lần đầu: tạo /srv/kepler-hub, .env (khoá ngẫu nhiên),
# bật app + Caddy, nhập tổ chức (nếu có tệp). Lần sau: giữ .env và dữ liệu; kiểm phân quyền, sao lưu, gắn tag image cũ để quay lại,
# rồi build lại. Mã mới phải được kéo về thư mục (git pull) TRƯỚC khi chạy script này.
set -eu
cd "$(dirname "$0")/.."
HOST="${1:?Thiếu tên máy, vd. hub.keplerholdings.vn}"; ORG="${2:-}"; DATA=/srv/kepler-hub
set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }
first=0; rollback=""
if [ ! -f .env ]; then
  first=1
  sudo sh deploy/nas-setup.sh "$DATA" "https://$HOST"
  sudo chown "$(id -u):$(id -g)" .env
  set_env HUB_HOST "$HOST"
  set_env CADDY_DATA_PATH "$DATA/caddy"
  set_env MODULES "${MODULES:-vanthu}"
  set_env ORG_NAME "${ORG_NAME:-}"
  set_env ROOT_ADMIN_PASSWORD "$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
  sudo mkdir -p "$DATA/caddy"
  chmod 600 .env
else
  echo "==> Đã có .env — nâng cấp: kiểm phân quyền trước (app cũ vẫn chạy nếu dừng ở đây)"
  sh deploy/precheck-roles.sh
  echo "==> Sao lưu CSDL trước"
  docker compose exec -T -e BACKUP_ONCE=1 backup sh /deploy/backup.sh || echo "!! Không chạy được sao lưu tay — kiểm tra $DATA/backups trước khi tiếp tục"
  # Giữ image app đang chạy để quay lại (build sẽ ghi đè tag kepper-app:<APP_VERSION>). Chỉ giữ 2 tag rollback-<giờ> gần nhất do
  # script này tạo; tag đặt tay (vd. rollback-pr40-…, pre-…) không bị đụng — deploy/prune-rollback-tags.sh.
  cid="$(docker compose ps -q app 2>/dev/null || true)"
  if [ -n "$cid" ]; then
    rollback="kepper-app:rollback-$(date +%Y%m%d-%H%M%S)"
    docker image tag "$(docker inspect -f '{{.Image}}' "$cid")" "$rollback"
    echo "    image cũ để quay lại: $rollback"
    sh deploy/prune-rollback-tags.sh 2 || echo "!! Không dọn được tag quay lại cũ — bỏ qua (xem: docker image ls kepper-app)"
  fi
fi
echo "==> Build và chạy (app, postgres, backup, caddy)"
# Giữ mã thoát (không dừng ngay: Caddy chờ app healthy nên lỗi migration cũng làm lệnh này thoát khác 0 — phần dưới in cách khôi phục).
# Mã khác 0 thì KHÔNG BAO GIỜ báo thành công, kể cả khi app (cũ) vẫn healthy — vd. build hỏng nên container cũ chưa bị thay.
up_rc=0
docker compose --profile https up -d --build || up_rc=$?
ver="$(grep '^APP_VERSION=' .env 2>/dev/null | cut -d= -f2)"; ver="${ver:-0.2.0}"
# Image app đang chạy so với image vừa build (tag kepper-app:<APP_VERSION>).
running_img() { docker inspect -f '{{.Image}}' "$(docker compose ps -q app)" 2>/dev/null || true; }
built_img() { docker image inspect -f '{{.Id}}' "kepper-app:$ver" 2>/dev/null || true; }
s=""
for i in $(seq 1 60); do
  s="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || true)"
  [ "$s" = healthy ] && break; sleep 3
done
echo "    app: ${s:-?} (docker compose up: mã $up_rc)"
if [ "$s" = healthy ] && [ "$up_rc" != 0 ] && [ -n "$(built_img)" ] && [ "$(running_img)" = "$(built_img)" ]; then
  # App MỚI đã lên nhưng dịch vụ khác (vd. caddy) lỗi — vẫn không báo thành công.
  echo "!! App MỚI đã chạy (kepper-app:$ver = $(running_img)) nhưng docker compose up LỖI (mã $up_rc) — vd. caddy. Xem: docker compose ps; docker compose logs caddy --tail 30"
  exit 1
fi
if [ "$s" = healthy ] && [ "$up_rc" != 0 ]; then
  echo "!! docker compose up LỖI (mã $up_rc) — bản mới CHƯA chạy; app đang phục vụ là bản CŨ (healthy)."
  echo "     image app đang chạy:  $(running_img)"
  echo "     image kepper-app:$ver: $(built_img)"
  [ -z "$rollback" ] || echo "     image cũ (tag): $rollback"
  echo "!! Xem lỗi build ở trên (mạng, Dockerfile, npm ci…), sửa rồi chạy lại: sh deploy/vm-deploy.sh $HOST"
  exit 1
fi
if [ "$s" = healthy ] && [ "$(running_img)" != "$(built_img)" ]; then
  echo "!! Bản mới CHƯA chạy: container app vẫn chạy image khác image vừa build — app cũ vẫn phục vụ."
  echo "     image app đang chạy:  $(running_img)"
  echo "     image kepper-app:$ver: $(built_img)"
  echo "!! Chạy lại: sh deploy/vm-deploy.sh $HOST"
  exit 1
fi
if [ "$s" != healthy ]; then
  echo "!! App chưa sẵn sàng. 30 dòng log cuối:"; docker compose logs app --tail 30 || true
  echo "!! Nếu log báo LỖI migration (P3018 / P3009) — khôi phục (docs/de-xuat-mot-he-quy-chieu-phan-quyen.md, mục 11, \"Bản thật\"):"
  echo "     docker compose stop app"
  echo "     docker compose run --rm --no-deps --entrypoint npx app prisma migrate resolve --rolled-back <tên migration lỗi trong log>"
  if [ -n "$rollback" ]; then
    echo "     docker image tag $rollback kepper-app:$ver"
    echo "     docker compose up -d --no-build app"
  else
    echo "     (không có tag image cũ — khôi phục bản sao lưu: deploy/restore.sh)"
  fi
  echo "!! Sửa nguyên nhân (vd. đổi vai trên màn Quản trị của bản cũ), rồi chạy lại: sh deploy/vm-deploy.sh $HOST"
  exit 1
fi
if [ -n "$ORG" ] && [ -f "$ORG" ]; then
  echo "==> Nhập cơ cấu tổ chức + tài khoản"
  docker compose exec -T app node scripts/import-org.js < "$ORG"
fi
echo "==> Chứng chỉ gốc nội bộ (cho máy trạm tin cậy): $DATA/caddy/caddy/pki/authorities/local/root.crt"
[ "$first" = 1 ] && echo "    Mật khẩu quản trị gốc lần đầu nằm trong .env (ROOT_ADMIN_PASSWORD) — đổi sau khi đăng nhập."
echo "    Bản mới đang chạy: kepper-app:$ver = $(running_img)"
[ -n "$rollback" ] && echo "    Image cũ: $rollback (xoá khi ổn định: docker image rm $rollback)"
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
