#!/usr/bin/env node
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadTsNode() {
  process.env.TS_NODE_TRANSPILE_ONLY = 'true';
  process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
    module: 'CommonJS',
    moduleResolution: 'Node',
  });
  const candidates = [
    'ts-node/register/transpile-only',
    path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
    path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
  ];
  for (const candidate of candidates) {
    try {
      require(candidate);
      return;
    } catch {}
  }
  throw new Error('ts-node/register/transpile-only bulunamadi');
}

loadTsNode();

const { ReconciliationEngine } = require(path.join(
  ROOT,
  'apps',
  'api',
  'src',
  'kdv-control',
  'reconciliation',
  'index.ts',
));
const { ExcelParserService } = require(path.join(
  ROOT,
  'apps',
  'api',
  'src',
  'kdv-control',
  'excel-parser.service.ts',
));

function date(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function record(partial) {
  return {
    id: partial.id,
    sessionId: 'session-1',
    belgeNo: partial.belgeNo,
    belgeDate: date(partial.date),
    kdvTutari: partial.kdv,
    kdvMatrahi: partial.matrah ?? 0,
    kdvOrani: partial.oran ?? null,
    karsiTaraf: partial.karsiTaraf ?? null,
    aciklama: partial.aciklama ?? null,
    rawData: partial.rawData ?? {},
    createdAt: date('2026-05-18'),
    updatedAt: date('2026-05-18'),
  };
}

function image(partial) {
  return {
    id: partial.id,
    sessionId: 'session-1',
    s3Key: partial.s3Key ?? null,
    fileName: partial.fileName ?? `${partial.id}.image`,
    ocrStatus: partial.ocrStatus ?? 'SUCCESS',
    isManuallyConfirmed: partial.isManuallyConfirmed ?? false,
    ocrBelgeNo: partial.belgeNo,
    confirmedBelgeNo: partial.confirmedBelgeNo ?? null,
    ocrDate: partial.date,
    confirmedDate: partial.confirmedDate ?? null,
    ocrKdvTutari: partial.kdv,
    confirmedKdvTutari: partial.confirmedKdv ?? null,
    ocrKdvTevkifat: partial.tevkifat ?? null,
    confirmedKdvTevkifat: null,
    ocrKdvBreakdown: partial.breakdown ?? null,
    confirmedKdvBreakdown: null,
    ocrSatici: partial.satici ?? null,
    ocrSaticiVkn: partial.vkn ?? null,
    ocrRawText: partial.rawText ?? null,
    ocrBelgeTipi: partial.belgeTipi ?? null,
    createdAt: date('2026-05-18'),
    updatedAt: date('2026-05-18'),
  };
}

function prismaFor({ sessionType, records, images }) {
  const created = [];
  const sessionUpdates = [];
  const prisma = {
    __created: created,
    __sessionUpdates: sessionUpdates,
    $executeRaw: async () => 0,
    $transaction: async (callback) => callback(prisma),
    reconciliationResult: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }) => {
        created.push(data);
        return data;
      },
    },
    kdvControlSession: {
      findUnique: async () => ({ type: sessionType }),
      update: async (args) => {
        sessionUpdates.push(args);
        return args?.data ?? {};
      },
    },
    kdvRecord: {
      findMany: async () => records,
    },
    receiptImage: {
      findMany: async () => images,
    },
    mihsapInvoice: {
      findMany: async () => [],
    },
  };
  return prisma;
}

function simplify(created) {
  return sortRows(
    created.map((row) => ({
      record: row.kdvRecordId,
      image: row.imageId,
      status: row.status,
    })),
  );
}

function sortRows(rows) {
  return [...rows].sort((a, b) =>
    `${a.record || ''}:${a.image || ''}:${a.status}`.localeCompare(`${b.record || ''}:${b.image || ''}:${b.status}`),
  );
}

