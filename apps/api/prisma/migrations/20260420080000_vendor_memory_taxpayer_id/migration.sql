-- Firma Hafızası hibrit yapı: VendorMemoryDecision'a taxpayerId ekle.
-- Her mükellef kendi hesap kodunu (740/770/760) ayrı öğrenir; firma kimliği ortak kalır.
-- Mevcut kayıtlar taxpayerId = NULL olarak kalır (geçmiş "ortak" kararlar).

-- 1) Sütunu ekle (nullable)
ALTER TABLE "vendor_memory_decisions"
ADD COLUMN IF NOT EXISTS "taxpayerId" TEXT;

-- 2) Eski unique constraint'i kaldır (Prisma'nın otomatik ürettiği isim)
DROP INDEX IF EXISTS "vendor_memory_decisions_vendorMemoryId_kararTipi_kategori_altKategori_key";

-- 3) Nullable taxpayerId ve altKategori için COALESCE'lı expression-based unique index
--    PostgreSQL standart UNIQUE NULL'ı farklı değer sayar — istemiyoruz: aynı (firma+mukellef+kategori) tek kayıt olsun.
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_memory_decisions_unique"
  ON "vendor_memory_decisions" (
    "vendorMemoryId",
    COALESCE("taxpayerId", ''),
    "kararTipi",
    "kategori",
    COALESCE("altKategori", '')
  );

-- 4) Performans indexleri
CREATE INDEX IF NOT EXISTS "vendor_memory_decisions_vendorMemoryId_taxpayerId_idx"
  ON "vendor_memory_decisions" ("vendorMemoryId", "taxpayerId");

CREATE INDEX IF NOT EXISTS "vendor_memory_decisions_taxpayerId_idx"
  ON "vendor_memory_decisions" ("taxpayerId");

-- 5a) PendingDecision tablosuna da taxpayerId ekle (aynı amaçla)
ALTER TABLE "pending_decisions"
ADD COLUMN IF NOT EXISTS "taxpayerId" TEXT;

CREATE INDEX IF NOT EXISTS "pending_decisions_taxpayerId_idx"
  ON "pending_decisions" ("taxpayerId");

-- 5) Foreign key — mükellef silinince karar satırı NULL'a düşsün (ortak kayda dönsün)
--    Constraint'i IF NOT EXISTS ile oluşturmak PostgreSQL'de yok; önce var mı kontrol et sonra ekle.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'vendor_memory_decisions_taxpayerId_fkey'
      AND table_name = 'vendor_memory_decisions'
  ) THEN
    ALTER TABLE "vendor_memory_decisions"
    ADD CONSTRAINT "vendor_memory_decisions_taxpayerId_fkey"
    FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
