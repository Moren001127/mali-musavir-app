-- Boyut B (job affinity) + C (priority) + D (scheduled jobs)
-- Sağlık paneli + akıllı routing + cron destekli zamanlanmış Luca işleri.

-- B + C: LucaFetchJob'a preferredAgent ve priority ekle
ALTER TABLE "luca_fetch_jobs"
  ADD COLUMN IF NOT EXISTS "preferredAgent" TEXT;

ALTER TABLE "luca_fetch_jobs"
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0;

-- Priority + status birlikte sorgulanacak (orderBy priority desc, createdAt asc)
CREATE INDEX IF NOT EXISTS "luca_fetch_jobs_tenantId_status_priority_idx"
  ON "luca_fetch_jobs"("tenantId", "status", "priority");

-- D: ScheduledLucaJob — cron destekli zamanlanmış işler
CREATE TABLE IF NOT EXISTS "scheduled_luca_jobs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "cron" TEXT NOT NULL,
  "jobTip" TEXT NOT NULL,
  "mukellefIds" TEXT[] NOT NULL DEFAULT '{}',
  "options" JSONB,
  "preferredAgent" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "lastRunAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "scheduled_luca_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scheduled_luca_jobs_tenantId_active_nextRunAt_idx"
  ON "scheduled_luca_jobs"("tenantId", "active", "nextRunAt");
