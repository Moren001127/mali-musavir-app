'use strict';

const LOGO_BASE = '../../assets/portal-logolari/';
const api = window.moren;

const state = {
  user: null,
  portals: [],
  taxpayers: [],
  credentials: { tenant: {}, byTaxpayer: {} },
  selected: null, // seçili firma
  waTimer: null,
};

// ───────── yardımcılar ─────────
function $(id) { return document.getElementById(id); }
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function toast(message, type) {
  const wrap = $('toast');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, type === 'err' ? 5000 : 3200);
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

// ───────── açılış ─────────
async function boot() {
  try {
    const res = await api.autoLogin();
    if (res && res.user) { await enterApp(res.user); return; }
  } catch { /* otomatik giriş başarısız → normal giriş */ }
  await showLogin();
}

async function showLogin() {
  hide($('boot'));
  show($('login-view'));
  try {
    const r = await api.rememberedEmail();
    if (r && r.email) $('login-email').value = r.email;
  } catch { /* yoksay */ }
  $('login-email').focus();
}

// ───────── giriş ─────────
function setupLogin() {
  $('eye').addEventListener('click', () => {
    const p = $('login-password');
    p.type = p.type === 'password' ? 'text' : 'password';
  });
  $('remember').addEventListener('click', () => $('remember').classList.toggle('on'));

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    const remember = $('remember').classList.contains('on');
    const errBox = $('login-error');
    errBox.classList.remove('show');
    if (!email || !password) return;

    const btn = $('login-btn');
    btn.disabled = true;
    btn.textContent = 'Giriş yapılıyor…';
    try {
      const res = await api.login(email, password, remember);
      await enterApp(res.user);
    } catch (err) {
      errBox.textContent = err && err.message ? err.message : 'Giriş başarısız. E-posta veya şifre hatalı.';
      errBox.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Giriş Yap &nbsp;&#8594;';
    }
  });
}

// ───────── uygulamaya geç ─────────
async function enterApp(user) {
  state.user = user || {};
  hide($('boot'));
  hide($('login-view'));
  show($('app-view'));

  const setUser = $('set-user');
  if (setUser && user && user.email) setUser.textContent = user.email;

  try { $('set-version').textContent = 'v' + (await api.appVersion()); } catch { /* yoksay */ }

  await loadShortcuts();
}

// ───────── kısayollar ─────────
async function loadShortcuts() {
  try {
    const data = await api.getShortcuts();
    state.portals = data.portals || [];
    state.taxpayers = data.taxpayers || [];
    state.credentials = data.credentials || { tenant: {}, byTaxpayer: {} };
  } catch (err) {
    toast(err.message || 'Veriler alınamadı', 'err');
    return;
  }
  renderFirmaList('');
  renderGrid();
}

function logoHtml(portal) {
  if (portal.logo === '__earsiv__') {
    return '<div class="earsiv-box"><b>E-Arşiv</b><small>Fatura Portal</small></div>';
  }
  return '<img src="' + LOGO_BASE + portal.logo + '" alt="">';
}

function hasCredential(portal) {
  if (portal.provider === 'GIB_EBEYANNAME') return !!state.credentials.tenant[portal.provider];
  if (!state.selected) return null; // firma seçilmemiş
  const byT = state.credentials.byTaxpayer[state.selected.id] || {};
  return !!byT[portal.provider];
}

function renderGrid() {
  const grid = $('portal-grid');
  grid.innerHTML = '';
  for (const portal of state.portals) {
    const cred = hasCredential(portal);
    const card = document.createElement('div');
    card.className = 'kart' + (cred === false ? ' dim' : '');
    let statHtml = '';
    if (state.selected || portal.provider === 'GIB_EBEYANNAME') {
      statHtml = cred
        ? '<span class="stat ok"><span class="d"></span>Şifre kayıtlı</span>'
        : '<span class="stat no"><span class="d"></span>Şifre eksik</span>';
    }
    card.innerHTML = '<div class="klogo">' + logoHtml(portal) + '</div>'
      + '<div class="kname">' + portal.label + '</div>' + statHtml;
    card.addEventListener('click', () => openPortal(portal));
    grid.appendChild(card);
  }
}

async function openPortal(portal) {
  const isTenant = portal.provider === 'GIB_EBEYANNAME';
  if (!isTenant && !state.selected) {
    toast('Önce yukarıdan bir firma seçin.', 'err');
    return;
  }
  const cred = hasCredential(portal);
  if (cred === false) {
    toast(portal.label + ' için bu firmada şifre kayıtlı değil. Portaldan ekleyin.', 'err');
    return;
  }
  toast(portal.label + ' açılıyor, giriş yapılıyor…', 'ok');
  try {
    const res = await api.openPortal(portal.key, state.selected);
    if (!res.ok) {
      toast(res.needCredential ? (portal.label + ' için şifre kayıtlı değil.') : (res.error || 'Açılamadı'), 'err');
    }
  } catch (err) {
    toast(err.message || 'Portal açılamadı', 'err');
  }
}

