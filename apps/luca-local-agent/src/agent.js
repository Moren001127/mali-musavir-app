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
// Ayni klasorden IKINCI bir ornek calistirabilmek icin config yolu env ile
// degistirilebilir: operator ajani `MOREN_LUCA_CONFIG=config.operator.json` ile
// baslar (kilit, tarayici profili ve cihaz adi zaten operator moduna gore ayrilir).
const CONFIG_PATH = process.env.MOREN_LUCA_CONFIG
  ? path.resolve(process.env.MOREN_LUCA_CONFIG)
  : path.join(__dirname, '..', 'config.json');
const DEVICE_ID_PATH = path.join(__dirname, '..', '.device-id');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`HATA: yapılandırma bulunamadı: ${CONFIG_PATH}. config.example.json dosyasını config.json olarak kopyalayıp doldurun.`);
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));

// LUCA OPERATORU MODU (config.json -> worker.role = "operator")
//   Kullanicinin kendi bilgisayarinda, KENDI Chrome profilinden AYRI bir
//   Chromium penceresi acar ve YALNIZ operator islerini (EKRAN_OKU / LUCA_ACTION)
//   alir. Veri cekme isleri sunucudaki ajanda kalir; bu ajan onlara dokunmaz.
//   Cihaz adi `-operator` ile biter -> sunucu isleri buraya yonlendirir.
const OPERATOR_MODE =
  String(cfg.worker?.role || '').trim().toLowerCase() === 'operator';

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
const RAW_DEVICE_ID = PORTAL_WORKER
  ? (PORTAL_WORKER.deviceId || `${BASE_DEVICE_ID}-${WORKER_SLOT_ID}`)
  : BASE_DEVICE_ID;
// Operator ajani cihaz adini `-operator` ile bitirir: sunucu (luca.service.ts
// agentKindForDeviceId) bu eke bakip operator islerini SADECE bu cihaza yollar.
const DEVICE_ID = OPERATOR_MODE && !/-operator$/i.test(RAW_DEVICE_ID)
  ? `${RAW_DEVICE_ID}-operator`
  : RAW_DEVICE_ID;
const WORKER_NAME = PORTAL_WORKER?.displayName || cfg.worker?.workerName || os.hostname();
const WORKER_POOL_INDEX = Math.max(0, Number(PORTAL_WORKER?.slotIndex || 0));
const WORKER_POOL_SIZE = Math.max(1, Number(PORTAL_WORKER?.poolSize || 1));
// DUZELTME (2026-06-08): Kilit artik slot-bazli. Portal havuz iscileri (her biri
// ayri Luca hesabi/slot) ayni anda calisabilmeli, AMA ayni slot iki kez calismamali.
// Once PORTAL_WORKER modunda kilit tamamen atlaniyordu -> ayni slot/hesap cift
// calisip yaris/cift firma-degisimi yaratabiliyordu. Ana agent .agent.lock,
// her portal iscisi .agent.lock-<slot> kullanir.
const SINGLE_INSTANCE_LOCK_PATH = path.join(
  __dirname,
  '..',
  OPERATOR_MODE
    ? '.agent.lock-operator'
    : PORTAL_WORKER
      ? `.agent.lock-${WORKER_SLOT_ID || 'worker'}`
      : '.agent.lock',
);
let singleInstanceLockAcquired = false;

if (!cfg.api?.baseUrl || !cfg.api?.agentToken) {
  console.error('HATA: config.json içinde api.baseUrl ve api.agentToken zorunlu.');
  process.exit(1);
}
if ((!cfg.luca?.uyeNo || !cfg.luca?.username || !cfg.luca?.password) && (PORTAL_WORKER || cfg.worker?.usePortalAccounts !== true)) {
  console.error('HATA: config.json içinde luca.uyeNo, luca.username, luca.password zorunlu.');
  process.exit(1);
}

// Operator canli sohbetten komut alir: 30 sn'lik yoklama "cevap gelmiyor" hissi
// verir. Operator modunda varsayilan 5 sn.
const POLL_INTERVAL = OPERATOR_MODE
  ? (cfg.worker?.pollIntervalSeconds || 5) * 1000
  : (cfg.worker?.pollIntervalSeconds || 30) * 1000;
const BROWSER_TIMEOUT = (cfg.worker?.browserTimeoutSeconds || 120) * 1000;
// DUZELTME (2026-06-08): Varsayilan artik HEADFUL (gorunur). Luca'nin klasik
// frameset'i (firma/frm4 ekrani) HEADLESS Chromium'da duzgun yuklenmiyordu ->
// haftalardir suren kronik "frame-stuck" + sonsuz requeue dongusu (e-arsiv vb.
// isler hic tamamlanamiyordu). Gorunur modda Luca duzgun aciliyor ve isler akiyor
// (canli dogrulandi: EARSIV_ALIS 2 dk'da done). Gercekten headless gereken (masaustu
// olmayan) bir kurulum varsa config.json'da "headless": true ile acikca secilebilir.
// Operator modunda pencere HER ZAMAN gorunur: kullanici operatorun ne yaptigini
// izleyebilmeli (ve gerekirse Luca guvenlik kodunu kendisi girebilmeli).
const HEADLESS = OPERATOR_MODE ? false : cfg.worker?.headless === true;
// COKLU BILGISAYAR YONLENDIRME: bu worker yalniz "ownerEmail" panel kullanicisinin
// verdigi isleri yapar (sunucu createdBy ile eslestirir). Bos ise eski davranis (hepsi).
// alsoUnowned=true ise sahipsiz/otomatik isleri de bu worker ustlenir.
const OWNER_EMAIL = String(cfg.worker?.ownerEmail || '').trim();
const ALSO_UNOWNED = cfg.worker?.alsoUnowned === true;
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
  // LUCA OPERATORU: portaldan gelen canli komutlar (ekrani oku / yaz-sec-tikla).
  // Bunlari YALNIZ operator modundaki ajan alir (asagida JOB_TYPES ayrimi).
  'EKRAN_OKU',
  'LUCA_ACTION',
]);
// Operator modunda ajan SADECE bu iki tipi yapar; veri cekme islerine karismaz.
const OPERATOR_JOB_TYPES = Object.freeze(['EKRAN_OKU', 'LUCA_ACTION']);
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

  // Operator isleri varsayilan listeye GIRMEZ: yalniz operator modundaki ajan alir.
  const defaultJobTypes = SUPPORTED_JOB_TYPES.filter((t) => !OPERATOR_JOB_TYPES.includes(t));
  if (raw.length === 0 || (!strict && legacyDefaultConfig)) {
    return {
      jobTypes: [...defaultJobTypes],
      upgradedFromLegacy: legacyDefaultConfig,
      unknown,
    };
  }

  return {
    jobTypes: accepted.length ? accepted : [...defaultJobTypes],
    upgradedFromLegacy: false,
    unknown,
  };
}

