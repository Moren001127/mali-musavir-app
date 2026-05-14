/**
 * Luca Local Agent — Ofis PC'sinde arka planda çalışan worker.
 *
 * - Railway API'sini polling yapar, pending LucaFetchJob'ları çeker.
 * - Job geldiğinde Playwright headless Chromium ile Luca'ya login olur.
 * - İlgili Excel'i (hesap planı / mizan / muavin) indirir.
 * - Sonucu Railway API'sine yükler.
 *
 * Chrome açık olmasına gerek yok, PC açık olması yeterli.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const { chromium } = require('playwright');

// --------- Konfigürasyon yükleme ---------
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const DEVICE_ID_PATH = path.join(__dirname, '..', '.device-id');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('HATA: config.json bulunamadı. config.example.json dosyasını config.json olarak kopyalayıp doldurun.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));

// --------- Device ID (her PC için unique, otomatik üretilir) ---------
function getOrCreateDeviceId() {
  // Önce config.json'da workerName/deviceId var mı kontrol
  if (cfg.worker?.deviceId) return String(cfg.worker.deviceId);

  // Yoksa .device-id dosyasından oku (PC başına persistent)
  if (fs.existsSync(DEVICE_ID_PATH)) {
    const saved = fs.readFileSync(DEVICE_ID_PATH, 'utf8').trim();
    if (saved) return saved;
  }

  // İlk çalıştırma: hostname + random suffix
  const hostname = os.hostname().replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  const suffix = crypto.randomBytes(4).toString('hex');
  const id = `${hostname}-${suffix}`;
  fs.writeFileSync(DEVICE_ID_PATH, id, 'utf8');
  return id;
}
const DEVICE_ID = getOrCreateDeviceId();
const WORKER_NAME = cfg.worker?.workerName || os.hostname();

if (!cfg.api?.baseUrl || !cfg.api?.agentToken) {
  console.error('HATA: config.json içinde api.baseUrl ve api.agentToken zorunlu.');
  process.exit(1);
}
if (!cfg.luca?.uyeNo || !cfg.luca?.username || !cfg.luca?.password) {
  console.error('HATA: config.json içinde luca.uyeNo, luca.username, luca.password zorunlu.');
  process.exit(1);
}

const POLL_INTERVAL = (cfg.worker?.pollIntervalSeconds || 30) * 1000;
const BROWSER_TIMEOUT = (cfg.worker?.browserTimeoutSeconds || 120) * 1000;
const HEADLESS = cfg.worker?.headless !== false;
const JOB_TYPES = new Set(cfg.worker?.jobTypes || ['ACCOUNT_PLAN', 'MIZAN', 'MUAVIN']);
const LOG_LEVEL = cfg.log?.level || 'info';
const LOCAL_AGENT_VERSION = 'local-1.0.2';
const JOB_TIMEOUT = (cfg.worker?.jobTimeoutSeconds || 15 * 60) * 1000;
// v1.36.X: idle TTL 20dk → 2 saat. Mali müşavir ofisi tüm gün açık;
// her tıklamada login için 10-20sn kayıp anlamsız. 2 saat hareketsizlik
// sonrası Luca cookie zaten düşmüş olur, kapatma doğru.
const BROWSER_IDLE_TTL = (cfg.worker?.browserIdleTtlSeconds || 2 * 60 * 60) * 1000;
// Keep-alive ping aralığı: idle TTL'in 1/4'ü. Browser session açıkken
// arka planda hafif bir sayfa içi navigasyon yaparak Luca cookie'sinin
// sunucu tarafında sıfırlanmasını engelleriz.
const BROWSER_KEEPALIVE_INTERVAL = Math.max(60_000, BROWSER_IDLE_TTL / 4);

// --------- Logger ---------
const log = {
  info: (...args) => console.log(`[${new Date().toISOString()}]`, ...args),
  warn: (...args) => console.warn(`[${new Date().toISOString()}] WARN`, ...args),
  error: (...args) => console.error(`[${new Date().toISOString()}] ERROR`, ...args),
  debug: (...args) => {
    if (LOG_LEVEL === 'debug') console.log(`[${new Date().toISOString()}] DEBUG`, ...args);
  },
};

// --------- API client ---------
const api = axios.create({
  baseURL: cfg.api.baseUrl,
  headers: { 'x-agent-token': cfg.api.agentToken },
  timeout: 30_000,
});

async function pollPendingJobs() {
  try {
    const { data } = await api.get('/agent/luca/jobs/pending', {
      params: { deviceId: DEVICE_ID },
    });
    return Array.isArray(data) ? data : data?.jobs || [];
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message;
    log.warn(`Polling hatası (${status}): ${msg}`);
    return [];
  }
}

async function markJobStart(jobId) {
  try {
    const { data } = await api.post(`/agent/luca/jobs/${jobId}/start`, { deviceId: DEVICE_ID });
    return data?.claimed !== false && data?.ok !== false;
  } catch (err) {
    log.warn(`Job start mark hatası: ${err.message}`);
    return false;
  }
}

async function markJobDone(jobId, info = {}) {
  try {
    await api.post(`/agent/luca/jobs/${jobId}/done`, info);
  } catch (err) {
    log.warn(`Job done mark hatası: ${err.message}`);
  }
}

async function markJobFailed(jobId, errorMsg) {
  try {
    await api.post(`/agent/luca/jobs/${jobId}/fail`, { error: errorMsg });
  } catch (err) {
    log.warn(`Job fail mark hatası: ${err.message}`);
  }
}

async function pingAgentStatus(running = true, extraMeta = {}) {
  try {
    await api.post('/agent/status/ping', {
      agent: 'luca',
      running,
      meta: {
        deviceId: DEVICE_ID,
        workerName: WORKER_NAME,
        version: LOCAL_AGENT_VERSION,
        localWorker: true,
        hostname: os.hostname(),
        jobTypes: [...JOB_TYPES],
        ...extraMeta,
      },
    });
  } catch (err) {
    log.debug(`Ping hatası: ${err.message}`);
  }
}

async function logJob(jobId, line) {
  try {
    await api.post(`/agent/luca/jobs/${jobId}/log`, { msg: line, line });
  } catch (err) {
    log.debug(`Job log hatası: ${err.message}`);
  }
}

async function waitForJobFinalStatus(jobId, timeoutMs = JOB_TIMEOUT) {
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < timeoutMs) {
    const { data } = await api.get(`/agent/luca/jobs/${jobId}/status`);
    const status = data?.status || '';
    if (status && status !== lastStatus) {
      log.info(`Job durum: ${jobId.slice(0, 8)} -> ${status}`);
      lastStatus = status;
    }
    if (['done', 'failed', 'cancelled'].includes(status)) return data;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Job zaman aşımı: ${Math.round(timeoutMs / 1000)}sn`);
}

async function uploadAccountPlan(buffer, mukellefId, jobId) {
  const form = new FormData();
  form.append('file', buffer, { filename: 'hesap-plani.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = `/agent/luca/runner/upload-account-plan?mukellefId=${encodeURIComponent(mukellefId)}${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ''}`;
  const { data } = await api.post(url, form, { headers: form.getHeaders() });
  return data;
}

async function uploadMizan(buffer, mukellefId, donem, jobId) {
  const form = new FormData();
  form.append('file', buffer, { filename: 'mizan.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = `/agent/luca/runner/upload-mizan?mukellefId=${encodeURIComponent(mukellefId)}&donem=${encodeURIComponent(donem)}${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ''}`;
  const { data } = await api.post(url, form, { headers: form.getHeaders() });
  return data;
}

// --------- Luca Playwright login + scrape ---------
const LUCA_URLS = {
  login: process.env.LUCA_LOGIN_URL || 'https://agiris.luca.com.tr/LUCASSO/giris.erp',
};

let browserSession = null;

async function closeBrowserSession(reason = 'manual') {
  const s = browserSession;
  browserSession = null;
  if (!s) return;
  log.info(`Luca browser oturumu kapatiliyor: ${reason}`);
  if (s.keepAliveTimer) {
    clearInterval(s.keepAliveTimer);
    s.keepAliveTimer = null;
  }
  await s.page?.close?.().catch(() => {});
  await s.context?.close?.().catch(() => {});
  await s.browser?.close?.().catch(() => {});
}

/**
 * Browser açıkken arka planda hafif ping atar — Luca session cookie'sinin
 * sunucu tarafında 30dk inaktivite ile düşmesini engeller. Her interval'de
 * mevcut sayfa URL'ini okur (zero-cost) + lastUsedAt'i yenilemez (gerçek
 * iş gelmediyse idle TTL'i bozma).
 */
