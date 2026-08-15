-- Butce modulu genislemesi:
--   1) Banka hesaplari + KMH takibi
--   2) Defter ayrimi (SAHSI / OFIS) — ayni kart/hesap her iki defter icin kullanilabilir,
--      ayrim HAREKET duzeyindedir
--   3) Hesaplar/defterler arasi aktarim (transferGrupId)
--   4) Ekstre satiri <-> islem bagi (elle girilen kayitla cakismayi cozmek icin)

-- ===== 1) Banka hesaplari =====
CREATE TABLE IF NOT EXISTS "butce_banka_hesaplar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "varsayilanDefter" TEXT NOT NULL DEFAULT 'SAHSI',
    "ad" TEXT NOT NULL,
    "bankaAdi" TEXT NOT NULL,
    "iban4" TEXT,
    "tur" TEXT NOT NULL DEFAULT 'VADESIZ',
    "acilisBakiye" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "acilisTarihi" TIMESTAMP(3),
    "kmhLimiti" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "kmhAylikFaiz" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "renk" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "sira" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "butce_banka_hesaplar_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "butce_banka_hesaplar_tenantId_userId_aktif_idx" ON "butce_banka_hesaplar"("tenantId", "userId", "aktif");

-- ===== 2) Islem: banka hesabi, defter, transfer, ekstre bagi =====
ALTER TABLE "butce_islemler" ADD COLUMN IF NOT EXISTS "bankaHesapId" TEXT;
ALTER TABLE "butce_islemler" ADD COLUMN IF NOT EXISTS "defter" TEXT NOT NULL DEFAULT 'SAHSI';
ALTER TABLE "butce_islemler" ADD COLUMN IF NOT EXISTS "transferGrupId" TEXT;
ALTER TABLE "butce_islemler" ADD COLUMN IF NOT EXISTS "kartHareketId" TEXT;
CREATE INDEX IF NOT EXISTS "butce_islemler_tenantId_userId_defter_donem_idx" ON "butce_islemler"("tenantId", "userId", "defter", "donem");

-- ===== 3) Odeme: hangi hesaptan cikti =====
ALTER TABLE "butce_odemeler" ADD COLUMN IF NOT EXISTS "bankaHesapId" TEXT;

-- ===== 4) Defter alanlari =====
ALTER TABLE "butce_kategoriler" ADD COLUMN IF NOT EXISTS "defter" TEXT NOT NULL DEFAULT 'SAHSI';
ALTER TABLE "butce_duzenli_odemeler" ADD COLUMN IF NOT EXISTS "defter" TEXT NOT NULL DEFAULT 'SAHSI';
ALTER TABLE "butce_borclar" ADD COLUMN IF NOT EXISTS "defter" TEXT NOT NULL DEFAULT 'SAHSI';
ALTER TABLE "butce_kartlar" ADD COLUMN IF NOT EXISTS "varsayilanDefter" TEXT NOT NULL DEFAULT 'SAHSI';
ALTER TABLE "butce_kart_hareketler" ADD COLUMN IF NOT EXISTS "defter" TEXT NOT NULL DEFAULT 'SAHSI';
ALTER TABLE "butce_satici_hafiza" ADD COLUMN IF NOT EXISTS "defter" TEXT NOT NULL DEFAULT 'SAHSI';

-- Kategori benzersizligi artik defteri de kapsar (ayni ad iki defterde olabilir: "Kira" ofis + sahsi)
DROP INDEX IF EXISTS "butce_kategoriler_tenantId_userId_tur_ad_key";
CREATE UNIQUE INDEX IF NOT EXISTS "butce_kategoriler_tenantId_userId_defter_tur_ad_key" ON "butce_kategoriler"("tenantId", "userId", "defter", "tur", "ad");
DROP INDEX IF EXISTS "butce_kategoriler_tenantId_userId_idx";
CREATE INDEX IF NOT EXISTS "butce_kategoriler_tenantId_userId_defter_idx" ON "butce_kategoriler"("tenantId", "userId", "defter");

-- ===== 5) Yabanci anahtarlar =====
ALTER TABLE "butce_islemler" DROP CONSTRAINT IF EXISTS "butce_islemler_bankaHesapId_fkey";
ALTER TABLE "butce_islemler" ADD CONSTRAINT "butce_islemler_bankaHesapId_fkey" FOREIGN KEY ("bankaHesapId") REFERENCES "butce_banka_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "butce_odemeler" DROP CONSTRAINT IF EXISTS "butce_odemeler_bankaHesapId_fkey";
ALTER TABLE "butce_odemeler" ADD CONSTRAINT "butce_odemeler_bankaHesapId_fkey" FOREIGN KEY ("bankaHesapId") REFERENCES "butce_banka_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
