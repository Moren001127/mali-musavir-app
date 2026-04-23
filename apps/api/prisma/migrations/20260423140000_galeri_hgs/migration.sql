-- Galeri Modülü — HGS İhlal Sorgulama
-- Araç tablosu + KGM sorgu sonuç kayıtları

CREATE TABLE IF NOT EXISTS "araclar" (
  "id"         TEXT PRIMARY KEY,
  "tenantId"   TEXT NOT NULL,
  "plaka"      TEXT NOT NULL,
  "marka"      TEXT,
  "model"      TEXT,
  "sahipAd"    TEXT,
  "taxpayerId" TEXT,
  "aktif"      BOOLEAN NOT NULL DEFAULT true,
  "notlar"     TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "araclar_tenant_plaka_unique"
  ON "araclar" ("tenantId", "plaka");

CREATE INDEX IF NOT EXISTS "araclar_tenantId_idx" ON "araclar" ("tenantId");
CREATE INDEX IF NOT EXISTS "araclar_taxpayerId_idx" ON "araclar" ("taxpayerId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'araclar_taxpayerId_fkey'
  ) THEN
    ALTER TABLE "araclar"
    ADD CONSTRAINT "araclar_taxpayerId_fkey"
    FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "hgs_ihlal_sorgu_sonuclari" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL,
  "aracId"      TEXT NOT NULL,
  "sorguTarihi" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "durum"       TEXT NOT NULL DEFAULT 'beklemede',
  "ihlalSayisi" INTEGER NOT NULL DEFAULT 0,
  "toplamTutar" DECIMAL(14, 2),
  "detaylar"    JSONB,
  "rawHtml"     TEXT,
  "hataMesaji"  TEXT,
  "kaynak"      TEXT NOT NULL DEFAULT 'manuel'
);

CREATE INDEX IF NOT EXISTS "hgs_tenant_tarih_idx"
  ON "hgs_ihlal_sorgu_sonuclari" ("tenantId", "sorguTarihi" DESC);

CREATE INDEX IF NOT EXISTS "hgs_arac_tarih_idx"
  ON "hgs_ihlal_sorgu_sonuclari" ("aracId", "sorguTarihi" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'hgs_sonuc_aracId_fkey'
  ) THEN
    ALTER TABLE "hgs_ihlal_sorgu_sonuclari"
    ADD CONSTRAINT "hgs_sonuc_aracId_fkey"
    FOREIGN KEY ("aracId") REFERENCES "araclar"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
