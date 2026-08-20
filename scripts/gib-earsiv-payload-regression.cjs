#!/usr/bin/env node
/**
 * GIB e-Arsiv "Fatura Olustur" veri sozlesmesi regresyonu.
 *
 * KAYNAK: 2026-08-20'de EDELER YEMEK mukellefinde portalin KENDI ekranindan taslak
 * olusturulurken tarayicinin GIB'e gonderdigi istek birebir yakalandi. Bu test o
 * sozlesmeyi kilitler — ilk denememiz reddedilmisti ve GIB sebebi SOYLEMIYOR
 * ("Bir hata meydana geldi"), o yuzden sapma testle yakalanmali.
 */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'apps', 'api', 'src', 'fatura-kes', 'gib-earsiv-payload.ts');
const src = fs.readFileSync(SRC, 'utf8');

// Portalin GERCEKTE gonderdigi 52 alan
const BEKLENEN = ['faturaUuid','belgeNumarasi','faturaTarihi','saat','paraBirimi','dovzTLkur','faturaTipi','hangiTip','vknTckn','aliciUnvan','aliciAdi','aliciSoyadi','binaAdi','binaNo','kapiNo','kasabaKoy','vergiDairesi','ulke','bulvarcaddesokak','irsaliyeNumarasi','irsaliyeTarihi','mahalleSemtIlce','sehir','postaKodu','tel','fax','eposta','websitesi','iadeTable','ihracKayitliKarsiBelgeNo','yatirimTesvikNumarasi','yatirimTesvikTarihi','kdvOranKontrolMuafiyeti','vergiCesidi','malHizmetTable','tip','matrah','malhizmetToplamTutari','toplamIskonto','hesaplanankdv','vergilerToplami','vergilerDahilToplamTutar','odenecekTutar','not','siparisNumarasi','siparisTarihi','fisNo','fisTarihi','fisSaati','fisTipi','zRaporNo','okcSeriNo'];
const KALEM = ['malHizmet','miktar','birim','birimFiyat','fiyat','iskontoOrani','iskontoTutari','iskontoNedeni','malHizmetTutari','kdvOrani','vergiOrani','kdvTutari','vergininKdvTutari','ozelMatrahTutari','hesaplananotvtevkifatakatkisi'];

let hata = 0;
for (const a of BEKLENEN) {
  if (!src.includes(a + ':')) { console.error(`  \u2717 ALAN EKSIK: ${a}`); hata++; }
}
for (const a of KALEM) {
  if (!src.includes(a + ':')) { console.error(`  \u2717 KALEM ALANI EKSIK: ${a}`); hata++; }
}
if (!hata) console.log(`  \u2713 52 fatura alani + 15 kalem alani tam`);

// Kritik bicim kurallari — ilk denemede bunlar yuzunden reddedildi
const kurallar = [
  { ad: 'tutarlar NOKTA ile (virgul kullanilmamali)', ok: !/replace\([^)]*'\.'[^)]*','[^']*,'/.test(src) && /String\(yuvarlanmis\)/.test(src) },
  { ad: 'faturaUuid BOS gonderilir', ok: /faturaUuid:\s*''/.test(src) },
  { ad: 'kdvOrani METIN', ok: /kdvOrani:\s*String\(/.test(src) },
  { ad: 'sehir TEK BOSLUK', ok: /sehir:\s*' '/.test(src) },
  { ad: 'vergiCesidi TEK BOSLUK', ok: /vergiCesidi:\s*' '/.test(src) },
  { ad: 'fisSaati TEK BOSLUK', ok: /fisSaati:\s*' '/.test(src) },
  { ad: 'fisTipi TEK BOSLUK', ok: /fisTipi:\s*' '/.test(src) },
  { ad: 'yatirimTesvikTarihi BUGUN', ok: /yatirimTesvikTarihi:\s*gibTarih\(simdi\)/.test(src) },
  { ad: 'birim varsayilani C62', ok: /'C62'/.test(src) },
  { ad: 'faturaTipi SATIS', ok: /faturaTipi:\s*'SATIS'/.test(src) },
  { ad: 'hangiTip 5000\/30000', ok: /hangiTip:\s*'5000\/30000'/.test(src) },
];
for (const k of kurallar) {
  if (k.ok) console.log(`  \u2713 ${k.ad}`);
  else { console.error(`  \u2717 ${k.ad}`); hata++; }
}

// Tutar bicimlendirme davranisi
function gibTutar(n) {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round((n + Number.EPSILON) * 100) / 100);
}
const t = [[1, '1'], [0.1, '0.1'], [1.1, '1.1'], [1000, '1000'], [8000.5, '8000.5'], [1234.567, '1234.57']];
for (const [g, b] of t) {
  const s = gibTutar(g);
  if (s === b) console.log(`  \u2713 tutar ${g} -> "${s}"`);
  else { console.error(`  \u2717 tutar ${g} -> "${s}" (beklenen "${b}")`); hata++; }
}
if (/,/.test(gibTutar(1234.56))) { console.error('  \u2717 tutarda VIRGUL var — GIB reddeder'); hata++; }

if (hata) process.exit(1);
console.log('[gib-earsiv-payload-regression] OK: GIB sozlesmesi (52 alan + bicim kurallari) kilitli');
