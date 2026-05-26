CREATE TABLE "bot_quality_logs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "taxpayerId" TEXT,
  "conversationId" TEXT,
  "messageId" TEXT,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "intent" TEXT,
  "reasons" JSONB NOT NULL DEFAULT '[]',
  "originalReply" TEXT,
  "finalReply" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
  "evalModel" TEXT,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "scenarioKey" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bot_quality_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bot_quality_feedback" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "qualityLogId" TEXT,
  "conversationId" TEXT,
  "messageId" TEXT,
  "rating" TEXT NOT NULL,
  "reason" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bot_quality_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bot_quality_logs_tenantId_createdAt_idx"
  ON "bot_quality_logs"("tenantId", "createdAt");

CREATE INDEX "bot_quality_logs_tenantId_status_idx"
  ON "bot_quality_logs"("tenantId", "status");

CREATE INDEX "bot_quality_logs_tenantId_source_createdAt_idx"
  ON "bot_quality_logs"("tenantId", "source", "createdAt");

CREATE INDEX "bot_quality_feedback_tenantId_createdAt_idx"
  ON "bot_quality_feedback"("tenantId", "createdAt");

CREATE INDEX "bot_quality_feedback_tenantId_qualityLogId_idx"
  ON "bot_quality_feedback"("tenantId", "qualityLogId");
