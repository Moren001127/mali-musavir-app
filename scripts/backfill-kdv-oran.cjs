/**
 * KDV ORAN BACKFILL — kayıtlı veriden oran=0 satırları yeniden türetir.
 *
 * OCR'da KDV tutarı okundu ama oranı 0/geçersiz kalan breakdown satırlarını,
 * GÖRSELİ YENİDEN OKUMADAN (Azure'a gitmeden) zaten DB'de duran veriden doldurur:
 *   1) Satır matrahı varsa: oran = KDV / matrah × 100
 *   2) Tek satırlı belge + ham OCR metninde KDV bağlamında TEK geçerli %oran varsa
 * Türetme [1,10,20]'ye DAR toleransla (±0,6) yuvarlanır; belirsizse 0 BIRAKILIR
 * (yanlış orana ASLA atamaz). KDV tutarına / teyit / kilit durumuna DOKUNMAZ;
 * yalnız breakdown JSON'undaki oran alanını günceller (ocr + confirmed).
 *
 * Kullanım:
 *   node scripts/backfill-kdv-oran.cjs                 # KURU ÇALIŞMA (yazmaz, sadece rapor)
 *   node scripts/backfill-kdv-oran.cjs --apply         # GERÇEKTEN yazar
 *   node scripts/backfill-kdv-oran.cjs --donem 2026-05 # dönem (varsayılan 2026-05)
 *
 * Prod için: DATABASE_URL (veya DATABASE_PUBLIC_URL) prod'a bakmalı.
 */
const path = require('path');
const API_DIR = path.join(__dirname, '..', 'apps', 'api');
// Env: process.env zaten varsa (prod override) dotenv ona dokunmaz.
try {
  require(path.join(API_DIR, 'node_modules', 'dotenv')).config({ path: path.join(API_DIR, '.env') });
} catch (_) { /* dotenv yoksa env'in dışarıdan verildiğini varsay */ }
const { PrismaClient } = require(path.join(API_DIR, 'node_modules', '@prisma', 'client'));

const APPLY = process.argv.includes('--apply');
const donemArgIdx = process.argv.indexOf('--donem');
const DONEM = donemArgIdx >= 0 ? process.argv[donemArgIdx + 1] : '2026-05';

// Dönem → olası periodLabel varyantları (Luca/Mihsap farklı formatlarda yazıyor)
const [yil, ay] = DONEM.split('-');
const ayNum = String(Number(ay));
const PERIOD_CANDIDATES = [
  `${yil}/${ay}`, `${yil}-${ay}`, `${yil}/${ayNum}`, `${yil}-${ayNum}`,
  `${ay}/${yil}`, `${ay}-${yil}`, `${ayNum}/${yil}`,
];

const VALID = [1, 10, 20];
const isValid = (o) => VALID.includes(Number(o));
const snap = (r) => {
  if (!isFinite(r) || r <= 0) return null;
  let best = null, bestD = Infinity;
  for (const v of VALID) {
    const d = Math.abs(v - r);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best != null && bestD <= 0.6 ? best : null;
};

// OCR servisindeki foldTurkishAscii + normalize ile aynı mantığın sade kopyası
const fold = (s) =>
  String(s || '')
    .replace(/ /g, ' ')
    .replace(/％/g, '%')
    .replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/Ş/g, 'S').replace(/ş/g, 's')
    .replace(/Ğ/g, 'G').replace(/ğ/g, 'g').replace(/Ü/g, 'U').replace(/ü/g, 'u')
    .replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ç/g, 'C').replace(/ç/g, 'c')
    .toUpperCase();

// Ham metinden KDV bağlamında TEK geçerli oran
const singleRateFromText = (rawText) => {
  if (!rawText) return null;
  const norm = fold(rawText);
  const rates = new Set();
  const ctx = /(?:TOPKDV|TOP\s*KDV|KDV|K\.D\.V|KATMA\s*DEGER\s*VERGISI)[^%\d\n]{0,12}%\s*(\d{1,2})|%\s*(\d{1,2})[^%\d\n]{0,12}(?:KDV|TOPKDV)/g;
  let m;
  while ((m = ctx.exec(norm)) !== null) {
    const r = Number(m[1] || m[2]);
    if (isValid(r)) rates.add(r);
  }
  return rates.size === 1 ? [...rates][0] : null;
};

