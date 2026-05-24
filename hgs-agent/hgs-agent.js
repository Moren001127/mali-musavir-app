/**
 * HGS İhlal Sorgu Agent
 * =====================
 *
 * Bu script Node.js + Playwright ile KGM İhlal Takip sitesine
 * tam otomatik sorgu yapar. Portal'daki "Toplu Sorgula" butonu (veya
 * Pazartesi cron'u) AgentCommand yazar, bu script o komutu claim
 * edip çalıştırır.
 *
 * Captcha çözümü: 2captcha API ile otomatik (image-to-text).
 *
 * Kurulum (bir kere):
 *   cd hgs-agent
 *   npm install
 *   npx playwright install chromium
 *
 * Çalıştırma:
 *   node hgs-agent.js
 *
 * Ortam değişkenleri (.env):
 *   PORTAL_URL          = https://mali-musavir-app-production.up.railway.app/api/v1
 *   AGENT_TOKEN         = <portaldan alınan token>
 *   TWOCAPTCHA_API_KEY  = <2captcha.com hesabından>
 *   HEADLESS            = true | false   (default: true)
 */

const { chromium } = require('playwright-core');
const { Solver } = require('2captcha');
const fs = require('fs');
const path = require('path');

// === ENV ===
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envRaw = fs.readFileSync(envPath, 'utf8');
  for (const line of envRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [k, ...rest] = trimmed.split('=');
    if (k && rest.length) {
      process.env[k.trim()] = rest.join('=').trim();
    }
  }
}

const PORTAL = process.env.PORTAL_URL || 'https://mali-musavir-app-production.up.railway.app/api/v1';
const TOKEN = process.env.AGENT_TOKEN;
const TWOCAPTCHA_KEY = process.env.TWOCAPTCHA_API_KEY;
const HEADLESS = (process.env.HEADLESS || 'true').toLowerCase() !== 'false';
const KGM_URL = 'https://webihlaltakip.kgm.gov.tr/WebIhlalSorgulama/Sayfalar/Sorgulama.aspx';

if (!TOKEN) {
  console.error('❌ AGENT_TOKEN eksik. hgs-agent/.env dosyasına ekle');
  process.exit(1);
}
if (!TWOCAPTCHA_KEY) {
  console.error('❌ TWOCAPTCHA_API_KEY eksik. hgs-agent/.env dosyasına ekle');
  process.exit(1);
}

const solver = new Solver(TWOCAPTCHA_KEY);

const log = (msg, ...args) => {
  const ts = new Date().toLocaleTimeString('tr-TR', { hour12: false });
  console.log(`[${ts}] ${msg}`, ...args);
};

// === API helpers ===
async function api(endpoint, opts = {}) {
  const url = PORTAL + endpoint;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Token': TOKEN,
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`API ${endpoint} ${res.status}: ${text.slice(0, 200)}`);
  }
  return json;
}

async function ping(meta = {}) {
  try {
    await api('/agent/status/ping', {
      method: 'POST',
      body: { agent: 'hgs', running: true, meta },
    });
  } catch (err) {
    log('⚠ ping başarısız:', err.message);
  }
}

async function claimCommands() {
  try {
    return await api('/agent/commands/claim', {
      method: 'POST',
      body: { agent: 'hgs' },
    });
  } catch (err) {
    log('⚠ claim başarısız:', err.message);
    return [];
  }
}

async function updateCommand(id, status, result = {}) {
  try {
    await api(`/agent/commands/${id}`, {
      method: 'PUT',
      body: { status, result },
    });
  } catch (err) {
    log('⚠ command update başarısız:', err.message);
  }
}

async function kaydetSorguSonucu(aracId, data) {
  // /galeri/agent/* endpoint'i X-Agent-Token ile auth ediyor (JWT zorunlu değil).
  try {
    return await api(`/galeri/agent/araclar/${aracId}/hgs-sorgu-sonuc`, {
      method: 'POST',
      body: data,
    });
  } catch (err) {
    log(`⚠ sonuç kaydedilemedi (${aracId}): ${err.message} — command result'a yedekleniyor`);
    return null;
  }
}

