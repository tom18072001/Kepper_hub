-- "Ban Giám đốc toàn quyền" (quyền tối thiểu theo vai, 20/11/2026): người dùng được quản trị đánh dấu riêng là Ban Giám đốc của MỌI việc
-- (không xác định theo phòng). Mặc định không ai được chọn; PGĐ phụ trách bộ phận vẫn chỉ là Ban Giám đốc của việc bộ phận mình phụ trách.
ALTER TABLE "User" ADD COLUMN "boardAll" BOOLEAN NOT NULL DEFAULT false;
