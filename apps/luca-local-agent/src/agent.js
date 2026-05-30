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
const net = require('net');
const { spawn } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const { chromium } = require('playwright');

// Scheduled Task node'u direkt calistirdigi icin .env otomatik yuklenmez.
// 2captcha gibi yerel anahtarlar bu dosyadan okunur.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// --------- Konfigürasyon yükleme ---------
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const DEVICE_ID_PATH = path.join(__dirname, '..', '.device-id');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('HATA: config.json bulunamadı. config.example.json dosyasını config.json olarak kopyalayıp doldurun.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));

const PORTAL_WORKER = (() => {
  const raw = process.env.MOREN_LUCA_WORKER_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.uyeNo || !parsed?.username || !parsed?.password) return null;
    return parsed;
  } catch {
    return null;
  }
})();

if (PORTAL_WORKER) {
  cfg.luca = {
    uyeNo: PORTAL_WORKER.uyeNo,
    username: PORTAL_WORKER.username,
    password: PORTAL_WORKER.password,
  };
  cfg.worker = {
    ...(cfg.worker || {}),
    workerName: PORTAL_WORKER.displayName || PORTAL_WORKER.username || cfg.worker?.workerName,
  };
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .toLowerCase() || 'worker';
}

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
const BASE_DEVICE_ID = getOrCreateDeviceId();
const WORKER_SLOT_ID = PORTAL_WORKER
  ? slugify(PORTAL_WORKER.id || PORTAL_WORKER.username || PORTAL_WORKER.displayName)
  : '';
const DEVICE_ID = PORTAL_WORKER
  ? (PORTAL_WORKER.deviceId || `${BASE_DEVICE_ID}-${WORKER_SLOT_ID}`)
  : BASE_DEVICE_ID;
const WORKER_NAME = PORTAL_WORKER?.displayName || cfg.worker?.workerName || os.hostname();
const WORKER_POOL_INDEX = Math.max(0, Number(PORTAL_WORKER?.slotIndex || 0));
const WORKER_POOL_SIZE = Math.max(1, Number(PORTAL_WORKER?.poolSize || 1));
const SINGLE_INSTANCE_LOCK_PATH = path.join(__dirname, '..', '.agent.lock');
let singleInstanceLockAcquired = false;

if (!cfg.api?.baseUrl || !cfg.api?.agentToken) {
  console.error('HATA: config.json içinde api.baseUrl ve api.agentToken zorunlu.');
  process.exit(1);
}
if ((!cfg.luca?.uyeNo || !cfg.luca?.username || !cfg.luca?.password) && (PORTAL_WORKER || cfg.worker?.usePortalAccounts !== true)) {
  console.error('HATA: config.json içinde luca.uyeNo, luca.username, luca.password zorunlu.');
  process.exit(1);
}

const POLL_INTERVAL = (cfg.worker?.pollIntervalSeconds || 30) * 1000;
const BROWSER_TIMEOUT = (cfg.worker?.browserTimeoutSeconds || 120) * 1000;
const HEADLESS = cfg.worker?.headless !== false;
const SUPPORTED_JOB_TYPES = Object.freeze([
  'ACCOUNT_PLAN',
  'MIZAN',
  'KDV_MIZAN',
  'KDV_191',
  'KDV_391',
  'ISLETME_GELIR',
  'ISLETME_GIDER',
  'IHO_FETCH',
  'EDEFTER_FIS_LISTESI',
  'EARSIV_SATIS',
  'EARSIV_ALIS',
  'EFATURA_SATIS',
  'EFATURA_ALIS',
  // v1.38: Fatura Isleme Merkezi -> Luca'ya muhasebe fisi aktarimi
  // Service tarafinda approve() metodu bu tipte LucaFetchJob yaratir.
  // Scraper agent-runtime.js icinde postInvoiceVoucher() ile implement.
  'INVOICE_POST',
]);
const LEGACY_DEFAULT_JOB_TYPES = Object.freeze(['ACCOUNT_PLAN', 'MIZAN', 'KDV_MIZAN', 'MUAVIN']);

function normalizeJobTypeConfig(rawJobTypes) {
  const raw = Array.isArray(rawJobTypes)
    ? rawJobTypes.map((t) => String(t || '').trim()).filter(Boolean)
    : [];
  const supported = new Set(SUPPORTED_JOB_TYPES);
  const accepted = raw.filter((t) => supported.has(t));
  const unknown = raw.filter((t) => !supported.has(t));
  const strict = cfg.worker?.strictJobTypes === true;
  const legacyDefaultConfig =
    raw.length === LEGACY_DEFAULT_JOB_TYPES.length &&
    LEGACY_DEFAULT_JOB_TYPES.every((t) => raw.includes(t));

  if (raw.length === 0 || (!strict && legacyDefaultConfig)) {
    return {
      jobTypes: [...SUPPORTED_JOB_TYPES],
      upgradedFromLegacy: legacyDefaultConfig,
      unknown,
    };
  }

  return {
    jobTypes: accepted.length ? accepted : [...SUPPORTED_JOB_TYPES],
    upgradedFromLegacy: false,
    unknown,
  };
}

