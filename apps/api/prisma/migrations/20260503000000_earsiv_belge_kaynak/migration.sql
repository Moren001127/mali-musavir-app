-- E-Arşiv/E-Fatura ayrımı için belgeKaynak alanı ekle.
-- Mükellefin e-fatura mükellefi olup olmamasına göre Luca'dan iki farklı tab çekilir:
--   EFATURA: e-fatura mükellefleri arası gelen/giden e-fatura
--   EARSIV : kamuya kesilen e-arşiv ya da e-arşiv mükellefinden gelen
-- Default EARSIV — geriye dönük uyumluluk.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BelgeKaynak') THEN
    CREATE TYPE "BelgeKaynak" AS ENUM ('EFATURA', 'EARSIV');
  END IF;
END$$;

ALTER TABLE "earsiv_faturalar"
  ADD COLUMN IF NOT EXISTS "belgeKaynak" "BelgeKaynak" NOT NULL DEFAULT 'EARSIV';

-- Eski unique constraint'i kaldır (yeni belgeKaynak'ı dahil eden ile değiştir)
ALTER TABLE "earsiv_faturalar"
  DROP CONSTRAINT IF EXISTS "earsiv_faturalar_tenantId_taxpayerId_tip_faturaNo_key";

-- Yeni unique: aynı belge no aynı belgeKaynak'ta mükerrer olamaz
ALTER TABLE "earsiv_faturalar"
  ADD CONSTRAINT "earsiv_faturalar_tenantId_taxpayerId_tip_belgeKaynak_faturaNo_key"
  UNIQUE ("tenantId", "taxpayerId", "tip", "belgeKaynak", "faturaNo");

-- Eski index drop, yeni index (belgeKaynak dahil)
DROP INDEX IF EXISTS "earsiv_faturalar_tenantId_taxpayerId_donem_tip_idx";
CREATE INDEX IF NOT EXISTS "earsiv_faturalar_tenantId_taxpayerId_donem_tip_belgeKaynak_idx"
  ON "earsiv_faturalar"("tenantId", "taxpayerId", "donem", "tip", "belgeKaynak");
