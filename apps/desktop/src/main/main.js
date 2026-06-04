'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const api = require('./api');
const store = require('./store');
const { buildLoginScript } = require('./portal-login');
const { appName, isDev } = require('./config');

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1040,
    minHeight: 700,
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
ipcMain.handle('shortcuts:get', async () => api.getShortcuts());

// ─────────────────── PORTAL OTOMATİK GİRİŞ ───────────────────
ipcMain.handle('portal:open', async (_e, { portal, taxpayer }) => {
  if (!portal || !portal.url) return { ok: false, error: 'Portal bilgisi eksik.' };
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
  openPortalWindow(portal, taxpayer, creds);
  return { ok: true };
});

function openPortalWindow(portal, taxpayer, creds) {
  const win = new BrowserWindow({
    width: 1200,
    height: 840,
    backgroundColor: '#ffffff',
    title: `${portal.label}${taxpayer ? ' — ' + taxpayer.ad : ''}`,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `persist:portal-${portal.key}-${taxpayer ? taxpayer.id : 'tenant'}`,
    },
  });
  win.removeMenu();

  const script = buildLoginScript(portal.key, creds, true);
  let injected = false;
  win.webContents.on('did-finish-load', async () => {
    if (injected) return;
    injected = true;
    try {
      await win.webContents.executeJavaScript(script, true);
    } catch {
      /* sayfa içi enjeksiyon hatası yoksayılır */
    }
  });

  win.loadURL(portal.url);
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
