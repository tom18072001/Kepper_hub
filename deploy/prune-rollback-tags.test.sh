#!/bin/sh
# Test deploy/prune-rollback-tags.sh bằng docker giả — không cần Docker, không đụng image thật. Chạy trong CI:
#   sh deploy/prune-rollback-tags.test.sh
set -eu
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin"
# docker giả: chỉ nhận đúng hai lệnh script được phép gọi; lệnh khác ghi vào $FAKE_DIR/err (test hỏng).
# Tag có trong $FAKE_DIR/busy thì "image rm" báo lỗi (như image đang có container dùng).
cat > "$tmp/bin/docker" <<'EOF'
#!/bin/sh
case "$*" in
  "image ls kepper-app --format {{.Tag}}") cat "$FAKE_DIR/tags" ;;
  "image rm kepper-app:"*)
    [ "$#" = 3 ] || { echo "$*" >> "$FAKE_DIR/err"; exit 99; }
    if grep -qxF "$3" "$FAKE_DIR/busy"; then echo "Error: conflict: image is being used" >&2; exit 1; fi
    echo "$3" >> "$FAKE_DIR/rm" ;;
  *) echo "$*" >> "$FAKE_DIR/err"; exit 99 ;;
esac
EOF
chmod +x "$tmp/bin/docker"
pass=0; fails=0
ok() { echo "ok - $1"; pass=$((pass + 1)); }
hong() { echo "not ok - $1"; fails=$((fails + 1)); }
words() { printf '%s\n' $1 | sed '/^$/d'; }
# kiem <tên> <N, rỗng = mặc định> "<tag đang có>" "<tag phải bị gỡ>" ["<tag gỡ lỗi>"] — danh sách cách nhau dấu cách.
kiem() {
  words "$3" > "$tmp/tags"; : > "$tmp/rm"; : > "$tmp/err"
  for t in ${5:-}; do echo "kepper-app:$t"; done > "$tmp/busy"
  if ! out="$(FAKE_DIR="$tmp" PATH="$tmp/bin:$PATH" sh deploy/prune-rollback-tags.sh ${2:+"$2"})"; then
    hong "$1 (script thoát lỗi)"; return 0
  fi
  got="$(LC_ALL=C sort "$tmp/rm" | tr '\n' ' ')"
  want="$(for t in $4; do echo "kepper-app:$t"; done | LC_ALL=C sort | tr '\n' ' ')"
  said="$(printf '%s\n' "$out" | grep 'xoá tag cũ: ' | sed 's/.*xoá tag cũ: //' | LC_ALL=C sort | tr '\n' ' ')"
  if [ "$got" = "$want" ] && [ "$said" = "$want" ] && [ ! -s "$tmp/err" ]; then ok "$1"; else
    hong "$1"; echo "    gỡ: [$got]  báo: [$said]  cần: [$want]"
    [ ! -s "$tmp/err" ] || echo "    lệnh docker lạ: $(cat "$tmp/err")"
  fi
}

# Danh sách tag thật trên máy ảo ngày 24/11/2026: một tag tự động, một tag quay lại đặt tay, năm tag pre-… đặt tay.
VM="0.2.0 rollback-20261124-191339 rollback-pr40-20261124-163054 pre-cache-20261121 pre-perf-20261120 pre-mcp051-20261120 pre-quyen-20261120 pre-ux-20261120"
kiem "máy ảo 24/11 + tag của lần triển khai kế: tag đặt tay không chiếm chỗ, không gỡ gì" 2 "$VM rollback-20261125-090000" ""
kiem "lần triển khai sau nữa: gỡ tag tự động cũ nhất, tag đặt tay giữ nguyên" 2 \
  "$VM rollback-20261125-090000 rollback-20261126-100000" "rollback-20261124-191339"
kiem "không truyền N: giữ 2" "" "rollback-20261124-191339 rollback-20261125-090000 rollback-20261126-100000" "rollback-20261124-191339"
kiem "thứ tự docker trả về không quan trọng; qua năm mới vẫn đúng" 2 \
  "rollback-20261124-191141 rollback-20270101-000001 rollback-20261120-235959 rollback-20261231-235959 rollback-20261124-191339" \
  "rollback-20261124-191141 rollback-20261120-235959 rollback-20261124-191339"
kiem "tag của upgrade.sh (không có giây) và tên gần giống mẫu giữ nguyên" 1 \
  "rollback-20261101-1200 rollback-20261124-1913390 rollback-20261124-191339-x xrollback-20261124-191339 rollback-2026112-191339 rollback-20261124-191339 rollback-20261125-090000" \
  "rollback-20261124-191339"
kiem "chưa đủ N tag tự động: không gỡ gì" 2 "0.2.0 rollback-20261124-191339 rollback-pr40-20261124-163054" ""
kiem "chưa có image kepper-app: không gỡ gì" 2 "" ""
kiem "gỡ tag bị lỗi (image đang được dùng), kể cả tag cuối: vẫn gỡ tag khác, chỉ báo tag đã gỡ, thoát 0" 1 \
  "rollback-20261120-010000 rollback-20261122-120000 rollback-20261124-191339 rollback-20261125-090000" "rollback-20261122-120000" \
  "rollback-20261124-191339 rollback-20261120-010000"

# N không hợp lệ: thoát 2, không gọi docker.
words "rollback-20261124-191339 rollback-20261125-090000 rollback-20261126-100000" > "$tmp/tags"; : > "$tmp/rm"; : > "$tmp/err"; : > "$tmp/busy"
rc=0; FAKE_DIR="$tmp" PATH="$tmp/bin:$PATH" sh deploy/prune-rollback-tags.sh 2x >/dev/null 2>&1 || rc=$?
if [ "$rc" = 2 ] && [ ! -s "$tmp/rm" ] && [ ! -s "$tmp/err" ]; then ok "N không hợp lệ: thoát 2, không gỡ gì"; else hong "N không hợp lệ: mã $rc"; fi

# Nối với vm-deploy.sh: tag tạo đúng mẫu script dọn nhận; gọi dọn đúng một lần, SAU khi gắn tag mới; không tự gỡ tag ở chỗ khác
# (dòng 'docker image rm' còn lại trong vm-deploy.sh chỉ là lời nhắc được in ra).
mk="$(grep -nF 'rollback="kepper-app:rollback-$(date +%Y%m%d-%H%M%S)"' deploy/vm-deploy.sh | cut -d: -f1)"
call="$(grep -n '^ *sh deploy/prune-rollback-tags.sh 2' deploy/vm-deploy.sh | cut -d: -f1)"
ncall="$(printf '%s\n' "$call" | grep -c . || true)"
stray="$(grep 'docker image rm' deploy/vm-deploy.sh | grep -v 'echo' || true)"
if [ -n "$mk" ] && [ "$ncall" = 1 ] && [ "$call" -gt "$mk" ] && [ -z "$stray" ]; then ok "vm-deploy.sh: tag đúng mẫu, gọi dọn một lần sau khi gắn tag"; else
  hong "vm-deploy.sh: dòng tạo tag [$mk], dòng gọi dọn [$call], lệnh gỡ khác [$stray]"
fi

echo "# $pass đạt, $fails hỏng"
[ "$fails" = 0 ]
