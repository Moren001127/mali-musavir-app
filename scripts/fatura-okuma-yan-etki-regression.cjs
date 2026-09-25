#!/usr/bin/env node
/**
 * OKUMA YAN ETKİSİ regresyonu — 2026-09-25 denetim bulgusu 11.
 *   apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts
 *
 * Kilitlenen davranış (METİN ARAMA DEĞİL — gerçek fonksiyon sahte prisma ile çağrılır):
 *   1) list() salt okumadır: invoiceAccountingLine.updateMany ASLA çağrılmaz.
 *      (Eskiden list() ilk satırında gateExistingDocsIfNoPlan kalıcı silme yapıyordu; dönem sınırı
 *       yoktu, elle girilen kodu korumuyordu, logAudit yoktu ve .catch(()=>{}) ile sessizdi.)
 *   2) Plan YOK → dönen satırların hesap kodu GİZLENİR (ekran "Eksik" görür) ama DB'ye yazılmaz.
 *   3) Onaylı (APPROVED) belgenin kodu maskelenmez — eski kalıcı kapı da status!='APPROVED' ile sınırlıydı.
 *   4) Plan VAR → planda olmayan placeholder gizlenir, planda OLAN gerçek kod korunur.
 *   5) get() aynı kapıyı uygular (approve() belgeyi get() ile alır; plansız mükellefte placeholder
 *      kodun Luca dosyasına sızmaması buna bağlı).
 *   6) Kalıcı temizlik yolu (reapplyAccountCodes → gateExistingDocsIfNoPlan) kaynak='KULLANICI'
 *      satırlarına DOKUNMAZ.
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

/** Sahte prisma: yazma çağrılarını kaydeder (çağrılmaması gerekenleri yakalamak için). */
function makePrisma(docs) {
  const yazmalar = [];
  return {
    yazmalar,
    invoiceAccountingDocument: {
      findMany: async () => docs,
      findFirst: async () => docs[0] || null,
    },
    invoiceAccountingLine: {
      updateMany: async (args) => { yazmalar.push({ tablo: 'invoiceAccountingLine', args }); return { count: 0 }; },
    },
    taxpayer: { findMany: async () => [], findFirst: async () => null },
  };
}

function makeSvc(prisma, planCodes) {
  // Constructor yalnız atama yapar (gövdesi boş, yan etki onModuleInit'te) → sahte bağımlılıklar güvenli.
  const svc = new FaturaMuhasebelestirmeService(prisma, {}, {}, {}, {}, {}, {}, {}, {}, {});
  svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
  // Plan okuma ayrı konu → sabitlenir (null = plan yok, Set = plan var).
  svc.getPlanCodeSet = async () => planCodes;
  return svc;
}

const belge = (over = {}) => ({
  id: 'd1', tenantId: 't1', taxpayerId: 'tp1', status: 'NEEDS_REVIEW',
  invoiceKind: 'ALIS', totalAmount: 1180, ocrData: {}, validationStatus: 'OK',
  lines: [
    { id: 'l1', orderNo: 1, group: 'matrah', accountCode: '770.01.010', kaynak: 'AI', description: 'Genel gider' },
    { id: 'l2', orderNo: 2, group: 'vergi', accountCode: '191.01.001', kaynak: 'KURAL', description: 'İndirilecek KDV' },
    { id: 'l3', orderNo: 3, group: 'cari', accountCode: '320.01.001', kaynak: 'KULLANICI', description: 'Satıcı' },
  ],
  ...over,
});

(async () => {
  // ── 1+2) Plan YOK: kod gizlenir, DB'ye YAZILMAZ ──
  console.log('1) list() plan YOK — gizle ama yazma');
  {
    const prisma = makePrisma([belge()]);
    const svc = makeSvc(prisma, null);
    const out = await svc.list('t1', { taxpayerId: 'tp1' });
    const kodlar = out[0].lines.map((l) => l.accountCode);
    ok(kodlar.every((k) => k === null), `plan yok → tüm kodlar gizlendi (gelen: ${JSON.stringify(kodlar)})`);
    ok(prisma.yazmalar.length === 0, `list() hiç yazma yapmadı (yazma sayısı: ${prisma.yazmalar.length})`);
    ok(out[0].guven && out[0].guven.seviye === 'dusuk', `güven skoru maskeli satırdan hesaplandı (${out[0].guven && out[0].guven.seviye})`);
  }

  // ── 3) Onaylı belge maskelenmez ──
  console.log('2) list() APPROVED belge — dokunulmaz');
  {
    const prisma = makePrisma([belge({ status: 'APPROVED' })]);
    const svc = makeSvc(prisma, null);
    const out = await svc.list('t1', { taxpayerId: 'tp1' });
    ok(out[0].lines[0].accountCode === '770.01.010', 'onaylı belgenin kodu korunur');
    ok(prisma.yazmalar.length === 0, 'onaylı belgede de yazma yok');
  }

  // ── 4) Plan VAR: placeholder gizlenir, gerçek kod kalır ──
  console.log('3) list() plan VAR — yalnız planda olmayan placeholder gizlenir');
  {
    // 320.01.001 planda VAR (elle girilmiş gerçek cari), 770.01.010 ve 191.01.001 planda YOK.
    const prisma = makePrisma([belge()]);
    const svc = makeSvc(prisma, new Set(['320.01.001', '600.01.001']));
    const out = await svc.list('t1', { taxpayerId: 'tp1' });
    const byId = Object.fromEntries(out[0].lines.map((l) => [l.id, l.accountCode]));
    ok(byId.l3 === '320.01.001', 'planda OLAN kod korundu (320.01.001)');
    ok(byId.l1 === null, 'planda olmayan placeholder gizlendi (770.01.010)');
    ok(prisma.yazmalar.length === 0, 'plan varken de yazma yok');
  }

  // ── 5) get() aynı kapıyı uygular ──
  console.log('4) get() — approve() bu kapıdan besleniyor');
  {
    const prisma = makePrisma([belge()]);
    const svc = makeSvc(prisma, null);
    const doc = await svc.get('t1', 'd1');
    ok(doc.lines.every((l) => l.accountCode === null), 'get() plan yokken kodu gizler (placeholder Luca dosyasına sızmaz)');
    ok(prisma.yazmalar.length === 0, 'get() hiç yazma yapmadı');
  }

  // ── 6) Kalıcı yol elle girilen kodu korur ──
  console.log('5) gateExistingDocsIfNoPlan (kalıcı yol) — KULLANICI kodu korunur');
  {
    const prisma = makePrisma([{ id: 'd1' }]);
    const svc = makeSvc(prisma, null);
    await svc.gateExistingDocsIfNoPlan('t1', 'tp1');
    const y = prisma.yazmalar[0];
    ok(!!y, 'kalıcı yol gerçekten yazma yapıyor (açık işlem olduğu için doğru)');
    const kaynakKosulu = y && y.args && y.args.where && y.args.where.kaynak;
    ok(!!kaynakKosulu && kaynakKosulu.not === 'KULLANICI',
      `where.kaynak = { not: 'KULLANICI' } gönderildi (gelen: ${JSON.stringify(kaynakKosulu)})`);
  }

  if (failed) { console.error(`\nfatura-okuma-yan-etki-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nfatura-okuma-yan-etki-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
