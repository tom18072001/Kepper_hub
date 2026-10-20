#!/bin/sh
# Sao lưu WorkHub: CSDL (pg_dump định dạng custom) + tệp đính kèm, giữ BACKUP_KEEP_DAYS ngày.
# Chạy một lần:  BACKUP_ONCE=1 sh backup.sh
# Chạy định kỳ:  mặc định mỗi ngày lúc BACKUP_HOUR (giờ theo TZ của container).
# Biến: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE BACKUP_DIR UPLOADS_DIR BACKUP_KEEP_DAYS BACKUP_HOUR
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-/data/uploads}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR:-02}"

run_backup() {
  stamp="$(date +%Y%m%d-%H%M%S)"
  dir="$BACKUP_DIR/$stamp"
  mkdir -p "$dir"
  echo "[backup] $stamp: pg_dump $PGDATABASE"
  pg_dump --format=custom --no-owner --file="$dir/workhub.dump" "$PGDATABASE"
  if [ -d "$UPLOADS_DIR" ]; then
    echo "[backup] $stamp: nén tệp đính kèm"
    tar -czf "$dir/uploads.tgz" -C "$UPLOADS_DIR" .
  fi
  # Tổng kiểm (để phát hiện bản sao lưu bị sửa/hỏng khi khôi phục).
  (cd "$dir" && sha256sum ./* > SHA256SUMS)
  # Kiểm tra bản dump đọc được.
  pg_restore --list "$dir/workhub.dump" > /dev/null
  echo "[backup] $stamp: xong ($(du -sh "$dir" | cut -f1))"
  # Xoá bản cũ hơn KEEP_DAYS ngày.
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
}

if [ "${BACKUP_ONCE:-0}" = "1" ]; then run_backup; exit 0; fi

echo "[backup] chạy hằng ngày lúc ${HOUR}:00, giữ ${KEEP_DAYS} ngày, lưu tại ${BACKUP_DIR}"
last=""
while true; do
  today="$(date +%Y%m%d)"
  if [ "$(date +%H)" = "$HOUR" ] && [ "$last" != "$today" ]; then
    run_backup || echo "[backup] LỖI sao lưu $(date)" >&2
    last="$today"
  fi
  sleep 300
done
