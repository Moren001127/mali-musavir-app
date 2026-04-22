-- Mükellef Beyanname Takip (Hattat-stil Toplu Beyanname Kontrol)
-- İki yeni tablo: taxpayer_beyan_configs + beyan_durumlari

-- ═══════════════════════════════════════════════════════════
-- 1) taxpayer_beyan_configs — her mükellef için sabit beyan yapısı
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "taxpayer_beyan_configs" (
  "id"                  TEXT PRIMARY KEY,
  "taxpayerId"          TEXT NOT NULL UNIQUE,
  "incomeTaxType"       TEXT,
  "kdv1Period"          TEXT,
  "kdv2Enabled"         BOOLEAN NOT NULL DEFAULT false,
  "muhtasarPeriod"      TEXT,
  "damgaEnabled"        BOOLEAN NOT NULL DEFAULT false,
  "posetEnabled"        BOOLEAN NOT NULL DEFAULT false,
  "sgkBildirgeEnabled"  BOOLEAN NOT NULL DEFAULT false,
  "eDefterPeriod"       TEXT,
  "notes"               TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'taxpayer_beyan_configs_taxpayerId_fkey'
  ) THEN
    ALTER TABLE "taxpayer_beyan_configs"
    ADD CONSTRAINT "taxpayer_beyan_configs_taxpayerId_fkey"
    FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 2) beyan_durumlari — dönem bazlı beyan durumu
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "beyan_durumlari" (
  "id"              TEXT PRIMARY KEY,
  "tenantId"        TEXT NOT NULL,
  "taxpayerId"      TEXT NOT NULL,
  "beyanTipi"       TEXT NOT NULL,
  "donem"           TEXT NOT NULL,
  "durum"           TEXT NOT NULL DEFAULT 'beklemede',
  "onayTarihi"      TIMESTAMP(3),
  "tahakkukTutari"  DECIMAL(14, 2),
  "notlar"          TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "beyan_durumlari_unique"
  ON "beyan_durumlari" ("tenantId", "taxpayerId", "beyanTipi", "donem");

CREATE INDEX IF NOT EXISTS "beyan_durumlari_tenant_donem_idx"
  ON "beyan_durumlari" ("tenantId", "donem");

CREATE INDEX IF NOT EXISTS "beyan_durumlari_tenant_tip_donem_idx"
  ON "beyan_durumlari" ("tenantId", "beyanTipi", "donem");

CREATE INDEX IF NOT EXISTS "beyan_durumlari_taxpayerId_idx"
  ON "beyan_durumlari" ("taxpayerId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'beyan_durumlari_taxpayerId_fkey'
  ) THEN
    ALTER TABLE "beyan_durumlari"
    ADD CONSTRAINT "beyan_durumlari_taxpayerId_fkey"
    FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
