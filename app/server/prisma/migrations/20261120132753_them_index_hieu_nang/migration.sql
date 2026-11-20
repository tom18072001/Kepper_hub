-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedById_idx" ON "ApprovalRequest"("requestedById");

-- CreateIndex
CREATE INDEX "DueExtension_requestedById_idx" ON "DueExtension"("requestedById");

-- CreateIndex
CREATE INDEX "HrAttendance_day_idx" ON "HrAttendance"("day");

-- CreateIndex
CREATE INDEX "WorkItem_reporterId_idx" ON "WorkItem"("reporterId");
