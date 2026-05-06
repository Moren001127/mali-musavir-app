/**
 * 1) Başarısız Prisma migration kayıtlarını temizler
 * 2) earsiv_faturalar tablosu yoksa direkt CREATE et (fallback)
 * 3) _prisma_migrations'a "applied" olarak işaretler
 *
 * Bu sayede Prisma migrate deploy çalıştığında "zaten applied" görür, atlar.
 */
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260428_earsiv_fatura';

const SCHEMA_SQL = `
DO $$ BEGIN
  CREATE TYPE "EarsivTip" AS ENUM ('SATIS', 'ALIS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

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

DO $$ BEGIN
  ALTER TABLE "earsiv_faturalar"
    ADD CONSTRAINT "earsiv_faturalar_taxpayerId_fkey"
    FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "earsiv_faturalar_tenant_taxpayer_tip_no_key"
  ON "earsiv_faturalar"("tenantId", "taxpayerId", "tip", "faturaNo");
CREATE INDEX IF NOT EXISTS "earsiv_faturalar_tenant_taxpayer_donem_tip_idx"
  ON "earsiv_faturalar"("tenantId", "taxpayerId", "donem", "tip");
CREATE INDEX IF NOT EXISTS "earsiv_faturalar_tenant_tarih_idx"
  ON "earsiv_faturalar"("tenantId", "faturaTarihi");
CREATE INDEX IF NOT EXISTS "earsiv_faturalar_fetchJobId_idx"
  ON "earsiv_faturalar"("fetchJobId");
`;

// v1.35.55+: Şema sonradan eklenen alanlar — idempotent ALTER (her startup'ta çalışır)
const PATCH_SQL = `
-- belgeKaynak (EFATURA | EARSIV)
DO $$ BEGIN
  CREATE TYPE "BelgeKaynak" AS ENUM ('EFATURA', 'EARSIV');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "earsiv_faturalar"
  ADD COLUMN IF NOT EXISTS "belgeKaynak" "BelgeKaynak" NOT NULL DEFAULT 'EARSIV';

-- Mihsap upload tracking alanları
ALTER TABLE "earsiv_faturalar"
  ADD COLUMN IF NOT EXISTS "mihsapUploadedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mihsapUploadStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "mihsapUploadError"  TEXT,
  ADD COLUMN IF NOT EXISTS "mihsapUploadJobId"  TEXT;

-- belgeKaynak içeren UNIQUE/INDEX (eski sürümdekini değiştir)
-- Eski unique: (tenantId, taxpayerId, tip, faturaNo)
-- Yeni unique: (tenantId, taxpayerId, tip, belgeKaynak, faturaNo)
DO $$ BEGIN
  ALTER TABLE "earsiv_faturalar" DROP CONSTRAINT IF EXISTS "earsiv_faturalar_tenant_taxpayer_tip_no_key";
EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "earsiv_faturalar_tenant_taxpayer_tip_kaynak_no_key"
  ON "earsiv_faturalar"("tenantId", "taxpayerId", "tip", "belgeKaynak", "faturaNo");

CREATE INDEX IF NOT EXISTS "earsiv_faturalar_mihsap_status_idx"
  ON "earsiv_faturalar"("mihsapUploadStatus");
CREATE INDEX IF NOT EXISTS "earsiv_faturalar_donem_tip_kaynak_idx"
  ON "earsiv_faturalar"("tenantId", "taxpayerId", "donem", "tip", "belgeKaynak");
`;

(async () => {
  if (!process.env.DATABASE_URL) {
    console.log('[startup] DATABASE_URL yok, atlanıyor');
    process.exit(0);
  }
  const prisma = new PrismaClient();
  try {
    // 1) _prisma_migrations tablosu var mı?
    const exists = await prisma.$queryRawUnsafe(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '_prisma_migrations') as ok`,
    );
    if (!exists[0]?.ok) {
      console.log('[startup] _prisma_migrations yok (ilk deploy?), schema direkt uygulanıyor');
      await prisma.$executeRawUnsafe(SCHEMA_SQL);
      console.log('[startup] earsiv schema uygulandı');
      return;
    }

    // 2) Başarısız kayıtları sil
    const r1 = await prisma.$executeRawUnsafe(
      `DELETE FROM _prisma_migrations WHERE migration_name = '${MIGRATION_NAME}' AND finished_at IS NULL`,
    );
    if (r1 > 0) console.log(`[startup] ${MIGRATION_NAME} başarısız kaydı silindi (${r1})`);

    // 3) Eski yarım kayıtlar
    const r2 = await prisma.$executeRawUnsafe(`
      DELETE FROM _prisma_migrations
      WHERE finished_at IS NULL AND started_at < NOW() - INTERVAL '5 minutes'
    `);
    if (r2 > 0) console.log(`[startup] ${r2} eski yarım migration silindi`);

    // 4) earsiv_faturalar tablosu var mı?
    const tableExists = await prisma.$queryRawUnsafe(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'earsiv_faturalar') as ok`,
    );
    if (!tableExists[0]?.ok) {
      console.log('[startup] earsiv_faturalar yok, direkt SQL ile oluşturuluyor');
      await prisma.$executeRawUnsafe(SCHEMA_SQL);

      // Migration'ı "applied" olarak işaretle ki Prisma tekrar çalıştırmasın
      const checksum = require('crypto').createHash('sha256').update(SCHEMA_SQL).digest('hex');
      await prisma.$executeRawUnsafe(`
        INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        VALUES (gen_random_uuid()::text, '${checksum}', NOW(), '${MIGRATION_NAME}', NULL, NULL, NOW(), 1)
        ON CONFLICT DO NOTHING
      `);
      console.log(`[startup] ${MIGRATION_NAME} "applied" olarak işaretlendi`);
    } else {
      console.log('[startup] earsiv_faturalar zaten var');
    }

    // PATCH: belgeKaynak + Mihsap kolonları yoksa ekle (idempotent ALTER)
    try {
      await prisma.$executeRawUnsafe(PATCH_SQL);
      console.log('[startup] earsiv patch uygulandı (belgeKaynak + mihsap kolonları)');
    } catch (e) {
      console.error('[startup] earsiv patch hatası:', e.message);
    }
  } catch (e) {
    console.error('[startup] HATA:', e.message);
    // Devam et, deploy'u durdurma
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();
