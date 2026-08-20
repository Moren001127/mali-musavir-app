#!/usr/bin/env node
/**
 * GIB e-Arsiv LISTE (TASLAKLARI_GETIR) satir sozlesmesi regresyonu.
 *
 * CANLI KANIT (2026-08-20, EDELER): liste satirinda DONEN ALANLAR YALNIZCA sunlar:
 *   belgeNumarasi, aliciVknTckn, aliciUnvanAdSoyad, belgeTarihi, belgeTuru, onayDurumu, ettn
 *
 * TUTAR ALANI YOKTUR. Ilk yazdigimiz eslestirme "odenecekTutar" ile karsilastiriyordu ve
 * bu yuzden HICBIR ZAMAN eslesmezdi (fatura no sessizce null kalirdi). Bu test, eslestirmenin
 * var olmayan alanlara geri donmesini engeller.
 */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'apps', 'api', 'src', 'fatura-kes', 'fatura-kes-gib.service.ts');
const src = fs.readFileSync(SRC, 'utf8');

// belgeyiBul govdesini ayikla
const bas = src.indexOf('private async belgeyiBul');
if (bas < 0) { console.error('  \u2717 belgeyiBul bulunamadi'); process.exit(1); }
const son = src.indexOf('private async gorselAl');
const govde = src.slice(bas, son > bas ? son : src.length);

let hata = 0;

// 1) Listede OLMAYAN alanlarla eslestirme YAPILMAMALI
const OLMAYAN = ['odenecekTutar', 'vergilerDahilToplamTutar', 'toplamTutar', 'matrah', 'hesaplanankdv'];
for (const a of OLMAYAN) {
  if (govde.includes(a)) { console.error(`  \u2717 belgeyiBul listede OLMAYAN alani kullaniyor: ${a}`); hata++; }
}
if (!hata) console.log('  \u2713 listede olmayan alanlarla eslestirme yok (tutar yok)');

// 2) Gercek alanlar kullanilmali
const GEREKLI = [
  ['aliciVknTckn', 'alici VKN ile eslestirme'],
  ['belgeNumarasi', 'belge numarasi okunmasi'],
  ['ettn', 'ETTN okunmasi'],
  ['onayDurumu', 'onay durumu kontrolu'],
];
for (const [alan, ad] of GEREKLI) {
  if (!govde.includes(alan)) { console.error(`  \u2717 ${ad} yok (${alan})`); hata++; }
  else console.log(`  \u2713 ${ad}`);
}

// 3) Guvenlik kurallari
const kurallar = [
  { ad: 'silinmis/iptal satir elenir', ok: /silin\|iptal|iptal\|silin/i.test(govde) },
  { ad: 'yalniz IMZASIZ (Onaylanmadi) satir aday olur', ok: /onaylanmad/i.test(govde) },
  { ad: 'bizde kayitli ETTN elenir (eski belge secilmesin)', ok: /bilinen\.has|already|kayitli/i.test(govde) },
  { ad: 'birden fazla adayda TAHMIN EDILMEZ', ok: /adaylar\.length !== 1/.test(govde) },
];
for (const k of kurallar) {
  if (k.ok) console.log(`  \u2713 ${k.ad}`);
  else { console.error(`  \u2717 ${k.ad}`); hata++; }
}

if (hata) process.exit(1);
console.log('[gib-liste-sozlesme-regression] OK: liste eslestirmesi gercek alan sozlesmesine kilitli');
