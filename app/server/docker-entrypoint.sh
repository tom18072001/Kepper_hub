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
npx prisma migrate deploy

echo "==> Tạo tài khoản quản trị gốc / dữ liệu mẫu (nếu cần)"
node src/seed.js

echo "==> Chạy máy chủ"
exec node src/server.js
