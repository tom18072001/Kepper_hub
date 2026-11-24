-- QUAY LẠI bản trước tính năng "Quy chế nội bộ: phê duyệt" (PR #41 trở về trước) khi CSDL ĐÃ có dự thảo.
-- Chạy TRƯỚC khi bật image cũ. Bản cũ khai báo DocRecord.number / seq bắt buộc → đọc dự thảo (number trống) sẽ lỗi cả danh sách Văn thư.
-- Không xoá dữ liệu; nâng cấp lại thì chạy scripts/quy-che-nang-lai.sql (ngược lại đúng các bước này) TRƯỚC khi bật image mới.
--   docker compose exec -T postgres psql -U <user> -d <db> -v ON_ERROR_STOP=1 < app/server/scripts/quy-che-quay-lai.sql
-- Trong lúc chạy bản cũ: dự thảo hiện số "DU-THAO-<id>", trạng thái "DRAFT" / "RETURNED"; KHÔNG đổi trạng thái / vào sổ các dự thảo này.
-- Quyền xem khi chạy bản cũ (mức mật ghi song song, services/vanthu.js legacySecurity): hẹp hơn hoặc bằng bản mới, trừ một điểm —
-- mọi thành viên Ban TGĐ (không chỉ Người phê duyệt) xem được dự thảo.
BEGIN;
-- 1) Dự thảo: số giả không trùng số thật (seq âm, ràng buộc duy nhất vẫn giữ).
UPDATE "DocRecord" SET "seq" = -"id", "number" = 'DU-THAO-' || "id"
WHERE "book" = 'NOIBO' AND "number" IS NULL;
-- 2) Chắc chắn dự thảo / đã trả lại ở mức Bảo mật cao (bản cũ: chỉ Ban TGĐ + người soạn); tài liệu đã duyệt cấp Lãnh đạo / Ban TGĐ cũng vậy.
UPDATE "DocRecord" SET "security" = 'BAO_MAT_CAO'
WHERE "book" = 'NOIBO' AND ("status" IN ('DRAFT', 'RETURNED') OR coalesce("viewLevel", 'ALL') <> 'ALL') AND "security" <> 'BAO_MAT_CAO';
-- 3) Trạng thái "Đã phê duyệt" của bản mới = "Đã ban hành" của bản cũ.
UPDATE "DocRecord" SET "status" = 'ISSUED' WHERE "book" = 'NOIBO' AND "status" = 'APPROVED';
COMMIT;
