-- CreateIndex
CREATE INDEX "ApprovalAction_requestId_idx" ON "ApprovalAction"("requestId");

-- CreateIndex
CREATE INDEX "ChecklistItem_workItemId_idx" ON "ChecklistItem"("workItemId");

-- CreateIndex
CREATE INDEX "Notification_link_idx" ON "Notification"("link");

-- CreateIndex
CREATE INDEX "WorkItem_parentId_idx" ON "WorkItem"("parentId");

-- CreateIndex
CREATE INDEX "WorkItem_assignedById_idx" ON "WorkItem"("assignedById");


-- Việc đang bị trả lại trước khi có cột returnNote: lấy ý kiến của lần trả lại gần nhất.
UPDATE "WorkItem" w SET "returnNote" = a."comment"
FROM (SELECT DISTINCT ON (r."workItemId") r."workItemId", x."comment"
      FROM "ApprovalRequest" r JOIN "ApprovalAction" x ON x."requestId" = r."id" AND x."decision" = 'REJECT'
      ORDER BY r."workItemId", r."id" DESC, x."id" DESC) a
WHERE a."workItemId" = w."id" AND w."returnedAt" IS NOT NULL AND w."returnNote" IS NULL;
