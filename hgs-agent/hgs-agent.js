/**
 * HGS İhlal Sorgu Agent (v2 — gerçek KGM selector'ları + matematik captcha desteği)
 * ==============================================================================
 *
 * KGM sayfası 3 aşamalı:
 *   1. "Bilgilendirme" modal → "Anladım" (#btnCloseUyariModal) tıkla
 *   2. "OKUDUM ANLADIM" checkbox (#chkGuvenlikUyari) işaretle
 *   3. Plaka (#txtPlk) + Matematik Captcha (#Image1, #txtimgcode) + Sorgula (#btnSorgula)
 *
 * Captcha formatı: "16+8 83236" gibi MATEMATİK İFADESİ + RASTGELE SAYI
 * Kullanıcı yazacak: "24 83236" (math sonucu + boşluk + sayı)
 *
 * 2captcha standart imageCaptcha ham OCR yapar. Biz dönen "16+8 83236" string'ini
 * parse edip math kısmını JS'te hesaplıyoruz.
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
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim();
  }
}

const PORTAL = process.env.PORTAL_URL || 'https://mali-musavir-app-production.up.railway.app/api/v1';
const TOKEN = process.env.AGENT_TOKEN;
const TWOCAPTCHA_KEY = process.env.TWOCAPTCHA_API_KEY;
const HEADLESS = (process.env.HEADLESS || 'true').toLowerCase() !== 'false';
const KGM_URL = 'https://webihlaltakip.kgm.gov.tr/WebIhlalSorgulama/Sayfalar/Sorgulama.aspx?lang=tr';

if (!TOKEN) { console.error('❌ AGENT_TOKEN eksik'); process.exit(1); }
if (!TWOCAPTCHA_KEY) { console.error('❌ TWOCAPTCHA_API_KEY eksik'); process.exit(1); }

const solver = new Solver(TWOCAPTCHA_KEY);

const log = (msg, ...args) => {
  const ts = new Date().toLocaleTimeString('tr-TR', { hour12: false });
  console.log(`[${ts}] ${msg}`, ...args);
};

// === API helpers ===
async function api(endpoint, opts = {}) {
  const res = await fetch(PORTAL + endpoint, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`API ${endpoint} ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

async function ping(meta = {}) {
  try { await api('/agent/status/ping', { method: 'POST', body: { agent: 'hgs', running: true, meta } }); }
  catch (err) { log('⚠ ping başarısız:', err.message); }
}

async function claimCommands() {
  try { return await api('/agent/commands/claim', { method: 'POST', body: { agent: 'hgs' } }); }
  catch (err) { log('⚠ claim başarısız:', err.message); return []; }
}

async function updateCommand(id, status, result = {}) {
  try { await api(`/agent/commands/${id}`, { method: 'PUT', body: { status, result } }); }
  catch (err) { log('⚠ command update başarısız:', err.message); }
}

async function kaydetSorguSonucu(aracId, data) {
  try { return await api(`/galeri/agent/araclar/${aracId}/hgs-sorgu-sonuc`, { method: 'POST', body: data }); }
  catch (err) { log(`⚠ sonuç kaydedilemedi (${aracId}): ${err.message}`); return null; }
}

// === Debug ===
const DEBUG_DIR = path.join(__dirname, 'debug');
function ensureDebugDir() { if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true }); }

async function debugDump(page, plaka, asama) {
  try {
    ensureDebugDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(DEBUG_DIR, `${plaka}_${asama}_${ts}`);
    await page.screenshot({ path: `${base}_page.png`, fullPage: true });
    fs.writeFileSync(`${base}.html`, await page.content(), 'utf8');
    log(`  🐞 Debug dump: ${path.basename(base)}*`);
  } catch (err) { log(`  ⚠ Debug dump başarısız: ${err.message}`); }
}

// === Math captcha çözücü ===
/**
 * 2captcha'dan dönen ham string: "16+8 83236" formatında.
 * Parse → math işlemini hesapla → "24 83236" döner.
 */
