-- 2026-09-22 e-Defter berat takibi + DVD sorguları
-- taxpayer_beyan_configs.eDefterBaslangic: e-Defter mükellefiyetinin başladığı ay "YYYY-MM" (Hattat "Başlangıç")
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN IF NOT EXISTS "eDefterBaslangic" TEXT;

-- e-Defter paketleri (Kebir/Yevmiye beratı, Yevmiye/Kebir defteri) — GİB e-Defter uygulaması paket listesi
CREATE TABLE IF NOT EXISTS "edefter_beratlari" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "taxpayerId"    TEXT NOT NULL,
  "donem"         TEXT NOT NULL,
  "belgeTuru"     TEXT NOT NULL,
  "paketId"       TEXT NOT NULL,
  "islemOid"      TEXT,
  "oid"           TEXT,
  "alinmaZamani"  TIMESTAMP(3),
  "durumKodu"     INTEGER,
  "durumAciklama" TEXT,
  "ham"           JSONB,
  "sorguTarihi"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "jobId"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "edefter_beratlari_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "edefter_beratlari_taxpayerId_paketId_key" ON "edefter_beratlari"("taxpayerId", "paketId");
CREATE INDEX IF NOT EXISTS "edefter_beratlari_tenantId_donem_idx" ON "edefter_beratlari"("tenantId", "donem");
CREATE INDEX IF NOT EXISTS "edefter_beratlari_taxpayerId_donem_belgeTuru_idx" ON "edefter_beratlari"("taxpayerId", "donem", "belgeTuru");

-- e-Defter sorgu koşusu kaydı (mükellef + dönem: ne zaman sorgulandı, kaç paket, hata)
CREATE TABLE IF NOT EXISTS "edefter_sorgu_kayitlari" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "taxpayerId"  TEXT NOT NULL,
  "donem"       TEXT NOT NULL,
  "sorguTarihi" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paketSayisi" INTEGER NOT NULL DEFAULT 0,
  "kaynak"      TEXT NOT NULL DEFAULT 'manual',
  "jobId"       TEXT,
  "hata"        TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edefter_sorgu_kayitlari_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "edefter_sorgu_kayitlari_tenantId_taxpayerId_donem_sorguTarihi_idx"
  ON "edefter_sorgu_kayitlari"("tenantId", "taxpayerId", "donem", "sorguTarihi");

-- Mükellef silinince kayıtları da silinsin (Prisma onDelete: Cascade)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edefter_beratlari_taxpayerId_fkey') THEN
    ALTER TABLE "edefter_beratlari"
      ADD CONSTRAINT "edefter_beratlari_taxpayerId_fkey"
      FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edefter_sorgu_kayitlari_taxpayerId_fkey') THEN
    ALTER TABLE "edefter_sorgu_kayitlari"
      ADD CONSTRAINT "edefter_sorgu_kayitlari_taxpayerId_fkey"
      FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
