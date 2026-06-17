-- Mükellef portal girişi brute-force koruması
ALTER TABLE "taxpayers" ADD COLUMN IF NOT EXISTS "portalFailedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "taxpayers" ADD COLUMN IF NOT EXISTS "portalLockedUntil" TIMESTAMP(3);
