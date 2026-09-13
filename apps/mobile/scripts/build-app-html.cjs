#!/usr/bin/env node
/**
 * MOBİL UYGULAMA GÖVDESİ ÜRETİCİ (2026-09-13)
 *
 * Tek kaynak: apps/mobile/design/mobil-app-onizleme.html (tarayıcıda telefon çerçevesiyle açılan tasarım/önizleme).
 * Çıktı: apps/mobile/assets/app.html — WebView'in tam ekran gösterdiği dosya (react-native-webview, app/index.tsx).
 *
 * Dönüşüm (başka HİÇBİR şey değişmez; tasarım birebir kalsın — Muzaffer Bey kararı 2026-07-27):
 *   1) </head> öncesine tam ekran stili: telefon çerçevesi/başlık gizli, .phone = viewport, köşe yuvarlaması yok.
 *   2) <img src="moren-logo-gold.png"> → base64 gömülü (WebView asset yanında dosya çözemiyor).
 *
 * Kullanım: node scripts/build-app-html.cjs   (apps/mobile içinden)  → farkı yazar, dosyayı günceller.
 */
const fs = require('fs');
const path = require('path');

const KOK = path.resolve(__dirname, '..');
const KAYNAK = path.join(KOK, 'design', 'mobil-app-onizleme.html');
const LOGO = path.join(KOK, 'assets', 'moren-logo-gold.png');
const CIKTI = path.join(KOK, 'assets', 'app.html');

const TAM_EKRAN_STIL =
  '<style>html,body{padding:0!important;margin:0!important;background:#080706!important;min-height:100vh}' +
  '.board-head,.cap{display:none!important}.stage{gap:0!important;padding:0!important}' +
  'body{align-items:stretch!important;padding:0!important}' +
  '.phone{width:100vw!important;height:100vh!important;max-width:100vw!important;border-radius:0!important;padding:0!important;box-shadow:none!important;background:#080706!important}' +
  '.screen{border-radius:0!important}@media(max-width:440px){.phone{transform:none!important}}</style></head>';

function uret() {
  if (!fs.existsSync(KAYNAK)) throw new Error('Kaynak yok: ' + KAYNAK);
  let html = fs.readFileSync(KAYNAK, 'utf8');
  if (html.split('</head>').length !== 2) throw new Error('Kaynakta tam bir </head> bekleniyor');
  html = html.replace('</head>', TAM_EKRAN_STIL);
  const logoB64 = fs.readFileSync(LOGO).toString('base64');
  const logoSayisi = html.split('src="moren-logo-gold.png"').length - 1;
  if (!logoSayisi) throw new Error('Kaynakta moren-logo-gold.png görseli yok');
  html = html.split('src="moren-logo-gold.png"').join(`src="data:image/png;base64,${logoB64}"`);
  return { html, logoSayisi };
}

function main() {
  const { html, logoSayisi } = uret();
  const eski = fs.existsSync(CIKTI) ? fs.readFileSync(CIKTI, 'utf8') : '';
  const degisti = eski !== html;
  if (degisti) fs.writeFileSync(CIKTI, html);
  const satir = (s) => s.split(/\r?\n/).length;
  console.log(`[app.html] kaynak ${satir(fs.readFileSync(KAYNAK, 'utf8'))} satır → çıktı ${satir(html)} satır, logo ${logoSayisi} yerde gömüldü, ${degisti ? 'GÜNCELLENDİ' : 'değişiklik yok'}`);
}

if (require.main === module) main();
module.exports = { uret, TAM_EKRAN_STIL };