function captchaCevabiniFormatla(rawText) {
  const cleaned = (rawText || '').trim().replace(/\s+/g, ' ');
  // İlk parça matematik (örn. "16+8"), kalanı sayı(lar)
  const parts = cleaned.split(' ');
  if (parts.length < 2) return cleaned; // Format bozuk, ham gönder

  const mathPart = parts[0];
  const numberPart = parts.slice(1).join(' ');

  // Math regex: rakam + (+|-|*|/|x|×) + rakam
  const m = mathPart.match(/^(\d+)\s*([+\-*\/xX×])\s*(\d+)$/);
  if (!m) return cleaned;

  const a = parseInt(m[1], 10);
  const b = parseInt(m[3], 10);
  let result;
  switch (m[2]) {
    case '+': result = a + b; break;
    case '-': result = a - b; break;
    case '*': case 'x': case 'X': case '×': result = a * b; break;
    case '/': result = Math.floor(a / b); break;
    default: return cleaned;
  }
  return `${result} ${numberPart}`;
}

async function captchayiCoz(page) {
  const captchaEl = await page.$('#Image1');
  if (!captchaEl) { log('  ⓘ Captcha img bulunamadı'); return null; }

  const buffer = await captchaEl.screenshot({ type: 'png' });
  const base64 = buffer.toString('base64');

  try {
    ensureDebugDir();
    fs.writeFileSync(path.join(DEBUG_DIR, `captcha_${Date.now()}.png`), buffer);
  } catch {}

  log('  🔐 Captcha 2captcha\'ya gönderiliyor (math + sayı)...');
  const t0 = Date.now();
  let cozum;
  try {
    cozum = await solver.imageCaptcha(base64, {
      numeric: 0,
      min_len: 5,
      max_len: 20,
      language: 0,
      regsense: 0,
    });
  } catch (err) {
    throw new Error(`2captcha hatası: ${err.message || err}`);
  }
  const ms = Date.now() - t0;
  const formatted = captchaCevabiniFormatla(cozum.data);
  log(`  ✓ Captcha ham: "${cozum.data}" → formatlı: "${formatted}" (${ms}ms, id=${cozum.id})`);
  return { ham: cozum.data, cevap: formatted, captchaId: cozum.id };
}

async function captchaYanlisRapor(captchaId) {
  if (!captchaId) return;
  try { await solver.reportBad(captchaId); log(`  ⚠ Captcha (${captchaId}) yanlış olarak raporlandı`); }
  catch {}
}

// === KGM sorgu ===
async function sayfayiHazirla(page) {
  // 1. Bilgilendirme modal'ını kapat
  const anladimBtn = await page.$('#btnCloseUyariModal');
  if (anladimBtn) {
    const visible = await anladimBtn.isVisible().catch(() => false);
    if (visible) {
      await anladimBtn.click();
      await page.waitForTimeout(500);
      log('  ✓ Modal "Anladım" tıklandı');
    }
  }

  // 2. OKUDUM ANLADIM checkbox
  const chk = await page.$('#chkGuvenlikUyari');
  if (chk) {
    const checked = await chk.isChecked().catch(() => false);
    if (!checked) {
      await chk.check();
      log('  ✓ OKUDUM ANLADIM işaretlendi');
    }
  }
}

