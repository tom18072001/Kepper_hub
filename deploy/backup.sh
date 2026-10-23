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

# Mỗi bước kiểm lỗi riêng: trong hàm gọi kiểu `run_backup || …`, `set -e` KHÔNG có tác dụng (POSIX), nên phải return tường minh.
# Chỉ xoá bản cũ khi bản mới đã đạt (dump đọc được + có tổng kiểm); ghi dấu LAST_OK để giám sát tuổi bản sao lưu.
run_backup() {
  stamp="$(date +%Y%m%d-%H%M%S)"
  dir="$BACKUP_DIR/$stamp"
  mkdir -p "$dir" || return 1
  echo "[backup] $stamp: pg_dump $PGDATABASE"
  pg_dump --format=custom --no-owner --file="$dir/workhub.dump" "$PGDATABASE" || { echo "[backup] LỖI pg_dump" >&2; rm -rf "$dir"; return 1; }
  if [ -d "$UPLOADS_DIR" ]; then
    echo "[backup] $stamp: nén tệp đính kèm"
    tar -czf "$dir/uploads.tgz" -C "$UPLOADS_DIR" . || { echo "[backup] LỖI nén tệp đính kèm" >&2; rm -rf "$dir"; return 1; }
  fi
  # Kiểm tra bản dump đọc được, rồi tổng kiểm (phát hiện bản bị sửa / hỏng khi khôi phục).
  pg_restore --list "$dir/workhub.dump" > /dev/null || { echo "[backup] LỖI bản dump không đọc được" >&2; rm -rf "$dir"; return 1; }
  (cd "$dir" && sha256sum ./* > SHA256SUMS) || { echo "[backup] LỖI tổng kiểm" >&2; rm -rf "$dir"; return 1; }
  date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/LAST_OK" && echo "$stamp" >> "$BACKUP_DIR/LAST_OK"
  echo "[backup] $stamp: xong ($(du -sh "$dir" | cut -f1))"
  # Xoá bản cũ hơn KEEP_DAYS ngày — chỉ sau khi bản mới đạt.
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
}

if [ "${BACKUP_ONCE:-0}" = "1" ]; then run_backup || exit 1; exit 0; fi

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
