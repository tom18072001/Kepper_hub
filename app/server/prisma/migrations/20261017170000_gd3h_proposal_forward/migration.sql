-- GĐ3h: lãnh đạo phòng trình kiến nghị của cán bộ lên Ban Giám đốc.
ALTER TABLE "ProgressReport" ADD COLUMN "forwardedAt" TIMESTAMP(3), ADD COLUMN "forwardedById" INTEGER, ADD COLUMN "forwardNote" TEXT;
