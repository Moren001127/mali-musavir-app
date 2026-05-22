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

  console.log('kdv-client-report-regression ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