// ───────── firma seçici ─────────
function renderFirmaList(filter) {
  const list = $('firma-list');
  const f = (filter || '').toLocaleLowerCase('tr');
  list.innerHTML = '';
  const rows = state.taxpayers.filter((t) =>
    !f || (t.ad || '').toLocaleLowerCase('tr').includes(f) || String(t.vkn || '').includes(f));
  if (!rows.length) {
    list.innerHTML = '<div class="opt"><span>Firma bulunamadı</span></div>';
    return;
  }
  for (const t of rows) {
    const opt = document.createElement('div');
    opt.className = 'opt';
    opt.innerHTML = '<b>' + t.ad + '</b><span>VKN ' + (t.vkn || '—') + (t.vergiDairesi ? ' · ' + t.vergiDairesi : '') + '</span>';
    opt.addEventListener('click', () => selectFirma(t));
    list.appendChild(opt);
  }
}

function selectFirma(t) {
  state.selected = t;
  $('firma-name').textContent = t.ad;
  $('firma-meta').textContent = 'VKN ' + (t.vkn || '—') + (t.vergiDairesi ? ' · ' + t.vergiDairesi : '');
  $('firma-av').textContent = initials(t.ad);
  $('firma-dd').classList.remove('open');
  renderGrid();
}

function setupFirmaPicker() {
  $('firma-sel').addEventListener('click', (e) => {
    e.stopPropagation();
    $('firma-dd').classList.toggle('open');
    if ($('firma-dd').classList.contains('open')) $('firma-search').focus();
  });
  $('firma-search').addEventListener('input', (e) => renderFirmaList(e.target.value));
  $('firma-search').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => $('firma-dd').classList.remove('open'));
}

// ───────── navigasyon ─────────
const PAGES = {
  kisayollar: { title: 'Kısayollar', sub: 'Bir firma seçin, ardından portala tek tıkla otomatik girin', firma: true },
  whatsapp: { title: 'WhatsApp', sub: 'Telefonunuzu okutarak gönderimleri uygulama üzerinden yapın', firma: false },
  ayarlar: { title: 'Ayarlar', sub: 'Uygulama bilgisi ve güvenlik', firma: false },
};

function setupNav() {
  document.querySelectorAll('.nv[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => goPage(btn.dataset.page));
  });
}

function goPage(page) {
  document.querySelectorAll('.nv[data-page]').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  ['kisayollar', 'whatsapp', 'ayarlar'].forEach((p) => {
    $('page-' + p).classList.toggle('hidden', p !== page);
  });
  const meta = PAGES[page];
  $('page-title').textContent = meta.title;
  $('page-sub').textContent = meta.sub;

  if (page === 'whatsapp') startWaPoll();
  else stopWaPoll();
}

// ───────── WhatsApp ─────────
function renderWaStatus(s) {
  const stateEl = $('wa-state');
  const qrEl = $('wa-qr');
  if (s && s.connected) {
    stateEl.className = 'state s-ok';
    stateEl.innerHTML = '<span class="d"></span>Bağlı' + (s.phone ? ' · ' + s.phone : '');
    qrEl.innerHTML = '<div class="ph">✓ WhatsApp bağlı. Gönderimler aktif.</div>';
  } else if (s && (s.qrDataUrl || s.qr)) {
    stateEl.className = 'state s-wait';
    stateEl.innerHTML = '<span class="d"></span>QR bekliyor';
    qrEl.innerHTML = '<img src="' + (s.qrDataUrl || s.qr) + '" alt="QR">';
  } else {
    stateEl.className = 'state s-off';
    stateEl.innerHTML = '<span class="d"></span>Bağlantı yok';
  }
}

function startWaPoll() {
  stopWaPoll();
  refreshWa();
  state.waTimer = setInterval(refreshWa, 2800);
}
function stopWaPoll() {
  if (state.waTimer) { clearInterval(state.waTimer); state.waTimer = null; }
}
async function refreshWa() {
  try { renderWaStatus(await api.waStatus()); } catch { /* yoksay */ }
}

function setupWa() {
  $('wa-connect').addEventListener('click', async () => {
    $('wa-qr').innerHTML = '<div class="ph"><div class="spinner"></div></div>';
    try { renderWaStatus(await api.waConnect()); startWaPoll(); }
    catch (err) { toast(err.message || 'QR oluşturulamadı', 'err'); }
  });
  $('wa-logout').addEventListener('click', async () => {
    try { await api.waLogout(); toast('WhatsApp bağlantısı kesildi', 'ok'); refreshWa(); }
    catch (err) { toast(err.message || 'İşlem başarısız', 'err'); }
  });
}

// ───────── çıkış ─────────
function setupLogout() {
  $('logout-btn').addEventListener('click', async () => {
    await api.logout();
    stopWaPoll();
    state.selected = null;
    window.location.reload();
  });
}

// ───────── otomatik giriş bildirimleri ─────────
function setupPortalEvents() {
  if (!api.onPortalEvent) return;
  api.onPortalEvent((ev) => {
    if (!ev || !ev.message) return;
    const type = ev.level === 'ok' ? 'ok' : (ev.level === 'err' ? 'err' : '');
    toast(ev.message, type);
  });
}

// ───────── başlat ─────────
setupLogin();
setupFirmaPicker();
setupNav();
setupWa();
setupLogout();
setupPortalEvents();
boot();
