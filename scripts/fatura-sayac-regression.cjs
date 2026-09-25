#!/usr/bin/env node
/**
 * FATURA SAYAÇ regresyonu — 2026-09-25 denetim BULGU 7:
 *   "Genel Bakış toplamı güvenilir bir tekil belge sayısı değil"
 *   apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts
 *
 * Kilitlenen davranış (METİN ARAMA DEĞİL — gerçek fonksiyon sahte prisma ile çağrılır):
 *   1) perTaxpayerSummary üç AYRIK aşama sayacı döner ve bunlar tekil toplamı verir:
 *        bekleyen + onayliBekleyen + aktarilmis = tekilToplam = belge sayısı.
 *      Aynı belge iki kümede sayılmaz (eski kalıp pending+posted+issue ÇİFT sayıyordu).
 *   2) Doğrulaması bozuk BEKLEYEN belge toplamda BİR sayılır; "sorunlu" üste binen etikettir,
 *      toplama katılmaz.
 *   3) validationStatus DB SÜTUNUNDAN okunur (ocrData boş olsa bile sorunlu sayılır). Ölü sayacın
 *      kökü buydu: yeniden doğrulama sadece kolonu yazıyor, ocrData'yı güncellemiyor; select'te
 *      kolon hiç istenmediği için alan undefined geliyordu (1.181 belgede yalnız 2 "sorunlu").
 *   4) MANUAL_DONE (Luca'da elle işlendi) belge AKTARILMIŞ sayılır — ön yüzdeki isArchived ile aynı.
 *   5) Banka belgesi de tekil toplama girer (eski ön yüz toplamı pendingBanka'yı dışarıda bırakıyordu).
 *   6) Aşama tanımları ön yüzdeki isArchived / isWaitingTransfer ile BİREBİR aynıdır
 *      (status x lucaStatus tüm kombinasyonları taranır).
 *   7) GERİYE DÖNÜK UYUM: pendingAlis, pendingSatis, pendingBanka, approvedAlis, approvedSatis,
 *      approvedBanka, postedToLuca, hasIssue alanları KALIR (ön yüz ve mobil hâlâ okuyor).
 *   8) summary() de doğrulama durumunu DB sütunundan okur (invalidCount ölü değil).
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

/** Sahte prisma: belgeleri döner, gelen sorguyu (select dahil) kaydeder. */
function makePrisma(docs) {
  const sorgular = [];
  return {
    sorgular,
    invoiceAccountingDocument: {
      findMany: async (args) => { sorgular.push(args); return docs; },
    },
    taxpayer: { findFirst: async () => null, findMany: async () => [] },
  };
}

function makeSvc(prisma) {
  // Constructor yalnız atama yapar (yan etki onModuleInit'te) → sahte bağımlılıklar güvenli.
  const svc = new FaturaMuhasebelestirmeService(prisma, {}, {}, {}, {}, {}, {}, {}, {}, {});
  svc.logger = { warn() {}, log() {}, error() {}, debug() {} };
  return svc;
}

/** Belge kalıbı — sayaçlar için gereken alanlar. */
const belge = (over = {}) => ({
  taxpayerId: 'tp1',
  status: 'NEEDS_REVIEW',
  invoiceKind: 'ALIS',
  documentType: 'E_FATURA',
  lucaStatus: 'NOT_STARTED',
  validationStatus: 'OK',
  ocrData: {},
  ...over,
});

// ÖN YÜZÜN ÖLÇÜSÜ — apps/web/src/app/fatura-merkezi/page.tsx'ten BİREBİR kopya (referans, değiştirilmez).
const fe_isArchived = (d) => d.lucaStatus === 'POSTED' || d.lucaStatus === 'MANUAL_DONE';
const fe_isWaitingTransfer = (d) =>
  !fe_isArchived(d) && (d.status === 'APPROVED' || ['QUEUED', 'POSTING', 'FAILED'].includes(d.lucaStatus));

const satirBul = (rows, tpId) => rows.find((r) => r.taxpayerId === tpId);

