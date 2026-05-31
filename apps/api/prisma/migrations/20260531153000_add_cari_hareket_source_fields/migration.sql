ALTER TABLE "cari_hareketler" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "cari_hareketler" ADD COLUMN IF NOT EXISTS "sourceRef" TEXT;
ALTER TABLE "cari_hareketler" ADD COLUMN IF NOT EXISTS "importBatchId" TEXT;

CREATE INDEX IF NOT EXISTS "cari_hareketler_tenant_source_idx"
  ON "cari_hareketler"("tenantId", "source");

CREATE UNIQUE INDEX IF NOT EXISTS "cari_hareketler_tenant_source_ref_uidx"
  ON "cari_hareketler"("tenantId", "source", "sourceRef")
  WHERE "sourceRef" IS NOT NULL;
