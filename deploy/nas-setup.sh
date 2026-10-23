#!/bin/sh
# Chuẩn bị chạy Kepper Hub trên NAS công ty / máy chủ Linux — chạy MỘT lần, trong thư mục mã nguồn, bằng sudo:
#   sudo sh deploy/nas-setup.sh /volume1/kepper-data https://kepper.<tên-miền-công-ty>
# Việc làm: kiểm tra Docker + kiến trúc → tạo thư mục dữ liệu (đúng chủ, đúng quyền) → tạo .env với khoá ngẫu nhiên.
# KHÔNG khởi động ứng dụng, KHÔNG sửa .env đã có. Hướng dẫn đầy đủ: docs/deploy-nas.md
set -eu
cd "$(dirname "$0")/.."

DATA="${1:-}"; ORIGIN="${2:-}"
usage() { echo "Dùng: sudo sh deploy/nas-setup.sh <thư-mục-dữ-liệu-trên-NAS> [https://địa-chỉ-kepper]"; exit 1; }
[ -n "$DATA" ] || usage
case "$DATA" in /*) ;; *) echo "Thư mục dữ liệu phải là đường dẫn tuyệt đối (vd. /volume1/kepper-data)"; exit 1 ;; esac
case "$ORIGIN" in ""|http://*|https://*) ;; *) echo "Địa chỉ phải bắt đầu bằng https:// (hoặc http:// khi chỉ thử)"; exit 1 ;; esac
[ "$(id -u)" = 0 ] || { echo "Chạy bằng sudo — cần đổi chủ thư mục cho tài khoản chạy app (uid 1000)"; exit 1; }

echo "==> 1/4 Kiểm tra máy"
arch="$(uname -m)"
case "$arch" in x86_64|amd64|aarch64|arm64) echo "    kiến trúc: $arch" ;; *) echo "!! Kiến trúc $arch chưa hỗ trợ (cần x86_64 hoặc arm64)"; exit 1 ;; esac
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else echo "!! Chưa có Docker Compose (Synology: cài Container Manager; QNAP: Container Station; Linux: docker-compose-plugin)"; exit 1; fi
echo "    $($DC version | head -1)"
mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
[ "${mem_kb:-0}" -ge 3500000 ] || echo "!! RAM $((mem_kb / 1024)) MB — nên ≥ 4 GB (Postgres + app + build image)"

echo "==> 2/4 Thư mục dữ liệu: $DATA"
mkdir -p "$DATA"
fs="$(stat -f -c %T "$DATA" 2>/dev/null || echo unknown)"
case "$fs" in nfs*|cifs|smb*|fuse*) echo "!! $DATA nằm trên ổ mạng ($fs) — CSDL phải ở ổ của chính máy chạy. Chọn thư mục khác."; exit 1 ;; esac
for d in pgdata uploads logs backups backups-copy branding; do mkdir -p "$DATA/$d"; done
chown -R 1000:1000 "$DATA/uploads" "$DATA/logs"     # app chạy bằng tài khoản node (uid 1000)
chmod 700 "$DATA/pgdata" "$DATA/backups" "$DATA/backups-copy"   # CSDL và bản sao lưu: dữ liệu Bảo mật
chmod 750 "$DATA/uploads" "$DATA/logs"
echo "    pgdata uploads logs backups backups-copy branding — xong (fs: $fs)"

echo "==> 3/4 Tệp cấu hình .env"
rand() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }
if [ -f .env ]; then
  echo "    đã có .env — giữ nguyên. Kiểm tra các dòng: APP_ORIGIN, TRUST_PROXY, PGDATA_PATH, UPLOADS_PATH, LOG_PATH, BACKUP_PATH, BRANDING_PATH"
else
  cp .env.example .env
  set_env POSTGRES_PASSWORD "$(rand)"
  set_env JWT_SECRET "$(rand)"
  set_env PREVIEW_TOKEN "$(rand)"
  set_env MINIO_ROOT_PASSWORD "$(rand)"
  set_env PGDATA_PATH "$DATA/pgdata"
  set_env UPLOADS_PATH "$DATA/uploads"
  set_env LOG_PATH "$DATA/logs"
  set_env BACKUP_PATH "$DATA/backups"
  set_env BACKUP_COPY_PATH "$DATA/backups-copy"
  set_env BRANDING_PATH "$DATA/branding"
  set_env APP_BIND 127.0.0.1
  if [ -n "$ORIGIN" ]; then set_env APP_ORIGIN "$ORIGIN"; fi
  case "$ORIGIN" in https://*) set_env TRUST_PROXY 1 ;; esac
  echo "    đã tạo .env (khoá CSDL / phiên đăng nhập ngẫu nhiên)"
fi
chmod 600 .env

echo "==> 4/4 Việc còn lại (làm tay)"
if grep -q "^ROOT_ADMIN_PASSWORD=change-me" .env; then echo "  - Sửa ROOT_ADMIN_PASSWORD trong .env (mật khẩu quản trị gốc lần chạy đầu)"; fi
grep -q "^ORG_NAME=." .env || echo "  - (tuỳ chọn) ORG_NAME trong .env + chép logo vào $DATA/branding (logo.png, mark.png)"
grep -q "^BACKUP_AGE_RECIPIENT=age1" .env || echo "  - Nên đặt BACKUP_AGE_RECIPIENT (mã hoá bản sao lưu) — khoá bí mật giữ ngoài NAS"
echo "  - Khởi động:          $DC up -d --build"
echo "  - Reverse proxy HTTPS: <địa chỉ Kepper>:443 → http://127.0.0.1:\${APP_PORT:-4100}  (docs/deploy-nas.md mục 4)"
echo "  - Chuyển dữ liệu từ máy đang chạy: docs/deploy-nas.md mục 6"
