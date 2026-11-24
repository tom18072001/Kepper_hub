#!/bin/sh
# Dọn tag quay lại do deploy/vm-deploy.sh tạo: giữ N tag kepper-app:rollback-<yyyymmdd-hhmmss> mới nhất (mặc định 2), gỡ các tag cũ hơn.
#   sh deploy/prune-rollback-tags.sh [N]        test (docker giả, chạy trong CI): sh deploy/prune-rollback-tags.test.sh
# CHỈ đụng tag đúng mẫu rollback-<8 số>-<6 số> — tên theo giờ nên thứ tự chữ là thứ tự thời gian. Tag đặt tay (vd. rollback-pr40-…,
# pre-…) và tag của upgrade.sh / upgrade.ps1 (rollback-<yyyymmdd-hhmm>) giữ nguyên và không chiếm chỗ của tag tự động.
# Gỡ tag; image chỉ bị xoá khi không còn tag nào khác và không container nào dùng. Gỡ lỗi thì bỏ qua — không chặn triển khai.
set -eu
keep="${1:-2}"
case "$keep" in ''|*[!0-9]*) echo "!! N phải là số nguyên không âm (nhận: '$keep')" >&2; exit 2 ;; esac
docker image ls kepper-app --format '{{.Tag}}' | grep -E '^rollback-[0-9]{8}-[0-9]{6}$' | LC_ALL=C sort -r | tail -n +"$((keep + 1))" |
  while read -r t; do
    docker image rm "kepper-app:$t" >/dev/null 2>&1 && echo "    xoá tag cũ: kepper-app:$t" || true
  done
