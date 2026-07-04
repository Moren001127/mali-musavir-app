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
  inboxTimer: null,
  tebligatlar: [],
  raporlar: [],
  bildirimler: [],
  filters: { teb: '', rap: '', bil: '' },
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
  const meMail = $('me-mail');
  if (meMail && user && user.email) meMail.textContent = user.email;
  const meName = $('me-name');
  const adSoyad = user && (user.name || user.fullName || (user.firstName ? (user.firstName + ' ' + (user.lastName || '')).trim() : ''));
  if (meName && adSoyad) meName.textContent = adSoyad;
  const meAv = $('me-av');
  if (meAv) meAv.textContent = initials(adSoyad || (user && user.email) || 'M');

  try { $('set-version').textContent = 'v' + (await api.appVersion()); } catch { /* yoksay */ }

  await loadShortcuts();
  refreshInbox(); // bildirim/tebligat/rapor rozetleri (arka planda)
  if (state.inboxTimer) clearInterval(state.inboxTimer);
  state.inboxTimer = setInterval(refreshInbox, 5 * 60 * 1000);
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
  restoreSelectedFirma();
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
    // Yazı yok — köşede renkli nokta: yeşil=şifre kayıtlı, kırmızı=eksik (istek 2026-07-05).
    let statHtml = '';
    if (state.selected || portal.provider === 'GIB_EBEYANNAME') {
      statHtml = cred
        ? '<span class="stat-dot ok" title="Şifre kayıtlı"></span>'
        : '<span class="stat-dot no" title="Şifre kayıtlı değil"></span>';
    }
    card.innerHTML = statHtml + '<div class="klogo">' + logoHtml(portal) + '</div>'
      + '<div class="kname">' + portal.label + '</div>';
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
    const secili = state.selected && state.selected.id === t.id;
    const opt = document.createElement('div');
    opt.className = 'opt' + (secili ? ' secili' : '');
    opt.innerHTML = '<div class="oav">' + initials(t.ad) + '</div>'
      + '<div class="otx"><b>' + t.ad + '</b><span>VKN ' + (t.vkn || '—') + (t.vergiDairesi ? ' · ' + t.vergiDairesi : '') + '</span></div>'
      + (secili ? '<span class="otik">&#10003;</span>' : '');
    opt.addEventListener('click', () => selectFirma(t));
    list.appendChild(opt);
  }
}

function selectFirma(t) {
  state.selected = t;
  $('firma-label').textContent = 'Seçili firma';
  $('firma-name').textContent = t.ad;
  $('firma-meta').textContent = 'VKN ' + (t.vkn || '—') + (t.vergiDairesi ? ' · ' + t.vergiDairesi : '');
  $('firma-av').textContent = initials(t.ad);
  $('firma-btn').innerHTML = 'Değiştir <span class="car">&#9662;</span>';
  $('firma-dd').classList.remove('open');
  // Seçimi hatırla — pencere yenilense/yeniden odaklansa da firma seçili kalsın.
  try { localStorage.setItem('moren-selected-firma', t.id); } catch { /* yoksay */ }
  renderGrid();
}

// Önceki oturumda seçili firmayı (varsa) geri getir.
function restoreSelectedFirma() {
  let id = null;
  try { id = localStorage.getItem('moren-selected-firma'); } catch { /* yoksay */ }
  if (!id) return;
  const t = state.taxpayers.find((x) => x.id === id);
  if (t) selectFirma(t);
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
  bildirimler: { title: 'Bildirimler', sub: 'Portala düşen tüm bildirimler — okunmamışlar işaretli', firma: false },
  tebligatlar: { title: 'Tebligatlar', sub: 'Gece sorgularında bulunan e-Tebligatlar — belgeye tıklayınca PDF açılır', firma: false },
  raporlar: { title: 'SGK Raporları', sub: 'SGK vizite / iş göremezlik raporları', firma: false },
  whatsapp: { title: 'WhatsApp', sub: 'Telefonunuzu okutarak gönderimleri uygulama üzerinden yapın', firma: false },
  ayarlar: { title: 'Ayarlar', sub: 'Uygulama bilgisi ve güvenlik', firma: false },
};
const PAGE_KEYS = Object.keys(PAGES);

