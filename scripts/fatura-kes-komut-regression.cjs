#!/usr/bin/env node
/**
 * WhatsApp fatura komutu — SAF MANTIK regresyonu (yapay zeka cagirmadan).
 *
 * Kullanici kurallari (2026-08-20):
 *   • Sabit kalip YOK: metin nasil yazilirsa yazilsin alanlar cikarilir.
 *   • EKSIK alan UYDURULMAZ, SORULUR. Ozellikle KDV orani: yazilmadiysa varsayilan KONMAZ.
 *   • Komutta HEM satici (mukellef) HEM alici olmali.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
for (const c of ['ts-node/register/transpile-only',
  path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only')]) {
  try { require(c); break; } catch {}
}

const { FaturaKesKomutService: S } = require(path.join(ROOT, 'apps/api/src/fatura-kes/fatura-kes-komut.service.ts'));
let hata = 0;
const esit = (ad, olan, beklenen) => {
  const ok = olan === beklenen;
  if (ok) console.log(`  \u2713 ${ad}`);
  else { console.error(`  \u2717 ${ad}\n      olan     : ${olan}\n      beklenen : ${beklenen}`); hata++; }
};

// --- On eleme: fatura komutu mu? ---
const KOMUT = [
  ['edelerden ahmet yilmaza 5 bin lira danismanlik faturasi kes', true],
  ['EDELER YEMEK bugun metro insaata fatura kessin', true],
  ['fatura kesme ekranini acar misin', true],
  ['merhaba nasilsin', false],
  ['temmuz kdv beyannamesi ne durumda', false],
  ['', false],
];
for (const [metin, b] of KOMUT) esit(`on eleme: "${metin.slice(0, 34)}"`, S.faturaKomutuMu(metin), b);

// --- Eksik alan sorulari: SIRA onemli ---
const T = { taxpayerId: 'x', aliciVkn: '1234567890', aliciUnvan: 'ABC LTD', aciklama: 'YEMEK BEDELI', matrah: 1000, kdvOrani: 20 };
esit('tam veri -> soru yok', S.eksikSorusu(T), null);
esit('mukellef yoksa once o sorulur', S.eksikSorusu({ ...T, taxpayerId: null }), 'Hangi mükelleften keselim?');
esit('alici vkn yoksa sorulur', S.eksikSorusu({ ...T, aliciVkn: null }),
  'Alıcının vergi kimlik numarası (ya da TC kimlik numarası) nedir?');
esit('9 haneli vkn reddedilir', S.eksikSorusu({ ...T, aliciVkn: '123456789' }),
  '"123456789" geçerli bir vergi/TC kimlik numarası değil (10 ya da 11 hane olmalı). Doğrusu nedir?');
esit('11 hane (TCKN) kabul', S.eksikSorusu({ ...T, aliciVkn: '33248357162' }), null);
esit('unvan yoksa sorulur', S.eksikSorusu({ ...T, aliciUnvan: '' }), 'Alıcının ünvanı (ya da ad soyadı) nedir?');
esit('icerik yoksa sorulur', S.eksikSorusu({ ...T, aciklama: null }), 'Fatura içeriği ne yazsın?');
esit('tutar yoksa sorulur', S.eksikSorusu({ ...T, matrah: null }), 'Tutar (KDV hariç) ne kadar?');
esit('tutar 0 kabul edilmez', S.eksikSorusu({ ...T, matrah: 0 }), 'Tutar (KDV hariç) ne kadar?');

// KRITIK: KDV orani yazilmadiysa VARSAYILAN KONMAZ, sorulur
esit('KDV orani yoksa SORULUR (varsayilan %20 KONMAZ)', S.eksikSorusu({ ...T, kdvOrani: null }),
  'KDV oranı kaç? (%0, %1, %10, %20)');
esit('KDV %0 gecerli', S.eksikSorusu({ ...T, kdvOrani: 0 }), null);
esit('KDV %18 (artik yok) reddedilir', S.eksikSorusu({ ...T, kdvOrani: 18 }),
  'KDV oranı %18 olamaz. %0, %1, %10 ya da %20 olmalı — hangisi?');

if (hata) process.exit(1);
console.log('[fatura-kes-komut-regression] OK: eksik alan uydurulmuyor, KDV orani varsayilani yok');
