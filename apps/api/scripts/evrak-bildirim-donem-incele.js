/**
 * Evrak Geldi bildirimi dönem teşhisi — SALT OKUNUR.
 * "Evrak Geldi" içeren veya Taxpayer.Evrak* tetikleyicili otomasyonları bulur,
 * id + başlık + tetikleyici + adım şablonlarını yazdırır. Gizli bilgi YAZDIRMAZ.
 *
 * Çalıştırma (production):  railway run node apps/api/scripts/evrak-bildirim-donem-incele.js
 */
const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));

async function main() {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL yok — railway run ile çalıştırın.');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await prisma.automation.findMany({
      select: { id: true, title: true, status: true, triggerType: true, triggerConfig: true, steps: true },
    });
    const ilgili = rows.filter((r) => {
      const s = JSON.stringify(r.steps || '') + JSON.stringify(r.triggerConfig || '');
      return /Evrak Geldi|EvrakDurumuChanged|EvrakIslendiChanged|evraklar[ıi]? teslim/i.test(s);
    });
    console.log(`Toplam otomasyon: ${rows.length} — ilgili: ${ilgili.length}\n`);
    for (const r of ilgili) {
      console.log('────────────────────────────────────────');
      console.log(`id: ${r.id}`);
      console.log(`başlık: ${r.title} | durum: ${r.status} | tetik: ${r.triggerType}`);
      console.log(`triggerConfig: ${JSON.stringify(r.triggerConfig)}`);
      console.log(`steps: ${JSON.stringify(r.steps, null, 2)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
