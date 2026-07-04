'use strict';

// Renderer (arayüz) ↔ ana process arasında SINIRLI, güvenli köprü.
// Arayüz yalnızca bu fonksiyonları görür; Node'a veya tokena erişemez.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moren', {
  // Oturum
  rememberedEmail: () => ipcRenderer.invoke('auth:remembered'),
  autoLogin: () => ipcRenderer.invoke('auth:autologin'),
  login: (email, password, remember) => ipcRenderer.invoke('auth:login', { email, password, remember }),
  logout: () => ipcRenderer.invoke('auth:logout'),

  // Veri
  getShortcuts: () => ipcRenderer.invoke('shortcuts:get'),

  // Portal otomatik giriş — şifre arayüze GELMEZ, sadece taxpayer + portal gönderilir
  openPortal: (portalKey, taxpayer) => ipcRenderer.invoke('portal:open', { portalKey, taxpayer }),
  // Otomatik giriş durumu (çözülüyor / giriş yapıldı / hata) bildirimleri
  onPortalEvent: (cb) => ipcRenderer.on('portal-event', (_e, data) => cb(data)),

  // Bildirimler / Tebligatlar / SGK Raporları (portal API'sinden)
  getDocuments: (belgeTuru, limit) => ipcRenderer.invoke('docs:list', { belgeTuru, limit }),
  openDocument: (id) => ipcRenderer.invoke('docs:open', { id }),
  markDocsViewed: (body) => ipcRenderer.invoke('docs:mark-viewed', body),
  getNotifications: () => ipcRenderer.invoke('notif:list'),
  markNotifRead: (id) => ipcRenderer.invoke('notif:read', { id }),
  markAllNotifsRead: () => ipcRenderer.invoke('notif:read-all'),

  // WhatsApp QR
  waStatus: () => ipcRenderer.invoke('wa:status'),
  waConnect: () => ipcRenderer.invoke('wa:connect'),
  waLogout: () => ipcRenderer.invoke('wa:logout'),

  // Uygulama
  appVersion: () => ipcRenderer.invoke('app:version'),
});
