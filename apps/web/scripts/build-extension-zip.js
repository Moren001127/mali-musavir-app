#!/usr/bin/env node
/**
 * Vercel prebuild — apps/moren-auto-agent klasorunu zip'leyip
 * apps/web/public/moren-auto-agent.zip'e koyar.
 * Her deploy'da kullanicilar en guncel extension'i indirir.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const EXT_SRC = path.join(ROOT, 'apps', 'moren-auto-agent');
const PUBLIC_DIR = path.join(ROOT, 'apps', 'web', 'public');
const OUTPUT = path.join(PUBLIC_DIR, 'moren-auto-agent.zip');

if (!fs.existsSync(EXT_SRC)) {
  console.warn('[build-extension-zip] Extension kaynagi yok: ' + EXT_SRC + ' - atlaniyor.');
  process.exit(0);
}
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (fs.existsSync(OUTPUT)) {
  try { fs.unlinkSync(OUTPUT); } catch (_) { /* permission yoksa overwrite ile devam */ }
}

let extVersion = 'unknown';
try {
  const m = JSON.parse(fs.readFileSync(path.join(EXT_SRC, 'manifest.json'), 'utf8'));
  extVersion = m.version || 'unknown';
} catch (e) {
  console.warn('[build-extension-zip] manifest.json okunamadi:', e.message);
}
console.log('[build-extension-zip] v' + extVersion + ' paketleniyor -> ' + OUTPUT);

let archiver = null;
try { archiver = require('archiver'); } catch (_) { archiver = null; }

if (archiver) {
  const output = fs.createWriteStream(OUTPUT);
  const archive = archiver('zip', { zlib: { level: 9 } });
  output.on('close', function () {
    console.log('[build-extension-zip] OK · ' + (archive.pointer() / 1024).toFixed(1) + ' KB');
  });
  archive.on('error', function (err) { throw err; });
  archive.pipe(output);
  archive.directory(EXT_SRC, 'moren-auto-agent');
  archive.finalize();
} else {
  // Fallback: Python 3 ile zip (script tmpfile uzerinden cagrilir)
  try {
    const tmp = path.join(os.tmpdir(), 'moren-zip-' + Date.now() + '.py');
    const py = [
      'import zipfile, os, sys',
      'src = sys.argv[1]',
      'out = sys.argv[2]',
      'zf = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)',
      'for root, dirs, files in os.walk(src):',
      '  for f in files:',
      '    full = os.path.join(root, f)',
      '    arc = "moren-auto-agent/" + os.path.relpath(full, src)',
      '    zf.write(full, arc)',
      'zf.close()',
    ].join('\n');
    fs.writeFileSync(tmp, py);
    execSync('python3 ' + JSON.stringify(tmp) + ' ' + JSON.stringify(EXT_SRC) + ' ' + JSON.stringify(OUTPUT), { stdio: 'inherit' });
    try { fs.unlinkSync(tmp); } catch (_) {}
    const size = fs.statSync(OUTPUT).size;
    console.log('[build-extension-zip] OK (python) · ' + (size / 1024).toFixed(1) + ' KB');
  } catch (e) {
    console.error('[build-extension-zip] HATA:', e.message);
    console.error('[build-extension-zip] apps/web/package.json devDependencies icine "archiver": "^7.0.1" ekle.');
    process.exit(1);
  }
}
