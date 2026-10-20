#!/bin/sh
# Khôi phục WorkHub từ một thư mục sao lưu (tạo bởi backup.sh).
# Dùng:  sh restore.sh /backups/20261016-020000
# CẢNH BÁO: ghi đè dữ liệu hiện tại của CSDL $PGDATABASE và thư mục tệp đính kèm.
set -eu
dir="${1:-${RESTORE_FROM:-}}"
[ -n "$dir" ] || { echo "Chỉ định thư mục sao lưu (tham số hoặc RESTORE_FROM)"; exit 1; }
UPLOADS_DIR="${UPLOADS_DIR:-/data/uploads}"

(cd "$dir" && sha256sum -c SHA256SUMS)
echo "[restore] khôi phục CSDL $PGDATABASE từ $dir/workhub.dump"
pg_restore --clean --if-exists --no-owner --dbname="$PGDATABASE" "$dir/workhub.dump"
if [ -f "$dir/uploads.tgz" ]; then
  echo "[restore] khôi phục tệp đính kèm vào $UPLOADS_DIR"
  mkdir -p "$UPLOADS_DIR"
  tar -xzf "$dir/uploads.tgz" -C "$UPLOADS_DIR"
fi
echo "[restore] xong"
