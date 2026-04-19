-- Firma Hafizasi (Vendor Memory) + Onay Kuyrugu (Pending Decisions)
-- Prod-safe: yalniz CREATE, hic DROP yok. IF NOT EXISTS ile idempotent.

-- ============================================================
-- 1) vendor_memory
-- ============================================================
CREATE TABLE IF NOT EXISTS "vendor_memory" (
  "id"            TEXT          NOT NULL,
  "tenantId"      TEXT          NOT NULL,
  "firmaKimlikNo" TEXT          NOT NULL,
  "firmaUnvan"    TEXT,
  "toplamOnay"    INTEGER       NOT NULL DEFAULT 0,
  "sonKullanim"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "vendor_memory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vendor_memory_tenantId_firmaKimlikNo_key"
  ON "vendor_memory"("tenantId", "firmaKimlikNo");

CREATE INDEX IF NOT EXISTS "vendor_memory_tenantId_sonKullanim_idx"
  ON "vendor_memory"("tenantId", "sonKullanim");

-- ============================================================
-- 2) vendor_memory_decisions
-- ============================================================
CREATE TABLE IF NOT EXISTS "vendor_memory_decisions" (
  "id"             TEXT          NOT NULL,
  "vendorMemoryId" TEXT          NOT NULL,
  "kararTipi"      TEXT          NOT NULL,
  "kategori"       TEXT          NOT NULL,
  "altKategori"    TEXT,
  "onayAdedi"      INTEGER       NOT NULL DEFAULT 0,
  "sonKullanim"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_memory_decisions_pkey" PRIMARY KEY ("id")
);

-- NULL alt kategori icin Postgres unique kurali: COALESCE ile empty fallback
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_memory_decisions_vm_tip_kat_alt_key"
  ON "vendor_memory_decisions"("vendorMemoryId", "kararTipi", "kategori", COALESCE("altKategori", ''));

CREATE INDEX IF NOT EXISTS "vendor_memory_decisions_vendorMemoryId_onayAdedi_idx"
  ON "vendor_memory_decisions"("vendorMemoryId", "onayAdedi");

-- FK (idempotent: once var mi kontrol et)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_memory_decisions_vendorMemoryId_fkey'
  ) THEN
    ALTER TABLE "vendor_memory_decisions"
      ADD CONSTRAINT "vendor_memory_decisions_vendorMemoryId_fkey"
      FOREIGN KEY ("vendorMemoryId") REFERENCES "vendor_memory"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- ============================================================
-- 3) pending_decisions (Onay Kuyrugu)
-- ============================================================
CREATE TABLE IF NOT EXISTS "pending_decisions" (
  "id"             TEXT            NOT NULL,
  "tenantId"       TEXT            NOT NULL,
  "mukellef"       TEXT,
  "firmaKimlikNo"  TEXT,
  "firmaUnvan"     TEXT,
  "belgeNo"        TEXT,
  "belgeTuru"      TEXT,
  "faturaTarihi"   TIMESTAMP(3),
  "tutar"          DECIMAL(14,2),
  "kararTipi"      TEXT            NOT NULL,
  "aiKarari"       JSONB           NOT NULL,
  "gecmisBeklenen" JSONB,
  "sapmaSebep"     VARCHAR(500)    NOT NULL,
  "imageBase64"    TEXT,
  "durum"          TEXT            NOT NULL DEFAULT 'bekliyor',
  "sonucKarari"    JSONB,
  "onayAlan"       TEXT,
  "onayTarihi"     TIMESTAMP(3),
  "notlar"         TEXT,
  "createdAt"      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)    NOT NULL,
  CONSTRAINT "pending_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pending_decisions_tenantId_durum_createdAt_idx"
  ON "pending_decisions"("tenantId", "durum", "createdAt");

CREATE INDEX IF NOT EXISTS "pending_decisions_tenantId_createdAt_idx"
  ON "pending_decisions"("tenantId", "createdAt");
