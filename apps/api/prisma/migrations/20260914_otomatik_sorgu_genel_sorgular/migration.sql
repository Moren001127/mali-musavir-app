-- 2026-09-14 Otomatik Sorgulama Ayarı (mükellef kartı) + Genel Sorgulamalar sonuç tablosu
-- taxpayers.otomatikSorgu: { eTebligat, vergiBorcu, gelenEArsiv, pos, eHaciz, yoklama } — NULL = varsayılan
ALTER TABLE "taxpayers" ADD COLUMN IF NOT EXISTS "otomatikSorgu" JSONB;

-- Genel sorgu sonuçları (vergi borcu / e-haciz / yoklama / POS / gelen e-arşiv) — her koşu ayrı satır
CREATE TABLE IF NOT EXISTS "genel_sorgu_sonuclari" (
  "id"                   TEXT NOT NULL,
  "tenantId"             TEXT NOT NULL,
  "taxpayerId"           TEXT NOT NULL,
  "tur"                  TEXT NOT NULL,
  "donem"                TEXT,
  "sorguTarihi"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ozet"                 TEXT,
  "veri"                 JSONB NOT NULL,
  "kaynak"               TEXT NOT NULL DEFAULT 'manual',
  "jobId"                TEXT,
  "whatsappGonderildiMi" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "genel_sorgu_sonuclari_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "genel_sorgu_sonuclari_tenantId_tur_sorguTarihi_idx"
  ON "genel_sorgu_sonuclari"("tenantId", "tur", "sorguTarihi");
CREATE INDEX IF NOT EXISTS "genel_sorgu_sonuclari_taxpayerId_tur_donem_idx"
  ON "genel_sorgu_sonuclari"("taxpayerId", "tur", "donem");

-- Mükellef silinince sonuçları da silinsin (Prisma onDelete: Cascade)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'genel_sorgu_sonuclari_taxpayerId_fkey'
  ) THEN
    ALTER TABLE "genel_sorgu_sonuclari"
      ADD CONSTRAINT "genel_sorgu_sonuclari_taxpayerId_fkey"
      FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
