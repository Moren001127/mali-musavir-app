'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const api = require('./api');
const store = require('./store');
const { chromium } = require('playwright-core');
const { publicCatalog, findPortal } = require('./portal-catalog');
const { appName, isDev } = require('./config');

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 980,
    minHeight: 660,
    center: true,
    maximizable: false,
    fullscreenable: false,
    title: appName,
    backgroundColor: '#0a0906',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─────────────────────────── OTURUM ───────────────────────────
ipcMain.handle('auth:remembered', () => {
  const r = store.loadRemember();
  return r ? { email: r.email } : null;
});

ipcMain.handle('auth:autologin', async () => {
  const r = store.loadRemember();
  if (!r) return null;
  const data = await api.login(r.email, r.password);
  return { user: data.user };
});

ipcMain.handle('auth:login', async (_e, { email, password, remember }) => {
  const data = await api.login(email, password);
  if (remember) store.saveRemember({ email, password });
  else store.clearRemember();
  return { user: data.user };
});

ipcMain.handle('auth:logout', () => {
  api.setToken(null);
  store.clearRemember();
  return true;
});

// ─────────────────────────── KISAYOLLAR ───────────────────────────
ipcMain.handle('shortcuts:get', async () => {
  const data = await api.getShortcuts();
  return {
    taxpayers: data.taxpayers || [],
    credentials: data.credentials || { tenant: {}, byTaxpayer: {} },
    portals: publicCatalog(),
  };
});

// ─────────────────── PORTAL OTOMATİK GİRİŞ ───────────────────
ipcMain.handle('portal:open', async (_e, { portalKey, taxpayer }) => {
  const portal = findPortal(portalKey);
  if (!portal) return { ok: false, error: 'Portal bulunamadı.' };
  const isTenant = portal.provider === 'GIB_EBEYANNAME';
  if (!isTenant && !(taxpayer && taxpayer.id)) {
    return { ok: false, error: 'Önce bir firma seçin.' };
  }
  let creds;
  try {
    creds = await api.getCredential(isTenant ? null : taxpayer.id, portal.provider);
  } catch (err) {
    return { ok: false, error: err.message, needCredential: err.status === 404 };
  }
  console.log(
    '[MOREN-PORTAL] ' + portal.key + ' (' + portal.provider + ') alanlar →' +
    ' userCode:' + (creds.userCode ? 'VAR(' + creds.userCode.length + ')' : 'YOK') +
    ' username:' + (creds.username ? 'VAR(' + creds.username.length + ')' : 'YOK') +
    ' password:' + (creds.password ? 'VAR(' + creds.password.length + ')' : 'YOK') +
    ' secondary:' + (creds.secondaryPassword ? 'VAR(' + creds.secondaryPassword.length + ')' : 'YOK'),
  );
  openPortalWindow(portal, taxpayer, creds);
  return { ok: true };
});

// Arayüze (renderer) otomatik giriş durumunu bildirir (çözülüyor / giriş yapıldı / hata).
function sendPortalEvent(key, level, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('portal-event', { key, level, message });
  }
}

// Gömülü Electron penceresi GİB'in React şifre alanına yazamadığı için (kanıtlandı),
// Hattat gibi GERÇEK Chrome/Edge'i playwright-core ile açıp dolduruyoruz. Sistemdeki
// tarayıcı kullanılır (ek indirme yok); kullanıcı adı + şifre + GÜVENLİK KODU otomatik
// dolar ve "Giriş Yap"a basılır. Her firma+portal için kalıcı profil → oturum hatırlanır.
async function openPortalWindow(portal, taxpayer, creds) {
  const profileDir = path.join(
    app.getPath('userData'),
    'tarayici-profilleri',
    `${portal.key}-${taxpayer ? taxpayer.id : 'tenant'}`,
  );
  const launchArgs = ['--no-first-run', '--no-default-browser-check', '--start-maximized'];
  let context = null;
  for (const channel of ['chrome', 'msedge']) {
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        channel,
        headless: false,
        viewport: null,
        args: launchArgs,
      });
      console.log('[PORTAL] tarayici acildi: ' + channel);
      break;
    } catch (e) {
      console.log('[PORTAL] ' + channel + ' acilamadi: ' + e.message);
    }
  }
  if (!context) {
    sendPortalEvent(portal.key, 'err', 'Bilgisayarda Chrome veya Edge bulunamadı. Lütfen birini kurun.');
    return;
  }
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(portal.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await autoLoginPortal(page, portal, creds);
  } catch (e) {
    sendPortalEvent(portal.key, 'warn', portal.label + ': otomatik giriş tamamlanamadı, tarayıcı açık — elle devam edebilirsiniz.');
  }
}

