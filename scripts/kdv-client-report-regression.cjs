const assert = require('assert');
const path = require('path');

require('../apps/api/node_modules/ts-node').register({
  transpileOnly: true,
  project: path.join(__dirname, '../apps/api/tsconfig.json'),
});

const {
  FaturaMuhasebelestirmeService,
} = require('../apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts');

function makeService({ invoices, docs, breakdownRows = [], sessions = [], statsBySession = {} }) {
  const prisma = {
    taxpayer: {
      findFirst: async () => ({
        id: 'tp1',
        companyName: 'Demo Ltd',
        firstName: null,
        lastName: null,
        taxNumber: '1234567890',
        identityNumber: null,
        defterTuru: 'BILANCO',
        mihsapDefterTuru: null,
      }),
    },
    earsivFatura: {
      findMany: async () => invoices,
    },
    invoiceAccountingDocument: {
      findMany: async () => docs,
    },
    kdvControlSession: {
      findMany: async () => sessions,
    },
    $queryRawUnsafe: async () => breakdownRows,
  };
  const kdvControl = {
    getSessionStats: async (sessionId) => statsBySession[sessionId] || {},
  };

  return new FaturaMuhasebelestirmeService(
    prisma,
    {},
    {},
    kdvControl,
    {},
    {},
  );
}

const invoices = [
  {
    id: 'alis-mal',
    tip: 'ALIS',
    belgeKaynak: 'EFATURA',
    donem: '2026-05',
    faturaNo: 'A-1',
    faturaTarihi: new Date('2026-05-02T00:00:00Z'),
    satici: 'Ana Tedarik AŞ',
    saticiVergiNo: '1111111111',
    alici: 'Demo Ltd',
    aliciVergiNo: '1234567890',
    matrah: 1000,
    kdvTutari: 200,
    kdvOrani: 20,
    toplamTutar: 1200,
    durum: 'KABUL',
  },
  {
    id: 'alis-masraf',
    tip: 'ALIS',
    belgeKaynak: 'EARSIV',
    donem: '2026-05',
    faturaNo: 'B-1',
    faturaTarihi: new Date('2026-05-03T00:00:00Z'),
    satici: 'Masraf Hizmetleri Ltd',
    saticiVergiNo: '2222222222',
    alici: 'Demo Ltd',
    aliciVergiNo: '1234567890',
    matrah: 500,
    kdvTutari: 50,
    kdvOrani: 10,
    toplamTutar: 550,
    durum: 'KABUL',
  },
  {
    id: 'alis-kodsuz',
    tip: 'ALIS',
    belgeKaynak: 'EARSIV',
    donem: '2026-05',
    faturaNo: 'C-1',
    faturaTarihi: new Date('2026-05-04T00:00:00Z'),
    satici: 'Kod Bekleyen Ltd',
    saticiVergiNo: '3333333333',
    alici: 'Demo Ltd',
    aliciVergiNo: '1234567890',
    matrah: 100,
    kdvTutari: 20,
    kdvOrani: 20,
    toplamTutar: 120,
    durum: 'KABUL',
  },
  {
    id: 'satis',
    tip: 'SATIS',
    belgeKaynak: 'EFATURA',
    donem: '2026-05',
    faturaNo: 'S-1',
    faturaTarihi: new Date('2026-05-05T00:00:00Z'),
    satici: 'Demo Ltd',
    saticiVergiNo: '1234567890',
    alici: 'Büyük Müşteri AŞ',
    aliciVergiNo: '4444444444',
    matrah: 2000,
    kdvTutari: 400,
    kdvOrani: 20,
    toplamTutar: 2400,
    durum: 'KABUL',
  },
];

