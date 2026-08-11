// KALEM-BAZLI matrah bölme regresyonu — reconcileMatrahSplit SAF mantığını doğrular.
//   En kritik özellik: bölme yapıldığında her oranın kalem-tabanları toplamı = o oranın matrahı (EXACT)
//   → DENGE (borç=alacak) korunur; şüpheli durumda null döner (çağıran tek-hesaba düşer).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let failed = 0;
function assert(ok, msg) { if (!ok) { console.error(`[kalem-split] FAIL: ${msg}`); failed++; } }

function load() {
  const file = path.join(root, 'apps/api/src/fatura-muhasebelestirme/kalem-split.ts');
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require, console }, { filename: file });
  return mod.exports;
}

const { reconcileMatrahSplit } = load();
const r2 = (n) => Math.round(n * 100) / 100;
function sumOf(map, rate) { return r2((map.get(rate) || []).reduce((a, e) => a + e.base, 0)); }

// 1) matrahSplit yok → null (tek-hesap davranışı korunur)
assert(reconcileMatrahSplit([{ rate: 20, base: 1000 }], null) === null, 'bos split → null');
assert(reconcileMatrahSplit([{ rate: 20, base: 1000 }], []) === null, 'bos dizi → null');

// 2) Tek hesap → null (bölünecek farklı hesap yok)
assert(reconcileMatrahSplit([{ rate: 20, base: 1000 }], [{ hesap: '600.01.001', rate: 20, base: 1000 }]) === null, 'tek hesap → null');

// 3) 2 hesap, tek oran, TAM denk → 2 girdi, toplam = matrah
{
  const m = reconcileMatrahSplit([{ rate: 20, base: 1000 }], [
    { hesap: '600.01.001', rate: 20, base: 600 },
    { hesap: '600.02.001', rate: 20, base: 400 },
  ]);
  assert(m && m.get(20) && m.get(20).length === 2, '2 hesap tek oran → 2 girdi');
  assert(m && sumOf(m, 20) === 1000, '2 hesap toplam matraha eşit (1000)');
}

// 4) 2 hesap, kuruş artığı (999.98, tolerans içinde) → EN BÜYÜĞE snap, toplam TAM 1000
{
  const m = reconcileMatrahSplit([{ rate: 20, base: 1000 }], [
    { hesap: '600.01.001', rate: 20, base: 599.99 },
    { hesap: '600.02.001', rate: 20, base: 399.99 },
  ]);
  assert(m !== null, 'kurus artigi tolerans icinde → bölünür');
  assert(m && sumOf(m, 20) === 1000, 'artik snap sonrasi toplam TAM matrah (1000)');
  const big = m.get(20).reduce((a, b) => (b.base > a.base ? b : a));
  assert(big.hesap === '600.01.001' && big.base === 600.01, 'artik(0.02) EN BÜYÜK girdiye eklendi (599.99→600.01)');
}

// 5) UYUMSUZ: kalem toplamı matraha uzak (700 vs 1000) → null (riskli, bölme)
{
  const m = reconcileMatrahSplit([{ rate: 20, base: 1000 }], [
    { hesap: '600.01.001', rate: 20, base: 400 },
    { hesap: '600.02.001', rate: 20, base: 300 },
  ]);
  assert(m === null, 'kalem toplami matraha uzaksa → null (denge riski, bölme yok)');
}

// 6) Çok oranlı, HER oran denk → oran başına girdiler, toplamlar TAM
{
  const m = reconcileMatrahSplit(
    [{ rate: 20, base: 1000 }, { rate: 10, base: 500 }],
    [
      { hesap: '600.01.001', rate: 20, base: 600 },
      { hesap: '600.02.001', rate: 20, base: 400 },
      { hesap: '600.01.001', rate: 10, base: 500 },
    ],
  );
  assert(m && sumOf(m, 20) === 1000 && sumOf(m, 10) === 500, 'çok oranlı: her oran toplamı TAM matrah');
}

// 7) Çok oranlı, BİR oran denk gelmiyor → TÜM belge null (kısmi bölme YOK, güvenli)
{
  const m = reconcileMatrahSplit(
    [{ rate: 20, base: 1000 }, { rate: 10, base: 500 }],
    [
      { hesap: '600.01.001', rate: 20, base: 600 },
      { hesap: '600.02.001', rate: 20, base: 400 },
      { hesap: '600.01.001', rate: 10, base: 200 }, // 10'da 200 ≠ 500 → uyumsuz
    ],
  );
  assert(m === null, 'bir oran uyumsuzsa TÜM belge tek-hesaba düşer (null)');
}

// 8) Aynı hesap 2 kez (ör. aynı hesap farklı kalemlerde) → TEK hesaba toplanır → <2 distinct → null
{
  const m = reconcileMatrahSplit([{ rate: 20, base: 1000 }], [
    { hesap: '600.01.001', rate: 20, base: 600 },
    { hesap: '600.01.001', rate: 20, base: 400 },
  ]);
  assert(m === null, 'aynı hesabın 2 kalemi → tek distinct → null (bölünecek fark yok)');
}

if (failed) { console.error(`\n[kalem-split] ${failed} test BAŞARISIZ`); process.exit(1); }
console.log('OK kalem-split-regression (8 senaryo, denge korunuyor)');
