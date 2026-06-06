'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
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

// Gömülü Electron penceresi GİB'in React şifre alanına yazamadığı için (kanıtlandı),
// Hattat gibi GERÇEK Chrome/Edge'i playwright-core ile açıp dolduruyoruz. Sistemdeki
// tarayıcı kullanılır (ek indirme yok); kullanıcı adı + şifre otomatik dolar, captcha
// kullanıcıya bırakılır. Her firma+portal için kalıcı profil → oturum hatırlanır.
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('portal-error', 'Bilgisayarda Chrome veya Edge bulunamadı. Lütfen birini kurun.');
    }
    return;
  }
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(portal.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await autoFillPortal(page, portal.recipe, creds);
  } catch (e) {
    /* sayfa/doldurma hatası — tarayıcı kullanıcıda açık kalır, elle devam edebilir */
  }
}

// Gerçek Chrome'da giriş formunu doldurur. Playwright fill = gerçek (isTrusted) giriş;
// React/GİB reddetmez (gerçek tarayıcıda doğrulandı). Kullanıcı adı + şifre dolar;
// doğrulama kodu (captcha) kullanıcıya bırakılır.
async function autoFillPortal(page, recipe, creds) {
  async function fill(selectors, value) {
    if (!value || !selectors) return;
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        await loc.waitFor({ state: 'visible', timeout: 8000 });
        await loc.click({ timeout: 3000 }).catch(() => {});
        await loc.fill(String(value));
        return;
      } catch (e) {
        /* sonraki seçiciyi dene */
      }
    }
  }
  await fill(recipe.code, creds.userCode);
  await fill(recipe.user, creds.username);
  await fill(recipe.pass, creds.password || creds.secondaryPassword);
  if (recipe.pass2) await fill(recipe.pass2, creds.secondaryPassword);
}

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