const docs = [
  {
    id: 'doc-alis-mal',
    source: 'earsiv',
    sourceRefId: 'alis-mal',
    s3Key: '',
    invoiceKind: 'ALIS',
    belgeNo: 'A-1',
    status: 'APPROVED',
    ocrData: { validationStatus: 'OK' },
    lines: [
      { group: 'matrah', accountCode: '153.01.001', debit: 1000, credit: 0 },
      { group: 'vergi', accountCode: '191.01.020', debit: 200, credit: 0 },
    ],
  },
  {
    id: 'doc-alis-masraf',
    source: 'earsiv',
    sourceRefId: 'alis-masraf',
    s3Key: '',
    invoiceKind: 'ALIS',
    belgeNo: 'B-1',
    status: 'READY',
    ocrData: { validationStatus: 'OK' },
    lines: [
      { group: 'matrah', accountCode: '770.01.010', debit: 500, credit: 0 },
      { group: 'vergi', accountCode: '191.01.010', debit: 50, credit: 0 },
    ],
  },
  {
    id: 'doc-alis-kodsuz',
    source: 'earsiv',
    sourceRefId: 'alis-kodsuz',
    s3Key: '',
    invoiceKind: 'ALIS',
    belgeNo: 'C-1',
    status: 'NEEDS_REVIEW',
    ocrData: { validationStatus: 'INCOMPLETE', validationIssues: [{ code: 'INCOMPLETE_AMOUNTS' }] },
    lines: [
      { group: 'matrah', accountCode: null, debit: 100, credit: 0 },
      { group: 'vergi', accountCode: '191.01.020', debit: 20, credit: 0 },
    ],
  },
  {
    id: 'doc-satis',
    source: 'earsiv',
    sourceRefId: 'satis',
    s3Key: '',
    invoiceKind: 'SATIS',
    belgeNo: 'S-1',
    status: 'APPROVED',
    ocrData: { validationStatus: 'OK' },
    lines: [
      { group: 'matrah', accountCode: '600.01.001', debit: 0, credit: 2000 },
      { group: 'vergi', accountCode: '391.01.020', debit: 0, credit: 400 },
    ],
  },
];

