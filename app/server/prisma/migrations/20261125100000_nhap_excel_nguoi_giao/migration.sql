-- Việc nhập bằng "Danh sách đơn giản (Excel)" (routes/excel.js) trước bản này không ghi người giao: không ai — kể cả người nhập — sửa được
-- kế hoạch, giao người, xoá được việc đó, trừ BTGĐ phụ trách. Từ bản này đường nhập đặt người giao = người nhập (như tạo việc thường).
-- CHỈ SỬA DỮ LIỆU, chạy một lần lúc triển khai: việc nhập bằng đường này (hoạt động CREATED có data.source = 'EXCEL') mà còn thiếu người
-- giao → người giao = người nhập (reporterId), ngày giao = ngày giao đã có hoặc ngày tạo. Không đụng việc nhập MTL (source 'MTL'),
-- việc nhập sổ giao việc / kế hoạch năm (đã có người giao), việc tạo thường, và việc đã được đặt người giao sau khi nhập.
UPDATE "WorkItem" AS w
SET "assignedById" = w."reporterId",
    "assignedAt" = COALESCE(w."assignedAt", w."createdAt")
WHERE w."assignedById" IS NULL
  AND w."reporterId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Activity" a
    WHERE a."workItemId" = w."id" AND a."type" = 'CREATED' AND a."data"->>'source' = 'EXCEL'
  );
