#!/usr/bin/env node
const assert = require('assert');
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

const { compareKdvExportRows } = require(path.join(
  ROOT,
  'apps',
  'api',
  'src',
  'kdv-control',
  'export',
  'export-row-order.ts',
));
const { KdvControlService } = require(path.join(
  ROOT,
  'apps',
  'api',
  'src',
  'kdv-control',
  'kdv-control.service.ts',
));

function date(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function row(id, belgeNo, oran, sourceIndex) {
  return {
    id,
    status: 'MATCHED',
    imageId: `image-${belgeNo}`,
    kdvRecordId: `record-${id}`,
    kdvRecord: {
      belgeNo,
      belgeDate: date('2026-04-29'),
      kdvOrani: oran,
      rowIndex: sourceIndex,
    },
    image: {
      confirmedBelgeNo: belgeNo,
      confirmedDate: '29.04.2026',
    },
  };
}

const rows = [
  row('kdv-0125-1', '0125', 1, 40),
  row('kdv-0046-20', '46', 20, 41),
  row('kdv-0125-20', '0125', 20, 42),
];

rows.sort(compareKdvExportRows(rows, (record) => Number(record?.kdvOrani || 0) || null));

assert.deepStrictEqual(
  rows.map((r) => r.id),
  ['kdv-0125-1', 'kdv-0125-20', 'kdv-0046-20'],
  'Ayni belgeye ait KDV kirilimlari Excel exportta araya baska belge almadan alt alta gelmeli',
);

const service = Object.create(KdvControlService.prototype);
const sharedImage = {
  id: 'image-telekom',
  ocrBelgeNo: 'BC42026015523535',
  ocrDate: '09.04.2026',
  ocrKdvTutari: '62,20',
  ocrKdvBreakdown: [{ oran: 20, tutar: 62.2 }],
};
const fanoutRows = [
  {
    id: 'fanout-kdv',
    status: 'MATCHED',
    imageId: sharedImage.id,
    kdvRecordId: 'record-kdv',
    kdvRecord: { belgeNo: 'BC42026015523535', belgeDate: date('2026-04-09'), kdvTutari: 62.2, kdvOrani: null, rawData: {} },
    image: sharedImage,
    mismatchReasons: [],
  },
  {
    id: 'fanout-zero-1',
    status: 'MATCHED',
    imageId: sharedImage.id,
    kdvRecordId: 'record-zero-1',
    kdvRecord: { belgeNo: 'BC42026015523535', belgeDate: date('2026-04-09'), kdvTutari: 0, kdvOrani: null, rawData: {} },
    image: sharedImage,
    mismatchReasons: [],
  },
  {
    id: 'fanout-zero-2',
    status: 'MATCHED',
    imageId: sharedImage.id,
    kdvRecordId: 'record-zero-2',
    kdvRecord: { belgeNo: 'BC42026015523535', belgeDate: date('2026-04-09'), kdvTutari: 0, kdvOrani: null, rawData: {} },
    image: sharedImage,
    mismatchReasons: [],
  },
];

assert.deepStrictEqual(
  fanoutRows.map((r) => service.getExportFaturaKdvValue(r, fanoutRows, 'ISLETME_GIDER', true)),
  [62.2, 0, 0],
  'Fan-out Excel detayinda sifir KDV Luca satirlari ayni fatura KDV toplamiyla sismemeli',
);

assert.strictEqual(
  service.buildMatchSummary(fanoutRows, 'ISLETME_GIDER').amountMismatch,
  0,
  'Fan-out sifir KDV satirlari oturum ozetinde tutar uyumsuzlugu sayilmamali',
);

console.log('OK kdv-export-order-regression');
