#!/usr/bin/env node
/**
 * FATURA KES — tutar cozumleme + birim kodu + birim fiyat regresyonu.
 *
 * NE SINANIR
 *   1) TR bicimli tutar metninin sayiya cevrilmesi. Ayni kural HEM sunucuda HEM
 *      arayuzde gecerli olmali: biri duzelip digeri kalirsa ekranda gorunen toplam
 *      ile kaydedilen tutar birbirini tutmaz.
 *   2) GIB birim ADI degil KODU bekler ("KG" degil "KGM"); taninmayan birim null.
 *   3) miktar x birimFiyat carpimi matrahi TUTMALI.
 *
 * HANGI GERCEK FONKSIYONLAR CAGRILIR — betigin kendi kopyasi YOK
 *   (Onceki hal: bu betigin icinde "function sayi(v)" diye bir KOPYA vardi ve testler
 *    onu cagiriyordu. Uygulamadaki fonksiyon bozulsa test yine geciyordu. 2026-09-25
 *    denetimi bunu "gecmesi guvence sayilmamali" diye yazdi. Kopya kaldirildi.)
 *
 *   - Sunucu tutar cozumleme:
 *       apps/api/src/fatura-kes/fatura-kes.service.ts  ->  FaturaKesService.sayi()
 *       TypeScript'te "private" isaretli, ama bu yalniz DERLEME zamani kisitidir;
 *       calisma zamaninda siradan bir prototip metodudur. Kaynak dosyaya export
 *       EKLEMEDEN FaturaKesService.prototype.sayi uzerinden cagiriyoruz. Yapicisi
 *       Prisma istiyor; sayi() hicbir bagimlilik kullanmadigi icin gercek nesne
 *       kurmak yerine Object.create(prototip) ile bos bir ornek yeter.
 *
 *   - Birim kodu ve birim fiyat:
 *       apps/api/src/fatura-kes/gib-earsiv-payload.ts  ->  birimKodu(), gibBirimFiyat()
 *       Ikisi de export edilmis; dogrudan import ediliyor.
 *
 *   - Arayuz tutar cozumleme:
 *       apps/web/src/app/fatura-merkezi/page.tsx  ->  "const mNum = (() => { ... })()"
 *       Bu bir IIFE ve React bileseninin GOVDESININ icinde yasiyor: disa aktarilmiyor,
 *       modul olarak yuklenemez, prototip gibi bir arka kapisi da yok. Kaynak dosyayi
 *       degistirmek yasak oldugu icin govdesi kaynak metninden cikarilip TypeScript
 *       derleyicisiyle derlenip GERCEK fonksiyon olarak kosturuluyor. Yani sinama
 *       "metinde su regex var mi" degil, "ayni girdiye ayni sonucu veriyor mu".
 *       KAYNAKTA YAPILMASI GEREKEN: mNum govdesi page.tsx'ten paylasilan bir dosyaya
 *       tasinip export edilirse bu cikarim kalkar, dogrudan import edilir.
 *
 * METIN TABANLI KALAN KONTROL: YOK.
 *   mNum cikarimi kaynak metnini okur, ama sonucu DAVRANIS sinamasidir. Cikarim
 *   basarisiz olursa test sessizce gecmez, KIRMIZI doner.
 *
 * DENETIM BULGUSU (2026-08-20, KRITIK): eski kural "en sagdaki ayrac ondaliktir"
 * diyordu ve "8.000" degerini 8 TL okuyordu. Kutunun kendi ipucu metni de "8.000,00"
 * oldugu icin kullanici tam bu yazima yonlendiriliyordu -> fatura 1000 KAT KUCUK
 * kesilirdi. Ayni hatali kural arayuzde (page.tsx mNum) de tekrarlaniyordu.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = path.join(ROOT, 'apps', 'api', 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });

/** Verilen adaylardan ilk yuklenebileni dondurur; hicbiri olmazsa test durur. */
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

const ts = ilkYuklenen([
  'typescript',
  path.join(ROOT, 'node_modules', 'typescript'),
  path.join(ROOT, 'apps', 'api', 'node_modules', 'typescript'),
  path.join(ROOT, 'apps', 'web', 'node_modules', 'typescript'),
], 'typescript');

let hata = 0;

// ---------- 1) TUTAR KURALI ----------
// Kural: virgul varsa ondalik virguldur. Yalniz nokta ise: TEK nokta + 1-2 haneli kesir
//        -> ondalik; aksi (cok nokta ya da 3 haneli grup) -> TR BINLIK ayraci.
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

/** Ayni senaryo tablosunu verilen GERCEK fonksiyona uygular. */
function tutarKuraliniSina(ad, fn) {
  for (const [girdi, beklenen, not] of TUTAR) {
    let sonuc;
    try {
      sonuc = fn(girdi);
    } catch (e) {
      console.error(`  ✗ ${ad} "${girdi}" cagrisi patladi: ${e.message}`);
      hata++;
      continue;
    }
    if (Number.isFinite(sonuc) && Math.abs(sonuc - beklenen) < 0.005) {
      console.log(`  ✓ ${ad} "${girdi}" -> ${sonuc}  (${not})`);
    } else {
      console.error(`  ✗ ${ad} "${girdi}" -> ${sonuc}, beklenen ${beklenen}  (${not})`);
      hata++;
    }
  }
}