const JOB_TYPE_CONFIG = normalizeJobTypeConfig(cfg.worker?.jobTypes);
const JOB_TYPES = new Set(JOB_TYPE_CONFIG.jobTypes);
const LOG_LEVEL = cfg.log?.level || 'info';
const LOCAL_AGENT_VERSION = 'local-1.1.8';
function readBundledRuntimeVersion() {
  try {
    const runtimePath = path.resolve(__dirname, '..', '..', 'api', 'public', 'agent-runtime.js');
    if (!fs.existsSync(runtimePath)) return null;
    const code = fs.readFileSync(runtimePath, 'utf8').slice(0, 5000);
    const m = code.match(/AGENT_VERSION\s*=\s*['"`]([^'"`]+)['"`]/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
const BUNDLED_RUNTIME_VERSION = readBundledRuntimeVersion();
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

function isProcessAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function acquireSingleInstanceLock() {
  if (PORTAL_WORKER) return;

  const payload = JSON.stringify({
    pid: process.pid,
    deviceId: DEVICE_ID,
    startedAt: new Date().toISOString(),
  }, null, 2);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(SINGLE_INSTANCE_LOCK_PATH, 'wx');
      fs.writeFileSync(fd, payload, 'utf8');
      fs.closeSync(fd);
      singleInstanceLockAcquired = true;
      return;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      let existing = null;
      try {
        existing = JSON.parse(fs.readFileSync(SINGLE_INSTANCE_LOCK_PATH, 'utf8'));
      } catch {}
      if (isProcessAlive(existing?.pid)) {
        console.error(`[${new Date().toISOString()}] ERROR Luca Local Agent zaten calisiyor (pid=${existing.pid}). Yeni instance kapatildi.`);
        process.exit(0);
      }
      try { fs.unlinkSync(SINGLE_INSTANCE_LOCK_PATH); } catch {}
    }
  }

  throw new Error('Luca Local Agent lock dosyasi alinamadi');
}

function releaseSingleInstanceLock() {
  if (!singleInstanceLockAcquired) return;
  try {
    const existing = JSON.parse(fs.readFileSync(SINGLE_INSTANCE_LOCK_PATH, 'utf8'));
    if (Number(existing?.pid) === process.pid) {
      fs.unlinkSync(SINGLE_INSTANCE_LOCK_PATH);
    }
  } catch {}
}

process.on('exit', releaseSingleInstanceLock);

if (JOB_TYPE_CONFIG.upgradedFromLegacy) {
  log.warn('worker.jobTypes eski varsayilan listeden otomatik genisletildi; tum Luca veri cekme modulleri aktif.');
}
if (JOB_TYPE_CONFIG.unknown.length) {
  log.warn(`worker.jobTypes icinde desteklenmeyen tipler yok sayildi: ${JOB_TYPE_CONFIG.unknown.join(', ')}`);
}

// --------- API client ---------
const api = axios.create({
  baseURL: cfg.api.baseUrl,
  headers: { 'x-agent-token': cfg.api.agentToken },
  timeout: 30_000,
});

async function pollPendingJobs() {
  try {
    const { data } = await api.get('/agent/luca/jobs/pending', {
      params: {
        deviceId: DEVICE_ID,
        version: getCurrentRuntimeVersionForApi(),
        agentVersion: getCurrentRuntimeVersionForApi(),
      },
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
    const { data } = await api.post(`/agent/luca/jobs/${jobId}/start`, {
      deviceId: DEVICE_ID,
      version: getCurrentRuntimeVersionForApi(),
      agentVersion: getCurrentRuntimeVersionForApi(),
    });
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

async function requeueJob(jobId, reason) {
  try {
    await api.post(`/agent/luca/jobs/${jobId}/requeue`, { reason });
  } catch (err) {
    log.warn(`Job requeue mark hatasi: ${err.message}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// v1.38: postInvoiceVoucher — INVOICE_POST job islerken cagrilir.
//
// Iki payload format desteklenir:
//   A) mode='BATCH_EXCEL'  → Backend Excel uretti, agent endpoint'ten alir ve
//      Luca'nin "Toplu Fis Aktarim" ekrani araciligiyla yukler.
//   B) tek belge (legacy)  → Eski format, placeholder olarak fail.
//
// Su an Luca'da Toplu Aktarim ekranina UI navigation henuz yazilmadi — bu
// turda sadece Excel'in indirilebildiginin sinama placeholder'i olarak calisir.
// Gercek implementasyon: agent-runtime.js'e "loadExcelToLucaToplu Aktarim()"
// fonksiyonu eklendiginde devreye girer.
// ---------------------------------------------------------------------------
async function postInvoiceVoucher(job) {
  const jobId = job.id || job.jobId;
  const payload = job.payload || {};
  const mode = payload.mode || 'SINGLE';

  if (mode === 'BATCH_EXCEL') {
    const totalCount = payload.totalCount || (payload.invoices || []).length;
    const period = payload.period || '-';
    log.info(`INVOICE_POST BATCH_EXCEL: ${totalCount} fatura, donem=${period}, jobId=${jobId.slice(0, 8)}`);

    // 1) Backend'ten Excel dosyasini indir (BUFFER)
    try {
      const r = await api.get(`/agent/luca/jobs/${jobId}/invoice-excel`, {
        responseType: 'arraybuffer',
        headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      });
      const sizeKb = Math.round((r.data?.byteLength || r.data?.length || 0) / 1024);
      log.info(`Luca aktarim Excel'i alindi: ${sizeKb} KB`);
      await logJob(jobId, `Excel uretildi (${sizeKb} KB), Luca'ya yukleme bekleniyor.`).catch(() => {});

      // Excel'i diske kaydet — debug + manuel yukleme icin
      const tmpDir = path.join(__dirname, '..', 'tmp-invoice-exports');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const filePath = path.join(tmpDir, `luca-fis-${jobId.slice(0, 8)}-${period}.xlsx`);
      fs.writeFileSync(filePath, Buffer.from(r.data));
      log.info(`Excel kaydedildi: ${filePath}`);
      await logJob(jobId, `Excel dosyasi: ${filePath}`).catch(() => {});
    } catch (err) {
      log.error(`Excel uretilemedi: ${err.message}`);
      await markJobFailed(jobId, `Backend Excel uretmedi: ${err.message}`);
      return;
    }

    // 2) Luca'da "Toplu Fis Aktarim" ekranina yukle — HENUZ HAZIR DEGIL
    //    Su an placeholder: agent Excel'i indirdigini ve diskte kaydettigini
    //    rapor eder, ama Luca'ya yuklemez. Kullanici manuel olarak
    //    tmp-invoice-exports/ klasorunden Excel'i alip Luca'ya yukleyebilir.
    await markJobFailed(
      jobId,
      `INVOICE_POST_EXCEL_HAZIR: ${totalCount} faturalik Excel uretildi ama Luca'ya otomatik yukleme henuz hazir degil. ` +
      `Dosya agent klasorunde tmp-invoice-exports/ altinda. Kullanici manuel yukleyebilir.`
    );
    return;
  }

  // Eski single-invoice format (artik kullanilmamali — backend BATCH_EXCEL'e gecti)
  const documentId = payload.documentId || '?';
  log.info(`INVOICE_POST single (legacy) doc=${documentId.slice(0, 8)} — fail`);
  await markJobFailed(
    jobId,
    'INVOICE_POST_LEGACY_SINGLE: Tek belge per-job format artik desteklenmiyor. ' +
    'Backend BATCH_EXCEL\'e gecti, lutfen yeni "Luca\'ya Aktar" toplu butonunu kullanin.'
  );
}

function isTransientLucaConnectivityError(err) {
  const text = String(err?.message || err || '');
  return /(ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ERR_TUNNEL_CONNECTION_FAILED|Navigation timeout|page\.goto: Timeout|Timeout .* exceeded|The operation has timed out)/i.test(text)
    && /(luca\.com\.tr|agiris|auygs|LUCASSO)/i.test(text);
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} ${Math.round(timeoutMs / 1000)}sn icinde bitmedi`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function checkTcp(host, port = 443, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function assertLucaConnectivity(jobId) {
  const targets = ['agiris.luca.com.tr', 'auygs.luca.com.tr'];
  const results = await Promise.all(targets.map(async (host) => ({
    host,
    ok: await checkTcp(host),
  })));
  if (results.some((r) => r.ok)) return;

  const summary = results.map((r) => `${r.host}=kapali`).join(', ');
  const msg = `Luca baglantisi kapali (${summary}). Cloudflare WARP/VPN/firewall Luca erisimini kesiyor olabilir; WARP kapatilip tekrar denenmeli.`;
  log.warn(msg);
  if (jobId) await logJob(jobId, msg).catch(() => {});
  throw new Error(`LUCA_NETWORK_BLOCKED: ${msg}`);
}

async function pingAgentStatus(running = true, extraMeta = {}) {
  try {
    const runtimeVersion = getCurrentRuntimeVersionForApi();
    await api.post('/agent/status/ping', {
      agent: 'luca',
      running,
      meta: {
        deviceId: DEVICE_ID,
        workerName: WORKER_NAME,
        version: runtimeVersion,
        localAgentVersion: LOCAL_AGENT_VERSION,
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
  let lastJobLog = null;
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
    const jobLog = String(data?.errorMsg || '');
    const newJobLog =
      lastJobLog === null
        ? ''
        : jobLog.startsWith(lastJobLog)
          ? jobLog.slice(lastJobLog.length)
          : jobLog === lastJobLog
            ? ''
            : jobLog;
    lastJobLog = jobLog;
    if (/TRANSIENT_LUCA_(CLASSIC_(FRAME_STUCK_RESET|GIRIS_DO_BLANK)|FIRMA_OR_FRAME_STUCK_RESET|FIRMA_CHANGE_STUCK_RESET)/i.test(newJobLog)) {
      throw new Error('TRANSIENT_LUCA_RELOAD_STUCK: Klasik Luca firma/frame akisi takildi; browser oturumu resetlenecek');
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
const LUCA_CLASSIC_ENTRY = process.env.LUCA_CLASSIC_URL || 'https://auygs.luca.com.tr/Luca/luca.do';

let browserSession = null;
let activeJobCount = 0;
let preWarmPromise = null;

function getCurrentRuntimeVersionForApi() {
  return browserSession?.runtimeVersion || BUNDLED_RUNTIME_VERSION || LOCAL_AGENT_VERSION;
}

function getBrowserUserDataDir() {
  return path.join(
    __dirname,
    '..',
    PORTAL_WORKER ? `.browser-data-${WORKER_SLOT_ID}` : '.browser-data',
  );
}

async function gotoLucaWithFallback(page, primaryUrl, jobId, label = 'giris') {
  try {
    await page.goto(primaryUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    return primaryUrl;
  } catch (err) {
    if (!LUCA_CLASSIC_ENTRY || LUCA_CLASSIC_ENTRY === primaryUrl) throw err;
    const msg = `${label} acilamadi (${err.message}); klasik Luca URL deneniyor.`;
    log.warn(msg);
    if (jobId) await logJob(jobId, msg).catch(() => {});
    try {
      await page.goto(LUCA_CLASSIC_ENTRY, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      return LUCA_CLASSIC_ENTRY;
    } catch (fallbackErr) {
      throw new Error(`${label} acilamadi: ${err.message}; klasik Luca URL de acilamadi: ${fallbackErr.message}`);
    }
  }
}

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

function rotateBrowserProfile(reason = 'runtime-recovery') {
  const userDataDir = getBrowserUserDataDir();
  if (!fs.existsSync(userDataDir)) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = `${userDataDir}.reset-${stamp}`;
  try {
    fs.renameSync(userDataDir, backupDir);
    log.warn(`Luca browser profili yenilendi (${reason}); eski profil kenara alindi: ${backupDir}`);
  } catch (err) {
    log.warn(`Luca browser profili yenilenemedi (${reason}): ${err.message}`);
  }
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
  const userDataDir = getBrowserUserDataDir();
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
  const contextRuntimeAlreadyInstalled = (
    browserSession?.context === context &&
    browserSession.runtimeInstalled &&
    browserSession.runtimeVersion === runtimeVersion
  );
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
  if (!contextRuntimeAlreadyInstalled) {
    await context.addInitScript(bridgeScript, bridgeArg);
    await context.addInitScript({ content: runtimeCode });
  }
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
  const currentPageRuntimeVersion = await page
    .evaluate(() => window.__morenAgent?.version || null)
    .catch(() => null);
  if (currentPageRuntimeVersion !== runtimeVersion) {
    await page.addScriptTag({ content: runtimeCode }).catch(async () => {
      await page.evaluate((code) => {
        const script = document.createElement('script');
        script.textContent = code;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
      }, runtimeCode).catch(() => {});
    });
  }
  if (browserSession?.context === context) {
    browserSession.runtimeInstalled = true;
    browserSession.runtimeVersion = runtimeVersion;
  }
  return runtimeVersion;
}

async function runJobWithMorenRuntime(job) {
  const jobId = job.id;
  await assertLucaConnectivity(jobId);
  await withBrowser(async (page, context) => {
    page.on('console', (msg) => {
      const text = msg.text();
      if (LOG_LEVEL === 'debug' || /Moren|Luca|captcha|hata|error/i.test(text)) {
        log.debug(`[browser:${msg.type()}] ${text}`);
      }
    });
    page.on('pageerror', (err) => log.warn(`Browser pageerror: ${err.message}`));
    page.on('dialog', async (dialog) => {
      const msg = String(dialog.message() || '').trim();
      if (msg) {
        log.warn(`Luca dialog kapatildi: ${msg}`);
        await logJob(jobId, `Luca uyarı penceresi kapatıldı: ${msg}`).catch(() => {});
      } else {
        log.debug('Bos Luca dialog kapatildi.');
      }
      await dialog.dismiss().catch(() => {});
    });

    const expectedRuntimeVersion = await installMorenRuntimeBridge(context, page);
    await logJob(
      jobId,
      `Local Node ajan işi aldı: ${WORKER_NAME} (${DEVICE_ID}) · runtime=${expectedRuntimeVersion || 'bilinmiyor'}`,
    );
    let currentUrl = page.url();
    if (/^https:\/\/agiris\.luca\.com\.tr\/LUCASSO\/giris\.erp/i.test(currentUrl || '')) {
      await logJob(jobId, 'Luca login sayfasi acik; once kayitli oturum main.erp ile kontrol ediliyor.');
      await page.goto(LUCA_URLS.main, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        .catch(async (err) => {
          const msg = `SSO main acilamadi (${err.message}); klasik Luca URL deneniyor.`;
          log.warn(msg);
          await logJob(jobId, msg).catch(() => {});
          await page.goto(LUCA_CLASSIC_ENTRY, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        });
      await page.waitForTimeout(4500).catch(() => {});
      currentUrl = page.url();
    }
    if (/^https:\/\/auygs\.luca\.com\.tr\/Luca\/giris\.do/i.test(currentUrl || '')) {
      await logJob(jobId, 'Klasik Luca giris.do bos gorundu; arka plan oturumu SSO main.erp uzerinden toparlaniyor.');
      await page.goto(LUCA_URLS.main, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        .catch(async (err) => {
          const msg = `SSO main acilamadi (${err.message}); klasik Luca URL deneniyor.`;
          log.warn(msg);
          await logJob(jobId, msg).catch(() => {});
          await page.goto(LUCA_CLASSIC_ENTRY, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        });
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
        try {
          await withTimeout(
            page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }),
            50_000,
            'Luca reload',
          );
        } catch (err) {
          throw new Error(`TRANSIENT_LUCA_RELOAD_STUCK: ${err.message}`);
        }
        await page.waitForTimeout(2000).catch(() => {});
        const runtimeAfterReload = await page
          .evaluate(() => typeof window.__morenAgent !== 'undefined' && !!window.__morenAgent.running)
          .catch(() => false);
        if (!runtimeAfterReload) {
          throw new Error('TRANSIENT_AGENT_RUNTIME_MISSING: Luca reload sonrasi runtime baslamadi');
        }
      } else if (isLucaLoginPage) {
        await logJob(jobId, 'Luca login sayfasi acik; otomatik giris denenecek, gerekirse guvenlik kodu istenecek.');
      } else {
        await logJob(jobId, `Mevcut arka plan Luca oturumu kullanılacak: ${currentUrl.slice(0, 90)}`);
      }
    } else {
      await gotoLucaWithFallback(page, LUCA_URLS.login, jobId, 'Luca giris');
    }
    const final = await waitForJobFinalStatus(jobId);
    if (final?.status !== 'done') {
      const runtimeStopRequested = await page
        .evaluate(() => !!window.__morenAgent?.stopRequested)
        .catch(() => false);
      if (runtimeStopRequested) {
        throw new Error(`RUNTIME_STOP_REQUESTED: Job ${final?.status || 'bilinmeyen'} durumunda kapandi`);
      }
      throw new Error(`Job ${final?.status || 'bilinmeyen'} durumunda kapandı`);
    }
  });
}

async function loginToLuca(page) {
  log.info('Luca login sayfasına gidiliyor...');
  await gotoLucaWithFallback(page, LUCA_URLS.login, null, 'Luca giris');
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

  // CAPTCHA kontrolü — 2captcha ile otomatik çözüm (TWOCAPTCHA_API_KEY env'inden)
  await page.waitForTimeout(1500);
  const captchaImg = await page.$('img[src*="captcha" i], img[alt*="güvenlik" i], #captcha-input');
  if (captchaImg) {
    const twoCaptchaKey = process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY;
    if (twoCaptchaKey) {
      log.info('CAPTCHA tespit edildi, 2captcha ile çözülüyor...');
      try {
        const buffer = await captchaImg.screenshot({ type: 'png' });
        const base64 = buffer.toString('base64');
        const { Solver } = require('2captcha');
        const solver = new Solver(twoCaptchaKey);
        const t0 = Date.now();
        const cozum = await solver.imageCaptcha(base64, {
          numeric: 0,
          min_len: 4,
          max_len: 10,
          language: 0,
        });
        const ms = Date.now() - t0;
        log.info(`2captcha çözümü: "${cozum.data}" (${ms}ms, id=${cozum.id})`);
        // Captcha kod input'unu bul ve doldur
        const kodSelectors = [
          'input[id*="captcha" i]:not([id*="img" i])',
          'input[name*="captcha" i]',
          'input[id*="GuvenlikKod" i]',
          'input[id*="Kod" i]:not([id*="Plaka" i])',
          'input[placeholder*="güvenlik" i]',
          'input[placeholder*="kod" i]',
          '#captcha-input',
        ];
        let kodInput = null;
        for (const s of kodSelectors) {
          const el = await page.$(s);
          if (el) { kodInput = el; break; }
        }
        if (!kodInput) {
          throw new Error('Captcha kod input bulunamadı — 2captcha çözdü ama nereye yazılacağı belli değil');
        }
        await kodInput.fill('');
        await kodInput.type(cozum.data, { delay: 50 });
        // Submit veya Devam butonu
        const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Giriş"), button:has-text("Onay"), button:has-text("Devam")');
        if (submitBtn) {
          const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
          await submitBtn.click().catch(() => {});
          await navPromise;
        }
        await page.waitForTimeout(2000);
        // Tekrar captcha varsa hala başarısız — manuel'a düş
        const captchaImg2 = await page.$('img[src*="captcha" i], img[alt*="güvenlik" i], #captcha-input');
        if (captchaImg2) {
          try { await solver.reportBad(cozum.id); } catch {}
          throw new Error('2captcha çözümü yanlış — captcha tekrar geldi');
        }
        log.info('CAPTCHA otomatik çözüldü ✓');
      } catch (err) {
        log.warn(`2captcha hatası: ${err.message} — manuel müdahale gerekli`);
        throw new Error(`CAPTCHA ekranı: 2captcha çözemedi (${err.message}). Manuel kod girin veya .env'de TWOCAPTCHA_API_KEY kontrol edin.`);
      }
    } else {
      throw new Error('CAPTCHA ekranı geldi — TWOCAPTCHA_API_KEY env tanımsız, manuel müdahale gerekli. .env\'e TWOCAPTCHA_API_KEY ekleyin.');
    }
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

  // SELF-HEAL: timeout watcher icin kaydet
  activeJobsStartTime.set(jobId, Date.now());

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

  activeJobCount += 1;
  await pingAgentStatus(true, { activeJobId: jobId, activeJobType: tip });

  try {
    // v1.38: INVOICE_POST ozel akis — Luca'ya yevmiye fisi yazar
    // (fetch + upload pattern degil, post pattern). Scraper henuz hazir degil,
    // belgeyi "Luca'da manuel girilmesi gerek" diye isaretler.
    if (tip === 'INVOICE_POST') {
      await postInvoiceVoucher(job);
      log.info(`OK INVOICE_POST tamamlandi: jobId=${jobId.slice(0, 8)}`);
      return;
    }

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
  } catch (err) {
    log.error(`✗ ${tip} hatası: ${err.message}`);
    if (/RUNTIME_STOP_REQUESTED|guvenlik kodu .*tekrarlandi|captcha .*tekrar/i.test(err.message || '')) {
      const reason = `Luca browser oturumu sifirlandi; worker calismaya devam edecek: ${err.message}`;
      await logJob(jobId, reason).catch(() => {});
      await pingAgentStatus(false, {
        stoppedReason: err.message,
        activeJobId: jobId,
        activeJobType: tip,
      }).catch(() => {});
      await closeBrowserSession('runtime-stop-requested').catch(() => {});
      return;
    }
    if (/TRANSIENT_(AGENT_RUNTIME_MISSING|LUCA_RELOAD_STUCK)/i.test(err.message || '')) {
      const reason = `Luca runtime toparlanamadi; browser oturumu sifirlanip is tekrar siraya alindi: ${err.message}`;
      await logJob(jobId, reason).catch(() => {});
      await closeBrowserSession('runtime-recovery').catch(() => {});
      if (/LUCA_RELOAD_STUCK|CLASSIC_FRAME/i.test(err.message || '')) {
        rotateBrowserProfile('classic-frame-stuck');
      }
      await requeueJob(jobId, reason);
      return;
    }
    if (isTransientLucaConnectivityError(err)) {
      const reason = `Gecici Luca baglanti/DNS hatasi; tekrar siraya alindi: ${err.message}`;
      await logJob(jobId, reason).catch(() => {});
      await requeueJob(jobId, reason);
      return;
    }
    await markJobFailed(jobId, err.message);
  } finally {
    activeJobsStartTime.delete(jobId);
    activeJobCount = Math.max(0, activeJobCount - 1);
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
  if (activeJobCount > 0) {
    log.info('Pre-warm atlandi: aktif Luca isi var.');
    return;
  }
  if (preWarmPromise) {
    return preWarmPromise;
  }
  preWarmPromise = (async () => {
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
        await gotoLucaWithFallback(page, LUCA_URLS.login, null, 'Pre-warm Luca giris').catch(() => {});
      } else {
        // Zaten Luca sayfasındaysa reload et ki yeni eklenen init script çalışsın.
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      }
      const finalUrl = page.url();
      log.info(`✓ Pre-warm tamamlandı (url: ${finalUrl.slice(0, 80)})`);

      // SELF-HEAL: Pre-warm sonrası URL chrome-error veya about:blank ise
      // browser profil bozulmus demektir. Profili silip prosesi sonlandir,
      // scheduled task / mainLoop yeniden baslatir (temiz profil).
      const isBrokenUrl =
        finalUrl.startsWith('chrome-error://') ||
        finalUrl === 'about:blank' ||
        finalUrl.startsWith('chrome://') ||
        (!finalUrl.includes('luca.com.tr') && !finalUrl.includes('lucasso'));
      if (isBrokenUrl) {
        log.error(`Pre-warm SAGLIKSIZ URL (${finalUrl.slice(0, 80)}). Browser profili silinip polling canli tutuluyor.`);
        try { await session.context.close(); } catch {}
        try { await session.browser?.close?.(); } catch {}
        browserSession = null;
        try {
          const profileDir = path.resolve(__dirname, '..', '.browser-data');
          if (fs.existsSync(profileDir)) {
            fs.rmSync(profileDir, { recursive: true, force: true });
            log.info(`Browser profil silindi: ${profileDir}`);
          }
        } catch (err) {
          log.warn(`Browser profili silinemedi: ${err.message}`);
        }
        log.warn('Self-heal: pre-warm iptal edildi; agent prosesi acik kalacak ve bekleyen isleri poll etmeye devam edecek.');
        return;
      }
    }
    } catch (err) {
      log.warn(`Pre-warm başarısız (önemsiz, gerçek iş geldiğinde tekrar denenecek): ${err.message}`);
    } finally {
      preWarmPromise = null;
    }
  })();
  return preWarmPromise;
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

