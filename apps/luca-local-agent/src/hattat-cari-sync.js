const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const axios = require('axios');
const XLSX = require('xlsx');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const HATTAT_WEB = 'https://www.hattatmusavir.com';
const LOGIN_URL = `${HATTAT_WEB}/Account/Login`;
const CARI_URL = `${HATTAT_WEB}/MaliMusavir/CariKasa`;
const EXCEL_URL = `${HATTAT_WEB}/MaliMusavir/CariKasa/FullExcelIndir`;
const TURNSTILE_SITEKEY = '0x4AAAAAAAyFxohCBfqOIQoq';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

function arg(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((v) => v === `--${name}` || v.startsWith(prefix));
  if (!item) return fallback;
  if (item === `--${name}`) return true;
  return item.slice(prefix.length);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function fmtIstanbulDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function defaultFromDate() {
  return process.env.HATTAT_CARI_DEFAULT_FROM || '1900-01-01';
}

function normalizeText(value) {
  return String(value || '')
    .toLocaleUpperCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' VE ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlDecode(input) {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function extractAntiForgery(html) {
  const a = String(html || '').match(/<input[^>]*name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i);
  if (a) return htmlDecode(a[1]);
  const b = String(html || '').match(/<input[^>]*value=["']([^"']+)["'][^>]*name=["']__RequestVerificationToken["']/i);
  return b ? htmlDecode(b[1]) : null;
}

function assertExcelBuffer(buffer, label) {
  if (buffer.length < 1000) throw new Error(`${label} cevabi bos veya gecersiz`);
  const xlsx = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const xls = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  if (!xlsx && !xls) {
    const preview = buffer.toString('utf8', 0, Math.min(buffer.length, 500)).replace(/\s+/g, ' ').trim();
    throw new Error(`${label} Excel yerine farkli cevap verdi: ${preview.slice(0, 240) || 'icerik okunamadi'}`);
  }
}

function extractInputFields(html) {
  const fields = {};
  const inputRegex = /<input\b[^>]*>/gi;
  const attrRegex = /([a-zA-Z0-9_:-]+)=["']([^"']*)["']/g;
  let input;
  while ((input = inputRegex.exec(String(html || '')))) {
    const attrs = {};
    let attr;
    while ((attr = attrRegex.exec(input[0]))) attrs[attr[1].toLowerCase()] = htmlDecode(attr[2]);
    if (attrs.name) fields[attrs.name] = attrs.value || '';
  }
  return fields;
}

function parseCustomerOptions(html) {
  const select = String(html || '').match(/<select[^>]+id=["']Mukellefler["'][\s\S]*?<\/select>/i)?.[0] || html;
  const map = new Map();
  const optionRegex = /<option[^>]*value=["']?(\d+)["']?[^>]*>([\s\S]*?)<\/option>/gi;
  let match;
  while ((match = optionRegex.exec(select))) {
    const id = String(match[1] || '').trim();
    const name = htmlDecode(match[2].replace(/<[^>]+>/g, ' '));
    if (id && id !== '0' && name) map.set(normalizeText(name), { id, name });
  }
  return map;
}

function readWindowsHattatCredential() {
  const ps = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace CredReadNative {
public class Native {
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct CREDENTIAL {
  public UInt32 Flags;
  public UInt32 Type;
  public string TargetName;
  public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public UInt32 CredentialBlobSize;
  public IntPtr CredentialBlob;
  public UInt32 Persist;
  public UInt32 AttributeCount;
  public IntPtr Attributes;
  public string TargetAlias;
  public string UserName;
}
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
[DllImport("advapi32.dll", SetLastError=true)]
public static extern void CredFree(IntPtr cred);
}
}
'@
$targets = @('username-password-token/hattat-musavir', 'token-rolename/hattat-musavir')
$out = @()
foreach ($target in $targets) {
  $ptr = [IntPtr]::Zero
  if ([CredReadNative.Native]::CredRead($target, 1, 0, [ref]$ptr)) {
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredReadNative.Native+CREDENTIAL])
    $bytes = New-Object byte[] $cred.CredentialBlobSize
    if ($cred.CredentialBlobSize -gt 0) {
      [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
    }
    $raw = [Text.Encoding]::UTF8.GetString($bytes)
    $json = $null
    try { $json = $raw | ConvertFrom-Json } catch {}
    $out += [pscustomobject]@{ target = $target; userName = $cred.UserName; raw = $raw; json = $json }
    [CredReadNative.Native]::CredFree($ptr)
  }
}
$out | ConvertTo-Json -Depth 8 -Compress
`;
  const res = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`Windows Credential Manager okunamadi: ${res.stderr || res.stdout}`);
  const parsed = JSON.parse(res.stdout || '[]');
  const records = Array.isArray(parsed) ? parsed : [parsed];
  const login = records.find((r) => String(r.target || '').includes('username-password-token'));
  let payload = login?.json || null;
  if (!payload && login?.raw) {
    try { payload = JSON.parse(login.raw); } catch {}
  }
  const email = payload?.username || payload?.email || login?.userName || process.env.HATTAT_EMAIL;
  const password = payload?.password || (!payload ? login?.raw : null) || process.env.HATTAT_PASSWORD;
  if (!email || !password) throw new Error('Hattat e-posta/sifre bilgisi bulunamadi');
  return { email, password };
}

function createCookieJar(initialCookies = []) {
  const jar = new Map(initialCookies);
  return {
    header() {
      return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    },
    store(setCookie) {
      const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      for (const item of list) {
        const first = String(item).split(';')[0];
        const idx = first.indexOf('=');
        if (idx > 0) jar.set(first.slice(0, idx), first.slice(idx + 1));
      }
    },
  };
}

function locateChromeExe() {
  const candidates = [
    process.env.HATTAT_CHROME_EXE,
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function openNormalChromeForHattat() {
  const chrome = locateChromeExe();
  if (chrome) {
    spawn(chrome, [CARI_URL], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  spawn('cmd.exe', ['/c', 'start', '', CARI_URL], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

function openCdpChromeForHattat(port) {
  const chrome = locateChromeExe();
  const userDataDir = process.env.HATTAT_CDP_USER_DATA_DIR || path.join(os.homedir(), 'AppData', 'Local', 'MorenHattatCdpChrome');
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--start-maximized',
    CARI_URL,
  ];
  if (chrome) {
    spawn(chrome, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  spawn('cmd.exe', ['/c', 'start', '', 'chrome', ...args], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

function chromeUserDataRoot() {
  return process.env.HATTAT_CHROME_USER_DATA_ROOT || path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
}

function chromeProfileDirs(root) {
  const requested = process.env.HATTAT_CHROME_PROFILE;
  if (requested) return [path.join(root, requested)];
  if (!fs.existsSync(root)) return [];
  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'Network', 'Cookies')) || fs.existsSync(path.join(dir, 'Cookies')));
  const preferred = ['Default', 'Profile 1', 'Profile 2']
    .map((name) => path.join(root, name))
    .filter((dir) => dirs.includes(dir));
  return Array.from(new Set([...preferred, ...dirs]));
}

function decryptDpapiBuffer(buffer) {
  const ps = `
$bytes = [Convert]::FromBase64String($env:DPAPI_B64)
Add-Type -AssemblyName System.Security
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($plain)
`;
  const res = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, DPAPI_B64: buffer.toString('base64') },
    maxBuffer: 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`Chrome DPAPI cozulemedi: ${res.stderr || res.stdout}`);
  return Buffer.from(String(res.stdout || '').trim(), 'base64');
}

function chromeMasterKey(root) {
  const localState = path.join(root, 'Local State');
  if (!fs.existsSync(localState)) return null;
  const state = readJson(localState);
  const encryptedKey = state?.os_crypt?.encrypted_key;
  if (!encryptedKey) return null;
  const raw = Buffer.from(encryptedKey, 'base64');
  const payload = raw.subarray(0, 5).toString() === 'DPAPI' ? raw.subarray(5) : raw;
  return decryptDpapiBuffer(payload);
}

function decryptChromeCookie(record, masterKey) {
  if (record.value) return record.value;
  const encrypted = Buffer.from(record.encryptedValue || '', 'base64');
  if (!encrypted.length) return '';
  const version = encrypted.subarray(0, 3).toString('utf8');
  if ((version === 'v10' || version === 'v11') && masterKey) {
    const nonce = encrypted.subarray(3, 15);
    const ciphertext = encrypted.subarray(15, encrypted.length - 16);
    const tag = encrypted.subarray(encrypted.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
  return decryptDpapiBuffer(encrypted).toString('utf8');
}

function readChromeCookiesFromDb(cookieDb) {
  const copy = path.join(os.tmpdir(), `chrome-cookies-${process.pid}-${Date.now()}.sqlite`);
  fs.copyFileSync(cookieDb, copy);
  const py = `
import base64, json, sqlite3, sys
db = sys.argv[1]
conn = sqlite3.connect(db)
cur = conn.execute("select host_key, name, value, encrypted_value from cookies where host_key like ?", ("%hattatmusavir.com%",))
rows = []
for host, name, value, encrypted in cur.fetchall():
    rows.append({"host": host, "name": name, "value": value or "", "encryptedValue": base64.b64encode(encrypted or b"").decode("ascii")})
print(json.dumps(rows))
`;
  try {
    const res = spawnSync('python', ['-c', py, copy], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
    if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'python sqlite sorgusu basarisiz');
    return JSON.parse(res.stdout || '[]');
  } finally {
    fs.rmSync(copy, { force: true });
  }
}

function readChromeHattatCookies() {
  const root = chromeUserDataRoot();
  const masterKey = chromeMasterKey(root);
  const entries = new Map();
  for (const profile of chromeProfileDirs(root)) {
    const cookieDb = fs.existsSync(path.join(profile, 'Network', 'Cookies'))
      ? path.join(profile, 'Network', 'Cookies')
      : path.join(profile, 'Cookies');
    if (!fs.existsSync(cookieDb)) continue;
    let records = [];
    try {
      records = readChromeCookiesFromDb(cookieDb);
    } catch {
      continue;
    }
    for (const record of records) {
      try {
        const value = decryptChromeCookie(record, masterKey);
        if (record.name && value) entries.set(record.name, value);
      } catch {}
    }
  }
  return Array.from(entries.entries());
}

async function loginAndOpenCariChromeCookies() {
  openNormalChromeForHattat();
  console.log('Normal Chrome acildi. Hattat girisini/dogrulamayi normal Chrome uzerinden tamamlayin; oturum gorulunce Excel otomatik alinacak.');
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastError = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const cookies = readChromeHattatCookies();
      if (!cookies.length) continue;
      const jar = createCookieJar(cookies);
      const cari = await requestWithCookies(jar, 'GET', CARI_URL, { timeout: 60000 });
      const html = String(cari.data || '');
      if (cari.status >= 300 || /Account\/Login/i.test(String(cari.headers.location || '')) || /Account\/Login/i.test(html)) continue;
      if (/CariKasa|FullExcelIndir|Mukellefler/i.test(html)) return { jar, html };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Normal Chrome Hattat oturumu alinamadi${lastError ? `: ${lastError.message || lastError}` : ''}`);
}

async function cdpTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  if (!res.ok) throw new Error(`CDP hedefleri okunamadi: HTTP ${res.status}`);
  return res.json();
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let seq = 0;
    const timer = setTimeout(() => reject(new Error('CDP baglanti zaman asimi')), 15000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({
        call(method, params = {}) {
          const id = ++seq;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { res, rej }));
        },
        close() {
          try { ws.close(); } catch {}
        },
      });
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !pending.has(msg.id)) return;
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) entry.rej(new Error(msg.error.message || JSON.stringify(msg.error)));
      else entry.res(msg.result);
    });
    ws.addEventListener('error', () => reject(new Error('CDP websocket hatasi')));
  });
}

