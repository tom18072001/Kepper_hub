#!/bin/sh
# Nâng cấp Kepper Hub trên NAS / máy chủ Linux (bản Linux của deploy/upgrade.ps1):
# sao lưu → giữ image cũ để quay lại → lấy mã → build → khởi động → kiểm tra.
#   sudo sh deploy/upgrade.sh [nhánh]
# Nên chạy ngoài giờ nộp báo cáo (không chạy chiều thứ Sáu / sáng thứ Hai).
set -eu
cd "$(dirname "$0")/.."
BRANCH="${1:-}"
stamp="$(date +%Y%m%d-%H%M)"
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

echo "==> 1/5 Sao lưu CSDL + tệp đính kèm trước khi nâng cấp"
$DC build backup >/dev/null || { echo "!! Build image sao lưu lỗi — DỪNG nâng cấp."; exit 1; }
$DC run --rm -e BACKUP_ONCE=1 backup || { echo "!! Sao lưu lỗi — DỪNG nâng cấp (dữ liệu hiện tại không đổi)."; exit 1; }

echo "==> 2/5 Giữ image hiện tại để quay lại"
cid="$($DC ps -q app || true)"; rollback=""; cur=""
if [ -n "$cid" ]; then
  img="$(docker inspect -f '{{.Image}}' "$cid")"; cur="$(docker inspect -f '{{.Config.Image}}' "$cid")"
  rollback="kepper-app:rollback-$stamp"; docker image tag "$img" "$rollback"
  echo "    image cũ: $rollback ($cur)"
fi

echo "==> 3/5 Lấy mã mới"
git fetch origin
[ -z "$BRANCH" ] || git checkout "$BRANCH"
git pull --ff-only || { echo "!! git pull lỗi — xử lý thay đổi cục bộ rồi chạy lại."; exit 1; }
git log --oneline -1

echo "==> 4/5 Build và khởi động (migration tự chạy khi app khởi động)"
$DC up -d --build

echo "==> 5/5 Chờ app sẵn sàng"
i=0
while [ $i -lt 36 ]; do
  sleep 5; i=$((i + 1))
  id="$($DC ps -q app || true)"
  [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy ] && { echo "OK — đã nâng cấp. Image cũ: ${rollback:-không có} (xoá khi ổn định: docker image rm $rollback)"; exit 0; }
done
echo "!! App chưa sẵn sàng sau 3 phút. 40 dòng log cuối:"; $DC logs app --tail 40
echo "!! Quay lại bản cũ:"
[ -z "$rollback" ] || echo "     docker image tag $rollback $cur"
echo "     $DC stop app backup"
echo "     $DC --profile restore run --rm -e RESTORE_FROM=/backups/<thư mục mới nhất> restore"
echo "     $DC up -d --no-build app backup"
exit 1