async function sorgulaPlakaTekSefer(page, plaka) {
  const plakaTemiz = (plaka || '').replace(/\s/g, '').toUpperCase();

  await page.goto(KGM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500); // sayfa JS'i bitsin (modal render)

  await sayfayiHazirla(page);

  // 3. Plaka yaz
  const plakaInput = await page.$('#txtPlk');
  if (!plakaInput) throw new Error('Plaka input (#txtPlk) bulunamadı');
  await plakaInput.fill('');
  await plakaInput.type(plakaTemiz, { delay: 40 });

  // 4. Captcha çöz
  const cozumBilgi = await captchayiCoz(page);
  if (!cozumBilgi) throw new Error('Captcha çözülemedi');

  // 5. Captcha cevabını textarea'ya yaz
  const kodInput = await page.$('#txtimgcode');
  if (!kodInput) throw new Error('Captcha textarea (#txtimgcode) bulunamadı');
  await kodInput.fill('');
  await kodInput.type(cozumBilgi.cevap, { delay: 40 });

  // 6. Sorgula
  const sorgulaBtn = await page.$('#btnSorgula');
  if (!sorgulaBtn) throw new Error('Sorgula butonu (#btnSorgula) bulunamadı');
  await sorgulaBtn.click();

  // 7. Sonuç bekle — tablo veya hata
  try {
    await page.waitForLoadState('networkidle', { timeout: 30000 });
  } catch {}

  const sayfaIcerigi = await page.content();
  const captchaHatali = /güvenlik kodu.*hatalı|captcha.*yanlış|kod.*hatalı|matematiksel.*hatalı|tekrar deneyin/i.test(sayfaIcerigi);
  if (captchaHatali) {
    return { durum: 'captcha_yanlis', captchaId: cozumBilgi?.captchaId };
  }

  // 8. İhlal tablosu veya "ihlal yok" mesajı
  const sonuc = await page.evaluate(() => {
    // Tablo bul: ihlal listesi
    const tables = Array.from(document.querySelectorAll('table'));
    let table = null;
    for (const t of tables) {
      const txt = (t.innerText || '').toLowerCase();
      if (/plaka|tarih|tutar|ihlal|geçiş/i.test(txt) && t.querySelectorAll('tr').length > 1) {
        table = t; break;
      }
    }

    const ihlaller = [];
    let toplam = 0;
    if (table) {
      const rows = Array.from(table.querySelectorAll('tbody tr, tr')).filter(r => r.querySelectorAll('td').length > 0);
      for (const r of rows) {
        const cells = Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim());
        if (cells.length < 2) continue;
        const tutar = parseFloat((cells[cells.length - 1] || '0').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
        if (tutar > 0 || /\d{2}\.\d{2}\.\d{4}/.test(cells.join(' '))) {
          ihlaller.push({
            tarih: cells[0] || '',
            saat: cells[1] || '',
            ucretNoktasi: cells[2] || '',
            aciklama: cells[3] || '',
            tutar,
            ham: cells,
          });
          toplam += tutar;
        }
      }
    }

    const bodyText = (document.body.innerText || '').toLowerCase();
    const temiz = /ihlal\s*bulun|kayıt\s*bulun|sorgu\s*sonucunda|ihlalli\s*geçiş\s*yok|geçiş ihlaliniz bulun/i.test(bodyText) && ihlaller.length === 0;
    return { ihlaller, toplamTutar: toplam, temiz };
  });

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
  log('🚗 HGS Agent v2 başlatılıyor...');
  log(`📡 Portal: ${PORTAL}`);
  log(`🔑 Token: ${TOKEN.slice(0, 8)}...`);
  log(`🤖 2captcha key: ${TWOCAPTCHA_KEY.slice(0, 6)}...`);
  log(`🖥  Headless: ${HEADLESS}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
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
              if (sonuc.durum !== 'basarili') await debugDump(page, plaka, sonuc.durum);
              await kaydetSorguSonucu(aracId, sonuc);
              sonuclar.push({ aracId, plaka, ...sonuc });
              log(`  ✓ ${plaka}: ${sonuc.durum} — ${sonuc.ihlalSayisi || 0} ihlal, ${(sonuc.toplamTutar || 0).toFixed(2)} ₺`);
            } catch (err) {
              log(`  ✗ ${plaka} hata: ${err.message}`);
              await debugDump(page, plaka, 'exception');
              sonuclar.push({ aracId, plaka, durum: 'hatali', hataMesaji: err.message });
              await kaydetSorguSonucu(aracId, { durum: 'hatali', hataMesaji: err.message, kaynak: 'manuel' });
            }
            await page.waitForTimeout(2000);
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
    } catch (err) { log('⚠ Polling hatası:', err.message); }
    await new Promise(r => setTimeout(r, 5000));
  }
}

run().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
