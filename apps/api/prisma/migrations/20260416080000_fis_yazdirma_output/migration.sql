-- CreateTable
CREATE TABLE "fis_yazdirma_outputs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mukellefId" TEXT,
    "mukellefName" TEXT,
    "donem" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "pagesPerSheet" INTEGER,
    "filename" TEXT NOT NULL,
    "fileBytes" BYTEA NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fis_yazdirma_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fis_yazdirma_outputs_tenantId_createdAt_idx" ON "fis_yazdirma_outputs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "fis_yazdirma_outputs_tenantId_mukellefId_donem_idx" ON "fis_yazdirma_outputs"("tenantId", "mukellefId", "donem");