function setupNav() {
  document.querySelectorAll('.nv[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => goPage(btn.dataset.page));
  });
}

function goPage(page) {
  document.querySelectorAll('.nv[data-page]').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  PAGE_KEYS.forEach((p) => {
    const el = $('page-' + p);
    if (el) el.classList.toggle('hidden', p !== page);
  });
  // Üst başlık bandı kaldırıldı (kullanıcı isteği 2026-07-05) — alan içeriğe kaldı.
  if (page === 'whatsapp') startWaPoll();
  else stopWaPoll();
  if (page === 'bildirimler' || page === 'tebligatlar' || page === 'raporlar') refreshInbox();
}

// ───────── Bildirimler / Tebligatlar / SGK Raporları ─────────
// Yalnız gerçek rapor/vizite türleri — SGK_TAHAKKUK ve SGK_HIZMET_LISTESI aylık
// yüzlerce belge üretip sekmeyi boğuyordu (canlı test 2026-07-05); onlar portalda.
const RAPOR_TURLERI = 'SGK_ISGOREMEZLIK,SGK_ISE_GIRIS,SGK_ISTEN_CIKIS';

function fmtTarih(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function taxpayerAd(t) {
  if (!t) return 'Mükellef';
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ').trim() || t.taxNumber || 'Mükellef';
}

async function refreshInbox() {
  try {
    const [teb, rap, bil] = await Promise.all([
      api.getDocuments('E_TEBLIGAT', 200).catch(() => []),
      api.getDocuments(RAPOR_TURLERI, 200).catch(() => []),
      api.getNotifications().catch(() => []),
    ]);
    state.tebligatlar = Array.isArray(teb) ? teb : [];
    state.raporlar = Array.isArray(rap) ? rap : [];
    state.bildirimler = Array.isArray(bil) ? bil : [];
  } catch { /* ağ hatası — rozetler eski kalır */ }
  updateBadges();
  renderTebligatlar();
  renderRaporlar();
  renderBildirimler();
}

function setBadge(id, count) {
  const el = $(id);
  if (!el) return;
  el.textContent = count > 99 ? '99+' : String(count);
  el.classList.toggle('hidden', !(count > 0));
}

function updateBadges() {
  setBadge('badge-tebligatlar', state.tebligatlar.filter((d) => !d.viewedAt).length);
  setBadge('badge-raporlar', state.raporlar.filter((d) => !d.viewedAt).length);
  setBadge('badge-bildirimler', state.bildirimler.filter((n) => !n.isRead).length);
}

function counterHtml(total, okunmus, okunmamis) {
  return '<span class="cnt c-tot">+' + total + '</span>'
    + '<span class="cnt c-ok">&#128065; ' + okunmus + '</span>'
    + '<span class="cnt c-no">&#10060; ' + okunmamis + '</span>';
}

function applyReadFilter(rows, filter, isReadFn) {
  if (filter === 'unread') return rows.filter((r) => !isReadFn(r));
  if (filter === 'read') return rows.filter((r) => isReadFn(r));
  return rows;
}

// Tebligat + SGK raporu kartları aynı iskelet: kurum rozeti + mükellef + tarihler + göz.
function docCardHtml(d, tur) {
  const raw = d.raw && typeof d.raw === 'object' ? d.raw : {};
  const okundu = !!d.viewedAt;
  const kurum = raw.kurumAciklama || raw.altKurum || (tur === 'teb' ? 'e-Tebligat' : 'SGK');
  const firma = taxpayerAd(d.taxpayer);
  const satirlar = [];
  if (tur === 'teb') {
    satirlar.push(['V.D. gönderilme', fmtTarih(d.issuedAt)]);
    if (raw.tebligZamani) satirlar.push(['Tebliğ tarihi', String(raw.tebligZamani)]);
    satirlar.push(['Açıklama', d.title || raw.belgeTuruAciklama || 'Tebligat']);
    if (d.referenceNo) satirlar.push(['Belge no', d.referenceNo]);
  } else {
    satirlar.push(['Belge', d.title || d.belgeTuru]);
    if (raw.vaka || raw.vakaAdi) satirlar.push(['Vaka', raw.vaka || raw.vakaAdi]);
    if (raw.tcKimlikNo || raw.adSoyad) satirlar.push(['Kişi', [raw.tcKimlikNo, raw.adSoyad].filter(Boolean).join(' — ')]);
    if (raw.raporBaslangic || raw.raporBaslamaTarihi) satirlar.push(['Rapor başlama', fmtTarih(raw.raporBaslangic || raw.raporBaslamaTarihi)]);
    if (raw.isBasiKontrol || raw.isBasiKontrolTarihi) satirlar.push(['İş başı kontrol', fmtTarih(raw.isBasiKontrol || raw.isBasiKontrolTarihi)]);
    if (d.period) satirlar.push(['Dönem', d.period]);
    satirlar.push(['Tarih', fmtTarih(d.issuedAt || d.receivedAt || d.createdAt)]);
  }
  const rowsHtml = satirlar
    .map(([k, v]) => '<div class="dr"><span>' + k + ':</span><b>' + String(v) + '</b></div>')
    .join('');
  return '<div class="doc-card' + (okundu ? '' : ' unread') + '" data-id="' + d.id + '">'
    + '<div class="doc-head">'
    +   '<span class="kbadge">' + kurum + '</span>'
    +   '<button class="eye ' + (okundu ? 'seen' : 'new') + '" data-act="' + (d.storageKey ? 'open' : 'seen') + '" data-id="' + d.id + '" title="'
    +     (d.storageKey ? 'Belgeyi aç (PDF)' : 'Görüldü işaretle') + '">' + (okundu ? '&#128065;' : '&#128064;') + '</button>'
    + '</div>'
    + '<div class="doc-firma">' + firma + '</div>'
    + '<div class="doc-rows">' + rowsHtml + '</div>'
    + '</div>';
}

function bindDocActions(listEl) {
  listEl.querySelectorAll('.eye').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      try {
        if (btn.dataset.act === 'open') {
          btn.innerHTML = '&#8987;';
          await api.openDocument(id); // sunucu görüntülendi damgası vurur + PDF açılır
        } else {
          await api.markDocsViewed({ ids: [id] });
        }
        await refreshInbox();
      } catch (err) {
        toast(err.message || 'Belge açılamadı', 'err');
        refreshInbox();
      }
    });
  });
}