const JOB_TYPE_CONFIG = OPERATOR_MODE
  ? { jobTypes: [...OPERATOR_JOB_TYPES], upgradedFromLegacy: false, unknown: [] }
  : normalizeJobTypeConfig(cfg.worker?.jobTypes);
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
// GUVENLIK AGI (bayat klasik-Luca oturumu): oturum bu yastan eskiyse bir
// sonraki iste tarayici (cerez/profil korunarak) taze acilir. Klasik Luca
// frameset'i saatler icinde bayatlayip bos/dummy frame verebiliyor; sik
// recycle bunu onler. Isi BOLMEZ (isler arasinda, idle aninda devreye girer).
const BROWSER_MAX_AGE = (cfg.worker?.browserMaxAgeSeconds || 3 * 60 * 60) * 1000;
// Keep-alive ping aralığı: idle TTL'in 1/4'ü. Browser session açıkken
// arka planda hafif bir sayfa içi navigasyon yaparak Luca cookie'sinin
// sunucu tarafında sıfırlanmasını engelleriz.
const configuredKeepAliveSeconds = Number(cfg.worker?.browserKeepAliveSeconds || 0);
const BROWSER_KEEPALIVE_INTERVAL = configuredKeepAliveSeconds > 0
  ? configuredKeepAliveSeconds * 1000
  : Math.max(60_000, Math.min(10 * 60 * 1000, BROWSER_IDLE_TTL / 4));
const nativeBridgePages = new WeakSet();