const portalChildWorkers = new Map();

function pipeChildOutput(stream, label, writer) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) writer(`[${label}] ${line}`);
    }
  });
}

async function fetchPortalWorkerAccounts() {
  try {
    const { data } = await api.get('/agent/luca/worker-accounts', { timeout: 30_000 });
    const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
    return accounts.filter((a) => a?.uyeNo && a?.username && a?.password);
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message;
    log.warn(`Portal Luca kullanici havuzu okunamadi (${status || '-'}): ${msg}`);
    return [];
  }
}

function startPortalWorkerChild(account, index, poolSize = 1) {
  const key = account.id || `${account.username}-${index}`;
  const label = account.displayName || account.username || `Luca ${index + 1}`;
  const deviceSlug = slugify(account.id || account.username || label);
  const payload = {
    id: account.id || key,
    displayName: label,
    uyeNo: account.uyeNo,
    username: account.username,
    password: account.password,
    deviceId: `${BASE_DEVICE_ID}-slot${index + 1}-${deviceSlug}`,
    slotIndex: index,
    poolSize,
  };
  const child = spawn(process.execPath, [__filename], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      MOREN_LUCA_WORKER_JSON: JSON.stringify(payload),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  portalChildWorkers.set(key, { child, account, index });
  log.info(`Portal Luca worker basladi: ${label} (${payload.deviceId})`);
  pipeChildOutput(child.stdout, label, (line) => log.info(line));
  pipeChildOutput(child.stderr, label, (line) => log.warn(line));
  child.on('exit', (code, signal) => {
    portalChildWorkers.delete(key);
    log.warn(`Portal Luca worker kapandi: ${label} (code=${code ?? '-'}, signal=${signal ?? '-'})`);
    if (!stopped) {
      setTimeout(() => {
        if (!stopped) startPortalWorkerChild(account, index, poolSize);
      }, 10_000);
    }
  });
}

async function startPortalWorkerPoolIfAvailable() {
  if (PORTAL_WORKER) return false;
  if (cfg.worker?.usePortalAccounts !== true) return false;

  const accounts = await fetchPortalWorkerAccounts();
  if (accounts.length === 0) {
    log.info('Portal Luca kullanici havuzu bos; tek config.json Luca kullanicisiyle devam edilecek.');
    return false;
  }

  const limit = Math.min(
    Math.max(Number(cfg.worker?.portalAccountLimit || 1), 1),
    accounts.length,
  );
  const selected = accounts
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
    .slice(0, limit);

  log.info(`Portal Luca havuzu aktif: ${selected.length} worker paralel baslatiliyor.`);
  selected.forEach((account, index) => startPortalWorkerChild(account, index, selected.length));

  while (!stopped) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  for (const { child } of portalChildWorkers.values()) {
    try { child.kill('SIGTERM'); } catch {}
  }
  return true;
}

async function mainLoop() {
  log.info(`Luca Local Agent başladı.`);
  log.info(`API: ${cfg.api.baseUrl}`);
  log.info(`Polling: her ${POLL_INTERVAL / 1000} saniyede bir`);
  log.info(`Job tipleri: ${[...JOB_TYPES].join(', ')}`);
  log.info(`Headless: ${HEADLESS}`);
  log.info(`Device: ${DEVICE_ID} (${WORKER_NAME})`);
  log.info(`Idle TTL: ${Math.round(BROWSER_IDLE_TTL/60000)}dk · Keep-alive: ${Math.round(BROWSER_KEEPALIVE_INTERVAL/60000)}dk`);

  // Agent başlangıcında ilk pre-warm gerçek job yoksa çalışır. Aksi halde
  // aynı Playwright sayfasında iki navigation çakışıp job'u pending bırakabiliyor.
  let initialPreWarmPending = true;
  // Her sabah PRE_WARM_HOUR'de tekrar
  schedulePreWarm();

  while (!stopped) {
    try {
      await pingAgentStatus(true);
      const jobs = await pollPendingJobs();
      const filtered = jobs.filter((j) => JOB_TYPES.has(j.tip || j.type));
      const runnable = PORTAL_WORKER && WORKER_POOL_SIZE > 1
        ? filtered.filter((_, index) => index % WORKER_POOL_SIZE === WORKER_POOL_INDEX)
        : filtered;
      if (runnable.length) {
        if (preWarmPromise) {
          log.info('Aktif job geldi; pre-warm bitmesi bekleniyor.');
          await preWarmPromise.catch((err) => log.warn(`Pre-warm bekleme hatasi: ${err.message}`));
        }
        log.info(`${runnable.length}/${filtered.length} bekleyen job bu worker'a dustu.`);
        for (const job of runnable) {
          if (stopped) break;
          await processJob(job);
        }
      } else {
        if (initialPreWarmPending) {
          initialPreWarmPending = false;
          await preWarmBrowserSession().catch((err) => log.warn(`Ilk pre-warm hatasi: ${err.message}`));
        }
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
  for (const { child } of portalChildWorkers.values()) {
    try { child.kill('SIGTERM'); } catch {}
  }
});
process.on('SIGTERM', () => {
  log.info('SIGTERM alındı, durduruluyor...');
  stopped = true;
  pingAgentStatus(false).catch(() => {});
  for (const { child } of portalChildWorkers.values()) {
    try { child.kill('SIGTERM'); } catch {}
  }
});

// ====================================================================
// PRINT QUEUE LOOP — Word ciktilarini otomatik yazicidan cikart
// ====================================================================
// Backend fis-yazdirma'da yeni bir print kaydi olusunca buraya pending
// olarak duser; biz indirip Windows'un default yazicisina gondeririz.

const PRINT_POLL_INTERVAL = 8_000;
const PRINT_TEMP_DIR = path.join(os.tmpdir(), 'moren-print');

async function ensurePrintTempDir() {
  try {
    await fs.promises.mkdir(PRINT_TEMP_DIR, { recursive: true });
  } catch (err) {
    log.warn(`Print temp dir olusturulamadi: ${err.message}`);
  }
}

/**
 * Tek bir Word dosyasini Windows default yazicisina gonderir.
 * Start-Process -FilePath x.docx -Verb Print → Word/Office aciliyor,
 * yazdiriyor, sessizce kapaniyor.
 */
async function printDocxFile(filePath) {
  return new Promise((resolve, reject) => {
    const ps = `Start-Process -FilePath '${filePath.replace(/'/g, "''")}' -Verb Print -WindowStyle Hidden`;
    const child = require('child_process').spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true },
    );
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`PowerShell exit ${code}: ${stderr.slice(0, 300)}`));
    });
    child.on('error', reject);
  });
}

