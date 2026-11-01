-- GĐ3a: điều hành hai chiều Ban Giám đốc → phòng → cán bộ (giao về phòng, tiếp nhận, báo cáo tiến độ, gia hạn, văn bản liên quan, xếp loại, uỷ quyền).
-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "supervisorId" INTEGER;

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedById" INTEGER,
ADD COLUMN     "dispatchStatus" TEXT,
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "leadDepartmentId" INTEGER,
ADD COLUMN     "originalDueDate" TIMESTAMP(3),
ADD COLUMN     "ratedAt" TIMESTAMP(3),
ADD COLUMN     "ratedById" INTEGER,
ADD COLUMN     "rating" TEXT,
ADD COLUMN     "taskType" TEXT NOT NULL DEFAULT 'ADHOC';

-- CreateTable
CREATE TABLE "WorkItemDepartment" (
    "workItemId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,

    CONSTRAINT "WorkItemDepartment_pkey" PRIMARY KEY ("workItemId","departmentId")
);

-- CreateTable
CREATE TABLE "ProgressReport" (
    "id" SERIAL NOT NULL,
    "workItemId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "difficulties" TEXT NOT NULL DEFAULT '',
    "proposals" TEXT NOT NULL DEFAULT '',
    "answer" TEXT,
    "answeredById" INTEGER,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DueExtension" (
    "id" SERIAL NOT NULL,
    "workItemId" INTEGER NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "oldDue" TIMESTAMP(3),
    "newDue" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DueExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemDocument" (
    "id" SERIAL NOT NULL,
    "workItemId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issuedOn" TIMESTAMP(3),
    "summary" TEXT NOT NULL,
    "issuer" TEXT,
    "url" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delegation" (
    "id" SERIAL NOT NULL,
    "fromUserId" INTEGER NOT NULL,
    "toUserId" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Delegation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkItemDepartment_departmentId_idx" ON "WorkItemDepartment"("departmentId");

-- CreateIndex
CREATE INDEX "ProgressReport_workItemId_createdAt_idx" ON "ProgressReport"("workItemId", "createdAt");

-- CreateIndex
CREATE INDEX "DueExtension_workItemId_status_idx" ON "DueExtension"("workItemId", "status");

-- CreateIndex
CREATE INDEX "WorkItemDocument_workItemId_idx" ON "WorkItemDocument"("workItemId");

-- CreateIndex
CREATE INDEX "WorkItemDocument_number_idx" ON "WorkItemDocument"("number");

-- CreateIndex
CREATE INDEX "Delegation_toUserId_endsAt_idx" ON "Delegation"("toUserId", "endsAt");

-- CreateIndex
CREATE INDEX "Delegation_fromUserId_idx" ON "Delegation"("fromUserId");

-- CreateIndex
CREATE INDEX "WorkItem_leadDepartmentId_idx" ON "WorkItem"("leadDepartmentId");

-- AddForeignKey
ALTER TABLE "WorkItemDepartment" ADD CONSTRAINT "WorkItemDepartment_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressReport" ADD CONSTRAINT "ProgressReport_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DueExtension" ADD CONSTRAINT "DueExtension_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemDocument" ADD CONSTRAINT "WorkItemDocument_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Dữ liệu cũ: việc đến từ Kế hoạch năm → loại PLAN; hạn hiện tại = hạn gốc.
UPDATE "WorkItem" SET "taskType" = 'PLAN' WHERE "planId" IS NOT NULL OR "source" = 'Kế hoạch năm';
UPDATE "WorkItem" SET "originalDueDate" = "dueDate" WHERE "dueDate" IS NOT NULL;
