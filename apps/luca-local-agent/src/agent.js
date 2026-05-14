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
const LOCAL_AGENT_VERSION = 'local-1.0.6';
const JOB_TIMEOUT = (cfg.worker?.jobTimeoutSeconds || 15 * 60) * 1000;
// v1.36.X: idle TTL 20dk → 2 saat. Mali müşavir ofisi tüm gün açık;
// her tıklamada login için 10-20sn kayıp anlamsız. 2 saat hareketsizlik
// sonrası Luca cookie zaten düşmüş olur, kapatma doğru.
const BROWSER_IDLE_TTL = (cfg.worker?.browserIdleTtlSeconds || 2 * 60 * 60) * 1000;
// Keep-alive ping aralığı: idle TTL'in 1/4'ü. Browser session açıkken
// arka planda hafif bir sayfa içi navigasyon yaparak Luca cookie'sinin
// sunucu tarafında sıfırlanmasını engelleriz.
const configuredKeepAliveSeconds = Number(cfg.worker?.browserKeepAliveSeconds || 0);
const BROWSER_KEEPALIVE_INTERVAL = configuredKeepAliveSeconds > 0
  ? configuredKeepAliveSeconds * 1000
  : Math.max(60_000, Math.min(10 * 60 * 1000, BROWSER_IDLE_TTL / 4));