(async () => {
  // ── 1) AYRIK KÜMELER: üç kova tekil toplamı verir, hiçbir belge iki kez sayılmaz ──
  console.log('1) perTaxpayerSummary — ayrık kümeler (bekleyen + onayliBekleyen + aktarilmis = tekilToplam)');
  {
    const docs = [
      belge({ status: 'NEEDS_REVIEW' }),                                    // gelen kutusu
      belge({ status: 'READY', invoiceKind: 'SATIS' }),                     // gelen kutusu
      belge({ status: 'APPROVED' }),                                        // aktarım kuyruğu
      belge({ status: 'APPROVED', lucaStatus: 'QUEUED' }),                  // aktarım kuyruğu
      belge({ status: 'READY', lucaStatus: 'FAILED' }),                     // aktarım kuyruğu (ön yüz böyle sayıyor)
      belge({ status: 'APPROVED', lucaStatus: 'POSTED' }),                  // arşiv
      belge({ status: 'APPROVED', lucaStatus: 'MANUAL_DONE' }),             // arşiv (elle işlendi)
    ];
    const prisma = makePrisma(docs);
    const rows = await makeSvc(prisma).perTaxpayerSummary('t1', {});
    const r = satirBul(rows, 'tp1');
    ok(!!r, 'mükellef satırı döndü');
    ok(r.bekleyen === 2, `bekleyen = 2 (gelen: ${r.bekleyen})`);
    ok(r.onayliBekleyen === 3, `onayliBekleyen = 3 (gelen: ${r.onayliBekleyen})`);
    ok(r.aktarilmis === 2, `aktarilmis = 2 — MANUAL_DONE dahil (gelen: ${r.aktarilmis})`);
    ok(r.bekleyen + r.onayliBekleyen + r.aktarilmis === r.tekilToplam,
      `üç kovanın toplamı = tekilToplam (${r.bekleyen}+${r.onayliBekleyen}+${r.aktarilmis} = ${r.tekilToplam})`);
    ok(r.tekilToplam === docs.length, `tekilToplam = gerçek belge sayısı ${docs.length} (gelen: ${r.tekilToplam})`);
    ok(r.bekleyenAlis + r.bekleyenSatis + r.bekleyenBanka === r.bekleyen,
      `yön kırılımı bekleyen'e eşit (${r.bekleyenAlis}+${r.bekleyenSatis}+${r.bekleyenBanka} = ${r.bekleyen})`);
  }

  // ── 2) ÇİFT SAYMA: bozuk doğrulamalı BEKLEYEN belge toplamda BİR sayılır ──
  console.log('2) sorunlu belge üste binen etiket — toplama KATILMAZ');
  {
    const prisma = makePrisma([belge({ status: 'NEEDS_REVIEW', validationStatus: 'INVALID' })]);
    const rows = await makeSvc(prisma).perTaxpayerSummary('t1', {});
    const r = satirBul(rows, 'tp1');
    ok(r.tekilToplam === 1, `tek belge toplamda BİR sayıldı (tekilToplam=${r.tekilToplam})`);
    ok(r.bekleyen === 1 && r.onayliBekleyen === 0 && r.aktarilmis === 0, 'yalnız bekleyen kovasında');
    ok(r.sorunlu === 1, `sorunlu etiketi de aldı (sorunlu=${r.sorunlu})`);
    // Eski ön yüz kalıbı (pending + posted + issue) aynı belgeyi İKİ sayıyordu — kanıt:
    const eskiToplam = Number(r.pendingAlis || 0) + Number(r.pendingSatis || 0)
      + Number(r.postedToLuca || 0) + Number(r.hasIssue || 0);
    ok(eskiToplam === 2 && r.tekilToplam === 1,
      `eski kalıp ${eskiToplam} diyor, yeni tekil sayaç ${r.tekilToplam} — çift sayma kapandı`);
  }

  // ── 3) validationStatus DB SÜTUNUNDAN okunuyor (ölü sayacın kökü) ──
  console.log('3) validationStatus DB SÜTUNUNDAN okunuyor (ocrData boş olsa bile)');
  {
    const prisma = makePrisma([
      belge({ validationStatus: 'INVALID', ocrData: {} }),                        // yalnız kolon
      belge({ validationStatus: 'INCOMPLETE', ocrData: null }),                   // yalnız kolon, ocrData null
      belge({ validationStatus: null, ocrData: { validationStatus: 'INVALID' } }), // eski belge: ocrData'ya düşer
      belge({ validationStatus: 'OK', ocrData: {} }),                             // sağlam
    ]);
    const svc = makeSvc(prisma);
    const rows = await svc.perTaxpayerSummary('t1', {});
    const r = satirBul(rows, 'tp1');
    ok(r.sorunlu === 3, `DB kolonu + eski ocrData birlikte sayıldı → sorunlu=3 (gelen: ${r.sorunlu})`);
    ok(r.hasIssue === r.sorunlu, `eski ad hasIssue aynı değeri taşıyor (${r.hasIssue})`);
    // Kolon SELECT'te gerçekten isteniyor mu — istenmezse canlıda alan undefined gelir, sayaç ölür.
    const sel = prisma.sorgular[0] && prisma.sorgular[0].select;
    ok(!!sel && sel.validationStatus === true,
      `select'te validationStatus: true var (gelen: ${JSON.stringify(sel && sel.validationStatus)})`);
  }

  // ── 4) MANUAL_DONE aktarılmış sayılır, eski postedToLuca davranışı bozulmaz ──
  console.log('4) MANUAL_DONE = aktarılmış (ön yüz isArchived ile aynı)');
  {
    const prisma = makePrisma([belge({ status: 'APPROVED', lucaStatus: 'MANUAL_DONE' })]);
    const rows = await makeSvc(prisma).perTaxpayerSummary('t1', {});
    const r = satirBul(rows, 'tp1');
    ok(r.aktarilmis === 1, `aktarilmis = 1 (gelen: ${r.aktarilmis})`);
    ok(r.onayliBekleyen === 0, 'aktarım kuyruğunda DEĞİL (çift sayma yok)');
    ok(r.bekleyen === 0, 'gelen kutusunda DEĞİL');
    ok(r.tekilToplam === 1, 'tekil toplamda bir kez');
    ok(r.postedToLuca === 0, 'eski postedToLuca yalnız POSTED sayar — davranış korundu');
  }

  // ── 5) Banka belgesi tekil toplama girer (eski ön yüz toplamı dışarıda bırakıyordu) ──
  console.log('5) pendingBanka tekil toplama giriyor');
  {
    const prisma = makePrisma([
      belge({ status: 'READY', documentType: 'BANKA_EKSTRE', invoiceKind: 'ALIS' }),
      belge({ status: 'READY', invoiceKind: 'ALIS' }),
    ]);
    const rows = await makeSvc(prisma).perTaxpayerSummary('t1', {});
    const r = satirBul(rows, 'tp1');
    ok(r.pendingBanka === 1, `eski pendingBanka korundu (${r.pendingBanka})`);
    ok(r.bekleyenBanka === 1, `bekleyenBanka = 1 (gelen: ${r.bekleyenBanka})`);
    ok(r.bekleyen === 2, `banka belgesi bekleyen'e dahil (bekleyen=${r.bekleyen})`);
    ok(r.tekilToplam === 2, `tekilToplam = 2 (gelen: ${r.tekilToplam})`);
    // Eski ön yüz toplamı (pendingAlis + pendingSatis) bankayı görmüyordu:
    ok(Number(r.pendingAlis || 0) + Number(r.pendingSatis || 0) === 1 && r.tekilToplam === 2,
      'eski kalıp bankayı atlıyordu, yeni tekil toplam kapsıyor');
  }

  // ── 6) Aşama tanımları ön yüzle BİREBİR — tüm status x lucaStatus kombinasyonları ──
  console.log('6) aşama tanımları ön yüz isArchived/isWaitingTransfer ile birebir');
  {
    const statuses = ['NEEDS_REVIEW', 'READY', 'APPROVED', 'REJECTED', 'PENDING', 'PROCESSING'];
    const lucaStatuses = ['NOT_STARTED', 'QUEUED', 'POSTING', 'POSTED', 'FAILED', 'MANUAL_DONE'];
    const docs = [];
    for (const status of statuses) {
      for (const lucaStatus of lucaStatuses) {
        docs.push(belge({ taxpayerId: `tp-${status}-${lucaStatus}`, status, lucaStatus }));
      }
    }
    const prisma = makePrisma(docs);
    const rows = await makeSvc(prisma).perTaxpayerSummary('t1', {});
    let uyusmaz = [];
    let toplamTekil = 0;
    for (const d of docs) {
      const r = satirBul(rows, d.taxpayerId);
      if (!r) { uyusmaz.push(`${d.status}/${d.lucaStatus}: satır yok`); continue; }
      toplamTekil += r.tekilToplam;
      const beklenen = fe_isArchived(d) ? 'aktarilmis' : fe_isWaitingTransfer(d) ? 'onayliBekleyen' : 'bekleyen';
      const gelen = r.aktarilmis === 1 ? 'aktarilmis' : r.onayliBekleyen === 1 ? 'onayliBekleyen' : r.bekleyen === 1 ? 'bekleyen' : 'YOK';
      if (beklenen !== gelen) uyusmaz.push(`${d.status}/${d.lucaStatus}: beklenen ${beklenen}, gelen ${gelen}`);
      if (r.tekilToplam !== 1) uyusmaz.push(`${d.status}/${d.lucaStatus}: tekilToplam ${r.tekilToplam} (1 olmalı)`);
      if (r.bekleyen + r.onayliBekleyen + r.aktarilmis !== 1) uyusmaz.push(`${d.status}/${d.lucaStatus}: kümeler çakıştı`);
    }
    ok(uyusmaz.length === 0, `${docs.length} kombinasyonun tamamı ön yüzle aynı kovaya düştü${uyusmaz.length ? ' — ' + uyusmaz.slice(0, 5).join(' | ') : ''}`);
    ok(toplamTekil === docs.length, `tekil toplamların toplamı belge sayısına eşit (${toplamTekil}/${docs.length})`);
  }

  // ── 7) GERİYE DÖNÜK UYUM: eski alanlar duruyor ve aynı davranıyor ──
  console.log('7) geriye dönük uyum — eski alanlar silinmedi');
  {
    const prisma = makePrisma([
      belge({ status: 'READY', invoiceKind: 'ALIS' }),
      belge({ status: 'READY', invoiceKind: 'SATIS' }),
      belge({ status: 'APPROVED', invoiceKind: 'ALIS' }),
      belge({ status: 'APPROVED', invoiceKind: 'SATIS', documentType: 'BANKA_EKSTRE' }),
      belge({ status: 'APPROVED', lucaStatus: 'POSTED' }),
    ]);
    const rows = await makeSvc(prisma).perTaxpayerSummary('t1', {});
    const r = satirBul(rows, 'tp1');
    const eskiAlanlar = ['pendingAlis', 'pendingSatis', 'pendingBanka', 'approvedAlis', 'approvedSatis', 'approvedBanka', 'postedToLuca', 'hasIssue'];
    ok(eskiAlanlar.every((k) => typeof r[k] === 'number'), `eski alanların hepsi sayı olarak duruyor (${eskiAlanlar.join(', ')})`);
    ok(r.pendingAlis === 1 && r.pendingSatis === 1, 'pendingAlis/pendingSatis eski davranış');
    ok(r.approvedAlis === 2 && r.approvedBanka === 1, `approvedAlis=2 (POSTED olan da onaylı), approvedBanka=1 (gelen: ${r.approvedAlis}/${r.approvedBanka})`);
    ok(r.postedToLuca === 1, 'postedToLuca eski davranış (yalnız POSTED)');
    const yeniAlanlar = ['bekleyen', 'bekleyenAlis', 'bekleyenSatis', 'bekleyenBanka', 'onayliBekleyen', 'aktarilmis', 'tekilToplam', 'sorunlu'];
    ok(yeniAlanlar.every((k) => typeof r[k] === 'number'), `yeni alanların hepsi var (${yeniAlanlar.join(', ')})`);
  }

  // ── 8) Mükellefsiz belge satır üretmez (eski davranış) ──
  console.log('8) taxpayerId boş belge satır üretmez');
  {
    const prisma = makePrisma([belge({ taxpayerId: null }), belge({ taxpayerId: '' }), belge({ taxpayerId: 'tp9' })]);
    const rows = await makeSvc(prisma).perTaxpayerSummary('t1', {});
    ok(rows.length === 1 && rows[0].taxpayerId === 'tp9', `yalnız mükellefe bağlı belge satırı döndü (${rows.length} satır)`);
    ok(rows[0].tekilToplam === 1, 'mükellefsiz belgeler tekil toplama da girmiyor (Genel Bakış zaten onları göstermiyor)');
  }

  // ── 9) summary() doğrulama okuması DB sütunundan ──
  console.log('9) summary() — invalidCount DB sütunundan');
  {
    const prisma = makePrisma([
      { status: 'READY', lucaStatus: 'NOT_STARTED', ocrStatus: 'DONE', taxpayerId: 'tp1', validationStatus: 'INVALID', ocrData: {}, invoiceKind: 'ALIS' },
      { status: 'READY', lucaStatus: 'NOT_STARTED', ocrStatus: 'DONE', taxpayerId: 'tp1', validationStatus: 'INCOMPLETE', ocrData: null, invoiceKind: 'SATIS' },
      { status: 'APPROVED', lucaStatus: 'POSTED', ocrStatus: 'DONE', taxpayerId: 'tp1', validationStatus: null, ocrData: { validationStatus: 'INVALID' }, invoiceKind: 'ALIS' },
      { status: 'APPROVED', lucaStatus: 'POSTED', ocrStatus: 'DONE', taxpayerId: 'tp1', validationStatus: 'OK', ocrData: {}, invoiceKind: 'ALIS' },
    ]);
    const out = await makeSvc(prisma).summary('t1', {});
    ok(out.invalidCount === 3, `invalidCount = 3 (DB kolonu + eski ocrData) — gelen: ${out.invalidCount}`);
    ok(out.total === 4, `total tekil belge sayısı (${out.total})`);
    const sel = prisma.sorgular[0] && prisma.sorgular[0].select;
    ok(!!sel && sel.validationStatus === true,
      `summary select'inde validationStatus: true var (gelen: ${JSON.stringify(sel && sel.validationStatus)})`);
  }

  if (failed) { console.error(`\nfatura-sayac-regression: ${failed} BAŞARISIZ`); process.exit(1); }
  console.log('\nfatura-sayac-regression ok');
})().catch((e) => { console.error(`beklenmeyen hata: ${(e && e.stack) || e}`); process.exit(1); });
