#!/usr/bin/env node
/**
 * GIB e-Arsiv "Fatura Olustur" veri sozlesmesi regresyonu.
 *
 * NE SINANIR: portalin GIB'e gonderdigi 52 fatura alani + 15 kalem alani, ve bunlarin
 * bicim kurallari (tutarlar nokta ile, kdvOrani metin, bazi alanlar TEK BOSLUK vb.).
 *
 * HANGI GERCEK FONKSIYONLAR CAGRILIR — betigin kendi kopyasi YOK
 *   apps/api/src/fatura-kes/gib-earsiv-payload.ts (hepsi export edilmis, dogrudan import)
 *     - gibFaturaPayload()  : GERCEK gonderim nesnesi uretilir; alanlar ve degerler
 *                             kaynak metninden degil URETILEN NESNEDEN okunur
 *     - gibTutar()          : tutar bicimlendirme
 *     - gibTarih()          : yatirimTesvikTarihi karsilastirmasi
 *     - GIB_ZORUNLU_ALANLAR / GIB_KALEM_ALANLARI : fatura-kes-gib.service.ts'in
 *                             gonderim oncesi eksik-alan denetiminde kullandigi listeler
 *
 * DENETIM BULGUSU (2026-09-25): bu betik eskiden kaynak METNINDE regex ariyordu
 * (ornek: /hangiTip:\s*'5000\/30000'/.test(src)) ve tutar bicimlendirmeyi kendi
 * icindeki "function gibTutar(n)" KOPYASI ile sinardi. Uygulamadaki fonksiyon bozulsa
 * test yine geciyordu. Kopya kaldirildi, tum kontroller davranis sinamasina cevrildi.
 *
 * METIN TABANLI KALAN KONTROL: YOK. Hicbir kontrol kaynak dosyayi metin olarak okumuyor.
 *
 * KAYNAK: sozlesme tahmin degil. 2026-08-20'de EDELER YEMEK mukellefinde portalin KENDI
 * ekranindan taslak olusturulurken tarayicinin GIB'e gonderdigi istek birebir yakalandi.
 * Ilk denememiz reddedilmisti ve GIB sebebi SOYLEMIYOR ("Bir hata meydana geldi"),
 * o yuzden sozlesmeden her sapma testle yakalanmali.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');

process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });

function ilkYuklenen(adaylar, ad) {
  for (const c of adaylar) {
    try { return require(c); } catch { /* sonraki adaya gec */ }
  }
  console.error(`  ✗ ${ad} yuklenemedi — test GERCEK uygulama koduna baglanamadi, sonuc guvenilmez.`);
  process.exit(1);
}

ilkYuklenen([
  'ts-node/register/transpile-only',
  path.join(ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'ts-node', 'register', 'transpile-only'),
], 'ts-node');

const payload = require(path.join(ROOT, 'apps/api/src/fatura-kes/gib-earsiv-payload.ts'));

// Portalin GERCEKTE gonderdigi 52 alan
const BEKLENEN = ['faturaUuid','belgeNumarasi','faturaTarihi','saat','paraBirimi','dovzTLkur','faturaTipi','hangiTip','vknTckn','aliciUnvan','aliciAdi','aliciSoyadi','binaAdi','binaNo','kapiNo','kasabaKoy','vergiDairesi','ulke','bulvarcaddesokak','irsaliyeNumarasi','irsaliyeTarihi','mahalleSemtIlce','sehir','postaKodu','tel','fax','eposta','websitesi','iadeTable','ihracKayitliKarsiBelgeNo','yatirimTesvikNumarasi','yatirimTesvikTarihi','kdvOranKontrolMuafiyeti','vergiCesidi','malHizmetTable','tip','matrah','malhizmetToplamTutari','toplamIskonto','hesaplanankdv','vergilerToplami','vergilerDahilToplamTutar','odenecekTutar','not','siparisNumarasi','siparisTarihi','fisNo','fisTarihi','fisSaati','fisTipi','zRaporNo','okcSeriNo'];
const KALEM = ['malHizmet','miktar','birim','birimFiyat','fiyat','iskontoOrani','iskontoTutari','iskontoNedeni','malHizmetTutari','kdvOrani','vergiOrani','kdvTutari','vergininKdvTutari','ozelMatrahTutari','hesaplananotvtevkifatakatkisi'];

