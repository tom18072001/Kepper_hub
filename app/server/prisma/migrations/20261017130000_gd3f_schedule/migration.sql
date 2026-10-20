-- CreateTable
CREATE TABLE "ScheduleEvent" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "endDate" DATE,
    "timeText" TEXT NOT NULL DEFAULT '',
    "startMin" INTEGER,
    "title" TEXT NOT NULL,
    "participantsText" TEXT NOT NULL DEFAULT '',
    "chairText" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "departmentId" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'EVENT',
    "away" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleParticipant" (
    "eventId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "ScheduleParticipant_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateIndex
CREATE INDEX "ScheduleEvent_date_idx" ON "ScheduleEvent"("date");

-- CreateIndex
CREATE INDEX "ScheduleEvent_departmentId_date_idx" ON "ScheduleEvent"("departmentId", "date");

-- CreateIndex
CREATE INDEX "ScheduleParticipant_userId_idx" ON "ScheduleParticipant"("userId");

-- AddForeignKey
ALTER TABLE "ScheduleParticipant" ADD CONSTRAINT "ScheduleParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ScheduleEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleParticipant" ADD CONSTRAINT "ScheduleParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

