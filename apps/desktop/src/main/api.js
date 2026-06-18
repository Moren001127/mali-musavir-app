'use strict';

// Portal API istemcisi (ana process). JWT yalnızca burada, bellekte tutulur;
// renderer'a (arayüze) hiç gönderilmez. Çözülmüş şifre de buradan doğrudan
// portal penceresine enjekte edilir, arayüze gitmez.

const { apiBaseUrl } = require('./config');

let accessToken = null;

function setToken(t) { accessToken = t || null; }
function getToken() { return accessToken; }

async function apiFetch(pathname, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  let res;
  try {
    res = await fetch(apiBaseUrl + pathname, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (netErr) {
    const e = new Error('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.');
    e.status = 0;
    e.cause = netErr;
    throw e;
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const raw = (data && data.message) || res.statusText || 'İstek başarısız';
    const e = new Error(Array.isArray(raw) ? raw.join(', ') : String(raw));
    e.status = res.status;
    throw e;
  }
  return data;
}

async function login(email, password) {
  const data = await apiFetch('/auth/login', { method: 'POST', body: { email, password }, auth: false });
  accessToken = data && data.accessToken ? data.accessToken : null;
  if (!accessToken) throw new Error('Giriş yanıtı geçersiz (token yok).');
  return data;
}

async function getShortcuts() {
  return apiFetch('/desktop/shortcuts');
}

async function getCredential(taxpayerId, provider) {
  return apiFetch('/desktop/credential', { method: 'POST', body: { taxpayerId, provider } });
}

// Portal giriş güvenlik kodunu (CAPTCHA) sunucuda çöz. Görsel base64 olarak
// gider; çözücü anahtarı sunucuda kalır. { text, captchaId } döner.
async function solveCaptcha(imageBase64) {
  return apiFetch('/desktop/solve-captcha', { method: 'POST', body: { imageBase64 } });
}

// Yanlış çözülen güvenlik kodunu sunucu üzerinden 2captcha'ya bildir (iade).
async function reportBadCaptcha(captchaId) {
  try { return await apiFetch('/desktop/captcha-bad', { method: 'POST', body: { captchaId } }); }
  catch { return { ok: false }; }
}

module.exports = { apiFetch, login, getShortcuts, getCredential, solveCaptcha, reportBadCaptcha, setToken, getToken };