async function loginAndOpenCariCdp() {
  const port = Number(arg('cdp-port', process.env.HATTAT_CDP_PORT || 9333));
  openCdpChromeForHattat(port);
  console.log(`Normal Chrome acildi (CDP port ${port}). Hattat'a normal sekmede giris yapin; Cari Kasa gorulunce otomatik devam edecegim.`);
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastError = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    let client = null;
    try {
      const targets = await cdpTargets(port);
      const pageTarget =
        targets.find((t) => t.type === 'page' && /hattatmusavir\.com\/MaliMusavir\/CariKasa/i.test(t.url || '')) ||
        targets.find((t) => t.type === 'page' && /hattatmusavir\.com/i.test(t.url || '')) ||
        targets.find((t) => t.type === 'page');
      if (!pageTarget?.webSocketDebuggerUrl) continue;
      client = await cdpConnect(pageTarget.webSocketDebuggerUrl);
      await client.call('Runtime.enable').catch(() => null);
      await client.call('Page.enable').catch(() => null);
      const state = await client.call('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => ({ url: location.href, html: document.documentElement.outerHTML.slice(0, 200000) }))()`,
      });
      const value = state?.result?.value || {};
      if (!/hattatmusavir\.com/i.test(value.url || '')) {
        await client.call('Page.navigate', { url: CARI_URL }).catch(() => null);
        client.close();
        continue;
      }
      if (!/CariKasa/i.test(value.url || '')) {
        if (!/Account\/Login/i.test(value.url || '')) {
          await client.call('Page.navigate', { url: CARI_URL }).catch(() => null);
        }
        client.close();
        continue;
      }
      if (/CariKasa|FullExcelIndir|Mukellefler/i.test(value.html || '')) {
        return { client, html: value.html };
      }
      client.close();
    } catch (err) {
      lastError = err;
      if (client) client.close();
    }
  }
  throw new Error(`Hattat normal Chrome girisi alinamadi${lastError ? `: ${lastError.message || lastError}` : ''}`);
}

