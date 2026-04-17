-- Luca oturum + çekim tabloları

-- CreateTable
CREATE TABLE "luca_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "cookies" TEXT,
    "origin" TEXT,
    "email" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "luca_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "luca_sessions_tenantId_key" ON "luca_sessions"("tenantId");

-- CreateTable
CREATE TABLE "luca_fetch_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT,
    "mukellefId" TEXT NOT NULL,
    "donem" TEXT NOT NULL,
    "tip" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "errorMsg" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "luca_fetch_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "luca_fetch_jobs_tenantId_createdAt_idx" ON "luca_fetch_jobs"("tenantId", "createdAt");
CREATE INDEX "luca_fetch_jobs_tenantId_status_idx" ON "luca_fetch_jobs"("tenantId", "status");
CREATE INDEX "luca_fetch_jobs_sessionId_idx" ON "luca_fetch_jobs"("sessionId");

-- KDV Kontrol çıktı arşivi
CREATE TABLE "kdv_control_outputs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT,
    "taxpayerId" TEXT,
    "mukellefName" TEXT,
    "donem" TEXT,
    "tip" TEXT,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "partialCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "totalImages" INTEGER NOT NULL DEFAULT 0,
    "filename" TEXT NOT NULL,
    "fileBytes" BYTEA NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kdv_control_outputs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kdv_control_outputs_tenantId_createdAt_idx" ON "kdv_control_outputs"("tenantId", "createdAt");
CREATE INDEX "kdv_control_outputs_tenantId_taxpayerId_donem_idx" ON "kdv_control_outputs"("tenantId", "taxpayerId", "donem");
CREATE INDEX "kdv_control_outputs_sessionId_idx" ON "kdv_control_outputs"("sessionId");
