#!/usr/bin/env node
/**
 * FATURA KES — tutar ayristirma + birim + birim fiyat regresyonu.
 *
 * DENETIM BULGUSU (2026-08-20, KRITIK): sayi() "en sagdaki ayrac ondaliktir" diyordu ve
 * "8.000" degerini 8 TL okuyordu. Kutunun kendi ipucu metni de "8.000,00" oldugu icin
 * kullanici tam bu yazima yonlendiriliyordu -> fatura 1000 KAT KUCUK kesilirdi.
 * Ayni hatali kural arayuzde (page.tsx mNum) de tekrarlaniyordu.
 *
 * Ayrica: GIB birim ADI degil KODU bekler ("KG" degil "KGM"), ve
 * miktar x birimFiyat matrahi TUTMALIDIR.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
for (const c of [
  'ts-node/register/transpile-only',
  path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
]) { try { require(c); break; } catch {} }

let hata = 0;

// ---------- 1) TUTAR KURALI ----------
// Kural: virgul varsa ondalik virguldur. Yalniz nokta ise: TEK nokta + 1-2 haneli kesir
//        -> ondalik; aksi (cok nokta ya da 3 haneli grup) -> TR BINLIK ayraci.
function sayi(v) {
  const ham = String(v).trim().replace(/\s|₺|TL/gi, '');
  if (!ham) return NaN;
  const eksi = /^-/.test(ham);
  const s = ham.replace(/^[-+]/, '');
  const sonVirgul = s.lastIndexOf(',');
  const sonNokta = s.lastIndexOf('.');
  let d;
  if (sonVirgul >= 0) d = s.slice(0, sonVirgul).replace(/\D/g, '') + '.' + s.slice(sonVirgul + 1).replace(/\D/g, '');
  else if (sonNokta >= 0) {
    const kesir = s.slice(sonNokta + 1);
    const tekNokta = s.indexOf('.') === sonNokta;
    d = tekNokta && /^\d{1,2}$/.test(kesir) ? s.slice(0, sonNokta).replace(/\D/g, '') + '.' + kesir : s.replace(/\D/g, '');
  } else d = s.replace(/\D/g, '');
  return Number((eksi ? '-' : '') + d);
}

const TUTAR = [
  ['8.000', 8000, 'TR binlik — 1000 kat kucuk kesme hatasi'],
  ['8.000,00', 8000, 'ekranin ipucu metni'],
  ['12.500', 12500, 'TR binlik'],
  ['1.234.567', 1234567, 'cok noktali TR binlik'],
  ['1.234,56', 1234.56, 'TR tam bicim'],
  ['1234.56', 1234.56, 'makine bicimi ondalik'],
  ['1234,56', 1234.56, 'virgullu ondalik'],
  ['1000', 1000, 'ayracsiz'],
  ['0,20', 0.2, 'kurus'],
  ['1.5', 1.5, 'tek hane kesir ondalik'],
  ['8.000 TL', 8000, 'birim ekli'],
];
for (const [g, b, ad] of TUTAR) {
  const s = sayi(g);
  if (Math.abs(s - b) < 0.005) console.log(`  \u2713 "${g}" -> ${s}  (${ad})`);
  else { console.error(`  \u2717 "${g}" -> ${s}, beklenen ${b}  (${ad})`); hata++; }
}

// Kural HEM sunucuda HEM arayuzde ayni olmali — biri duzelip digeri kalirsa
//   ekranda gorunen toplam ile kaydedilen tutar birbirini tutmaz.
const KAYNAKLAR = [
  ['apps/api/src/fatura-kes/fatura-kes.service.ts', 'sunucu sayi()'],
  ['apps/web/src/app/fatura-merkezi/page.tsx', 'arayuz mNum'],
];
for (const [rel, ad] of KAYNAKLAR) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (!(src.includes('tekNokta &&') && src.includes('{1,2}$/'))) {
    console.error(`  \u2717 ${ad}: TR binlik kurali YOK (tek nokta + 1-2 hane ayrimi)`); hata++;
  } else console.log(`  \u2713 ${ad}: TR binlik kurali var`);
}

// ---------- 2) BIRIM KODU + BIRIM FIYAT ----------
const payload = require(path.join(ROOT, 'apps/api/src/fatura-kes/gib-earsiv-payload.ts'));

const BIRIM = [['ADET', 'C62'], ['adet', 'C62'], ['KG', 'KGM'], ['Kilogram', 'KGM'], ['LİTRE', 'LTR'],
  ['M2', 'MTK'], ['ÇİFT', 'PR'], ['SAAT', 'HUR'], ['', 'C62'], ['ZIRVA', null]];
for (const [g, b] of BIRIM) {
  const s = payload.birimKodu(g);
  if (s === b) console.log(`  \u2713 birim "${g}" -> ${s === null ? 'taninmadi (dogru)' : s}`);
  else { console.error(`  \u2717 birim "${g}" -> ${s}, beklenen ${b}`); hata++; }
}

// miktar x birimFiyat == matrah OLMALI
const FIYAT = [[1000, 1], [100, 3], [8000, 7], [0.2, 1], [1234.56, 2], [1, 6]];
for (const [matrah, miktar] of FIYAT) {
  const bf = Number(payload.gibBirimFiyat(matrah, miktar));
  const carpim = Math.round(bf * miktar * 100) / 100;
  if (Math.abs(carpim - matrah) < 0.005) console.log(`  \u2713 matrah ${matrah} / ${miktar} adet -> ${bf} (carpim ${carpim})`);
  else { console.error(`  \u2717 matrah ${matrah} / ${miktar} adet -> ${bf}, carpim ${carpim} matrahi TUTMUYOR`); hata++; }
}

// Dogrulanmis yol (miktar=1) BIREBIR ayni kalmali
if (payload.gibBirimFiyat(1000, 1) !== '1000') { console.error('  \u2717 miktar=1 yolu degisti (dogrulanmis gonderim bozulur)'); hata++; }
else console.log('  \u2713 miktar=1 yolu degismedi (canli dogrulanmis gonderim korunuyor)');

if (hata) process.exit(1);
console.log('[fatura-kes-tutar-birim-regression] OK: tutar/birim/birim-fiyat kurallari kilitli');
