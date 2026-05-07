#!/usr/bin/env node
/**
 * check-locked-modules.cjs
 *
 * Kilitli modüllerin SHA256 hash'i baseline ile eşleşiyor mu kontrol eder.
 * Eşleşmiyorsa exit 1 + güzel hata mesajı (CI / pre-commit hook için).
 *
 * Kullanım:
 *   node scripts/check-locked-modules.cjs                 — sadece kontrol
 *   MOREN_UNLOCK=1 node scripts/check-locked-modules.cjs  — bypass
 *   node scripts/check-locked-modules.cjs --update        — baseline'ı güncelle
 *
 * Pre-commit hook'tan çağrılır (.husky/pre-commit).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(ROOT, '.locked-modules.json');

if (!fs.existsSync(BASELINE)) {
  console.log('[locked-modules] .locked-modules.json yok — kontrol atlandı');
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));
const modules = baseline.modules || {};

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const UNLOCK = process.env.MOREN_UNLOCK === '1';

const sha256 = (filePath) => {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
};

const mismatches = [];
const updated = {};

for (const [relPath, expected] of Object.entries(modules)) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    mismatches.push({ relPath, reason: 'DOSYA YOK', current: null, expected: expected.sha256 });
    continue;
  }
  const current = sha256(abs);
  if (current !== expected.sha256) {
    mismatches.push({ relPath, reason: 'HASH FARKLI', current, expected: expected.sha256 });
    if (UPDATE) {
      updated[relPath] = { ...expected, sha256: current };
    }
  } else if (UPDATE) {
    updated[relPath] = expected;
  }
}

if (UPDATE) {
  baseline.modules = { ...modules, ...updated };
  baseline._meta = { ...(baseline._meta || {}), baseline_date: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
  console.log(`✓ Baseline güncellendi: ${Object.keys(updated).length} dosya`);
  process.exit(0);
}

if (mismatches.length === 0) {
  console.log(`✓ Kilitli modüller (${Object.keys(modules).length}) sağlam`);
  process.exit(0);
}

// MISMATCH VAR
console.error('\n┌─────────────────────────────────────────────────────────────────┐');
console.error('│  ⚠  KİLİTLİ MODÜL DEĞİŞİKLİĞİ TESPİT EDİLDİ                    │');
console.error('└─────────────────────────────────────────────────────────────────┘\n');
for (const m of mismatches) {
  console.error(`  ✗ ${m.relPath}`);
  console.error(`      ${m.reason}`);
  if (m.expected) console.error(`      beklenen sha256:  ${m.expected.slice(0, 24)}…`);
  if (m.current)  console.error(`      mevcut sha256  :  ${m.current.slice(0, 24)}…`);
  const meta = modules[m.relPath];
  if (meta?.reason) console.error(`      kilitleme sebebi: ${meta.reason}`);
  console.error('');
}

if (UNLOCK) {
  console.error('  ⚠ MOREN_UNLOCK=1 set edilmiş — kontrol bypass edildi (commit\'e izin veriliyor)');
  console.error('  ⚠ Eğer kasıtlı bir değişiklikse: node scripts/check-locked-modules.cjs --update\n');
  process.exit(0);
}

console.error('  Ne yapmalısın?');
console.error('    1) Eğer YANLIŞLIKLA değiştirdiysen: git checkout HEAD -- ' + mismatches.map(m => m.relPath).join(' '));
console.error('    2) Eğer KASITLI değiştirdiysen ve yeni hash baseline olsun: node scripts/check-locked-modules.cjs --update');
console.error('    3) Tek seferlik bypass: MOREN_UNLOCK=1 git commit ...');
console.error('');
process.exit(1);
