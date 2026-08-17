-- Cari Kasa <-> Kisisel Butce hesap koprusu.
--
-- Ayni banka hesabi bugun iki tabloda ayri bakiye tutuyor:
--   office_financial_accounts (Cari Kasa) ve butce_banka_hesaplar (Kisisel Butce).
-- Kolon doldurulunca bakiyenin tek sahibi Kisisel Butce olur; ofis hesabi
-- "para hangi cuzdana girdi" etiketine doner. Eslestirme ELLE yapilir,
-- isim benzerligiyle otomatik eslestirme YOKTUR.
ALTER TABLE "office_financial_accounts" ADD COLUMN IF NOT EXISTS "butceBankaHesapId" TEXT;

CREATE INDEX IF NOT EXISTS "office_financial_accounts_butceBankaHesapId_idx"
  ON "office_financial_accounts"("butceBankaHesapId");

ALTER TABLE "office_financial_accounts" DROP CONSTRAINT IF EXISTS "office_financial_accounts_butceBankaHesapId_fkey";
ALTER TABLE "office_financial_accounts" ADD CONSTRAINT "office_financial_accounts_butceBankaHesapId_fkey"
  FOREIGN KEY ("butceBankaHesapId") REFERENCES "butce_banka_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