// === Debug yardımcısı ===
const DEBUG_DIR = path.join(__dirname, 'debug');
function ensureDebugDir() {
  if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

async function debugDump(page, plaka, asama) {
  try {
    ensureDebugDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(DEBUG_DIR, `${plaka}_${asama}_${ts}`);
    await page.screenshot({ path: `${base}_page.png`, fullPage: true });
    const html = await page.content();
    fs.writeFileSync(`${base}.html`, html, 'utf8');
    log(`  🐞 Debug dump: ${path.basename(base)}*`);
  } catch (err) {
    log(`  ⚠ Debug dump başarısız: ${err.message}`);
  }
}

// === 2captcha çözücü ===
async function captchayiCoz(page) {
  const captchaSelectors = [
    'img[id*="Captcha" i]',
    'img[src*="Captcha" i]',
    'img[id*="GuvenlikKodu" i]',
    'img[alt*="güvenlik" i]',
    '#ctl00_ContentPlaceHolder1_imgCaptcha',
    '#imgCaptcha',
  ];

  let captchaEl = null;
  let matchedSelector = null;
  for (const s of captchaSelectors) {
    const el = await page.$(s);
    if (el) { captchaEl = el; matchedSelector = s; break; }
  }
  if (!captchaEl) {
    log('  ⓘ Captcha img bulunamadı — sayfa captcha sormamış olabilir');
    return null;
  }
  log(`  ⓘ Captcha bulundu: ${matchedSelector}`);

  const buffer = await captchaEl.screenshot({ type: 'png' });
  const base64 = buffer.toString('base64');

  // Debug: captcha img'ini diske kaydet
  try {
    ensureDebugDir();
    const ts = Date.now();
    fs.writeFileSync(path.join(DEBUG_DIR, `captcha_${ts}.png`), buffer);
  } catch {}

  log('  🔐 Captcha 2captcha\'ya gönderiliyor...');
  const t0 = Date.now();
  let cozum;
  try {
    cozum = await solver.imageCaptcha(base64, {
      numeric: 0,
      min_len: 4,
      max_len: 10,
      language: 0,
    });
  } catch (err) {
    throw new Error(`2captcha hatası: ${err.message || err}`);
  }
  const ms = Date.now() - t0;
  log(`  ✓ Captcha çözümü: "${cozum.data}" (${ms}ms, id=${cozum.id})`);

  return { cozum: cozum.data, captchaId: cozum.id };
}

async function captchaYanlisRapor(captchaId) {
  if (!captchaId) return;
  try {
    await solver.reportBad(captchaId);
    log(`  ⚠ Captcha (${captchaId}) yanlış olarak raporlandı`);
  } catch {}
}

// === KGM sayfasında plaka sorgusu ===
async function sorgulaPlakaTekSefer(page, plaka) {
  const plakaTemiz = (plaka || '').replace(/\s/g, '').toUpperCase();

  await page.goto(KGM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const plakaSelectors = [
    'input[id*="Plaka"]',
    'input[name*="Plaka"]',
    'input[placeholder*="Plaka"]',
    'input[placeholder*="plaka"]',
    '#txtPlaka',
    '#ctl00_ContentPlaceHolder1_txtPlaka',
  ];
  let plakaInput = null;
  for (const s of plakaSelectors) {
    const el = await page.$(s);
    if (el) { plakaInput = el; break; }
  }
  if (!plakaInput) throw new Error('Plaka input bulunamadı');

  await plakaInput.fill('');
  await plakaInput.type(plakaTemiz, { delay: 40 });

  const cozumBilgi = await captchayiCoz(page);
  if (cozumBilgi) {
    const kodSelectors = [
      'input[id*="Kod" i]:not([id*="Plaka" i])',
      'input[id*="Captcha" i]',
      'input[id*="Guvenlik" i]',
      '#ctl00_ContentPlaceHolder1_txtKod',
      '#txtKod',
      '#txtCaptcha',
    ];
    let kodInput = null;
    for (const s of kodSelectors) {
      const el = await page.$(s);
      if (el) { kodInput = el; break; }
    }
    if (!kodInput) throw new Error('Captcha kod input bulunamadı');
    await kodInput.fill('');
    await kodInput.type(cozumBilgi.cozum, { delay: 40 });
  }

  const btnSelectors = [
    'input[id*="Sorgula"]',
    'button[id*="Sorgula"]',
    'input[value*="Sorgula" i]',
    'button:has-text("Sorgula")',
    '#ctl00_ContentPlaceHolder1_btnSorgula',
    '#btnSorgula',
  ];
  let sorgulaBtn = null;
  for (const s of btnSelectors) {
    const el = await page.$(s);
    if (el) { sorgulaBtn = el; break; }
  }
  if (!sorgulaBtn) throw new Error('Sorgula butonu bulunamadı');
  await sorgulaBtn.click();

  const resultSelectors = [
    '#ctl00_ContentPlaceHolder1_grdSonuc',
    '#grdSonuc',
    '.sonucTablo',
    '[id*="Sonuc"]',
    '[id*="sonuc"]',
    'table.gridview',
  ];
  const combined = resultSelectors.join(', ');

  try {
    await Promise.race([
      page.waitForSelector(combined, { timeout: 30000 }),
      page.waitForSelector('text=/güvenlik kodu|captcha|yanlış|hatalı/i', { timeout: 30000 }),
    ]);
  } catch {
    return { durum: 'hatali', hataMesaji: 'Sonuç gelmedi (30sn)', captchaId: cozumBilgi?.captchaId };
  }

  const sayfaIcerigi = await page.content();
  const captchaHatali = /güvenlik kodu.*hatalı|captcha.*yanlış|kod.*hatalı/i.test(sayfaIcerigi);
  if (captchaHatali) {
    return { durum: 'captcha_yanlis', captchaId: cozumBilgi?.captchaId };
  }

  const sonuc = await page.evaluate((selectors) => {
    let table = null;
    for (const s of selectors.split(',').map((x) => x.trim())) {
      const el = document.querySelector(s);
      if (el && el.tagName === 'TABLE') { table = el; break; }
      if (el) {
        const inner = el.querySelector('table');
        if (inner) { table = inner; break; }
      }
    }
    if (!table) return { ihlaller: [], toplamTutar: 0, hata: 'Tablo bulunamadı' };

    const rows = Array.from(table.querySelectorAll('tbody tr, tr')).filter((r) => r.querySelectorAll('td').length > 0);
    const ihlaller = [];
    let toplam = 0;
    for (const r of rows) {
      const cells = Array.from(r.querySelectorAll('td')).map((c) => c.innerText.trim());
      if (cells.length < 2) continue;
      const satir = {
        sira: cells[0] || '',
        tarih: cells[1] || '',
        saat: cells[2] || '',
        ucretNoktasi: cells[3] || cells[2] || '',
        aciklama: cells[4] || '',
        tutar: parseFloat((cells[cells.length - 1] || '0').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0,
      };
      if (satir.tutar > 0 || /\d{2}\.\d{2}\.\d{4}/.test(satir.tarih)) {
        ihlaller.push(satir);
        toplam += satir.tutar;
      }
    }
    const bodyText = document.body.innerText.toLowerCase();
    const temiz = /ihlal\s*bulun|kayıt\s*bulun|sorgu\s*sonucunda|ihlalli\s*geçiş\s*yok/i.test(bodyText) && ihlaller.length === 0;
    return { ihlaller, toplamTutar: toplam, temiz };
  }, combined);

  return {
    durum: 'basarili',
    ihlalSayisi: sonuc.ihlaller.length,
    toplamTutar: sonuc.toplamTutar,
    detaylar: sonuc.ihlaller,
    temiz: sonuc.temiz,
    kaynak: 'manuel',
    captchaId: cozumBilgi?.captchaId,
  };
}

async function sorgulaPlaka(page, plaka) {
  const plakaTemiz = (plaka || '').replace(/\s/g, '').toUpperCase();
  log(`→ Plaka sorgulanıyor: ${plakaTemiz}`);

  let sonuc = await sorgulaPlakaTekSefer(page, plaka);

  if (sonuc.durum === 'captcha_yanlis') {
    log(`  ↻ Captcha yanlış, retry...`);
    await captchaYanlisRapor(sonuc.captchaId);
    sonuc = await sorgulaPlakaTekSefer(page, plaka);
    if (sonuc.durum === 'captcha_yanlis') {
      await captchaYanlisRapor(sonuc.captchaId);
      return { durum: 'hatali', hataMesaji: '2 deneme captcha yanlış geldi' };
    }
  }

  return sonuc;
}

// === Ana döngü ===
async function run() {
  log('🚗 HGS Agent başlatılıyor...');
  log(`📡 Portal: ${PORTAL}`);
  log(`🔑 Token: ${TOKEN.slice(0, 8)}...`);
  log(`🤖 2captcha key: ${TWOCAPTCHA_KEY.slice(0, 6)}...`);
  log(`🖥  Headless: ${HEADLESS}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
  });
  const page = await context.newPage();

  await ping({ startedAt: new Date().toISOString() });
  setInterval(() => ping({ lastCheck: new Date().toISOString() }), 15000);

  log('✅ Hazır — komut bekleniyor (Pazartesi 08:00 cron veya manuel Toplu Sorgu)');
  while (true) {
    try {
      const commands = await claimCommands();
      if (Array.isArray(commands) && commands.length > 0) {
        for (const cmd of commands) {
          if (cmd.agent !== 'hgs') continue;
          if (cmd.action !== 'toplu-sorgu') continue;
          log(`📥 Komut alındı: ${cmd.id}`);

          const payload = cmd.payload || {};
          const aracIds = payload.aracIds || [];
          const plakalar = payload.plakalar || [];

          const sonuclar = [];
          for (let i = 0; i < aracIds.length; i++) {
            const aracId = aracIds[i];
            const plaka = plakalar[i];
            try {
              const sonuc = await sorgulaPlaka(page, plaka);
              if (sonuc.durum !== 'basarili') {
                await debugDump(page, plaka, sonuc.durum);
              }
              await kaydetSorguSonucu(aracId, sonuc);
              sonuclar.push({ aracId, plaka, ...sonuc });
              log(`  ✓ ${plaka}: ${sonuc.durum} — ${sonuc.ihlalSayisi || 0} ihlal, ${(sonuc.toplamTutar || 0).toFixed(2)} ₺`);
            } catch (err) {
              log(`  ✗ ${plaka} hata: ${err.message}`);
              await debugDump(page, plaka, 'exception');
              sonuclar.push({ aracId, plaka, durum: 'hatali', hataMesaji: err.message });
              await kaydetSorguSonucu(aracId, {
                durum: 'hatali',
                hataMesaji: err.message,
                kaynak: 'manuel',
              });
            }
            await page.waitForTimeout(2000);
          }

          await updateCommand(cmd.id, 'done', {
            araclar: aracIds.length,
            basarili: sonuclar.filter((s) => s.durum === 'basarili').length,
            hatali: sonuclar.filter((s) => s.durum === 'hatali').length,
            tarih: new Date().toISOString(),
          });
          log(`✅ Komut tamamlandı: ${cmd.id}`);
        }
      }
    } catch (err) {
      log('⚠ Polling hatası:', err.message);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

run().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
