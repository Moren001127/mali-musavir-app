-- Kişisel Bütçe & Borç Yönetimi modülü (owner-only)

CREATE TABLE IF NOT EXISTS "butce_kategoriler" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ad" TEXT NOT NULL,
    "tur" TEXT NOT NULL,
    "renk" TEXT,
    "zorunlu" BOOLEAN NOT NULL DEFAULT false,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "sira" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "butce_kategoriler_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "butce_kategoriler_tenantId_userId_tur_ad_key" ON "butce_kategoriler"("tenantId", "userId", "tur", "ad");
CREATE INDEX IF NOT EXISTS "butce_kategoriler_tenantId_userId_idx" ON "butce_kategoriler"("tenantId", "userId");

CREATE TABLE IF NOT EXISTS "butce_kartlar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankaAdi" TEXT NOT NULL,
    "kartAdi" TEXT NOT NULL,
    "sonDortHane" TEXT,
    "kartLimiti" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "kesimGunu" INTEGER NOT NULL,
    "sonOdemeGunFarki" INTEGER NOT NULL DEFAULT 10,
    "asgariOran" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "aylikFaizOrani" DECIMAL(6,3) NOT NULL DEFAULT 4.25,
    "gecikmeFaizOrani" DECIMAL(6,3) NOT NULL DEFAULT 4.75,
    "renk" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "sira" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "butce_kartlar_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "butce_kartlar_tenantId_userId_aktif_idx" ON "butce_kartlar"("tenantId", "userId", "aktif");

CREATE TABLE IF NOT EXISTS "butce_duzenli_odemeler" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ad" TEXT NOT NULL,
    "tur" TEXT NOT NULL,
    "tutar" DECIMAL(14,2) NOT NULL,
    "kategoriId" TEXT,
    "ayinGunu" INTEGER NOT NULL DEFAULT 1,
    "baslangicDonem" TEXT NOT NULL,
    "bitisDonem" TEXT,
    "kaynak" TEXT NOT NULL DEFAULT 'NAKIT',
    "kartId" TEXT,
    "zorunlu" BOOLEAN NOT NULL DEFAULT true,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "sonUretilenDonem" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "butce_duzenli_odemeler_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "butce_duzenli_odemeler_tenantId_userId_aktif_idx" ON "butce_duzenli_odemeler"("tenantId", "userId", "aktif");

CREATE TABLE IF NOT EXISTS "butce_islemler" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tarih" TIMESTAMP(3) NOT NULL,
    "donem" TEXT NOT NULL,
    "tur" TEXT NOT NULL,
    "tutar" DECIMAL(14,2) NOT NULL,
    "kategoriId" TEXT,
    "aciklama" TEXT,
    "kaynak" TEXT NOT NULL DEFAULT 'NAKIT',
    "kartId" TEXT,
    "duzenliId" TEXT,
    "planlanan" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "butce_islemler_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "butce_islemler_tenantId_userId_donem_idx" ON "butce_islemler"("tenantId", "userId", "donem");
CREATE INDEX IF NOT EXISTS "butce_islemler_tenantId_userId_tur_tarih_idx" ON "butce_islemler"("tenantId", "userId", "tur", "tarih");

CREATE TABLE IF NOT EXISTS "butce_kart_ekstreler" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kartId" TEXT NOT NULL,
    "donem" TEXT NOT NULL,
    "kesimTarihi" TIMESTAMP(3) NOT NULL,
    "sonOdemeTarihi" TIMESTAMP(3) NOT NULL,
    "borcTutari" DECIMAL(14,2),
    "asgariTutar" DECIMAL(14,2),
    "odenenTutar" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "durum" TEXT NOT NULL DEFAULT 'TUTAR_BEKLENIYOR',
    "odemeTarihi" TIMESTAMP(3),
    "notlar" TEXT,
    "hatirlatmalar" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "butce_kart_ekstreler_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "butce_kart_ekstreler_tenantId_kartId_donem_key" ON "butce_kart_ekstreler"("tenantId", "kartId", "donem");
CREATE INDEX IF NOT EXISTS "butce_kart_ekstreler_tenantId_userId_sonOdemeTarihi_idx" ON "butce_kart_ekstreler"("tenantId", "userId", "sonOdemeTarihi");

