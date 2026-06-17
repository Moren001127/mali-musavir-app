/**
 * 1) Başarısız Prisma migration kayıtlarını temizler
 * 2) earsiv_faturalar tablosu yoksa direkt CREATE et (fallback)
 * 3) _prisma_migrations'a "applied" olarak işaretler
 *
 * Bu sayede Prisma migrate deploy çalıştığında "zaten applied" görür, atlar.
 */
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260428_earsiv_fatura';
const LUCA_CAPTCHA_MIGRATION_NAME = '20260511210000_luca_captcha_challenges';
const HATTAT_CARI_MIGRATION_NAME = '20260531153000_add_cari_hareket_source_fields';
const EFATURA_INBOX_MIGRATION_NAME = '20260617150000_efatura_inbox_tenant_isolation';

// Çok-cümleli SQL'i tek tek çalıştırır. $executeRawUnsafe tek seferde birden çok
// komut (";" ile ayrılmış) kabul etmez: "cannot insert multiple commands into a
// prepared statement". Bu yüzden cümlelere bölüp her birini ayrı çalıştırıyoruz.
// (Bu SQL'lerde "$$" bloğu / metin-içi ";" yok, basit bölme güvenli.)
async function execEachStatement(prisma, sql, label) {
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let ok = 0;
  let fail = 0;
  for (const stmt of statements) {
    try {
      await prisma.$executeRawUnsafe(stmt);
      ok++;
    } catch (e) {
      fail++;
      console.error(`[startup] ${label} stmt failed: ${stmt.slice(0, 50)}... -> ${e.message}`);
    }
  }
  return { ok, fail };
}

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
-- Eski unique INDEX: (tenantId, taxpayerId, tip, faturaNo) — bu E-Fatura ve E-Arşiv'in
-- aynı fatura numaralı kayıtlarının çakışmasına sebep oluyordu (insert hata).
-- Yeni unique: (tenantId, taxpayerId, tip, belgeKaynak, faturaNo)
DROP INDEX IF EXISTS "earsiv_faturalar_tenant_taxpayer_tip_no_key";
DO $$ BEGIN
  ALTER TABLE "earsiv_faturalar" DROP CONSTRAINT IF EXISTS "earsiv_faturalar_tenant_taxpayer_tip_no_key";
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "earsiv_faturalar" DROP CONSTRAINT IF EXISTS "earsiv_faturalar_tenantId_taxpayerId_tip_faturaNo_key";
EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "earsiv_faturalar_tenant_taxpayer_tip_kaynak_no_key"
  ON "earsiv_faturalar"("tenantId", "taxpayerId", "tip", "belgeKaynak", "faturaNo");

CREATE INDEX IF NOT EXISTS "earsiv_faturalar_mihsap_status_idx"
  ON "earsiv_faturalar"("mihsapUploadStatus");
CREATE INDEX IF NOT EXISTS "earsiv_faturalar_donem_tip_kaynak_idx"
  ON "earsiv_faturalar"("tenantId", "taxpayerId", "donem", "tip", "belgeKaynak");
