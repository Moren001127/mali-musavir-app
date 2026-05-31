const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
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

function createCookieJar() {
  const jar = new Map();
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
  const browser = await chromium.launch({
    headless: false,
    channel: process.env.HATTAT_BROWSER_CHANNEL || undefined,
  });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1365, height: 900 },
    userAgent: BROWSER_UA,
  });
  const page = await context.newPage();
  console.log('Hattat manuel giris penceresi acildi. Lutfen webde giris yapin; Cari Kasa acilinca devam edecegim.');
  await page.goto(CARI_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(async () => {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  });

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500);
    try {
      if (/Account\/Login/i.test(page.url())) continue;
      await page.goto(CARI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
      const html = await page.content();
      if (/CariKasa|FullExcelIndir|Mukellefler/i.test(html)) return { browser, page, html };
    } catch {}
  }
  await browser.close().catch(() => null);
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
      await manual.browser.close().catch(() => null);
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
