#!/usr/bin/env node
/**
 * VERGİ TAKVİMİ CANLI DÜZELTME (portal denetimi bulgu 43).
 *
 * Neden gerekli: tohum betiği MEVCUT satırlara DOKUNMAZ (elle düzeltilen tarihler korunsun diye).
 * Bu yüzden kod düzelse bile canlıda hafta sonuna düşmüş satırlar yanlış kalır.
 *
 * Ne yapar: `tax_calendar` satırlarını doğru kuralla (taban gün + iş günü kayması + bilinen
 * sirküler uzatması) yeniden hesaplar; SAPAN satırların yalnız `dueDate` alanını günceller.
 * Kayıt SİLMEZ, kayıt EKLEMEZ, başka alana dokunmaz.
 *
 * VARSAYILAN KURU ÇALIŞMA. Yazmak için: --uygula
 *
 * Çalıştırma (Railway üzerinden, apps/api içinden):
 *   railway run --service Postgres sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node ../../scripts/vergi-takvimi-duzelt.cjs'
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const { calculateBeyannameDeadline } = require(path.join(ROOT, 'apps/api/src/schedule/beyanname-deadline.util.ts'));
const { PrismaClient } = require(path.join(ROOT, 'apps/api/node_modules/@prisma/client'));

const UYGULA = process.argv.includes('--uygula');
const GUN_ADI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
/** İstanbul takvim günü. */
const gun = (d) => new Date(new Date(d).getTime() + 3 * 3600000).toISOString().slice(0, 10);
const gunAdi = (d) => GUN_ADI[new Date(new Date(d).getTime() + 3 * 3600000).getUTCDay()];
const iki = (n) => String(n).padStart(2, '0');

/**
 * Satırın ait olduğu dönemi util'in beklediği "YYYY-AA" biçimine çevirir.
 * Tohum çeyreklik satırları nasıl ürettiyse aynı eşleme kullanılıyor (vergi-takvimi-tohum.ts):
 *   MUHSGK Qn → çeyreğin son ayı · GGECICI/KGECICI Qn → çeyreğin son ayı + 1
 *   GELIR/KURUMLAR (ay ve çeyrek yok) → izleyen yılın Mart/Nisan'ı
 */
function utilDonemi(r) {
  const tip = r.declarationType;
  if (r.periodMonth) return `${r.periodYear}-${iki(r.periodMonth)}`;
  if (r.periodQuarter) {
    const sonAy = r.periodQuarter * 3;
    if (tip === 'GGECICI' || tip === 'KGECICI') {
      const ay = sonAy + 1 > 12 ? 1 : sonAy + 1;
      const yil = sonAy + 1 > 12 ? r.periodYear + 1 : r.periodYear;
      return `${yil}-${iki(ay)}`;
    }
    return `${r.periodYear}-${iki(sonAy)}`;
  }
  if (tip === 'GELIR') return `${r.periodYear + 1}-03`;
  if (tip === 'KURUMLAR') return `${r.periodYear + 1}-04`;
  return null;
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.taxCalendar.findMany({
      orderBy: { dueDate: 'asc' },
      select: { id: true, declarationType: true, periodYear: true, periodMonth: true, periodQuarter: true, dueDate: true, description: true },
    });
    console.log(`tax_calendar: ${rows.length} satır okundu\n`);

    const degisecek = [];
    const cozulemeyen = [];
    for (const r of rows) {
      const donem = utilDonemi(r);
      if (!donem) { cozulemeyen.push({ r, neden: 'dönem çözülemedi' }); continue; }
      const dogru = calculateBeyannameDeadline(r.declarationType, donem);
      if (!dogru) { cozulemeyen.push({ r, neden: `kural yok (${r.declarationType})` }); continue; }
      if (gun(dogru) !== gun(r.dueDate)) degisecek.push({ r, yeni: dogru, donem });
    }

    if (cozulemeyen.length) {
      console.log(`⚠ ${cozulemeyen.length} satır hesaplanamadı — DOKUNULMUYOR:`);
      for (const c of cozulemeyen.slice(0, 20)) {
        console.log(`   ${c.r.declarationType} ${c.r.periodYear}-${iki(c.r.periodMonth || 0)}${c.r.periodQuarter ? `/Q${c.r.periodQuarter}` : ''} · ${c.neden}`);
      }
      console.log('');
    }

    if (!degisecek.length) {
      console.log('✓ Sapan satır yok — düzeltme gerekmiyor.');
      return;
    }

    console.log(`${degisecek.length} satır sapıyor:\n`);
    console.log('  TİP        DÖNEM      ESKİ (gün)                  → YENİ (gün)');
    for (const d of degisecek) {
      const eski = `${gun(d.r.dueDate)} ${gunAdi(d.r.dueDate)}`;
      const yeni = `${gun(d.yeni)} ${gunAdi(d.yeni)}`;
      const don = `${d.r.periodYear}-${iki(d.r.periodMonth || 0)}${d.r.periodQuarter ? `/Q${d.r.periodQuarter}` : '   '}`;
      console.log(`  ${d.r.declarationType.padEnd(10)} ${don.padEnd(10)} ${eski.padEnd(27)} → ${yeni}`);
    }

    if (!UYGULA) {
      console.log('\n>>> KURU ÇALIŞMA. Hiçbir şey yazılmadı. Uygulamak için: --uygula');
      return;
    }

    let n = 0;
    for (const d of degisecek) {
      await prisma.taxCalendar.update({ where: { id: d.r.id }, data: { dueDate: d.yeni } });
      n++;
    }
    console.log(`\n✓ ${n} satırın dueDate alanı güncellendi. Başka alana dokunulmadı.`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(`HATA: ${(e && e.stack) || e}`); process.exit(1); });
