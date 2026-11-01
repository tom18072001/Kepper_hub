-- Kepper GĐ2b: Báo cáo tuần bộ phận (BM-TH-01) và thông báo nộp muộn / vắng giao ban.
CREATE TABLE "WeeklyReport" (
    "id" SERIAL NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "week" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "preparerId" INTEGER,
    "firstSubmittedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "submittedById" INTEGER,
    "submitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WeeklyReport_departmentId_week_key" ON "WeeklyReport"("departmentId", "week");
CREATE INDEX "WeeklyReport_week_idx" ON "WeeklyReport"("week");

CREATE TABLE "WeeklyNotice" (
    "id" SERIAL NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "week" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "expectedAt" TIMESTAMP(3),
    "substituteId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyNotice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WeeklyNotice_week_departmentId_idx" ON "WeeklyNotice"("week", "departmentId");
CREATE INDEX "WeeklyNotice_createdAt_idx" ON "WeeklyNotice"("createdAt");

CREATE TABLE "WeeklyMeeting" (
    "id" SERIAL NOT NULL,
    "week" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WeeklyMeeting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WeeklyMeeting_week_key" ON "WeeklyMeeting"("week");
