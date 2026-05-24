ALTER TABLE "receipt_images"
  ADD COLUMN "contentAuditStatus" TEXT,
  ADD COLUMN "contentAuditRisk" TEXT,
  ADD COLUMN "contentAuditSummary" TEXT,
  ADD COLUMN "contentAuditSuggestion" TEXT,
  ADD COLUMN "contentAuditFindings" JSONB,
  ADD COLUMN "contentAuditConfidence" DOUBLE PRECISION,
  ADD COLUMN "contentAuditModel" TEXT,
  ADD COLUMN "contentAuditCostUsd" DOUBLE PRECISION,
  ADD COLUMN "contentAuditCheckedAt" TIMESTAMP(3);

CREATE INDEX "receipt_images_sessionId_contentAuditStatus_idx"
  ON "receipt_images"("sessionId", "contentAuditStatus");
