-- Kepper GĐ1: dự án theo Master Timeline, hạng mục MTL (đường găng, mốc, kế hoạch gốc), cảnh báo, ảnh chụp tiến độ, Viber.
ALTER TABLE "Project" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'BOARD', ADD COLUMN "t0Date" TIMESTAMP(3), ADD COLUMN "alertConfig" JSONB;
ALTER TABLE "WorkItem" ADD COLUMN "critical" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "milestone" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "milestoneNote" TEXT, ADD COLUMN "ownerText" TEXT NOT NULL DEFAULT '', ADD COLUMN "externalParty" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "startT" DOUBLE PRECISION, ADD COLUMN "endT" DOUBLE PRECISION, ADD COLUMN "baselineStart" TIMESTAMP(3), ADD COLUMN "baselineEnd" TIMESTAMP(3),
  ADD COLUMN "forecastEnd" TIMESTAMP(3), ADD COLUMN "weight" DOUBLE PRECISION, ADD COLUMN "progressAt" TIMESTAMP(3);
ALTER TABLE "Plan" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ANNUAL', ADD COLUMN "departmentId" INTEGER, ADD COLUMN "sheetName" TEXT, ADD COLUMN "fileHash" TEXT;

CREATE TABLE "ProgressAlert" (
  "id" SERIAL PRIMARY KEY, "projectId" INTEGER NOT NULL, "workItemId" INTEGER NOT NULL, "kind" TEXT NOT NULL, "level" TEXT NOT NULL,
  "day" DATE NOT NULL, "variance" DOUBLE PRECISION, "lateDays" INTEGER, "recipients" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgressAlert_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProgressAlert_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "ProgressAlert_workItemId_kind_day_key" ON "ProgressAlert"("workItemId", "kind", "day");
CREATE INDEX "ProgressAlert_projectId_day_idx" ON "ProgressAlert"("projectId", "day");
CREATE INDEX "ProgressAlert_workItemId_kind_createdAt_idx" ON "ProgressAlert"("workItemId", "kind", "createdAt");

CREATE TABLE "ProgressSnapshot" (
  "id" SERIAL PRIMARY KEY, "projectId" INTEGER NOT NULL, "departmentId" INTEGER, "day" DATE NOT NULL,
  "plannedPct" DOUBLE PRECISION NOT NULL, "actualPct" DOUBLE PRECISION NOT NULL, "spi" DOUBLE PRECISION,
  CONSTRAINT "ProgressSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "ProgressSnapshot_projectId_departmentId_day_key" ON "ProgressSnapshot"("projectId", "departmentId", "day");
CREATE INDEX "ProgressSnapshot_projectId_day_idx" ON "ProgressSnapshot"("projectId", "day");

CREATE TABLE "ViberLink" (
  "id" SERIAL PRIMARY KEY, "userId" INTEGER NOT NULL, "viberId" TEXT, "code" TEXT, "codeExpiresAt" TIMESTAMP(3),
  "consentAt" TIMESTAMP(3), "linkedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "ViberLink_userId_key" ON "ViberLink"("userId");
CREATE UNIQUE INDEX "ViberLink_viberId_key" ON "ViberLink"("viberId");
CREATE UNIQUE INDEX "ViberLink_code_key" ON "ViberLink"("code");