/** Bir breakdown dizisini yerinde türetip [değişti mi, türetme-istatistik] döndürür */
function deriveBreakdown(bd, rawText, stat) {
  if (!Array.isArray(bd) || !bd.length) return false;
  let changed = false;

  // 1) matrah bazlı
  for (const item of bd) {
    if (isValid(item.oran)) continue;
    const kdv = Number(item.tutar) || 0;
    const matrah = Number(item.matrah) || 0;
    if (kdv > 0 && matrah > 0) {
      const o = snap((kdv / matrah) * 100);
      if (o) { item.oran = o; changed = true; stat.matrah++; }
    }
  }
  // 2) tek satır + metinden tek oran
  if (bd.length === 1 && !isValid(bd[0].oran) && (Number(bd[0].tutar) || 0) > 0) {
    const only = singleRateFromText(rawText);
    if (only) { bd[0].oran = only; changed = true; stat.metin++; }
  }
  return changed;
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const sessions = await prisma.kdvControlSession.findMany({
      where: { periodLabel: { in: PERIOD_CANDIDATES } },
      select: { id: true, periodLabel: true, type: true, status: true },
    });
    console.log(`\n=== KDV ORAN BACKFILL — dönem ${DONEM} ${APPLY ? '[GERÇEK YAZMA]' : '[KURU ÇALIŞMA]'} ===`);
    console.log(`Eşleşen periodLabel adayları: ${PERIOD_CANDIDATES.join(', ')}`);
    console.log(`Bulunan session: ${sessions.length}`);
    if (sessions.length === 0) {
      const distinct = await prisma.kdvControlSession.findMany({
        select: { periodLabel: true }, distinct: ['periodLabel'], take: 30,
      });
      console.log('DB\'deki mevcut periodLabel\'ler (ilk 30):', distinct.map((d) => d.periodLabel).join(' | '));
      return;
    }

    const sessionIds = sessions.map((s) => s.id);
    const images = await prisma.receiptImage.findMany({
      where: { sessionId: { in: sessionIds } },
      select: {
        id: true, ocrBelgeNo: true, confirmedBelgeNo: true, ocrRawText: true,
        ocrKdvBreakdown: true, confirmedKdvBreakdown: true,
      },
    });
    console.log(`Toplam görsel: ${images.length}\n`);

    const stat = { matrah: 0, metin: 0 };
    let imgWithMissing = 0, imgFixed = 0, imgStillMissing = 0;
    let kdvMoved = 0; // okunamadı → orana taşınan KDV toplamı
    const updates = [];

    const hasMissing = (bd) => Array.isArray(bd) && bd.some((i) => !isValid(i.oran) && (Number(i.tutar) || 0) > 0);

    for (const img of images) {
      const ocr = Array.isArray(img.ocrKdvBreakdown) ? JSON.parse(JSON.stringify(img.ocrKdvBreakdown)) : null;
      const conf = Array.isArray(img.confirmedKdvBreakdown) ? JSON.parse(JSON.stringify(img.confirmedKdvBreakdown)) : null;

      const beforeMissing = hasMissing(ocr) || hasMissing(conf);
      if (!beforeMissing) continue;
      imgWithMissing++;

      // taşınacak kdv (önce)
      const missingKdvBefore = (bd) =>
        Array.isArray(bd) ? bd.filter((i) => !isValid(i.oran)).reduce((s, i) => s + (Number(i.tutar) || 0), 0) : 0;
      const beforeKdv = Math.max(missingKdvBefore(ocr), missingKdvBefore(conf));

      const c1 = ocr ? deriveBreakdown(ocr, img.ocrRawText, stat) : false;
      const c2 = conf ? deriveBreakdown(conf, img.ocrRawText, stat) : false;

      const afterMissing = hasMissing(ocr) || hasMissing(conf);
      const afterKdv = Math.max(missingKdvBefore(ocr), missingKdvBefore(conf));
      kdvMoved += Math.max(0, beforeKdv - afterKdv);

      if (c1 || c2) {
        imgFixed++;
        const belge = img.confirmedBelgeNo || img.ocrBelgeNo || img.id.slice(0, 8);
        console.log(`  ✓ ${belge}  oran dolduruldu  (taşınan KDV ≈ ${(beforeKdv - afterKdv).toFixed(2)})`);
        updates.push({ id: img.id, ocr: c1 ? ocr : undefined, conf: c2 ? conf : undefined });
      }
      if (afterMissing) imgStillMissing++;
    }

    console.log(`\n--- ÖZET ---`);
    console.log(`Oranı eksik görsel       : ${imgWithMissing}`);
    console.log(`Oran dolduruldu          : ${imgFixed}  (matrah: ${stat.matrah}, metin: ${stat.metin})`);
    console.log(`Hâlâ okunamayan görsel   : ${imgStillMissing}  (matrah da metinde de oran yok → elle)`);
    console.log(`Okunamadı'dan orana taşınan KDV ≈ ${kdvMoved.toFixed(2)} TL`);

    if (!APPLY) {
      console.log(`\n[KURU ÇALIŞMA] Hiçbir şey yazılmadı. Yazmak için: node scripts/backfill-kdv-oran.cjs --apply --donem ${DONEM}\n`);
      return;
    }

    console.log(`\n[YAZILIYOR] ${updates.length} görsel güncelleniyor...`);
    for (const u of updates) {
      const data = {};
      if (u.ocr) data.ocrKdvBreakdown = u.ocr;
      if (u.conf) data.confirmedKdvBreakdown = u.conf;
      await prisma.receiptImage.update({ where: { id: u.id }, data });
    }
    console.log(`[TAMAM] ${updates.length} görsel güncellendi. Beyan panosunda "Yenile" ile kontrol et.\n`);
  } catch (e) {
    console.error('HATA:', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