async function solveTurnstile(apiKey) {
  if (!apiKey) throw new Error('TWOCAPTCHA_API_KEY tanimli degil');
  const params = new URLSearchParams({
    key: apiKey,
    method: 'turnstile',
    sitekey: TURNSTILE_SITEKEY,
    pageurl: LOGIN_URL,
    userAgent: BROWSER_UA,
    json: '1',
  });
  const submit = await axios.post('https://2captcha.com/in.php', params, { timeout: 30000 });
  if (submit.data?.status !== 1) throw new Error(`2captcha baslatilamadi: ${submit.data?.request || 'bilinmeyen hata'}`);
  const id = submit.data.request;
  for (let i = 0; i < 36; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const poll = await axios.get('https://2captcha.com/res.php', {
      params: { key: apiKey, action: 'get', id, json: 1 },
      timeout: 30000,
    });
    if (poll.data?.status === 1) return poll.data.request;
    if (poll.data?.request !== 'CAPCHA_NOT_READY') throw new Error(`2captcha hata: ${poll.data?.request || 'bilinmeyen hata'}`);
  }
  throw new Error('2captcha zaman asimi');
}

async function requestWithCookies(jar, method, url, options = {}) {
  const headers = {
    'User-Agent': BROWSER_UA,
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    ...(options.headers || {}),
  };
  const cookie = jar.header();
  if (cookie) headers.Cookie = cookie;
  const res = await axios.request({
    method,
    url,
    data: options.data,
    headers,
    responseType: options.responseType,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
    timeout: options.timeout || 120000,
  });
  jar.store(res.headers['set-cookie']);
  return res;
}

