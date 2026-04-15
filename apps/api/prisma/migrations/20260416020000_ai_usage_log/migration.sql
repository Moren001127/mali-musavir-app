-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'mihsap-fatura',
    "mukellef" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "karar" TEXT,
    "sebep" VARCHAR(200),
    "belgeNo" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_logs_tenantId_createdAt_idx" ON "ai_usage_logs"("tenantId", "createdAt");
CREATE INDEX "ai_usage_logs_tenantId_karar_idx" ON "ai_usage_logs"("tenantId", "karar");
CREATE INDEX "ai_usage_logs_tenantId_source_createdAt_idx" ON "ai_usage_logs"("tenantId", "source", "createdAt");
CREATE INDEX "ai_usage_logs_tenantId_mukellef_createdAt_idx" ON "ai_usage_logs"("tenantId", "mukellef", "createdAt");

-- CreateTable
CREATE TABLE "ai_credit_topups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedBy" TEXT,

    CONSTRAINT "ai_credit_topups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_credit_topups_tenantId_addedAt_idx" ON "ai_credit_topups"("tenantId", "addedAt");