// ── Otomatik giriş motoru ──
// Gerçek Chrome'da: alanları doldur → güvenlik kodunu (captcha) sunucuda çöz →
// "Giriş Yap"a bas → sonucu doğrula. Captcha yanlışsa sayfayı yenileyip en çok 3
// kez dener (yanlış captcha hesabı kilitlemez). Şifre/kullanıcı reddedilirse HEMEN
// durur (hesap kilidini önlemek için tekrar denemez). Mantık, üretimde çalışan
// portal-automation runner'ı ile aynıdır.
const LOGIN_MAX_ATTEMPTS = 3;
const RE_CAPTCHA = /captcha|dogrulama|doğrulama|guvenlik kodu|güvenlik kodu|security code/i;
const RE_LOGIN_ERR = /hatali|hatalı|yanlis|yanlış|gecersiz|geçersiz|blok|kilit|basarisiz|başarısız/i;

async function autoLoginPortal(page, portal, creds) {
  const recipe = portal.recipe || {};
  const isSgk = String(portal.provider || '').startsWith('SGK');
  // SGK güvenlik kodu küçük/bozuk olduğu için 2captcha sık yanılır; yanlış captcha
  // hesabı KİLİTLEMEZ (sadece sayfayı yeniler), bu yüzden SGK'da daha çok deneriz.
  const maxAttempts = isSgk ? 6 : LOGIN_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      try { await page.goto(portal.url, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) { /* yoksay */ }
      await page.waitForTimeout(800);
    }

    // HIZ: güvenlik kodu çözümü (2captcha turu ~5-20 sn, bekletenin ta kendisi)
    // alan doldurma ile PARALEL başlar; kullanıcı tarayıcıda durumu overlay'den görür.
    await page.waitForSelector('input', { state: 'visible', timeout: 20000 }).catch(() => {});
    await showPageOverlay(page, 'Moren: alanlar dolduruluyor…');
    const captchaPromise = solveCaptchaIfPresent(page, recipe, portal);
    await fillLoginFields(page, recipe, creds, isSgk);
    await showPageOverlay(page, 'Moren: güvenlik kodu çözülüyor… (5-20 sn)');
    const captcha = await captchaPromise;
    await showPageOverlay(page, 'Moren: giriş yapılıyor…');
    await submitLogin(page, recipe);
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2200);

    const res = await evaluateLoginResult(page, recipe);
    if (res.ok) {
      await hidePageOverlay(page);
      sendPortalEvent(portal.key, 'ok', portal.label + ': giriş yapıldı ✓');
      return;
    }
    // Bu denemede çözülen captcha yanlış çıktıysa 2captcha'ya bildir (iade).
    if (captcha && captcha.captchaId) api.reportBadCaptcha(captcha.captchaId).catch(() => {});
    if (res.passwordRejected) {
      await hidePageOverlay(page);
      sendPortalEvent(portal.key, 'err', portal.label + ': portal şifresi/kullanıcı kodu reddedildi. Kayıtlı bilgileri kontrol edin.');
      return; // ŞİFRE yanlış → tekrar DENEME YOK (hesap kilidi riski)
    }
    // captcha yanlış / belirsiz → yeniden dene
    if (attempt < maxAttempts) {
      await showPageOverlay(page, 'Moren: güvenlik kodu tutmadı, yeniden deneniyor… (' + attempt + '/' + maxAttempts + ')');
      sendPortalEvent(portal.key, 'info', portal.label + ': güvenlik kodu tutmadı, yeniden deneniyor…');
    }
  }
  await hidePageOverlay(page);
  sendPortalEvent(portal.key, 'warn', portal.label + ': güvenlik kodu otomatik çözülemedi. Tarayıcı açık — kodu elle girip giriş yapabilirsiniz.');
}

// Portal sayfasının köşesinde küçük Moren durum kutusu — kullanıcı ne beklediğini görür.
async function showPageOverlay(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('moren-durum');
    if (!el) {
      el = document.createElement('div');
      el.id = 'moren-durum';
      el.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;background:#15120c;color:#e8cf8f;'
        + 'border:1px solid rgba(212,184,118,.55);border-radius:10px;padding:10px 16px;'
        + 'font:600 13px "Segoe UI",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);pointer-events:none';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = '🔐 ' + t;
  }, text).catch(() => {});
}

