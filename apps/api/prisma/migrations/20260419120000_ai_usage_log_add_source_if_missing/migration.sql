-- Add source column to ai_usage_logs if it doesn't exist
-- Fix for: PrismaClientKnownRequestError — column `ai_usage_logs.source` does not exist
-- Root cause: initial migration was edited retroactively to include `source`,
-- but production DB was already created without it.

ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'mihsap-fatura';

-- Recreate the composite index (safe if it already exists)
CREATE INDEX IF NOT EXISTS "ai_usage_logs_tenantId_source_createdAt_idx" ON "ai_usage_logs"("tenantId", "source", "createdAt");
