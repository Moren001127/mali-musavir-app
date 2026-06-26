const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function assert(ok, msg) {
  if (!ok) {
    console.error(`[fatura-accounting-guards] FAIL: ${msg}`);
    process.exit(1);
  }
}

function loadShared() {
  const file = path.join(root, 'packages/shared/src/isletme-referans.ts');
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require, console }, { filename: file });
  return mod.exports;
}

const shared = loadShared();

assert(shared.normalizeDocumentType('e-Arşiv Fatura') === 'E_ARSIV', 'e-Arşiv metni E_ARSIV olmali');
assert(shared.normalizeDocumentType('EARSIVFATURA') === 'E_ARSIV', 'EARSIVFATURA E_ARSIV olmali');
assert(shared.normalizeDocumentType('Ticari Fatura') === 'E_FATURA', 'Ticari Fatura E_FATURA olmali');
assert(shared.defaultBelgeTuruKod('e-arsiv', 'ALIS') === '10', 'Alis e-Arsiv belge kodu 10 olmali');
assert(shared.defaultBelgeTuruKod('e-arsiv', 'SATIS') === '8', 'Satis e-Arsiv belge kodu 8 olmali');
assert(shared.defaultBelgeTuruKod('e-fatura', 'ALIS') === '9', 'Alis e-Fatura belge kodu 9 olmali');

const ticari = shared.isletmeGiderSinifi({ matrahKategori: 'ticari_mal' });
assert(ticari && ticari.kayitTuruKod === '1' && ticari.kayitAltKod === '186', 'ticari_mal Mal Alisi olmali');
const elektrik = shared.isletmeGiderSinifi({ giderTuru: 'elektrik' });
assert(elektrik && elektrik.kayitTuruKod === '4' && elektrik.kayitAltKod === '82', 'elektrik GVK40/82 olmali');
assert(shared.isletmeGiderSinifi({ giderTuru: '' }) === null, 'belirsiz alis otomatik gider olmamali');

const service = fs.readFileSync(path.join(root, 'apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.service.ts'), 'utf8');
assert(service.includes('isletmeDocumentReady(doc)'), 'approve isletmeDocumentReady kapisini kullanmali');
assert(service.includes('isletmeWithBelgeDefaults(doc)'), 'approve belge turu varsayimini ocrData.isletme icine yazmali');
assert(service.includes('!this.learnedMatrahCompatibleWithContent'), 'satici hafizasi icerik uyumu kontrol edilmeli');
assert(service.includes('isletmeGiderSinifi({ matrahKategori: ocr?.matrahKategori'), 'isletme fallback isletmeGiderSinifi kullanmali');

const page = fs.readFileSync(path.join(root, 'apps/web/src/app/fatura-merkezi/page.tsx'), 'utf8');
assert(page.includes('isletmeDocReady(d).ok'), 'frontend toplu/list hazir kontrolu isletmeDocReady kullanmali');
assert(page.includes('currentIslReady'), 'Muhasebelestir butonu formdaki isletme secimlerini kontrol etmeli');
assert(page.includes('normalizeDocumentType(selDoc.documentType'), 'isletme belge turu normalize edilmeli');

console.log('OK fatura-accounting-guards-regression');