async function hidePageOverlay(page) {
  await page.evaluate(() => {
    const el = document.getElementById('moren-durum');
    if (el) el.remove();
  }).catch(() => {});
}

// Kullanıcı/şifre alanlarını doldurur. GİB: kullanıcı kodu + şifre (şifre çoğunlukla
// secondaryPassword'da). SGK: kullanıcı adı + e-kod + sistem şifresi + işyeri şifresi.
async function fillLoginFields(page, recipe, creds, isSgk) {
  // NOT: input görünürlük beklemesi autoLoginPortal'da (captcha çözümüyle paralellik için).
  if (isSgk) {
    await fillField(page, recipe.user, creds.username || creds.userCode);
    if (recipe.workplace) await fillField(page, recipe.workplace, creds.workplaceCode || creds.officeCode);
    await fillField(page, recipe.pass, creds.password || creds.secondaryPassword);
    if (recipe.pass2) await fillField(page, recipe.pass2, creds.secondaryPassword);
  } else {
    await fillField(page, recipe.code, creds.userCode || creds.username);
    await fillField(page, recipe.pass, creds.secondaryPassword || creds.password);
  }
}

async function fillField(page, selectors, value) {
  if (!value || !selectors) return false;
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (!(await loc.isVisible().catch(() => false))) continue;
      await loc.click({ timeout: 2500 }).catch(() => {});
      await loc.fill(String(value));
      return true;
    } catch (e) { /* sonraki seçiciyi dene */ }
  }
  return false;
}

// Sayfada güvenlik kodu (captcha) görseli varsa: yakala → sunucuda çöz → alana yaz.
// Captcha yoksa null döner (e-Arşiv gibi captcha'sız portalları es geçer).
async function solveCaptchaIfPresent(page, recipe, portal) {
  const imgSelectors = recipe.captchaImg || [];
  const inputSelectors = recipe.captcha || [];
  if (!imgSelectors.length || !inputSelectors.length) return null;

  // Görsel geç render edilebilir (paralel çağrıldığımız için) — 3 sn'ye kadar bekle.
  let imgLoc = null;
  for (let tur = 0; tur < 6 && !imgLoc; tur++) {
    for (const sel of imgSelectors) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible().catch(() => false)) { imgLoc = loc; break; }
    }
    if (!imgLoc) await page.waitForTimeout(500);
  }
  if (!imgLoc) return null; // bu portalda captcha yok

  let base64 = '';
  try {
    const src = await imgLoc.evaluate((el) => (el.getAttribute && el.getAttribute('src')) || '').catch(() => '');
    const m = String(src || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (m) base64 = m[1].trim();
    else { const buf = await imgLoc.screenshot({ type: 'png' }); base64 = buf.toString('base64'); }
  } catch (e) { return null; }
  if (!base64) return null;

  sendPortalEvent(portal.key, 'info', portal.label + ': güvenlik kodu çözülüyor…');
  let solved;
  try {
    solved = await api.solveCaptcha(base64);
  } catch (e) {
    sendPortalEvent(portal.key, 'warn', portal.label + ': güvenlik kodu çözücü hatası — ' + (e.message || ''));
    return null;
  }
  const text = solved && solved.text ? String(solved.text).trim() : '';
  if (!text) return solved || null;

  for (const sel of inputSelectors) {
    const loc = page.locator(sel).first();
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 2000 }).catch(() => {});
    await loc.fill(text).catch(() => {});
    break;
  }
  return { text, captchaId: solved && solved.captchaId };
}

async function submitLogin(page, recipe) {
  const selectors = recipe.submit || ['button[type="submit"]', 'input[type="submit"]'];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {}),
        loc.click().catch(() => {}),
      ]);
      return;
    }
  }
  await page.keyboard.press('Enter').catch(() => {});
}