async function processPrintJob(job) {
  const tempFile = path.join(PRINT_TEMP_DIR, `${job.id}_${Date.now()}.docx`);
  try {
    // 1) Claim — ayni anda iki agent yazdirmasin
    const { data: claim } = await api.post(`/agent/print-queue/${job.id}/claim`, {
      deviceId: DEVICE_ID,
    });
    if (!claim?.claimed) {
      log.debug(`Print ${job.id}: baska bir agent aldi`);
      return;
    }
    log.info(`Print ${job.id} alindi (${job.filename})`);

    // 2) Word'u indir
    const resp = await api.get(`/agent/print-queue/${job.id}/download`, {
      responseType: 'arraybuffer',
    });
    await fs.promises.writeFile(tempFile, Buffer.from(resp.data));
    log.info(`Print ${job.id} indirildi: ${tempFile} (${resp.data.byteLength} byte)`);

    // 3) Yazdir
    await printDocxFile(tempFile);
    log.info(`Print ${job.id} yaziciya gonderildi`);

    // 4) Complete
    await api.post(`/agent/print-queue/${job.id}/complete`, { success: true });
  } catch (err) {
    log.error(`Print ${job.id} basarisiz: ${err.message}`);
    try {
      await api.post(`/agent/print-queue/${job.id}/complete`, {
        success: false,
        error: err.message?.slice(0, 500) || 'unknown',
      });
    } catch {}
  } finally {
    // Gecici dosyayi sil (30 sn sonra — yazici daha kuyrugundayken silinmesin)
    setTimeout(() => {
      fs.promises.unlink(tempFile).catch(() => {});
    }, 30_000);
  }
}

