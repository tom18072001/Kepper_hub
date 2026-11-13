#!/bin/sh
# Cài / nâng cấp Kepler Hub trên máy ảo Ubuntu (Hyper-V) có HTTPS nội bộ bằng Caddy — docs/deploy-vm.md
#   sh deploy/vm-deploy.sh <tên-máy> [tệp-tổ-chức.json]      vd. sh deploy/vm-deploy.sh kepler-hub.kepler.com /tmp/org.json
# Chạy trong thư mục mã nguồn, bằng tài khoản có sudo + nhóm docker. Lần đầu: tạo /srv/kepler-hub, .env (khoá ngẫu nhiên),
# bật app + Caddy, nhập tổ chức (nếu có tệp). Lần sau: giữ .env và dữ liệu, sao lưu trước rồi build lại.
set -eu
cd "$(dirname "$0")/.."
HOST="${1:?Thiếu tên máy, vd. kepler-hub.kepler.com}"; ORG="${2:-}"; DATA=/srv/kepler-hub
set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }
first=0
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
  echo "==> Đã có .env — nâng cấp: sao lưu CSDL trước"
  docker compose exec -T -e BACKUP_ONCE=1 backup sh /deploy/backup.sh || echo "!! Không chạy được sao lưu tay — kiểm tra $DATA/backups trước khi tiếp tục"
fi
echo "==> Build và chạy (app, postgres, backup, caddy)"
docker compose --profile https up -d --build
for i in $(seq 1 60); do
  s="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || true)"
  [ "$s" = healthy ] && break; sleep 3
done
echo "    app: ${s:-?}"
if [ -n "$ORG" ] && [ -f "$ORG" ]; then
  echo "==> Nhập cơ cấu tổ chức + tài khoản"
  docker compose exec -T app node scripts/import-org.js < "$ORG"
fi
echo "==> Chứng chỉ gốc nội bộ (cho máy trạm tin cậy): $DATA/caddy/caddy/pki/authorities/local/root.crt"
[ "$first" = 1 ] && echo "    Mật khẩu quản trị gốc lần đầu nằm trong .env (ROOT_ADMIN_PASSWORD) — đổi sau khi đăng nhập."
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
