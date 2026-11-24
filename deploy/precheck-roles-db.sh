#!/bin/sh
# Phần chạy TRONG container postgres của deploy/precheck-roles.sh (và deploy/upgrade.ps1): đọc CSDL đang chạy, không ghi gì.
# Cùng điều kiện với chốt an toàn của migration 20261124064031_mot_truc_vai (kể cả tài khoản đã khoá).
# Thoát 0: an toàn / đã áp / CSDL trống. Thoát 1: còn tài khoản vai Ban Tổng Giám đốc có bộ quyền cũ đã thu hẹp (in id | tài khoản | trạng thái).
set -eu
MIGRATION=20261124064031_mot_truc_vai
q() { psql -U workhub -d workhub -At -F ' | ' -v ON_ERROR_STOP=1 -c "$1"; }
if [ "$(q "SELECT to_regclass('public.\"User\"') IS NOT NULL")" != "t" ]; then echo "    (kiểm phân quyền) CSDL trống — bỏ qua"; exit 0; fi
if [ "$(q "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")" = "t" ] \
  && [ "$(q "SELECT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '$MIGRATION' AND finished_at IS NOT NULL)")" = "t" ]; then
  echo "    (kiểm phân quyền) migration $MIGRATION đã áp — bỏ qua"; exit 0
fi
rows="$(q "SELECT u.id, u.username, CASE WHEN u.\"isActive\" THEN 'đang hoạt động' ELSE 'đã khoá' END FROM \"User\" u
  WHERE u.role = 'director' AND u.\"isRootAdmin\" = false
    AND NOT EXISTS (SELECT 1 FROM \"UserPermission\" p WHERE p.\"userId\" = u.id AND p.\"permissionKey\" = 'work.view' AND p.scope = 'SYSTEM')
  ORDER BY u.id")"
if [ -n "$rows" ]; then
  echo "!! DỪNG nâng cấp: các tài khoản vai Ban Tổng Giám đốc dưới đây có bộ quyền đã thu hẹp (id | tài khoản | trạng thái):"
  echo "$rows" | sed 's/^/     /'
  echo "!! Đổi vai các tài khoản này trên màn Quản trị → Tài khoản (bản đang chạy), rồi chạy lại. App hiện tại không bị đụng tới."
  echo "!! (docs/de-xuat-mot-he-quy-chieu-phan-quyen.md, mục 11)"
  exit 1
fi
echo "    (kiểm phân quyền) không còn tài khoản Ban Tổng Giám đốc bị thu hẹp quyền — tiếp tục"