// 1a) SUNUCU — FaturaKesService.sayi() (gercek fonksiyon, prototip uzerinden)
const servisModulu = require(path.join(ROOT, 'apps/api/src/fatura-kes/fatura-kes.service.ts'));
const FaturaKesService = servisModulu.FaturaKesService;
if (typeof FaturaKesService !== 'function' || typeof FaturaKesService.prototype.sayi !== 'function') {
  console.error('  ✗ FaturaKesService.prototype.sayi bulunamadi.');
  console.error('      Sebebi: metot ok-fonksiyonu alanina donusturulmus ya da adi degismis olabilir.');
  console.error('      Sunucu tutar kurali SINANAMADI — testi gecmis sayma.');
  process.exit(1);
}
// sayi() hicbir bagimlilik kullanmiyor; bos bir prototip ornegi yeterli.
const servisOrnegi = Object.create(FaturaKesService.prototype);
tutarKuraliniSina('sunucu sayi()', (v) => FaturaKesService.prototype.sayi.call(servisOrnegi, v));

// 1b) ARAYUZ — page.tsx icindeki mNum IIFE'si kaynaktan cikarilip GERCEK fonksiyon olarak kosturulur
const ARAYUZ_DOSYA = 'apps/web/src/app/fatura-merkezi/page.tsx';
const MNUM_IMZA = 'const mNum = (() => {';

function arayuzMNumCikar() {
  const src = fs.readFileSync(path.join(ROOT, ARAYUZ_DOSYA), 'utf8');
  const bas = src.indexOf(MNUM_IMZA);
  if (bas < 0) throw new Error(`${ARAYUZ_DOSYA} icinde "${MNUM_IMZA}" bulunamadi`);

  // Dengeli suslu parantez taramasiyla IIFE govdesini al.
  const acilis = src.indexOf('{', bas);
  let derinlik = 0;
  let kapanis = -1;
  for (let i = acilis; i < src.length; i++) {
    if (src[i] === '{') derinlik++;
    else if (src[i] === '}') { derinlik--; if (derinlik === 0) { kapanis = i; break; } }
  }
  if (kapanis < 0) throw new Error('mNum govdesinin kapanis parantezi bulunamadi');
  if (!src.startsWith('})();', kapanis)) {
    throw new Error('mNum sonrasi "})();" gelmiyor — cikarim yanlis yeri kesmis olabilir');
  }

  const govde = src.slice(acilis + 1, kapanis);
  // Dogru yeri kestigimizin teyidi: kuralin belirleyici parcalari govdede olmali.
  for (const im of ['sonVirgul', 'sonNokta', 'tekNokta']) {
    if (!govde.includes(im)) throw new Error(`cikarilan govdede "${im}" yok — yanlis blok alinmis`);
  }

  // Govde TypeScript (ornek: "let d: string;") — derleyip calistirilabilir hale getir.
  const kod = `module.exports = function mNum(matrah) {${govde}};`;
  const js = ts.transpileModule(kod, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const kutu = { exports: {} };
  new Function('module', 'exports', js)(kutu, kutu.exports);
  if (typeof kutu.exports !== 'function') throw new Error('mNum fonksiyona cevrilemedi');
  return kutu.exports;
}

try {
  const mNum = arayuzMNumCikar();
  console.log(`  ✓ arayuz mNum ${ARAYUZ_DOSYA} kaynagindan cikarildi ve calistirildi`);
  tutarKuraliniSina('arayuz mNum', mNum);
} catch (e) {
  console.error(`  ✗ arayuz mNum cikarilamadi: ${e.message}`);
  console.error('      Arayuz tutar kurali SINANAMADI. Kalici cozum: mNum govdesini page.tsx');
  console.error('      icinden paylasilan bir dosyaya tasi ve export et; test dogrudan import eder.');
  hata++;
}

// ---------- 2) BIRIM KODU + BIRIM FIYAT ----------
const payload = require(path.join(ROOT, 'apps/api/src/fatura-kes/gib-earsiv-payload.ts'));

const BIRIM = [['ADET', 'C62'], ['adet', 'C62'], ['KG', 'KGM'], ['Kilogram', 'KGM'], ['LİTRE', 'LTR'],
  ['M2', 'MTK'], ['ÇİFT', 'PR'], ['SAAT', 'HUR'], ['', 'C62'], ['ZIRVA', null]];
for (const [g, b] of BIRIM) {
  const s = payload.birimKodu(g);
  if (s === b) console.log(`  ✓ birim "${g}" -> ${s === null ? 'taninmadi (dogru)' : s}`);
  else { console.error(`  ✗ birim "${g}" -> ${s}, beklenen ${b}`); hata++; }
}

// miktar x birimFiyat == matrah OLMALI
const FIYAT = [[1000, 1], [100, 3], [8000, 7], [0.2, 1], [1234.56, 2], [1, 6]];
for (const [matrah, miktar] of FIYAT) {
  const bf = Number(payload.gibBirimFiyat(matrah, miktar));
  const carpim = Math.round(bf * miktar * 100) / 100;
  if (Math.abs(carpim - matrah) < 0.005) console.log(`  ✓ matrah ${matrah} / ${miktar} adet -> ${bf} (carpim ${carpim})`);
  else { console.error(`  ✗ matrah ${matrah} / ${miktar} adet -> ${bf}, carpim ${carpim} matrahi TUTMUYOR`); hata++; }
}

// Dogrulanmis yol (miktar=1) BIREBIR ayni kalmali
if (payload.gibBirimFiyat(1000, 1) !== '1000') { console.error('  ✗ miktar=1 yolu degisti (dogrulanmis gonderim bozulur)'); hata++; }
else console.log('  ✓ miktar=1 yolu degismedi (canli dogrulanmis gonderim korunuyor)');

if (hata) process.exit(1);
console.log('[fatura-kes-tutar-birim-regression] OK: tutar/birim/birim-fiyat kurallari kilitli');