`;

const LUCA_CAPTCHA_SQL = `
CREATE TABLE IF NOT EXISTS "luca_captcha_challenges" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jobId" TEXT,
  "deviceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "captchaImage" TEXT NOT NULL,
  "answer" TEXT,
  "context" JSONB,
  "requestedBy" TEXT,
  "answeredBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "answeredAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "luca_captcha_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "luca_captcha_challenges_tenantId_status_createdAt_idx"
  ON "luca_captcha_challenges"("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "luca_captcha_challenges_tenantId_deviceId_status_idx"
  ON "luca_captcha_challenges"("tenantId", "deviceId", "status");
CREATE INDEX IF NOT EXISTS "luca_captcha_challenges_jobId_idx"
  ON "luca_captcha_challenges"("jobId");

ALTER TABLE "luca_fetch_jobs"
  ADD COLUMN IF NOT EXISTS "targetDeviceId" TEXT;

CREATE INDEX IF NOT EXISTS "luca_fetch_jobs_tenantId_targetDeviceId_status_idx"
  ON "luca_fetch_jobs"("tenantId", "targetDeviceId", "status");
`;

const HATTAT_CARI_SQL = `
ALTER TABLE "cari_hareketler" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "cari_hareketler" ADD COLUMN IF NOT EXISTS "sourceRef" TEXT;
ALTER TABLE "cari_hareketler" ADD COLUMN IF NOT EXISTS "importBatchId" TEXT;

CREATE INDEX IF NOT EXISTS "cari_hareketler_tenant_source_idx"
  ON "cari_hareketler"("tenantId", "source");

CREATE UNIQUE INDEX IF NOT EXISTS "cari_hareketler_tenant_source_ref_uidx"
  ON "cari_hareketler"("tenantId", "source", "sourceRef")
  WHERE "sourceRef" IS NOT NULL;
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

    const lucaCaptchaFailed = await prisma.$executeRawUnsafe(
      `DELETE FROM _prisma_migrations WHERE migration_name = '${LUCA_CAPTCHA_MIGRATION_NAME}' AND finished_at IS NULL`,
    );
    if (lucaCaptchaFailed > 0) {
      console.log(`[startup] ${LUCA_CAPTCHA_MIGRATION_NAME} basarisiz kaydi silindi (${lucaCaptchaFailed})`);
    }

    const hattatCariFailed = await prisma.$executeRawUnsafe(
      `DELETE FROM _prisma_migrations WHERE migration_name = '${HATTAT_CARI_MIGRATION_NAME}' AND finished_at IS NULL`,
    );
    if (hattatCariFailed > 0) {
      console.log(`[startup] ${HATTAT_CARI_MIGRATION_NAME} basarisiz kaydi silindi (${hattatCariFailed})`);
    }

    // efatura_inbox tenant izolasyonu (20260617150000) — ilk denemede basarisiz kalip
    // P3009'a yol acti (migrate deploy bloke -> app cokmesi). Basarisiz/yarim kaydi sil;
    // asagida kisit idempotent uygulanip "applied" isaretlenecek.
    const efaturaInboxFailed = await prisma.$executeRawUnsafe(
      `DELETE FROM _prisma_migrations WHERE migration_name = '${EFATURA_INBOX_MIGRATION_NAME}' AND finished_at IS NULL`,
    );
    if (efaturaInboxFailed > 0) {
      console.log(`[startup] ${EFATURA_INBOX_MIGRATION_NAME} basarisiz kaydi silindi (${efaturaInboxFailed})`);
    }

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
    // Her statement'ı ayrı çalıştır — biri patlasa diğeri çalışsın.
    const patches = [
      // efatura_inbox: unique (entegrator,uuid) -> (tenantId,taxpayerId,entegrator,uuid)
      // Idempotent: eski kisiti dusur, yeniyi (varsa atla) ekle. Her cumle ayri calisir.
      `ALTER TABLE "efatura_inbox" DROP CONSTRAINT IF EXISTS "efatura_inbox_entegrator_uuid_key";`,
      `DO $$ BEGIN ALTER TABLE "efatura_inbox" ADD CONSTRAINT "efatura_inbox_tenantId_taxpayerId_entegrator_uuid_key" UNIQUE ("tenantId", "taxpayerId", "entegrator", "uuid"); EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;`,
      // v2.1 — Çoklu KDV oranı detayı (UBL TaxSubtotal)
      `ALTER TABLE "earsiv_faturalar" ADD COLUMN IF NOT EXISTS "kdvBreakdown" JSONB;`,
      // v2.1 — Belge validation field'ları (üçlü eşitlik + sahiplik kontrolü)
      `ALTER TABLE "invoice_accounting_documents" ADD COLUMN IF NOT EXISTS "validationStatus"    TEXT;`,
      `ALTER TABLE "invoice_accounting_documents" ADD COLUMN IF NOT EXISTS "validationIssues"    JSONB;`,
      `ALTER TABLE "invoice_accounting_documents" ADD COLUMN IF NOT EXISTS "validationCheckedAt" TIMESTAMP(3);`,
      `CREATE INDEX IF NOT EXISTS "invoice_accounting_documents_tenantId_validationStatus_idx" ON "invoice_accounting_documents"("tenantId", "validationStatus");`,

      `DO $$ BEGIN CREATE TYPE "BelgeKaynak" AS ENUM ('EFATURA', 'EARSIV'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `ALTER TABLE "earsiv_faturalar" ADD COLUMN IF NOT EXISTS "belgeKaynak" "BelgeKaynak" NOT NULL DEFAULT 'EARSIV';`,
      `ALTER TABLE "earsiv_faturalar" ADD COLUMN IF NOT EXISTS "mihsapUploadedAt"   TIMESTAMP(3);`,
      `ALTER TABLE "earsiv_faturalar" ADD COLUMN IF NOT EXISTS "mihsapUploadStatus" TEXT;`,
      `ALTER TABLE "earsiv_faturalar" ADD COLUMN IF NOT EXISTS "mihsapUploadError"  TEXT;`,
      `ALTER TABLE "earsiv_faturalar" ADD COLUMN IF NOT EXISTS "mihsapUploadJobId"  TEXT;`,
      // Eski unique INDEX (tip+faturaNo) düşür — yeni unique (tip+belgeKaynak+faturaNo) ile çakışmasın
      `DROP INDEX IF EXISTS "earsiv_faturalar_tenant_taxpayer_tip_no_key";`,
      `DO $$ BEGIN ALTER TABLE "earsiv_faturalar" DROP CONSTRAINT IF EXISTS "earsiv_faturalar_tenant_taxpayer_tip_no_key"; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE "earsiv_faturalar" DROP CONSTRAINT IF EXISTS "earsiv_faturalar_tenantId_taxpayerId_tip_faturaNo_key"; EXCEPTION WHEN undefined_object THEN NULL; END $$;`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "earsiv_faturalar_tenant_taxpayer_tip_kaynak_no_key" ON "earsiv_faturalar"("tenantId", "taxpayerId", "tip", "belgeKaynak", "faturaNo");`,
      `CREATE INDEX IF NOT EXISTS "earsiv_faturalar_mihsap_status_idx" ON "earsiv_faturalar"("mihsapUploadStatus");`,
      `CREATE INDEX IF NOT EXISTS "earsiv_faturalar_donem_tip_kaynak_idx" ON "earsiv_faturalar"("tenantId", "taxpayerId", "donem", "tip", "belgeKaynak");`,

      // v1.36.71: receipt_images — 20260504 migration drift fix
      // Production DB'de bu kolonlar yoktu (migration "applied" işaretlenmiş ama
      // kolon eklenmemiş). Idempotent ALTER ile garantiye al.
      `ALTER TABLE "receipt_images" ADD COLUMN IF NOT EXISTS "imageHash"   VARCHAR(64);`,
      `ALTER TABLE "receipt_images" ADD COLUMN IF NOT EXISTS "ocrKategori" TEXT;`,
      `ALTER TABLE "receipt_images" ADD COLUMN IF NOT EXISTS "ocrSaticiVkn" TEXT;`,
      `CREATE INDEX IF NOT EXISTS "receipt_images_imageHash_idx" ON "receipt_images"("imageHash");`,

      // v1.36.71: ai_usage_logs — aynı 20260504 migration drift
      `ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "taxpayerId" TEXT;`,
      `ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "cacheHit"   BOOLEAN NOT NULL DEFAULT FALSE;`,
      `CREATE INDEX IF NOT EXISTS "ai_usage_logs_tenantId_taxpayerId_createdAt_idx" ON "ai_usage_logs"("tenantId", "taxpayerId", "createdAt");`,

      // v1.36.74: Görevler & Hatırlatmalar modülü (Faz 1) — idempotent fallback
      `DO $$ BEGIN CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `DO $$ BEGIN CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'SNOOZED', 'MISSED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `CREATE TABLE IF NOT EXISTS "tasks" (
        "id" TEXT PRIMARY KEY,
        "tenantId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "category" TEXT,
        "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
        "color" TEXT,
        "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "taxpayerId" TEXT,
        "createdById" TEXT NOT NULL,
        "dueDate" TIMESTAMP(3),
        "dueTime" TEXT,
        "allDay" BOOLEAN NOT NULL DEFAULT TRUE,
        "recurrence" JSONB,
        "parentTaskId" TEXT,
        "isTemplate" BOOLEAN NOT NULL DEFAULT FALSE,
        "nextOccurrence" TIMESTAMP(3),
        "reminderConfig" JSONB,
        "notifyInApp" BOOLEAN NOT NULL DEFAULT TRUE,
        "notifyEmail" BOOLEAN NOT NULL DEFAULT FALSE,
        "notifyBrowser" BOOLEAN NOT NULL DEFAULT TRUE,
        "notifySound" BOOLEAN NOT NULL DEFAULT FALSE,
        "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
        "completedAt" TIMESTAMP(3),
        "completedById" TEXT,
        "snoozedUntil" TIMESTAMP(3),
        "escalationLevel" INTEGER NOT NULL DEFAULT 0,
        "lastReminderAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE INDEX IF NOT EXISTS "tasks_tenantId_status_dueDate_idx" ON "tasks"("tenantId", "status", "dueDate");`,
      `CREATE INDEX IF NOT EXISTS "tasks_tenantId_taxpayerId_idx" ON "tasks"("tenantId", "taxpayerId");`,
      `CREATE INDEX IF NOT EXISTS "tasks_tenantId_parentTaskId_idx" ON "tasks"("tenantId", "parentTaskId");`,
      `CREATE INDEX IF NOT EXISTS "tasks_tenantId_isTemplate_idx" ON "tasks"("tenantId", "isTemplate");`,
      `CREATE INDEX IF NOT EXISTS "tasks_nextOccurrence_idx" ON "tasks"("nextOccurrence");`,
      `DO $$ BEGIN ALTER TABLE "tasks" ADD CONSTRAINT "tasks_taxpayerId_fkey" FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `CREATE TABLE IF NOT EXISTS "task_notes" (
        "id" TEXT PRIMARY KEY,
        "taskId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE INDEX IF NOT EXISTS "task_notes_taskId_idx" ON "task_notes"("taskId");`,
      `DO $$ BEGIN ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `CREATE TABLE IF NOT EXISTS "task_attachments" (
        "id" TEXT PRIMARY KEY,
        "taskId" TEXT NOT NULL,
        "filename" TEXT NOT NULL,
        "s3Key" TEXT NOT NULL,
        "size" INTEGER NOT NULL,
        "mimeType" TEXT,
        "uploadedById" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE INDEX IF NOT EXISTS "task_attachments_taskId_idx" ON "task_attachments"("taskId");`,
      `DO $$ BEGIN ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `DO $$ BEGIN ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `CREATE TABLE IF NOT EXISTS "task_reminder_logs" (
        "id" TEXT PRIMARY KEY,
        "taskId" TEXT NOT NULL,
        "scheduledFor" TIMESTAMP(3) NOT NULL,
        "sentAt" TIMESTAMP(3),
        "channel" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "recipientId" TEXT,
        "errorMsg" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE INDEX IF NOT EXISTS "task_reminder_logs_taskId_status_idx" ON "task_reminder_logs"("taskId", "status");`,
      `CREATE INDEX IF NOT EXISTS "task_reminder_logs_scheduledFor_status_idx" ON "task_reminder_logs"("scheduledFor", "status");`,
      `DO $$ BEGIN ALTER TABLE "task_reminder_logs" ADD CONSTRAINT "task_reminder_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `CREATE TABLE IF NOT EXISTS "push_subscriptions" (
        "id" TEXT PRIMARY KEY,
        "tenantId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "endpoint" TEXT NOT NULL UNIQUE,
        "p256dh" TEXT NOT NULL,
        "auth" TEXT NOT NULL,
        "userAgent" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE INDEX IF NOT EXISTS "push_subscriptions_tenantId_userId_idx" ON "push_subscriptions"("tenantId", "userId");`,
      `DO $$ BEGIN ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    ];
    let patchOk = 0;
    let patchFail = 0;
    for (const sql of patches) {
      try {
        await prisma.$executeRawUnsafe(sql);
        patchOk++;
      } catch (e) {
        patchFail++;
        console.error(`[startup] patch failed: ${sql.slice(0, 60)}... -> ${e.message}`);
      }
    }
    console.log(`[startup] earsiv patch: ${patchOk} ok, ${patchFail} fail (${patches.length} total)`);

    try {
      await execEachStatement(prisma, HATTAT_CARI_SQL, HATTAT_CARI_MIGRATION_NAME);
      const checksum = require('crypto').createHash('sha256').update(HATTAT_CARI_SQL).digest('hex');
      await prisma.$executeRawUnsafe(`
        INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        SELECT gen_random_uuid()::text, '${checksum}', NOW(), '${HATTAT_CARI_MIGRATION_NAME}', NULL, NULL, NOW(), 1
        WHERE NOT EXISTS (
          SELECT 1 FROM _prisma_migrations WHERE migration_name = '${HATTAT_CARI_MIGRATION_NAME}'
        )
      `);
      console.log(`[startup] ${HATTAT_CARI_MIGRATION_NAME} schema garanti edildi`);
    } catch (e) {
      console.error(`[startup] ${HATTAT_CARI_MIGRATION_NAME} patch failed: ${e.message}`);
    }

    try {
      await execEachStatement(prisma, LUCA_CAPTCHA_SQL, LUCA_CAPTCHA_MIGRATION_NAME);
      const checksum = require('crypto').createHash('sha256').update(LUCA_CAPTCHA_SQL).digest('hex');
      await prisma.$executeRawUnsafe(`
        INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        SELECT gen_random_uuid()::text, '${checksum}', NOW(), '${LUCA_CAPTCHA_MIGRATION_NAME}', NULL, NULL, NOW(), 1
        WHERE NOT EXISTS (
          SELECT 1 FROM _prisma_migrations WHERE migration_name = '${LUCA_CAPTCHA_MIGRATION_NAME}'
        )
      `);
      console.log(`[startup] ${LUCA_CAPTCHA_MIGRATION_NAME} schema garanti edildi`);
    } catch (e) {
      console.error(`[startup] ${LUCA_CAPTCHA_MIGRATION_NAME} patch failed: ${e.message}`);
    }

    // efatura_inbox migration'ini "applied" isaretle ki migrate deploy onu calistirmaya
    // calismasin (kisit yukarida patches icinde idempotent uygulandi). Basarisiz kayit
    // yukarida silindigi icin INSERT calisir; zaten tamamlanmis kayit varsa atlar.
    try {
      const checksum = require('crypto')
        .createHash('sha256')
        .update(EFATURA_INBOX_MIGRATION_NAME)
        .digest('hex');
      await prisma.$executeRawUnsafe(`
        INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        SELECT gen_random_uuid()::text, '${checksum}', NOW(), '${EFATURA_INBOX_MIGRATION_NAME}', NULL, NULL, NOW(), 1
        WHERE NOT EXISTS (
          SELECT 1 FROM _prisma_migrations
          WHERE migration_name = '${EFATURA_INBOX_MIGRATION_NAME}' AND finished_at IS NOT NULL
        )
      `);
      console.log(`[startup] ${EFATURA_INBOX_MIGRATION_NAME} applied isaretlendi (P3009 fix)`);
    } catch (e) {
      console.error(`[startup] ${EFATURA_INBOX_MIGRATION_NAME} applied-mark failed: ${e.message}`);
    }
  } catch (e) {
    console.error('[startup] HATA:', e.message);
    // Devam et, deploy'u durdurma
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();