// --------- Logger ---------
// DONMA WATCHDOG heartbeat'i: ajan herhangi bir log satiri yazinca tazelenir.
// Iş adimi / pre-warm / idle loop tick hepsi loglar → "canli" sinyali. Tum loglama
// uzun süre durursa (13.06 17:28 donmasi: süreç ayakta ama döngü asili, 75dk sessiz)
// heartbeat bayatlar ve startFreezeWatchdog prosesi öldürür → wrapper taze ajan başlatir.
let lastAgentProgressAt = Date.now();
function markAgentProgress() { lastAgentProgressAt = Date.now(); }
const log = {
  info: (...args) => { markAgentProgress(); console.log(`[${new Date().toISOString()}]`, ...args); },
  warn: (...args) => { markAgentProgress(); console.warn(`[${new Date().toISOString()}] WARN`, ...args); },
  error: (...args) => { markAgentProgress(); console.error(`[${new Date().toISOString()}] ERROR`, ...args); },
  debug: (...args) => {
    markAgentProgress();
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
  // Not: PORTAL_WORKER modunda da kilit alinir; ama slot-bazli dosya kullanildigi
  // icin (SINGLE_INSTANCE_LOCK_PATH) farkli slotlar yan yana calisabilir.
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
        ...(OWNER_EMAIL ? { ownerEmail: OWNER_EMAIL } : {}),
        ...(ALSO_UNOWNED ? { alsoUnowned: '1' } : {}),
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
  let stuckSeen = 0; // bu is icin "firma/frame hazir gelmedi" log adedi
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
    // SELF-HEAL (bayat oturum): sayfa-ici 5-kontrol RESET esigine ulasamadan
    // tekrar tekrar "firma/frame hazir gelmedi" diyen isler bayat tarayici
    // oturumu demektir. 3 boyle log gorulunce yumusak reset sinyali firlat —
    // catch tarafinda tarayici (cerez korunarak) kapatilip taze acilir.
    const stuckMatches = (newJobLog.match(/frm4\/SirketCombo henuz yuklenmedi|firma frame'?i acilmadi|firma frame'?i beklenenden gec/gi) || []).length;
    if (stuckMatches > 0) stuckSeen += stuckMatches;
    if (stuckSeen >= 3) {
      throw new Error('TRANSIENT_LUCA_FRAME_STUCK_SOFT: Klasik Luca firma/frame tekrar tekrar hazir gelmedi (bayat oturum); tarayici oturumu yenilenecek');
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
// Bayat klasik-Luca oturumu sayaci: art arda "firma/frame hazir gelmedi" ile
// takilan isleri sayar; closeBrowserSession (cerez korunur) yetmezse 3'te
// profili yeniler. Basarili her iste 0'lanir.
let classicFrameStuckStreak = 0;

// Otomatik Luca girisi (loginToLuca) artik is akisina baglidir. Hesap kilidi
// riskine karsi koruma: ardisik denemeler arasi cooldown + ust uste basarisizlikta
// otomatik denemeyi durdurup net hata verme. Saglikli iste 0'lanir.
let lastLoginAttemptAt = 0;
let loginFailStreak = 0;
const LOGIN_COOLDOWN_MS = 90_000;
const LOGIN_FAIL_MAX = 3;

function getCurrentRuntimeVersionForApi() {
  return browserSession?.runtimeVersion || BUNDLED_RUNTIME_VERSION || LOCAL_AGENT_VERSION;
}

function getBrowserUserDataDir() {
  // Operatorun KENDI profili: kullanicinin gunluk Chrome'undan tamamen ayri
  // (gecmis/sekme/oturum karismaz), ama Luca cerezi burada kalici saklanir.
  return path.join(
    __dirname,
    '..',
    OPERATOR_MODE
      ? '.browser-data-operator'
      : PORTAL_WORKER
        ? `.browser-data-${WORKER_SLOT_ID}`
        : '.browser-data',
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
      // Luca sunucusuna gerçek HTTP isteği at — sadece JS evaluate değil,
      // fetch() sunucuya ulaşır ve session timer'ı sıfırlar (30dk drop engeli).
      await page.evaluate(async () => {
        try {
          await fetch(location.origin + '/luca/', {
            method: 'HEAD',
            credentials: 'include',
            cache: 'no-cache',
          });
        } catch {}
      }).catch(() => {});
      log.debug?.(`Luca keep-alive ping (HTTP HEAD → ${url.slice(0, 60)})`);
    } catch (e) {
      // sessizce yok say — bir sonraki tick'te tekrar dene
    }
  }, BROWSER_KEEPALIVE_INTERVAL);
}

async function getBrowserSession() {
  const now = Date.now();
  if (browserSession) {
    const idleFor = now - (browserSession.lastUsedAt || browserSession.createdAt || now);
    const sessionAge = now - (browserSession.createdAt || now);
    const tooOld = sessionAge >= BROWSER_MAX_AGE; // guvenlik agi: bayat oturumu onle
    const pageClosed = browserSession.page?.isClosed?.() === true;
    if (!pageClosed && !tooOld && idleFor < BROWSER_IDLE_TTL) {
      browserSession.lastUsedAt = now;
      return browserSession;
    }
    await closeBrowserSession(pageClosed ? 'page-closed' : (tooOld ? 'max-age-recycle' : 'idle-timeout'));
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
  // HIZLI FİŞ gibi AYRI-PENCERE popup'lar açıldığında native köprü + onay kabulünü kur
  //   (İşletme fiş aktarımı popup'ta trusted Yükle/Fiş Kes ister).
  context.on('page', (p) => { setupAuxiliaryPage(p).catch(() => {}); });
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

function looksLikeValidRuntime(code) {
  // Gecerli runtime: yeterince buyuk + AGENT_VERSION imzasi var.
  return typeof code === 'string' && code.length > 100_000 && /AGENT_VERSION\s*=/.test(code);
}

async function loadMorenRuntimeCode() {
  const localRuntimePath = path.resolve(__dirname, '..', '..', 'api', 'public', 'agent-runtime.js');
  const localExists = fs.existsSync(localRuntimePath);

  // DUZELTME (2026-06-08): Varsayilan artik SUNUCU-ONCELIKLI (oto-guncelleme).
  // Boylece deploy edilen agent-runtime.js tum makinelere otomatik yayilir; her
  // makinede ayri "git pull" gerekmez. Sadece config'te preferLocalRuntime:true
  // diyen (runtime'i yerelde gelistiren) kurulumlar yerel-oncelikli kalir.
  // Sunucu erisilemez / gelen icerik gecersizse YERELE duser (cevrimdisi guvenlik agi).
  const wantLocalFirst = cfg.worker?.preferLocalRuntime === true;

  if (wantLocalFirst && localExists) {
    log.info(`Yerel agent-runtime.js kullaniliyor (preferLocalRuntime): ${localRuntimePath}`);
    return fs.readFileSync(localRuntimePath, 'utf8');
  }

  // 1) Sunucudan cek (oto-guncelleme)
  try {
    const runtimeBaseUrl = cfg.api.runtimeUrl || `${cfg.api.baseUrl}/agent/runtime.js`;
    const runtimeUrl = `${runtimeBaseUrl}${runtimeBaseUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
    const runtimeResponse = await axios.get(runtimeUrl, { timeout: 30_000 });
    const code = String(runtimeResponse.data || '');
    if (looksLikeValidRuntime(code)) {
      const v = extractMorenRuntimeVersion(code);
      log.info(`Sunucudan agent-runtime.js cekildi (${Math.round(code.length / 1024)}KB, v${v || '?'}).`);
      return code;
    }
    log.warn('Sunucudan gelen agent-runtime.js gecersiz gorunuyor; yerele dusuluyor.');
  } catch (err) {
    log.warn(`Sunucudan agent-runtime.js cekilemedi (${err.message}); yerele dusuluyor.`);
  }

  // 2) Yerel yedek
  if (localExists) {
    log.info(`Yerel agent-runtime.js kullaniliyor (yedek): ${localRuntimePath}`);
    return fs.readFileSync(localRuntimePath, 'utf8');
  }
  throw new Error('agent-runtime.js ne sunucudan ne de yerelden yuklenemedi');
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

// Popup/yardımcı sayfalar (HIZLI FİŞ vb.): native TRUSTED tık köprüsü + onay-confirm kabulü.
// Ana Luca sayfası zaten runJobWithMorenRuntime + installMorenRuntimeBridge'te kuruluyor; burada
// YALNIZ yeni açılan popup sayfaları için. Böylece İşletme HIZLI FİŞ penceresindeki "Yükle"/"Fiş Kes"
// Luca'nın kabul ettiği trusted tıklamalarla çalışır ve Fiş Kes onay confirm'i otomatik KABUL edilir.
async function setupAuxiliaryPage(page) {
  try {
    if (browserSession && page === browserSession.page) return; // ana sayfa zaten kurulu
    await installNativeClickBridge(page).catch(() => {});
    page.on('dialog', async (dialog) => {
      const msg = String(dialog.message() || '').trim();
      const type = dialog.type();
      const wantAccept = type === 'confirm'
        && /(fi[şs]|kes|kaydet|aktar|olu[şs]tur|onayl|devam|emin\s*misin|kesilecek|aktar[ıi]lacak)/i.test(msg)
        && !/(sil|iptal|vazge[çc]|geri\s*al)/i.test(msg);
      try { if (wantAccept) await dialog.accept(); else await dialog.dismiss(); } catch {}
    });
    page.on('pageerror', () => {});
    log.info(`Popup native köprü + onay kuruldu: ${(page.url() || '').slice(0, 60)}`);
  } catch (e) {
    log.warn(`Popup kurulum uyarısı: ${e?.message || e}`);
  }
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
  // v1.45: GERÇEK (trusted) klavye köprüsü. Sayfa-içi dispatchEvent(Escape) isTrusted=false
  //   olduğu için Luca'nın modal dialog'larını (İşlem Takip) KAPATMIYOR. Playwright
  //   keyboard.press CDP üzerinden trusted event üretir → kullanıcının elle bastığı ESC ile
  //   AYNI; pencere arkada/küçük olsa bile çalışır.
  await page.exposeBinding('__morenNativePressKey', async (_source, payload) => {
    const key = (payload && payload.key) || 'Escape';
    const times = Math.max(1, Math.min(10, (payload && payload.times) || 1));
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(key).catch(() => {});
      await new Promise((r) => setTimeout(r, 120));
    }
    return { ok: true, key, times };
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
      const type = dialog.type();
      // Fiş Kes / kaydetme gibi POZİTİF onay confirm'lerini KABUL et. Eskiden HER dialog dismiss
      //   ediliyordu → fisKes()'in açtığı "fiş kesilecek, onaylıyor musunuz?" confirm'i iptal edilip
      //   fiş HİÇ kesilmiyordu (tüm Fiş Kes denemelerinin sessiz başarısızlığının kök nedeni).
      //   Yıkıcı (sil/iptal/vazgeç) confirm'leri ve diğer alert'leri yine kapat.
      const wantAccept = type === 'confirm'
        && /(fi[şs]|kes|kaydet|aktar|olu[şs]tur|onayl|devam|emin\s*misin|kesilecek|aktar[ıi]lacak)/i.test(msg)
        && !/(sil|iptal|vazge[çc]|geri\s*al)/i.test(msg);
      if (wantAccept) {
        log.info(`Luca onay penceresi KABUL edildi (Evet): ${msg}`);
        await logJob(jobId, `Luca onay penceresi KABUL edildi: ${msg}`).catch(() => {});
        await dialog.accept().catch(() => {});
        return;
      }
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
    // SSO toparlama sonrasi HALA login sayfasindaysak (cerez dusmus): kayitli
    // loginToLuca akisini CAGIR (kimlik + 2captcha). Onceden bu fonksiyon vardi
    // ama hicbir yerden cagrilmiyordu -> oturum olunce ajan kendini toparlayamiyordu.
    // Cooldown + fail-streak ile hesap kilidi riskine karsi korunur.
    if (/giris\.erp|LUCASSO\/login|\/Luca\/giris\.do/i.test(currentUrl || '')) {
      if (loginFailStreak >= LOGIN_FAIL_MAX) {
        throw new Error(`TRANSIENT_LUCA_LOGIN_FAILED: otomatik giris ${loginFailStreak} kez ust uste basarisiz; hesap kilidi riskine karsi otomatik deneme duraklatildi (manuel giris gerekebilir)`);
      }
      if (Date.now() - lastLoginAttemptAt < LOGIN_COOLDOWN_MS) {
        throw new Error('TRANSIENT_LUCA_LOGIN_FAILED: giris denemesi cooldown\'da; kisa sure sonra tekrar denenecek');
      }
      lastLoginAttemptAt = Date.now();
      await logJob(jobId, 'Luca oturumu dusuk; kayitli kimlikle otomatik giris yapiliyor (2captcha).').catch(() => {});
      try {
        await loginToLuca(page);
        loginFailStreak = 0;
        await logJob(jobId, 'Otomatik Luca girisi basarili; oturum tazelendi.').catch(() => {});
      } catch (loginErr) {
        loginFailStreak++;
        throw new Error(`TRANSIENT_LUCA_LOGIN_FAILED: otomatik giris basarisiz [${loginFailStreak}]: ${loginErr.message}`);
      }
      // Giris sonrasi uygulamaya gec — runtime bu sayfada yuklenir.
      await page.goto(LUCA_URLS.main, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        .catch(async () => {
          await page.goto(LUCA_CLASSIC_ENTRY, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        });
      await page.waitForTimeout(3000).catch(() => {});
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

  // Zaten girişliyse (persistent oturum geçerli) login formu olmaz → boşuna doldurma.
  if (!/giris\.erp/i.test(page.url()) && !(await page.$('#parola, input[type="password"]'))) {
    log.info(`Login gerekmedi, oturum geçerli: ${page.url()}`);
    return;
  }

  // Luca form alanları — placeholder ile bulunabilir (Üye Numarası / Kullanıcı Adı / Parola)
  const uyeNoSelector = 'input[name="uyeNo"], input[name="musteriNo"], input#uyeNo, input[placeholder*="Üye" i], input[placeholder*="ye Numara" i]';
  const usernameSelector = 'input[name="kullaniciAdi"], input[name="username"], input#username, input[placeholder*="Kullan" i]';
  const passwordSelector = 'input[name="sifre"], input[name="password"], input[type="password"], input[placeholder*="Parola" i]';

  // Doldur
  await page.fill(uyeNoSelector, cfg.luca.uyeNo);
  await page.fill(usernameSelector, cfg.luca.username);
  await page.fill(passwordSelector, cfg.luca.password);

  // ── ADIM 1: Kimlik gönder → captcha sayfası (captchaKontrol.erp) gelir ──
  // 2026-06-11 doğrulandı: 2FA kapalı Luca hesabında girişte CAPTCHA ZORUNLU.
  // Doğru akış: girisbtn() ile kimlik gönder → captcha sayfasında 2captcha ile çöz →
  // "Tamam" (forms[0].submit) → main.erp. (Eski kod captcha'yı submit'ten ÖNCE arayıp
  // boş buluyor, kimliği captcha olmadan gönderip sürekli login sayfasında kalıyordu.)
  const navP1 = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
  const girisGonderildi = await page.evaluate(() => {
    try { if (typeof girisbtn === 'function') { girisbtn(); return 'girisbtn'; } } catch (_) {}
    const b = document.querySelector('input[value="GİRİŞ"], input[onclick*="giris" i]');
    if (b) { b.click(); return 'giris-button'; }
    if (document.girisForm) { document.girisForm.submit(); return 'form.submit'; }
    return null;
  });
  if (!girisGonderildi) {
    await page.press(passwordSelector, 'Enter').catch(() => {});
  } else {
    log.info(`Kimlik gönderildi (${girisGonderildi}); captcha bekleniyor...`);
  }
  await navP1;
  await page.waitForTimeout(2000);

  // Captcha gerekmeden giriş tamamlandıysa (oturum hâlâ geçerliyse) → bitir.
  if (!/giris\.erp|captchaKontrol/i.test(page.url())) {
    log.info(`Login başarılı (captcha gerekmedi): ${page.url()}`);
    return;
  }

  // ── ADIM 2: CAPTCHA — 2captcha ile otomatik çöz (en çok 3 deneme) ──
  await page.waitForSelector('#captcha-input', { timeout: 15_000 }).catch(() => {});
  if (await page.$('#captcha-input')) {
    const twoCaptchaKey = process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY;
    if (!twoCaptchaKey) {
      throw new Error('Luca girişinde captcha zorunlu ama TWOCAPTCHA_API_KEY tanımsız (.env). Otomatik giriş yapılamıyor.');
    }
    const { Solver } = require('2captcha');
    const solver = new Solver(twoCaptchaKey);
    let cozuldu = false;
    // 6 deneme: 2captcha bazen yanlış/kısa okuyor (ör. "46c"); Luca captcha'sı 6 hane.
    // Yanlış gönderim Luca'da YENİ captcha üretir (hesap kilidi yok) → tekrar dene.
    for (let deneme = 1; deneme <= 6; deneme++) {
      const capImg = await page.$('#captcha');
      if (!capImg) { cozuldu = true; break; } // captcha kalktı → giriş olmuş
      let cozum;
      try {
        const buffer = await capImg.screenshot({ type: 'png' });
        const t0 = Date.now();
        // regsense:1 → büyük/küçük harf korunur. min/max_len: 2captcha'ya beklenen
        // uzunluğu söyler (Luca captcha'sı 6 hane) → kısa yanlış okumalar azalır.
        cozum = await solver.imageCaptcha(buffer.toString('base64'), {
          numeric: 0, min_len: 5, max_len: 7, language: 0, regsense: 1,
        });
        log.info(`Luca captcha 2captcha [${deneme}]: "${cozum.data}" (${Date.now() - t0}ms)`);
      } catch (err) {
        log.warn(`2captcha hatası [${deneme}]: ${err.message}`);
        await page.waitForTimeout(1500);
        continue;
      }
      // Açıkça kısa okuma (<5) muhtemelen yanlış → boşa gönderme, yeni captcha iste.
      if (String(cozum.data || '').trim().length < 5) {
        try { await solver.reportBad(cozum.id); } catch (_) {}
        log.warn(`Luca captcha çok kısa okundu ("${cozum.data}"); yeni captcha isteniyor.`);
        // captcha'yı yenile (resme tıkla / formu yeniden yükle yerine: boş gönder → Luca yeniler)
        await page.fill('#captcha-input', '0').catch(() => {});
        const navR = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => null);
        await page.evaluate(() => { const t = document.querySelector('input[value="Tamam"], input[value="TAMAM"]'); if (t) t.click(); else if (document.forms[0]) document.forms[0].submit(); }).catch(() => {});
        await navR; await page.waitForTimeout(1500);
        continue;
      }
      await page.fill('#captcha-input', String(cozum.data).trim()).catch(() => {});
      const navP2 = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => null);
      const gonderildi = await page.evaluate(() => {
        const t = document.querySelector('input[value="Tamam"], input[value="TAMAM"]');
        if (t) { t.click(); return true; }
        if (document.forms[0]) { document.forms[0].submit(); return true; }
        return false;
      });
      if (!gonderildi) await page.keyboard.press('Enter').catch(() => {});
      await navP2;
      await page.waitForTimeout(2000);
      if (!(await page.$('#captcha'))) { cozuldu = true; break; } // captcha kalktı → başarılı
      try { await solver.reportBad(cozum.id); } catch (_) {}
      log.warn(`Luca captcha yanlış [${deneme}]; yeni captcha ile tekrar deneniyor...`);
    }
    if (!cozuldu && (await page.$('#captcha'))) {
      throw new Error('Luca captcha 6 denemede çözülemedi (2captcha). Oturum gardiyanı/sonraki iş tekrar deneyecek.');
    }
  }

  // ── Sonuç doğrula ──
  const url = page.url();
  if (/giris\.erp|LUCASSO\/login|captchaKontrol/i.test(url)) {
    throw new Error(`Login başarısız — hâlâ login/captcha sayfasında: ${url}`);
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
    // v2.3: INVOICE_POST artik RUNTIME'da islenir — agent-runtime.js Luca
    // "Excel Fis Aktarim" ekranina dosyayi yukler (Muhasebe > Fis Islemleri >
    // Excel Veri Aktarimi). Eski disk-placeholder postInvoiceVoucher artik
    // cagrilmiyor; is normal runJobWithMorenRuntime yolundan runtime job
    // loop'una duser ve oradaki INVOICE_POST handler calisir.
    await runJobWithMorenRuntime(job);
    classicFrameStuckStreak = 0; // saglikli is geldi → bayat-oturum sayacini sifirla
    loginFailStreak = 0; // saglikli is geldi → otomatik giris fail sayacini sifirla
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
    if (/TRANSIENT_LUCA_FRAME_STUCK_SOFT/i.test(err.message || '')) {
      // Bayat klasik-Luca oturumu: tarayiciyi CEREZ KORUNARAK kapat (taze oturum
      // acilir, giris korunur — manuel restart'in yaptigi sey). Profil ARTIK SILINMEZ.
      // frame-stuck'in sebebi neredeyse hic "bozuk cerez" degildir (Luca cercevesi
      // yavasligi / sunucu hatasi); profili silmek girisi ucurup login/captcha
      // dongusu yaratiyordu (06-06..06-08 self-heal regresyonu). Oturum gercekten
      // dustuyse ajan zaten login sayfasini gorup normal akisinda (main.erp SSO)
      // kendi toparlar; keep-alive da oturumu ayakta tutar.
      classicFrameStuckStreak++;
      const reason = `Klasik Luca bayat oturum; tarayici cerez korunarak sifirlanip is tekrar siraya alindi [${classicFrameStuckStreak}]: ${err.message}`;
      await logJob(jobId, reason).catch(() => {});
      await closeBrowserSession('frame-stuck-soft').catch(() => {});
      await requeueJob(jobId, reason);
      return;
    }
    if (/TRANSIENT_LUCA_LOGIN_FAILED/i.test(err.message || '')) {
      // Otomatik giris basarisiz/cooldown: profil SILINMEZ, cerez korunarak kapat +
      // tekrar siraya al. Cooldown + fail-streak guvenligi loginToLuca cagrisinda.
      const reason = `Luca otomatik giris tamamlanamadi; is tekrar siraya alindi: ${err.message}`;
      await logJob(jobId, reason).catch(() => {});
      await closeBrowserSession('login-retry').catch(() => {});
      await requeueJob(jobId, reason);
      return;
    }
    if (/TRANSIENT_(AGENT_RUNTIME_MISSING|LUCA_RELOAD_STUCK)/i.test(err.message || '')) {
      // Profil ARTIK SILINMEZ: runtime yuklenememesi bir login sorunu degildir;
      // girisi ucurmak bunu cozmez, yalnizca login/captcha dongusu ekler.
      // Cerez korunarak kapat + tekrar siraya al; sonraki denemede reload toparlar.
      const reason = `Luca runtime toparlanamadi; browser oturumu cerez korunarak sifirlanip is tekrar siraya alindi: ${err.message}`;
      await logJob(jobId, reason).catch(() => {});
      await closeBrowserSession('runtime-recovery').catch(() => {});
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
        // Once SSO main.erp dene — kayitli cerezlerle oturum geri gelir (job
        // akisindaki kanitlanmis yol). Dogrudan login sayfasina GITME; oradan
        // SSO oturumu otomatik toparlanmaz ve gereksiz login denemesine duser.
        await page.goto(LUCA_URLS.main, { waitUntil: 'domcontentloaded', timeout: 60_000 })
          .catch(async () => {
            await page.goto(LUCA_CLASSIC_ENTRY, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
          });
        await page.waitForTimeout(3500).catch(() => {});
      } else {
        // Zaten Luca sayfasındaysa reload et ki yeni eklenen init script çalışsın.
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      }
      // Login sayfasindaysak otomatik giris yap (kimlik + 2captcha) — oturumu
      // proaktif ac ki ilk is hizli olsun + session sicak kalsin. Ayni cooldown +
      // fail-streak korumasi (hesap kilidi riskine karsi).
      if (/giris\.erp|LUCASSO\/login|\/Luca\/giris\.do/i.test(page.url() || '')) {
        if (loginFailStreak < LOGIN_FAIL_MAX && Date.now() - lastLoginAttemptAt >= LOGIN_COOLDOWN_MS) {
          lastLoginAttemptAt = Date.now();
          log.info('Pre-warm: Luca login sayfasi; otomatik giris deneniyor (2captcha)...');
          try {
            await loginToLuca(page);
            loginFailStreak = 0;
            log.info('Pre-warm: otomatik Luca girisi basarili ✓');
            await page.goto(LUCA_URLS.main, { waitUntil: 'domcontentloaded', timeout: 60_000 })
              .catch(async () => {
                await page.goto(LUCA_CLASSIC_ENTRY, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
              });
          } catch (loginErr) {
            loginFailStreak++;
            log.warn(`Pre-warm otomatik giris basarisiz [${loginFailStreak}]: ${loginErr.message}`);
          }
        } else {
          log.info('Pre-warm: otomatik giris atlandi (cooldown/fail-streak); gercek iste tekrar denenecek.');
        }
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

function startPortalWorkerChild(account, index, poolSize = 1, opts = {}) {
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
  // alwaysOn=true → daim açık worker (çökerse geri gelir). intentionalStop → iş
  // bitince BİLEREK kapattığımız on-demand worker; geri açılmaz (monitor gerekirse açar).
  const entry = { child, account, index, alwaysOn: !!opts.alwaysOn, intentionalStop: false };
  portalChildWorkers.set(key, entry);
  log.info(`Portal Luca worker basladi: ${label} (${payload.deviceId})${opts.alwaysOn ? ' [daim açık]' : ' [iş talebiyle]'}`);
  pipeChildOutput(child.stdout, label, (line) => log.info(line));
  pipeChildOutput(child.stderr, label, (line) => log.warn(line));
  child.on('exit', (code, signal) => {
    const wasIntentional = entry.intentionalStop;
    portalChildWorkers.delete(key);
    log.warn(`Portal Luca worker kapandi: ${label} (code=${code ?? '-'}, signal=${signal ?? '-'})${wasIntentional ? ' [boşta kapatıldı]' : ''}`);
    // Yalnız daim-açık worker çökerse otomatik geri gelir. On-demand worker'lar
    // bilerek kapatıldıysa geri açılmaz; iş gelirse monitor döngüsü yeniden açar.
    if (!stopped && !wasIntentional && entry.alwaysOn) {
      setTimeout(() => {
        if (!stopped) startPortalWorkerChild(account, index, poolSize, { alwaysOn: true });
      }, 10_000);
    }
  });
}

/** Boşta olan en yüksek index'li on-demand worker'ı bilerek kapatır. */
function closeOneOnDemandWorker() {
  let target = null;
  for (const [, e] of portalChildWorkers) {
    if (e.alwaysOn) continue;
    if (!target || e.index > target.index) target = e;
  }
  if (target) {
    target.intentionalStop = true;
    try { target.child.kill('SIGTERM'); } catch {}
    log.info(`Boşta ek Luca worker kapatiliyor: ${target.account.displayName || target.index}`);
  }
}

/** Bekleyen işlerdeki AYRI mükellef sayısı (paralelleştirilebilir iş ölçüsü). */
async function countPendingMukellefs() {
  try {
    const { data } = await api.get('/agent/luca/jobs/pending', {
      params: {
        deviceId: BASE_DEVICE_ID,
        version: getCurrentRuntimeVersionForApi(),
        agentVersion: getCurrentRuntimeVersionForApi(),
        ...(OWNER_EMAIL ? { ownerEmail: OWNER_EMAIL } : {}),
        ...(ALSO_UNOWNED ? { alsoUnowned: '1' } : {}),
      },
      timeout: 20_000,
    });
    const jobs = Array.isArray(data) ? data : data?.jobs || [];
    const ids = new Set(
      jobs.filter((j) => JOB_TYPES.has(j.tip || j.type)).map((j) => j.mukellefId || j.id),
    );
    return ids.size;
  } catch {
    return 0;
  }
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

  // ON-DEMAND HAVUZ (kullanıcı talebi): sadece 1 worker DAİM açık; diğerleri iş
  // gelince (bekleyen farklı mükellef sayısına göre) açılır, boşta kalınca kapanır.
  // Böylece durduk yere 5 tarayıcı açılıp 5 captcha çözülmez.
  const ON_DEMAND_IDLE_MS = Math.max(2, Number(cfg.worker?.onDemandIdleMinutes || 5)) * 60_000;
  log.info(`Portal Luca havuzu ON-DEMAND: 1 daim açık, en çok ${selected.length} paralel (iş talebine göre).`);
  startPortalWorkerChild(selected[0], 0, selected.length, { alwaysOn: true });

  let idleSince = 0;
  while (!stopped) {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    try {
      const distinct = await countPendingMukellefs();
      const active = portalChildWorkers.size;
      const desired = Math.min(selected.length, Math.max(1, distinct));
      if (desired > active) {
        // Sıradaki hesabı aç (index = mevcut aktif sayısı).
        const idx = active;
        if (idx < selected.length) {
          startPortalWorkerChild(selected[idx], idx, selected.length, { alwaysOn: idx === 0 });
          log.info(`İş talebi arttı (${distinct} mükellef bekliyor); ek Luca worker açıldı (${active + 1}/${selected.length}).`);
        }
        idleSince = 0;
      } else if (distinct === 0 && active > 1) {
        // Boşta: idle süresi dolunca fazla worker'lardan birini kapat.
        if (!idleSince) idleSince = Date.now();
        else if (Date.now() - idleSince >= ON_DEMAND_IDLE_MS) {
          closeOneOnDemandWorker();
          idleSince = Date.now();
        }
      } else {
        idleSince = 0;
      }
    } catch (err) {
      log.warn(`Havuz monitor hatasi: ${err?.message || err}`);
    }
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
  if (OPERATOR_MODE) {
    log.info('MOD: LUCA OPERATORU — ayri Chrome profili, yalniz operator isleri, komutla acilir.');
  }
  log.info(`Device: ${DEVICE_ID} (${WORKER_NAME})`);
  log.info(
    OWNER_EMAIL
      ? `Sahip (yonlendirme): ${OWNER_EMAIL}${ALSO_UNOWNED ? ' + sahipsiz/otomatik isler' : ''} — yalniz bu panel kullanicisinin isleri yapilir`
      : `Sahip (yonlendirme): YOK — tum bekleyen isler yapilir (eski davranis)`,
  );
  log.info(`Idle TTL: ${Math.round(BROWSER_IDLE_TTL/60000)}dk · Keep-alive: ${Math.round(BROWSER_KEEPALIVE_INTERVAL/60000)}dk`);

  // Agent başlangıcında ilk pre-warm gerçek job yoksa çalışır. Aksi halde
  // aynı Playwright sayfasında iki navigation çakışıp job'u pending bırakabiliyor.
  // Operator modunda tarayici KOMUTLA acilir: ajan basladi diye kendiliginden
  // pencere acmaz (kullanici ekraninda bos Chrome durmasin).
  let initialPreWarmPending = !OPERATOR_MODE;
  // Her sabah PRE_WARM_HOUR'de tekrar
  if (!OPERATOR_MODE) schedulePreWarm();

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
      // 404/connection — sessiz gec, backend henuz print modulunu deploy etmemis olabilir.
      // 502/503/504 — gecici gateway (Railway cold-start vb.); 8sn'de bir tekrar denenir,
      // log'u spam'lemesin (zaten dongu kendini iyilestiriyor).
      const st = err.response?.status;
      if (st && ![404, 502, 503, 504].includes(st)) {
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
  // DUZELTME (2026-06-08): 600MB cok dusuktu ve Node prosesinin RSS'ini olcuyor
  // (asil bellegi ayri Chromium prosesi yiyor). Dusuk limit calisan isi yarida
  // kesip "sacma hata" + gereksiz restart uretiyordu. Limit yukseltildi +
  // config'ten ayarlanabilir; asil temizlik gecelik restart + idle recycle ile.
  // Ayrica AKTIF IS varken kesmiyoruz; sadece bos anda restart -> is yarida kalmaz.
  const LIMIT_MB = Number(cfg.worker?.memoryLimitMb) > 0 ? Number(cfg.worker.memoryLimitMb) : 1500;
  setInterval(() => {
    const mb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    if (mb > LIMIT_MB) {
      if (activeJobsStartTime.size > 0) {
        log.warn(`Self-heal: RAM ${mb}MB > ${LIMIT_MB}MB ama aktif is var; is bitince restart icin bekleniyor.`);
        return;
      }
      log.error(`Self-heal: RAM ${mb}MB > ${LIMIT_MB}MB limit (bos). Proses sonlandiriliyor (watchdog restart edecek).`);
      process.exit(3);
    }
  }, 60_000); // 60sn'de bir
}

// ====================================================================
// SELF-HEAL: Job timeout watcher — is timeout + pay suresini asan jobi abort + restart
// ====================================================================
const activeJobsStartTime = new Map(); // jobId -> startedAt
// DUZELTME (2026-06-08): Watchdog timeout'u her zaman JOB_TIMEOUT'tan (varsayilan
// 15dk) BUYUK olmali. Onceden 10dk SABITti; uzun mesru isler (buyuk e-arsiv/mizan,
// backend ust suresi 15dk) 15dk'lik is timeout'u dolmadan 10dk'da process-kill
// yiyordu = "surekli sacma hata" + gereksiz soguk restart. Artik is timeout + 10dk
// pay; gercekten asili kalan prosesi yine yakalar ama mesru uzun isi kesmez.
const JOB_TIMEOUT_MS = JOB_TIMEOUT + 10 * 60 * 1000;

function startJobTimeoutWatcher() {
  // GERI ALINDI: Onceki "backend status pending/cancelled/failed -> process.exit(6)"
  // hizli-kurtarmasi REGRESYON yaratti. Agent bir isi frame-stuck nedeniyle KENDI
  // requeue edince (recoverTransientLucaLock -> backend 'pending'), bu watchdog
  // 'pending' gorup process'i olduruyor -> SOGUK restart -> yine frame-stuck ->
  // yine 'pending' -> yine restart = OLUM SARMALI. Ayrica kullanici IPTAL edince
  // (cancelled) bile calisan/sicak oturumu olduruyordu. Agent'in kendi yumusak
  // kurtarmalari (closeBrowserSession, profil rotasyonu) zaten var; process kill
  // sadece SON CARE olmali. Bu yuzden yalnizca mutlak 10dk timeout korunuyor.
  setInterval(() => {
    const now = Date.now();
    for (const [jid, startedAt] of activeJobsStartTime) {
      if (now - startedAt > JOB_TIMEOUT_MS) {
        log.error(`Self-heal: Job ${jid} ${Math.round(JOB_TIMEOUT_MS / 60000)}dk+ takildi. Proses sonlandiriliyor (watchdog restart edecek).`);
        api.post(`/agent/luca/jobs/${jid}/requeue`, {
          reason: 'AGENT_SELF_HEAL_TIMEOUT_10MIN',
        }).catch(() => {});
        setTimeout(() => process.exit(4), 2000);
        return;
      }
    }
  }, 30_000); // 30sn'de bir
}

// ====================================================================
// SELF-HEAL: Donma watchdog — ana döngü/iş ilerlemesi durduysa restart
// Memory watcher (RAM) ve job-timeout watcher (yalniz izlenen aktif iş) "döngü
// asili kaldi ama izlenen aktif iş YOK" durumunu yakalamiyordu — 13.06 17:28'de
// işler iptale düşüp izlemeden çiktiktan sonra ajan 75dk sessiz dondu, hiçbiri
// devreye girmedi. Bu watchdog log-heartbeat'ine bakar: ajan uzun süre HİÇBİR log
// yazmadiysa (gerçek donma) prosesi öldürür; wrapper taze ajan başlatir.
// - Boşta (aktif iş yok): 5dk log yoksa = donma (idle loop normalde 30sn'de loglar).
// - Mutlak: aktif iş olsa bile ~30dk hiç log yoksa (job-timeout'tan sonra son çare).
// Pre-warm/uzun mesru işler adim adim loglar → heartbeat taze → yanliş-kill olmaz.
// ====================================================================
function startFreezeWatchdog() {
  const FREEZE_IDLE_MS = 5 * 60 * 1000;                      // boşta 5dk log yoksa
  const FREEZE_HARD_CAP_MS = JOB_TIMEOUT_MS + 5 * 60 * 1000; // mutlak (~30dk) hiç log yoksa
  // AKTİF-İŞ TAKILMA (2026-08-10, kullanıcı isteği "bir daha takılma yaşamayayım"):
  //   Ajan bir işi işlerken (activeJobCount>0) TAKILIRSA eski kod ancak ~30dk'da (hard cap)
  //   kurtarıyordu — çünkü "boşta 5dk" kuralı yalnız aktif-iş YOKken çalışır. Sonuç: kullanıcı
  //   dakikalarca "bir yerde takıldı" görüyordu (örn klasik Luca paketi tıklandı, sayfa açılmadı,
  //   log akmadı). ÇÖZÜM: aktif iş varken de İLERLEME (log heartbeat) 4dk durursa = TAKILDI →
  //   işi tekrar sıraya al + prosesi bitir (wrapper TAZE tarayıcıyla yeniden başlatır, takılı
  //   frame/sayfa gider). Mesru uzun işler adım adım loglar → heartbeat taze → yanlış-kill olmaz.
  const STALL_ACTIVE_MS = 4 * 60 * 1000;
  setInterval(() => {
    if (stopped) return;
    const idleMs = Date.now() - lastAgentProgressAt;
    const frozenIdle = activeJobCount === 0 && idleMs > FREEZE_IDLE_MS;
    const stalledActive = activeJobCount > 0 && idleMs > STALL_ACTIVE_MS; // aktif iş ilerlemiyor
    const frozenHard = idleMs > FREEZE_HARD_CAP_MS;
    if (frozenIdle || stalledActive || frozenHard) {
      const sebep = stalledActive ? 'aktif iş 4dk ilerlemedi (TAKILDI)' : 'hiç ilerleme/log yok (DONMA)';
      log.error(`Self-heal: ${Math.round(idleMs / 60000)}dk ${sebep}. Is tekrar siraya alinip proses bitiriliyor (wrapper TAZE ajan başlatir).`);
      for (const jid of activeJobsStartTime.keys()) {
        api.post(`/agent/luca/jobs/${jid}/requeue`, { reason: stalledActive ? 'AGENT_STALL_WATCHDOG_4MIN' : 'AGENT_FREEZE_WATCHDOG' }).catch(() => {});
      }
      setTimeout(() => process.exit(7), 2000);
    }
  }, 30_000); // 30sn'de bir (daha hızlı yakala)
  log.info(`Donma/takilma watchdog aktif (boşta ${FREEZE_IDLE_MS / 60000}dk · aktif-iş ${STALL_ACTIVE_MS / 60000}dk ilerleme yoksa restart).`);
}

// ====================================================================
// SELF-HEAL: Oturum gardiyani — tarayici acik ama Luca oturumu dustuyse
// (login/captcha sayfasina dustuyse) IS BEKLEMEDEN proaktif tekrar giris yapar.
// Amaç: kullanici HIC manuel mudahale etmesin; ajan her zaman hazir/girisli kalsin.
// - Sadece tarayici acik + oturum dusmus + bos (is yok) iken devreye girer.
// - 90sn cooldown + preWarm'in fail-streak korumasi -> hesap kilidi riski yok.
// - Uzun bekleme (30dk) sonrasi fail-streak'i sifirlar -> gecici 2captcha/captcha
//   kesintisinden de KENDI KENDINE toparlanir (kalici "manuel gerekir" durumu olmaz).
// ====================================================================
const SESSION_GUARD_INTERVAL_MS = 4 * 60 * 1000; // 4 dk
const FAIL_STREAK_RESET_MS = 30 * 60 * 1000;     // 30 dk sonra fail-streak sifirla

function startSessionGuardian() {
  setInterval(async () => {
    try {
      if (stopped) return;
      if (activeJobCount > 0) return;   // calisan is varken karisma
      if (preWarmPromise) return;       // zaten giris/warm suruyor
      if (!browserSession) return;      // tarayici kapali (idle) -> iste acilir, dokunma
      const page = browserSession.page;
      if (!page || page.isClosed()) return;
      const url = page.url() || '';
      const oturumDustu = /giris\.erp|LUCASSO\/login|\/Luca\/giris\.do|captchaKontrol/i.test(url);
      if (!oturumDustu) return;         // oturum saglam -> dokunma
      // Uzun suredir denenmemisse (gecici kesinti gecmis olabilir) fail-streak'i
      // sifirla ki kalici kilitlenmeden tekrar denesin.
      if (loginFailStreak >= LOGIN_FAIL_MAX && Date.now() - lastLoginAttemptAt >= FAIL_STREAK_RESET_MS) {
        log.info(`Session guardian: ${Math.round(FAIL_STREAK_RESET_MS / 60000)}dk gecti; login fail-streak sifirlandi, yeniden deneniyor.`);
        loginFailStreak = 0;
      }
      log.info('Session guardian: Luca oturumu dusmus (login sayfasi); is beklemeden proaktif tekrar giris...');
      await preWarmBrowserSession();
    } catch (e) {
      // sessiz — bir sonraki tick'te tekrar dener
    }
  }, SESSION_GUARD_INTERVAL_MS);
  log.info(`Oturum gardiyani aktif (${SESSION_GUARD_INTERVAL_MS / 60000}dk; dusen oturumu otomatik onarir).`);
}

async function start() {
  acquireSingleInstanceLock();
  const poolStarted = await startPortalWorkerPoolIfAvailable();

  // Print queue loop'u her zaman calişsin — Luca havuzu var/yok fark etmez
  printQueueLoop().catch((err) => log.error(`Print loop fatal: ${err.message}`));

  // SELF-HEAL watcher'lari baslat
  startMemoryWatcher();
  startJobTimeoutWatcher();
  startFreezeWatchdog();
  startSessionGuardian();

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
