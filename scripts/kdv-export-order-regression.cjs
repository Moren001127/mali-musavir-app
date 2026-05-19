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

console.log('OK kdv-export-order-regression');
