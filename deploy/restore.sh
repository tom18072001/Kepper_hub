#!/bin/sh
# Khôi phục Kepper Hub từ một thư mục sao lưu (tạo bởi backup.sh).
#   sh restore.sh /backups/20261016-020000
# Bản đã mã hoá (*.age): mount khoá bí mật age vào container và đặt AGE_IDENTITY=/key/kepper-backup.key
#
# An toàn:
#   - Khôi phục vào một CSDL MỚI trong MỘT transaction; chỉ khi đạt mới đổi tên: CSDL đang dùng → <tên>_before_<giờ>
#     (giữ lại để quay về), CSDL mới → <tên>. Lỗi giữa chừng: CSDL đang dùng giữ nguyên.
#   - Từ chối khi còn kết nối tới CSDL (dừng trước:  docker compose stop app backup).
#   - Tệp đính kèm giải nén ra thư mục tạm, đạt mới thay.
#   - App khởi động lại tự "migrate deploy" tiến lên nếu bản sao lưu cũ hơn mã hiện tại.
# Thử khôi phục định kỳ (mỗi quý), KHÔNG đụng dữ liệu đang dùng:  RESTORE_TEST=1 sh restore.sh <thư-mục>
#   → khôi phục vào CSDL tạm, kiểm tra số bảng / số dòng, xoá CSDL tạm, ghi kết quả vào AppSetting backup.status.restoreTestOk.
set -eu
dir="${1:-${RESTORE_FROM:-}}"
[ -n "$dir" ] || { echo "Chỉ định thư mục sao lưu (tham số hoặc RESTORE_FROM)"; exit 1; }
UPLOADS_DIR="${UPLOADS_DIR:-/data/uploads}"
TEST="${RESTORE_TEST:-0}"

(cd "$dir" && sha256sum -c SHA256SUMS)
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
dump="$dir/workhub.dump"; uploads="$dir/uploads.tgz"
if [ -f "$dir/workhub.dump.age" ]; then
  [ -n "${AGE_IDENTITY:-}" ] && [ -f "$AGE_IDENTITY" ] || { echo "Bản sao lưu đã mã hoá: đặt AGE_IDENTITY trỏ tới khoá bí mật age"; exit 1; }
  echo "[restore] giải mã bản sao lưu"
  age -d -i "$AGE_IDENTITY" -o "$work/workhub.dump" "$dir/workhub.dump.age"
  dump="$work/workhub.dump"
  if [ -f "$dir/uploads.tgz.age" ]; then age -d -i "$AGE_IDENTITY" -o "$work/uploads.tgz" "$dir/uploads.tgz.age"; uploads="$work/uploads.tgz"; fi
fi
pg_restore --list "$dump" > /dev/null

ts="$(date +%Y%m%d%H%M%S)"
new="${PGDATABASE}_r${ts}"
q() { psql -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }

if [ "$TEST" != "1" ]; then
  n="$(q "SELECT count(*) FROM pg_stat_activity WHERE datname = '$PGDATABASE' AND pid <> pg_backend_pid()")"
  [ "$n" = "0" ] || { echo "Còn $n kết nối tới $PGDATABASE — dừng trước:  docker compose stop app backup"; exit 1; }
fi

echo "[restore] khôi phục vào CSDL mới $new"
createdb "$new"
if ! pg_restore --no-owner --single-transaction --exit-on-error --dbname="$new" "$dump"; then
  dropdb "$new"; echo "[restore] LỖI khôi phục — CSDL $PGDATABASE giữ nguyên"; exit 1
fi
tables="$(psql -d "$new" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
users="$(psql -d "$new" -tAc 'SELECT count(*) FROM "User"' 2>/dev/null || echo 0)"
echo "[restore] kiểm tra: $tables bảng, $users tài khoản"
[ "${tables:-0}" -gt 5 ] || { dropdb "$new"; echo "[restore] LỖI: bản khôi phục thiếu bảng"; exit 1; }

if [ "$TEST" = "1" ]; then
  dropdb "$new"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  psql -d "$PGDATABASE" -q -v ON_ERROR_STOP=1 -v v="{\"restoreTestOk\":\"$now\",\"restoreTestFrom\":\"$(basename "$dir")\"}" >/dev/null 2>&1 <<'SQL' || echo "[restore] (không ghi được kết quả vào AppSetting)"
INSERT INTO "AppSetting"(key, value, "updatedAt") VALUES ('backup.status', :'v'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = "AppSetting".value || EXCLUDED.value, "updatedAt" = now();
SQL
  echo "[restore] THỬ KHÔI PHỤC ĐẠT ($(basename "$dir")) — đã xoá CSDL tạm, dữ liệu đang dùng không đổi"
  exit 0
fi

q "ALTER DATABASE \"$PGDATABASE\" RENAME TO \"${PGDATABASE}_before_$ts\""
q "ALTER DATABASE \"$new\" RENAME TO \"$PGDATABASE\""
echo "[restore] đã đổi: $PGDATABASE ← bản khôi phục; bản trước giữ ở ${PGDATABASE}_before_$ts (xoá sau khi kiểm tra: dropdb ${PGDATABASE}_before_$ts)"

if [ -f "$uploads" ]; then
  echo "[restore] khôi phục tệp đính kèm vào $UPLOADS_DIR"
  tmp="$UPLOADS_DIR/.restore-$ts"; keep="$UPLOADS_DIR/.before-$ts"
  mkdir -p "$tmp" "$keep"
  tar -xzf "$uploads" -C "$tmp"
  # Tệp hiện tại chuyển vào .before-<giờ> (cùng ổ, giữ lại để quay về như CSDL _before_), rồi đưa bản khôi phục vào.
  find "$UPLOADS_DIR" -mindepth 1 -maxdepth 1 ! -name ".restore-$ts" ! -name ".before-*" -exec mv {} "$keep/" \;
  (cd "$tmp" && tar -cf - .) | tar -xf - -C "$UPLOADS_DIR"
  rm -rf "$tmp"
  echo "[restore] tệp đính kèm cũ giữ ở $keep (xoá sau khi kiểm tra)"
fi
echo "[restore] xong — khởi động lại:  docker compose up -d"
