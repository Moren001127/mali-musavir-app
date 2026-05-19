#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..', '..', '..');
const source = path.join(root, 'apps', 'api', 'public', 'agent-runtime.js');
const target = path.join(root, 'apps', 'web', 'public', 'moren-agent.js');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
}

if (!fs.existsSync(source)) {
  console.error(`[sync-agent-runtime] Kaynak bulunamadi: ${source}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);

console.log(`[sync-agent-runtime] agent-runtime.js -> moren-agent.js (${sha256(source)})`);