let hata = 0;

// GERCEK gonderim nesnesini uret. Zaman sabit tutuluyor ki saat/tarih alanlari
// karsilastirilabilsin. Girdide bilerek VIRGUL YOK — "tutarda virgul olmayacak"
// kontrolu serbest metinden gelen virgulle kirlenmesin.
const SIMDI = new Date(2026, 7, 20, 14, 35, 9); // 20/08/2026 14:35:09
const GIRDI = {
  aliciVkn: '1234567890',
  aliciUnvan: 'EDELER YEMEK SANAYI LTD STI',
  aliciAdres: 'Ornek Mahallesi Ornek Caddesi No 5',
  aliciVd: 'Sakarya',
  aliciEposta: 'ornek@ornek.com',
  faturaTarihi: new Date(2026, 7, 20),
  aciklama: 'Yemek hizmeti',
  miktar: 1,
  birim: 'ADET',
  matrah: 1000,
  kdvOrani: 10,
  kdvTutari: 100,
  toplam: 1100,
};

let p;
let kalem;
try {
  p = payload.gibFaturaPayload(GIRDI, SIMDI);
  kalem = Array.isArray(p.malHizmetTable) ? p.malHizmetTable[0] : undefined;
  if (!kalem) throw new Error('malHizmetTable bos — kalem uretilmemis');
  console.log('  ✓ gibFaturaPayload() cagrildi, gercek gonderim nesnesi uretildi');
} catch (e) {
  console.error(`  ✗ gibFaturaPayload() cagrilamadi: ${e.message}`);
  process.exit(1);
}

// ---------- 1) ALAN LISTESI (uretilen nesne uzerinden) ----------
for (const a of BEKLENEN) {
  if (!(a in p)) { console.error(`  ✗ ALAN EKSIK: ${a}`); hata++; }
}
for (const a of KALEM) {
  if (!(a in kalem)) { console.error(`  ✗ KALEM ALANI EKSIK: ${a}`); hata++; }
}
// Sozlesme birebir yakalandi: fazla alan da sapmadir.
const fazla = Object.keys(p).filter((a) => !BEKLENEN.includes(a));
const kalemFazla = Object.keys(kalem).filter((a) => !KALEM.includes(a));
if (fazla.length) { console.error(`  ✗ SOZLESMEDE OLMAYAN ALAN: ${fazla.join(', ')}`); hata++; }
if (kalemFazla.length) { console.error(`  ✗ SOZLESMEDE OLMAYAN KALEM ALANI: ${kalemFazla.join(', ')}`); hata++; }
if (!hata) console.log(`  ✓ ${BEKLENEN.length} fatura alani + ${KALEM.length} kalem alani tam (fazlasi yok)`);

// Gonderim oncesi eksik-alan denetiminde kullanilan listeler de ayni olmali
// (fatura-kes-gib.service.ts bu listelerle kontrol ediyor; liste eksilirse denetim korlesir).
const listeler = [
  ['GIB_ZORUNLU_ALANLAR', payload.GIB_ZORUNLU_ALANLAR, BEKLENEN],
  ['GIB_KALEM_ALANLARI', payload.GIB_KALEM_ALANLARI, KALEM],
];
for (const [ad, gercek, beklenen] of listeler) {
  const dizi = Array.from(gercek || []);
  if (dizi.length === beklenen.length && dizi.every((a, i) => a === beklenen[i])) {
    console.log(`  ✓ ${ad} listesi sozlesmeyle ayni (${dizi.length} alan)`);
  } else {
    console.error(`  ✗ ${ad} listesi sozlesmeden sapti (${dizi.length} alan)`);
    hata++;
  }
}

// ---------- 2) KRITIK BICIM KURALLARI (davranis sinamasi) ----------
// Ilk denemede GIB bunlar yuzunden reddetti.
const bosBirimli = payload.gibFaturaPayload({ ...GIRDI, birim: null }, SIMDI);