async function loginAndOpenCari() {
  const credential = readWindowsHattatCredential();
  const jar = createCookieJar();
  const loginPage = await requestWithCookies(jar, 'GET', LOGIN_URL);
  const hiddenFields = extractInputFields(loginPage.data);
  const token = hiddenFields.__RequestVerificationToken || extractAntiForgery(loginPage.data);
  if (!token) throw new Error('Hattat login dogrulama tokeni bulunamadi');
  const captcha = await solveTurnstile(process.env.TWOCAPTCHA_API_KEY);
  const body = new URLSearchParams({
    ...hiddenFields,
    __RequestVerificationToken: token,
    Email: credential.email,
    Password: credential.password,
    RememberMe: 'true',
    CaptchaToken: captcha,
    'cf-turnstile-response': captcha,
  });
  const loginResult = await requestWithCookies(jar, 'POST', LOGIN_URL, {
    data: body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: LOGIN_URL },
  });
  if (loginResult.status === 200 && String(loginResult.data || '').includes('Account/Login')) {
    const compact = String(loginResult.data || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const message = compact.match(/(hatalı|hatali|captcha|güvenlik|guvenlik|şifre|sifre|kullanıcı|kullanici)[^.]{0,180}/i)?.[0];
    throw new Error(`Hattat login basarisiz${message ? `: ${message}` : ''}`);
  }
  const cari = await requestWithCookies(jar, 'GET', CARI_URL);
  if (!String(cari.data || '').includes('CariKasa')) {
    const title = String(cari.data || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
    throw new Error(`Hattat Cari Kasa sayfasi acilamadi (status=${cari.status}, location=${cari.headers.location || '-'}, title=${title || '-'})`);
  }
  return { jar, html: cari.data };
}

async function downloadFullExcel(jar, cariHtml, from, to) {
  const token = extractAntiForgery(cariHtml);
  if (!token) throw new Error('Cari Kasa Excel tokeni bulunamadi');
  const body = new URLSearchParams({
    __RequestVerificationToken: token,
    excelCusID: '0',
    excelBeginDate: from,
    excelEndDate: to,
    excelBakiyeSifir: 'false',
  });
  const res = await requestWithCookies(jar, 'POST', EXCEL_URL, {
    data: body,
    responseType: 'arraybuffer',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: CARI_URL,
      __RequestVerificationToken: token,
    },
    timeout: 180000,
  });
  const buffer = Buffer.from(res.data);
  assertExcelBuffer(buffer, 'Hattat');
  return buffer;
}

