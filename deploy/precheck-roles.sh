#!/bin/sh
# KIỂM TRƯỚC khi nâng cấp lên bản "một hệ quy chiếu phân quyền" (migration 20261124064031_mot_truc_vai). Chạy trên CSDL ĐANG CHẠY,
# trước sao lưu và build; dừng ở đây thì app cũ vẫn chạy. Còn tài khoản vai Ban Tổng Giám đốc có bộ quyền cũ đã thu hẹp → migration sẽ
# dừng (P3018) và app không lên (P3009): đổi vai các tài khoản được liệt kê trên màn Quản trị (bản cũ) rồi chạy lại.
#   sh deploy/precheck-roles.sh        (phần truy vấn: deploy/precheck-roles-db.sh, chạy trong container postgres)
# CHỈ dùng khi NÂNG CẤP (đã có CSDL): postgres không chạy / không đọc được CSDL → DỪNG (thoát 2), không bao giờ coi là an toàn.
# Lần nâng cấp LÊN bản này: lấy mã mới trước (git pull), rồi chạy script này, rồi mới build (docs/…, mục 11).
set -eu
cd "$(dirname "$0")/.."
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
if [ -z "$($DC ps -q postgres 2>/dev/null || true)" ]; then
  echo "!! DỪNG nâng cấp: không đọc được CSDL (container postgres không chạy). Bật postgres rồi chạy lại:"
  echo "     $DC up -d postgres   &&   sh deploy/precheck-roles.sh"; exit 2
fi
$DC exec -T postgres sh -s < deploy/precheck-roles-db.sh
