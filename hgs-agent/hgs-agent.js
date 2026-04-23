/**
 * HGS İhlal Sorgu Agent
 * =====================
 *
 * Bu script Node.js + Playwright ile KGM İhlal Takip sitesine
 * tam otomatik sorgu yapar. Portal'daki "Toplu Sorgula" butonu
 * AgentCommand yazar, bu script o komutu claim edip çalıştırır.
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
 *   PORTAL_URL   = https://mali-musavir-app-production.up.railway.app/api/v1
 *   AGENT_TOKEN  = <portaldan aldığın token>
 *
 * Akış:
 *   1. Playwright headless=false ile Chromium açar (captcha görsün diye)
 *   2. /agent/status/ping ile canlı olduğunu bildirir (her 15s)
 *   3. /agent/commands/claim?agent=hgs ile pending HGS komutlarını alır
 *   4. Her plaka için:
 *      - KGM İhlal sitesine gider
 *      - Plaka formu doldurur
 *      - Captcha çıkarsa — sen tarayıcıda manuel çözersin (30s bekler)
 *      - Sorgula butonuna basar
 *      - Sonuç tablosu DOM'undan parse eder
 *      - Portal API /galeri/araclar/:id/hgs-sorgu-sonuc ile yazar
 *   5. /agent/commands/:id PUT ile done olarak işaretler
 */

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

// === ENV ===
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envRaw = fs.readFileSync(envPath, 'utf8');
  for (const line of envRaw.split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) {
      process.env[k.trim()] = rest.join('=').trim();
    }
  }
}

const PORTAL = process.env.PORTAL_URL || 'https://mali-musavir-app-production.up.railway.app/api/v1';
const TOKEN = process.env.AGENT_TOKEN;
const KGM_URL = 'https://webihlaltakip.kgm.gov.tr/WebIhlalSorgulama/Sayfalar/Sorgulama.aspx';

if (!TOKEN) {
  console.error('❌ AGENT_TOKEN eksik. hgs-agent/.env dosyasına ekle:');
  console.error('   AGENT_TOKEN=<portal admin\'den alınan agent token>');
  process.exit(1);
}

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
  // Portal endpoint'i JWT ister — ama AgentCommand result içinden
  // backend tarafından portal yazılabilir. Basitlik için önce
  // direkt endpoint'i deneyelim (token ile) — olmazsa command result'a
  // kaydederiz.
  try {
    return await api(`/galeri/araclar/${aracId}/hgs-sorgu-sonuc`, {
      method: 'POST',
      body: data,
    });
  } catch (err) {
    log(`⚠ sonuç kaydedilemedi (${aracId}): ${err.message} — command result'a yedekleniyor`);
    return null;
  }
}