async function printQueueLoop() {
  await ensurePrintTempDir();
  log.info(`Print queue loop basladi (${PRINT_POLL_INTERVAL / 1000}sn poll)`);
  while (!stopped) {
    try {
      const { data: pending } = await api.get('/agent/print-queue/pending', {
        params: { deviceId: DEVICE_ID },
      });
      if (Array.isArray(pending) && pending.length > 0) {
        for (const job of pending) {
          if (stopped) break;
          await processPrintJob(job);
        }
      }
    } catch (err) {
      // 404/connection — sessiz gec, backend henuz print modulunu deploy etmemis olabilir
      if (err.response?.status && err.response.status !== 404) {
        log.warn(`Print poll hatasi: ${err.message}`);
      }
    }
    if (!stopped) await new Promise((r) => setTimeout(r, PRINT_POLL_INTERVAL));
  }
}

// ====================================================================
// SELF-HEAL: Memory watcher — RAM 600MB asarsa restart
// ====================================================================
function startMemoryWatcher() {
  const LIMIT_MB = 600;
  setInterval(() => {
    const mb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    if (mb > LIMIT_MB) {
      log.error(`Self-heal: RAM ${mb}MB > ${LIMIT_MB}MB limit. Proses sonlandiriliyor (watchdog restart edecek).`);
      process.exit(3);
    }
  }, 60_000); // 60sn'de bir
}

