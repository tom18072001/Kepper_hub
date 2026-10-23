#!/bin/sh
# Sao lưu Kepper Hub: CSDL (pg_dump định dạng custom) + tệp đính kèm, giữ BACKUP_KEEP_DAYS ngày.
# Chạy một lần:  BACKUP_ONCE=1 sh backup.sh
# Chạy định kỳ:  mỗi ngày từ BACKUP_HOUR (giờ theo TZ của container); CHẠY BÙ khi máy bật lại sau giờ đó
#                (máy chạy là PC: thường tắt lúc 02:00 → trước đây không bao giờ sao lưu).
# Biến:
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE BACKUP_DIR UPLOADS_DIR BACKUP_KEEP_DAYS BACKUP_HOUR
#   BACKUP_AGE_RECIPIENT  khoá công khai age ("age1…"): mã hoá bản sao lưu; khoá bí mật giữ NGOÀI máy chạy
#   BACKUP_COPY=1         chép bản đạt sang /backups-copy (ổ / máy khác, mount bằng BACKUP_COPY_PATH), giữ BACKUP_COPY_KEEP_DAYS ngày
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
COPY_DIR="${BACKUP_COPY_DIR:-/backups-copy}"
UPLOADS_DIR="${UPLOADS_DIR:-/data/uploads}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
COPY_KEEP_DAYS="${BACKUP_COPY_KEEP_DAYS:-90}"
HOUR="${BACKUP_HOUR:-02}"
RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"