function renderTebligatlar() {
  const list = $('teb-list');
  if (!list) return;
  const rows = applyReadFilter(state.tebligatlar, state.filters.teb, (d) => !!d.viewedAt);
  $('teb-counters').innerHTML = counterHtml(
    state.tebligatlar.length,
    state.tebligatlar.filter((d) => d.viewedAt).length,
    state.tebligatlar.filter((d) => !d.viewedAt).length,
  );
  list.innerHTML = rows.length
    ? rows.map((d) => docCardHtml(d, 'teb')).join('')
    : '<div class="empty">Bu filtrede tebligat yok. Gece sorguları yeni tebligat bulursa burada görünür.</div>';
  bindDocActions(list);
}

function renderRaporlar() {
  const list = $('rap-list');
  if (!list) return;
  const rows = applyReadFilter(state.raporlar, state.filters.rap, (d) => !!d.viewedAt);
  $('rap-counters').innerHTML = counterHtml(
    state.raporlar.length,
    state.raporlar.filter((d) => d.viewedAt).length,
    state.raporlar.filter((d) => !d.viewedAt).length,
  );
  list.innerHTML = rows.length
    ? rows.map((d) => docCardHtml(d, 'rap')).join('')
    : '<div class="empty">Bu filtrede SGK kaydı yok.</div>';
  bindDocActions(list);
}

