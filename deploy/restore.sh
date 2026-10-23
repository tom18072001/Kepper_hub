#!/bin/sh
# Khôi phục Kepper Hub từ một thư mục sao lưu (tạo bởi backup.sh).
# Dùng:  sh restore.sh /backups/20261016-020000
# Bản đã mã hoá (*.age): mount khoá bí mật age vào container và đặt AGE_IDENTITY=/key/kepper-backup.key
# CẢNH BÁO: ghi đè dữ liệu hiện tại của CSDL $PGDATABASE và thư mục tệp đính kèm.
set -eu
dir="${1:-${RESTORE_FROM:-}}"
[ -n "$dir" ] || { echo "Chỉ định thư mục sao lưu (tham số hoặc RESTORE_FROM)"; exit 1; }
UPLOADS_DIR="${UPLOADS_DIR:-/data/uploads}"

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
echo "[restore] khôi phục CSDL $PGDATABASE từ $dir"
pg_restore --clean --if-exists --no-owner --dbname="$PGDATABASE" "$dump"
if [ -f "$uploads" ]; then
  echo "[restore] khôi phục tệp đính kèm vào $UPLOADS_DIR"
  mkdir -p "$UPLOADS_DIR"
  tar -xzf "$uploads" -C "$UPLOADS_DIR"
fi
echo "[restore] xong"
