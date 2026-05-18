#!/usr/bin/env node
/**
 * E2E Pipeline Regression Runner
 * ==============================
 * fixtures/e2e/ altındaki tüm senaryoları sırayla koşturur, expected.json ile karşılaştırır.
 *
 * Modüller:
 *   ocr/              — tek OCR senaryosu (input belge → OcrResult)
 *   luca/             — Luca Excel parse (input.xlsx → LucaRow[])
 *   reconciliation/   — Engine girdi/çıktı (records+images → results)
 *   pipeline/         — Uçtan uca (belge+Excel → tam reconciliation sonucu)
 *
 * Kullanım:
 *   pnpm test:e2e
 *   pnpm test:e2e -- --module=ocr
 *   pnpm test:e2e -- --scenario=ocr/01-z-raporu
 *   pnpm test:e2e -- --update-snapshot --scenario=ocr/06-yeni
 *
 * Exit code: 0 = hepsi geçti, 1 = en az 1 senaryo bozulmuş
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(ROOT, 'fixtures', 'e2e');

const args = process.argv.slice(2);
const moduleFilter = (args.find((a) => a.startsWith('--module=')) || '').split('=')[1];
const scenarioFilter = (args.find((a) => a.startsWith('--scenario=')) || '').split('=')[1];
const updateSnapshot = args.includes('--update-snapshot');
const verbose = args.includes('--verbose');

const MODULES = ['ocr', 'luca', 'reconciliation', 'pipeline'];

function listScenarios(moduleDir) {
  const dir = path.join(FIXTURES_DIR, moduleDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => fs.statSync(path.join(dir, name)).isDirectory())
    .map((name) => `${moduleDir}/${name}`);
}

function readJsonSafe(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a, Object.keys(a || {}).sort()) === JSON.stringify(b, Object.keys(b || {}).sort());
}

function diffJson(actual, expected, pathStr = '') {
  const diffs = [];
  if (typeof actual !== typeof expected) {
    diffs.push(`${pathStr || '/'}: tip farklı (${typeof actual} vs ${typeof expected})`);
    return diffs;
  }
  if (actual === null || expected === null) {
    if (actual !== expected) diffs.push(`${pathStr || '/'}: ${actual} vs ${expected}`);
    return diffs;
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    diffs.push(`${pathStr || '/'}: biri array biri değil`);
    return diffs;
  }
  if (Array.isArray(actual)) {
    if (actual.length !== expected.length) {
      diffs.push(`${pathStr}: array uzunluğu ${actual.length} vs ${expected.length}`);
    }
    const min = Math.min(actual.length, expected.length);
    for (let i = 0; i < min; i++) {
      diffs.push(...diffJson(actual[i], expected[i], `${pathStr}[${i}]`));
    }
    return diffs;
  }
  if (typeof actual === 'object') {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const k of keys) {
      diffs.push(...diffJson(actual[k], expected[k], `${pathStr}.${k}`));
    }
    return diffs;
  }
  if (actual !== expected) diffs.push(`${pathStr}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
  return diffs;
}

/* ─── Senaryoyu koştur ─── */
async function runScenario(scenarioPath) {
  const dir = path.join(FIXTURES_DIR, scenarioPath);
  if (!fs.existsSync(dir)) return { skipped: true, reason: 'klasör yok' };

  const moduleType = scenarioPath.split('/')[0];
  const expectedPath = path.join(dir, 'expected.json');
  const expected = readJsonSafe(expectedPath);

  // Eğer expected boşsa ve --update-snapshot yoksa → skip
  if (!expected && !updateSnapshot) {
    return { skipped: true, reason: 'expected.json yok' };
  }

  // Her modüle özgü runner (gerçek implementasyon, modüller dolduğunda yazılır)
  let actual;
  try {
    switch (moduleType) {
      case 'ocr':
        actual = await runOcrScenario(dir);
        break;
      case 'luca':
        actual = await runLucaScenario(dir);
        break;
      case 'reconciliation':
        actual = await runReconciliationScenario(dir);
        break;
      case 'pipeline':
        actual = await runPipelineScenario(dir);
        break;
      default:
        return { skipped: true, reason: `bilinmeyen modül ${moduleType}` };
    }
  } catch (e) {
    return { failed: true, error: e.message };
  }

  if (actual === null || actual === undefined) {
    return { skipped: true, reason: 'runner sonuç dönmedi (henüz implementasyon eksik)' };
  }

  if (updateSnapshot) {
    fs.writeFileSync(expectedPath, JSON.stringify(actual, null, 2));
    return { updated: true };
  }

  const diffs = diffJson(actual, expected);
  if (diffs.length === 0) return { passed: true };

  return { failed: true, diffs };
}

