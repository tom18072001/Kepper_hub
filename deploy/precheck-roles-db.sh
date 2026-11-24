#!/bin/sh
# Phần chạy TRONG container postgres của deploy/precheck-roles.sh (và deploy/upgrade.ps1): đọc CSDL đang chạy, không ghi gì.
# Cùng điều kiện với chốt an toàn của migration 20261124064031_mot_truc_vai (kể cả tài khoản đã khoá).
# Thoát 0: an toàn / migration đã áp / CSDL trống (đọc được và chưa có bảng). Thoát 1: còn tài khoản vai Ban Tổng Giám đốc có bộ quyền
# cũ đã thu hẹp (in id | tài khoản | trạng thái). Thoát 2: KHÔNG ĐỌC ĐƯỢC CSDL (mất kết nối, sai tài khoản, chưa sẵn sàng…) — không
# bao giờ coi là "an toàn".
set -u
MIGRATION=20261124064031_mot_truc_vai
PGUSER_="${PRECHECK_PGUSER:-workhub}"; PGDB_="${PRECHECK_PGDB:-workhub}"
fail_read() { echo "!! DỪNG nâng cấp: không đọc được CSDL — $1. Kiểm tra postgres đang chạy và đúng tài khoản rồi chạy lại. App hiện tại không bị đụng tới." >&2; exit 2; }
# q <câu SQL>: in kết quả. psql lỗi → báo lỗi (stderr) và thoát 2; nơi gọi dùng `v="$(q …)" || exit 2` để chuỗi rỗng không bao giờ
# bị hiểu nhầm là "không có gì".
q() {
  out="$(psql -U "$PGUSER_" -d "$PGDB_" -At -F ' | ' -v ON_ERROR_STOP=1 -c "$1" 2>&1)" || fail_read "$(printf '%s' "$out" | head -n 1)"
  printf '%s' "$out"
}
one="$(q "SELECT 1")" || exit 2
[ "$one" = "1" ] || fail_read "SELECT 1 trả về '$one'"
has_user="$(q "SELECT to_regclass('public.\"User\"') IS NOT NULL")" || exit 2
case "$has_user" in
  f) echo "    (kiểm phân quyền) CSDL đọc được, chưa có bảng User (CSDL trống) — bỏ qua"; exit 0 ;;
  t) ;;
  *) fail_read "kết quả lạ: $has_user" ;;
esac
has_mig="$(q "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")" || exit 2
if [ "$has_mig" = "t" ]; then
  applied="$(q "SELECT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '$MIGRATION' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)")" || exit 2
  if [ "$applied" = "t" ]; then echo "    (kiểm phân quyền) migration $MIGRATION đã áp — bỏ qua"; exit 0; fi
fi
rows="$(q "SELECT u.id, u.username, CASE WHEN u.\"isActive\" THEN 'đang hoạt động' ELSE 'đã khoá' END FROM \"User\" u
  WHERE u.role = 'director' AND u.\"isRootAdmin\" = false
    AND NOT EXISTS (SELECT 1 FROM \"UserPermission\" p WHERE p.\"userId\" = u.id AND p.\"permissionKey\" = 'work.view' AND p.scope = 'SYSTEM')
  ORDER BY u.id")" || exit 2
if [ -n "$rows" ]; then
  echo "!! DỪNG nâng cấp: các tài khoản vai Ban Tổng Giám đốc dưới đây có bộ quyền đã thu hẹp (id | tài khoản | trạng thái):"
  echo "$rows" | sed 's/^/     /'
  echo "!! Đổi vai các tài khoản này trên màn Quản trị → Tài khoản (bản đang chạy), rồi chạy lại. App hiện tại không bị đụng tới."
  echo "!! (docs/de-xuat-mot-he-quy-chieu-phan-quyen.md, mục 11)"
  exit 1
fi
echo "    (kiểm phân quyền) không còn tài khoản Ban Tổng Giám đốc bị thu hẹp quyền — tiếp tục"
