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

echo "==> Áp migration (prisma migrate deploy)"
if ! npx prisma migrate deploy; then
  echo "!! LỖI migration — ứng dụng KHÔNG khởi động để không chạy trên CSDL dở dang."
  echo "!! Quay lại:  1) đặt lại image cũ (deploy/upgrade.ps1 in sẵn lệnh)  2) khôi phục bản sao lưu vừa tạo trước khi nâng cấp (deploy/restore.sh)."
  echo "!! Hoặc sửa migration lỗi rồi đánh dấu:  npx prisma migrate resolve --rolled-back <tên migration>"
  exit 1
fi

echo "==> Tạo tài khoản quản trị gốc / dữ liệu mẫu (nếu cần)"
node src/seed.js

echo "==> Chạy máy chủ"
exec node src/server.js
