#!/usr/bin/env node
/**
 * Tevkifat tespiti — KELIME IPUCU vs ARITMETIK regresyonu.
 *
 * NEDEN VAR: tevkifatHint, faturanin herhangi bir yerinde "tevkifat" kelimesi gecince true
 * oluyor (nakliye faturalarindaki "tevkifata tabi degildir" notu dahil). Bu tek basina belgeyi
 * tevkifatli saymaya yetiyordu. GERCEK VAKA (YORGUN NAKLIYAT / BARANLAR BRN2026000000483):
 * matrah 10.000, KDV 2.000 (TAM %20), toplam 12.000 → tevkifat YOK, ama "Tevkifatli ALIS —
 * 360 satiri eksik" celiskisi veriliyor ve belge onaylanamiyordu.
 *
 * KURAL: gercek veri (kdvTevkifat / tevkifatOrani) varsa ona guvenilir; YALNIZ kelime ipucu
 * varsa aritmetige bakilir — tahsil edilen KDV matrah x oran'a esitse tevkifat yoktur.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'apps', 'api', 'src', 'fatura-muhasebelestirme', 'fatura-muhasebelestirme.service.ts');
const src = fs.readFileSync(SRC, 'utf8');

if (!/tevkifatGercekVeri/.test(src)) {
  console.error('HATA: tevkifat gercek-veri/kelime-ipucu ayrimi kaldirilmis.');
  process.exit(1);
}
if (/const tevkifatli = [^\n]*tevkifatHint === true;/.test(src)) {
  console.error('HATA: tevkifatli yine DOGRUDAN kelime ipucuna baglanmis (aritmetik veto atlanmis).');
  process.exit(1);
}

// Kaynaktaki mantigin birebir kopyasi
const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/\s|₺|TL/gi, '');
  const son = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (son < 0) return Number(s) || 0;
  const tam = s.slice(0, son).replace(/[.,]/g, '');
  return Number(tam + '.' + s.slice(son + 1)) || 0;
};
function tevkifatliMi(o) {
  const breakdown = Array.isArray(o.kdvBreakdown) ? o.kdvBreakdown : null;
  const gercek = num(o.kdvTevkifat) > 0 || Number(o.tevkifatOrani || 0) > 0;
  let tevkifatli = gercek || o.tevkifatHint === true;
  if (tevkifatli && !gercek) {
    let tam = 0, okunan = 0;
    if (breakdown && breakdown.length) {
      for (const b of breakdown) {
        const m = num(b && b.matrah), r = Number((b && b.oran) || 0), t = num(b && b.tutar);
        if (m > 0 && r > 0) tam += m * (r / 100);
        if (t > 0) okunan += t;
      }
    } else {
      const m = num(o.matrah), r = Number(o.kdvOrani || 0);
      if (m > 0 && r > 0) tam = m * (r / 100);
      okunan = num(o.kdvTutari);
    }
    if (tam > 0 && okunan > 0 && Math.abs(okunan - tam) <= Math.max(1, tam * 0.01)) tevkifatli = false;
  }
  return tevkifatli;
}

const vakalar = [
  { ad: 'BARANLAR BRN...483 — "tevkifat" kelimesi var ama KDV TAM (GERCEK VAKA)',
    o: { matrah: 10000, kdvOrani: 20, kdvTutari: 2000, tevkifatOrani: 0, tevkifatKdv: 0, tevkifatHint: true,
         kdvBreakdown: [{ oran: 20, tutar: 2000, matrah: 10000 }] }, bekle: false },
  { ad: 'Gercek tevkifatli 2/10 — KDV eksik tahsil edilmis',
    o: { matrah: 10000, kdvOrani: 20, kdvTutari: 1600, tevkifatOrani: 0.2, tevkifatHint: true }, bekle: true },
  { ad: 'Gercek tevkifat tutari okunmus (oran yok)',
    o: { matrah: 10000, kdvOrani: 20, kdvTutari: 1000, kdvTevkifat: '1.000,00', tevkifatHint: true }, bekle: true },
  { ad: 'Kelime ipucu var, KDV eksik — tevkifatli sayilmali (aritmetik veto ETMEZ)',
    o: { matrah: 10000, kdvOrani: 20, kdvTutari: 1200, tevkifatOrani: 0, tevkifatHint: true }, bekle: true },
  { ad: 'Kelime ipucu YOK — tevkifatsiz',
    o: { matrah: 5000, kdvOrani: 10, kdvTutari: 500 }, bekle: false },
  { ad: 'Cok oranli, hepsi tam KDV, kelime ipucu var',
    o: { tevkifatHint: true, kdvBreakdown: [{ oran: 20, tutar: 200, matrah: 1000 }, { oran: 10, tutar: 100, matrah: 1000 }] }, bekle: false },
  { ad: 'Tutar okunamamis (0) — kelime ipucu korunur, veto edilmez',
    o: { matrah: 0, kdvOrani: 0, kdvTutari: 0, tevkifatHint: true }, bekle: true },
];

let hata = 0;
for (const v of vakalar) {
  const s = tevkifatliMi(v.o);
  if (s === v.bekle) console.log(`  \u2713 ${v.ad} -> ${s ? 'tevkifatli' : 'tevkifatsiz'}`);
  else { console.error(`  \u2717 ${v.ad} -> ${s} (beklenen ${v.bekle})`); hata++; }
}
if (hata) process.exit(1);
console.log('[tevkifat-aritmetik-regression] OK: kelime ipucu aritmetigi ezemiyor');