const cases = [
  {
    name: 'short receipt split KDV rows aggregate to one image',
    sessionType: 'KDV_391',
    records: [
      record({ id: 'r-0622-a', belgeNo: '0622', date: '2026-04-04', kdv: 181.82, oran: 20 }),
      record({ id: 'r-0622-b', belgeNo: '0622', date: '2026-04-04', kdv: 8.33, oran: 10 }),
    ],
    images: [
      image({
        id: 'img-0622',
        belgeNo: '622',
        date: '04.04.2026',
        kdv: '190,15',
        breakdown: [
          { oran: 20, tutar: 181.82 },
          { oran: 10, tutar: 8.33 },
        ],
      }),
    ],
    expectedStats: { matched: 2, partial: 0, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-0622-a', image: 'img-0622', status: 'MATCHED' },
      { record: 'r-0622-b', image: 'img-0622', status: 'MATCHED' },
    ],
  },
  {
    name: '0647 split KDV rows aggregate to the exact total invoice',
    sessionType: 'KDV_391',
    records: [
      record({ id: 'r-0647-a', belgeNo: '0647', date: '2026-04-29', kdv: 8.33, oran: 10 }),
      record({ id: 'r-0647-b', belgeNo: '0647', date: '2026-04-29', kdv: 654.55, oran: 20 }),
    ],
    images: [
      image({
        id: 'img-0647',
        belgeNo: '647',
        date: '29.04.2026',
        kdv: '662,88',
        breakdown: [
          { oran: 20, tutar: 654.55 },
          { oran: 10, tutar: 8.33 },
        ],
      }),
    ],
    expectedStats: { matched: 2, partial: 0, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-0647-a', image: 'img-0647', status: 'MATCHED' },
      { record: 'r-0647-b', image: 'img-0647', status: 'MATCHED' },
    ],
  },
  {
    name: 'OKC receipt gross item amounts are converted to KDV breakdown',
    sessionType: 'KDV_191',
    records: [
      record({
        id: 'r-okc-0125-a',
        belgeNo: '0125',
        date: '2026-04-29',
        kdv: 6.5,
        oran: 18,
        rawData: { 'HESAP ADI': 'INDIRILECEK KDV %20' },
      }),
      record({
        id: 'r-okc-0125-b',
        belgeNo: '0125',
        date: '2026-04-29',
        kdv: 0.32,
        oran: 1,
        rawData: { 'HESAP ADI': 'INDIRILECEK KDV %1' },
      }),
    ],
    images: [
      image({
        id: 'img-okc-0125',
        belgeNo: '0125',
        date: '29.04.2026',
        kdv: '71,00',
        breakdown: [
          { oran: 1, tutar: 32 },
          { oran: 20, tutar: 39 },
        ],
        rawText: [
          'SOK MARKETLER T.A.S.',
          'FIS NO',
          ':0125',
          'PIYALE KELEBEK 500GR',
          '%1',
          '*15,50',
          'LEZZCAFE LATTE SUTLU',
          '%1',
          '*5,50',
          'LEZZCAFE LATTE SUTLU',
          '%1',
          '*5,50',
          'LEZZCAFE LATTE SUTLU',
          '%1',
          '*5,50',
          'YUKA BEYAZ SABUN ISL',
          '%20',
          '*39,00',
          'TOPKDV',
          '*6,82',
          'TOPLAM',
          '*71,00',
        ].join('\n'),
        belgeTipi: 'OKC_FIS',
      }),
    ],
    expectedStats: { matched: 2, partial: 0, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-okc-0125-a', image: 'img-okc-0125', status: 'MATCHED' },
      { record: 'r-okc-0125-b', image: 'img-okc-0125', status: 'MATCHED' },
    ],
  },
  {
    name: 'OKC spaced gross amounts use TOPKDV total instead of one item KDV',
    sessionType: 'KDV_191',
    records: [
      record({
        id: 'r-tekirdag-7',
        belgeNo: '7',
        date: '2026-04-07',
        kdv: 117.27,
        oran: 10,
        rawData: { 'HESAP ADI': 'INDIRILECEK KDV %10' },
      }),
    ],
    images: [
      image({
        id: 'img-tekirdag-7',
        belgeNo: '7',
        date: '07.04.2026',
        kdv: '26,36',
        breakdown: [{ oran: 10, tutar: 26.36 }],
        rawText: [
          'TEKIRDAG KOFTECISI',
          '07-04-2026',
          'FIS NO: 7',
          'YIYECEK',
          '%10',
          '* 1. 000, 00',
          'ICECEK',
          '%10',
          '* 290,00',
          'TOPKDV',
          '*117,27',
          'TOPLAM',
          '*1.290,00',
        ].join('\n'),
        belgeTipi: 'OKC_FIS',
      }),
    ],
    expectedStats: { matched: 1, partial: 0, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-tekirdag-7', image: 'img-tekirdag-7', status: 'MATCHED' },
    ],
  },
  {
    name: 'OKC wrong OCR rate is ignored when TOPKDV total matches record',
    sessionType: 'KDV_191',
    records: [
      record({
        id: 'r-yufka-00011',
        belgeNo: '00011',
        date: '2026-04-07',
        kdv: 1.73,
        oran: 1,
        rawData: { 'HESAP ADI': 'INDIRILECEK KDV %1' },
      }),
    ],
    images: [
      image({
        id: 'img-yufka-00011',
        belgeNo: '00011',
        date: '07.04.2026',
        kdv: '1,73',
        breakdown: [{ oran: 20, tutar: 1.73, matrah: 8.65 }],
        rawText: [
          'KAC IS IR YUFKA',
          'TARIH: 7/04/2026',
          'FIS NO: 00011',
          'YUFKA',
          '*175,00',
          'TOPKDV',
          '*1,73',
          'TOPLAM',
          '*175,00',
        ].join('\n'),
        belgeTipi: 'OKC_FIS',
      }),
    ],
    expectedStats: { matched: 1, partial: 0, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-yufka-00011', image: 'img-yufka-00011', status: 'MATCHED' },
    ],
  },
  {
    name: 'OKC blank FIS NO falls back to POS ISLEM NO',
    sessionType: 'KDV_191',
    records: [
      record({
        id: 'r-tekirdag-pos-3',
        belgeNo: '3',
        date: '2026-04-26',
        kdv: 85.45,
        oran: 10,
        rawData: { 'HESAP ADI': 'INDIRILECEK KDV %10' },
      }),
    ],
    images: [
      image({
        id: 'img-tekirdag-pos-3',
        belgeNo: 'SAAT',
        date: '26.04.2026',
        kdv: '85,45',
        breakdown: [{ oran: 0, tutar: 85.45 }],
        rawText: [
          'TEKIRDAG KOFTECISI',
          '26-04-2026',
          'FIS NO:',
          'SAAT: 15: 28',
          'YIYECEK',
          '¥10',
          '*840, 00',
          'ICECEK',
          '%10',
          '* 100, 00',
          'TOPKDV',
          '*85,45',
          'TOPLAM',
          '*940,00',
          'ISLEM NO:0003/KP0807',
        ].join('\n'),
        belgeTipi: 'OKC_FIS',
      }),
    ],
    expectedStats: { matched: 1, partial: 0, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-tekirdag-pos-3', image: 'img-tekirdag-pos-3', status: 'MATCHED' },
    ],
  },
  {
    name: 'GKN038 e-invoice split rows aggregate to exact invoice total',
    sessionType: 'KDV_391',
    records: [
      record({ id: 'r-gkn038-a', belgeNo: 'GKN202600000038', date: '2026-04-30', kdv: 500, oran: 10 }),
      record({ id: 'r-gkn038-b', belgeNo: 'GKN202600000038', date: '2026-04-30', kdv: 1220, oran: 20 }),
    ],
    images: [
      image({
        id: 'img-gkn038',
        belgeNo: 'GKN202600000038',
        date: '30.04.2026',
        kdv: '1720,00',
        breakdown: [
          { oran: 20, tutar: 1220 },
          { oran: 10, tutar: 500 },
        ],
      }),
    ],
    expectedStats: { matched: 2, partial: 0, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-gkn038-a', image: 'img-gkn038', status: 'MATCHED' },
      { record: 'r-gkn038-b', image: 'img-gkn038', status: 'MATCHED' },
    ],
  },
  {
    name: 'same e-invoice number and date but KDV mismatch is not accepted as matched',
    sessionType: 'KDV_391',
    records: [
      record({ id: 'r-akg097', belgeNo: 'AKG202600000097', date: '2026-04-03', kdv: 60, oran: 20 }),
    ],
    images: [
      image({
        id: 'img-akg097',
        belgeNo: 'AKG202600000097',
        date: '03.04.2026',
        kdv: '1220,00',
        breakdown: [{ oran: 20, tutar: 1220 }],
      }),
    ],
    expectedStats: { matched: 0, partial: 1, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-akg097', image: 'img-akg097', status: 'PARTIAL_MATCH' },
    ],
  },
  {
    name: 'sales Z report keeps rate breakdown while total also matches',
    sessionType: 'KDV_391',
    records: [
      record({ id: 'r-z-20', belgeNo: '694', date: '2026-04-03', kdv: 10.83, oran: 20 }),
      record({ id: 'r-z-10', belgeNo: '694', date: '2026-04-03', kdv: 453.08, oran: 10 }),
    ],
    images: [
      image({
        id: 'img-z-694',
        belgeNo: '0694',
        date: '03.04.2026',
        kdv: '463,91',
        breakdown: [
          { oran: 20, tutar: 10.83 },
          { oran: 10, tutar: 453.08 },
        ],
      }),
    ],
    expectedStats: { matched: 2, partial: 0, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-z-10', image: 'img-z-694', status: 'MATCHED' },
      { record: 'r-z-20', image: 'img-z-694', status: 'MATCHED' },
    ],
  },
  {
    name: 'different e-invoice number with same date and amount stays review only',
    sessionType: 'KDV_191',
    records: [
      record({
        id: 'r-gib-a',
        belgeNo: 'GIB202600000560',
        date: '2026-04-14',
        kdv: 1094,
        oran: 20,
        karsiTaraf: 'ALFA LTD',
        rawData: { vkn: '1111111111' },
      }),
    ],
    images: [
      image({
        id: 'img-gib-b',
        belgeNo: 'AKG202600000107',
        date: '14.04.2026',
        kdv: '1094,00',
        breakdown: [{ oran: 20, tutar: 1094 }],
        satici: 'BETA LTD',
        vkn: '2222222222',
      }),
    ],
    expectedStats: { matched: 0, partial: 0, unmatched: 2, needsReview: 0 },
    expectedRows: [
      { record: 'r-gib-a', image: null, status: 'UNMATCHED' },
      { record: null, image: 'img-gib-b', status: 'UNMATCHED' },
    ],
  },
  {
    name: 'purchase receipts with Luca description suffix match exact image',
    sessionType: 'KDV_191',
    records: [
      record({
        id: 'r-osmanli-0001',
        belgeNo: '0001',
        date: '2026-04-02',
        kdv: 715.64,
        oran: 18,
        karsiTaraf: 'OSMANLI PETROL NAK-0001-02/04/2026',
        aciklama: 'OSMANLI PETROL NAK-0001-02/04/2026',
        rawData: { 'HESAP ADI': 'INDIRILECEK KDV %20' },
      }),
      record({
        id: 'r-altur-ts',
        belgeNo: 'TS12026000001927',
        date: '2026-04-02',
        kdv: 125,
        oran: 18,
        karsiTaraf: 'ALTUR TURIZM SERVI-TS12026000001927-02/04/2026',
        aciklama: 'ALTUR TURIZM SERVI-TS12026000001927-02/04/2026',
        rawData: { 'HESAP ADI': 'INDIRILECEK KDV %20' },
      }),
      record({
        id: 'r-mustafa-54',
        belgeNo: '54',
        date: '2026-04-01',
        kdv: 1328.33,
        oran: 20,
        karsiTaraf: 'MUSTAFA CERKESLI-54-01/04/2026',
        aciklama: 'MUSTAFA CERKESLI-54-01/04/2026',
        rawData: { 'HESAP ADI': 'INDIRILECEK KDV %20' },
      }),
      record({
        id: 'r-electric-bea',
        belgeNo: 'BEA2026015709620',
        date: '2026-04-10',
        kdv: 47.02,
        oran: 8,
        karsiTaraf: 'CK BOGAZICI ELEKTR-BEA2026015709620-10/04/2026',
        aciklama: 'CK BOGAZICI ELEKTR-BEA2026015709620-10/04/2026',
        rawData: { 'HESAP ADI': 'INDIRILECEK KDV %10' },
      }),
    ],
    images: [
      image({
        id: 'img-osmanli-0001',
        belgeNo: '0001',
        date: '02.04.2026',
        kdv: '715,64',
        breakdown: [{ oran: 0, tutar: 715.64 }],
        satici: 'OSMANLI PETROL NAKLIYAT SAN. VE TIC. LTD. STI',
      }),
      image({
        id: 'img-altur-ts',
        belgeNo: 'TS12026000001927',
        date: '02.04.2026',
        kdv: '125,00',
        breakdown: [{ oran: 20, tutar: 125 }],
        satici: 'ALTUR TURIZM SERVIS VE TIC. LTD. STI',
      }),
      image({
        id: 'img-mustafa-54',
        belgeNo: '54',
        date: '01.04.2026',
        kdv: '1.328,33',
        breakdown: [{ oran: 20, tutar: 1328.33 }],
        satici: 'LINK OTOMATIV YEDEK PARCA',
      }),
      image({
        id: 'img-electric-bea',
        belgeNo: 'BEA2026015709620',
        date: '10.04.2026',
        kdv: '47,02',
        breakdown: [{ oran: 20, tutar: 47.02, matrah: null }],
        rawText: 'ELEKTRIK FATURASI\nKDV (Matrah 470,16)\n47,02\nFatura Tutari 518,82',
        satici: 'CK BOGAZICI ELEKTRIK',
      }),
    ],
    expectedStats: { matched: 4, partial: 0, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-altur-ts', image: 'img-altur-ts', status: 'MATCHED' },
      { record: 'r-electric-bea', image: 'img-electric-bea', status: 'MATCHED' },
      { record: 'r-mustafa-54', image: 'img-mustafa-54', status: 'MATCHED' },
      { record: 'r-osmanli-0001', image: 'img-osmanli-0001', status: 'MATCHED' },
    ],
  },
  {
    name: 'long e-invoice number and KDV exact match even when Luca booking date differs',
    sessionType: 'KDV_191',
    records: [
      record({
        id: 'r-perihan-zfe-date',
        belgeNo: 'ZFE2026000000451',
        date: '2026-04-02',
        kdv: 47.41,
        oran: 18,
        rawData: { 'HESAP ADI': 'INDIRILECEK KDV %20' },
      }),
    ],
    images: [
      image({
        id: 'img-perihan-zfe-date',
        belgeNo: 'ZFE2026000000451',
        date: '01.04.2026',
        kdv: '47,41',
        breakdown: [{ oran: 20, tutar: 47.41 }],
        belgeTipi: 'EFATURA',
      }),
    ],
    expectedStats: { matched: 1, partial: 0, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-perihan-zfe-date', image: 'img-perihan-zfe-date', status: 'MATCHED' },
    ],
  },
  {
    name: 'raw explicit Hesaplanan KDV fixes matrah-as-KDV OCR amount',
    sessionType: 'KDV_191',
    records: [
      record({
        id: 'r-perihan-bae-matrah',
        belgeNo: 'BAE2026000000259',
        date: '2026-04-18',
        kdv: 1091.52,
        oran: 18,
        rawData: { 'HESAP ADI': 'INDIRILECEK KDV %20' },
      }),
    ],
    images: [
      image({
        id: 'img-perihan-bae-matrah',
        belgeNo: 'BAE2026000000259',
        date: '18.04.2026',
        kdv: '5.457,60',
        breakdown: [{ oran: 20, tutar: 5457.6 }],
        rawText: [
          'Fatura No: BAE2026000000259',
          'Fatura Tarihi: 18-04-2026',
          'KDV Matrahi (%20) 5.457,60 TL',
          'Hesaplanan KDV(%20) 1.091,52 TL',
          'Odenecek Tutar 6.549,12 TL',
        ].join('\n'),
        belgeTipi: 'EARSIV',
      }),
    ],
    expectedStats: { matched: 1, partial: 0, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-perihan-bae-matrah', image: 'img-perihan-bae-matrah', status: 'MATCHED' },
    ],
  },
  {
    name: 'telekom raw invoice id and KDV amount override Claude hallucinated belge no/date',
    sessionType: 'KDV_191',
    records: [
      record({
        id: 'r-perihan-superonline',
        belgeNo: '01S2026000660368',
        date: '2026-04-30',
        kdv: 111.28,
        oran: 18,
        rawData: { 'HESAP ADI': 'INDIRILECEK KDV %20' },
      }),
    ],
    images: [
      image({
        id: 'img-perihan-superonline',
        belgeNo: 'TFS2026000000368',
        date: '31.05.2026',
        kdv: '556,38',
        breakdown: [{ oran: 20, tutar: 556.38 }],
        rawText: [
          '[CLAUDE] {"tarih":"2026-05-31","belgeNo":"TFS2026000000368","kdvTutari":"111,28","kdvBreakdown":[{"oran":20,"tutar":"111,28","matrah":"556,38"}]}',
          '[AZURE]',
          'SUPERONLINE',
          'FATURA ID 0152026000660368',
          'Fatura Tarihi : 30/04/2026',
          'KDV Uygulanan Tutar (%20)',
          'KDV (%20)',
          ':556.38',
          ':111.28',
        ].join('\n'),
        belgeTipi: 'EFATURA',
      }),
    ],
    expectedStats: { matched: 1, partial: 0, unmatched: 0, needsReview: 0 },
    expectedRows: [
      { record: 'r-perihan-superonline', image: 'img-perihan-superonline', status: 'MATCHED' },
    ],
  },
];