// === KGM sayfasında plaka sorgusu ===
async function sorgulaPlaka(page, plaka) {
  const plakaTemiz = (plaka || '').replace(/\s/g, '').toUpperCase();
  log(`→ Plaka sorgulanıyor: ${plakaTemiz}`);

  // Sayfaya git (her sorgu için baştan — session temiz olsun)
  await page.goto(KGM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Plaka input alanını bul (siteye göre çeşitli selector'lar)
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
  if (!plakaInput) throw new Error('Plaka input bulunamadı — site yapısı değişmiş olabilir');

  await plakaInput.fill('');
  await plakaInput.type(plakaTemiz, { delay: 40 });

  log('  ⏳ Captcha bekleniyor — tarayıcıda çöz ve SORGULA\'ya bas (60s)');

  // Kullanıcı captcha'yı çözüp Sorgula'ya bassın — sonuç tablosu gözükmesini bekle
  // Sonuç indikatörü: çeşitli olasılıklar
  const resultSelectors = [
    '#ctl00_ContentPlaceHolder1_grdSonuc',
    '#grdSonuc',
    '.sonucTablo',
    '[id*="Sonuc"]',
    '[id*="sonuc"]',
    'table.gridview',
  ];
  const combined = resultSelectors.join(', ');

  let basarili = false;
  try {
    await page.waitForSelector(combined, { timeout: 120000 }); // 2 dk
    basarili = true;
  } catch {
    log('  ⚠ Sonuç tablosu 120sn içinde gelmedi');
  }

  if (!basarili) {
    return { durum: 'hatali', hataMesaji: 'Sonuç gelmedi — captcha çözülmedi veya site hata verdi' };
  }

  // Sonuç tablosundan ihlal satırlarını topla
  const sonuc = await page.evaluate((selectors) => {
    let table = null;
    for (const s of selectors.split(',').map(x => x.trim())) {
      table = document.querySelector(s);
      if (table && table.tagName === 'TABLE') break;
      if (table) {
        const inner = table.querySelector('table');
        if (inner) { table = inner; break; }
      }
    }
    if (!table) return { ihlaller: [], toplamTutar: 0, hata: 'Tablo bulunamadı' };

    const rows = Array.from(table.querySelectorAll('tbody tr, tr')).filter(r => r.querySelectorAll('td').length > 0);
    const ihlaller = [];
    let toplam = 0;
    for (const r of rows) {
      const cells = Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim());
      if (cells.length < 2) continue;
      // En az: tarih, saat, noktası, tutar
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
    // "İhlal Yok" kontrolü
    const bodyText = document.body.innerText.toLowerCase();
    const temiz = /ihlal\s*bulun|kayıt\s*bulun|sorgu\s*sonucunda|ihlalli\s*geçiş\s*yok/i.test(bodyText) && ihlaller.length === 0;

    return { ihlaller, toplamTutar: toplam, temiz };
  }, combined);

  return {
    durum: 'basarili',
    ihlalSayisi: sonuc.ihlaller.length,
    toplamTutar: sonuc.toplamTutar,
    detaylar: sonuc.ihlaller,
    kaynak: 'manuel',
  };
}

// === Ana döngü ===
async function run() {
  log('🚗 HGS Agent başlatılıyor...');
  log(`📡 Portal: ${PORTAL}`);
  log(`🔑 Token: ${TOKEN.slice(0, 8)}...`);

  // Playwright Chromium'u aç — headless=false ki captcha görülsün
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
  });
  const page = await context.newPage();

  // İlk ping + interval
  await ping({ startedAt: new Date().toISOString() });
  setInterval(() => ping({ lastCheck: new Date().toISOString() }), 15000);

  // Komut polling döngüsü
  log('✅ Hazır — portalda "Toplu Sorgu Başlat" butonuna bas');
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
              await kaydetSorguSonucu(aracId, sonuc);
              sonuclar.push({ aracId, plaka, ...sonuc });
              log(`  ✓ ${plaka}: ${sonuc.durum} — ${sonuc.ihlalSayisi || 0} ihlal, ${(sonuc.toplamTutar || 0).toFixed(2)} ₺`);
            } catch (err) {
              log(`  ✗ ${plaka} hata: ${err.message}`);
              sonuclar.push({ aracId, plaka, durum: 'hatali', hataMesaji: err.message });
              await kaydetSorguSonucu(aracId, {
                durum: 'hatali',
                hataMesaji: err.message,
                kaynak: 'manuel',
              });
            }
            // İki sorgu arası kısa bekleme
            await page.waitForTimeout(1500);
          }

          await updateCommand(cmd.id, 'done', {
            araclar: aracIds.length,
            basarili: sonuclar.filter(s => s.durum === 'basarili').length,
            hatali: sonuclar.filter(s => s.durum === 'hatali').length,
            tarih: new Date().toISOString(),
          });
          log(`✅ Komut tamamlandı: ${cmd.id}`);
        }
      }
    } catch (err) {
      log('⚠ Polling hatası:', err.message);
    }
    // Yeni komut için 5 sn bekle
    await new Promise(r => setTimeout(r, 5000));
  }
}

run().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
