-- Hạng mục MTL lập trên ứng dụng (việc con lãnh đạo bộ phận chi tiết hoá, việc Ban GĐ giao đột xuất) trước bản này không có
-- kế hoạch gốc → "Chưa có kế hoạch", bị loại khỏi báo cáo tuần, cập nhật nhanh, KPI, cảnh báo.
-- Bổ sung kế hoạch gốc = [ngày bắt đầu (không có: ngày tạo), hạn gốc (không có: hạn)]. Chỉ chạm hạng mục chưa có kế hoạch gốc mà có hạn.
UPDATE "WorkItem" w
SET "baselineEnd" = COALESCE(w."originalDueDate", w."dueDate"),
    "baselineStart" = LEAST(COALESCE(w."startDate", date_trunc('day', w."createdAt")), COALESCE(w."originalDueDate", w."dueDate"))
FROM "Project" p
WHERE w."projectId" = p.id
  AND p."kind" = 'MTL'
  AND w."baselineStart" IS NULL AND w."baselineEnd" IS NULL
  AND COALESCE(w."originalDueDate", w."dueDate") IS NOT NULL;
