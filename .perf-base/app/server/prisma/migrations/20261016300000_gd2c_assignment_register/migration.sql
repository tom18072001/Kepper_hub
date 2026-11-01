-- GĐ2c: Sổ theo dõi, kiểm soát giao việc (người giao, ngày giao, nguồn, tiến độ, sản phẩm, đánh giá, phối hợp), Kế hoạch công tác năm, danh mục, mẫu nhóm việc, quyền Tổng hợp. Chỉ thêm cột/bảng, không mất dữ liệu.
-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedById" INTEGER,
ADD COLUMN     "budget" DOUBLE PRECISION,
ADD COLUMN     "coordinatorText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "deliverable" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "location" TEXT,
ADD COLUMN     "note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "outputs" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "period" TEXT,
ADD COLUMN     "planCode" TEXT,
ADD COLUMN     "planId" INTEGER,
ADD COLUMN     "planSection" TEXT,
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refCode" TEXT,
ADD COLUMN     "resultNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "review" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" INTEGER,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "supervisorText" TEXT;

-- CreateTable
CREATE TABLE "WorkItemSupporter" (
    "workItemId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "WorkItemSupporter_pkey" PRIMARY KEY ("workItemId","userId")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "fileName" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkItemSupporter_userId_idx" ON "WorkItemSupporter"("userId");

-- CreateIndex
CREATE INDEX "Plan_projectId_idx" ON "Plan"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTemplate_name_key" ON "TaskTemplate"("name");

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemSupporter" ADD CONSTRAINT "WorkItemSupporter_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemSupporter" ADD CONSTRAINT "WorkItemSupporter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Dữ liệu cũ: người giao = người tạo, ngày giao = ngày tạo; việc đã xong có tiến độ 100%.
UPDATE "WorkItem" SET "assignedById" = "reporterId", "assignedAt" = "createdAt";
UPDATE "WorkItem" w SET "progress" = 100 FROM "WorkflowState" s WHERE s."id" = w."stateId" AND s."category" = 'COMPLETED';

-- Quyền mới "Xem tổng hợp giao việc": Ban giám đốc toàn đơn vị, Trưởng phòng phòng mình.
INSERT INTO "UserPermission" ("userId", "permissionKey", "action", "scope", "source")
SELECT "id", 'reports.summary', 'VIEW', 'SYSTEM', 'ROLE_PROFILE' FROM "User" WHERE "role" = 'director' AND "isRootAdmin" = false
ON CONFLICT ("userId", "permissionKey", "action") DO NOTHING;
INSERT INTO "UserPermission" ("userId", "permissionKey", "action", "scope", "source")
SELECT "id", 'reports.summary', 'VIEW', 'UNIT', 'ROLE_PROFILE' FROM "User" WHERE "role" = 'manager' AND "isRootAdmin" = false
ON CONFLICT ("userId", "permissionKey", "action") DO NOTHING;
