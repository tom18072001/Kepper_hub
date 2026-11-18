-- Văn thư (QyĐ-GA-01): sổ văn bản đến / đi / nội bộ
CREATE TABLE "DocRecord" (
    "id" SERIAL NOT NULL,
    "book" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "docType" TEXT,
    "title" TEXT NOT NULL,
    "counterpart" TEXT,
    "externalNumber" TEXT,
    "docDate" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "security" TEXT NOT NULL DEFAULT 'NOI_BO',
    "urgency" TEXT NOT NULL DEFAULT 'THUONG',
    "dueDate" TEXT,
    "status" TEXT NOT NULL,
    "handlerId" INTEGER,
    "departmentId" INTEGER,
    "signerName" TEXT,
    "channel" TEXT,
    "trackingCode" TEXT,
    "toLegal" BOOLEAN NOT NULL DEFAULT false,
    "viewerIds" INTEGER[],
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledById" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DocRecord_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DocEvent" (
    "id" SERIAL NOT NULL,
    "docId" INTEGER NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocRecord_series_entity_year_seq_key" ON "DocRecord"("series", "entity", "year", "seq");
CREATE UNIQUE INDEX "DocRecord_number_key" ON "DocRecord"("number");
CREATE INDEX "DocRecord_book_year_idx" ON "DocRecord"("book", "year");
CREATE INDEX "DocRecord_handlerId_idx" ON "DocRecord"("handlerId");
CREATE INDEX "DocRecord_dueDate_idx" ON "DocRecord"("dueDate");
CREATE INDEX "DocEvent_docId_idx" ON "DocEvent"("docId");
ALTER TABLE "DocEvent" ADD CONSTRAINT "DocEvent_docId_fkey" FOREIGN KEY ("docId") REFERENCES "DocRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
