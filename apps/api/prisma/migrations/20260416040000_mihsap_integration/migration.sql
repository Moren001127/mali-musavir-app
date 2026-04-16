-- CreateTable: MIHSAP oturum token'ı (eklenti tarafından senkronize edilir)
CREATE TABLE "mihsap_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mihsap_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mihsap_sessions_tenantId_key" ON "mihsap_sessions"("tenantId");

-- CreateTable: MIHSAP faturalar metadata
CREATE TABLE "mihsap_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mukellefId" TEXT NOT NULL,
    "mukellefMihsapId" TEXT NOT NULL,
    "donem" TEXT NOT NULL,
    "faturaTuru" TEXT NOT NULL,
    "belgeTuru" TEXT NOT NULL,
    "faturaNo" TEXT NOT NULL,
    "firmaKimlikNo" TEXT,
    "firmaUnvan" TEXT,
    "faturaTarihi" TIMESTAMP(3) NOT NULL,
    "toplamTutar" DOUBLE PRECISION NOT NULL,
    "onayDurumu" TEXT,
    "mihsapId" TEXT NOT NULL,
    "mihsapFileId" TEXT,
    "mihsapFaturaId" TEXT,
    "orjDosyaTuru" TEXT,
    "storageKey" TEXT,
    "storageUrl" TEXT,
    "mihsapFileLink" TEXT,
    "downloadedAt" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mihsap_invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mihsap_invoices_mihsapId_key" ON "mihsap_invoices"("mihsapId");
CREATE INDEX "mihsap_invoices_tenantId_mukellefId_donem_idx" ON "mihsap_invoices"("tenantId", "mukellefId", "donem");
CREATE INDEX "mihsap_invoices_tenantId_donem_faturaTuru_idx" ON "mihsap_invoices"("tenantId", "donem", "faturaTuru");
CREATE INDEX "mihsap_invoices_tenantId_firmaKimlikNo_idx" ON "mihsap_invoices"("tenantId", "firmaKimlikNo");

-- CreateTable: Toplu çekme job'ları
CREATE TABLE "mihsap_fetch_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mukellefId" TEXT NOT NULL,
    "donem" TEXT NOT NULL,
    "faturaTuru" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMsg" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "mihsap_fetch_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "mihsap_fetch_jobs_tenantId_createdAt_idx" ON "mihsap_fetch_jobs"("tenantId", "createdAt");
CREATE INDEX "mihsap_fetch_jobs_tenantId_status_idx" ON "mihsap_fetch_jobs"("tenantId", "status");
