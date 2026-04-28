-- E-arşiv / E-fatura modülü (idempotent — kısmi yürütülmüşse bile güvenli)

-- 1. ENUM
DO $$ BEGIN
  CREATE TYPE "EarsivTip" AS ENUM ('SATIS', 'ALIS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Tablo
CREATE TABLE IF NOT EXISTS "earsiv_faturalar" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL,
  "taxpayerId"     TEXT NOT NULL,
  "tip"            "EarsivTip" NOT NULL,
  "donem"          TEXT NOT NULL,
  "faturaNo"       TEXT NOT NULL,
  "faturaTarihi"   TIMESTAMP(3) NOT NULL,
  "ettn"           TEXT,
  "satici"         TEXT,
  "saticiVergiNo"  TEXT,
  "alici"          TEXT,
  "aliciVergiNo"   TEXT,
  "matrah"         DECIMAL(18, 2),
  "kdvTutari"      DECIMAL(18, 2),
  "kdvOrani"       DECIMAL(5, 2),
  "toplamTutar"    DECIMAL(18, 2),
  "paraBirimi"     TEXT DEFAULT 'TL',
  "aciklama"       TEXT,
  "durum"          TEXT,
  "xmlContent"     TEXT,
  "pdfStorageKey"  TEXT,
  "zipSourceName"  TEXT,
  "fetchJobId"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Foreign key (FK varsa eklenmesin)
DO $$ BEGIN
  ALTER TABLE "earsiv_faturalar"
    ADD CONSTRAINT "earsiv_faturalar_taxpayerId_fkey"
    FOREIGN KEY ("taxpayerId") REFERENCES "Taxpayer"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4. Index'ler
CREATE UNIQUE INDEX IF NOT EXISTS "earsiv_faturalar_tenant_taxpayer_tip_no_key"
  ON "earsiv_faturalar"("tenantId", "taxpayerId", "tip", "faturaNo");

CREATE INDEX IF NOT EXISTS "earsiv_faturalar_tenant_taxpayer_donem_tip_idx"
  ON "earsiv_faturalar"("tenantId", "taxpayerId", "donem", "tip");

CREATE INDEX IF NOT EXISTS "earsiv_faturalar_tenant_tarih_idx"
  ON "earsiv_faturalar"("tenantId", "faturaTarihi");

CREATE INDEX IF NOT EXISTS "earsiv_faturalar_fetchJobId_idx"
  ON "earsiv_faturalar"("fetchJobId");
