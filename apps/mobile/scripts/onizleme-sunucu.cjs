#!/usr/bin/env node
/**
 * TARAYICI ÖNİZLEME SUNUCUSU (2026-09-13) — assets/app.html'i (WebView'in gördüğü gövde) ve design/ dosyalarını
 * http://localhost:4620/ altında sunar. Telefon boyutunda (390×844) açınca uygulama görünümü birebir.
 * Canlı veri YOK (RN köprüsü yok) — yalnız tasarım/etkileşim/hata denetimi. `node scripts/onizleme-sunucu.cjs`
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const KOK = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4620);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

http
  .createServer((req, res) => {
    let yol = decodeURIComponent((req.url || '/').split('?')[0]);
    if (yol === '/' || yol === '') yol = '/assets/app.html';
    const f = path.join(KOK, yol);
    if (!f.startsWith(KOK) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('yok: ' + yol); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  })
  .listen(PORT, () => console.log(`mobil önizleme: http://localhost:${PORT}/  (assets/app.html · design/mobil-app-onizleme.html)`));
