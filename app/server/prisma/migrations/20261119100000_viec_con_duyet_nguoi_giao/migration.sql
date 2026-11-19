-- Việc con hiện ở mọi view + luật "hoàn thành → chờ người giao duyệt, chấm mức hoàn thành".
-- Không đổi trạng thái của việc cũ: việc đã Hoàn thành giữ nguyên; phiếu duyệt cũ đang chờ chạy tiếp theo cách cũ (withAssigner = false).

-- 1. Phiếu duyệt mới có cấp "Người giao duyệt" đứng đầu.
ALTER TABLE "ApprovalRequest" ADD COLUMN "withAssigner" BOOLEAN NOT NULL DEFAULT false;

-- 2. Lưu mức hoàn thành ngay trên từng lần duyệt (lịch sử: ai, lúc nào, mức nào, nhận xét).
ALTER TABLE "ApprovalAction" ADD COLUMN "rating" TEXT;

-- 3. Thang 5 mức: Xuất sắc / Tốt / Đạt / Cần cải thiện / Kém. Mức cũ "Không hoàn thành" (FAIL) → "Kém" (POOR).
UPDATE "WorkItem" SET "rating" = 'POOR' WHERE "rating" = 'FAIL';

-- 4. Mọi dự án có cột Hoàn thành phải có cột Chờ duyệt (nhóm REVIEW), đặt ngay trước cột Hoàn thành đầu tiên.
--    Dự án chỉ có cột tự do (vd. "Lịch tuần") không có khái niệm hoàn thành nên không thêm.
WITH need AS (
  SELECT s."projectId", MIN(s."position") AS pos
  FROM "WorkflowState" s
  WHERE s."category" = 'COMPLETED'
    AND NOT EXISTS (SELECT 1 FROM "WorkflowState" r WHERE r."projectId" = s."projectId" AND r."category" = 'REVIEW')
  GROUP BY s."projectId"
), shifted AS (
  UPDATE "WorkflowState" w SET "position" = w."position" + 1
  FROM need WHERE w."projectId" = need."projectId" AND w."position" >= need.pos
  RETURNING w."id"
)
INSERT INTO "WorkflowState" ("projectId", "name", "category", "color", "position")
SELECT need."projectId", 'Chờ duyệt', 'REVIEW', '#d97706', need.pos FROM need;
