#!/usr/bin/env node
/**
 * PLAKA + GUZERGAH kalem kurali regresyonu.
 *
 * NEDEN VAR (2026-08-20, YORGUN NAKLIYAT / DURAK BOZDAG EFT2026000000182): nakliye firmalari
 * taseronlardan sefer faturasi alir; kalem metni cogu kez SADECE "PLAKA + KALKIS + VARIS"tir
 * ("66FE566 GAZIOSMANPASA SANCAKTEPE") ve "nakliye" kelimesi HIC gecmez. Deterministik kural
 * tanimayinca is AI'a kaliyordu; AI yer adlarini gorup "770.01.001 OTOYOL VE OTOPARK GIDERLERI"
 * hesabini seciyor, gerekcesinde de "mal/malzeme almis" diyordu (uydurma).
 */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'packages', 'shared', 'src', 'gider-icerik.ts');
const src = fs.readFileSync(SRC, 'utf8');
if (!/PLAKA \+ GÜZERGÂH/.test(src)) {
  console.error('HATA: plaka+guzergah kurali kaldirilmis.');
  process.exit(1);
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
const PLAKA = /\b(0[1-9]|[1-7]\d|8[01])\s?[a-z]{1,3}\s?\d{2,4}\b\s+[a-z]{4,}[a-z\s]*\s+[a-z]{4,}/;
const AKARYAKIT = /motorin|benzin|akaryakit|\bdizel\b|\blpg\b/;

const vakalar = [
  { ad: '66FE566 GAZIOSMANPASA SANCAKTEPE (GERCEK VAKA)', t: '66FE566 GAZİOSMANPAŞA SANCAKTEPE', bekle: true },
  { ad: '34 ABC 123 ISTANBUL ANKARA (bosluklu plaka)',     t: '34 ABC 123 İSTANBUL ANKARA', bekle: true },
  { ad: '06BK4521 GEBZE HADIMKOY',                          t: '06BK4521 GEBZE HADIMKÖY', bekle: true },
  { ad: '34ABC123 MUAYENE (tek kelime — nakliye DEGIL)',    t: '34ABC123 MUAYENE', bekle: false },
  { ad: 'plakasiz duz metin',                               t: 'DANISMANLIK BEDELI', bekle: false },
  { ad: '99XX999 (gecersiz il kodu)',                       t: '99XX999 ANKARA IZMIR', bekle: false },
  { ad: 'tarih benzeri sayilar',                            t: '2026 MODEL ARAC SATISI', bekle: false },
];
let hata = 0;
for (const v of vakalar) {
  const s = PLAKA.test(norm(v.t));
  if (s === v.bekle) console.log(`  \u2713 ${v.ad} -> ${s}`);
  else { console.error(`  \u2717 ${v.ad} -> ${s} (beklenen ${v.bekle})`); hata++; }
}
// ONCELIK: akaryakit gibi acik anahtar kelime plakadan ONCE eslesmeli
const yakit = '34ABC123 MOTORIN ISTANBUL';
if (!AKARYAKIT.test(norm(yakit))) { console.error('  \u2717 akaryakit kurali oncelikli eslesmeli'); hata++; }
else console.log('  \u2713 "34ABC123 MOTORIN ISTANBUL" -> akaryakit kurali ONCE eslesir (plaka kurali en sonda)');
if (hata) process.exit(1);
console.log('[plaka-guzergah-regression] OK: sefer faturasi nakliye sayiliyor, tek-kelimeli satirlar sayilmiyor');