// Giriş sonucunu sınıflandırır:
//  ok=true               → giriş başarılı (form artık yok)
//  passwordRejected=true → şifre/kullanıcı reddedildi → DURDUR (kilit riski)
//  diğer                 → captcha yanlış/belirsiz → güvenli tekrar
async function evaluateLoginResult(page, recipe) {
  if (!(await isLoginFormVisible(page, recipe))) return { ok: true };

  const alert = await visibleAlertText(page);
  const body = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
  const captchaStill = await captchaVisible(page, recipe);

  // Şifre/kullanıcı reddi: hata mesajı VAR ama captcha bağlamı YOK → kesin durdur.
  if (RE_LOGIN_ERR.test(alert) && !RE_CAPTCHA.test(alert)) {
    return { ok: false, passwordRejected: true, info: alert };
  }
  // Captcha görünüyor ya da captcha hatası → tekrar.
  if (captchaStill || RE_CAPTCHA.test(alert) || RE_CAPTCHA.test(body || '')) {
    return { ok: false, passwordRejected: false, info: alert || 'captcha' };
  }
  // Mesaj yok ama form duruyor → büyük olasılıkla captcha → tekrar.
  return { ok: false, passwordRejected: false, info: alert || 'belirsiz' };
}

async function isLoginFormVisible(page, recipe) {
  const userSel = recipe.code || recipe.user || [];
  const passSel = recipe.pass || ['input[type="password"]'];
  const anyVisible = async (selectors) => {
    for (const sel of selectors) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
    }
    return false;
  };
  const user = await anyVisible(userSel);
  const pass = await anyVisible(passSel);
  return user && pass;
}

async function captchaVisible(page, recipe) {
  const sels = [].concat(recipe.captchaImg || [], recipe.captcha || []);
  for (const sel of sels) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
  }
  return false;
}

async function visibleAlertText(page) {
  const selectors = ['[role="alert"]', '.alert', '.error', '.text-danger', '.invalid-feedback', '.notification', '.toast', '.message', '.swal2-html-container'];
  const pieces = [];
  for (const sel of selectors) {
    const loc = page.locator(sel);
    const count = Math.min(await loc.count().catch(() => 0), 5);
    for (let i = 0; i < count; i++) {
      const item = loc.nth(i);
      if (!(await item.isVisible().catch(() => false))) continue;
      const text = (await item.innerText().catch(() => '')).trim();
      if (text && !pieces.includes(text)) pieces.push(text);
    }
  }
  return pieces.join(' | ').slice(0, 500);
}

// ─────────────── BİLDİRİMLER / TEBLİGATLAR / SGK RAPORLARI ───────────────
// Veri kaynağı portal API'si (gece çekilen e-Tebligat + SGK belgeleri + portal
// bildirimleri). Masaüstü ayrı sorgu YAPMAZ; portalla aynı kayıtları gösterir.

ipcMain.handle('docs:list', async (_e, { belgeTuru, limit } = {}) => {
  const qs = new URLSearchParams();
  if (belgeTuru) qs.set('belgeTuru', belgeTuru);
  qs.set('limit', String(limit || 200));
  return api.apiFetch('/portal-automation/documents?' + qs.toString());
});

// Belgeyi (tebligat PDF'i) varsayılan tarayıcıda açar; sunucu ilk açılışta
// "görüntülendi" damgası vurur (buton kalıcı yeşile döner).
ipcMain.handle('docs:open', async (_e, { id }) => {
  const res = await api.apiFetch('/portal-automation/documents/' + encodeURIComponent(id) + '/view');
  const url = res && res.url;
  if (url) await shell.openExternal(url);
  return { ok: !!url, viewedAt: res && res.viewedAt };
});

ipcMain.handle('docs:mark-viewed', async (_e, body) => {
  return api.apiFetch('/portal-automation/documents/mark-viewed', { method: 'POST', body: body || {} });
});

ipcMain.handle('notif:list', async () => {
  return api.apiFetch('/notifications');
});

ipcMain.handle('notif:read-all', async () => {
  return api.apiFetch('/notifications/read-all', { method: 'PATCH', body: {} });
});

ipcMain.handle('notif:read', async (_e, { id }) => {
  return api.apiFetch('/notifications/' + encodeURIComponent(id) + '/read', { method: 'PATCH', body: {} });
});

// ─────────────────────────── WHATSAPP QR ───────────────────────────
ipcMain.handle('wa:status', async () => {
  try {
    return await api.apiFetch('/integrations/whatsapp/qr/status');
  } catch (e) {
    return { connected: false, error: e.message };
  }
});

ipcMain.handle('wa:connect', async () => {
  return api.apiFetch('/integrations/whatsapp/qr/connect', { method: 'POST', body: {} });
});

ipcMain.handle('wa:logout', async () => {
  return api.apiFetch('/integrations/whatsapp/qr/logout', { method: 'POST', body: {} });
});

// ─────────────────────────── UYGULAMA ───────────────────────────
ipcMain.handle('app:version', () => app.getVersion());
