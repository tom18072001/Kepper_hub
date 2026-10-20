-- GĐ3b: phản hồi của người dùng theo vai trò (hạn nội bộ, bị trả lại, báo cáo phối hợp, duyệt thay).
-- AlterTable
ALTER TABLE "ApprovalAction" ADD COLUMN     "onBehalfOfId" INTEGER;

-- AlterTable
ALTER TABLE "ProgressReport" ADD COLUMN     "asSupporter" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "internalDueDate" TIMESTAMP(3),
ADD COLUMN     "returnNote" TEXT,
ADD COLUMN     "returnedAt" TIMESTAMP(3);


-- Việc đang bị trả lại (yêu cầu duyệt gần nhất bị từ chối và việc chưa gửi lại).
UPDATE "WorkItem" w SET "returnedAt" = r."closedAt"
FROM (SELECT DISTINCT ON ("workItemId") "workItemId", "status", "closedAt" FROM "ApprovalRequest" ORDER BY "workItemId", "id" DESC) r
WHERE r."workItemId" = w."id" AND r."status" = 'REJECTED';