async function loginAndOpenCariManual() {
  const { chromium } = require('playwright');
  const userDataDir = process.env.HATTAT_CHROME_USER_DATA_DIR || path.join(os.homedir(), 'AppData', 'Local', 'MorenHattatChrome');
  const launchOptions = {
    headless: false,
    channel: process.env.HATTAT_BROWSER_CHANNEL || 'chrome',
    acceptDownloads: true,
    viewport: null,
    userAgent: BROWSER_UA,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  } catch (err) {
    console.log(`Chrome profili acilamadi, Playwright Chromium ile deneniyor: ${err.message || err}`);
    context = await chromium.launchPersistentContext(userDataDir, { ...launchOptions, channel: undefined });
  }
  const page = await context.newPage();
  console.log(`Hattat manuel giris penceresi acildi (${userDataDir}). Lutfen webde giris yapin; Cari Kasa acilinca devam edecegim.`);
  await page.goto(CARI_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(async () => {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  });

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500);
    try {
      if (page.isClosed()) throw new Error('Hattat manuel giris penceresi kapatildi');
      if (/Account\/Login/i.test(page.url())) continue;
      await page.goto(CARI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
      const html = await page.content();
      if (/CariKasa|FullExcelIndir|Mukellefler/i.test(html)) return { context, page, html };
    } catch {}
  }
  await context.close().catch(() => null);
  throw new Error('Hattat manuel giris zaman asimi');
}

