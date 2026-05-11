-- Luca portal CAPTCHA challenge bridge and device-aware Luca jobs
CREATE TABLE IF NOT EXISTS "luca_captcha_challenges" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jobId" TEXT,
  "deviceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "captchaImage" TEXT NOT NULL,
  "answer" TEXT,
  "context" JSONB,
  "requestedBy" TEXT,
  "answeredBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "answeredAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "luca_captcha_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "luca_captcha_challenges_tenantId_status_createdAt_idx"
  ON "luca_captcha_challenges"("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "luca_captcha_challenges_tenantId_deviceId_status_idx"
  ON "luca_captcha_challenges"("tenantId", "deviceId", "status");
CREATE INDEX IF NOT EXISTS "luca_captcha_challenges_jobId_idx"
  ON "luca_captcha_challenges"("jobId");

ALTER TABLE "luca_fetch_jobs"
  ADD COLUMN IF NOT EXISTS "targetDeviceId" TEXT;

CREATE INDEX IF NOT EXISTS "luca_fetch_jobs_tenantId_targetDeviceId_status_idx"
  ON "luca_fetch_jobs"("tenantId", "targetDeviceId", "status");