function startKeepAlive(session) {
  if (session.keepAliveTimer) return;
  session.keepAliveTimer = setInterval(async () => {
    try {
      if (!browserSession || browserSession !== session) return;
      const page = session.page;
      if (!page || page.isClosed()) return;
      const url = page.url();
      // Sadece Luca domain'inde keep-alive yap
      if (!/luca\.com\.tr/i.test(url)) return;
      // Hafif evaluate — herhangi bir DOM erişimi cookie'yi refresh eder
      await page.evaluate(() => Date.now()).catch(() => {});
      log.debug?.(`Luca keep-alive ping (url: ${url.slice(0, 80)})`);
    } catch (e) {
      // sessizce yok say — bir sonraki tick'te tekrar dene
    }
  }, BROWSER_KEEPALIVE_INTERVAL);
}

async function getBrowserSession() {
  const now = Date.now();
  if (browserSession) {
    const idleFor = now - (browserSession.lastUsedAt || browserSession.createdAt || now);
    const pageClosed = browserSession.page?.isClosed?.() === true;
    if (!pageClosed && idleFor < BROWSER_IDLE_TTL) {
      browserSession.lastUsedAt = now;
      return browserSession;
    }
    await closeBrowserSession(pageClosed ? 'page-closed' : 'idle-timeout');
  }

  // PERSISTENT CONTEXT: user data dir disk'e kayıtlı kalır → Luca cookie'leri
  // (1-2 gün TTL'li) yeniden başlatınca da var → captcha tekrar tekrar sorulmaz.
  // Luca oturumu düşene kadar (idle timeout veya cookie expire) login bir kez.
  //
  // DNS: Chromium "secure DNS / DoH" devre dışı (DoH provider TR'den engelli).
  // --disable-features=DnsOverHttps,AsyncDns sistem resolver'ına geçirir.
  const userDataDir = path.join(__dirname, '..', '.browser-data');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: HEADLESS,
    timeout: BROWSER_TIMEOUT,
    acceptDownloads: true,
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    args: [
      '--disable-features=DnsOverHttps,AsyncDns',
      '--dns-over-https-mode=off',
    ],
  });
  // Persistent context'ta browser bir gizli wrapper — page'leri context üzerinden al.
  const page = context.pages()[0] || await context.newPage();
  browserSession = {
    browser: context.browser(),
    context,
    page,
    createdAt: now,
    lastUsedAt: now,
    runtimeInstalled: false,
    persistent: true,
    keepAliveTimer: null,
    // v1.36.X: aynı mükellef hızlı yol — son seçilen firma cache
    lastTaxpayer: null, // { taxpayerId, selectedAt: number }
  };
  startKeepAlive(browserSession);
  log.info(`Luca browser oturumu acildi (persistent: ${userDataDir}, idle TTL ${Math.round(BROWSER_IDLE_TTL/60000)}dk) — cookie'ler kayitli kalir.`);
  return browserSession;
}

