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

// Aktif komut ID'si — set edildiğinde log() ayrıca portala da gönderir.
let activeCommandId = null;

async function postLogToCommand(message, level = 'info') {
  if (!activeCommandId) return;
  try {
    await fetch(PORTAL + '/agent/commands/' + activeCommandId + '/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
      body: JSON.stringify({ level, message: String(message || '').slice(0, 500) }),
    });
  } catch {}
}

const log = (msg, ...args) => {
  const ts = new Date().toLocaleTimeString('tr-TR', { hour12: false });
  console.log(`[${ts}] ${msg}`, ...args);
  // Aktif komut varsa portala da gönder (fire-and-forget)
  if (activeCommandId) {
    const full = String(msg) + (args.length ? ' ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') : '');
    const level = /hata|fail|✗|error|⚠/i.test(full) ? 'warn' : 'info';
    postLogToCommand(full, level);
  }
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

async function zombileriTemizle() {
  try {
    const r = await api('/galeri/agent/cleanup-stale', { method: 'POST', body: {} });
    if (r && r.temizlenen > 0) log(`🧹 ${r.temizlenen} zombi komut temizlendi`);
    else log('🧹 Zombi komut yok');
  } catch (err) {
    log(`⚠ Zombi temizleme başarısız: ${err.message}`);
  }
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

  // 7. Sonuç bekle — KGM tablosu veya "ihlal yok" mesajı (ikisinden biri çıkmalı)
  try {
    await Promise.race([
      page.waitForSelector('#gvKgm tbody tr, #gvAvrasya tbody tr, [id^="gv"] tbody tr', { timeout: 20000 }),
      page.waitForFunction(() => /ihlal\s*bulun|kayıt\s*bulun|sorgu\s*sonucunda|ihlalli\s*geçiş\s*yok|geçiş ihlaliniz/i.test(document.body.innerText || ''), { timeout: 20000 }),
    ]);
  } catch {}
  // Tüm tablolar render olsun
  await page.waitForTimeout(1500);

  const sayfaIcerigi = await page.content();
  const captchaHatali = /güvenlik kodu.*hatalı|captcha.*yanlış|kod.*hatalı|matematiksel.*hatalı|tekrar deneyin/i.test(sayfaIcerigi);
  if (captchaHatali) {
    return { durum: 'captcha_yanlis', captchaId: cozumBilgi?.captchaId };
  }

  // 8. İhlal tabloları: gvKgm, gvAvrasya ve diğer gv* tabloları
  const sonuc = await page.evaluate(() => {
    function paraParse(s) {
      if (!s) return 0;
      const cleaned = s.replace(/[^\d,.\-₺TL ]/gi, '').replace(/[₺TL\s]/gi, '').trim();
      // Türkçe format: "32,50" veya "1.234,56" — binlik ayracı nokta, ondalık virgül
      const normalized = cleaned.replace(/\./g, '').replace(',', '.');
      return parseFloat(normalized) || 0;
    }

    // KGM birden çok tablo döndürür: gvKgm, gvAvrasya, gvOsmangazi, vb.
    // Hepsi `id^="gv"` ile başlar veya class="dataTable" içerir.
    const allTables = Array.from(document.querySelectorAll('table[id^="gv"], table.dataTable'));
    // Tekrarlananları kaldır
    const tables = [...new Set(allTables)];

    const ihlaller = [];
    let toplam = 0;
    const tableDebug = [];

    for (const t of tables) {
      const tableId = t.id || '(no-id)';
      // Sütun başlıklarını al — "Ödenecek Tutar" index'ini bul
      const headerCells = Array.from(t.querySelectorAll('thead th, thead td'));
      const headers = headerCells.map(h => h.innerText.trim());
      const odenecekIdx = headers.findIndex(h => /Ödenecek\s*Tutar/i.test(h));
      const gecisUcretIdx = headers.findIndex(h => /Geçiş\s*Ücreti/i.test(h));
      const tarihIdx = headers.findIndex(h => /Çıkış\s*Tarih|Tarih/i.test(h));
      const girisIdx = headers.findIndex(h => /Giriş/i.test(h));
      const cikisIdx = headers.findIndex(h => /Çıkış\s*İstasyon|^Çıkış$/i.test(h));

      const dataRows = Array.from(t.querySelectorAll('tbody tr')).filter(r => r.querySelectorAll('td').length > 0);
      const tableSum = { tableId, rowCount: dataRows.length, headers, odenecekIdx, tarihIdx, satirlar: [] };

      for (const r of dataRows) {
        const cells = Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim());
        if (cells.length < 2) continue;

        let tutar = 0;
        if (odenecekIdx >= 0 && cells[odenecekIdx]) {
          tutar = paraParse(cells[odenecekIdx]);
        }
        // Yedek: hiçbir tutar yoksa son TL içeren hücre
        if (tutar === 0) {
          for (let i = cells.length - 1; i >= 0; i--) {
            if (/₺|TL/i.test(cells[i])) {
              const v = paraParse(cells[i]);
              if (v > 0) { tutar = v; break; }
            }
          }
        }

        const ihlal = {
          kaynak: tableId,
          tarih: tarihIdx >= 0 ? cells[tarihIdx] : '',
          giris: girisIdx >= 0 ? cells[girisIdx] : '',
          cikis: cikisIdx >= 0 ? cells[cikisIdx] : '',
          gecisUcreti: gecisUcretIdx >= 0 ? paraParse(cells[gecisUcretIdx]) : 0,
          tutar,
          ham: cells,
        };
        ihlaller.push(ihlal);
        toplam += tutar;
        tableSum.satirlar.push({ tarih: ihlal.tarih, tutar });
      }
      tableDebug.push(tableSum);
    }

    const bodyText = (document.body.innerText || '').toLowerCase();
    const temiz = /ihlal\s*bulun|kayıt\s*bulun|sorgu\s*sonucunda|ihlalli\s*geçiş\s*yok|geçiş ihlaliniz bulun/i.test(bodyText) && ihlaller.length === 0;
    const kayitMatch = (document.body.innerText || '').match(/(\d+)\s*kayıt/);

    return {
      ihlaller, toplamTutar: toplam, temiz,
      kayitSayisi: kayitMatch ? parseInt(kayitMatch[1], 10) : null,
      _debug: {
        toplamTablo: tables.length,
        tablolar: tableDebug.map(t => ({ id: t.tableId, rowCount: t.rowCount, headers: t.headers, odenecekIdx: t.odenecekIdx, tarihIdx: t.tarihIdx, ilkSatir: t.satirlar[0] })),
        bodyTextSample: bodyText.slice(0, 200),
      },
    };
  });

  // Doğrulama: kayitSayisi (sayfadaki "26 kayıt") ile ihlaller.length aynı mı?
  if (sonuc.kayitSayisi !== null && sonuc.kayitSayisi !== sonuc.ihlaller.length) {
    log(`  ⚠ Kayıt sayısı uyuşmazlığı: sayfada "${sonuc.kayitSayisi} kayıt" yazıyor, parser ${sonuc.ihlaller.length} satır buldu`);
  }
  log(`  📊 ${sonuc.ihlaller.length} ihlal / ${sonuc.toplamTutar.toFixed(2)} ₺ — Debug: ${JSON.stringify(sonuc._debug, null, 0).slice(0, 350)}`);

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
async function ensureLiveBrowser(state) {
  // state = { browser, context, page }
  // Sayfa hâlâ canlı mı?
  if (state.page && !state.page.isClosed()) return state;

  log('  ♻ Tarayıcı kapanmış, yeniden açılıyor...');
  try { if (state.browser) await state.browser.close().catch(() => {}); } catch {}

  state.browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  state.context = await state.browser.newContext({ viewport: { width: 1200, height: 900 } });
  state.page = await state.context.newPage();
  return state;
}

