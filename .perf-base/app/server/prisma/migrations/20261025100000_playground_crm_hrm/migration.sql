-- CreateTable
CREATE TABLE "CrmPartner" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "taxCode" TEXT,
    "address" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ownerDepartmentId" INTEGER NOT NULL,
    "ownerUserId" INTEGER,
    "rating" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "CrmPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" SERIAL NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "title" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmInteraction" (
    "id" SERIAL NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "nextStep" TEXT,
    "nextDue" TIMESTAMP(3),
    "nextOwnerId" INTEGER,
    "followUpDone" BOOLEAN NOT NULL DEFAULT false,
    "workItemId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmEngagement" (
    "id" SERIAL NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "signedAt" TIMESTAMP(3),
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "projectId" INTEGER,
    "workItemId" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrProfile" (
    "userId" INTEGER NOT NULL,
    "employeeCode" TEXT,
    "birthDate" TIMESTAMP(3),
    "gender" TEXT,
    "phone" TEXT,
    "personalEmail" TEXT,
    "address" TEXT,
    "idNumberEnc" TEXT,
    "idNumberLast4" TEXT,
    "idIssuedOn" TIMESTAMP(3),
    "idIssuedPlace" TEXT,
    "startDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OFFICIAL',
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "education" TEXT,
    "updatedById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "HrContract" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "salaryEnc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "signedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrLeave" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "departmentId" INTEGER,
    "type" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "halfDay" TEXT NOT NULL DEFAULT 'NONE',
    "days" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approverId" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrLeave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAttendance" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "departmentId" INTEGER,
    "day" TEXT NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "inIp" TEXT,
    "outIp" TEXT,
    "minutesLate" INTEGER NOT NULL DEFAULT 0,
    "minutesEarly" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "adjustStatus" TEXT,
    "adjustReason" TEXT,
    "adjustIn" TIMESTAMP(3),
    "adjustOut" TIMESTAMP(3),
    "adjustById" INTEGER,
    "adjustAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmPartner_ownerDepartmentId_idx" ON "CrmPartner"("ownerDepartmentId");

-- CreateIndex
CREATE INDEX "CrmContact_partnerId_idx" ON "CrmContact"("partnerId");

-- CreateIndex
CREATE INDEX "CrmInteraction_partnerId_idx" ON "CrmInteraction"("partnerId");

-- CreateIndex
CREATE INDEX "CrmInteraction_nextOwnerId_followUpDone_idx" ON "CrmInteraction"("nextOwnerId", "followUpDone");

-- CreateIndex
CREATE INDEX "CrmEngagement_partnerId_idx" ON "CrmEngagement"("partnerId");

-- CreateIndex
CREATE INDEX "HrContract_userId_idx" ON "HrContract"("userId");

-- CreateIndex
CREATE INDEX "HrLeave_userId_fromDate_idx" ON "HrLeave"("userId", "fromDate");

-- CreateIndex
CREATE INDEX "HrLeave_departmentId_status_idx" ON "HrLeave"("departmentId", "status");

-- CreateIndex
CREATE INDEX "HrAttendance_departmentId_day_idx" ON "HrAttendance"("departmentId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "HrAttendance_userId_day_key" ON "HrAttendance"("userId", "day");

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "CrmPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "CrmPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEngagement" ADD CONSTRAINT "CrmEngagement_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "CrmPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

