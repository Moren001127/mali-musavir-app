#!/usr/bin/env node
/**
 * KALICI BELGE KUYRUĞU regresyonu — Fatura Merkezi (2026-09-13).
 *   apps/api/src/fatura-muhasebelestirme/belge-kuyruk.service.ts (işçi, gece, durum, tekrar-dene)
 *   apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts (kanca: classifyPending / aiReadBatch /
 *     resumeStuckOcr → DB kuyruğu; kuyrukIsle sarmalayıcısı)
 *   apps/api/prisma/schema.prisma (InvoiceProcessingJob) + migrations/20260913_belge_kuyruk
 *   controller: GET kuyruk/durum, POST kuyruk/tekrar-dene · module: BelgeKuyrukService provider
 *
 * NEDEN: bellek-içi uploadOcrQueue her deploy'da siliniyordu; sahip classify-pending / ai-read-batch ile elle
 *   yeniden dolduruyordu. Canlı ölçüm: tek Max sınıflandırma 95-153 sn, partiler grup=1 kalıyordu.
 *
 * Kilitler:
 *   1) Kaynak: classifyPending ve aiReadBatch kanca bağlıyken DB kuyruğuna (topluKuyrugaAl) yazar; bellek-içi push
 *      yalnız kanca yokken (geriye uyum). resumeStuckOcr CLASSIFY-kurtarma DB'ye priority 0, 200 tavan.
 *   2) Kaynak: gece cron '0 45 3 * * *' Europe/Istanbul + FM_GECE_KUYRUK env kapısı + AuditLog GECE_KUYRUK.
 *   3) Kaynak: şema modeli + migration yalnız CREATE IF NOT EXISTS (DROP yok); modül provider; controller uçları;
 *      classify-pending / ai-read-batch rotaları AYNI kaldı.
 *   4) Saf: geceKuyrukEnvKapaliMi, kuyrukAyarlari, belgeIcerikVarMi/belgeSinifliMi.
 *   5) Uçtan uca (sahte prisma): FaturaMuhasebelestirmeService + BelgeKuyrukService bağlanır → classifyPending
 *      DB'ye priority 10 yazar (dönüş şekli kuyrugaAlinan korunur), aiReadBatch AI_READ priority 10 yazar, idempotent;
 *      işçi tiki partiyi kuyrukIsle ile AYNI ANDA başlatır → DONE.
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node')).register({
  transpileOnly: true,
  project: path.join(ROOT, 'apps', 'api', 'tsconfig.json'),
});

let failed = 0;
function assert(ok, msg) { if (!ok) { failed++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); }
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SVC = oku('apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts');
const KUY = oku('apps/api/src/fatura-muhasebelestirme/belge-kuyruk.service.ts');
const CTRL = oku('apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.controller.ts');
const MOD = oku('apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.module.ts');
const SCHEMA = oku('apps/api/prisma/schema.prisma');
const MIG = oku('apps/api/prisma/migrations/20260913_belge_kuyruk/migration.sql');

function govde(src, imza) {
  const i = src.indexOf(imza);
  if (i < 0) return '';
  return src.slice(i, i + 6000);
}

console.log('1) kaynak kilitleri — kancalar');
{
  assert(/kuyrukBagla\(k: BelgeKuyrukKancasi\)/.test(SVC), 'FaturaMuhasebelestirmeService.kuyrukBagla var');
  assert(/async kuyrukIsle\(kind: 'CLASSIFY' \| 'AI_READ'/.test(SVC), 'kuyrukIsle(kind, tenantId, ids) sarmalayıcısı var');
  const cp = govde(SVC, 'async classifyPending(');
  assert(/this\.belgeKuyrugu\.topluKuyrugaAl\(dbIsleri\)/.test(cp) && /priority: 10/.test(cp), 'classifyPending → DB kuyruğu priority 10');
  assert(/kuyrugaAlinan: alinan/.test(cp), 'classifyPending dönüş şekli (kuyrugaAlinan) korundu');
  assert(/else this\.uploadOcrQueue\.push\(\{ tenantId: d\.tenantId, documentId: d\.id, kind: 'classify' \}\)/.test(cp), 'classifyPending bellek-içi push yalnız kanca yokken (geriye uyum)');
  const ab = govde(SVC, 'async aiReadBatch(');
  assert(/this\.belgeKuyrugu\.topluKuyrugaAl\(docs\.map/.test(ab) && /kind: 'AI_READ' as const, priority: 10/.test(ab), 'aiReadBatch → DB kuyruğu AI_READ priority 10');
  assert(/return \{ queued: docs\.length, skipped: ids\.length - docs\.length/.test(ab), 'aiReadBatch dönüş şekli (queued/skipped) korundu');
  const rs = govde(SVC, 'async resumeStuckOcr(');
  assert(/kind: 'CLASSIFY', priority: 0/.test(rs) && /const tavan = this\.belgeKuyrugu \? 200 : 30/.test(rs), 'resumeStuckOcr CLASSIFY-kurtarma → DB priority 0, tavan 200');
  assert(/kind: 'AI_READ', priority: 0/.test(rs), 'resumeStuckOcr öksüz PENDING → DB AI_READ priority 0');
  assert(/job\.kind === 'classify'\s*\?\s*this\.runQueuedClassify/.test(SVC) && /job\.kind === 'ai-read'\s*\?\s*this\.runQueuedAiRead/.test(SVC), 'drainUploadedOcrQueue classify/ai-read dalları KALDI (geriye uyum)');
  assert(/this\.uploadOcrQueue\.length === 0 && this\.kuyrukAktif <= 1/.test(SVC), 'okuma-içi yorum DB kuyruğunda toplu okumada bastırılır (kuyrukAktif)');
  assert(!/import .*belge-kuyruk\.service/.test(SVC), 'fatura servisi belge-kuyruk.service dosyasını import ETMEZ (döngü yok)');
}

console.log('2) kaynak kilitleri — gece + işçi');
{
  assert(/GECE_KUYRUK_CRON = '0 45 3 \* \* \*'/.test(KUY) && /@Cron\(GECE_KUYRUK_CRON, \{ timeZone: 'Europe\/Istanbul' \}\)/.test(KUY), "gece cron 03:45 Europe/Istanbul");
  assert(/geceKuyrukEnvKapaliMi\(\)\) \{/.test(KUY) && /FM_GECE_KUYRUK/.test(KUY), 'FM_GECE_KUYRUK env kapısı geceTik başında');
  assert(/action: 'GECE_KUYRUK', resource: 'belge-kuyruk'/.test(KUY), 'AuditLog GECE_KUYRUK yazılır');
  assert(/@Interval\(ISCI_TIK_MS\)/.test(KUY) && /ISCI_TIK_MS = 5000/.test(KUY), 'işçi @Interval 5000');
  assert(/BAYAT_KILIT_MS = 15 \* 60 \* 1000/.test(KUY) && /MAX_DENEME = 3/.test(KUY), 'bayat kilit 15 dk, en fazla 3 deneme');
  assert(/FM_KUYRUK_OKUMA_ESZAMANLI/.test(KUY) && /FM_KUYRUK_SINIF_PARTI_ESZAMANLI/.test(KUY) && /MAX_CLASSIFY_BATCH/.test(KUY), 'kapasite env anahtarları');
  assert(/GECE_TAVAN = 400/.test(KUY), 'gece tavanı 400');
  assert(/async geceKuyrukOzeti\(tenantId: string\)/.test(KUY), 'geceKuyrukOzeti(tenantId) sabah özeti metodu sunuluyor');
  assert(/\[KUYRUK\] parti=\$\{isler\.length\} tp=/.test(KUY), 'log biçimi [KUYRUK] parti=N tp=… kind=… sure=…ms');
  assert(/lastError: hata \? String\(hata\)\.slice\(0, 300\)/.test(KUY), 'hata mesajı 300 karakter');
}

console.log('3) kaynak kilitleri — şema / migration / modül / controller');
{
  assert(/model InvoiceProcessingJob \{/.test(SCHEMA) && /@@map\("invoice_processing_jobs"\)/.test(SCHEMA), 'Prisma modeli InvoiceProcessingJob → invoice_processing_jobs');
  assert(/@@index\(\[tenantId, status, priority, createdAt\]\)/.test(SCHEMA) && /@@index\(\[documentId, status\]\)/.test(SCHEMA), 'şema indeksleri');
  assert(/CREATE TABLE IF NOT EXISTS "invoice_processing_jobs"/.test(MIG) && !/DROP/i.test(MIG) && !/ALTER TABLE/i.test(MIG), 'migration yalnız CREATE IF NOT EXISTS (DROP/ALTER yok)');
  assert(/"invoice_processing_jobs_tenantId_status_priority_createdAt_idx"/.test(MIG) && /"invoice_processing_jobs_documentId_status_idx"/.test(MIG), 'migration indeks adları Prisma kalıbında');
  assert(/BelgeKuyrukService/.test(MOD) && /providers: \[[^\]]*BelgeKuyrukService/.test(MOD), 'modül provider kaydı');
  assert(/@Get\('kuyruk\/durum'\)/.test(CTRL) && /@Post\('kuyruk\/tekrar-dene'\)/.test(CTRL), 'controller uçları kuyruk/durum + kuyruk/tekrar-dene');
  assert(/@Post\('documents\/classify-pending'\)/.test(CTRL) && /@Post\('documents\/ai-read-batch'\)/.test(CTRL), 'classify-pending / ai-read-batch rotaları aynı');
  const td = govde(CTRL, "@Post('kuyruk/tekrar-dene')");
  assert(/@UseGuards\(OwnerOnlyGuard\)/.test(td.slice(0, 200)), 'tekrar-dene yalnız sahip');
}

console.log('4) saf fonksiyonlar');
const K = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/belge-kuyruk.service.ts'));
{
  assert(K.geceKuyrukEnvKapaliMi(undefined) === false && K.geceKuyrukEnvKapaliMi('on') === false, 'env tanımsız/on → açık');
  assert(K.geceKuyrukEnvKapaliMi('off') && K.geceKuyrukEnvKapaliMi('0') && K.geceKuyrukEnvKapaliMi('false') && K.geceKuyrukEnvKapaliMi('KAPALI'), 'env off/0/false/kapali → kapalı');
  const a = K.kuyrukAyarlari({});
  assert(a.okumaEszamanli === 4 && a.sinifPartiEszamanli === 2 && a.partiBoyu === 10, 'varsayılan ayarlar 4/2/10');
  assert(K.kuyrukAyarlari({ FM_KUYRUK_OKUMA_ESZAMANLI: '0' }).okumaEszamanli === 1, 'en az 1');
  assert(K.belgeIcerikVarMi({ kalemler: [{ ad: 'x' }] }) && K.belgeIcerikVarMi({ icerikMetni: 'abc' }) && !K.belgeIcerikVarMi({}), 'belgeIcerikVarMi');
  assert(K.belgeSinifliMi({ giderTuru: 'X' }) && K.belgeSinifliMi({ kategori: 'SARF' }) && !K.belgeSinifliMi({}), 'belgeSinifliMi');
  assert(K.KUYRUK_ONCELIK.ARKA_PLAN === 0 && K.KUYRUK_ONCELIK.ITHAL === 3 && K.KUYRUK_ONCELIK.GECE === 5 && K.KUYRUK_ONCELIK.SAHIP === 10, 'öncelik sözlüğü 0/3/5/10');
}

console.log('5) uçtan uca (sahte prisma): fatura servisi + kuyruk servisi bağlanır');
// mini sahte tablo (spec ile aynı kalıp)
function esles(row, where) {
  for (const [k, v] of Object.entries(where || {})) {
    if (k === 'OR') { if (!v.some((w) => esles(row, w))) return false; continue; }
    const val = row[k];
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v && !v.in.includes(val)) return false;
      if ('notIn' in v && v.notIn.includes(val)) return false;
      if ('lt' in v && !(val != null && val < v.lt)) return false;
      if ('gte' in v && !(val != null && val >= v.gte)) return false;
      if ('not' in v && val === v.not) return false;
    } else if (val !== v) return false;
  }
  return true;
}
function sirala(rows, orderBy) {
  const ob = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...rows].sort((a, b) => { for (const o of ob) { const [k, dir] = Object.entries(o)[0]; if (a[k] === b[k]) continue; const c = a[k] > b[k] ? 1 : -1; return dir === 'desc' ? -c : c; } return 0; });
}
function tablo(rows) {
  let seq = 0;
  const uygula = (row, data) => { for (const [k, v] of Object.entries(data)) { if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) row[k] = (row[k] || 0) + v.increment; else row[k] = v; } };
  return {
    rows,
    findMany: async (q = {}) => { let r = sirala(rows.filter((x) => esles(x, q.where)), q.orderBy); if (q.take) r = r.slice(0, q.take); return r.map((x) => ({ ...x })); },
    findFirst: async (q = {}) => { const r = sirala(rows.filter((x) => esles(x, q.where)), q.orderBy); return r[0] ? { ...r[0] } : null; },
    count: async (q = {}) => rows.filter((x) => esles(x, q.where)).length,
    createMany: async (q) => { for (const d of q.data) rows.push({ id: `j${++seq}`, attempts: 0, lastError: null, lockedBy: null, lockedAt: null, startedAt: null, finishedAt: null, createdAt: new Date(Date.now() + seq), ...d }); return { count: q.data.length }; },
    updateMany: async (q) => { const r = rows.filter((x) => esles(x, q.where)); for (const row of r) uygula(row, q.data); return { count: r.length }; },
    update: async (q) => { const row = rows.find((x) => esles(x, q.where)); if (row) uygula(row, q.data); return row; },
    groupBy: async (q) => [...new Set(rows.filter((x) => esles(x, q.where)).map((x) => x.tenantId))].map((tenantId) => ({ tenantId })),
  };
}
const bekle = () => new Promise((r) => setImmediate(r));

(async () => {
  const { FaturaMuhasebelestirmeService } = require(path.join(ROOT, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'));
  const docs = tablo([
    { id: 'd1', tenantId: 't1', taxpayerId: 'tpA', invoiceKind: 'ALIS', status: 'READY', ocrStatus: 'SUCCESS', ocrData: { readMode: 'ubl-xml', kalemler: [{ ad: 'lastik' }] }, updatedAt: new Date(3) },
    { id: 'd2', tenantId: 't1', taxpayerId: 'tpA', invoiceKind: 'ALIS', status: 'READY', ocrStatus: 'SUCCESS', ocrData: { readMode: 'ubl-xml', kalemler: [{ ad: 'yağ' }] }, updatedAt: new Date(2) },
    { id: 'd3', tenantId: 't1', taxpayerId: 'tpA', invoiceKind: 'ALIS', status: 'READY', ocrStatus: 'SUCCESS', ocrData: { readMode: 'ubl-xml', kalemler: [{ ad: 'a' }], giderTuru: 'X' }, updatedAt: new Date(1) }, // zaten sınıflı
    { id: 'd4', tenantId: 't1', taxpayerId: 'tpA', invoiceKind: 'ALIS', status: 'READY', ocrStatus: 'SUCCESS', ocrData: {}, updatedAt: new Date(0) }, // içerik yok
  ]);
  const jobs = tablo([]);
  const prisma = { invoiceAccountingDocument: docs, invoiceProcessingJob: jobs, lucaAccountPlanSnapshot: tablo([]), auditLog: { create: async (q) => q.data } };
  const fm = new FaturaMuhasebelestirmeService(prisma, {}, {}, {}, {}, {}, {}, {}, {}, {});
  fm.logger = { log() {}, warn() {}, error() {}, debug() {} };
  const kuyruk = new K.BelgeKuyrukService(prisma, fm);
  kuyruk.logger = { log() {}, warn() {}, error() {}, debug() {} };

  assert(fm.belgeKuyruguBagliMi() === false, 'bağlanmadan önce kanca yok');
  kuyruk.onModuleInit();
  assert(fm.belgeKuyruguBagliMi() === true, 'onModuleInit → kanca bağlı');

  // classifyPending → DB kuyruğu
  const r1 = await fm.classifyPending('t1', { taxpayerId: 'tpA' });
  assert(r1.ok && r1.kuyrugaAlinan === 2 && r1.zatenSinifli === 1 && r1.icerikYok === 1 && r1.kalici === true, `classifyPending → DB: ${JSON.stringify(r1)}`);
  assert(jobs.rows.length === 2 && jobs.rows.every((j) => j.kind === 'CLASSIFY' && j.priority === 10 && j.status === 'PENDING' && j.taxpayerId === 'tpA'), 'DB: 2 CLASSIFY iş, priority 10, PENDING');
  assert(fm.uploadOcrQueue.length === 0, 'bellek-içi kuyruğa YAZILMADI');
  const r2 = await fm.classifyPending('t1', { taxpayerId: 'tpA' });
  assert(r2.kuyrugaAlinan === 0 && r2.zatenKuyrukta === 2 && jobs.rows.length === 2, 'ikinci çağrı idempotent (zatenKuyrukta=2)');

  // aiReadBatch → DB kuyruğu AI_READ priority 10 (+ ocrStatus PENDING)
  const r3 = await fm.aiReadBatch('t1', ['d4', 'yok']);
  assert(r3.queued === 1 && r3.skipped === 1 && r3.kalici === true, `aiReadBatch → DB: ${JSON.stringify(r3)}`);
  const okumaIsi = jobs.rows.find((j) => j.kind === 'AI_READ');
  assert(okumaIsi && okumaIsi.documentId === 'd4' && okumaIsi.priority === 10, 'AI_READ d4 priority 10');
  assert(docs.rows.find((d) => d.id === 'd4').ocrStatus === 'PENDING', 'aiReadBatch ocrStatus PENDING yazdı (şerit)');

  // işçi tiki: CLASSIFY partisi kuyrukIsle ile AYNI ANDA (tek çağrı, 2 belge)
  const cagrilar = [];
  fm.kuyrukIsle = async (kind, tenantId, ids) => { cagrilar.push({ kind, ids }); return ids.map((documentId) => ({ documentId, ok: kind === 'CLASSIFY' })); };
  process.env.FM_KUYRUK_OKUMA_ESZAMANLI = '1';
  const t = await kuyruk.tik();
  await bekle(); await bekle(); await bekle();
  assert(t.baslatilanParti === 1 && t.baslatilanOkuma === 1, `tik: parti=1 okuma=1 (${JSON.stringify(t)})`);
  const parti = cagrilar.find((c) => c.kind === 'CLASSIFY');
  assert(parti && parti.ids.length === 2 && parti.ids.includes('d1') && parti.ids.includes('d2'), 'CLASSIFY partisi: d1+d2 tek kuyrukIsle çağrısı (aynı anda → koalesans)');
  assert(jobs.rows.filter((j) => j.kind === 'CLASSIFY').every((j) => j.status === 'DONE' && j.finishedAt && j.lockedBy === null), 'parti DONE, kilit bırakıldı');
  assert(okumaIsi.status === 'FAILED' && okumaIsi.lastError, 'AI_READ ok:false → FAILED + hata');

  // durum + tekrar-dene
  const d = await kuyruk.durum('t1');
  assert(d.pending.CLASSIFY === 0 && d.pending.AI_READ === 0 && d.done24h === 2 && d.failed24h === 1 && d.sonHata.length === 1, `durum: ${JSON.stringify({ p: d.pending, done: d.done24h, failed: d.failed24h })}`);
  const td = await kuyruk.tekrarDene('t1', { hepsi: true });
  assert(td.tekrarDenenen === 1 && okumaIsi.status === 'PENDING' && okumaIsi.attempts === 0, 'tekrar-dene hepsi → FAILED→PENDING');

  // gece özeti metni
  const oz = await kuyruk.geceKuyrukOzeti('t1');
  assert(/2 belge sınıflandı/.test(oz.metin), `özet: ${oz.metin}`);

  console.log(failed ? `\n${failed} KİLİT KIRILDI` : '\nTÜM KİLİTLER SAĞLAM');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HATA', e); process.exit(1); });
