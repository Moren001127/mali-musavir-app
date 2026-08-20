#!/usr/bin/env node
/**
 * GIDER TURU <-> HESAP ADI uyumu regresyonu.
 *
 * NEDEN VAR (2026-08-20, HUSEYIN YILDIZ HY02026000000202): bu kontrol FIRMA ADI eslestirici
 * nameMatchScore ile yapiliyordu. O fonksiyonun durak listesi "nakliye/nakliyat/lojistik/
 * tasimacilik/hizmet" gibi SEKTOR kelimelerini KASTEN eler (firma adlarinda ortak olduklari icin).
 * Gider hesabinda ise "NAKLIYE" o hesabin ANLAMLI kelimesidir. Sonuc: nakliye firmasinda
 * giderTuru "nakliye tasima" ile "740.01.004 NAKLIYE GIDERI" HIC eslesmiyor, hesap "icerikle
 * uyumsuz" sanilip SILINIYORDU (ekranda "Gider kodu bos").
 */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'apps', 'api', 'src', 'fatura-muhasebelestirme', 'fatura-muhasebelestirme.service.ts');
const src = fs.readFileSync(SRC, 'utf8');

if (!/giderTuruHesapUyumlu/.test(src)) {
  console.error('HATA: giderTuruHesapUyumlu kaldirilmis.');
  process.exit(1);
}
if (/const typeOk = !!giderTuru && this\.nameMatchScore\(/.test(src)) {
  console.error('HATA: gider turu SILME kontrolu yine nameMatchScore ile yapiliyor.');
  process.exit(1);
}
if (/leaves\.find\(\(a: any\) => this\.nameMatchScore\(giderTuru/.test(src)) {
  console.error('HATA: gider turu DOLDURMA yolu yine nameMatchScore ile yapiliyor (sektor kelimeleri eleniyor).');
  process.exit(1);
}
if ((src.match(/giderTuruHesapUyumlu/g) || []).length < 3) {
  console.error('HATA: giderTuruHesapUyumlu her iki cagri yerinde de kullanilmali (tanim + silme + doldurma).');
  process.exit(1);
}

const norm = (s) => String(s || '').toLocaleLowerCase('tr')
  .replace(/ş/g,'s').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ç/g,'c').replace(/ö/g,'o').replace(/ü/g,'u')
  .replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const GENEL = new Set(['gider','giderler','giderleri','gideri','gelir','gelirler','gelirleri','geliri',
  'hesap','hesabi','tutar','tutari','diger','cesitli','genel','yonetim','yonetimi',
  'maliyet','maliyeti','satis','satislar','satislari','bedeli','bedel']);
function uyumlu(hint, name) {
  const tok = (s) => norm(s).split(/\s+/).filter((w) => w.length > 3 && !GENEL.has(w));
  const a = tok(hint), b = tok(name);
  if (!a.length || !b.length) return false;
  return a.some((w) => b.some((x) => x === w || x.startsWith(w) || w.startsWith(x)));
}

const vakalar = [
  { ad: 'nakliye tasima ↔ NAKLIYE GIDERI (GERCEK VAKA)',            h: 'nakliye taşıma', n: 'NAKLİYE GİDERİ', bekle: true },
  { ad: 'nakliye tasima ↔ NAKLIYE GIDERLERI TEVKIFATLI',            h: 'nakliye taşıma', n: 'NAKLİYE GİDERLERİ TEVKİFATLI', bekle: true },
  { ad: 'nakliye tasima ↔ ARAC YAKIT GIDERLERI (eslesmemeli)',      h: 'nakliye taşıma', n: 'ARAÇ YAKIT GİDERLERİ', bekle: false },
  { ad: 'nakliye tasima ↔ MUTFAK VE YEMEKHANE (eslesmemeli)',       h: 'nakliye taşıma', n: 'MUTFAK VE YEMEKHANE GİDERLERİ', bekle: false },
  { ad: 'akaryakit ↔ ARAC YAKIT GIDERLERI',                          h: 'akaryakıt', n: 'ARAÇ YAKIT GİDERLERİ', bekle: false },
  { ad: 'arac bakim ↔ ARAC BAKIM ONARIM GIDERLERI',                  h: 'araç bakım', n: 'ARAÇ BAKIM ONARIM GİDERLERİ', bekle: true },
  { ad: 'kirtasiye ↔ KIRTASIYE GIDERLERI',                           h: 'kırtasiye', n: 'KIRTASİYE GİDERLERİ', bekle: true },
  { ad: 'kirtasiye ↔ NOTER GIDERI (eslesmemeli)',                    h: 'kırtasiye', n: 'NOTER GİDERİ', bekle: false },
  { ad: 'sadece genel kelimeler — eslesme YOK',                      h: 'gider', n: 'ÇEŞİTLİ GİDERLER', bekle: false },
];

let hata = 0;
for (const v of vakalar) {
  const s = uyumlu(v.h, v.n);
  if (s === v.bekle) console.log(`  \u2713 ${v.ad} -> ${s}`);
  else { console.error(`  \u2717 ${v.ad} -> ${s} (beklenen ${v.bekle})`); hata++; }
}
if (hata) process.exit(1);
console.log('[gider-turu-hesap-uyum-regression] OK: sektor kelimeleri korunuyor, dogru hesap silinmiyor');
