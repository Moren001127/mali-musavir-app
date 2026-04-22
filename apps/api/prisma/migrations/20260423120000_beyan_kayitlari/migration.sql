-- Beyanname Kayıtları — Hattat ZIP import + ileride GİB agent için

-- Taxpayer modeline Hattat iç ID eklentisi — ZIP klasör eşleştirme
ALTER TABLE "taxpayers"
ADD COLUMN IF NOT EXISTS "hattatId" TEXT;

CREATE INDEX IF NOT EXISTS "taxpayers_hattatId_idx"
  ON "taxpayers" ("hattatId");

CREATE TABLE IF NOT EXISTS "beyan_kayitlari" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL,
  "taxpayerId"     TEXT NOT NULL,
  "beyanTipi"      TEXT NOT NULL,
  "donem"          TEXT NOT NULL,
  "beyanTarihi"    TIMESTAMP(3),
  "tahakkukTutari" DECIMAL(14, 2),
  "odemeTutari"    DECIMAL(14, 2),
  "onayNo"         TEXT,
  "pdfUrl"         TEXT,
  "beyannameUrl"   TEXT,
  "xmlUrl"         TEXT,
  "kaynak"         TEXT NOT NULL DEFAULT 'manuel',
  "importBatchId"  TEXT,
  "notlar"         TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "beyan_kayitlari_unique"
  ON "beyan_kayitlari" ("tenantId", "taxpayerId", "beyanTipi", "donem");

CREATE INDEX IF NOT EXISTS "beyan_kayitlari_tenantId_donem_idx"
  ON "beyan_kayitlari" ("tenantId", "donem");

CREATE INDEX IF NOT EXISTS "beyan_kayitlari_tenantId_beyanTipi_idx"
  ON "beyan_kayitlari" ("tenantId", "beyanTipi");

CREATE INDEX IF NOT EXISTS "beyan_kayitlari_taxpayerId_idx"
  ON "beyan_kayitlari" ("taxpayerId");

CREATE INDEX IF NOT EXISTS "beyan_kayitlari_importBatchId_idx"
  ON "beyan_kayitlari" ("importBatchId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'beyan_kayitlari_taxpayerId_fkey'
  ) THEN
    ALTER TABLE "beyan_kayitlari"
    ADD CONSTRAINT "beyan_kayitlari_taxpayerId_fkey"
    FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
