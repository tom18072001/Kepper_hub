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
  # Giữ image app đang chạy để quay lại (build sẽ ghi đè tag kepper-app:<APP_VERSION>). Chỉ giữ 2 tag rollback gần nhất.
  cid="$(docker compose ps -q app 2>/dev/null || true)"
  if [ -n "$cid" ]; then
    rollback="kepper-app:rollback-$(date +%Y%m%d-%H%M%S)"
    docker image tag "$(docker inspect -f '{{.Image}}' "$cid")" "$rollback"
    echo "    image cũ để quay lại: $rollback"
    docker image ls kepper-app --format '{{.Tag}}' | grep '^rollback-' | sort -r | tail -n +3 | while read -r t; do
      docker image rm "kepper-app:$t" >/dev/null 2>&1 && echo "    xoá tag cũ: kepper-app:$t" || true
    done
  fi
fi
echo "==> Build và chạy (app, postgres, backup, caddy)"
# Lỗi ở đây (vd. Caddy chờ app healthy mà app dừng vì migration) không dừng script: phần dưới kiểm sức khoẻ và in cách khôi phục.
docker compose --profile https up -d --build || echo "!! docker compose up báo lỗi — xem trạng thái app bên dưới"
s=""
for i in $(seq 1 60); do
  s="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || true)"
  [ "$s" = healthy ] && break; sleep 3
done
echo "    app: ${s:-?}"
if [ "$s" != healthy ]; then
  ver="$(grep '^APP_VERSION=' .env 2>/dev/null | cut -d= -f2)"; ver="${ver:-0.2.0}"
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
[ -n "$rollback" ] && echo "    Image cũ: $rollback (xoá khi ổn định: docker image rm $rollback)"
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
