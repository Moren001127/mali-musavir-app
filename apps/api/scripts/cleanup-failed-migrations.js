/**
 * Başarısız Prisma migration kayıtlarını temizler.
 * Railway'de migrate deploy çalışmadan ÖNCE koşar.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.log('[cleanup-failed-migrations] DATABASE_URL yok, atlanıyor');
    process.exit(0);
  }

  const prisma = new PrismaClient();
  try {
    // _prisma_migrations tablosu var mı?
    const exists = await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = '_prisma_migrations'
      ) as ok
    `);
    if (!exists[0]?.ok) {
      console.log('[cleanup-failed-migrations] _prisma_migrations yok, atlanıyor');
      return;
    }

    // Bilinen problemli migration'ları temizle
    const problematic = ['20260428_earsiv_fatura'];
    for (const name of problematic) {
      const r = await prisma.$executeRawUnsafe(
        `DELETE FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NULL`,
        name,
      );
      if (r > 0) {
        console.log(`[cleanup-failed-migrations] "${name}" başarısız kaydı silindi (${r} satır)`);
      }
    }

    // Genel: 5 dk'dan eski yarım migration'lar
    const r2 = await prisma.$executeRawUnsafe(`
      DELETE FROM _prisma_migrations
      WHERE finished_at IS NULL
        AND started_at < NOW() - INTERVAL '5 minutes'
    `);
    if (r2 > 0) {
      console.log(`[cleanup-failed-migrations] ${r2} eski yarım migration silindi`);
    }
  } catch (e) {
    console.error('[cleanup-failed-migrations] HATA:', e.message);
    // Hata olsa bile deploy devam etsin
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();
