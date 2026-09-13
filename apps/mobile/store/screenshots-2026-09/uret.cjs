#!/usr/bin/env node
/**
 * MAĞAZA EKRAN GÖRÜNTÜSÜ ÜRETİCİ (2026-09-13)
 *
 * Önizleme sunucusu (node scripts/onizleme-sunucu.cjs → http://localhost:4620) çalışırken, kurulu Chrome'u
 * başsız (headless) açar, DevTools protokolüyle telefon boyutu + 3× ölçek verir ve _uret.html üzerinden
 * her ekranı PNG olarak bu klasöre yazar. Canlı veri YOK (RN köprüsü yok) → örnek görünüm; gerçek veriyle
 * görüntü istenirse telefondan alınır.
 *
 * Kullanım (apps/mobile içinden):  node store/screenshots-2026-09/uret.cjs [--sadece iphone-6.7]
 * Çıktı: store/screenshots-2026-09/<cihaz>/<nn>-<ekran>.png
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const KOK = __dirname;
const SUNUCU = process.env.MOBIL_ONIZLEME || 'http://localhost:4620';
const PORT = 9333;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

// Mağaza boyutları (mantıksal px × 3 = istenen piksel)
const CIHAZLAR = {
  'iphone-6.9': { w: 440, h: 956, not: '1320×2868 (iPhone 16 Pro Max)' },
  'iphone-6.7': { w: 430, h: 932, not: '1290×2796 (iPhone 14/15 Pro Max)' },
  'iphone-6.5': { w: 428, h: 926, not: '1284×2778 (iPhone 11 Pro Max sınıfı)' },
  android: { w: 360, h: 800, not: '1080×2400 (Android telefon)' },
};
// Sıra: seçim → giriş → özet → modüller → belge tara → Moren AI → KDV panosu → mükellef özeti
const EKRANLAR = [
  ['01-secim', 'secim', 'adv', 1200],
  ['02-giris', 'giris', 'adv', 1500],
  ['03-ozet', 'ozet', 'adv', 2500],
  ['04-moduller', 'moduller', 'adv', 2500],
  ['05-belge-tara', 'belge-tara', 'adv', 4200],
  ['06-moren-ai', 'ai', 'adv', 2500],
  ['07-kdv-panosu', 'kdv', 'adv', 2500],
  ['08-mukellef-ozet', 'ozet', 'tax', 2500],
];

function bekle(ms) { return new Promise((r) => setTimeout(r, ms)); }
function getJson(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.bekleyen = new Map(); this.olay = new Map();
    ws.onmessage = (m) => { const j = JSON.parse(String(m.data)); if (j.id && this.bekleyen.has(j.id)) { const { res, rej } = this.bekleyen.get(j.id); this.bekleyen.delete(j.id); j.error ? rej(new Error(j.error.message)) : res(j.result); }
      else if (j.method && this.olay.has(j.method)) { const fns = this.olay.get(j.method); this.olay.delete(j.method); fns.forEach((f) => f(j.params)); } }; }
  gonder(method, params) { return new Promise((res, rej) => { const id = ++this.id; this.bekleyen.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
  olayBekle(method, ms) { return new Promise((res) => { const t = setTimeout(() => res(null), ms); const l = this.olay.get(method) || []; l.push((p) => { clearTimeout(t); res(p); }); this.olay.set(method, l); }); }
}

async function main() {
  if (!CHROME) throw new Error('Chrome/Edge bulunamadı');
  const sadece = process.argv.indexOf('--sadece') >= 0 ? process.argv[process.argv.indexOf('--sadece') + 1] : null;
  try { await getJson(SUNUCU + '/assets/app.html').catch(() => null); } catch (_) { /* html json değil, sadece erişim denemesi */ }
  const profil = path.join(require('os').tmpdir(), 'moren-ss-chrome');
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profil, 'about:blank'], { stdio: 'ignore' });
  try {
    let hedefler = null;
    for (let i = 0; i < 40 && !hedefler; i++) { await bekle(250); hedefler = await getJson('http://127.0.0.1:' + PORT + '/json').catch(() => null); }
    if (!hedefler) throw new Error('Chrome DevTools kapısına ulaşılamadı');
    const sayfa = hedefler.find((t) => t.type === 'page');
    const ws = new WebSocket(sayfa.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = new Cdp(ws);
    await cdp.gonder('Page.enable');
    let toplam = 0;
    for (const [cihaz, c] of Object.entries(CIHAZLAR)) {
      if (sadece && sadece !== cihaz) continue;
      const klasor = path.join(KOK, cihaz);
      fs.mkdirSync(klasor, { recursive: true });
      await cdp.gonder('Emulation.setDeviceMetricsOverride', { width: c.w, height: c.h, deviceScaleFactor: 3, mobile: true });
      for (const [ad, ekran, persona, beklemeMs] of EKRANLAR) {
        const url = SUNUCU + '/store/screenshots-2026-09/_uret.html?ekran=' + encodeURIComponent(ekran) + '&persona=' + persona;
        const yuklendi = cdp.olayBekle('Page.loadEventFired', 15000);
        await cdp.gonder('Page.navigate', { url });
        await yuklendi;
        await bekle(beklemeMs); // iframe içi giriş + görünüm animasyonları
        const { data } = await cdp.gonder('Page.captureScreenshot', { format: 'png' });
        const dosya = path.join(klasor, ad + '.png');
        fs.writeFileSync(dosya, Buffer.from(data, 'base64'));
        toplam++;
        console.log(`${cihaz}/${ad}.png  (${c.w * 3}×${c.h * 3})`);
      }
    }
    ws.close();
    console.log(`Toplam ${toplam} görüntü → ${KOK}`);
  } finally {
    chrome.kill();
  }
}

main().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
