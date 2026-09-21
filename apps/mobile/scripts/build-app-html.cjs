#!/usr/bin/env node
/**
 * MOBİL UYGULAMA GÖVDESİ ÜRETİCİ (2026-09-13)
 *
 * Tek kaynak: apps/mobile/design/mobil-app-onizleme.html (tarayıcıda telefon çerçevesiyle açılan tasarım/önizleme).
 * Çıktı: apps/mobile/assets/app.html — WebView'in tam ekran gösterdiği dosya (react-native-webview, app/index.tsx).
 *
 * Dönüşüm (başka HİÇBİR şey değişmez; tasarım birebir kalsın — Muzaffer Bey kararı 2026-07-27):
 *   1) </head> öncesine tam ekran stili: telefon çerçevesi/başlık gizli, .phone = viewport, köşe yuvarlaması yok.
 *   2) <img src="../assets/moren-logo-ink.png"> → base64 gömülü (WebView asset yanında dosya çözemiyor). Beyaz tema (2026-09-21): koyu füme logo;
 *      önizleme sunucusunda design/ sayfası ../assets/ yoluyla aynı dosyayı gösterir.
 *   3) design/ek/*.html (ek paket blokları: MOREN_EK.render / navEkle) </body> öncesine ada göre sıralı gömülür.
 *   4) <style id="fontlar"> içindeki url(fonts/*.woff2) → design/fonts/*.woff2 base64 gömülü (WebView ağ yokken de aynı yazı tipi;
 *      asset yanındaki dosyayı çözemediği için gömme şart). Blok Google <link>'ten SONRA durur → yerel dosya her durumda kazanır.
 *
 * Kullanım: node scripts/build-app-html.cjs   (apps/mobile içinden)  → farkı yazar, dosyayı günceller.
 */
const fs = require('fs');
const path = require('path');

const KOK = path.resolve(__dirname, '..');
const KAYNAK = path.join(KOK, 'design', 'mobil-app-onizleme.html');
const LOGO = path.join(KOK, 'assets', 'moren-logo-ink.png'); // beyaz tema: koyu füme logo (apps/web/public/brand/moren-logo-ink.png kopyası)
const LOGO_SRC = 'src="../assets/moren-logo-ink.png"'; // kaynaktaki <img src> eşleşmesi
const CIKTI = path.join(KOK, 'assets', 'app.html');
const EK_KLASOR = path.join(KOK, 'design', 'ek'); // paket blokları (<script>/<style>), ada göre sıralı gömülür
const FONT_KLASOR = path.join(KOK, 'design', 'fonts'); // yerel woff2 dosyaları (<style id="fontlar"> url(fonts/…) → base64)

const TAM_EKRAN_STIL =
  '<style>html,body{padding:0!important;margin:0!important;background:#f6f8fb!important;min-height:100vh}' +
  '.board-head,.cap{display:none!important}.stage{gap:0!important;padding:0!important}' +
  'body{align-items:stretch!important;padding:0!important}' +
  '.phone{width:100vw!important;height:100vh!important;max-width:100vw!important;border-radius:0!important;padding:0!important;box-shadow:none!important;background:#f6f8fb!important}' +
  '.screen{border-radius:0!important}@media(max-width:440px){.phone{transform:none!important}}</style></head>';

function uret() {
  if (!fs.existsSync(KAYNAK)) throw new Error('Kaynak yok: ' + KAYNAK);
  let html = fs.readFileSync(KAYNAK, 'utf8');
  if (html.split('</head>').length !== 2) throw new Error('Kaynakta tam bir </head> bekleniyor');
  html = html.replace('</head>', TAM_EKRAN_STIL);
  const logoB64 = fs.readFileSync(LOGO).toString('base64');
  const logoSayisi = html.split(LOGO_SRC).length - 1;
  if (!logoSayisi) throw new Error('Kaynakta moren-logo-ink.png görseli yok (' + LOGO_SRC + ')');
  html = html.split(LOGO_SRC).join(`src="data:image/png;base64,${logoB64}"`);
  const ekler = fs.existsSync(EK_KLASOR) ? fs.readdirSync(EK_KLASOR).filter((f) => f.endsWith('.html')).sort() : [];
  if (ekler.length) {
    if (html.split('</body>').length !== 2) throw new Error('Kaynakta tam bir </body> bekleniyor');
    const blok = ekler.map((f) => `\n<!-- EK PAKET: ${f} -->\n` + fs.readFileSync(path.join(EK_KLASOR, f), 'utf8').trim() + '\n').join('');
    html = html.replace('</body>', blok + '</body>');
  }
  // 4) Yazı tipleri: <style id="fontlar"> bloğundaki url(fonts/X.woff2) → base64 (dosya yoksa üretim DURUR; tasarım bozulmasın)
  const fontlar = [];
  if (!/<style id="fontlar">[\s\S]*?<\/style>/.test(html)) throw new Error('Kaynakta <style id="fontlar"> bloğu yok (yerel yazı tipleri)');
  html = html.replace(/<style id="fontlar">[\s\S]*?<\/style>/, (blok) =>
    blok.replace(/url\(fonts\/([A-Za-z0-9_.-]+\.woff2)\)/g, (_, ad) => {
      const dosya = path.join(FONT_KLASOR, ad);
      if (!fs.existsSync(dosya)) throw new Error('Yazı tipi dosyası yok: ' + dosya);
      const veri = fs.readFileSync(dosya);
      fontlar.push({ ad, kb: Math.round(veri.length / 1024) });
      return 'url(data:font/woff2;base64,' + veri.toString('base64') + ')';
    }),
  );
  return { html, logoSayisi, ekler, fontlar };
}

function main() {
  const { html, logoSayisi, ekler, fontlar } = uret();
  const eski = fs.existsSync(CIKTI) ? fs.readFileSync(CIKTI, 'utf8') : '';
  const degisti = eski !== html;
  if (degisti) fs.writeFileSync(CIKTI, html);
  const satir = (s) => s.split(/\r?\n/).length;
  console.log(`[app.html] kaynak ${satir(fs.readFileSync(KAYNAK, 'utf8'))} satır → çıktı ${satir(html)} satır, logo ${logoSayisi} yerde gömüldü, ek paket ${ekler.length} (${ekler.join(', ') || '-'}), yazı tipi ${fontlar.length} dosya gömüldü (${fontlar.reduce((a, f) => a + f.kb, 0)} KB ham), çıktı ${Math.round(Buffer.byteLength(html) / 1024)} KB, ${degisti ? 'GÜNCELLENDİ' : 'değişiklik yok'}`);
}

if (require.main === module) main();
module.exports = { uret, TAM_EKRAN_STIL };