const BIL_TIP_ETIKET = {
  E_TEBLIGAT: ['📨', 'e-Tebligat'],
  TAX_DEADLINE: ['⏰', 'Vergi süresi'],
  PORTAL_CREDENTIAL_FAIL: ['🔑', 'Şifre hatası'],
  LUCA_SYNC_ERROR: ['🔴', 'Luca'],
  AI_COST_LIMIT: ['💰', 'AI maliyet'],
  AUTH_NEW_DEVICE: ['🖥️', 'Yeni cihaz'],
  PENDING_DECISION: ['❓', 'Onay bekliyor'],
  BANK_TRANSACTION_ALERT: ['🏦', 'Banka'],
  INVOICE_OVERDUE: ['🧾', 'Fatura'],
  TASK_DUE: ['📌', 'Görev'],
  WHATSAPP: ['💬', 'WhatsApp'],
};

function renderBildirimler() {
  const list = $('bil-list');
  if (!list) return;
  const rows = applyReadFilter(state.bildirimler, state.filters.bil, (n) => !!n.isRead);
  $('bil-counters').innerHTML = counterHtml(
    state.bildirimler.length,
    state.bildirimler.filter((n) => n.isRead).length,
    state.bildirimler.filter((n) => !n.isRead).length,
  );
  list.innerHTML = rows.length
    ? rows.map((n) => {
        const [emoji, etiket] = BIL_TIP_ETIKET[n.type] || ['🔔', n.type || 'Bildirim'];
        const zaman = new Date(n.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return '<div class="notif-row' + (n.isRead ? '' : ' unread') + '" data-id="' + n.id + '">'
          + '<span class="ntip">' + emoji + ' ' + etiket + '</span>'
          + '<div class="ntxt"><b>' + (n.title || '') + '</b><span>' + (n.body || '') + '</span></div>'
          + '<span class="nzaman">' + zaman + '</span>'
          + '</div>';
      }).join('')
    : '<div class="empty">Bu filtrede bildirim yok.</div>';
  list.querySelectorAll('.notif-row.unread').forEach((row) => {
    row.addEventListener('click', async () => {
      try { await api.markNotifRead(row.dataset.id); refreshInbox(); } catch { /* yoksay */ }
    });
  });
}

function setupInbox() {
  const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  const bindSel = (id, key) => {
    const el = $(id);
    if (el) el.addEventListener('change', () => { state.filters[key] = el.value; refreshInbox(); });
  };
  bindSel('teb-filter', 'teb'); bindSel('rap-filter', 'rap'); bindSel('bil-filter', 'bil');
  bind('teb-refresh', refreshInbox); bind('rap-refresh', refreshInbox); bind('bil-refresh', refreshInbox);
  bind('teb-readall', async () => {
    try { await api.markDocsViewed({ belgeTuru: 'E_TEBLIGAT' }); toast('Tüm tebligatlar görüldü sayıldı', 'ok'); refreshInbox(); }
    catch (err) { toast(err.message || 'İşlem başarısız', 'err'); }
  });
  bind('rap-readall', async () => {
    try {
      for (const t of RAPOR_TURLERI.split(',')) await api.markDocsViewed({ belgeTuru: t });
      toast('Tüm SGK kayıtları görüldü sayıldı', 'ok'); refreshInbox();
    } catch (err) { toast(err.message || 'İşlem başarısız', 'err'); }
  });
  bind('bil-readall', async () => {
    try { await api.markAllNotifsRead(); toast('Tüm bildirimler okundu', 'ok'); refreshInbox(); }
    catch (err) { toast(err.message || 'İşlem başarısız', 'err'); }
  });
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
setupInbox();
setupWa();
setupLogout();
setupPortalEvents();
boot();
