#!/bin/sh
# Khởi động container: chờ CSDL → áp migration (không mất dữ liệu) → tạo quản trị gốc / dữ liệu mẫu → chạy.
set -e

echo "==> Chờ PostgreSQL sẵn sàng"
i=0
until node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.\$queryRaw\`SELECT 1\`.then(()=>process.exit(0)).catch(()=>process.exit(1))"; do
  i=$((i+1))
  if [ "$i" -ge 30 ]; then echo "Không kết nối được CSDL sau 30 lần thử."; exit 1; fi
  echo "   CSDL chưa sẵn sàng, thử lại lần $i..."
  sleep 2
done

# Thư mục mount từ máy chạy (NAS / Linux) thường thuộc root → app (uid 1000) không ghi được: báo rõ cách sửa.
for d in "${UPLOAD_DIR:-/data/uploads}" "${ACCESS_LOG_DIR:-}"; do
  [ -n "$d" ] || continue
  if ! { mkdir -p "$d" 2>/dev/null && [ -w "$d" ]; }; then
    echo "!! Không ghi được $d (tệp đính kèm / ảnh đại diện / nhật ký truy cập sẽ lỗi)."
    echo "!! Trên máy chạy: sudo chown -R 1000:1000 <thư mục mount vào $d>   (xem docs/deploy-nas.md)"
  fi
done

echo "==> Áp migration (prisma migrate deploy)"
if ! npx prisma migrate deploy; then
  echo "!! LỖI migration — ứng dụng KHÔNG khởi động để không chạy trên CSDL dở dang (dữ liệu chưa đổi nếu migration dừng ở chốt đầu)."
  echo "!! Khôi phục, chạy trên máy (thư mục cài) — docs/de-xuat-mot-he-quy-chieu-phan-quyen.md, mục 11:"
  echo "!!   1) docker compose stop app                      (dừng app TRƯỚC — nếu không nó tự chạy lại migration và ghi thêm bản ghi lỗi)"
  echo "!!   2) docker compose run --rm --no-deps --entrypoint npx app prisma migrate resolve --rolled-back <tên migration lỗi ở trên>"
  echo "!!   3) chạy lại image cũ (tag kepper-app:rollback-<giờ> do deploy/vm-deploy.sh / upgrade.sh in ra), sửa nguyên nhân, triển khai lại."
  exit 1
fi

echo "==> Tạo tài khoản quản trị gốc / dữ liệu mẫu (nếu cần)"
node src/seed.js

echo "==> Chạy máy chủ"
exec node src/server.js
