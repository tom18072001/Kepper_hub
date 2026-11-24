#!/bin/sh
# KIỂM TRƯỚC khi nâng cấp lên bản "một hệ quy chiếu phân quyền" (migration 20261124064031_mot_truc_vai) — gọi tự động từ
# deploy/vm-deploy.sh và deploy/upgrade.sh, TRƯỚC sao lưu và build. Chạy trên CSDL ĐANG CHẠY; dừng ở đây thì app cũ vẫn chạy.
# Còn tài khoản vai Ban Tổng Giám đốc có bộ quyền cũ đã thu hẹp → migration sẽ dừng (P3018) và app không lên (P3009):
# đổi vai các tài khoản được liệt kê trên màn Quản trị (bản cũ) rồi chạy lại. Phần truy vấn: deploy/precheck-roles-db.sh.
#   sh deploy/precheck-roles.sh
set -eu
cd "$(dirname "$0")/.."
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
if [ -z "$($DC ps -q postgres 2>/dev/null || true)" ]; then echo "    (kiểm phân quyền) CSDL chưa chạy — lần cài đầu, bỏ qua"; exit 0; fi
$DC exec -T postgres sh -s < deploy/precheck-roles-db.sh