(async () => {
  const parser = new ExcelParserService();
  const belgeNoCases = [
    {
      name: 'Luca aciklama e-fatura noyu kisa fis nodan once yakalar',
      text: '600.01 Satis faturasi AKG202600000097 - 03.04.2026 - Fis No 516',
      expected: 'AKG202600000097',
    },
    {
      name: 'E-arsiv harf-rakam seri belge no yakalanir',
      text: 'Turk Telekom E162026038940238 30.04.2026 KDV',
      expected: 'E162026038940238',
    },
    {
      name: 'Luca alis aciklamasinda iki haneli fis no sondaki tarih oncesinden alinir',
      text: 'MUSTAFA CERKESLI-54-01/04/2026',
      expected: '54',
    },
    {
      name: 'Firma adindaki kelime belge no sanilmaz',
      text: 'ULAS OTO YEDEK PAR-80-02/04/2026',
      expected: '80',
    },
  ];

  for (const testCase of belgeNoCases) {
    const actual = parser.extractBelgeNoFromDescription(testCase.text);
    if (actual !== testCase.expected) {
      console.error(`\n[kdv-regression] FAIL: ${testCase.name}`);
      console.error('actual:', actual);
      console.error('expected:', testCase.expected);
      process.exit(1);
    }
    console.log(`[kdv-regression] OK: ${testCase.name}`);
  }

  for (const testCase of cases) {
    const prisma = prismaFor(testCase);
    const engine = new ReconciliationEngine(prisma);
    const stats = await engine.runReconciliation('session-1');
    const rows = simplify(prisma.__created);

    const statsOk = JSON.stringify(stats) === JSON.stringify(testCase.expectedStats);
    const expectedRows = sortRows(testCase.expectedRows);
    const rowsOk = JSON.stringify(rows) === JSON.stringify(expectedRows);
    const lastSessionUpdate = prisma.__sessionUpdates[prisma.__sessionUpdates.length - 1];
    const expectedSessionStatus =
      testCase.expectedStats.matched > 0 &&
      testCase.expectedStats.partial === 0 &&
      testCase.expectedStats.unmatched === 0 &&
      testCase.expectedStats.needsReview === 0
        ? 'COMPLETED'
        : 'REVIEWING';
    const sessionStatusOk = lastSessionUpdate?.data?.status === expectedSessionStatus;
    if (!statsOk || !rowsOk || !sessionStatusOk) {
      console.error(`\n[kdv-regression] FAIL: ${testCase.name}`);
      console.error('stats:', JSON.stringify(stats));
      console.error('expectedStats:', JSON.stringify(testCase.expectedStats));
      console.error('rows:', JSON.stringify(rows));
      console.error('expectedRows:', JSON.stringify(expectedRows));
      console.error('sessionStatus:', lastSessionUpdate?.data?.status);
      console.error('expectedSessionStatus:', expectedSessionStatus);
      process.exit(1);
    }
    console.log(`[kdv-regression] OK: ${testCase.name}`);
  }
})().catch((error) => {
  console.error('[kdv-regression] FAIL:', error?.stack || error?.message || error);
  process.exit(1);
});
