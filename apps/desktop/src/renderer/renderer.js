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

// Sunucudan gelen metin (mükellef adı, bildirim gövdesi…) HTML'e yazılmadan önce kaçışlanır.
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    $('eye').textContent = p.type === 'password' ? 'Göster' : 'Gizle';
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

  // Oturumdaki kullanıcı yalnız Ayarlar'da görünür (sol menüdeki ad + e-posta kaldırıldı, 2026-09-26).
  const setUser = $('set-user');
  if (setUser && user && user.email) setUser.textContent = user.email;

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

// Logosunda adı YAZMAYAN kısayollar — Hattat'taki gibi logonun altına küçük gri ad düşülür
// (e-Beyanname = yalnız "e" kıvrımı, e-Defter = yalnız defter simgesi). Diğer logolar adı zaten taşıyor.
const YAZISIZ_LOGO = new Set(['ebeyanname', 'edefter']);

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
    card.title = portal.label;
    // Şifre durumu (Muzaffer Bey 2026-09-26): YALNIZ eksikse uyarı — kart soluk + köşede "şifre yok".
    //   Kayıtlıyken işaret yok (eski yeşil nokta kalktı). Mükellef seçilmemişken hiç işaret yok
    //   (e-Beyanname müşavir geneli şifre kullandığı için onda seçimden bağımsız bakılır).
    const tagHtml = cred === false ? '<span class="ktag">şifre yok</span>' : '';
    const capHtml = YAZISIZ_LOGO.has(portal.key) ? '<div class="kcap">' + esc(portal.label) + '</div>' : '';
    card.innerHTML = tagHtml + '<div class="klogo">' + logoHtml(portal) + '</div>' + capHtml;
    card.addEventListener('click', () => openPortal(portal));
    grid.appendChild(card);
  }
}

async function openPortal(portal) {
  const isTenant = portal.provider === 'GIB_EBEYANNAME';
  if (!isTenant && !state.selected) {
    toast('Önce yukarıdan bir mükellef seçin.', 'err');
    return;
  }
  const cred = hasCredential(portal);
  if (cred === false) {
    toast(portal.label + ' için bu mükellefte şifre kayıtlı değil. Portaldan ekleyin.', 'err');
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
    list.innerHTML = '<div class="bosliste">Mükellef bulunamadı</div>';
    return;
  }
  for (const t of rows) {
    const secili = state.selected && state.selected.id === t.id;
    const opt = document.createElement('div');
    opt.className = 'opt' + (secili ? ' secili' : '');
    opt.innerHTML = '<div class="otx"><b>' + esc(t.ad) + '</b><span>VKN ' + esc(t.vkn || '—') + (t.vergiDairesi ? ' · ' + esc(t.vergiDairesi) : '') + '</span></div>'
      + (secili ? '<span class="otik">seçili</span>' : '');
    opt.addEventListener('click', () => selectFirma(t));
    list.appendChild(opt);
  }
}

function firmaListesiKapat() {
  $('firma-dd').classList.remove('open');
  $('firma-sel').classList.remove('acik');
}