/* ─── Modül runner'lar — şimdilik iskelet ─── */
// Bunlar gerçek senaryo eklenince doldurulacak. Şu an "input gerçek dosya yoksa null" döner,
// orchestrator bunu "henüz implementasyon yok → skip" olarak işler.

async function runOcrScenario(dir) {
  const inputMeta = readJsonSafe(path.join(dir, 'input.meta.json'));
  if (!inputMeta) return null;
  // TODO: gerçek belge dosyasını OCR servisine ver, sonucu döndür
  // Henüz API HTTP çağrısı yapma — bu test isolated runner olmalı
  // Yaklaşım: OCR servisinin pure function bölümlerini direkt çağır (parser/validator)
  return null;
}

async function runLucaScenario(dir) {
  const inputMeta = readJsonSafe(path.join(dir, 'input.meta.json'));
  const inputXlsx = path.join(dir, 'input.xlsx');
  if (!inputMeta || !fs.existsSync(inputXlsx)) return null;
  // TODO: ExcelJS ile Luca Excel'ini parse et, LucaRow[] döndür
  return null;
}

async function runReconciliationScenario(dir) {
  const input = readJsonSafe(path.join(dir, 'input.json'));
  if (!input) return null;
  // TODO: reconciliation engine'in pure scoring/matching kısımlarını çağır
  // Çift orphan invariant check de burada koş
  let invariantViolations = [];
  try {
    const { detectDoubleOrphans } = require('@mali-musavir/shared');
    // input.expectedResults varsa onlar üzerinden invariant kontrol et
    if (Array.isArray(input.expectedResults)) {
      invariantViolations = detectDoubleOrphans(input.expectedResults);
    }
  } catch {}
  return { invariantViolations, note: 'placeholder' };
}

async function runPipelineScenario(dir) {
  const inputMeta = readJsonSafe(path.join(dir, 'input.meta.json'));
  if (!inputMeta) return null;
  // TODO: Tüm akış: belge → OCR → record store → reconciliation → result
  return null;
}

/* ─── Ana ─── */
async function main() {
  console.log('— E2E Pipeline Regression —\n');

  if (!fs.existsSync(FIXTURES_DIR)) {
    console.log('fixtures/e2e/ klasörü yok, atlanıyor.');
    process.exit(0);
  }

  const allScenarios = [];
  for (const m of MODULES) {
    if (moduleFilter && m !== moduleFilter) continue;
    allScenarios.push(...listScenarios(m));
  }
  const filtered = scenarioFilter ? allScenarios.filter((s) => s === scenarioFilter) : allScenarios;

  if (filtered.length === 0) {
    console.log('Çalıştırılabilir senaryo yok — fixtures/e2e/ altına gerçek belge ekleyin.');
    process.exit(0);
  }

  let passed = 0, failed = 0, skipped = 0, updated = 0;
  const failures = [];
  for (const scen of filtered) {
    const result = await runScenario(scen);
    if (result.passed) {
      passed++;
      if (verbose) console.log(`  ✓ ${scen}`);
    } else if (result.updated) {
      updated++;
      console.log(`  📸 ${scen} — snapshot güncellendi`);
    } else if (result.skipped) {
      skipped++;
      if (verbose) console.log(`  ○ ${scen} — ${result.reason}`);
    } else if (result.failed) {
      failed++;
      console.log(`  ✗ ${scen}`);
      if (result.error) console.log(`     hata: ${result.error}`);
      if (Array.isArray(result.diffs)) {
        for (const d of result.diffs.slice(0, 10)) {
          console.log(`     diff: ${d}`);
        }
        if (result.diffs.length > 10) console.log(`     ... ve ${result.diffs.length - 10} fark daha`);
      }
      failures.push(scen);
    }
  }

  console.log(`\nÖzet: ${passed} geçti · ${failed} bozuk · ${skipped} atlandı · ${updated} güncel`);
  if (failed > 0) {
    console.log('\nBozuk senaryolar:');
    failures.forEach((s) => console.log(`  - ${s}`));
    process.exit(1);
  }
  if (!moduleFilter && !scenarioFilter && skipped === filtered.length) {
    console.log('\nHiçbir senaryo gerçek veri içermiyor — eklemek için fixtures/e2e/README.md\'ye bakın.');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('Runner çöktü:', e);
  process.exit(2);
});