async function downloadFullExcelWithPage(page, cariHtml, from, to) {
  const token = extractAntiForgery(cariHtml) || await page.locator('input[name="__RequestVerificationToken"]').inputValue().catch(() => null);
  if (!token) throw new Error('Cari Kasa Excel tokeni bulunamadi');
  const result = await page.evaluate(async ({ url, fromDate, toDate, antiForgery }) => {
    const form = new URLSearchParams({
      __RequestVerificationToken: antiForgery,
      excelCusID: '0',
      excelBeginDate: fromDate,
      excelEndDate: toDate,
      excelBakiyeSifir: 'false',
    });
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        __RequestVerificationToken: antiForgery,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: form.toString(),
    });
    const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      bytes,
    };
  }, { url: EXCEL_URL, fromDate: from, toDate: to, antiForgery: token });
  if (!result.ok) throw new Error(`Hattat Excel indirilemedi: HTTP ${result.status}`);
  const buffer = Buffer.from(result.bytes);
  assertExcelBuffer(buffer, 'Hattat');
  return buffer;
}

async function downloadFullExcelWithCdp(client, cariHtml, from, to) {
  const token = extractAntiForgery(cariHtml);
  if (!token) throw new Error('Cari Kasa Excel tokeni bulunamadi');
  const expression = `(${async ({ url, fromDate, toDate, antiForgery }) => {
    const form = new URLSearchParams({
      __RequestVerificationToken: antiForgery,
      excelCusID: '0',
      excelBeginDate: fromDate,
      excelEndDate: toDate,
      excelBakiyeSifir: 'false',
    });
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        __RequestVerificationToken: antiForgery,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: form.toString(),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunk));
    }
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      base64: btoa(binary),
    };
  }})(${JSON.stringify({ url: EXCEL_URL, fromDate: from, toDate: to, antiForgery: token })})`;
  const result = await client.call('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  const value = result?.result?.value || {};
  if (!value.ok) throw new Error(`Hattat Excel indirilemedi: HTTP ${value.status || 'bilinmiyor'}`);
  const buffer = Buffer.from(value.base64 || '', 'base64');
  assertExcelBuffer(buffer, 'Hattat');
  return buffer;
}

function headerKey(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function findColumn(headers, patterns) {
  return headers.findIndex((h) => patterns.some((p) => h.includes(p)));
}

function parseHattatExcel(buffer, customerMap) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });
  const headerRow = table.findIndex((row) => row.map(headerKey).includes('TARIH'));
  if (headerRow < 0) throw new Error('Hattat Excel baslik satiri bulunamadi');
  const headers = table[headerRow].map(headerKey);
  const idx = {
    date: findColumn(headers, ['TARIH']),
    taxpayerName: findColumn(headers, ['MUKELLEF ADI', 'MUKELLEF']),
    serviceType: findColumn(headers, ['HIZMET TURU']),
    collectionType: findColumn(headers, ['TAHSILAT TURU']),
    description: findColumn(headers, ['ACIKLAMA']),
    debit: findColumn(headers, ['BORC HIZMET', 'BORC']),
    credit: findColumn(headers, ['ALACAK TAHSILAT', 'ALACAK']),
    rawBalance: findColumn(headers, ['BAKIYE']),
  };
  if (idx.date < 0 || idx.taxpayerName < 0 || idx.debit < 0 || idx.credit < 0) {
    throw new Error('Hattat Excel kolonlari beklenen formatta degil');
  }
  const rows = [];
  for (let r = headerRow + 1; r < table.length; r++) {
    const row = table[r] || [];
    const taxpayerName = String(row[idx.taxpayerName] || '').trim();
    if (!taxpayerName) continue;
    const option = customerMap.get(normalizeText(taxpayerName));
    rows.push({
      sourceRowNo: r + 1,
      hattatCustomerId: option?.id || null,
      taxpayerName,
      date: row[idx.date] || null,
      serviceType: idx.serviceType >= 0 ? row[idx.serviceType] || null : null,
      collectionType: idx.collectionType >= 0 ? row[idx.collectionType] || null : null,
      description: idx.description >= 0 ? row[idx.description] || null : null,
      debit: row[idx.debit] || null,
      credit: row[idx.credit] || null,
      rawBalance: idx.rawBalance >= 0 ? row[idx.rawBalance] || null : null,
    });
  }
  return rows;
}

