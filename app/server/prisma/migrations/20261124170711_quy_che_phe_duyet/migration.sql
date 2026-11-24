-- Quy chế, quy định nội bộ: dự thảo → Người phê duyệt (Ban TGĐ) phê duyệt → cấp số; cấp xem theo vai thay mức mật trong sổ nội bộ.
-- Chủ dự án duyệt 24/11/2026 — docs/de-xuat-quy-che-phe-duyet.md. CHỈ THÊM CỘT / NỚI NOT NULL, không xoá dữ liệu, không đổi số đã cấp.

-- 1) Dự thảo chưa có số: số và thứ tự trong dãy cho phép trống (ràng buộc duy nhất của PostgreSQL bỏ qua giá trị trống).
ALTER TABLE "DocRecord" ALTER COLUMN "seq" DROP NOT NULL;
ALTER TABLE "DocRecord" ALTER COLUMN "number" DROP NOT NULL;

-- 2) Metadata sổ nội bộ.
ALTER TABLE "DocRecord" ADD COLUMN "viewLevel" TEXT;
ALTER TABLE "DocRecord" ADD COLUMN "docCode" TEXT;
ALTER TABLE "DocRecord" ADD COLUMN "effectiveDate" TEXT;
ALTER TABLE "DocRecord" ADD COLUMN "replacesId" INTEGER;
ALTER TABLE "DocRecord" ADD COLUMN "approvedById" INTEGER;
ALTER TABLE "DocRecord" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "DocRecord" ADD COLUMN "viaAi" BOOLEAN NOT NULL DEFAULT false;

-- 3) Văn bản nội bộ đã có (mục 8 của đề xuất): giữ nguyên số, coi là ĐÃ PHÊ DUYỆT ("ban hành trước khi có luồng phê duyệt",
--    người phê duyệt trống); cấp xem chuyển một lần theo mức mật cũ; ghi một dòng nhật ký cho mỗi văn bản.
UPDATE "DocRecord" SET "viewLevel" = CASE "security" WHEN 'BAO_MAT_CAO' THEN 'BOARD' WHEN 'HAN_CHE' THEN 'LEADERS' ELSE 'ALL' END
WHERE "book" = 'NOIBO';
INSERT INTO "DocEvent" ("docId", "userId", "action", "fromValue", "toValue", "note", "createdAt")
SELECT "id", NULL, 'MIGRATE', "security", "viewLevel", 'Ban hành trước khi có luồng phê duyệt — cấp xem chuyển theo mức mật cũ', CURRENT_TIMESTAMP
FROM "DocRecord" WHERE "book" = 'NOIBO';
UPDATE "DocRecord" SET "status" = 'APPROVED' WHERE "book" = 'NOIBO' AND "status" = 'ISSUED';

CREATE INDEX "DocRecord_book_status_idx" ON "DocRecord"("book", "status");