const kurallar = [
  { ad: 'faturaUuid BOS gonderilir', ok: p.faturaUuid === '' },
  { ad: 'kdvOrani METIN', ok: typeof kalem.kdvOrani === 'string' && kalem.kdvOrani === '10' },
  { ad: 'sehir TEK BOSLUK', ok: p.sehir === ' ' },
  { ad: 'vergiCesidi TEK BOSLUK', ok: p.vergiCesidi === ' ' },
  { ad: 'fisSaati TEK BOSLUK', ok: p.fisSaati === ' ' },
  { ad: 'fisTipi TEK BOSLUK', ok: p.fisTipi === ' ' },
  { ad: 'yatirimTesvikTarihi BUGUN', ok: p.yatirimTesvikTarihi === payload.gibTarih(SIMDI) && p.yatirimTesvikTarihi === '20/08/2026' },
  { ad: 'birim varsayilani C62', ok: bosBirimli.malHizmetTable[0].birim === 'C62' },
  { ad: 'faturaTipi SATIS', ok: p.faturaTipi === 'SATIS' },
  { ad: 'hangiTip 5000/30000', ok: p.hangiTip === '5000/30000' },
];
for (const k of kurallar) {
  if (k.ok) console.log(`  ✓ ${k.ad}`);
  else { console.error(`  ✗ ${k.ad}`); hata++; }
}

// Tutar alanlari NOKTA ondalik, virgul YOK — GIB virgullu tutari reddeder.
const SAYI_BICIMI = /^-?\d+(\.\d+)?$/;
const TUTAR_ALANLARI = ['dovzTLkur','matrah','malhizmetToplamTutari','toplamIskonto','hesaplanankdv','vergilerToplami','vergilerDahilToplamTutar','odenecekTutar'];
const KALEM_TUTAR_ALANLARI = ['birimFiyat','fiyat','iskontoTutari','malHizmetTutari','kdvTutari','vergininKdvTutari','ozelMatrahTutari','hesaplananotvtevkifatakatkisi'];
let tutarSapma = 0;
for (const a of TUTAR_ALANLARI) {
  if (typeof p[a] !== 'string' || !SAYI_BICIMI.test(p[a])) { console.error(`  ✗ ${a} tutar bicimi bozuk: ${JSON.stringify(p[a])}`); tutarSapma++; }
}
for (const a of KALEM_TUTAR_ALANLARI) {
  if (typeof kalem[a] !== 'string' || !SAYI_BICIMI.test(kalem[a])) { console.error(`  ✗ kalem.${a} tutar bicimi bozuk: ${JSON.stringify(kalem[a])}`); tutarSapma++; }
}
if (tutarSapma) hata += tutarSapma;
else console.log('  ✓ tutarlar NOKTA ile (virgul kullanilmamis)');

// Nesnenin HICBIR yerinde virgul olmamali (girdide de virgul yok).
const virgullu = [];
(function tara(nesne, yol) {
  for (const [k, v] of Object.entries(nesne || {})) {
    const tamYol = yol ? `${yol}.${k}` : k;
    if (typeof v === 'string') { if (v.includes(',')) virgullu.push(`${tamYol}=${JSON.stringify(v)}`); }
    else if (Array.isArray(v)) v.forEach((e, i) => { if (e && typeof e === 'object') tara(e, `${tamYol}[${i}]`); });
    else if (v && typeof v === 'object') tara(v, tamYol);
  }
})(p, '');
if (virgullu.length) { console.error(`  ✗ gonderimde VIRGUL var — GIB reddeder: ${virgullu.join(', ')}`); hata++; }
else console.log('  ✓ gonderimin tamaminda virgul yok');

// ---------- 3) TUTAR BICIMLENDIRME (gercek gibTutar) ----------
const t = [[1, '1'], [0.1, '0.1'], [1.1, '1.1'], [1000, '1000'], [8000.5, '8000.5'], [1234.567, '1234.57']];
for (const [g, b] of t) {
  const s = payload.gibTutar(g);
  if (s === b) console.log(`  ✓ tutar ${g} -> "${s}"`);
  else { console.error(`  ✗ tutar ${g} -> "${s}" (beklenen "${b}")`); hata++; }
}
if (/,/.test(payload.gibTutar(1234.56))) { console.error('  ✗ tutarda VIRGUL var — GIB reddeder'); hata++; }

if (hata) process.exit(1);
console.log('[gib-earsiv-payload-regression] OK: GIB sozlesmesi (52 alan + bicim kurallari) kilitli');