async function postImport(config, rows, from, to, dryRun) {
  const baseUrl = String(arg('api-url', config.api?.baseUrl || '')).replace(/\/+$/, '');
  const token = arg('agent-token', config.api?.agentToken || process.env.AGENT_TOKEN);
  if (!baseUrl || !token) throw new Error('api.baseUrl ve api.agentToken gerekli');
  const importBatchId = crypto.createHash('sha1').update(`hattat-cari|${from}|${to}|${Date.now()}`).digest('hex');
  const res = await axios.post(`${baseUrl}/agent/cari-kasa/hattat/import`, {
    beginDate: from,
    endDate: to,
    importBatchId,
    dryRun,
    rows,
  }, {
    headers: { 'x-agent-token': token },
    timeout: 180000,
  });
  return res.data;
}

async function main() {
  const appRoot = path.resolve(__dirname, '..');
  const config = readJson(path.join(appRoot, 'config.json'));
  const from = String(arg('from', defaultFromDate()));
  const to = String(arg('to', fmtIstanbulDate(new Date())));
  const dryRun = Boolean(arg('dry-run', false));
  const fileArg = arg('file', '');
  const manualLogin = Boolean(arg('manual-login', false));
  const chromeLogin = Boolean(arg('chrome-login', false));
  const cdpLogin = Boolean(arg('cdp-login', false));
  let customerMap = new Map();
  let excel;
  let outFile;
  if (fileArg) {
    outFile = path.resolve(String(fileArg));
    excel = fs.readFileSync(outFile);
    const htmlArg = arg('html', path.join(os.tmpdir(), 'hattat-cari-kasa.html'));
    if (htmlArg && fs.existsSync(String(htmlArg))) {
      customerMap = parseCustomerOptions(fs.readFileSync(String(htmlArg), 'utf8'));
    }
  } else if (manualLogin) {
    const manual = await loginAndOpenCariManual();
    try {
      customerMap = parseCustomerOptions(manual.html);
      excel = await downloadFullExcelWithPage(manual.page, manual.html, from, to);
    } finally {
      await manual.context.close().catch(() => null);
    }
  } else if (chromeLogin) {
    const { jar, html } = await loginAndOpenCariChromeCookies();
    customerMap = parseCustomerOptions(html);
    excel = await downloadFullExcel(jar, html, from, to);
  } else if (cdpLogin) {
    const cdp = await loginAndOpenCariCdp();
    try {
      customerMap = parseCustomerOptions(cdp.html);
      excel = await downloadFullExcelWithCdp(cdp.client, cdp.html, from, to);
    } finally {
      cdp.client.close();
    }
  } else {
    const { jar, html } = await loginAndOpenCari();
    customerMap = parseCustomerOptions(html);
    excel = await downloadFullExcel(jar, html, from, to);
  }
  const outDir = path.join(os.tmpdir(), 'moren-hattat');
  fs.mkdirSync(outDir, { recursive: true });
  if (!outFile) {
    outFile = path.join(outDir, `hattat-cari-${from}_${to}.xlsx`);
    fs.writeFileSync(outFile, excel);
  }
  const rows = parseHattatExcel(excel, customerMap);
  if (arg('download-only', false)) {
    console.log(JSON.stringify({
      ok: true,
      from,
      to,
      excelFile: outFile,
      excelRows: rows.length,
      customerOptions: customerMap.size,
    }, null, 2));
    return;
  }
  const result = await postImport(config, rows, from, to, dryRun);
  console.log(JSON.stringify({
    ok: true,
    from,
    to,
    excelFile: outFile,
    excelRows: rows.length,
    import: result,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message || String(err) }, null, 2));
  process.exit(1);
});
