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

const { replaceSessionLucaRecordsInDb } = require(path.join(
  ROOT,
  'apps',
  'api',
  'src',
  'kdv-control',
  'session',
  'session-record-replacement.ts',
));

function prismaWithEvents(events) {
  return {
    $transaction: async (callback) => callback({
      reconciliationResult: {
        deleteMany: async (args) => events.push(['delete-results', args]),
      },
      kdvRecord: {
        deleteMany: async (args) => events.push(['delete-records', args]),
        createMany: async (args) => events.push(['create-records', args]),
      },
    }),
  };
}

(async () => {
  const events = [];
  await replaceSessionLucaRecordsInDb(prismaWithEvents(events), 'session-1', [
    { sessionId: 'session-1', belgeNo: '0125', kdvTutari: 6.82 },
  ]);

  assert.deepStrictEqual(
    events.map(([name]) => name),
    ['delete-results', 'delete-records', 'create-records'],
    'Yeni Luca cekimi once eski eslesmeleri ve Luca satirlarini temizlemeli, sonra yeni satirlari yazmali',
  );
  assert.deepStrictEqual(events[0][1], { where: { sessionId: 'session-1' } });
  assert.deepStrictEqual(events[1][1], { where: { sessionId: 'session-1' } });
  assert.strictEqual(events[2][1].data.length, 1);

  const emptyEvents = [];
  await replaceSessionLucaRecordsInDb(prismaWithEvents(emptyEvents), 'session-2', []);
  assert.deepStrictEqual(
    emptyEvents.map(([name]) => name),
    ['delete-results', 'delete-records'],
    'Bos Luca cekimi de eski Luca satirlarini temizlemeli ve yeni satir eklememeli',
  );

  console.log('OK kdv-session-replace-contract');
})();