// ====================================================================
// SELF-HEAL: Job timeout watcher — 10dk asan jobi abort + restart
// ====================================================================
const activeJobsStartTime = new Map(); // jobId -> startedAt
const JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 dakika

function startJobTimeoutWatcher() {
  setInterval(() => {
    const now = Date.now();
    for (const [jid, startedAt] of activeJobsStartTime) {
      if (now - startedAt > JOB_TIMEOUT_MS) {
        log.error(`Self-heal: Job ${jid} 10dk+ takildi. Proses sonlandiriliyor (watchdog restart edecek).`);
        // Job'u backend'e abort olarak isaretle
        api.post(`/agent/luca/jobs/${jid}/requeue`, {
          reason: 'AGENT_SELF_HEAL_TIMEOUT_10MIN',
        }).catch(() => {});
        setTimeout(() => process.exit(4), 2000);
        return;
      }
    }
  }, 30_000); // 30sn'de bir
}

async function start() {
  acquireSingleInstanceLock();
  const poolStarted = await startPortalWorkerPoolIfAvailable();

  // Print queue loop'u her zaman calişsin — Luca havuzu var/yok fark etmez
  printQueueLoop().catch((err) => log.error(`Print loop fatal: ${err.message}`));

  // SELF-HEAL watcher'lari baslat
  startMemoryWatcher();
  startJobTimeoutWatcher();

  if (!poolStarted) {
    if (!cfg.luca?.uyeNo || !cfg.luca?.username || !cfg.luca?.password) {
      throw new Error('Portal Luca kullanici havuzu bos ve config.json icinde tekil Luca kullanicisi yok');
    }
    await mainLoop();
  }
}

start().catch((err) => {
  log.error(`Fatal: ${err.message}`);
  process.exit(1);
});