async function run() {
  log('🚗 HGS Agent v2 başlatılıyor...');
  log(`📡 Portal: ${PORTAL}`);
  log(`🔑 Token: ${TOKEN.slice(0, 8)}...`);
  log(`🤖 2captcha key: ${TWOCAPTCHA_KEY.slice(0, 6)}...`);
  log(`🖥  Headless: ${HEADLESS}`);

  const browserState = { browser: null, context: null, page: null };
  await ensureLiveBrowser(browserState);

  await ping({ startedAt: new Date().toISOString() });
  setInterval(() => ping({ lastCheck: new Date().toISOString() }), 15000);

  // Zombi komutları temizle (önceki Ctrl+C'lerden takılı kalan running komutlar)
  await zombileriTemizle();

  log('✅ Hazır — komut bekleniyor (Pazartesi 08:00 cron veya manuel Toplu Sorgu)');
  while (true) {
    try {
      const commands = await claimCommands();
      if (Array.isArray(commands) && commands.length > 0) {
        for (const cmd of commands) {
          if (cmd.agent !== 'hgs') continue;
          if (cmd.action !== 'toplu-sorgu') continue;
          log(`📥 Komut alındı: ${cmd.id}`);
          activeCommandId = cmd.id;  // Bundan sonraki loglar portala da gidecek

          const payload = cmd.payload || {};
          const aracIds = payload.aracIds || [];
          const plakalar = payload.plakalar || [];

          const sonuclar = [];
          let iptalEdildi = false;
          for (let i = 0; i < aracIds.length; i++) {
            const aracId = aracIds[i];
            const plaka = plakalar[i];

            // İptal kontrolü — kullanıcı portal'dan iptal etmiş mi?
            try {
              const durum = await api(`/agent/commands/${cmd.id}`);
              if (durum && durum.status === 'cancelled') {
                log(`🛑 Komut iptal edildi, kalan ${aracIds.length - i} plaka atlanıyor`);
                iptalEdildi = true;
                break;
              }
            } catch {}

            try {
              // Her plaka öncesi tarayıcı canlı mı kontrol et, kapanmışsa yeniden aç
              await ensureLiveBrowser(browserState);
              const sonuc = await sorgulaPlaka(browserState.page, plaka);
              if (sonuc.durum !== 'basarili' || (sonuc.ihlalSayisi || 0) === 0) {
                try { await debugDump(browserState.page, plaka, sonuc.durum === 'basarili' ? 'basarili_0_ihlal' : sonuc.durum); } catch {}
              }
              await kaydetSorguSonucu(aracId, sonuc);
              sonuclar.push({ aracId, plaka, ...sonuc });
              log(`  ✓ ${plaka}: ${sonuc.durum} — ${sonuc.ihlalSayisi || 0} ihlal, ${(sonuc.toplamTutar || 0).toFixed(2)} ₺`);
            } catch (err) {
              log(`  ✗ ${plaka} hata: ${err.message}`);
              try { await debugDump(browserState.page, plaka, 'exception'); } catch {}
              sonuclar.push({ aracId, plaka, durum: 'hatali', hataMesaji: err.message });
              await kaydetSorguSonucu(aracId, { durum: 'hatali', hataMesaji: err.message, kaynak: 'manuel' });
              // Browser kapanmışsa bir sonraki plakada otomatik yeniden açılacak
            }
            try { if (browserState.page && !browserState.page.isClosed()) await browserState.page.waitForTimeout(2000); } catch {}
          }

          if (!iptalEdildi) {
            await updateCommand(cmd.id, 'done', {
              araclar: aracIds.length,
              basarili: sonuclar.filter(s => s.durum === 'basarili').length,
              hatali: sonuclar.filter(s => s.durum === 'hatali').length,
              tarih: new Date().toISOString(),
            });
            log(`✅ Komut tamamlandı: ${cmd.id}`);
          } else {
            log(`🛑 Komut iptal edildi (${sonuclar.length}/${aracIds.length} plaka işlendi)`);
          }
          activeCommandId = null;  // Log akışı kapat
        }
      }
    } catch (err) { log('⚠ Polling hatası:', err.message); }
    await new Promise(r => setTimeout(r, 5000));
  }
}

run().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
