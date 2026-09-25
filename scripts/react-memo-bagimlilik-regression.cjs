/**
 * REACT MEMO BAGIMLILIK NOBETI (2026-09-25).
 *
 * GERCEK OLAY: e-Arsiv ekraninda Luca'dan cekim bitiyor, sorgu gercekten yenileniyor, yeni
 * veri geliyor — ama EKRAN ESKI LISTEYI gosteriyordu; kullanici sayfayi elle yenilemek
 * zorunda kaliyordu. Kok neden bir bagimlilik hatasiydi:
 *
 *     }, [modeArr, queries.map((q) => q.data).join('|')]);
 *
 * `q.data` bir NESNE; `join()` onu her seferinde ayni "[object Object]" metnine cevirir.
 * Yani veri degisse bile bagimlilik DEGISMEZ → useMemo eski degeri dondurur. Sayfa
 * yenilenince memo sifirdan hesaplandigi icin veri "yenileyince geliyor" gibi gorunur.
 * (Canli olcum: veri yaziminda gecikme YOK — 14 isin hepsinde +0 sn. Sorun tazeleme
 * penceresi degil, tam olarak buydu.)
 *
 * Bu nobet, bagimlilik dizisinde NESNE -> metin cevirimi yapan kaliplari yakalar.
 * Dogru kalip: degisen bir skaler kullan (ornegin React Query'nin `dataUpdatedAt`'i).
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web/src');

function tsxDosyalari(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') tsxDosyalari(p, out); }
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Bagimlilik dizisi icinde ".data)" / ".data )" gibi NESNE alanini join eden kaliplar.
// `?.data?.status` gibi SKALER alanlar guvenlidir; yalniz ".data" ile BITEN erisim yakalanir.
const TEHLIKELI = /\.map\(\s*\([^)]*\)\s*=>\s*[A-Za-z_$][\w$?.]*\.data\s*\)\s*\.join\(/;

const dosyalar = tsxDosyalari(WEB);
const bulgular = [];
for (const f of dosyalar) {
  const src = fs.readFileSync(f, 'utf8');
  const satirlar = src.split(/\r?\n/);
  satirlar.forEach((s, i) => {
    if (TEHLIKELI.test(s)) {
      bulgular.push(`${path.relative(ROOT, f)}:${i + 1}  ${s.trim().slice(0, 110)}`);
    }
  });
}

assert.strictEqual(
  bulgular.length, 0,
  `Bagimlilik dizisinde NESNE -> metin cevirimi bulundu (her yenilemede ayni "[object Object]" uretir,\n`
  + `memo/effect GUNCELLENMEZ). Degisen bir skaler kullan (React Query'de dataUpdatedAt):\n  `
  + bulgular.join('\n  '),
);

// e-Arsiv ekraninda duzeltmenin YERINDE oldugunu ayrica dogrula.
const earsiv = fs.readFileSync(path.join(WEB, 'app/(panel)/panel/e-arsiv/page.tsx'), 'utf8');
assert.ok(
  /queries\.map\(\(q: any\) => q\.dataUpdatedAt\)\.join\('\|'\)/.test(earsiv),
  'e-Arsiv liste memosu dataUpdatedAt kullanmali (eski hali q.data idi — liste yenilenmiyordu)',
);

console.log(`[react-memo-bagimlilik-regression] ${dosyalar.length} dosya tarandi · 2 assertion — HEPSI GECTI`);
