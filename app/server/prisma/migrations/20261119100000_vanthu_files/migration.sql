-- Văn thư: tệp văn bản (bản scan, phụ lục) — bản gốc trên NAS, thư mục VanBanDen / VanBanDi / VanBanNoiBo của phòng
CREATE TABLE "DocFile" (
    "id" SERIAL NOT NULL,
    "docId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocFile_docId_idx" ON "DocFile"("docId");
ALTER TABLE "DocFile" ADD CONSTRAINT "DocFile_docId_fkey" FOREIGN KEY ("docId") REFERENCES "DocRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