async function main() {
  const service = makeService({
    invoices,
    docs,
    breakdownRows: [
      { id: 'alis-mal', kdvBreakdown: [{ rate: 20, base: 1000, amount: 200 }] },
      { id: 'alis-masraf', kdvBreakdown: [{ rate: 10, base: 500, amount: 50 }] },
      { id: 'satis', kdvBreakdown: [{ rate: 20, base: 2000, amount: 400 }] },
    ],
    sessions: [
      { id: 'kdv-alis', type: 'KDV_191', periodLabel: '2026/05', status: 'COMPLETED', updatedAt: new Date() },
      { id: 'kdv-satis', type: 'KDV_391', periodLabel: '2026/05', status: 'REVIEWING', updatedAt: new Date() },
    ],
    statsBySession: {
      'kdv-alis': { matched: 2, partialMatch: 1, unmatched: 0, needsReview: 0, rejected: 0, totalRecords: 3, totalImages: 3 },
      'kdv-satis': {
        matched: 1,
        partialMatch: 0,
        unmatched: 1,
        needsReview: 0,
        rejected: 0,
        totalRecords: 2,
        totalImages: 2,
        seriUyarilari: [{ mesaj: 'Satış seri takibinde atlama var.' }],
      },
    },
  });

  const report = await service.kdvClientReport('tenant-1', { taxpayerId: 'tp1', period: '2026-05' });

  assert.strictEqual(report.totals.purchaseGoodsBase, 1000);
  assert.strictEqual(report.totals.expensesBase, 500);
  assert.strictEqual(report.totals.unclassifiedPurchaseBase, 100);
  assert.strictEqual(report.totals.deductibleVat, 270);
  assert.strictEqual(report.totals.calculatedVat, 400);
  assert.strictEqual(report.totals.periodVatDifference, 130);
  assert.strictEqual(report.topSuppliers[0].name, 'Ana Tedarik AŞ');
  assert.strictEqual(report.topCustomers[0].name, 'Büyük Müşteri AŞ');
  assert.strictEqual(report.quality.missingAccountCodeCount, 1);
  assert.strictEqual(report.quality.unclassifiedCount, 1);
  assert.ok(report.vatByRate.some((row) => row.side === 'ALIS' && row.label === '%10' && row.vat === 50));
  assert.ok(report.vatByRate.some((row) => row.side === 'SATIS' && row.label === '%20' && row.vat === 400));
  assert.ok(report.controls.warnings.some((line) => line.includes('Satış seri takibinde atlama var')));
  assert.ok(report.assessment.some((line) => line.includes('dönem içi ödeme yönü')));

  const noControlService = makeService({ invoices: [invoices[0]], docs: [docs[0]], sessions: [] });
  const noControlReport = await noControlService.kdvClientReport('tenant-1', { taxpayerId: 'tp1', period: '2026-05' });
  assert.ok(noControlReport.controls.warnings.some((line) => line.includes('kontrol oturumu bulunamadı')));

  // ── PLAN/16 §D — durum süzgeci + iade + tevkifat + KDV dışı vergi + hesap atanmamış + drilldown ──
  // Temel: yalnız onaylı alış (1000/200) + satış (2000/400). kaynak sayaçları.
  assert.strictEqual(report.kaynak.belge, 4, 'kaynak.belge = toplama giren satır sayısı');
  assert.strictEqual(report.kaynak.onaysiz, 2, 'READY + NEEDS_REVIEW onaysız sayılır');
  assert.strictEqual(report.kaynak.iptalHaric, 0);
  assert.strictEqual(report.kaynak.mukerrerHaric, 0);
  assert.strictEqual(report.quality.invoiceCount, 4);
  assert.strictEqual(report.hesapAtanmamis.count, 1, 'kodsuz matrah satırlı belge = hesap atanmamış');
  assert.strictEqual(report.hesapAtanmamis.base, 100);
  assert.deepStrictEqual(report.hesapAtanmamis.belgeler, ['doc-alis-kodsuz']);
  assert.ok(report.drilldown.hesaplananBelgeler.includes('doc-satis'));
  assert.strictEqual(report.drilldown.indirilecekBelgeler.length, 3);
  assert.deepStrictEqual(report.drilldown.onaysizBelgeler.sort(), ['doc-alis-kodsuz', 'doc-alis-masraf']);
  assert.strictEqual(report.categoryRows.find((r) => r.key === 'unclassified').alias, 'hesapAtanmamis', 'eski anahtar korunur, alias eklenir');
  assert.strictEqual(report.totals.calculatedVatBeyan, 400);
  assert.strictEqual(report.totals.deductibleVatTevkifatHaric, 270);
  assert.strictEqual(report.totals.otherTaxesTotal, 0);

  // 1) İPTAL / RED / MÜKERRER belgeler toplama GİRMEZ; bağlı GİB sorgu satırı da sayılmaz.
  const iptalDocs = [
    ...docs,
    { id: 'doc-iptal', source: 'earsiv', sourceRefId: 'alis-iptal', s3Key: '', invoiceKind: 'ALIS', belgeNo: 'X-1', status: 'CANCELLED', ocrData: {}, lines: [{ group: 'matrah', accountCode: '770.01.010', debit: 9000, credit: 0 }, { group: 'vergi', accountCode: '191.01.020', debit: 1800, credit: 0 }] },
    { id: 'doc-red', source: 'manual-web', sourceRefId: null, s3Key: 'k1', invoiceKind: 'ALIS', belgeNo: 'X-2', status: 'REJECTED', ocrData: { matrah: 5000, kdvTutari: 1000 }, totalAmount: 6000, lines: [] },
    { id: 'doc-mukerrer-bag', source: 'manual-web', sourceRefId: null, s3Key: 'k2', invoiceKind: 'ALIS', belgeNo: 'X-3', status: 'NEEDS_REVIEW', duplicateOfId: 'doc-alis-mal', ocrData: { matrah: 5000, kdvTutari: 1000 }, totalAmount: 6000, lines: [] },
    { id: 'doc-mukerrer-uyari', source: 'manual-web', sourceRefId: null, s3Key: 'k3', invoiceKind: 'SATIS', belgeNo: 'X-4', status: 'NEEDS_REVIEW', ocrData: { matrah: 7000, kdvTutari: 1400, uyarilar: [{ kod: 'MUKERRER', seviye: 'engel', baslik: 'Mükerrer', aciklama: 'aynı belge' }] }, totalAmount: 8400, lines: [] },
  ];
  const iptalInvoices = [
    ...invoices,
    { id: 'alis-iptal', tip: 'ALIS', belgeKaynak: 'EARSIV', donem: '2026-05', faturaNo: 'X-1', faturaTarihi: new Date('2026-05-06T00:00:00Z'), satici: 'İptal Ltd', saticiVergiNo: '5555555555', alici: 'Demo Ltd', aliciVergiNo: '1234567890', matrah: 9000, kdvTutari: 1800, kdvOrani: 20, toplamTutar: 10800, durum: 'KABUL' },
  ];
  const iptalReport = await makeService({ invoices: iptalInvoices, docs: iptalDocs }).kdvClientReport('tenant-1', { taxpayerId: 'tp1', period: '2026-05' });
  assert.strictEqual(iptalReport.totals.deductibleVat, 270, 'iptal/red/mükerrer alış KDV toplama girmedi');
  assert.strictEqual(iptalReport.totals.calculatedVat, 400, 'MUKERRER uyarılı satış toplama girmedi');
  assert.strictEqual(iptalReport.kaynak.iptalHaric, 2, 'CANCELLED + REJECTED');
  assert.strictEqual(iptalReport.kaynak.mukerrerHaric, 2, 'duplicateOfId + MUKERRER uyarısı');
  assert.strictEqual(iptalReport.kaynak.belge, 4, 'GİB satırı iptal belgeye bağlıysa o da sayılmaz');
  assert.deepStrictEqual(iptalReport.drilldown.iptalHaricBelgeler.sort(), ['doc-iptal', 'doc-red']);
  assert.deepStrictEqual(iptalReport.drilldown.mukerrerHaricBelgeler.sort(), ['doc-mukerrer-bag', 'doc-mukerrer-uyari']);
  assert.strictEqual(iptalReport.quality.iptalHaricCount, 2);

  // 2) İADE ters işaret: satış iadesi satış matrah/KDV'yi, alış iadesi alış KDV'yi düşürür.
  const iadeDocs = [
    ...docs,
    { id: 'doc-satis-iade', source: 'manual-web', sourceRefId: null, s3Key: 'i1', invoiceKind: 'SATIS', belgeNo: 'I-1', status: 'APPROVED', ocrData: { matrah: 500, kdvTutari: 100, isReturn: true }, totalAmount: 600, lines: [{ group: 'matrah', accountCode: '610.01.001', debit: 500, credit: 0 }, { group: 'vergi', accountCode: '391.01.020', debit: 100, credit: 0 }] },
    { id: 'doc-alis-iade', source: 'manual-web', sourceRefId: null, s3Key: 'i2', invoiceKind: 'ALIS', belgeNo: 'I-2', status: 'APPROVED', ocrData: { matrah: 200, kdvTutari: 40, isReturn: true }, totalAmount: 240, lines: [{ group: 'matrah', accountCode: '153.01.001', debit: 0, credit: 200 }, { group: 'vergi', accountCode: '191.01.020', debit: 0, credit: 40 }] },
  ];
  const iadeReport = await makeService({ invoices, docs: iadeDocs }).kdvClientReport('tenant-1', { taxpayerId: 'tp1', period: '2026-05' });
  assert.strictEqual(iadeReport.totals.salesBase, 1500, 'satış iadesi matrahı düşürdü');
  assert.strictEqual(iadeReport.totals.calculatedVat, 300, 'satış iadesi hesaplanan KDV\'yi düşürdü');
  assert.strictEqual(iadeReport.totals.deductibleVat, 230, 'alış iadesi indirilecek KDV\'yi düşürdü');
  assert.strictEqual(iadeReport.totals.purchaseGoodsBase, 800, 'alış iadesi mal/stok kovasını düşürdü');
  assert.strictEqual(iadeReport.kaynak.iade, 2);
  assert.deepStrictEqual(iadeReport.drilldown.iadeBelgeler.sort(), ['doc-alis-iade', 'doc-satis-iade']);
  assert.ok(iadeReport.notlar.some((n) => n.includes('iade')));

  // 3) TEVKİFATLI SATIŞ: hesaplanan KDV TAM (calculatedVat), tevkif edilen ayrı satır, beyan tabanı = TAM − tevkif edilen.
  //    TEVKİFATLI ALIŞ: indirilecek TAM (191 + sorumlu-191), KDV2 kısmı kdv2SorumluVat'ta ayrı; KDV dışı vergi karışmaz.
  const tevkDocs = [
    ...docs,
    { id: 'doc-satis-tevk', source: 'manual-web', sourceRefId: null, s3Key: 't1', invoiceKind: 'SATIS', belgeNo: 'T-1', status: 'APPROVED',
      ocrData: { matrah: 10000, kdvTutari: 2000, tevkifatOrani: 0.5, tevkifatKdv: 1000 }, totalAmount: 11000,
      lines: [{ group: 'cari', accountCode: '120.01.001', debit: 11000, credit: 0 }, { group: 'matrah', accountCode: '600.01.001', debit: 0, credit: 10000 }, { group: 'vergi', accountCode: '391.01.020', debit: 0, credit: 1000 }] },
    { id: 'doc-alis-tevk', source: 'manual-web', sourceRefId: null, s3Key: 't2', invoiceKind: 'ALIS', belgeNo: 'T-2', status: 'APPROVED',
      ocrData: { matrah: 4000, kdvTutari: 800, tevkifatOrani: 0.5, digerVergiToplam: 150 }, totalAmount: 4550,
      lines: [{ group: 'matrah', accountCode: '770.01.010', debit: 4000, credit: 0 }, { group: 'vergi', accountCode: '191.01.020', debit: 400, credit: 0 }, { group: 'vergi-sorumlu', accountCode: '191.02.001', debit: 400, credit: 0 }, { group: 'diger_vergi', accountCode: '770.01.010', debit: 150, credit: 0 }, { group: 'cari', accountCode: '320.01.001', debit: 0, credit: 4550 }, { group: 'tevkifat', accountCode: '360.01.001', debit: 0, credit: 400 }] },
  ];
  const tevkReport = await makeService({ invoices, docs: tevkDocs }).kdvClientReport('tenant-1', { taxpayerId: 'tp1', period: '2026-05' });
  assert.strictEqual(tevkReport.totals.calculatedVat, 2400, 'tevkifatlı satışta hesaplanan KDV TAM');
  assert.strictEqual(tevkReport.totals.tevkifEdilenVat, 1000, 'tevkif edilen ayrı satır');
  assert.strictEqual(tevkReport.totals.calculatedVatBeyan, 1400, 'KDV1 beyan tabanı = TAM − tevkif edilen');
  assert.strictEqual(tevkReport.totals.deductibleVat, 1070, 'tevkifatlı alışta indirilecek TAM (191 + sorumlu-191)');
  assert.strictEqual(tevkReport.totals.kdv2SorumluVat, 400, 'KDV2 (sorumlu) kısmı ayrı');
  assert.strictEqual(tevkReport.totals.deductibleVatTevkifatHaric, 670);
  assert.strictEqual(tevkReport.totals.otherTaxesTotal, 150, 'KDV dışı vergi ayrı, KDV\'ye karışmadı');
  assert.strictEqual(tevkReport.totals.periodVatDifference, 330, '(2400 − 1000) − 1070');
  assert.strictEqual(tevkReport.kaynak.tevkifatli, 2);
  assert.deepStrictEqual(tevkReport.drilldown.tevkifatliBelgeler.sort(), ['doc-alis-tevk', 'doc-satis-tevk']);
  assert.ok(tevkReport.notlar.some((n) => n.includes('Tevkifatlı SATIŞ')) && tevkReport.notlar.some((n) => n.includes('Tevkifatlı ALIŞ')));
  assert.ok(tevkReport.notlar.some((n) => n.includes('KDV dışı')));

  console.log('kdv-client-report-regression ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
