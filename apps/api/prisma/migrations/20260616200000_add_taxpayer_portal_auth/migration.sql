-- Mükellef self-servis portal girişi (opsiyonel; müşavir açar).
-- Additive/nullable veya sabit default → mevcut satırlar etkilenmez, PG'de hızlı.
ALTER TABLE "taxpayers" ADD COLUMN "portalEmail" TEXT;
ALTER TABLE "taxpayers" ADD COLUMN "portalPasswordHash" TEXT;
ALTER TABLE "taxpayers" ADD COLUMN "portalEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "taxpayers" ADD COLUMN "portalLastLoginAt" TIMESTAMP(3);