const nativeBridgePages = new WeakSet();

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
  let lastPollError = '';
  let pollErrorCount = 0;
  while (Date.now() - started < timeoutMs) {
    let data = null;
    try {
      const res = await api.get(`/agent/luca/jobs/${jobId}/status`);
      data = res.data;
      pollErrorCount = 0;
      lastPollError = '';
    } catch (err) {
      pollErrorCount++;
      lastPollError = err?.message || String(err);
      if (pollErrorCount === 1 || pollErrorCount % 10 === 0) {
        log.warn(`Job status poll gecici hata (${jobId.slice(0, 8)}): ${lastPollError}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    const status = data?.status || '';
    if (status && status !== lastStatus) {
      log.info(`Job durum: ${jobId.slice(0, 8)} -> ${status}`);
      lastStatus = status;
    }
    if (['done', 'failed', 'cancelled'].includes(status)) return data;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Job zaman aşımı: ${Math.round(timeoutMs / 1000)}sn${lastPollError ? ` (son poll hata: ${lastPollError})` : ''}`);
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
  main: process.env.LUCA_MAIN_URL || 'https://agiris.luca.com.tr/LUCASSO/main.erp',
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

async function loadMorenRuntimeCode() {
  const localRuntimePath = path.resolve(__dirname, '..', '..', 'api', 'public', 'agent-runtime.js');
  if (cfg.worker?.preferLocalRuntime !== false && fs.existsSync(localRuntimePath)) {
    log.info(`Local agent-runtime.js kullaniliyor: ${localRuntimePath}`);
    return fs.readFileSync(localRuntimePath, 'utf8');
  }
  const runtimeBaseUrl = cfg.api.runtimeUrl || `${cfg.api.baseUrl}/agent/runtime.js`;
  const runtimeUrl = `${runtimeBaseUrl}${runtimeBaseUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
  const runtimeResponse = await axios.get(runtimeUrl, { timeout: 30_000 });
  return String(runtimeResponse.data || '');
}

function extractMorenRuntimeVersion(runtimeCode) {
  const m = String(runtimeCode || '').match(/AGENT_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')
    .replace(/\u0130/g, 'i')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('tr-TR');
}

async function nativeClickText(page, payload = {}) {
  const text = String(payload?.text || '').trim();
  if (!text) return { ok: false, reason: 'text boş' };
  const exact = !!payload?.exact;
  const hoverOnly = !!payload?.hoverOnly;
  const timeoutMs = Number(payload?.timeoutMs || 8000);
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  const target = normalizeText(text);

  const findInFrame = async (frame, allowHidden = false) => {
    const handle = await frame.evaluateHandle(
      ({ target, exact, allowHidden }) => {
        const norm = (s) => String(s || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\u0131/g, 'i')
          .replace(/\u0130/g, 'i')
          .replace(/\s+/g, ' ')
          .trim()
          .toLocaleLowerCase('tr-TR');
        const isActionable = (node, includeCursor = false) => {
          if (!node) return false;
          const tag = String(node.tagName || '').toUpperCase();
          const style = String(node.getAttribute?.('style') || '').toLowerCase();
          return tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' ||
            !!node.getAttribute?.('onclick') || !!node.getAttribute?.('href') ||
            node.getAttribute?.('role') === 'button' || (includeCursor && style.includes('cursor'));
        };
        const clickable = (el) => {
          try {
            const child = el.querySelector?.('a[href],a[onclick],[onclick],[href],[role="button"],button,input[type="button"],input[type="submit"]');
            if (child) return child;
          } catch {}
          let cur = el;
          for (let i = 0; i < 6 && cur; i++, cur = cur.parentElement) {
            if (isActionable(cur, i > 2)) return cur;
          }
          return el;
        };
        const visible = (el) => {
          try {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
          } catch {
            return true;
          }
        };
        const candidates = [];
        for (const el of document.querySelectorAll('*')) {
          const tag = String(el.tagName || '').toUpperCase();
          if (/^(HTML|HEAD|BODY|SCRIPT|STYLE|META|LINK|TITLE)$/.test(tag)) continue;
          if (!allowHidden && !visible(el)) continue;
          const own = norm(el.textContent || el.value || el.getAttribute?.('title') || '');
          if (!own) continue;
          if (!exact && own.length > target.length * 5 + 20) continue;
          const ok = exact ? own === target : (own === target || own.includes(target));
          if (!ok) continue;
          const score = (el.children?.length ? 0 : 10) + (isActionable(el, true) ? 5 : 0) - Math.max(0, own.length - target.length);
          candidates.push({ el, score });
        }
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0]?.el ? clickable(candidates[0].el) : null;
      },
      { target, exact, allowHidden },
    ).catch(() => null);
    const element = handle?.asElement?.();
    if (!element) {
      await handle?.dispose?.().catch(() => {});
      return null;
    }
    return { element, handle };
  };

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const allowHidden of [false, true]) {
        const found = await findInFrame(frame, allowHidden);
        if (!found) continue;
        const { element, handle } = found;
        try {
          await element.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
          await element.hover({ timeout: 2500, force: allowHidden }).catch(() => {});
          if (!hoverOnly) {
            await element.click({ timeout: 3000, force: allowHidden }).catch(async () => {
              await element.dispatchEvent('click').catch(() => {});
            });
          }
          await handle.dispose().catch(() => {});
          return { ok: true, text, frame: frame.name() || frame.url().slice(0, 80), allowHidden, hoverOnly };
        } catch (e) {
          await handle.dispose().catch(() => {});
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { ok: false, reason: `"${text}" bulunamadı`, text };
}

async function installNativeClickBridge(page) {
  if (nativeBridgePages.has(page)) return;
  nativeBridgePages.add(page);
  await page.exposeBinding('__morenNativeClickText', async (_source, payload) => {
    return nativeClickText(page, payload);
  }).catch((e) => {
    if (!/has been already registered|already registered/i.test(String(e?.message || e))) {
      throw e;
    }
  });
}

async function installMorenRuntimeBridge(context, page) {
  const runtimeCode = await loadMorenRuntimeCode();
  const runtimeVersion = extractMorenRuntimeVersion(runtimeCode);
  if (
    browserSession?.context === context &&
    browserSession.runtimeInstalled &&
    browserSession.runtimeVersion === runtimeVersion
  ) {
    return browserSession.runtimeVersion || null;
  }
  await installNativeClickBridge(page);
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
  await page.evaluate(bridgeScript, bridgeArg).catch(() => {});
  await page.addScriptTag({ content: runtimeCode }).catch(async () => {
    await page.evaluate((code) => {
      const script = document.createElement('script');
      script.textContent = code;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    }, runtimeCode).catch(() => {});
  });
  if (browserSession?.context === context) {
    browserSession.runtimeInstalled = true;
    browserSession.runtimeVersion = runtimeVersion;
  }
  return runtimeVersion;
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
      const msg = dialog.message();
      log.warn(`Browser dialog: ${msg}`);
      await logJob(jobId, `Luca dialog uyarisi: ${msg}`).catch(() => {});
      await dialog.dismiss().catch(() => {});
    });

    const expectedRuntimeVersion = await installMorenRuntimeBridge(context, page);
    await logJob(jobId, `Local Node ajan işi aldı: ${WORKER_NAME} (${DEVICE_ID})`);
    let currentUrl = page.url();
    if (/^https:\/\/agiris\.luca\.com\.tr\/LUCASSO\/giris\.erp/i.test(currentUrl || '')) {
      await logJob(jobId, 'Luca login sayfasi acik; once kayitli oturum main.erp ile kontrol ediliyor.');
      await page.goto(LUCA_URLS.main, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(4500).catch(() => {});
      currentUrl = page.url();
    }
    if (/^https:\/\/auygs\.luca\.com\.tr\/Luca\/giris\.do/i.test(currentUrl || '')) {
      await logJob(jobId, 'Klasik Luca giris.do bos gorundu; arka plan oturumu SSO main.erp uzerinden toparlaniyor.');
      await page.goto(LUCA_URLS.main, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(4500).catch(() => {});
      currentUrl = page.url();
    }
    const isLucaLoginPage = /^https:\/\/agiris\.luca\.com\.tr\/LUCASSO\/giris\.erp/i.test(currentUrl || '');
    const isLucaPage = /^https:\/\/(agiris|auygs)\.luca\.com\.tr\//i.test(currentUrl || '');
    if (isLucaPage) {
      // Mevcut sayfada runtime YÜKLÜ MÜ kontrol et. Persistent context'te
      // sayfa eski page load'undan kalmış olabilir ve init script o load'a
      // yetişmemiş olabilir — bu durumda job tetiklenmez ve pending'de kalır.
      // Runtime kendini window.__morenAgent global'ine kaydeder (agent-runtime.js).
      // Bu yoksa init script bu sayfaya yetişmemiştir → reload gerekli.
      const hasRuntime = await page
        .evaluate(() => typeof window.__morenAgent !== 'undefined' && !!window.__morenAgent.running)
        .catch(() => false);
      const pageRuntimeVersion = await page
        .evaluate(() => window.__morenAgent?.version || null)
        .catch(() => null);
      if (!hasRuntime || (expectedRuntimeVersion && pageRuntimeVersion && pageRuntimeVersion !== expectedRuntimeVersion)) {
        const reloadReason = !hasRuntime
          ? 'runtime yok'
          : `runtime versiyonu eski (${pageRuntimeVersion} -> ${expectedRuntimeVersion})`;
        await logJob(jobId, `Mevcut Luca sayfasinda ${reloadReason} - reload ediliyor.`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      } else if (isLucaLoginPage) {
        await logJob(jobId, 'Luca login sayfasi acik; otomatik giris denenecek, gerekirse guvenlik kodu istenecek.');
      } else {
        await logJob(jobId, `Mevcut arka plan Luca oturumu kullanılacak: ${currentUrl.slice(0, 90)}`);
      }
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

/**
 * Pre-warm — agent başladığında veya sabah erken saatlerde browser'ı
 * önceden aç, Luca'ya login ol, kullanıcı butona bastığında hazır olsun.
 * İlk tıklama 25sn yerine 5sn'ye düşer.
 *
 * Hata olursa sessizce geç — bu yardımcı bir adım, asıl iş polling.
 */
async function preWarmBrowserSession() {
  try {
    log.info('⚡ Pre-warm: browser açılıyor, Luca login deneniyor...');
    const session = await getBrowserSession();
    const page = session.page;
    if (page && !page.isClosed()) {
      // ÖNEMLİ: addInitScript yalnızca SONRAKİ page load'unda çalışır.
      // O yüzden runtime'ı ÖNCE kur, navigate'i SONRA yap — yoksa Luca
      // sayfası runtime'sız yüklenir ve job'lar pending'de kalır.
      await installMorenRuntimeBridge(session.context, page).catch(() => {});
      const currentUrl = page.url();
      if (!/luca\.com\.tr/i.test(currentUrl)) {
        await page.goto(LUCA_URLS.login, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      } else {
        // Zaten Luca sayfasındaysa reload et ki yeni eklenen init script çalışsın.
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      }
      log.info(`✓ Pre-warm tamamlandı (url: ${page.url().slice(0, 80)})`);
    }
  } catch (err) {
    log.warn(`Pre-warm başarısız (önemsiz, gerçek iş geldiğinde tekrar denenecek): ${err.message}`);
  }
}

// Sabah pre-warm cron — agent çalışıyorken her gün 08:00'de uyanır.
// Mali müşavir ofisi 09:00'da açılır; 08:00'de hazırlık tamamlanmış olur.
const PRE_WARM_HOUR = Number(cfg.worker?.preWarmHour ?? 8); // 0-23
let preWarmTimer = null;

function schedulePreWarm() {
  if (preWarmTimer) clearTimeout(preWarmTimer);
  const now = new Date();
  const next = new Date(now);
  next.setHours(PRE_WARM_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delayMs = next.getTime() - now.getTime();
  log.info(`Pre-warm planlandı: ${next.toLocaleString('tr-TR')} (${Math.round(delayMs / 60000)}dk sonra)`);
  preWarmTimer = setTimeout(async () => {
    await preWarmBrowserSession();
    schedulePreWarm(); // Bir sonraki gün için tekrar
  }, delayMs);
}

async function mainLoop() {
  log.info(`Luca Local Agent başladı.`);
  log.info(`API: ${cfg.api.baseUrl}`);
  log.info(`Polling: her ${POLL_INTERVAL / 1000} saniyede bir`);
  log.info(`Job tipleri: ${[...JOB_TYPES].join(', ')}`);
  log.info(`Headless: ${HEADLESS}`);
  log.info(`Device: ${DEVICE_ID} (${WORKER_NAME})`);
  log.info(`Idle TTL: ${Math.round(BROWSER_IDLE_TTL/60000)}dk · Keep-alive: ${Math.round(BROWSER_KEEPALIVE_INTERVAL/60000)}dk`);

  // Agent başlangıcında ilk pre-warm — kullanıcı bilgisayar açar açmaz hazır
  preWarmBrowserSession().catch(() => {});
  // Her sabah PRE_WARM_HOUR'de tekrar
  schedulePreWarm();

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