CREATE TABLE IF NOT EXISTS "butce_borclar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ad" TEXT NOT NULL,
    "tur" TEXT NOT NULL,
    "kurum" TEXT,
    "toplamTutar" DECIMAL(14,2) NOT NULL,
    "kalanAnapara" DECIMAL(14,2) NOT NULL,
    "yillikFaiz" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "taksitTutari" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "toplamTaksit" INTEGER NOT NULL DEFAULT 0,
    "odenenTaksit" INTEGER NOT NULL DEFAULT 0,
    "odemeGunu" INTEGER NOT NULL DEFAULT 1,
    "baslangicTarihi" TIMESTAMP(3),
    "bitisTarihi" TIMESTAMP(3),
    "erkenKapamaCezasi" DECIMAL(6,3),
    "durum" TEXT NOT NULL DEFAULT 'AKTIF',
    "notlar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "butce_borclar_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "butce_borclar_tenantId_userId_durum_idx" ON "butce_borclar"("tenantId", "userId", "durum");

CREATE TABLE IF NOT EXISTS "butce_odemeler" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tarih" TIMESTAMP(3) NOT NULL,
    "donem" TEXT NOT NULL,
    "tutar" DECIMAL(14,2) NOT NULL,
    "hedefTur" TEXT NOT NULL,
    "borcId" TEXT,
    "kartEkstreId" TEXT,
    "tip" TEXT NOT NULL DEFAULT 'NORMAL',
    "aciklama" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "butce_odemeler_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "butce_odemeler_tenantId_userId_donem_idx" ON "butce_odemeler"("tenantId", "userId", "donem");

CREATE TABLE IF NOT EXISTS "butce_ayarlar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nakitYastigi" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "strateji" TEXT NOT NULL DEFAULT 'CIG',
    "hatirlatmaWhatsapp" BOOLEAN NOT NULL DEFAULT true,
    "hatirlatmaPortal" BOOLEAN NOT NULL DEFAULT true,
    "hatirlatmaEmail" BOOLEAN NOT NULL DEFAULT false,
    "whatsappNumara" TEXT,
    "sabahSaati" INTEGER NOT NULL DEFAULT 9,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "butce_ayarlar_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "butce_ayarlar_tenantId_userId_key" ON "butce_ayarlar"("tenantId", "userId");

CREATE TABLE IF NOT EXISTS "butce_ai_raporlar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tur" TEXT NOT NULL,
    "donem" TEXT,
    "soru" TEXT,
    "icerik" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "girdiOzet" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "butce_ai_raporlar_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "butce_ai_raporlar_tenantId_userId_tur_createdAt_idx" ON "butce_ai_raporlar"("tenantId", "userId", "tur", "createdAt");

-- Yabanci anahtarlar
ALTER TABLE "butce_islemler" ADD CONSTRAINT "butce_islemler_kategoriId_fkey" FOREIGN KEY ("kategoriId") REFERENCES "butce_kategoriler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "butce_islemler" ADD CONSTRAINT "butce_islemler_kartId_fkey" FOREIGN KEY ("kartId") REFERENCES "butce_kartlar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "butce_islemler" ADD CONSTRAINT "butce_islemler_duzenliId_fkey" FOREIGN KEY ("duzenliId") REFERENCES "butce_duzenli_odemeler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "butce_duzenli_odemeler" ADD CONSTRAINT "butce_duzenli_odemeler_kategoriId_fkey" FOREIGN KEY ("kategoriId") REFERENCES "butce_kategoriler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "butce_duzenli_odemeler" ADD CONSTRAINT "butce_duzenli_odemeler_kartId_fkey" FOREIGN KEY ("kartId") REFERENCES "butce_kartlar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "butce_kart_ekstreler" ADD CONSTRAINT "butce_kart_ekstreler_kartId_fkey" FOREIGN KEY ("kartId") REFERENCES "butce_kartlar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "butce_odemeler" ADD CONSTRAINT "butce_odemeler_borcId_fkey" FOREIGN KEY ("borcId") REFERENCES "butce_borclar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "butce_odemeler" ADD CONSTRAINT "butce_odemeler_kartEkstreId_fkey" FOREIGN KEY ("kartEkstreId") REFERENCES "butce_kart_ekstreler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
