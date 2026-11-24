-- NÂNG CẤP LẠI lên bản "Quy chế nội bộ: phê duyệt" sau khi đã quay lại bản cũ bằng scripts/quy-che-quay-lai.sql.
-- Chạy TRƯỚC khi bật image mới (migration 20261124170711_quy_che_phe_duyet đã áp từ lần trước nên không chạy lại).
--   docker compose exec -T postgres psql -U <user> -d <db> -v ON_ERROR_STOP=1 < app/server/scripts/quy-che-nang-lai.sql
BEGIN;
-- 1) Dự thảo: bỏ số giả.
UPDATE "DocRecord" SET "seq" = NULL, "number" = NULL
WHERE "book" = 'NOIBO' AND "status" IN ('DRAFT', 'RETURNED') AND "number" LIKE 'DU-THAO-%';
-- 2) Văn bản nội bộ vào sổ trong lúc chạy bản cũ (chưa có cấp xem): nhật ký MIGRATE, rồi cấp xem theo mức mật (như migration).
INSERT INTO "DocEvent" ("docId", "userId", "action", "fromValue", "toValue", "note", "createdAt")
SELECT "id", NULL, 'MIGRATE', "security", CASE "security" WHEN 'BAO_MAT_CAO' THEN 'BOARD' WHEN 'HAN_CHE' THEN 'LEADERS' ELSE 'ALL' END,
  'Vào sổ trong lúc chạy bản cũ — cấp xem chuyển theo mức mật', CURRENT_TIMESTAMP
FROM "DocRecord" WHERE "book" = 'NOIBO' AND "viewLevel" IS NULL;
UPDATE "DocRecord" SET "viewLevel" = CASE "security" WHEN 'BAO_MAT_CAO' THEN 'BOARD' WHEN 'HAN_CHE' THEN 'LEADERS' ELSE 'ALL' END
WHERE "book" = 'NOIBO' AND "viewLevel" IS NULL;
-- 3) "Đã ban hành" của bản cũ = "Đã phê duyệt".
UPDATE "DocRecord" SET "status" = 'APPROVED' WHERE "book" = 'NOIBO' AND "status" = 'ISSUED';
COMMIT;