function selectFirma(t) {
  state.selected = t;
  $('firma-sel').classList.remove('bos');
  $('firma-name').textContent = t.ad;
  $('firma-meta').textContent = 'VKN ' + (t.vkn || '—') + (t.vergiDairesi ? ' · ' + t.vergiDairesi : '');
  firmaListesiKapat();
  // Seçimi hatırla — pencere yenilense/yeniden odaklansa da mükellef seçili kalsın.
  try { localStorage.setItem('moren-selected-firma', t.id); } catch { /* yoksay */ }
  renderFirmaList($('firma-search').value);
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
  const ac = () => {
    const acik = $('firma-dd').classList.toggle('open');
    $('firma-sel').classList.toggle('acik', acik);
    if (acik) $('firma-search').focus();
  };
  $('firma-sel').addEventListener('click', (e) => { e.stopPropagation(); ac(); });
  // Kutu klavyeyle de açılır (Enter / boşluk); Esc listeyi kapatır.
  $('firma-sel').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ac(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') firmaListesiKapat(); });
  $('firma-search').addEventListener('input', (e) => renderFirmaList(e.target.value));
  $('firma-dd').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', firmaListesiKapat);
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
  // Sayfa adı şeridi GERİ (Muzaffer Bey 2026-09-26, Hattat düzeni) — Temmuz'da yer açmak için kaldırılmıştı.
  //   Şerit içerikle birlikte kayar (yapışkan değil); sayfa değişince görünüm başa döner.
  $('page-title').textContent = (PAGES[page] && PAGES[page].title) || '';
  const ana = document.querySelector('.main');
  if (ana) ana.scrollTop = 0;
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

// Sayaç YAZIYLA (Hattat kuralı: durum simgeyle değil kelimeyle) — "Toplam 12 · Görülen 8 · Görülmeyen 4".
function counterHtml(total, okunmus, okunmamis, adlar) {
  const [okAd, yokAd] = adlar || ['Görülen', 'Görülmeyen'];
  return '<span>Toplam <b>' + total + '</b></span><span class="sep">·</span>'
    + '<span>' + okAd + ' <b>' + okunmus + '</b></span><span class="sep">·</span>'
    + '<span class="' + (okunmamis > 0 ? 'c-no' : '') + '">' + yokAd + ' <b>' + okunmamis + '</b></span>';
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
    .map(([k, v]) => '<div class="dr"><span>' + esc(k) + ':</span><b>' + esc(v) + '</b></div>')
    .join('');
  // Durum ve eylem YAZIYLA (eski göz simgeleri kalktı): "Görülmedi/Görüldü" + "Belgeyi aç" ya da "Görüldü say".
  //   Görülmüş ve belgesi olmayan kayıtta düğme gerekmez (yapılacak iş yok).
  const dugme = d.storageKey
    ? '<button class="dbtn" data-act="open" data-id="' + esc(d.id) + '">Belgeyi aç</button>'
    : (okundu ? '' : '<button class="dbtn" data-act="seen" data-id="' + esc(d.id) + '">Görüldü say</button>');
  return '<div class="doc-card' + (okundu ? '' : ' unread') + '" data-id="' + esc(d.id) + '">'
    + '<div class="doc-head">'
    +   '<span class="kbadge">' + esc(kurum) + '</span>'
    +   '<span class="doc-durum ' + (okundu ? 'gordu' : 'yeni') + '">' + (okundu ? 'Görüldü' : 'Görülmedi') + '</span>'
    +   dugme
    + '</div>'
    + '<div class="doc-firma">' + esc(firma) + '</div>'
    + '<div class="doc-rows">' + rowsHtml + '</div>'
    + '</div>';
}

function bindDocActions(listEl) {
  listEl.querySelectorAll('.dbtn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      try {
        if (btn.dataset.act === 'open') {
          btn.textContent = 'Açılıyor…';
          btn.disabled = true;
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

// Bildirim türü etiketi — yazı (Hattat kuralı: emoji/simge yok).
const BIL_TIP_ETIKET = {
  E_TEBLIGAT: 'e-Tebligat',
  TAX_DEADLINE: 'Vergi süresi',
  PORTAL_CREDENTIAL_FAIL: 'Şifre hatası',
  LUCA_SYNC_ERROR: 'Luca',
  AI_COST_LIMIT: 'AI maliyet',
  AUTH_NEW_DEVICE: 'Yeni cihaz',
  PENDING_DECISION: 'Onay bekliyor',
  BANK_TRANSACTION_ALERT: 'Banka',
  INVOICE_OVERDUE: 'Fatura',
  TASK_DUE: 'Görev',
  WHATSAPP: 'WhatsApp',
};

function renderBildirimler() {
  const list = $('bil-list');
  if (!list) return;
  const rows = applyReadFilter(state.bildirimler, state.filters.bil, (n) => !!n.isRead);
  $('bil-counters').innerHTML = counterHtml(
    state.bildirimler.length,
    state.bildirimler.filter((n) => n.isRead).length,
    state.bildirimler.filter((n) => !n.isRead).length,
    ['Okunan', 'Okunmayan'],
  );
  list.innerHTML = rows.length
    ? rows.map((n) => {
        const etiket = BIL_TIP_ETIKET[n.type] || n.type || 'Bildirim';
        const zaman = new Date(n.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return '<div class="notif-row' + (n.isRead ? '' : ' unread') + '" data-id="' + esc(n.id) + '"' + (n.isRead ? '' : ' title="Okundu saymak için tıklayın"') + '>'
          + '<span class="ntip">' + esc(etiket) + '</span>'
          + '<div class="ntxt"><b>' + esc(n.title || '') + '</b><span>' + esc(n.body || '') + '</span></div>'
          + '<span class="nzaman">' + esc(zaman) + '</span>'
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
    qrEl.innerHTML = '<div class="ph">WhatsApp bağlı. Gönderimler aktif.</div>';
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