async function withBrowser(handler) {
  const session = await getBrowserSession();
  try {
    return await handler(session.page, session.context, session);
  } finally {
    session.lastUsedAt = Date.now();
  }
}

async function installMorenRuntimeBridge(context, page) {
  if (browserSession?.context === context && browserSession.runtimeInstalled) return;
  const runtimeBaseUrl = cfg.api.runtimeUrl || `${cfg.api.baseUrl}/agent/runtime.js`;
  const runtimeUrl = `${runtimeBaseUrl}${runtimeBaseUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
  const runtimeResponse = await axios.get(runtimeUrl, { timeout: 30_000 });
  const runtimeCode = String(runtimeResponse.data || '');
  const bridgeScript = ({ token, deviceId, credential }) => {
    const installIdentity = () => {
      try { document.documentElement.dataset.morenAgentToken = token; } catch {}
      try { document.documentElement.dataset.morenDeviceId = deviceId; } catch {}
      try { localStorage.setItem('moren_agent_token', token); } catch {}
      try { localStorage.setItem('moren_device_id', deviceId); } catch {}
    };

    const installCredentialBridge = () => {
      if (window.__morenLocalCredentialBridge) return;
      window.__morenLocalCredentialBridge = true;
      const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : String(input?.url || '');
        if (url.includes('/agent/luca/credential')) {
          return new Response(JSON.stringify({
            saved: true,
            uyeNo: credential.uyeNo,
            username: credential.username,
            password: credential.password,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return nativeFetch(input, init);
      };
    };

    const boot = () => {
      installIdentity();
      installCredentialBridge();
    };

    installIdentity();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  };
  const bridgeArg = {
    token: cfg.api.agentToken,
    deviceId: DEVICE_ID,
    credential: {
      uyeNo: cfg.luca.uyeNo,
      username: cfg.luca.username,
      password: cfg.luca.password,
    },
  };
  await context.addInitScript(bridgeScript, bridgeArg);
  await context.addInitScript({ content: runtimeCode });
  await page.addInitScript(
    ({ token, deviceId, credential }) => {
      const installIdentity = () => {
        try { document.documentElement.dataset.morenAgentToken = token; } catch {}
        try { document.documentElement.dataset.morenDeviceId = deviceId; } catch {}
        try { localStorage.setItem('moren_agent_token', token); } catch {}
        try { localStorage.setItem('moren_device_id', deviceId); } catch {}
      };

      const installCredentialBridge = () => {
        if (window.__morenLocalCredentialBridge) return;
        window.__morenLocalCredentialBridge = true;
        const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
        window.fetch = async (input, init) => {
          const url = typeof input === 'string' ? input : String(input?.url || '');
          if (url.includes('/agent/luca/credential')) {
            return new Response(JSON.stringify({
              saved: true,
              uyeNo: credential.uyeNo,
              username: credential.username,
              password: credential.password,
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return nativeFetch(input, init);
        };
      };

      const boot = () => {
        installIdentity();
        installCredentialBridge();
      };

      installIdentity();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
      } else {
        boot();
      }
    },
    bridgeArg,
  );
  await page.addInitScript({ content: runtimeCode });
  if (browserSession?.context === context) browserSession.runtimeInstalled = true;
}

async function runJobWithMorenRuntime(job) {
  const jobId = job.id;
  await withBrowser(async (page, context) => {
    page.on('console', (msg) => {
      const text = msg.text();
      if (LOG_LEVEL === 'debug' || /Moren|Luca|captcha|hata|error/i.test(text)) {
        log.debug(`[browser:${msg.type()}] ${text}`);
      }
    });
    page.on('pageerror', (err) => log.warn(`Browser pageerror: ${err.message}`));
    page.on('dialog', async (dialog) => {
      log.warn(`Browser dialog: ${dialog.message()}`);
      await dialog.dismiss().catch(() => {});
    });

    await installMorenRuntimeBridge(context, page);
    await logJob(jobId, `Local Node ajan işi aldı: ${WORKER_NAME} (${DEVICE_ID})`);
    const currentUrl = page.url();
    if (/^https:\/\/(agiris|auygs)\.luca\.com\.tr\//i.test(currentUrl || '')) {
      await logJob(jobId, `Mevcut arka plan Luca oturumu kullanılacak: ${currentUrl.slice(0, 90)}`);
    } else {
      await page.goto(LUCA_URLS.login, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    const final = await waitForJobFinalStatus(jobId);
    if (final?.status !== 'done') {
      throw new Error(`Job ${final?.status || 'bilinmeyen'} durumunda kapandı`);
    }
  });
}

async function loginToLuca(page) {
  log.info('Luca login sayfasına gidiliyor...');
  await page.goto(LUCA_URLS.login, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Form alanları render olsun
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Luca form alanları — placeholder ile bulunabilir (Üye Numarası / Kullanıcı Adı / Parola)
  const uyeNoSelector = 'input[name="uyeNo"], input[name="musteriNo"], input#uyeNo, input[placeholder*="Üye" i], input[placeholder*="ye Numara" i]';
  const usernameSelector = 'input[name="kullaniciAdi"], input[name="username"], input#username, input[placeholder*="Kullan" i]';
  const passwordSelector = 'input[name="sifre"], input[name="password"], input[type="password"], input[placeholder*="Parola" i]';

  // Doldur
  await page.fill(uyeNoSelector, cfg.luca.uyeNo);
  await page.fill(usernameSelector, cfg.luca.username);
  await page.fill(passwordSelector, cfg.luca.password);

  // Submit yöntemi 1: parola alanında Enter
  // (Luca'nın "GİRİŞ" butonu genelde input[type="button"] veya custom div; Enter en sağlamı)
  const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
  await page.press(passwordSelector, 'Enter');
  let nav = await navPromise;

  // Submit yöntemi 2: yine login sayfasındaysak GİRİŞ butonunu metinle yakala ve tıkla
  if (!nav || page.url().includes('giris.erp') || page.url().includes('login')) {
    log.info('Enter ile gönderilemedi, GİRİŞ butonunu metinle aranıyor...');
    const submitButtonSelectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      'input[value="GİRİŞ"]',
      'input[value="Giriş"]',
      'input[value="GIRIS"]',
      'button:has-text("GİRİŞ")',
      'button:has-text("Giriş")',
      'a:has-text("GİRİŞ")',
      'a:has-text("Giriş")',
      'div.giris-btn',
      '.login-button',
      'button.btn-login',
      '[onclick*="giris" i]',
    ];
    for (const sel of submitButtonSelectors) {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible().catch(() => false)) {
        log.info(`GİRİŞ butonu bulundu: ${sel}`);
        const navPromise2 = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
        await btn.click();
        nav = await navPromise2;
        break;
      }
    }
  }

  // Submit yöntemi 3: hâlâ login sayfasındaysak metin ile xpath
  if (page.url().includes('giris.erp')) {
    log.info('Hâlâ login ekranındayız, xpath ile aranıyor...');
    const btn = await page.$('xpath=//*[normalize-space(text())="GİRİŞ" or normalize-space(text())="Giriş" or normalize-space(@value)="GİRİŞ" or normalize-space(@value)="Giriş"]');
    if (btn) {
      const navPromise3 = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
      await btn.click().catch(() => {});
      await navPromise3;
    }
  }

  // CAPTCHA kontrolü
  await page.waitForTimeout(1500);
  const captchaImg = await page.$('img[src*="captcha" i], img[alt*="güvenlik" i], #captcha-input');
  if (captchaImg) {
    throw new Error('CAPTCHA ekranı geldi — manuel müdahale gerekli. Bir kez tarayıcı ile login olup oturumu sıcak tutun veya 2FA kapatın.');
  }

  const url = page.url();
  if (url.includes('giris.erp') || url.includes('LUCASSO/login')) {
    throw new Error(`Login başarısız — hâlâ login sayfasında: ${url}`);
  }
  log.info(`Login başarılı: ${url}`);
}

async function fetchAccountPlan(page, mukellefAdi) {
  log.info(`Hesap planı çekiliyor: ${mukellefAdi}`);
  // NOT: Luca'da hesap planı menüsü mali müşavirin tıkladığı yerle aynı —
  // gerçek selector'lar ilk çalıştırmada keşfedilecek. Bu placeholder.
  // Şu an için generic akış:
  // 1. Mükellef seç (search bar veya dropdown)
  // 2. Tanımlamalar > Hesap Planı menüsüne git
  // 3. Excel'e Aktar butonuna bas → download event yakala

  // Mükellef arama
  const searchSelector = 'input[placeholder*="ara" i], input[name*="search" i], input.mukellef-search';
  const searchInput = await page.$(searchSelector);
  if (searchInput) {
    await searchInput.fill(mukellefAdi);
    await page.waitForTimeout(800);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  } else {
    log.warn('Mükellef arama input\'u bulunamadı — manuel keşif gerekli');
  }

  // Hesap planı menüsüne git
  // Bu placeholder — gerçek menü path'i Luca arayüzünden alınacak
  const accountPlanUrl = process.env.LUCA_ACCOUNT_PLAN_URL || null;
  if (accountPlanUrl) {
    await page.goto(accountPlanUrl, { waitUntil: 'networkidle' });
  } else {
    // Menüden gitmeye çalış: Tanımlamalar > Hesap Planı
    await page.click('a:has-text("Tanımlamalar"), button:has-text("Tanımlamalar"), [aria-label*="Tanımlama" i]').catch(() => {});
    await page.waitForTimeout(500);
    await page.click('a:has-text("Hesap Planı"), button:has-text("Hesap Planı")').catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  }

  // Excel indir
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.click('button:has-text("Excel"), button:has-text("Aktar"), a:has-text("Excel"), [aria-label*="Excel" i], [title*="Excel" i]'),
  ]);

  // Buffer'a oku
  const stream = await download.createReadStream();
  return await new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// --------- Job processor ---------
// Aynı mükellef hızlı yol — son seçilen firma cache TTL (varsayılan 5dk).
// Agent.lastTaxpayer ve job geldiğinde TTL içindeyse Luca'da firma seçim
// adımı atlanabilir (Moren Runtime hint olarak okuyacak: meta.fastPath).
const TAXPAYER_FASTPATH_TTL = (cfg.worker?.taxpayerFastPathTtlSeconds || 5 * 60) * 1000;

async function processJob(job) {
  const jobId = job.id;
  const tip = job.tip || job.type;
  const mukellefId = job.mukellefId;
  const mukellefAdi = job.mukellefAdi || job.taxpayer?.companyName || job.taxpayer?.name || '';
  const donem = job.donem || '';

  // Aynı mükellef hızlı yol kontrolü
  const session = browserSession; // null olabilir (henüz açılmamış)
  const last = session?.lastTaxpayer;
  const sameTaxpayer = !!(last && last.taxpayerId === mukellefId);
  const withinTtl = !!(last && (Date.now() - last.selectedAt) < TAXPAYER_FASTPATH_TTL);
  if (sameTaxpayer && withinTtl) {
    job.meta = { ...(job.meta || {}), fastPath: true, lastTaxpayerSelectedAt: last.selectedAt };
    log.info(`⚡ Hızlı yol: aynı mükellef (${mukellefAdi}), son seçim ${Math.round((Date.now() - last.selectedAt)/1000)}sn önce — firma seçim atlanabilir`);
  }

  log.info(`İşleniyor: ${tip} · ${mukellefAdi} · jobId=${jobId.slice(0, 8)}${job.meta?.fastPath ? ' [FASTPATH]' : ''}`);

  if (!JOB_TYPES.has(tip)) {
    log.warn(`Bu agent ${tip} tipini desteklemiyor, atlanıyor.`);
    return;
  }

  await pingAgentStatus(true, { activeJobId: jobId, activeJobType: tip });

  try {
    await runJobWithMorenRuntime(job);
    // Aynı mükellef hızlı yol cache güncelle — bir sonraki aynı mükellef
    // job'unda fastPath ipucu verilir.
    if (browserSession && mukellefId) {
      browserSession.lastTaxpayer = {
        taxpayerId: mukellefId,
        selectedAt: Date.now(),
      };
    }
    log.info(`OK ${tip} tamamlandi/kapandi: jobId=${jobId.slice(0, 8)}`);
    return;
    await withBrowser(async (page) => {
      await loginToLuca(page);

      if (tip === 'ACCOUNT_PLAN') {
        const buffer = await fetchAccountPlan(page, mukellefAdi);
        log.info(`Hesap planı indirildi (${buffer.byteLength} byte), yükleniyor...`);
        const result = await uploadAccountPlan(buffer, mukellefId, jobId);
        log.info(`Hesap planı yüklendi: ${JSON.stringify(result)}`);
      } else {
        log.warn(`${tip} tipi için scraper implementasyonu eksik (placeholder)`);
        throw new Error(`${tip} henüz implement edilmedi`);
      }
    });

    log.info(`✓ ${tip} tamamlandı: jobId=${jobId.slice(0, 8)}`);
  } catch (err) {
    log.error(`✗ ${tip} hatası: ${err.message}`);
    await markJobFailed(jobId, err.message);
  }
}

// --------- Ana döngü ---------
let stopped = false;

async function mainLoop() {
  log.info(`Luca Local Agent başladı.`);
  log.info(`API: ${cfg.api.baseUrl}`);
  log.info(`Polling: her ${POLL_INTERVAL / 1000} saniyede bir`);
  log.info(`Job tipleri: ${[...JOB_TYPES].join(', ')}`);
  log.info(`Headless: ${HEADLESS}`);
  log.info(`Device: ${DEVICE_ID} (${WORKER_NAME})`);

  while (!stopped) {
    try {
      await pingAgentStatus(true);
      const jobs = await pollPendingJobs();
      const filtered = jobs.filter((j) => JOB_TYPES.has(j.tip || j.type));
      if (filtered.length) {
        log.info(`${filtered.length} bekleyen job bulundu.`);
        for (const job of filtered) {
          if (stopped) break;
          await processJob(job);
        }
      } else {
        log.debug('Bekleyen job yok.');
      }
    } catch (err) {
      log.error(`Loop hatası: ${err.message}`);
    }

    if (!stopped) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
  }

  log.info('Agent durduruldu.');
}

// Graceful shutdown
process.on('SIGINT', () => {
  log.info('SIGINT alındı, durduruluyor...');
  stopped = true;
  pingAgentStatus(false).catch(() => {});
});
process.on('SIGTERM', () => {
  log.info('SIGTERM alındı, durduruluyor...');
  stopped = true;
  pingAgentStatus(false).catch(() => {});
});

mainLoop().catch((err) => {
  log.error(`Fatal: ${err.message}`);
  process.exit(1);
});
