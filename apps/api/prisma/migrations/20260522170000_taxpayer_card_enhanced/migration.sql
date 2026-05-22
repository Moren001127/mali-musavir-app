-- v1.37.0: Mükellef kartını Hattat tarzı genişletme
-- Yeni Taxpayer alanları + TaxpayerYetkili tablosu

-- ============================================================
-- 1) Taxpayer yeni alanları (tamamı opsiyonel — geriye uyumlu)
-- ============================================================
ALTER TABLE "taxpayers" ADD COLUMN     "logoUrl" TEXT;
ALTER TABLE "taxpayers" ADD COLUMN     "naceKodu" TEXT;
ALTER TABLE "taxpayers" ADD COLUMN     "ticaretSicilNo" TEXT;
ALTER TABLE "taxpayers" ADD COLUMN     "mersisNo" TEXT;
ALTER TABLE "taxpayers" ADD COLUMN     "odaSicilNo" TEXT;
ALTER TABLE "taxpayers" ADD COLUMN     "bagkurSicilNo" TEXT;
ALTER TABLE "taxpayers" ADD COLUMN     "kepAdresi" TEXT;
ALTER TABLE "taxpayers" ADD COLUMN     "webSitesi" TEXT;
ALTER TABLE "taxpayers" ADD COLUMN     "eFaturaEntegrator" TEXT;

-- ============================================================
-- 2) TaxpayerYetkili tablosu — firma yetkilileri / ortaklar
-- ============================================================
CREATE TABLE "taxpayer_yetkililer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "tcNo" TEXT,
    "gorev" TEXT,
    "telefon" TEXT,
    "eposta" TEXT,
    "notes" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taxpayer_yetkililer_pkey" PRIMARY KEY ("id")
);

-- Indexler
CREATE INDEX "taxpayer_yetkililer_tenantId_idx" ON "taxpayer_yetkililer"("tenantId");
CREATE INDEX "taxpayer_yetkililer_taxpayerId_idx" ON "taxpayer_yetkililer"("taxpayerId");

-- Foreign key'ler
ALTER TABLE "taxpayer_yetkililer"
  ADD CONSTRAINT "taxpayer_yetkililer_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "taxpayer_yetkililer"
  ADD CONSTRAINT "taxpayer_yetkililer_taxpayerId_fkey"
  FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