# Ghi trạng thái vào CSDL (AppSetting backup.status) để ứng dụng cảnh báo khi sao lưu hỏng / quá cũ.
# Gộp JSON: lần lỗi không xoá mốc lastOk của lần đạt trước.
status() {
  psql -q -v ON_ERROR_STOP=1 -v v="$1" >/dev/null 2>&1 <<'SQL' || echo "[backup] không ghi được trạng thái vào CSDL" >&2
INSERT INTO "AppSetting"(key, value, "updatedAt") VALUES ('backup.status', :'v'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = "AppSetting".value || EXCLUDED.value, "updatedAt" = now();
SQL
}
fail() { echo "[backup] LỖI $1" >&2; rm -rf "$dir"; status "{\"lastFailAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"error\":\"$1\"}"; return 1; }

# Mỗi bước kiểm lỗi riêng: trong hàm gọi kiểu `run_backup || …`, `set -e` KHÔNG có tác dụng (POSIX), nên phải return tường minh.
# Chỉ xoá bản cũ khi bản mới đã đạt (dump đọc được + mã hoá nếu cấu hình + có tổng kiểm); ghi dấu LAST_OK.
run_backup() {
  # Ổ đầy là lý do hỏng sao lưu hay gặp nhất: cần trống ít nhất gấp đôi bản gần nhất (tối thiểu 200 MB).
  prev_dir="$(ls -1dt "$BACKUP_DIR"/2* 2>/dev/null | head -1 || true)"
  prev_kb=0; [ -n "$prev_dir" ] && prev_kb="$(du -sk "$prev_dir" 2>/dev/null | cut -f1)"
  need_kb=$(( ${prev_kb:-0} * 2 ))
  [ "$need_kb" -lt 204800 ] && need_kb=204800
  free_kb="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
  if [ -n "$free_kb" ] && [ "$free_kb" -lt "$need_kb" ]; then dir="/nonexistent"; fail "ổ sao lưu còn ${free_kb} KB, cần ${need_kb} KB"; return 1; fi
  stamp="$(date +%Y%m%d-%H%M%S)"
  dir="$BACKUP_DIR/$stamp"
  # Không bao giờ dùng lại thư mục đã có (lỗi ở lần chạy sau sẽ xoá nhầm bản đạt cùng giây).
  [ -e "$dir" ] && { stamp="$stamp-$$"; dir="$BACKUP_DIR/$stamp"; }
  mkdir -p "$BACKUP_DIR" && mkdir "$dir" || return 1
  echo "[backup] $stamp: pg_dump $PGDATABASE"
  pg_dump --format=custom --no-owner --file="$dir/workhub.dump" "$PGDATABASE" || { fail "pg_dump"; return 1; }
  pg_restore --list "$dir/workhub.dump" > /dev/null || { fail "dump không đọc được"; return 1; }
  if [ -d "$UPLOADS_DIR" ]; then
    echo "[backup] $stamp: nén tệp đính kèm"
    tar -czf "$dir/uploads.tgz" --exclude='./.before-*' --exclude='./.restore-*' -C "$UPLOADS_DIR" . || { fail "nén tệp đính kèm"; return 1; }
  fi
  encrypted=false
  if [ -n "$RECIPIENT" ]; then
    command -v age >/dev/null || { fail "thiếu công cụ age (dùng image kepper-backup)"; return 1; }
    for f in "$dir"/workhub.dump "$dir"/uploads.tgz; do
      [ -f "$f" ] || continue
      age -r "$RECIPIENT" -o "$f.age" "$f" || { fail "mã hoá $(basename "$f")"; return 1; }
      rm -f "$f"
    done
    encrypted=true
  fi
  (cd "$dir" && sha256sum ./* > SHA256SUMS) || { fail "tổng kiểm"; return 1; }
  size="$(du -sk "$dir" | cut -f1)"
  copied=false
  if [ "${BACKUP_COPY:-0}" = "1" ]; then
    # Thư mục "ngoài máy" mà trùng thư mục sao lưu (quên đặt BACKUP_COPY_PATH) thì không tính là bản ngoài máy.
    probe=".probe.$$"; : > "$BACKUP_DIR/$probe"
    if [ -e "$COPY_DIR/$probe" ]; then
      echo "[backup] CẢNH BÁO: BACKUP_COPY_PATH trùng thư mục sao lưu — chưa có bản ngoài máy" >&2
    elif [ -d "$COPY_DIR" ] && cp -r "$dir" "$COPY_DIR/" && (cd "$COPY_DIR/$stamp" && sha256sum -c SHA256SUMS >/dev/null); then
      copied=true
      # Chỉ dọn thư mục do backup.sh tạo (tên dạng 20261023-020000) — đặt nhầm BACKUP_COPY_PATH vào gốc ổ cũng không xoá thư mục khác.
      find "$COPY_DIR" -mindepth 1 -maxdepth 1 -type d -name '20[0-9][0-9][01][0-9][0-3][0-9]-*' -mtime +"$COPY_KEEP_DAYS" -exec rm -rf {} + || echo "[backup] không dọn được bản cũ ở $COPY_DIR" >&2
    else
      echo "[backup] CẢNH BÁO: không chép được sang $COPY_DIR" >&2
    fi
    rm -f "$BACKUP_DIR/$probe"
  fi
  date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/LAST_OK" && echo "$stamp" >> "$BACKUP_DIR/LAST_OK"
  status "{\"lastOk\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"stamp\":\"$stamp\",\"sizeKb\":$size,\"encrypted\":$encrypted,\"copied\":$copied,\"error\":null}"
  echo "[backup] $stamp: xong (${size} KB, mã hoá: $encrypted, bản ngoài máy: $copied)"
  # Xoá bản cũ hơn KEEP_DAYS ngày — chỉ sau khi bản mới đạt; chỉ thư mục do backup.sh tạo; lỗi dọn không làm hỏng lần sao lưu đã đạt.
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20[0-9][0-9][01][0-9][0-3][0-9]-*' -mtime +"$KEEP_DAYS" -exec rm -rf {} + || echo "[backup] không dọn được bản cũ" >&2
  return 0
}

if [ "${BACKUP_ONCE:-0}" = "1" ]; then run_backup || exit 1; exit 0; fi

[ -n "$RECIPIENT" ] || echo "[backup] CẢNH BÁO: chưa đặt BACKUP_AGE_RECIPIENT — bản sao lưu KHÔNG mã hoá" >&2
[ "${STORAGE_DRIVER:-local}" = "local" ] || echo "[backup] CẢNH BÁO: STORAGE_DRIVER=${STORAGE_DRIVER} — tệp đính kèm trên MinIO KHÔNG nằm trong bản sao lưu này" >&2
echo "[backup] chạy hằng ngày từ ${HOUR}:00 (chạy bù khi máy bật lại), giữ ${KEEP_DAYS} ngày, lưu tại ${BACKUP_DIR}"
# Ghi mốc "đã sao lưu hôm nay" CHỈ khi đạt; lỗi thì thử lại sau ~30 phút, tối đa 3 lần / ngày.
mark="$BACKUP_DIR/.last_ok_day"
tday=""; tries=0; next_try=0
while true; do
  today="$(date +%Y%m%d)"
  [ "$today" != "$tday" ] && { tday="$today"; tries=0; next_try=0; }
  last="$(cat "$mark" 2>/dev/null || true)"
  # So sánh giờ dạng số (bỏ số 0 đầu: "08" không phải số bát phân hợp lệ).
  now_h="$(date +%H | sed 's/^0//')"; want_h="$(echo "$HOUR" | sed 's/^0//')"
  if [ "${now_h:-0}" -ge "${want_h:-0}" ] && [ "$last" != "$today" ] && [ "$tries" -lt 3 ] && [ "$(date +%s)" -ge "$next_try" ]; then
    if run_backup; then echo "$today" > "$mark"
    else tries=$((tries + 1)); next_try=$(( $(date +%s) + 1800 )); echo "[backup] LỖI sao lưu lần $tries $(date)" >&2; fi
  fi
  sleep 300
done
