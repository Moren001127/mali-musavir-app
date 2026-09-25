#!/usr/bin/env node
/**
 * ÇİFT KAYIT KAPILARI regresyonu — 2026-09-25 denetim bulguları 1, 13 + doğrulamada bulunan update() açığı.
 *   apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts
 *
 * Gerçek fonksiyonlar sahte prisma ile çağrılır (kaynakta metin ARAMAZ).
 *
 * BULGU 1: approve() ve retryLucaPost() belgenin mevcut lucaStatus'una bakmıyordu → Luca'da fişi
 *   kesilmiş belge yeniden kuyruğa girip ikinci kez fişe düşebiliyordu. remove()/reopen() aynı
 *   korumayı zaten yapıyordu; bu iki yol dışarıda kalmıştı.
 * BULGU 13: retryLucaPost ortak (toplu) işi "failed" işaretleyip yalnız bu belgenin bağını koparıyordu.
 *   Ajan "failed"e uymadığı için eski iş Luca'ya yazmaya devam ediyor, belge yeni işte ikinci kez
 *   gidiyordu; kardeş belgeler de yanlışlıkla "aktarılmadı" görünüyordu.
 * EK (denetim listesinde yok): update() aktarılmış belgeyi engellemiyor ve gövdeden status='APPROVED'
 *   yazılarak onay kapılarının tamamı atlatılabiliyordu.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

const { FaturaMuhasebelestirmeService } = require(
  path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'),
);

let failed = 0;
function ok(cond, msg) { if (!cond) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }

async function reddedildiMi(fn, desen, msg) {
  try {
    await fn();
    failed++;
    console.error(`  ✗ ${msg} — HATA FIRLATMADI (kapı açık!)`);
  } catch (e) {
    const m = String((e && e.message) || e);
    if (desen.test(m)) ok(true, `${msg} — reddedildi: "${m.slice(0, 70)}…"`);
    else { failed++; console.error(`  ✗ ${msg} — beklenmeyen hata: ${m.slice(0, 120)}`); }
  }
}

const belge = (over = {}) => ({
  id: 'd1', tenantId: 't1', taxpayerId: 'tp1', status: 'APPROVED', lucaStatus: 'POSTED',
  lucaJobId: null, invoiceKind: 'ALIS', totalAmount: 1180, belgeNo: 'A1', ocrData: {}, lines: [],
  ...over,
});

function makeSvc(doc, opts = {}) {
  const kayit = { belgeYazma: [], isYazma: [] };
  const prisma = {
    invoiceAccountingDocument: {
      findFirst: async () => doc,
      findMany: async () => [],
      update: async (a) => { kayit.belgeYazma.push(a); return doc; },
      updateMany: async (a) => {
        kayit.belgeYazma.push(a);
        // Yarış durumu taklidi: koşul POSTED'i dışlıyorsa ve belge POSTED ise hiçbir satır güncellenmez.
        const w = (a && a.where) || {};
        const ls = String(doc.lucaStatus || '');
        const notIn = w.lucaStatus && w.lucaStatus.notIn;
        const not = w.lucaStatus && w.lucaStatus.not;
        if (Array.isArray(notIn) && notIn.includes(ls)) return { count: 0 };
        if (not && not === ls) return { count: 0 };
        return { count: opts.yazmaCount === undefined ? 1 : opts.yazmaCount };
      },
    },
    lucaFetchJob: {
      findUnique: async () => opts.is || null,
      updateMany: async (a) => { kayit.isYazma.push(a); return { count: 1 }; },
    },
    taxpayer: { findFirst: async () => ({ defterTuru: 'BILANCO' }), findMany: async () => [] },
  };
  const svc = new FaturaMuhasebelestirmeService(prisma, {}, {}, {}, {}, {}, {}, {}, {}, {});
  svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
  svc.getPlanCodeSet = async () => new Set(['770.01.010']);
  return { svc, kayit };
}

(async () => {
  // ── BULGU 1: approve() ──
  console.log('1) approve() — aktarılmış belge yeniden onaylanamaz');
  {
    const { svc, kayit } = makeSvc(belge({ lucaStatus: 'POSTED' }));
    await reddedildiMi(() => svc.approve('t1', 'd1', 'u1'), /aktarılmış|çift fiş/i, 'POSTED belge onaya kapalı');
    ok(kayit.belgeYazma.length === 0, 'reddedilen onayda hiç yazma denenmedi');
  }
  {
    const { svc } = makeSvc(belge({ lucaStatus: 'POSTING' }));
    await reddedildiMi(() => svc.approve('t1', 'd1', 'u1'), /aktarılıyor/i, 'POSTING belge onaya kapalı');
  }
  {
    // force çift fiş kapısını AÇMAMALI (force yalnız doğrulama uyarıları için).
    const { svc } = makeSvc(belge({ lucaStatus: 'POSTED' }));
    await reddedildiMi(() => svc.approve('t1', 'd1', 'u1', true), /aktarılmış|çift fiş/i, 'force ile de geçilemiyor');
  }

  // ── BULGU 1: retryLucaPost() ──
  console.log('2) retryLucaPost() — aktarılmış belge yeniden gönderilemez');
  {
    const { svc, kayit } = makeSvc(belge({ lucaStatus: 'POSTED' }));
    await reddedildiMi(() => svc.retryLucaPost('t1', 'd1', 'u1'), /aktarılmış|çift fiş/i, 'POSTED belge yeniden gönderilemez');
    ok(kayit.isYazma.length === 0, 'reddedilen denemede ortak işe dokunulmadı');
  }

  // ── BULGU 13: süren ortak iş ──
  console.log('3) retryLucaPost() — süren ortak işe dokunulmuyor');
  for (const durum of ['running', 'pending']) {
    const { svc, kayit } = makeSvc(belge({ lucaStatus: 'POSTING', lucaJobId: 'job1' }), { is: { status: durum } });
    await reddedildiMi(() => svc.retryLucaPost('t1', 'd1', 'u1'), /sürüyor|bekleyin/i, `iş "${durum}" iken yeniden deneme reddedildi`);
    ok(kayit.isYazma.length === 0, `iş "${durum}" iken ortak iş FAILED yapılmadı (kardeş belgeler korunuyor)`);
  }
  {
    // İşi bitmiş ama POSTING'de TAKILI kalmış belge kurtarılabilmeli (nöbetçiyle aynı mantık).
    const { svc, kayit } = makeSvc(belge({ lucaStatus: 'POSTING', lucaJobId: 'job1' }), { is: { status: 'done' } });
    let hata = null;
    try { await svc.retryLucaPost('t1', 'd1', 'u1'); } catch (e) { hata = e; }
    // batchPostToLuca'ya kadar gider; sahte prisma orada eksik olduğu için hata alabilir —
    //   önemli olan KAPININ AÇILMIŞ olması: belge sıfırlama yazması denenmiş olmalı.
    const sifirlama = kayit.belgeYazma.find((a) => a.data && a.data.lucaStatus === 'FAILED');
    ok(!!sifirlama, 'işi bitmiş POSTING belgesi kurtarılabiliyor (sıfırlama denendi)');
    ok(!!sifirlama && sifirlama.where && sifirlama.where.lucaStatus && sifirlama.where.lucaStatus.not === 'POSTED',
      'sıfırlama koşulu POSTED\'i dışlıyor (yarış durumu koruması)');
    ok(!hata || !/sürüyor/i.test(String(hata.message || '')), 'bitmiş işte "sürüyor" hatası verilmiyor');
  }

  // ── EK: update() ──
  console.log('4) update() — aktarılmış belgenin muhasebe alanları kilitli');
  {
    const { svc } = makeSvc(belge({ lucaStatus: 'POSTED' }));
    await reddedildiMi(() => svc.update('t1', 'd1', { totalAmount: '999' }, 'u1'), /aktarılmış|değiştirilemez/i,
      'POSTED belgede tutar değiştirilemez');
    await reddedildiMi(() => svc.update('t1', 'd1', { taxpayerId: 'tp2' }, 'u1'), /aktarılmış|değiştirilemez/i,
      'POSTED belgede mükellef değiştirilemez');
    await reddedildiMi(() => svc.update('t1', 'd1', { invoiceKind: 'SATIS' }, 'u1'), /aktarılmış|değiştirilemez/i,
      'POSTED belgede yön değiştirilemez');
  }
  console.log('5) update() — onay bu yoldan verilemez');
  {
    const { svc } = makeSvc(belge({ status: 'NEEDS_REVIEW', lucaStatus: 'NOT_STARTED' }));
    await reddedildiMi(() => svc.update('t1', 'd1', { status: 'APPROVED' }, 'u1'), /onaylanamaz|Onayla/i,
      'gövdeden status=APPROVED yazılamıyor (mükerrer/demirbaş kapıları atlanamaz)');
  }

  if (failed) { console.error(`\nfatura-cift-kayit-kapilari-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nfatura-cift-kayit-kapilari-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
