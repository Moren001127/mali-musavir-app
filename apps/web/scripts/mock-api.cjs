#!/usr/bin/env node
/**
 * SAHTE API — yalnız tarayıcı önizlemesi için (canlı API'ye bağlanmadan Görevler & Notlar ekranını çalıştırır).
 *
 *   node apps/web/scripts/mock-api.cjs            → http://localhost:3001/api/v1
 *   PORT=3005 node apps/web/scripts/mock-api.cjs
 *
 * Web geliştirme sunucusu NEXT_PUBLIC_API_URL tanımsızken zaten http://localhost:3001/api/v1'e bağlanır.
 * Giriş: /giris/musavir → herhangi bir e-posta + şifre kabul edilir.
 *
 * Kapsam: panel kabuğunun çağırdığı uçlar (auth, bildirim, sağlık, luca, onay kuyruğu, bütçe) + /taxpayers +
 *         /tasks* sözleşmesi (bellek içi durum: ekle / düzenle / tamamla / ertele / toplu / not / ekibe ver / takvimden)
 *         + /tasks/kisiler (ofis personeline de hatırlat) + /ekip/istek/:id/kapat + /users (liste, PATCH telefon).
 *         Veri süreç belleğindedir; sunucu yeniden başlayınca sıfırlanır.
 */
const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3001);
const ON_EK = '/api/v1';

// ─────────────────────────────────────────────────────────────────────────────
// Tarih yardımcıları (yerel takvim)
// ─────────────────────────────────────────────────────────────────────────────
const simdi = new Date();
function gunBasi(d = simdi) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
/** bugün + n gün, yerel gece yarısı, ISO */
function gun(n) {
  const d = gunBasi();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}
function saatOnce(h) {
  return new Date(simdi.getTime() - h * 3600_000).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Veri
// ─────────────────────────────────────────────────────────────────────────────
const KULLANICI = {
  id: 'u1',
  tenantId: 't1',
  email: 'muzaffer@morenmusavirlik.com',
  firstName: 'Muzaffer',
  lastName: 'Ören',
  role: 'ADMIN',
  isActive: true,
};

/** Ofisin portal kullanıcıları (Ayarlar → Kullanıcılar + "Ofis personeline de hatırlat" seçenekleri). */
const KULLANICILAR = [
  { id: 'u1', email: 'muzaffer@morenmusavirlik.com', firstName: 'Muzaffer', lastName: 'Ören', isActive: true, lastLoginAt: saatOnce(1), createdAt: gun(-400), phone: '0535 000 00 01', userRoles: [{ role: { name: 'ADMIN' } }] },
  { id: 'u2', email: 'busra@morenmusavirlik.com', firstName: 'Büşra', lastName: 'Yılmaz', isActive: true, lastLoginAt: saatOnce(5), createdAt: gun(-200), phone: '0532 000 00 02', userRoles: [{ role: { name: 'STAFF' } }] },
  { id: 'u3', email: 'elif@morenmusavirlik.com', firstName: 'Elif', lastName: 'Demir', isActive: true, lastLoginAt: saatOnce(30), createdAt: gun(-120), phone: null, userRoles: [{ role: { name: 'STAFF' } }] },
  { id: 'u4', email: 'seda@morenmusavirlik.com', firstName: 'Seda', lastName: 'Kara', isActive: true, lastLoginAt: null, createdAt: gun(-10), phone: null, userRoles: [{ role: { name: 'READONLY' } }] },
  { id: 'u5', email: 'ahmet@morenmusavirlik.com', firstName: 'Ahmet', lastName: 'Taş', isActive: false, lastLoginAt: saatOnce(24 * 90), createdAt: gun(-300), phone: '0533 000 00 05', userRoles: [{ role: { name: 'STAFF' } }] },
];
const kullaniciAd = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;
/** GET /tasks/kisiler — yalnız aktif kullanıcılar; ben = istek yapan (sahte: u1). */
const kisiler = () => KULLANICILAR.filter((u) => u.isActive).map((u) => ({ id: u.id, ad: kullaniciAd(u), rol: (u.userRoles[0] && u.userRoles[0].role.name) || 'STAFF', telefon: !!u.phone, ben: u.id === KULLANICI.id }));
/** hatirlatUserIds temizliği: yalnız dizi + metin id + tekil. */
const hatirlatTemizle = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x.trim()))] : []);

