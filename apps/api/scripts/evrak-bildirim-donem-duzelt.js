/**
 * Evrak Geldi / Evrak İşlendi bildirim otomasyonlarında DÖNEM düzeltmesi.
 *
 * Sorun: bildirim metni {{trigger.payload.year}}/{{trigger.payload.month}} (İŞLEM ayı,
 * örn. 2026/6) yazıyordu; evraklar BEYANNAME dönemine (işlem ayı - 1, örn. 2026-05)
 * aittir. Payload'da hazır alan var: beyannamePeriodLabel.
 *
 * SADECE şu iki ACTIVE kayda dokunur (2026-06-10 teşhisi, kullanıcı onaylı):
 *   - cmpdp4lze008jugrpqox773g0  "Evrak Geldi — Anlık Bildirim"
 *   - cmpdpk5tx0063vd8sdcjz4ipj  "Evrak \"İşlendi\" İşaretlenince Anlık Bildirim"
 *
 * Çalıştırma: DATABASE_PUBLIC_URL ile (bkz. evrak-bildirim-donem-incele.js)
 */
const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));

const TARGET_IDS = ['cmpdp4lze008jugrpqox773g0', 'cmpdpk5tx0063vd8sdcjz4ipj'];
const ESKI = '{{trigger.payload.year}}/{{trigger.payload.month}}';
const YENI = '{{trigger.payload.beyannamePeriodLabel}}';

async function main() {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL yok.'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    for (const id of TARGET_IDS) {
      const row = await prisma.automation.findUnique({ where: { id }, select: { id: true, title: true, steps: true } });
      if (!row) { console.log(`${id}: BULUNAMADI, atlandı`); continue; }
      const once = JSON.stringify(row.steps);
      if (!once.includes(ESKI)) { console.log(`${id} (${row.title}): desen yok, atlandı`); continue; }
      const sonra = JSON.parse(once.split(ESKI).join(YENI));
      await prisma.automation.update({ where: { id }, data: { steps: sonra } });
      console.log(`${id} (${row.title}): GÜNCELLENDİ`);
      console.log(`  eski: ...${ESKI}...`);
      console.log(`  yeni: ...${YENI}...`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
