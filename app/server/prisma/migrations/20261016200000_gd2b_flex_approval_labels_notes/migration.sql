-- GĐ2b: duyệt linh hoạt (chọn tay + quy tắc tự động), nhãn theo dự án, ghi chú cá nhân, lặp lại theo ngày làm việc, thùng rác (xoá mềm 7 ngày), mốc khoá tài khoản, quyền KPI. Chỉ thêm cột/bảng, không mất dữ liệu.
-- DropIndex
DROP INDEX "Label_name_key";

-- AlterTable
ALTER TABLE "Label" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" INTEGER,
ADD COLUMN     "projectId" INTEGER;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "defaultApprovalLevels" INTEGER,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" INTEGER;

-- AlterTable
ALTER TABLE "RecurringRule" ADD COLUMN     "sourceItemId" INTEGER,
ADD COLUMN     "workdaysOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deactivatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "approvalLevels" INTEGER,
ADD COLUMN     "deletedById" INTEGER;

-- CreateTable
CREATE TABLE "PersonalNote" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "done" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TIMESTAMP(3),
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "convertedItemId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "PersonalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "labelId" INTEGER,
    "priority" TEXT,
    "levels" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalNote_userId_done_idx" ON "PersonalNote"("userId", "done");

-- CreateIndex
CREATE INDEX "ApprovalRule_projectId_idx" ON "ApprovalRule"("projectId");

-- CreateIndex
CREATE INDEX "Label_projectId_idx" ON "Label"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Label_projectId_name_key" ON "Label"("projectId", "name");

-- AddForeignKey
ALTER TABLE "Label" ADD CONSTRAINT "Label_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalNote" ADD CONSTRAINT "PersonalNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Nhãn chung (projectId NULL) vẫn không được trùng tên.
CREATE UNIQUE INDEX "Label_global_name_key" ON "Label"("name") WHERE "projectId" IS NULL;

-- Tài khoản đang khoá: lấy mốc khoá = thời điểm migration (để tính hạn xoá ghi chú 30 ngày).
UPDATE "User" SET "deactivatedAt" = CURRENT_TIMESTAMP WHERE "isActive" = false;

-- Quyền mới "Xem KPI" cho các tài khoản Ban giám đốc hiện có (giống profile khi tạo tài khoản mới).
INSERT INTO "UserPermission" ("userId", "permissionKey", "action", "scope", "source")
SELECT "id", 'reports.kpi', 'VIEW', 'SYSTEM', 'ROLE_PROFILE' FROM "User" WHERE "role" = 'director' AND "isRootAdmin" = false
ON CONFLICT ("userId", "permissionKey", "action") DO NOTHING;