const MUKELLEFLER = [
  { id: 'm1', type: 'COMPANY', companyName: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', firstName: null, lastName: null, taxNumber: '6420011234', status: 'active' },
  { id: 'm2', type: 'INDIVIDUAL', companyName: null, firstName: 'Erdoğan', lastName: 'Balçık', taxNumber: '14523698745', status: 'active' },
  { id: 'm3', type: 'INDIVIDUAL', companyName: null, firstName: 'Ayşegül', lastName: 'Kaya', taxNumber: '25874136982', status: 'active' },
  { id: 'm4', type: 'COMPANY', companyName: 'Mert Reklam Ajansı Ltd. Şti.', firstName: null, lastName: null, taxNumber: '6170045678', status: 'active' },
  { id: 'm5', type: 'COMPANY', companyName: 'Famcoffee Kahve A.Ş.', firstName: null, lastName: null, taxNumber: '3850098765', status: 'active' },
  { id: 'm6', type: 'COMPANY', companyName: 'Ela Tekstil Ltd. Şti.', firstName: null, lastName: null, taxNumber: '3250076543', status: 'active' },
  { id: 'm7', type: 'COMPANY', companyName: 'Balçık İnşaat A.Ş.', firstName: null, lastName: null, taxNumber: '1400032109', status: 'active' },
  { id: 'm8', type: 'INDIVIDUAL', companyName: null, firstName: 'Dilek', lastName: 'Bayageldi', taxNumber: '36985214778', status: 'active' },
];
const mukellefBul = (id) => MUKELLEFLER.find((m) => m.id === id) || null;
const mukellefOzet = (id) => {
  const m = mukellefBul(id);
  return m ? { id: m.id, firstName: m.firstName, lastName: m.lastName, companyName: m.companyName } : null;
};
const mukellefAd = (id) => {
  const m = mukellefBul(id);
  return m ? m.companyName || `${m.firstName} ${m.lastName}` : null;
};

let sira = 100;
const yeniId = (p) => `${p}${++sira}`;

const OLUSTURAN = { id: 'u1', firstName: 'Muzaffer', lastName: 'Ören' };

/** Görev/not kaydı üret (eksik alanlara varsayılan). */
function gorev(o) {
  const id = o.id || yeniId('t');
  const dueDate = o.dueDate === undefined ? null : o.dueDate;
  const notlar = (o.notlar || []).map((n, i) => ({
    id: `${id}-n${i + 1}`,
    taskId: id,
    userId: 'u1',
    content: n.content,
    createdAt: n.createdAt || saatOnce(24 * (i + 1)),
    user: OLUSTURAN,
  }));
  return {
    id,
    tenantId: 't1',
    title: o.title,
    description: o.description || null,
    category: o.category || null,
    priority: o.priority || 'MEDIUM',
    color: null,
    tags: [],
    taxpayerId: o.taxpayerId || null,
    taxpayer: mukellefOzet(o.taxpayerId),
    createdById: 'u1',
    createdBy: OLUSTURAN,
    dueDate,
    dueTime: o.dueTime || null,
    allDay: !o.dueTime,
    recurrence: o.recurrence || null,
    parentTaskId: null,
    isTemplate: false,
    reminderConfig: null,
    notifyInApp: true,
    notifyEmail: o.notifyEmail ?? false,
    notifyBrowser: true,
    notifySound: false,
    notifyPush: o.notifyPush ?? true,
    notifyWhatsapp: o.notifyWhatsapp ?? true,
    status: o.status || 'OPEN',
    completedAt: o.status === 'DONE' ? saatOnce(3) : null,
    snoozedUntil: o.snoozedUntil || null,
    escalationLevel: 0,
    lastReminderAt: null,
    createdAt: o.createdAt || saatOnce(48),
    updatedAt: o.updatedAt || saatOnce(2),
    kaynak: o.kaynak || 'MANUEL',
    tur: o.tur || 'GOREV',
    pinned: !!o.pinned,
    ekipIsId: o.ekipIsId || null,
    taxCalendarId: o.taxCalendarId || null,
    hatirlatUserIds: hatirlatTemizle(o.hatirlatUserIds),
    notes: notlar,
    attachments: o.attachments || [],
  };
}

let GOREVLER = [
  // Gecikmiş
  gorev({ id: 't1', title: 'Öz Ela Ağustos KDV kontrolü', category: 'KDV_KONTROL', priority: 'URGENT', taxpayerId: 'm1', dueDate: gun(-3), dueTime: '10:00', kaynak: 'MANUEL',
    description: 'Ağustos dönemi KDV Kontrol ekranından indirilen ve satış faturaları karşılaştırılacak; 3 mükerrer fatura şüphesi var.',
    notlar: [{ content: 'Luca fişleri çekildi, 2 fatura eksik görünüyor.' }, { content: 'Mükellef eksik faturaları WhatsApp ile gönderecek.' }] }),
  gorev({ id: 't2', title: 'Erdoğan Balçık banka ekstresi eksik', category: 'BANKA', priority: 'HIGH', taxpayerId: 'm2', dueDate: gun(-1), kaynak: 'BANKA',
    description: 'Ziraat Bankası Ağustos ekstresi Banka Takip modülüne düşmedi.' }),
  gorev({ id: 't3', title: 'Mert Reklam tahsilat araması', category: 'TAHSILAT', priority: 'MEDIUM', taxpayerId: 'm4', dueDate: gun(-6), kaynak: 'AI',
    description: 'Temmuz + Ağustos ücretleri ödenmedi (2 ay).', notlar: [{ content: 'Telefonla ulaşılamadı, mesaj bırakıldı.' }] }),
  // Bugün
  gorev({ id: 't4', title: 'Famcoffee Ağustos muhtasar beyannamesi', category: 'BEYANNAME', priority: 'HIGH', taxpayerId: 'm5', dueDate: gun(0), dueTime: '14:00', kaynak: 'TAKVIM', taxCalendarId: 'c2' }),
  gorev({ id: 't5', title: 'Ayşegül Kaya işe giriş bildirgesi', category: 'BORDRO', priority: 'URGENT', taxpayerId: 'm3', dueDate: gun(0), kaynak: 'WHATSAPP',
    description: 'Yeni personel 15 Eylül başlıyor; SGK işe giriş bildirgesi bugün verilmeli.', hatirlatUserIds: ['u2'] }),
  gorev({ id: 't6', title: 'Balçık İnşaat hakediş faturası evrakı', category: 'EVRAK', priority: 'MEDIUM', taxpayerId: 'm7', dueDate: gun(0), kaynak: 'MANUEL', status: 'IN_PROGRESS',
    ekipIsId: 'is-8841', notlar: [{ content: 'Ekibe verildi (kuru test) — iş is-8841' }] }),
  gorev({ id: 't7', title: 'Ofis kira ödemesi', category: 'OFIS', priority: 'LOW', dueDate: gun(0), kaynak: 'MANUEL', recurrence: { type: 'MONTHLY', monthDay: 14 } }),
  // Yarın
  gorev({ id: 't8', title: 'Ela Tekstil ile Ba-Bs mutabakatı görüşmesi', category: 'MUKELLEF', priority: 'MEDIUM', taxpayerId: 'm6', dueDate: gun(1), dueTime: '11:30', kaynak: 'MANUEL' }),
  gorev({ id: 't9', title: 'Dilek Bayageldi e-Defter berat kontrolü', category: 'KDV_KONTROL', priority: 'HIGH', taxpayerId: 'm8', dueDate: gun(1), kaynak: 'AI',
    description: 'Haziran berat yüklemesi öncesi mizan-fiş uyumu.' }),
  // Bu hafta
  gorev({ id: 't10', title: 'Öz Ela Ağustos KDV beyannamesi hazırla', category: 'BEYANNAME', priority: 'HIGH', taxpayerId: 'm1', dueDate: gun(3), kaynak: 'TAKVIM', taxCalendarId: 'c1' }),
  gorev({ id: 't11', title: 'Famcoffee Garanti ekstresi iste', category: 'BANKA', priority: 'MEDIUM', taxpayerId: 'm5', dueDate: gun(4), kaynak: 'BANKA' }),
  gorev({ id: 't12', title: 'Mert Reklam sözleşme damga vergisi', category: 'BEYANNAME', priority: 'LOW', taxpayerId: 'm4', dueDate: gun(5), kaynak: 'MANUEL' }),
  gorev({ id: 't13', title: 'Erdoğan Balçık geçici vergi hazırlığı', category: 'BEYANNAME', priority: 'MEDIUM', taxpayerId: 'm2', dueDate: gun(2), kaynak: 'MANUEL', status: 'SNOOZED', snoozedUntil: gun(2),
    notlar: [{ content: 'Mükellef gider faturalarını çarşamba getirecek, o güne ertelendi.' }] }),
  // Sonra
  gorev({ id: 't14', title: 'Balçık İnşaat 2. dönem geçici vergi', category: 'BEYANNAME', priority: 'MEDIUM', taxpayerId: 'm7', dueDate: gun(12), kaynak: 'MANUEL' }),
  gorev({ id: 't15', title: 'Ayşegül Kaya defter tasdiki hatırlat', category: 'EVRAK', priority: 'LOW', taxpayerId: 'm3', dueDate: gun(20), kaynak: 'MANUEL' }),
  gorev({ id: 't16', title: 'Ofis yazıcı toneri sipariş', category: 'OFIS', priority: 'LOW', dueDate: gun(9), kaynak: 'MANUEL' }),
  // Tarihsiz
  gorev({ id: 't17', title: 'Ela Tekstil eski kategori örneği (KDV Mutabakatı)', category: 'KDV', priority: 'MEDIUM', taxpayerId: 'm6', kaynak: 'MANUEL' }),
  gorev({ id: 't18', title: 'Portal tanıtım videosu metnini yaz', category: 'DIGER', priority: 'LOW', kaynak: 'MANUEL',
    notlar: [{ content: 'Taslak 1 hazır, Muzaffer Bey onayı bekliyor.' }, { content: 'Ses kaydı için stüdyo teklifi alındı.' }, { content: 'Video 3 dakikayı geçmesin.' }] }),
  // Bitmiş / iptal (ajandada gelmez, Kanban "Bitti" için /tasks?status=DONE)
  gorev({ id: 't19', title: 'Famcoffee Temmuz KDV beyannamesi', category: 'BEYANNAME', priority: 'HIGH', taxpayerId: 'm5', dueDate: gun(-10), status: 'DONE', kaynak: 'TAKVIM' }),
  gorev({ id: 't20', title: 'Mert Reklam Temmuz ekstresi', category: 'BANKA', priority: 'MEDIUM', taxpayerId: 'm4', dueDate: gun(-8), status: 'DONE', kaynak: 'BANKA' }),
  gorev({ id: 't21', title: 'Dilek Bayageldi tahsilat', category: 'TAHSILAT', priority: 'HIGH', taxpayerId: 'm8', dueDate: gun(-2), status: 'DONE', kaynak: 'AI' }),
  // Notlar (tur NOT)
  gorev({ id: 'n1', tur: 'NOT', title: 'Öz Ela — yeni muhasebe personeli Seda Hanım, evrakı artık o gönderecek', taxpayerId: 'm1', pinned: true, kaynak: 'MANUEL',
    description: 'Telefon: 0532 000 00 00. Evrak son teslim her ayın 5\'i.' }),
  gorev({ id: 'n2', tur: 'NOT', title: 'Luca Excel fiş aktarımı: tarih sütunu GG.AA.YYYY olmalı', pinned: true, kaynak: 'MANUEL',
    description: 'Aksi halde Luca fişleri sessizce atlıyor. Fatura Merkezi → Luca aktarımında kontrol et.' }),
  gorev({ id: 'n3', tur: 'NOT', title: 'Balçık İnşaat hakediş faturalarında tevkifat 4/10', taxpayerId: 'm7', kaynak: 'MANUEL',
    description: 'Yapım işleri — KDV tevkifatı 4/10 uygulanıyor; 191.03 hesabına dikkat.' }),
  gorev({ id: 'n4', tur: 'NOT', title: 'Ekip sabah özeti 08:30\'da WhatsApp\'a düşüyor', kaynak: 'AI', updatedAt: saatOnce(30) }),
];

let EKIP_ISTEKLER = [
  { id: 'ist-1', baslik: 'Erdoğan Balçık — Ağustos KDV için Ziraat banka fişi gerekli', aciklama: 'Banka-Kasa ajanı Ağustos ekstresinde 3 dekontu eşleştiremedi; fişleri Fatura Merkezi\'ne yükleyin.', taxpayerId: 'm2', mukellefAd: 'Erdoğan Balçık', vakaId: 'vaka-7712', ajanId: 'banka-kasa', createdAt: saatOnce(5) },
  { id: 'ist-2', baslik: 'Famcoffee — Ağustos kira faturası eksik', aciklama: 'Fatura ajanı 770 Genel Yönetim Giderleri hesabında kira faturası bulamadı; mükelleften isteyin.', taxpayerId: 'm5', mukellefAd: 'Famcoffee Kahve A.Ş.', vakaId: 'vaka-7720', ajanId: 'fatura', createdAt: saatOnce(26) },
];

const TAKVIM = [
  { id: 'c1', ad: 'KDV Beyannamesi', tur: 'KDV', tarih: gun(3), donem: '2026-08' },
  { id: 'c2', ad: 'Muhtasar ve Prim Hizmet Beyannamesi', tur: 'MUHTASAR', tarih: gun(0), donem: '2026-08' },
  { id: 'c3', ad: 'Damga Vergisi Beyannamesi', tur: 'DAMGA', tarih: gun(5), donem: '2026-08' },
  { id: 'c4', ad: 'Ba-Bs Formları', tur: 'BA_BS', tarih: gun(16), donem: '2026-08' },
  { id: 'c5', ad: 'e-Defter Berat Yükleme', tur: 'EDEFTER', tarih: gun(16), donem: '2026-06' },
  { id: 'c6', ad: 'KDV Beyannamesi', tur: 'KDV', tarih: gun(33), donem: '2026-09' },
  { id: 'c7', ad: 'Muhtasar ve Prim Hizmet Beyannamesi', tur: 'MUHTASAR', tarih: gun(31), donem: '2026-09' },
  { id: 'c8', ad: 'Geçici Vergi Beyannamesi', tur: 'GECICI', tarih: gun(64), donem: '2026-Q3' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────────────────────
const ACIK = new Set(['OPEN', 'IN_PROGRESS', 'SNOOZED']);
const kucuk = (s) => String(s ?? '').toLocaleLowerCase('tr-TR');

function listeGorunumu(t) {
  // Liste/ajanda: notes yalnız son 1 kayıt + _count
  const notes = [...(t.notes || [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { ...t, notes: notes.slice(0, 1), _count: { notes: notes.length, attachments: (t.attachments || []).length } };
}
function detayGorunumu(t) {
  const notes = [...(t.notes || [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { ...t, notes, _count: { notes: notes.length, attachments: (t.attachments || []).length } };
}

function suz(liste, q) {
  return liste.filter((t) => {
    if (q.taxpayerId && t.taxpayerId !== q.taxpayerId) return false;
    if (q.category && t.category !== q.category) return false;
    if (q.priority && t.priority !== q.priority) return false;
    if (q.kaynak && t.kaynak !== q.kaynak) return false;
    if (q.search) {
      const s = kucuk(q.search);
      const ad = mukellefAd(t.taxpayerId) || '';
      if (![t.title, t.description, ad].some((v) => kucuk(v).includes(s))) return false;
    }
    return true;
  });
}

function sayaclar() {
  const gb = gunBasi().getTime();
  const gs = gb + 86_400_000 - 1;
  const bugunHafta = gunBasi().getDay(); // 0 Pazar
  const pazaraKalan = bugunHafta === 0 ? 0 : 7 - bugunHafta;
  const haftaSonu = gb + (pazaraKalan + 1) * 86_400_000 - 1;
  const acik = GOREVLER.filter((t) => t.tur === 'GOREV' && (t.status === 'OPEN' || t.status === 'IN_PROGRESS'));
  const v = (t) => (t.dueDate ? new Date(t.dueDate).getTime() : null);
  return {
    bugun: acik.filter((t) => v(t) !== null && v(t) >= gb && v(t) <= gs).length,
    gecikmis: acik.filter((t) => v(t) !== null && v(t) < gb).length,
    buHafta: acik.filter((t) => v(t) !== null && v(t) >= gb && v(t) <= haftaSonu).length,
    acik: acik.length,
    istek: EKIP_ISTEKLER.length,
    not: GOREVLER.filter((t) => t.tur === 'NOT' && !['DONE', 'CANCELLED'].includes(t.status)).length,
  };
}

const oncelikSira = { URGENT: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
function gorevSirala(a, b) {
  if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return (oncelikSira[b.priority] || 0) - (oncelikSira[a.priority] || 0);
}

function jsonGonder(res, kod, veri) {
  res.writeHead(kod, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(veri));
}
function govdeOku(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Yönlendirme
// ─────────────────────────────────────────────────────────────────────────────
async function isle(req, res) {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const yol = u.pathname.startsWith(ON_EK) ? u.pathname.slice(ON_EK.length) : u.pathname;
  const q = Object.fromEntries(u.searchParams.entries());
  const yontem = req.method;
  const govde = ['POST', 'PATCH', 'PUT'].includes(yontem) ? await govdeOku(req) : {};

  // ── Kimlik ──
  if (yontem === 'POST' && yol === '/auth/login') return jsonGonder(res, 200, { accessToken: 'sahte-token', user: KULLANICI });
  if (yontem === 'POST' && yol === '/auth/refresh') return jsonGonder(res, 200, { accessToken: 'sahte-token' });
  if (yontem === 'POST' && yol === '/auth/logout') return jsonGonder(res, 200, { ok: true });
  if (yontem === 'GET' && yol === '/auth/me') return jsonGonder(res, 200, KULLANICI);

  // ── Panel kabuğu ──
  if (yol === '/notifications/unread-count') return jsonGonder(res, 200, 0);
  if (yol === '/notifications') return jsonGonder(res, 200, []);
  if (yol === '/system/health') return jsonGonder(res, 200, { summary: { critical: 0, warning: 0, ok: 4 }, checks: [] });
  if (yol === '/system/health/run-now') return jsonGonder(res, 200, { ok: true });
  if (yol === '/luca/jobs') return jsonGonder(res, 200, []);
  if (yol === '/luca/session-manager/status')
    return jsonGonder(res, 200, { credential: { saved: false }, session: { connected: false }, devices: [], activeChallenge: null });
  if (yol === '/onay-kuyrugu/count') return jsonGonder(res, 200, { bekleyen: 0 });
  if (yol === '/butce/erisim') return jsonGonder(res, 200, { yetkili: false });
  if (yol === '/moren-ai/conversations') return jsonGonder(res, 200, []);
  if (yol === '/office-chat/threads') return jsonGonder(res, 200, []);
  if (yol === '/agent/health-summary')
    return jsonGonder(res, 200, { generatedAt: new Date().toISOString(), agents: [], hourlyActivity: [], totals: { activeJobs: 0, pendingLucaJobs: 0, runningLucaJobs: 0, doneToday: 0, failedToday: 0 } });
  // Gösterge paneli (/panel) — girişten sonra oraya düşer; boş ama geçerli yanıtlar
  if (yol === '/agent/events' || yol === '/taxpayers/workflow/queue' || yol === '/gundem') return jsonGonder(res, 200, []);
  if (yol === '/agent/stats' || yol === '/agent/status' || yol === '/moren-ai/brifing' || yol.startsWith('/beyanname-takip/ozet')) return jsonGonder(res, 200, {});
  if (yol === '/taxpayers') return jsonGonder(res, 200, MUKELLEFLER);

  // ── Ekip istekleri ──
  {
    const m = /^\/ekip\/istek\/([^/]+)\/kapat$/.exec(yol);
    if (yontem === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      const vardi = EKIP_ISTEKLER.some((i) => i.id === id);
      EKIP_ISTEKLER = EKIP_ISTEKLER.filter((i) => i.id !== id);
      return jsonGonder(res, 200, { ok: true, id, zatenKapali: !vardi });
    }
  }

  // ── Görevler ──
  if (yol === '/tasks/ajanda' && yontem === 'GET') {
    const gunSayisi = Math.min(Math.max(Number(q.gun) || 30, 1), 365);
    const sinir = gunBasi().getTime() + (gunSayisi + 1) * 86_400_000;
    const gorevler = q.tur === 'NOT' ? [] : suz(GOREVLER.filter((t) => t.tur === 'GOREV' && ACIK.has(t.status)), q).sort(gorevSirala).map(listeGorunumu);
    const notlar = q.tur === 'GOREV' ? [] : suz(GOREVLER.filter((t) => t.tur === 'NOT' && !['DONE', 'CANCELLED'].includes(t.status)), q)
      .sort((a, b) => (!!b.pinned !== !!a.pinned ? (b.pinned ? 1 : -1) : a.updatedAt < b.updatedAt ? 1 : -1))
      .map(listeGorunumu);
    const gorevliTakvim = new Set(GOREVLER.filter((t) => t.taxCalendarId && ACIK.has(t.status)).map((t) => t.taxCalendarId));
    const takvim = TAKVIM.filter((c) => new Date(c.tarih).getTime() >= gunBasi().getTime() && new Date(c.tarih).getTime() <= sinir).map((c) => ({ ...c, gorevVar: gorevliTakvim.has(c.id) }));
    const ekipIstekler = EKIP_ISTEKLER.filter((i) => {
      if (q.taxpayerId && i.taxpayerId !== q.taxpayerId) return false;
      if (q.search) return [i.baslik, i.aciklama, i.mukellefAd].some((v) => kucuk(v).includes(kucuk(q.search)));
      return true;
    });
    return jsonGonder(res, 200, { gorevler, notlar, ekipIstekler, takvim, sayaclar: sayaclar() });
  }

  if (yol === '/tasks/counts' && yontem === 'GET') {
    const s = sayaclar();
    return jsonGonder(res, 200, { today: s.bugun, overdue: s.gecikmis, thisWeek: s.buHafta, totalOpen: s.acik });
  }

  // "Ofis personeline de hatırlat" seçenekleri — /tasks/:id kalıbından ÖNCE olmalı
  if (yol === '/tasks/kisiler' && yontem === 'GET') return jsonGonder(res, 200, kisiler());

  // ── Kullanıcılar (Ayarlar → Kullanıcılar) ──
  if (yol === '/users' && yontem === 'GET') return jsonGonder(res, 200, KULLANICILAR);
  {
    const m = /^\/users\/([^/]+)$/.exec(yol);
    if (m && (yontem === 'PATCH' || yontem === 'DELETE')) {
      const k = KULLANICILAR.find((x) => x.id === m[1]);
      if (!k) return jsonGonder(res, 404, { message: 'Kullanıcı bulunamadı' });
      if (yontem === 'DELETE') {
        k.isActive = false;
        return jsonGonder(res, 200, { ok: true });
      }
      if (govde.phone !== undefined) {
        const temiz = govde.phone === null ? null : String(govde.phone).trim();
        if (temiz && temiz.replace(/\D/g, '').length < 10) return jsonGonder(res, 400, { message: 'Telefon geçersiz (en az 10 rakam)' });
        k.phone = temiz || null;
      }
      return jsonGonder(res, 200, k);
    }
  }

  if (yol === '/tasks/toplu' && yontem === 'POST') {
    const ids = new Set(govde.ids || []);
    let etkilenen = 0;
    if (govde.islem === 'sil') {
      const once = GOREVLER.length;
      GOREVLER = GOREVLER.filter((t) => !ids.has(t.id));
      etkilenen = once - GOREVLER.length;
      return jsonGonder(res, 200, { ok: true, etkilenen });
    }
    for (const t of GOREVLER) {
      if (!ids.has(t.id)) continue;
      etkilenen++;
      t.updatedAt = new Date().toISOString();
      switch (govde.islem) {
        case 'tamamla': t.status = 'DONE'; t.completedAt = new Date().toISOString(); break;
        case 'yeniden-ac': t.status = 'OPEN'; t.completedAt = null; t.snoozedUntil = null; break;
        case 'ertele': t.status = 'SNOOZED'; t.snoozedUntil = govde.until; break;
        case 'iptal': t.status = 'CANCELLED'; break;
        case 'kategori': t.category = govde.category || null; break;
        case 'oncelik': t.priority = govde.priority; break;
        case 'sabitle': t.pinned = true; break;
        case 'sabit-kaldir': t.pinned = false; break;
        default: return jsonGonder(res, 400, { message: 'islem geçersiz' });
      }
    }
    return jsonGonder(res, 200, { ok: true, etkilenen });
  }

  if (yol === '/tasks/takvimden' && yontem === 'POST') {
    const c = TAKVIM.find((x) => x.id === govde.taxCalendarId);
    if (!c) return jsonGonder(res, 404, { message: 'Takvim kaydı bulunamadı' });
    const t = gorev({
      title: `${c.ad} — ${c.donem}`,
      category: 'BEYANNAME',
      priority: 'HIGH',
      taxpayerId: govde.taxpayerId || null,
      dueDate: govde.dueDate ? new Date(govde.dueDate).toISOString() : c.tarih,
      dueTime: govde.dueTime || null,
      kaynak: 'TAKVIM',
      taxCalendarId: c.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    GOREVLER.push(t);
    return jsonGonder(res, 201, listeGorunumu(t));
  }

  if (yol === '/tasks' && yontem === 'GET') {
    let liste = GOREVLER.filter((t) => (q.isTemplate === 'true' ? t.isTemplate : true));
    if (q.status) liste = liste.filter((t) => t.status === q.status);
    if (q.tur) liste = liste.filter((t) => t.tur === q.tur);
    liste = suz(liste, q).sort(gorevSirala);
    const limit = Math.min(Number(q.limit) || 100, 500);
    const offset = Number(q.offset) || 0;
    return jsonGonder(res, 200, { items: liste.slice(offset, offset + limit).map(listeGorunumu), total: liste.length, limit, offset });
  }

  if (yol === '/tasks' && yontem === 'POST') {
    if (!String(govde.title || '').trim()) return jsonGonder(res, 400, { message: 'Başlık gerekli' });
    const t = gorev({
      ...govde,
      dueDate: govde.dueDate ? new Date(govde.dueDate).toISOString() : null,
      taxpayerId: govde.taxpayerId || null,
      kaynak: govde.kaynak || 'MANUEL',
      tur: govde.tur === 'NOT' ? 'NOT' : 'GOREV',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notlar: [],
    });
    if (govde.notifyWhatsapp !== undefined) t.notifyWhatsapp = !!govde.notifyWhatsapp;
    if (govde.notifyPush !== undefined) t.notifyPush = !!govde.notifyPush;
    if (govde.notifyInApp !== undefined) t.notifyInApp = !!govde.notifyInApp;
    if (govde.notifyEmail !== undefined) t.notifyEmail = !!govde.notifyEmail;
    GOREVLER.push(t);
    return jsonGonder(res, 201, listeGorunumu(t));
  }

  {
    const m = /^\/tasks\/([^/]+)(?:\/(complete|snooze|notes|ekibe-ver))?$/.exec(yol);
    if (m) {
      const t = GOREVLER.find((x) => x.id === m[1]);
      if (!t) return jsonGonder(res, 404, { message: 'Görev bulunamadı' });
      const alt = m[2];
      if (!alt && yontem === 'GET') return jsonGonder(res, 200, detayGorunumu(t));
      if (!alt && yontem === 'DELETE') {
        GOREVLER = GOREVLER.filter((x) => x.id !== t.id);
        return jsonGonder(res, 200, { ok: true });
      }
      if (!alt && yontem === 'PATCH') {
        const alanlar = ['title', 'description', 'category', 'priority', 'taxpayerId', 'dueTime', 'allDay', 'recurrence', 'notifyInApp', 'notifyEmail', 'notifyBrowser', 'notifySound', 'notifyPush', 'notifyWhatsapp', 'tur', 'pinned', 'kaynak', 'status', 'tags'];
        for (const a of alanlar) if (govde[a] !== undefined) t[a] = govde[a];
        if (govde.hatirlatUserIds !== undefined) t.hatirlatUserIds = hatirlatTemizle(govde.hatirlatUserIds);
        if (govde.dueDate !== undefined) t.dueDate = govde.dueDate ? new Date(govde.dueDate).toISOString() : null;
        if (govde.taxpayerId !== undefined) { t.taxpayerId = govde.taxpayerId || null; t.taxpayer = mukellefOzet(t.taxpayerId); }
        if (govde.status === 'DONE') t.completedAt = new Date().toISOString();
        if (govde.status === 'OPEN') { t.completedAt = null; t.snoozedUntil = null; }
        if (govde.snoozedUntil !== undefined) { t.snoozedUntil = govde.snoozedUntil || null; if (govde.snoozedUntil) t.status = 'SNOOZED'; }
        t.updatedAt = new Date().toISOString();
        return jsonGonder(res, 200, listeGorunumu(t));
      }
      if (alt === 'complete' && yontem === 'POST') {
        t.status = 'DONE';
        t.completedAt = new Date().toISOString();
        t.updatedAt = t.completedAt;
        return jsonGonder(res, 200, listeGorunumu(t));
      }
      if (alt === 'snooze' && yontem === 'POST') {
        t.status = 'SNOOZED';
        t.snoozedUntil = govde.until;
        t.updatedAt = new Date().toISOString();
        return jsonGonder(res, 200, listeGorunumu(t));
      }
      if (alt === 'notes' && yontem === 'POST') {
        const n = { id: yeniId('n'), taskId: t.id, userId: 'u1', content: String(govde.content || ''), createdAt: new Date().toISOString(), user: OLUSTURAN };
        t.notes.push(n);
        t.updatedAt = n.createdAt;
        return jsonGonder(res, 201, n);
      }
      if (alt === 'ekibe-ver' && yontem === 'POST') {
        if (t.ekipIsId && t.status === 'IN_PROGRESS' && t.ekipIsId.startsWith('is-88'))
          return jsonGonder(res, 200, { ok: false, error: 'Bu görev için ekip zaten çalışıyor' });
        const isId = yeniId('is-');
        t.ekipIsId = isId;
        t.status = 'IN_PROGRESS';
        t.notes.push({ id: yeniId('n'), taskId: t.id, userId: 'u1', content: `Ekibe verildi (${govde.canli ? 'canlı' : 'kuru test'}) — iş ${isId}`, createdAt: new Date().toISOString(), user: OLUSTURAN });
        t.updatedAt = new Date().toISOString();
        return jsonGonder(res, 200, { ok: true, isId });
      }
    }
  }

  console.log(`[mock] 404 ${yontem} ${yol}`);
  return jsonGonder(res, 404, { message: `Sahte API'de uç yok: ${yontem} ${yol}` });
}

const sunucu = http.createServer((req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Agent-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  isle(req, res).catch((e) => {
    console.error('[mock] hata', e);
    jsonGonder(res, 500, { message: String(e?.message || e) });
  });
});

sunucu.listen(PORT, () => {
  console.log(`[mock] Sahte API hazır: http://localhost:${PORT}${ON_EK}  (görev ${GOREVLER.length}, mükellef ${MUKELLEFLER.length}, kullanıcı ${KULLANICILAR.length})`);
});
