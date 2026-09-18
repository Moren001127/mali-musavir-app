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
 *         + /tasks/kisiler (ofis personeline de hatırlat) + /ekip/istek/:id/kapat + /users (liste, PATCH telefon)
 *         + /aylik-odeme* (Aylık Ödeme Listesi: liste/özet/eksikler/send/örnek/excel/pdf/otomatik/sgk-yok)
 *         + mükellef portalı (/portal/auth/login, /portal/me, /portal/dashboard, /portal/brifing, /taxpayer-portal/odeme-cetveli)
 *         + /akilli-bildirim/report | resend-failed | run (İletim Raporu — ayrı dosya: mock-iletim-raporu.cjs).
 *         Veri süreç belleğindedir; sunucu yeniden başlayınca sıfırlanır.
 */
const http = require('http');
const { URL } = require('url');
// İletim Raporu uçları ayrı modülde (17 mükellef örnek verisi): /akilli-bildirim/report, /resend-failed, /run
const { iletimRaporuUclari } = require('./mock-iletim-raporu.cjs');
// e-Defter Kontrol uçları ayrı modülde (SAHTE_EDEFTER_FIXTURE ile gerçek dökümü servis eder)
const { edefterUclari, edefterMukellefler } = require('./mock-edefter.cjs');
// Ekip uçları ayrı modülde (SSE canlı koşu taklidi dahil)
const { ekipUclari, ekipMukellefler } = require('./mock-ekip.cjs');

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
/** Mükellef kartı — Otomatik Sorgulama Ayarı (bellekte; sahte). */
const KART_OTOMATIK_SORGU = {};
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
// AYLIK ÖDEME LİSTESİ — sahte veri (12 mükellef; ikisi geçici/yıllık kalemli, biri kısmen + 1 yeni kalem, biri tamamen gönderilmiş,
//   biri hatalı, biri telefonsuz). Gönderim KALEM BAZLI: satırda gonderim.WHATSAPP/EMAIL, kaynak düzeyinde toplamKalem/gonderilenKalem/yeniKalem.
// Sözleşme: GET /aylik-odeme, /aylik-odeme/ozet (+ yeniKalemToplam), /aylik-odeme/eksikler, /aylik-odeme/excel, /aylik-odeme/pdf, /aylik-odeme/otomatik;
//           POST /aylik-odeme/send { month, taxpayerId?, mod?, kanal? }, /aylik-odeme/ornek-gonder, /aylik-odeme/eksik/sgk-yok; PUT /aylik-odeme/otomatik;
//           yalnız sahte: POST /aylik-odeme/__sifirla, /aylik-odeme/__ayar { testMode?, kanallar? };
//           mükellef portalı: /portal/auth/login, /portal/me, /portal/dashboard, /portal/brifing, GET /taxpayer-portal/odeme-cetveli
// ─────────────────────────────────────────────────────────────────────────────
const ODEME_MUKELLEFLER = [
  { id: 'm1', unvan: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', phone: '0532 111 22 33', email: 'muhasebe@ozela.com.tr', kurum: true, sgk: true, gecici: true },
  { id: 'm2', unvan: 'Erdoğan Balçık', phone: '0533 222 33 44', email: null, kurum: false, sgk: false, gecici: false },
  { id: 'm3', unvan: 'Ayşegül Kaya', phone: '0534 333 44 55', email: 'aysegul.kaya@gmail.com', kurum: false, sgk: true, gecici: false },
  { id: 'm4', unvan: 'Mert Reklam Ajansı Ltd. Şti.', phone: null, email: 'info@mertreklam.com', kurum: true, sgk: true, gecici: false }, // TELEFONSUZ
  { id: 'm5', unvan: 'Famcoffee Kahve A.Ş.', phone: '0535 444 55 66', email: 'finans@famcoffee.com', kurum: true, sgk: true, gecici: true, yillik: true },
  { id: 'm6', unvan: 'Ela Tekstil Ltd. Şti.', phone: '0536 555 66 77', email: null, kurum: true, sgk: true, gecici: false },
  { id: 'm7', unvan: 'Balçık İnşaat A.Ş.', phone: '0537 666 77 88', email: 'muhasebe@balcikinsaat.com', kurum: true, sgk: true, gecici: false },
  { id: 'm8', unvan: 'Dilek Bayageldi', phone: '0538 777 88 99', email: null, kurum: false, sgk: false, gecici: false },
  { id: 'm9', unvan: 'Yıldız Otomotiv San. Tic. Ltd. Şti.', phone: '0539 888 99 00', email: 'yildiz@yildizoto.com', kurum: true, sgk: true, gecici: false },
  { id: 'm10', unvan: 'Hasan Demirci', phone: '0541 999 00 11', email: null, kurum: false, sgk: true, gecici: false },
  { id: 'm11', unvan: 'Nova Yazılım ve Danışmanlık A.Ş.', phone: '0542 000 11 22', email: 'ops@novayazilim.com', kurum: true, sgk: true, gecici: false },
  { id: 'm12', unvan: 'Kardeşler Nakliyat Ltd. Şti.', phone: '0543 111 22 33', email: null, kurum: true, sgk: false, gecici: false },
];
const BU_AY = `${simdi.getFullYear()}-${String(simdi.getMonth() + 1).padStart(2, '0')}`;
const TEST_TELEFON = '0535 058 74 75';

/** "YYYY-MM" → { y, m } */
function ayParcala(month) {
  const mm = /^(\d{4})-(\d{2})$/.exec(month || '') || [null, simdi.getFullYear(), String(simdi.getMonth() + 1).padStart(2, '0')];
  return { y: Number(mm[1]), m: Number(mm[2]) };
}
/** Son ödeme günü: hafta sonuna denk gelirse ilk iş gününe kaydır. gunNo = ayın günü ('son' = ayın son günü) */
function sonGun(y, m, gunNo) {
  const sonGunSayisi = new Date(y, m, 0).getDate();
  const g = gunNo === 'son' ? sonGunSayisi : Math.min(gunNo, sonGunSayisi);
  const ham = new Date(y, m - 1, g);
  const kaydirilmis = new Date(ham);
  while (kaydirilmis.getDay() === 0 || kaydirilmis.getDay() === 6) kaydirilmis.setDate(kaydirilmis.getDate() + 1);
  const gay = (d) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { sonGun: gay(kaydirilmis), sonGunHam: gay(ham), sonGunIso: iso(kaydirilmis) };
}
/** Sabit ama mükellefe göre değişen tutar */
function tutar(taban, idx, tohum) {
  return Math.round((taban + ((idx * 7919 + tohum * 104729) % 9000) + ((idx * 37 + tohum * 11) % 100) / 100) * 100) / 100;
}
function odemeSatirlari(mk, idx, month) {
  const { y, m } = ayParcala(month);
  const oncekiAy = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  const s = [];
  s.push({ tur: 'KDV1', turAd: 'KDV (KDV1)', kaynak: 'VERGI', grup: 'AYLIK', donem: oncekiAy, ...sonGun(y, m, 28), tutar: tutar(4200, idx, 1) });
  s.push({ tur: 'MUHSGK', turAd: 'Muhtasar (MUHSGK)', kaynak: 'VERGI', grup: 'AYLIK', donem: oncekiAy, ...sonGun(y, m, 26), tutar: tutar(2600, idx, 2) });
  if (idx % 3 === 0) s.push({ tur: 'DAMGA', turAd: 'Damga Vergisi', kaynak: 'VERGI', grup: 'AYLIK', donem: oncekiAy, ...sonGun(y, m, 10), tutar: tutar(180, idx, 3), storageKey: 'https://example.com/fis/damga-' + mk.id + '.pdf' });
  if (mk.gecici) s.push({ tur: mk.kurum ? 'KGECICI' : 'GGECICI', turAd: mk.kurum ? 'Kurum Geçici' : 'Gelir Geçici', kaynak: 'VERGI', grup: 'GECICI', donem: `${y}-Q${Math.max(1, Math.ceil((m - 1) / 3))}`, ...sonGun(y, m, 17), tutar: tutar(15800, idx, 4) });
  if (mk.yillik) s.push({ tur: 'KURUMLAR', turAd: 'Kurumlar Vergisi', kaynak: 'VERGI', grup: 'YILLIK', donem: String(y - 1), ...sonGun(y, m, 'son'), taksit: m % 2 === 0 ? '2/2' : '1/2', tutar: tutar(42500, idx, 5) });
  if (mk.sgk) s.push({ tur: 'Tahakkuk Fişi', turAd: 'SGK Prim Tahakkuku', kaynak: 'SGK', grup: 'SGK', donem: oncekiAy.replace('-', '/'), ...sonGun(y, m, 'son'), tutar: tutar(9800, idx, 6), storageKey: idx % 2 === 0 ? 'sgk/' + mk.id + '/' + oncekiAy + '.pdf' : null });
  return s;
}
/** Sahte ayar (test modu + açık kanallar) — önizleme betiği POST /aylik-odeme/__ayar ile değiştirir, __sifirla geri alır */
const MOCK_AYAR_VARSAYILAN = { testMode: true, kanallar: { whatsapp: true, email: true } };
let MOCK_AYAR = { ...MOCK_AYAR_VARSAYILAN, kanallar: { ...MOCK_AYAR_VARSAYILAN.kanallar } };
const KANAL_ADLARI = ['WHATSAPP', 'EMAIL'];
/** Kalem anahtarı: tür + dönem + taksit (aynı mükellefte tekil) */
function kalemAnahtari(s) {
  return `${s.tur}|${s.donem}|${s.taksit || ''}`;
}
function kalemKaydi(sentAt, test, kanallar) {
  return { WHATSAPP: kanallar.includes('WHATSAPP') ? { sentAt, test } : null, EMAIL: kanallar.includes('EMAIL') ? { sentAt, test } : null };
}
function kalemGitti(k) {
  return !!k && KANAL_ADLARI.some((kanal) => k[kanal] && k[kanal].sentAt);
}
/**
 * Gönderim durumu ay bazında bellekte, KALEM BAZLI:
 *   { "2026-09": { m1: { kalemler: { "KDV1|2026-08|": { WHATSAPP: {sentAt,test}|null, EMAIL: … } }, hata: { VERGI: 'sebep' } } } }
 * Tohum (bu ay): m1 Öz Ela KISMEN (2/3 vergi kalemi WhatsApp ile gitti, Kurum Geçici YENİ; SGK gitti) · m3 Ayşegül TAMAMEN
 * (vergi WhatsApp + e-posta, SGK WhatsApp) · m6 Ela Tekstil HATALI · m9 Yıldız yalnız vergi TEST alıcısına, SGK yeni · diğerleri HİÇ.
 */
const GONDERIM = {};
function gonderimDurumu(month) {
  if (!GONDERIM[month]) {
    const g = {};
    if (month === BU_AY) {
      const satirlariAl = (id) => {
        const i = ODEME_MUKELLEFLER.findIndex((mk) => mk.id === id);
        return odemeSatirlari(ODEME_MUKELLEFLER[i], i + 1, month);
      };
      const tohum = (id, sec) => {
        const kayit = { kalemler: {}, hata: {} };
        for (const s of satirlariAl(id)) {
          const k = sec(s);
          if (k) kayit.kalemler[kalemAnahtari(s)] = k;
        }
        g[id] = kayit;
      };
      tohum('m1', (s) => (s.tur === 'KDV1' || s.tur === 'MUHSGK' || s.kaynak === 'SGK' ? kalemKaydi(saatOnce(49), false, ['WHATSAPP']) : null)); // KISMEN + 1 yeni (Kurum Geçici)
      tohum('m3', (s) => kalemKaydi(saatOnce(50), false, s.kaynak === 'SGK' ? ['WHATSAPP'] : ['WHATSAPP', 'EMAIL'])); // TAMAMEN gönderilmiş
      g.m6 = { kalemler: {}, hata: { VERGI: 'whatsapp gönderilemedi (oturum kapalı)' } }; // HATALI
      tohum('m9', (s) => (s.kaynak !== 'SGK' ? kalemKaydi(saatOnce(26), true, ['WHATSAPP']) : null)); // yalnız vergi, TEST alıcısına; SGK yeni
    }
    GONDERIM[month] = g;
  }
  return GONDERIM[month];
}
/** Kaynak (VERGI / SGK) düzeyi bilgi — kalem kayıtlarından türetilir; hiç gitmediyse ve hata yoksa null */
function kaynakBilgisi(satirlar, kayit, kaynak) {
  const rows = satirlar.filter((s) => (kaynak === 'SGK') === (s.kaynak === 'SGK'));
  if (!rows.length) return null;
  const kalemler = (kayit && kayit.kalemler) || {};
  let gonderilen = 0;
  let sentAt = null;
  let test = false;
  const kanallar = new Set();
  for (const s of rows) {
    const k = kalemler[kalemAnahtari(s)];
    if (!kalemGitti(k)) continue;
    gonderilen++;
    for (const kanal of KANAL_ADLARI) {
      const p = k[kanal];
      if (!p || !p.sentAt) continue;
      kanallar.add(kanal);
      if (!sentAt || p.sentAt > sentAt) sentAt = p.sentAt;
      test = test || !!p.test;
    }
  }
  const hata = kayit && kayit.hata && kayit.hata[kaynak];
  if (!gonderilen && !hata) return null;
  return { status: hata ? 'FAILED' : 'SENT', sentAt, kanallar: [...kanallar], test, toplamKalem: rows.length, gonderilenKalem: gonderilen, yeniKalem: rows.length - gonderilen };
}
const SGK_YOK = new Set();
let OTOMATIK = { aktif: false, gun: 20, saat: 9, onayGerekli: true, sonKosu: null };

function odemeListesi(month, taxpayerId) {
  const g = gonderimDurumu(month);
  const { m } = ayParcala(month);
  return ODEME_MUKELLEFLER
    // Başka aylarda liste biraz farklı olsun (gezinme çalışıyor mu görünsün)
    .filter((mk, i) => (month === BU_AY ? true : (i + m) % 4 !== 0))
    .filter((mk) => !taxpayerId || mk.id === taxpayerId)
    .map((mk, i) => {
      const ham = odemeSatirlari(mk, i + 1, month);
      const kayit = g[mk.id] || null;
      const kalemler = (kayit && kayit.kalemler) || {};
      // Satır düzeyi: gonderim.WHATSAPP / EMAIL = { sentAt, test } | null
      const satirlar = ham.map((s) => ({ ...s, gonderim: kalemler[kalemAnahtari(s)] || { WHATSAPP: null, EMAIL: null } }));
      return {
        taxpayerId: mk.id,
        unvan: mk.unvan,
        phone: mk.phone,
        email: mk.email,
        toplam: Math.round(satirlar.reduce((a, s) => a + s.tutar, 0) * 100) / 100,
        satirlar,
        gonderim: { VERGI: kaynakBilgisi(ham, kayit, 'VERGI'), SGK: kaynakBilgisi(ham, kayit, 'SGK') },
      };
    });
}
/** Hiç gitmemiş kalem sayısı */
function yeniKalemSayisi(r) {
  return r.satirlar.filter((s) => !kalemGitti(s.gonderim)).length;
}
/** Mükellef bazında tek durum: FAILED var → hata; hiç yeni kalem yok → gönderildi; yoksa bekliyor (yeni kalemi var) */
function mukellefDurumu(r) {
  if ([r.gonderim.VERGI, r.gonderim.SGK].some((p) => p && p.status === 'FAILED')) return 'hata';
  if (r.satirlar.length && yeniKalemSayisi(r) === 0) return 'gonderildi';
  return 'bekliyor';
}
function odemeOzeti(month) {
  const liste = odemeListesi(month);
  const tum = liste.flatMap((r) => r.satirlar);
  const top = (f) => Math.round(tum.filter(f).reduce((a, s) => a + s.tutar, 0) * 100) / 100;
  const b = gunBasi();
  const bugunIso = `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, '0')}-${String(b.getDate()).padStart(2, '0')}`;
  const yakin = tum.filter((s) => s.sonGunIso >= bugunIso).sort((a, c) => (a.sonGunIso < c.sonGunIso ? -1 : 1))[0];
  return {
    month,
    mukellef: liste.length,
    kalem: tum.length,
    vergiToplam: top((s) => s.grup === 'AYLIK'),
    sgkToplam: top((s) => s.grup === 'SGK'),
    geciciToplam: top((s) => s.grup === 'GECICI'),
    yillikToplam: top((s) => s.grup === 'YILLIK'),
    toplam: top(() => true),
    gonderilen: liste.filter((r) => mukellefDurumu(r) === 'gonderildi').length,
    bekleyen: liste.filter((r) => mukellefDurumu(r) === 'bekliyor').length, // yeni kalemi olan mükellef
    hatali: liste.filter((r) => mukellefDurumu(r) === 'hata').length,
    yeniKalemToplam: liste.reduce((a, r) => a + yeniKalemSayisi(r), 0),
    enYakinSonGun: yakin ? { tarih: yakin.sonGunIso, turAd: yakin.turAd } : null,
    testMode: MOCK_AYAR.testMode,
    testPhone: TEST_TELEFON,
    testEmail: MOCK_AYAR.testMode ? 'test@morenmusavirlik.com' : null,
    kanallar: { ...MOCK_AYAR.kanallar },
    otomatik: OTOMATIK,
  };
}
function odemeEksikleri(month) {
  const { y, m } = ayParcala(month);
  const oncekiAy = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  const listede = new Set(odemeListesi(month).map((r) => r.taxpayerId));
  const eksik = [
    { taxpayerId: 'x1', unvan: 'Güneş Turizm Ltd. Şti.', kaynak: 'VERGI', sebep: 'Tahakkuk fişi henüz çekilmedi', beyanTipi: 'KDV1', donem: oncekiAy },
    { taxpayerId: 'x1', unvan: 'Güneş Turizm Ltd. Şti.', kaynak: 'SGK', sebep: 'SGK bildirgesi bulunamadı', donem: oncekiAy },
    { taxpayerId: 'x2', unvan: 'Selin Aydın', kaynak: 'VERGI', sebep: 'GİB girişi başarısız (şifre)', beyanTipi: 'MUHSGK', donem: oncekiAy },
    { taxpayerId: 'm2', unvan: 'Erdoğan Balçık', kaynak: 'SGK', sebep: 'SGK tahakkuk fişi çekilmedi', donem: oncekiAy },
    { taxpayerId: 'm12', unvan: 'Kardeşler Nakliyat Ltd. Şti.', kaynak: 'SGK', sebep: 'SGK bildirgesi bulunamadı', donem: oncekiAy },
    { taxpayerId: 'm8', unvan: 'Dilek Bayageldi', kaynak: 'VERGI', sebep: 'Damga tahakkuku bulunamadı', beyanTipi: 'DAMGA', donem: oncekiAy },
  ]
    .filter((e) => !(e.kaynak === 'SGK' && SGK_YOK.has(e.taxpayerId)))
    .map((e) => ({ ...e, listedeVar: listede.has(e.taxpayerId) }));
  return { eksik, takipUyeSayisi: 14 };
}
/** Küçük ama geçerli tek sayfalık PDF (xref doğru hesaplanır; Chrome açar) */
function ornekPdf(baslik) {
  const metin = String(baslik || 'Aylik Odeme Listesi').replace(/[^\x20-\x7E]/g, '?');
  const icerik = `BT /F1 20 Tf 60 780 Td (${metin}) Tj ET\nBT /F1 12 Tf 60 750 Td (Sahte API - ornek PDF) Tj ET`;
  const nesneler = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(icerik)} >>\nstream\n${icerik}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const ofsetler = [];
  nesneler.forEach((n, i) => {
    ofsetler.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${n}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${nesneler.length + 1}\n0000000000 65535 f \n` + ofsetler.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${nesneler.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'binary');
}
function dosyaGonder(res, buf, tip, ad) {
  res.writeHead(200, { 'Content-Type': tip, 'Content-Disposition': `attachment; filename="${ad}"`, 'Access-Control-Expose-Headers': 'Content-Disposition' });
  res.end(buf);
}
const PORTAL_MUKELLEF = { id: 'm1', companyName: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', firstName: null, lastName: null, taxNumber: '6420011234', email: 'muhasebe@ozela.com.tr' };

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

  // ── İletim Raporu (mock-iletim-raporu.cjs) — eşleşmezse false döner, akış devam eder ──
  if (yol.startsWith('/akilli-bildirim/') && iletimRaporuUclari(yol, yontem, q, govde, jsonGonder, res) !== false) return;
  // ── e-Defter Kontrol (mock-edefter.cjs) ──
  if (yol.startsWith('/edefter-control') && edefterUclari(yol, yontem, q, govde, jsonGonder, res) !== false) return;
  // ── Ekip (mock-ekip.cjs) ──
  if (yol.startsWith('/ekip') && ekipUclari(yol, yontem, q, govde, jsonGonder, res) !== false) return;

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
  if (yol === '/agent/events' || yol === '/taxpayers/workflow/queue') return jsonGonder(res, 200, []);
  // Gösterge paneli üst alanı: "Bugünün İş Listesi" (/bugun) + "Başvuru Sayıları" (/gundem) — görsel doğrulama verisi
  if (yol === '/bugun') return jsonGonder(res, 200, BUGUN_SAHTE());
  if (yol === '/gundem') return jsonGonder(res, 200, GUNDEM_SAHTE());
  if (yol === '/agent/stats' || yol === '/agent/status' || yol === '/moren-ai/brifing' || yol.startsWith('/beyanname-takip/ozet')) return jsonGonder(res, 200, {});
  if (yol === '/taxpayers') return jsonGonder(res, 200, [...MUKELLEFLER, ...edefterMukellefler(), ...ekipMukellefler()]);

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

  // ── Aylık Ödeme Listesi ──
  // Yalnız sahte API: bellek durumunu sıfırla (önizleme betiği her koşuda aynı tabloyu görsün)
  if (yol === '/aylik-odeme/__sifirla' && yontem === 'POST') {
    for (const k of Object.keys(GONDERIM)) delete GONDERIM[k];
    SGK_YOK.clear();
    OTOMATIK = { aktif: false, gun: 20, saat: 9, onayGerekli: true, sonKosu: null };
    MOCK_AYAR = { ...MOCK_AYAR_VARSAYILAN, kanallar: { ...MOCK_AYAR_VARSAYILAN.kanallar } };
    return jsonGonder(res, 200, { ok: true });
  }
  // Yalnız sahte API: test modu / açık kanalları değiştir (pasif düğme görüntüsü için) — { testMode?, kanallar?: { whatsapp?, email? } }
  if (yol === '/aylik-odeme/__ayar' && yontem === 'POST') {
    if (typeof govde.testMode === 'boolean') MOCK_AYAR.testMode = govde.testMode;
    if (govde.kanallar && typeof govde.kanallar === 'object') {
      if (typeof govde.kanallar.whatsapp === 'boolean') MOCK_AYAR.kanallar.whatsapp = govde.kanallar.whatsapp;
      if (typeof govde.kanallar.email === 'boolean') MOCK_AYAR.kanallar.email = govde.kanallar.email;
    }
    console.log('[mock] aylik-odeme ayar', MOCK_AYAR);
    return jsonGonder(res, 200, { ok: true, ...MOCK_AYAR });
  }
  if (yol === '/aylik-odeme' && yontem === 'GET') return jsonGonder(res, 200, odemeListesi(q.month || BU_AY, q.taxpayerId));
  if (yol === '/aylik-odeme/ozet' && yontem === 'GET') return jsonGonder(res, 200, odemeOzeti(q.month || BU_AY));
  if (yol === '/aylik-odeme/eksikler' && yontem === 'GET') return jsonGonder(res, 200, odemeEksikleri(q.month || BU_AY));
  if (yol === '/aylik-odeme/otomatik' && yontem === 'GET') return jsonGonder(res, 200, OTOMATIK);
  if (yol === '/aylik-odeme/otomatik' && yontem === 'PUT') {
    const gun = Math.min(28, Math.max(1, Number(govde.gun) || 1));
    const saat = Math.min(23, Math.max(0, Number(govde.saat) || 0));
    OTOMATIK = { ...OTOMATIK, aktif: !!govde.aktif, gun, saat, onayGerekli: !!govde.onayGerekli };
    console.log('[mock] otomatik ayar', OTOMATIK);
    return jsonGonder(res, 200, OTOMATIK);
  }
  if (yol === '/aylik-odeme/excel' && yontem === 'GET') {
    const ay = q.month || BU_AY;
    // Gerçek xlsx değil; indirme akışını denemek için küçük ikili gövde
    return dosyaGonder(res, Buffer.from(`PK sahte xlsx ${ay}`, 'binary'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `aylik-odeme-${ay}.xlsx`);
  }
  if (yol === '/aylik-odeme/pdf' && yontem === 'GET') {
    const ay = q.month || BU_AY;
    const mk = q.taxpayerId ? ODEME_MUKELLEFLER.find((x) => x.id === q.taxpayerId) : null;
    if (q.taxpayerId && !mk) return jsonGonder(res, 404, { message: 'Mükellef bulunamadı' });
    return dosyaGonder(res, ornekPdf(`${mk ? mk.unvan : 'Tum mukellefler'} - ${ay}`), 'application/pdf', `aylik-odeme-${ay}${mk ? '-' + mk.id : ''}.pdf`);
  }
  // POST /aylik-odeme/send { month, taxpayerId?, mod?: 'gonderilmemis'|'hepsi'|'yeniden', kanal?: 'WHATSAPP'|'EMAIL' }
  //   → { ok, testMode, count, atlanan, results: [{ taxpayerId, unvan, grup, channel, status, error, kalem, yeni }] }
  //   'gonderilmemis': yalnız o kanaldan daha önce gitmemiş kalemler gider; 'hepsi' / 'yeniden': tüm kalemler.
  if (yol === '/aylik-odeme/send' && yontem === 'POST') {
    const ay = govde.month || BU_AY;
    const mod = govde.mod || 'gonderilmemis';
    if (!['gonderilmemis', 'hepsi', 'yeniden'].includes(mod)) return jsonGonder(res, 400, { message: 'mod: gonderilmemis | hepsi | yeniden' });
    if (mod === 'yeniden' && !govde.taxpayerId) return jsonGonder(res, 400, { message: "'yeniden' modu tek mükellef ister (taxpayerId)" });
    const kanalParam = govde.kanal ? String(govde.kanal).toUpperCase() : null;
    if (kanalParam && !KANAL_ADLARI.includes(kanalParam)) return jsonGonder(res, 400, { message: 'kanal: WHATSAPP | EMAIL' });
    const acik = KANAL_ADLARI.filter((k) => (k === 'WHATSAPP' ? MOCK_AYAR.kanallar.whatsapp : MOCK_AYAR.kanallar.email));
    const kanallar = kanalParam ? acik.filter((k) => k === kanalParam) : acik;
    if (!kanallar.length) return jsonGonder(res, 400, { message: kanalParam ? `${kanalParam} kanalı kapalı` : 'Açık gönderim kanalı yok' });
    const testMode = MOCK_AYAR.testMode;
    const g = gonderimDurumu(ay);
    const hedef = odemeListesi(ay, govde.taxpayerId || undefined);
    const results = [];
    let atlanan = 0;
    const simdiIso = new Date().toISOString();
    for (const r of hedef) {
      const kayit = g[r.taxpayerId] || (g[r.taxpayerId] = { kalemler: {}, hata: {} });
      let birSeyGitti = false;
      for (const kaynak of ['VERGI', 'SGK']) {
        const rows = r.satirlar.filter((s) => (kaynak === 'SGK') === (s.kaynak === 'SGK'));
        if (!rows.length) continue;
        for (const kanal of kanallar) {
          const kayitAl = (s) => kayit.kalemler[kalemAnahtari(s)];
          const gidecek = mod === 'gonderilmemis' ? rows.filter((s) => !(kayitAl(s) && kayitAl(s)[kanal] && kayitAl(s)[kanal].sentAt)) : rows;
          if (!gidecek.length) continue;
          const yeni = gidecek.filter((s) => !kalemGitti(kayitAl(s))).length;
          const iletisim = kanal === 'WHATSAPP' ? r.phone : r.email;
          const ok = testMode || !!iletisim;
          if (ok) {
            for (const s of gidecek) {
              const k = kayitAl(s) || (kayit.kalemler[kalemAnahtari(s)] = { WHATSAPP: null, EMAIL: null });
              k[kanal] = { sentAt: simdiIso, test: testMode };
            }
            delete kayit.hata[kaynak];
          } else {
            kayit.hata[kaynak] = kanal === 'WHATSAPP' ? 'mükellefin telefon numarası yok' : 'mükellefin e-postası yok';
          }
          results.push({ taxpayerId: r.taxpayerId, unvan: r.unvan, grup: kaynak, channel: kanal, status: ok ? 'SENT' : 'FAILED', error: ok ? null : kayit.hata[kaynak], kalem: gidecek.length, yeni });
          birSeyGitti = true;
        }
      }
      if (!birSeyGitti) atlanan++;
    }
    console.log(`[mock] send mod=${mod} kanal=${kanalParam || 'hepsi'} taxpayerId=${govde.taxpayerId || '-'} → ${results.length} sonuç, ${atlanan} atlandı`);
    return jsonGonder(res, 200, { ok: true, month: ay, testMode, mod, kanal: kanalParam, count: results.length, atlanan, results });
  }
  if (yol === '/aylik-odeme/ornek-gonder' && yontem === 'POST') {
    const hedef = odemeListesi(govde.month || BU_AY, govde.taxpayerId || undefined)[0];
    const mesaj = hedef
      ? `Sayın ${hedef.unvan},\n${govde.month || BU_AY} ayı ödemeleriniz:\n${hedef.satirlar.map((s) => `• ${s.turAd} (${s.donem}) — son gün ${s.sonGun} — ${s.tutar.toFixed(2)} ₺`).join('\n')}\nToplam: ${hedef.toplam.toFixed(2)} ₺`
      : 'Örnek cetvel';
    return jsonGonder(res, 200, { ok: true, telefonlar: [TEST_TELEFON], mesajlar: [mesaj] });
  }
  if (yol === '/aylik-odeme/eksik/sgk-yok' && yontem === 'POST') {
    if (!govde.taxpayerId) return jsonGonder(res, 400, { message: 'taxpayerId gerekli' });
    SGK_YOK.add(govde.taxpayerId);
    console.log('[mock] sgk-yok', govde.taxpayerId);
    return jsonGonder(res, 200, { ok: true });
  }

  // ── Mükellef portalı (sahte: her giriş m1 = Öz Ela) ──
  if (yol === '/portal/auth/login' && yontem === 'POST') return jsonGonder(res, 200, { accessToken: 'sahte-mukellef-token', taxpayer: PORTAL_MUKELLEF });
  if (yol === '/portal/me') return jsonGonder(res, 200, PORTAL_MUKELLEF);
  if (yol === '/portal/dashboard') return jsonGonder(res, 200, { profile: PORTAL_MUKELLEF, ozet: { okunmamisTebligat: 0 }, faturaOzet: { alisToplam: 0, satisToplam: 0 }, faturaAylik: [] });
  if (yol === '/portal/brifing') return jsonGonder(res, 200, { summary: 'Bu ay 4 ödeme kaleminiz var; en yakını 17 Eylül geçici vergi. Belge eksiği görünmüyor.', alerts: [], suggestions: [], focus: 'calm', generatedAt: new Date().toISOString(), fromCache: false, ad: PORTAL_MUKELLEF.companyName });
  if (yol === '/taxpayer-portal/odeme-cetveli' && yontem === 'GET') {
    const r = odemeListesi(q.month || BU_AY, PORTAL_MUKELLEF.id)[0];
    return jsonGonder(res, 200, r ? { month: q.month || BU_AY, satirlar: r.satirlar, toplam: r.toplam, gonderim: r.gonderim } : { month: q.month || BU_AY, satirlar: [], toplam: 0, gonderim: null });
  }


  // ── Mükellef kartı (2026-09-14: kart yeniden tasarımı + Otomatik Sorgulama Ayarı görsel doğrulaması) ──
  {
    const mk = /^\/taxpayers\/([^/]+)(\/.*)?$/.exec(yol);
    if (mk && mukellefBul(mk[1])) {
      const id = mk[1];
      const alt = mk[2] || '';
      const m = mukellefBul(id);
      const detay = () => ({
        ...m,
        type: m.type === 'COMPANY' ? 'TUZEL_KISI' : 'GERCEK_KISI',
        isActive: true,
        taxOffice: 'BÜYÜKÇEKMECE',
        phones: ['0533 923 36 74', '0212 555 00 11'],
        telefonAdlari: { '905339233674': 'Muzaffer Bey' },
        emails: ['info@ornek.com'],
        address: '',
        notes: 'Deneme notu — sahte API',
        startDate: '2021-03-01T00:00:00.000Z',
        endDate: null,
        evrakTeslimGunu: null,
        whatsappEvrakTalep: true,
        whatsappEvrakGeldi: false,
        isEFaturaMukellefi: true,
        lucaSlug: 'balcik-insaat',
        mihsapId: '',
        mihsapDefterTuru: 'BILANCO',
        defterTuru: 'BILANCO',
        logoUrl: '',
        naceKodu: '41.20.01',
        faaliyetAciklama: 'İkamet amaçlı binaların inşaatı',
        ticaretSicilNo: '123456-5',
        mersisNo: '0140003210900015',
        odaSicilNo: '',
        bagkurSicilNo: '',
        kepAdresi: '',
        webSitesi: '',
        eFaturaEntegrator: 'TURMOB',
        otomatikSorgu: KART_OTOMATIK_SORGU[id] || null,
        updatedAt: new Date().toISOString(),
      });
      if (alt === '' && yontem === 'GET') return jsonGonder(res, 200, detay());
      if (alt === '' && yontem === 'PUT') return jsonGonder(res, 200, detay());
      if (alt === '/otomatik-sorgu' && yontem === 'PATCH') {
        KART_OTOMATIK_SORGU[id] = { eTebligat: true, vergiBorcu: false, gelenEArsiv: false, pos: false, eHaciz: false, yoklama: false, ...(KART_OTOMATIK_SORGU[id] || {}), ...govde };
        console.log('[mock] otomatik-sorgu', id, KART_OTOMATIK_SORGU[id]);
        return jsonGonder(res, 200, detay());
      }
      if (alt === '/completeness') return jsonGonder(res, 200, { score: 82, durum: 'IYI', eksikler: [{ key: 'address', label: 'Adres' }, { key: 'evrakTeslimGunu', label: 'Evrak Teslim Günü' }] });
      if (alt === '/yetkililer' && yontem === 'GET') return jsonGonder(res, 200, [{ id: 'y1', adSoyad: 'Erdoğan Balçık', unvan: 'Müdür', telefon: '0533 923 36 74', email: 'erdogan@ornek.com', tckn: '14523698745' }]);
      if (alt === '/yetkililer' && yontem === 'POST') return jsonGonder(res, 201, { id: 'y' + Date.now(), ...govde });
    }
  }
  if (yol === '/portal-automation/credentials' && yontem === 'GET') {
    return jsonGonder(res, 200, {
      summary: { total: 2, active: 2 },
      rows: [
        { id: 'c1', provider: 'GIB_IVD', ownerType: 'TAXPAYER', ownerId: 'm7', taxpayerId: 'm7', userCode: '1400032109', hasPassword: true, hasSecondaryPassword: false, isActive: true, lastError: null, lastCheckedAt: saatOnce(9) },
        { id: 'c2', provider: 'SGK_EBILDIRGE', ownerType: 'TAXPAYER', ownerId: 'm7', taxpayerId: 'm7', username: 'balcik', userCode: '', workplaceCode: '2 1234 01 01 1234567 034 12 34', hasPassword: true, hasSecondaryPassword: true, isActive: true, lastError: null, lastCheckedAt: saatOnce(9) },
      ],
    });
  }
  if (yol === '/portal-automation/documents' && yontem === 'GET') {
    const tur = q.belgeTuru || '';
    const tebligat = [
      { id: 'pd1', taxpayerId: q.taxpayerId || 'm7', belgeTuru: 'E_TEBLIGAT', sourceProvider: 'GIB_IVD', title: 'Vergi/Ceza İhbarnamesi', referenceNo: '2026-TB-000412', period: null, issuedAt: gun(-3), receivedAt: gun(-3), storageKey: 'x', documentId: null, viewedAt: null, createdAt: gun(-3), metadata: { kurumAciklama: 'Büyükçekmece Vergi Dairesi', belgeTuruAciklama: 'İhbarname', tebligZamani: gun(-3), mukellefOkumaZamani: null } },
      { id: 'pd2', taxpayerId: q.taxpayerId || 'm7', belgeTuru: 'E_TEBLIGAT', sourceProvider: 'GIB_IVD', title: 'Ödeme Emri', referenceNo: '2026-TB-000377', period: null, issuedAt: gun(-20), receivedAt: gun(-20), storageKey: 'x', documentId: null, viewedAt: gun(-18), createdAt: gun(-20), metadata: { kurumAciklama: 'Büyükçekmece Vergi Dairesi', belgeTuruAciklama: 'Ödeme Emri', tebligZamani: gun(-20), mukellefOkumaZamani: gun(-18) } },
    ];
    const sgk = [
      { id: 'pd3', taxpayerId: q.taxpayerId || 'm7', belgeTuru: 'SGK_TAHAKKUK', sourceProvider: 'SGK_EBILDIRGE', title: 'Tahakkuk Fişi 2026/08', referenceNo: 'THK-2026-08', period: '2026-08', issuedAt: gun(-10), receivedAt: gun(-10), storageKey: 'x', documentId: null, viewedAt: null, createdAt: gun(-10), metadata: { donem: '2026/08', belgeMahiyeti: 'ASIL', kanunNo: '05510', calisan: '12', tutar: '48.320,15' } },
      { id: 'pd4', taxpayerId: q.taxpayerId || 'm7', belgeTuru: 'SGK_HIZMET_LISTESI', sourceProvider: 'SGK_EBILDIRGE', title: 'Hizmet Listesi 2026/08', referenceNo: 'HL-2026-08', period: '2026-08', issuedAt: gun(-10), receivedAt: gun(-10), storageKey: 'x', documentId: null, viewedAt: null, createdAt: gun(-10), metadata: { donem: '2026/08', belgeMahiyeti: 'ASIL', kanunNo: '05510', calisan: '12', tutar: '' } },
    ];
    const hepsi = [...tebligat, ...sgk].filter((d) => !tur || tur.split(',').includes(d.belgeTuru));
    return jsonGonder(res, 200, hepsi);
  }
  if (yol.startsWith('/portal-automation/documents/') && yol.endsWith('/view')) return jsonGonder(res, 200, { url: 'about:blank', viewedAt: new Date().toISOString() });
  if (yol === '/beyan-kayitlari' && yontem === 'GET') {
    const tp = q.taxpayerId || 'm7';
    const satir = (i, tip, donem, tutar) => ({ id: 'bk' + i, taxpayerId: tp, beyanTipi: tip, donem, beyanTarihi: gun(-i * 9), tahakkukTutari: tutar, odemeTutari: tutar, onayNo: 'ON' + (100000 + i), pdfUrl: 'x', beyannameUrl: 'x', xmlUrl: null, kaynak: 'gib', importBatchId: null, notlar: null, createdAt: gun(-i * 9), updatedAt: gun(-i * 9), taxpayer: mukellefBul(tp), iletimler: [] });
    const satirlar = [satir(1, 'KDV1', '2026-08', 12450.5), satir(2, 'MUHSGK', '2026-08', 31200), satir(3, 'KDV1', '2026-07', 9870.25), satir(4, 'DAMGA', '2026-07', 420), satir(5, 'GECICI_VERGI', '2026-Q2', 15600), satir(6, 'KDV1', '2025-12', 8100)];
    return jsonGonder(res, 200, q.page ? { rows: satirlar, total: satirlar.length, page: 1, pageSize: 50 } : satirlar);
  }
  if (yol.startsWith('/documents/taxpayer/')) return jsonGonder(res, 200, [
    { id: 'd1', title: 'İmza Sirküleri', category: 'SOZLESME', fileName: 'imza-sirkuleri.pdf', mimeType: 'application/pdf', size: 245000, createdAt: gun(-40), updatedAt: gun(-40), taxpayerId: 'm7', description: 'Noter onaylı, 2026', source: 'manual' },
    { id: 'd2', title: 'Vergi Levhası 2026', category: 'RESMI_EVRAK', fileName: 'vergi-levhasi-2026.pdf', mimeType: 'application/pdf', size: 90000, createdAt: gun(-120), updatedAt: gun(-120), taxpayerId: 'm7', description: '', source: 'manual' },
  ]);
  if (yol.startsWith('/cari-kasa/bakiye/')) return jsonGonder(res, 200, { tahakkuk: 96000, tahsilat: 84000, iade: 0, duzeltme: 0, borc: 96000, alacak: 84000, bakiye: 12000 });
  if (yol === '/cari-kasa/hareket') return jsonGonder(res, 200, [
    { id: 'h1', tarih: gun(-2), tip: 'TAHAKKUK', tutar: 8000, aciklama: 'Eylül 2026 muhasebe ücreti', donem: '2026-09', runningBakiye: 12000, hizmet: { hizmetAdi: 'Aylık muhasebe' } },
    { id: 'h2', tarih: gun(-12), tip: 'TAHSILAT', tutar: 8000, aciklama: 'Havale', odemeYontemi: 'HAVALE', donem: '2026-08', runningBakiye: 4000 },
    { id: 'h3', tarih: gun(-33), tip: 'TAHAKKUK', tutar: 8000, aciklama: 'Ağustos 2026 muhasebe ücreti', donem: '2026-08', runningBakiye: 12000, hizmet: { hizmetAdi: 'Aylık muhasebe' } },
  ]);
  if (yol.startsWith('/beyanname-takip/configs/')) return jsonGonder(res, 200, { taxpayerId: 'm7', beyanTurleri: ['KDV1', 'MUHSGK', 'GECICI_VERGI', 'KURUMLAR'], donemler: {} });
  if (yol.startsWith('/portal/admin/taxpayers/') && yol.endsWith('/ai-chat')) return jsonGonder(res, 200, { messages: [] });
  if (yol === '/genel-sorgular/ozet') return jsonGonder(res, 200, { VERGI_BORCU: { adet: 2, sonSorgu: gun(-1) }, E_HACIZ: { adet: 1, sonSorgu: gun(-1) }, YOKLAMA_DENETIM: { adet: 1, sonSorgu: gun(-6) }, POS: { adet: 1, sonSorgu: gun(-1) }, GELEN_EARSIV: { adet: 1, sonSorgu: gun(-1) } });
  if (yol === '/genel-sorgular' && yontem === 'GET') {
    const tp = mukellefBul('m7');
    const satir = (id, tur, donem, ozet, veri, gunSayisi) => ({ id, taxpayerId: 'm7', taxpayer: tp, tur, donem, sorguTarihi: gun(-gunSayisi), ozet, veri, kaynak: 'nightly', whatsappGonderildiMi: tur !== 'POS' });
    const hepsi = [
      satir('g1', 'VERGI_BORCU', '2026-09', '2 kalem borç, vadesi geçen 1', { toplamBorc: 18450.75, kalemler: [{ vergi: 'KDV', donem: '2026/07', tutar: 12450.5, vade: '2026-08-28' }, { vergi: 'Damga', donem: '2026/07', tutar: 6000.25, vade: '2026-09-26' }] }, 1),
      satir('g2', 'VERGI_BORCU', '2026-08', 'Borç yok', { toplamBorc: 0, kalemler: [] }, 31),
      satir('g3', 'E_HACIZ', null, 'Aktif e-haciz yok', { durum: 'YOK', kayitlar: [] }, 1),
      satir('g4', 'YOKLAMA_DENETIM', null, '1 yoklama tutanağı (işyeri adres tespiti)', { tarih: gun(-6), tutanaklar: [{ no: 'YK-2026-118', konu: 'İşyeri adres tespiti', sonuc: 'Faal' }] }, 6),
      satir('g5', 'POS', '2026-08', 'Ağustos POS cirosu', { toplamTutar: 264180.4, cihazSayisi: 2, bankalar: [{ banka: 'Ziraat', tutar: 150200.1 }, { banka: 'Garanti', tutar: 113980.3 }] }, 1),
      satir('g6', 'GELEN_EARSIV', '2026-08', '3 gelen e-Arşiv faturası', { faturalar: [{ no: 'EAR2026000001', tarih: '2026-08-04', unvan: 'ABC Yapı Malz.', tutar: 12000 }, { no: 'EAR2026000002', tarih: '2026-08-15', unvan: 'Delta Nakliyat', tutar: 4800 }, { no: 'EAR2026000003', tarih: '2026-08-29', unvan: 'Omega Hırdavat', tutar: 2350.6 }] }, 1),
    ].filter((r) => (!q.tur || r.tur === q.tur) && (!q.taxpayerId || r.taxpayerId === q.taxpayerId) && (!q.donem || !r.donem || r.donem === q.donem));
    return jsonGonder(res, 200, { rows: hepsi, total: hepsi.length, page: 1, pageSize: 50 });
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

// ---- Gösterge paneli üst alanı sahte verisi ----
const BUGUN_SAHTE = () => ({
  tarih: new Date().toISOString().slice(0, 10), gun: new Date().getDate(),
  odak: 'Önce: 2 okunmamış e-Tebligat (1 yeni) — ÖZ ULU İNŞAAT',
  odakHref: '/panel/mukellefler/tx-1',
  gruplar: [
    { key: 'gorev', baslik: 'Görevler', bosMetin: 'Bugün ve geciken görev yok', ozet: '3 bugün · 12 geciken', toplam: 15, href: '/panel/gorevler', satirlar: [
      { id: 'gv-1', metin: 'Vergi levhası yenile — GİTO GIDA', alt: 'bugün', sayi: null, vurgu: 'uyari', href: '/panel/gorevler' },
      { id: 'gv-2', metin: 'SGK işe giriş bildirimi — ÖZ ULU', alt: '3 gün gecikti', sayi: 3, sayiEtiket: 'gün', vurgu: 'kritik', href: '/panel/gorevler' },
      { id: 'gv-3', metin: 'Mizan kontrolü Ağustos', alt: '6 gün gecikti', sayi: 6, sayiEtiket: 'gün', vurgu: 'kritik', href: '/panel/gorevler' },
      { id: 'gv-4', metin: 'Kira kontratı damga — KAYATAN MİMARLIK', alt: '9 gün gecikti', sayi: 9, sayiEtiket: 'gün', vurgu: 'kritik', href: '/panel/gorevler' },
    ] },
    { key: 'dun', baslik: 'Dünden Beri', bosMetin: 'Son 24 saatte yeni bir şey gelmedi', href: '/panel/bildirimler', satirlar: [
      { id: 'dn-tebligat', metin: '2 okunmamış e-Tebligat (1 yeni)', alt: 'ÖZ ULU İNŞAAT · FAMCOFFEE', sayi: 2, vurgu: 'kritik', href: '/panel/mukellefler/tx-1' },
      { id: 'dn-fatura', metin: '37 yeni fatura düştü', alt: '21 tanesi henüz işlenmedi', sayi: 21, sayiEtiket: 'işlenmedi', vurgu: 'uyari', href: '/fatura-merkezi' },
      { id: 'dn-belge', metin: '5 yeni belge yüklendi', alt: 'WhatsApp / portal / sürükle-bırak', sayi: 5, vurgu: 'normal', href: '/panel/evraklar' },
      { id: 'dn-ajan', metin: '1 ajan hatası', alt: 'Luca çekim 1', sayi: 1, vurgu: 'uyari', href: '/panel/ajanlar' },
    ] },
    { key: 'takilan', baslik: 'Takılan Mükellefler', bosMetin: 'Uzun süredir bekleyen mükellef yok', toplam: 6, href: '/panel/is-yuku', satirlar: [
      { id: 'tk-1', metin: 'AYŞEGÜL ARSLAN', alt: '12 gündür evrak işlenmeyi bekliyor', sayi: 12, sayiEtiket: 'gün', vurgu: 'kritik', href: '/panel/mukellefler/tx-2' },
      { id: 'tk-2', metin: 'MERT REKLAM AJANSI', alt: '8 gündür KDV kontrol bekliyor', sayi: 8, sayiEtiket: 'gün', vurgu: 'uyari', href: '/panel/mukellefler/tx-3' },
      { id: 'tk-3', metin: 'ERDOĞAN BALÇIK', alt: '6 gündür beyanname bekliyor', sayi: 6, sayiEtiket: 'gün', vurgu: 'uyari', href: '/panel/mukellefler/tx-4' },
    ] },
    { key: 'tahsilat', baslik: 'Tahsilat', bosMetin: 'Açık bakiye yok', ozet: '58 mükellef · 1.747.094 TL', toplam: 58, href: '/panel/cari-kasa', satirlar: [
      { id: 'th-1', metin: 'KAYATAN MİMARLIK İNŞAAT SANAYİ TİCARET LİMİTED ŞİRKETİ', alt: 'açık bakiye', sayi: 113000, sayiEtiket: 'TL', vurgu: 'uyari', href: '/panel/cari-kasa?mukellef=tx-5' },
      { id: 'th-2', metin: 'GİTO GIDA', alt: 'açık bakiye', sayi: 48500, sayiEtiket: 'TL', vurgu: 'normal', href: '/panel/cari-kasa?mukellef=tx-6' },
      { id: 'th-3', metin: 'FAMCOFFEE', alt: 'açık bakiye', sayi: 27300, sayiEtiket: 'TL', vurgu: 'normal', href: '/panel/cari-kasa?mukellef=tx-7' },
    ] },
  ],
  uretimZamani: new Date(Date.now() - 4 * 60000).toISOString(), onbellekten: true,
});
const GUNDEM_SAHTE = () => ({
  tarih: new Date().toISOString().slice(0, 10), kurTarihi: '18.09.2026',
  kurlar: [
    { kod: 'USD', isim: 'Dolar', alis: 48.6, satis: 48.6749, degisimYuzde: 0.02 },
    { kod: 'EUR', isim: 'Euro', alis: 55.8, satis: 55.8552, degisimYuzde: -0.55 },
    { kod: 'GBP', isim: 'Sterlin', alis: 65.2, satis: 65.2961, degisimYuzde: -0.55 },
  ],
  piyasa: [
    { kod: 'BİST 100', isim: 'Borsa İstanbul', deger: 13284, birim: '', degisimYuzde: -6.68, ondalik: 0 },
    { kod: 'GRAM ALTIN', isim: 'Gram altın', deger: 6872.57, birim: 'TL', degisimYuzde: 1.03, ondalik: 2 },
  ],
  enflasyon: { donem: 'Ağustos 2026', aylik: 1.84, yillik: 31.51, kiraArtisTavani: 31.79, yilbasindan: 20.1, kaynakUrl: 'https://data.tuik.gov.tr/' },
  sabitler: [
    { kod: 'GECIKME_ZAMMI', etiket: 'Gecikme zammı', deger: '%3,70', alt: 'aylık', gecerlilik: "13.11.2025'ten itibaren", kaynakUrl: 'https://www.gib.gov.tr/' },
    { kod: 'TECIL_FAIZI', etiket: 'Tecil faizi', deger: '%39', alt: 'yıllık', gecerlilik: "13.11.2025'ten itibaren", kaynakUrl: 'https://www.gib.gov.tr/' },
    { kod: 'YENIDEN_DEGERLEME', etiket: 'Yeniden değerleme', deger: '%25,49', alt: '2025 oranı · 2026 hadlerinde', gecerlilik: '2026', kaynakUrl: 'https://www.gib.gov.tr/' },
    { kod: 'ASGARI_UCRET_BRUT', etiket: 'Asgari ücret', deger: '33.030,00 TL', alt: 'brüt · net 28.075,50 TL', gecerlilik: '2026', kaynakUrl: 'https://www.csgb.gov.tr/' },
    { kod: 'SGK_TAVAN', etiket: 'SGK prim tavanı', deger: '297.270,00 TL', alt: 'aylık · brütün 9 katı', gecerlilik: '2026', kaynakUrl: 'https://www.sgk.gov.tr/' },
    { kod: 'KIDEM_TAVANI', etiket: 'Kıdem tazminatı tavanı', deger: '73.729,87 TL', alt: 'yıllık', gecerlilik: '01.07.2026 – 31.12.2026', kaynakUrl: 'https://www.csgb.gov.tr/' },
    { kod: 'YEMEK_ISTISNASI', etiket: 'Yemek istisnası', deger: '300,00 TL', alt: 'günlük · kart KDV dâhil 330 TL', gecerlilik: '2026', kaynakUrl: 'https://www.gib.gov.tr/' },
  ],
  mevzuat: [
    { baslik: 'KDV Genel Uygulama Tebliğinde Değişiklik Yapılmasına Dair Tebliğ (Seri No: 56)', url: 'https://www.resmigazete.gov.tr/', neden: 'Tevkifat oranları ve iade usulü değişiyor; tevkifatlı mükelleflerde uygulama etkilenir.', onem: 'yuksek' },
  ],
  mevzuatToplam: 15, mevzuatHazirlaniyor: false, uyarilar: [],
  uretimZamani: new Date().toISOString(), onbellekten: true,
});
