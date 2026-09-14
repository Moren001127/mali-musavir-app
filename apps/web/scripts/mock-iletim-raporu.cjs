/**
 * SAHTE API — İletim Raporu uçları (mock-api.cjs bunu tek satırla bağlar).
 *
 *   GET  /akilli-bildirim/iletim-gunlugu?month&taxpayerId&belgeTuru&kanal&durum&q&page&pageSize&sira   (İLETİM GÜNLÜĞÜ — ekran bunu kullanır)
 *   GET  /akilli-bildirim/iletim-gunlugu/excel?…aynı süzgeçler                                          (xlsx; exceljs api/node_modules'ten)
 *   GET  /akilli-bildirim/report?month=YYYY-MM                                                          (eski matris yanıtı — başka ekranlar için duruyor)
 *   POST /akilli-bildirim/resend-failed   { month }
 *   POST /akilli-bildirim/run             { kategori, taxpayerId, sinceHours }   (satır bazlı yeniden deneme)
 *   POST /akilli-bildirim/__sifirla                                             (önizleme betiği için)
 *
 * İletim günlüğü verisi: bu ay 60 satır (documentDispatch belge açılımı + communicationLog Cari Kasa/Mesaj karışık;
 * mükellef id'leri mock-api.cjs /taxpayers listesiyle AYNI: m1..m8), önceki ay hepsi iletildi, diğer aylar boş.
 *
 * Yanıt biçimi apps/api/src/akilli-bildirim/akilli-bildirim.service.ts report() ile birebir:
 *   hücre = null | { status:'BEKLIYOR', error } | { status, error, channel, testMode, sentAt, createdAt, kanallar:[…] }
 *   (üst seviye = EN KÖTÜ kanal; FAILED > PENDING > SKIPPED > SENT)
 * Bu ay: 17 mükellef — iletildi / iletilemedi / kısmen / hiç gönderilmedi / kategori kapalı (e-Tebligat) / test / belge yok karışık.
 * Önceki ay: 5 mükellef hepsi iletildi. Diğer aylar: boş.
 */

const simdi = new Date();
const BU_AY = `${simdi.getFullYear()}-${String(simdi.getMonth() + 1).padStart(2, '0')}`;
const ONCEKI_AY = (() => {
  const d = new Date(simdi.getFullYear(), simdi.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();

/** Ayın g. günü ss:dd (yerel) → ISO */
function t(month, g, ss, dd = 0) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, g, ss, dd).toISOString();
}

const MUKELLEFLER = [
  ['r1', 'Öz Ela Gıda San. ve Tic. Ltd. Şti.'],
  ['r2', 'Erdoğan Balçık'],
  ['r3', 'Ayşegül Kaya'],
  ['r4', 'Mert Reklam Ajansı Ltd. Şti.'],
  ['r5', 'Famcoffee Kahve A.Ş.'],
  ['r6', 'Ela Tekstil Ltd. Şti.'],
  ['r7', 'Balçık İnşaat A.Ş.'],
  ['r8', 'Dilek Bayageldi'],
  ['r9', 'Silber Metal San. Ltd. Şti.'],
  ['r10', 'Gito Lojistik Ltd. Şti.'],
  ['r11', 'Tuvtürk Oto Servis Ltd. Şti.'],
  ['r12', 'Başbuğ Nakliyat'],
  ['r13', 'Nms Yazılım A.Ş.'],
  ['r14', 'Ercan Aydın'],
  ['r15', 'Hattat Tarım Makineleri Ltd. Şti.'],
  ['r16', 'Kaya Eczanesi'],
  ['r17', 'Demir Çelik Yapı Ltd. Şti.'],
];

/** Kanal kaydı — DocumentDispatch satırı gibi */
function kanal(status, channel, opts = {}) {
  return {
    status,
    error: opts.error || null,
    channel,
    testMode: !!opts.testMode,
    sentAt: status === 'SENT' ? opts.at || null : null,
    createdAt: opts.at || null,
  };
}
const oncelik = (st) => (st === 'FAILED' ? 4 : st === 'PENDING' ? 3 : st === 'SKIPPED' ? 2 : st === 'SENT' ? 1 : 0);
/** Kanalları hücreye indirger (sunucu kuralı: en kötü kanal üstte) */
function hucre(...kanallar) {
  let ust = null;
  for (const k of kanallar) if (!ust || oncelik(k.status) > oncelik(ust.status)) ust = k;
  return { ...ust, kanallar };
}
const bekliyor = (sebep) => ({ status: 'BEKLIYOR', error: sebep, channel: null });
const KAPALI = 'kategori kapalı (Ayarlar > Akıllı Bildirim)';

let DURUM = null;
function sifirla() {
  const ay = BU_AY;
  const s = (g, ss, dd) => ({ at: t(ay, g, ss, dd) });
  const satir = (id, h) => ({ taxpayerId: id, unvan: MUKELLEFLER.find((m) => m[0] === id)[1], VERGI: null, SGK: null, ETEBLIGAT: null, ODEME_LISTESI: null, ...h });
  DURUM = {
    [ay]: [
      // — iletildi —
      satir('r1', {
        VERGI: hucre(kanal('SENT', 'WHATSAPP', s(12, 14, 20)), kanal('SENT', 'EMAIL', s(12, 14, 21))),
        SGK: hucre(kanal('SENT', 'WHATSAPP', s(3, 9, 5)), kanal('SENT', 'EMAIL', s(3, 9, 5))),
        ETEBLIGAT: bekliyor(KAPALI),
        ODEME_LISTESI: hucre(kanal('SENT', 'WHATSAPP', s(10, 9, 30)), kanal('SENT', 'EMAIL', s(10, 9, 30))),
      }),
      satir('r3', {
        VERGI: hucre(kanal('SENT', 'WHATSAPP', s(12, 14, 22))),
        SGK: hucre(kanal('SENT', 'WHATSAPP', s(3, 9, 6))),
        ODEME_LISTESI: hucre(kanal('SENT', 'WHATSAPP', s(10, 9, 31))),
      }),
      satir('r5', {
        VERGI: hucre(kanal('SENT', 'WHATSAPP', s(12, 14, 25)), kanal('SENT', 'EMAIL', s(12, 14, 25))),
        SGK: hucre(kanal('SENT', 'WHATSAPP', s(3, 9, 8)), kanal('SENT', 'EMAIL', s(3, 9, 8))),
        ETEBLIGAT: bekliyor(KAPALI),
        ODEME_LISTESI: hucre(kanal('SENT', 'WHATSAPP', s(10, 9, 32)), kanal('SENT', 'EMAIL', s(10, 9, 32))),
      }),
      satir('r6', {
        VERGI: hucre(kanal('SENT', 'EMAIL', s(12, 14, 26))),
        ETEBLIGAT: bekliyor(KAPALI),
      }),
      satir('r7', {
        VERGI: hucre(kanal('SENT', 'WHATSAPP', s(12, 14, 27)), kanal('SENT', 'EMAIL', s(12, 14, 27))),
        SGK: hucre(kanal('SENT', 'WHATSAPP', s(3, 9, 9)), kanal('SENT', 'EMAIL', s(3, 9, 9))),
        ODEME_LISTESI: hucre(kanal('SENT', 'WHATSAPP', s(10, 9, 33)), kanal('SENT', 'EMAIL', s(10, 9, 33))),
      }),
      satir('r9', {
        VERGI: hucre(kanal('SENT', 'WHATSAPP', s(12, 14, 28))),
        SGK: hucre(kanal('SENT', 'WHATSAPP', s(3, 9, 10))),
        ETEBLIGAT: bekliyor(KAPALI),
      }),
      satir('r13', {
        VERGI: hucre(kanal('SENT', 'WHATSAPP', s(12, 14, 29)), kanal('SENT', 'EMAIL', s(12, 14, 29))),
        ETEBLIGAT: bekliyor(KAPALI),
        ODEME_LISTESI: hucre(kanal('SENT', 'WHATSAPP', s(10, 9, 34))),
      }),
      satir('r15', {
        VERGI: hucre(kanal('SENT', 'WHATSAPP', s(12, 14, 30))),
        SGK: hucre(kanal('SENT', 'WHATSAPP', s(3, 9, 11))),
        ETEBLIGAT: bekliyor(KAPALI),
        ODEME_LISTESI: hucre(kanal('SENT', 'WHATSAPP', s(10, 9, 35))),
      }),
      // — iletilemedi —
      satir('r4', {
        VERGI: hucre(kanal('FAILED', 'WHATSAPP', { ...s(12, 14, 31), error: 'ILETISIM-mükellefin telefon numarası yok' })),
        SGK: hucre(kanal('FAILED', 'WHATSAPP', { ...s(3, 9, 12), error: 'ILETISIM-mükellefin telefon numarası yok' })),
        ETEBLIGAT: bekliyor(KAPALI),
        ODEME_LISTESI: hucre(kanal('FAILED', 'WHATSAPP', { ...s(10, 9, 36), error: 'mükellefin telefon numarası yok' })),
      }),
      satir('r10', {
        VERGI: hucre(kanal('FAILED', 'WHATSAPP', { ...s(12, 14, 32), error: 'whatsapp gönderilemedi: numara WhatsApp kullanmıyor' }), kanal('FAILED', 'EMAIL', { ...s(12, 14, 32), error: 'SMTP bağlantısı kurulamadı' })),
        SGK: hucre(kanal('SENT', 'WHATSAPP', s(3, 9, 13)), kanal('SENT', 'EMAIL', s(3, 9, 13))),
      }),
      satir('r16', {
        SGK: hucre(kanal('FAILED', 'EMAIL', { ...s(3, 9, 14), error: 'ILETISIM-mükellefin e-postası yok' })),
        ETEBLIGAT: bekliyor(KAPALI),
      }),
      // — kısmen (e-posta gitti, WhatsApp hata) —
      satir('r2', {
        VERGI: hucre(kanal('SENT', 'EMAIL', s(12, 14, 33)), kanal('FAILED', 'WHATSAPP', { ...s(12, 14, 33), error: 'ILETISIM-mükellefin telefon numarası yok' })),
        SGK: hucre(kanal('SENT', 'EMAIL', s(3, 9, 15))),
        ETEBLIGAT: bekliyor(KAPALI),
        ODEME_LISTESI: hucre(kanal('SENT', 'EMAIL', s(10, 9, 37))),
      }),
      // — hiç gönderilmedi —
      satir('r8', {
        VERGI: bekliyor('henüz denenmedi'),
        SGK: bekliyor('henüz denenmedi'),
        ETEBLIGAT: bekliyor(KAPALI),
      }),
      satir('r12', {
        VERGI: bekliyor('telefon numarası yok'),
        ETEBLIGAT: bekliyor(KAPALI),
      }),
      // — yalnız test —
      satir('r11', {
        SGK: hucre(kanal('SENT', 'WHATSAPP', { ...s(3, 9, 16), testMode: true })),
        ETEBLIGAT: bekliyor(KAPALI),
      }),
      // — yalnız kapalı —
      satir('r14', { ETEBLIGAT: bekliyor(KAPALI) }),
      // — belge yok —
      satir('r17', {}),
    ],
    [ONCEKI_AY]: ['r1', 'r3', 'r5', 'r7', 'r13'].map((id) =>
      satir(id, {
        VERGI: hucre(kanal('SENT', 'WHATSAPP', { at: t(ONCEKI_AY, 12, 14, 20) }), kanal('SENT', 'EMAIL', { at: t(ONCEKI_AY, 12, 14, 20) })),
        SGK: hucre(kanal('SENT', 'WHATSAPP', { at: t(ONCEKI_AY, 3, 9, 5) })),
        ODEME_LISTESI: hucre(kanal('SENT', 'WHATSAPP', { at: t(ONCEKI_AY, 10, 9, 30) })),
      }),
    ),
  };
}
sifirla();

const AYARLAR = [
  { kategori: 'VERGI', enabled: true, testMode: false, whatsapp: true, email: true },
  { kategori: 'SGK', enabled: true, testMode: false, whatsapp: true, email: true },
  { kategori: 'ETEBLIGAT', enabled: false, testMode: false, whatsapp: true, email: false },
];

function rapor(month) {
  const satirlar = DURUM[month] || [];
  let total = 0, sent = 0, failed = 0, badContact = 0, testGonderim = 0, bekleyen = 0;
  for (const r of satirlar) {
    for (const k of ['VERGI', 'SGK', 'ETEBLIGAT', 'ODEME_LISTESI']) {
      const h = r[k];
      if (!h) continue;
      if (h.status === 'BEKLIYOR') { bekleyen++; continue; }
      for (const c of h.kanallar || [h]) {
        total++;
        if (c.status === 'SENT') { if (c.testMode) testGonderim++; else sent++; }
        else if (c.status === 'FAILED') { failed++; if (String(c.error || '').startsWith('ILETISIM-')) badContact++; }
      }
    }
  }
  return {
    month,
    totals: { total, sent, failed, bekleyen, badContact, testGonderim, mukellefSayisi: satirlar.length },
    taxpayers: [...satirlar].sort((a, b) => a.unvan.localeCompare(b.unvan, 'tr')),
    ayarlar: AYARLAR,
    today: { belge: 0, mukellef: 0, bekleyen: 0, hata: failed, ilkHata: null },
  };
}

/** Yeniden deneme: telefonu olmayanlar yine hata verir, diğerleri gider (gerçekçi). */
function yenidenDene(month, kategori, taxpayerId) {
  const r = (DURUM[month] || []).find((x) => x.taxpayerId === taxpayerId);
  const h = r && r[kategori];
  if (!h || h.status === 'BEKLIYOR') return { ok: true, kategori, count: 0, results: [] };
  const results = [];
  const yeni = (h.kanallar || [h]).map((c) => {
    if (c.status !== 'FAILED') { results.push({ taxpayerId, channel: c.channel, status: 'SKIPPED', reason: 'daha önce gönderildi' }); return c; }
    const kalici = /telefon numarası yok|e-postası yok/.test(String(c.error || ''));
    const at = new Date().toISOString();
    const n = kalici ? { ...c, createdAt: at } : { ...c, status: 'SENT', error: null, sentAt: at, createdAt: at };
    results.push({ taxpayerId, unvan: r.unvan, channel: c.channel, status: n.status, error: n.error });
    return n;
  });
  r[kategori] = hucre(...yeni);
  return { ok: true, kategori, count: results.length, results };
}

// ─────────────────────────────────────────────────────────────────────────────
// İLETİM GÜNLÜĞÜ (Hattat mantığı) — belge bazında düz günlük
// Satır sözleşmesi apps/api/src/akilli-bildirim/iletim-gunlugu.ts ile birebir:
//   { id, tarih(ISO), taxpayerId, unvan, belgeTuru, belgeAdi, kanal('WhatsApp'|'Mail'), durum('İletildi'|'İletilemedi'|'Test'|'Bekliyor'), hata, test }
// ─────────────────────────────────────────────────────────────────────────────
const GUNLUK_MUKELLEFLER = [
  ['m1', 'Öz Ela Gıda San. ve Tic. Ltd. Şti.'],
  ['m2', 'Erdoğan Balçık'],
  ['m3', 'Ayşegül Kaya'],
  ['m4', 'Mert Reklam Ajansı Ltd. Şti.'],
  ['m5', 'Famcoffee Kahve A.Ş.'],
  ['m6', 'Ela Tekstil Ltd. Şti.'],
  ['m7', 'Balçık İnşaat A.Ş.'],
  ['m8', 'Dilek Bayageldi'],
];
const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
function ayAdi(month) {
  const [y, m] = month.split('-').map(Number);
  return `${AY_ADLARI[m - 1]} ${y}`;
}
/** Aya göre "belge dönemi" (bir önceki ay): 2026-09 → { egik: '2026/08', ad: 'Ağustos 2026' } */
function belgeDonemi(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return { egik: `${d.getFullYear()}/${mm}`, ad: `${AY_ADLARI[d.getMonth()]} ${d.getFullYear()}` };
}

let GUNLUK = null;
let gunlukSira = 0;
function gunlukSifirla() {
  gunlukSira = 0;
  GUNLUK = { [BU_AY]: gunlukUret(BU_AY, true), [ONCEKI_AY]: gunlukUret(ONCEKI_AY, false) };
}
/**
 * Bir ayın günlüğü. sorunlu=true: hata / test karışık (bu ay, 60 satır); false: hepsi iletildi (önceki ay).
 */
function gunlukUret(month, sorunlu) {
  const rows = [];
  const dn = belgeDonemi(month);
  const ekle = (mid, g, ss, dd, belgeTuru, belgeAdi, kanal, durum, hata) => {
    const [, unvan] = GUNLUK_MUKELLEFLER.find((m) => m[0] === mid);
    rows.push({ id: `g${++gunlukSira}`, tarih: t(month, g, ss, dd), taxpayerId: mid, unvan, belgeTuru, belgeAdi, kanal, durum, hata: hata || null, test: durum === 'Test' });
  };
  GUNLUK_MUKELLEFLER.forEach(([mid], i) => {
    const dk = 20 + i; // dakika: aynı gün sıra belli olsun
    // Beyanname — gece 03:xx otomatik gönderim (WhatsApp; m1/m5/m7 e-posta da)
    const telYok = sorunlu && mid === 'm4';
    const beyanDurum = telYok ? 'İletilemedi' : 'İletildi';
    const beyanHata = telYok ? 'mükellefin telefon numarası yok' : null;
    ekle(mid, 12, 3, dk, 'Beyanname', `KDV1 ${dn.egik}`, 'WhatsApp', beyanDurum, beyanHata);
    ekle(mid, 12, 3, dk, 'Beyanname', `MUHSGK ${dn.egik}`, 'WhatsApp', beyanDurum, beyanHata);
    if (mid === 'm1' || mid === 'm5' || mid === 'm7') {
      ekle(mid, 12, 3, dk, 'Beyanname', `KDV1 ${dn.egik}`, 'Mail', 'İletildi');
      ekle(mid, 12, 3, dk, 'Beyanname', `MUHSGK ${dn.egik}`, 'Mail', 'İletildi');
    }
    // SGK — ayın 3'ü 09:xx (m6: e-postası yok → Mail hata)
    if (mid !== 'm8') ekle(mid, 3, 9, dk, 'SGK', `Tahakkuk Fişi ${dn.egik}`, 'WhatsApp', telYok ? 'İletilemedi' : 'İletildi', beyanHata);
    if (sorunlu && mid === 'm6') ekle(mid, 3, 9, dk, 'SGK', `Tahakkuk Fişi ${dn.egik}`, 'Mail', 'İletilemedi', 'mükellefin e-postası yok');
    // Ödeme Listesi — ayın 10'u 09:xx, e-posta; m4 WhatsApp hata
    ekle(mid, 10, 9, dk, 'Ödeme Listesi', `KDV Beyannamesi ${dn.ad}`, 'Mail', 'İletildi');
    if (mid !== 'm8') ekle(mid, 10, 9, dk, 'Ödeme Listesi', `SGK Prim Tahakkuku ${dn.ad}`, 'Mail', 'İletildi');
    if (sorunlu && mid === 'm4') ekle(mid, 10, 9, dk, 'Ödeme Listesi', `KDV Beyannamesi ${dn.ad}`, 'WhatsApp', 'İletilemedi', 'mükellefin telefon numarası yok');
  });
  if (sorunlu) {
    const yil = month.slice(0, 4);
    const ay = month.slice(5, 7);
    // e-Tebligat — test modu (mükellef almadı) + biri gerçek
    ekle('m3', 5, 10, 0, 'Tebligat', 'Vergi/Ceza İhbarnamesi — GİB', 'WhatsApp', 'Test');
    ekle('m2', 8, 10, 15, 'Tebligat', 'Bilgi İsteme Yazısı — GİB', 'WhatsApp', 'İletildi');
    ekle('m5', 8, 10, 16, 'Tebligat', 'Vergi/Ceza İhbarnamesi — GİB', 'WhatsApp', 'İletildi');
    ekle('m7', 8, 10, 17, 'Tebligat', 'Ödeme Emri — GİB', 'WhatsApp', 'İletildi');
    // m4: e-postası da yok → beyanname iki kanaldan da iletilemedi
    ekle('m4', 12, 3, 23, 'Beyanname', `KDV1 ${dn.egik}`, 'Mail', 'İletilemedi', 'mükellefin e-postası yok');
    // Cari Kasa — ekstre PDF ve tahsilat hatırlatması (communicationLog)
    ekle('m1', 14, 8, 4, 'Cari Kasa', `01.01.${yil} / 14.${ay}.${yil} Hesap Dökümü`, 'WhatsApp', 'İletildi');
    ekle('m5', 13, 16, 40, 'Cari Kasa', `01.01.${yil} / 13.${ay}.${yil} Hesap Dökümü`, 'WhatsApp', 'İletildi');
    ekle('m2', 2, 11, 0, 'Cari Kasa', `Tahsilat hatırlatma - ${month}`, 'WhatsApp', 'İletilemedi', 'gönderilemedi');
    ekle('m8', 2, 11, 1, 'Cari Kasa', `Tahsilat hatırlatma - ${month}`, 'WhatsApp', 'İletildi');
    // Mesaj — evrak hatırlatma, KDV bilgilendirmesi, portal dosyası
    ekle('m6', 1, 9, 0, 'Mesaj', `Evrak hatırlatma — ${dn.egik}`, 'WhatsApp', 'İletildi');
    ekle('m7', 1, 9, 1, 'Mesaj', `Evrak hatırlatma — ${dn.egik}`, 'WhatsApp', 'Test');
    ekle('m3', 6, 12, 0, 'Mesaj', 'Portal WhatsApp dosyası', 'WhatsApp', 'İletilemedi', 'master switch veya hata');
    ekle('m1', 11, 15, 30, 'Mesaj', 'KDV bilgilendirmesi', 'WhatsApp', 'İletildi');
    ekle('m8', 11, 15, 31, 'Mesaj', 'İşletme Hesap Özeti bilgilendirmesi', 'WhatsApp', 'İletildi');
  }
  return rows;
}
gunlukSifirla();

const kucuk = (s) => String(s || '').toLocaleLowerCase('tr-TR');
function gunlukSuzSirala(q) {
  const month = q.month || BU_AY;
  let rows = GUNLUK[month] || [];
  const kanal = q.kanal === 'WHATSAPP' ? 'WhatsApp' : q.kanal === 'EMAIL' ? 'Mail' : '';
  const ara = kucuk(q.q).trim();
  rows = rows.filter((x) => {
    if (q.taxpayerId && x.taxpayerId !== q.taxpayerId) return false;
    if (q.belgeTuru && x.belgeTuru !== q.belgeTuru) return false;
    if (kanal && x.kanal !== kanal) return false;
    if (q.durum === 'iletilen' && x.durum !== 'İletildi') return false;
    if (q.durum === 'iletilmeyen' && x.durum !== 'İletilemedi' && x.durum !== 'Bekliyor') return false;
    if (ara && !kucuk(x.unvan).includes(ara) && !kucuk(x.belgeAdi).includes(ara)) return false;
    return true;
  });
  const yon = q.sira === 'asc' ? 1 : -1;
  rows.sort((a, b) => (new Date(a.tarih) - new Date(b.tarih)) * yon || a.unvan.localeCompare(b.unvan, 'tr') || a.belgeAdi.localeCompare(b.belgeAdi, 'tr'));
  return { month, rows };
}
function gunlukYaniti(q) {
  const { month, rows } = gunlukSuzSirala(q);
  const pageSize = Math.min(500, Math.max(1, Number(q.pageSize) || 50));
  const sonSayfa = Math.max(1, Math.ceil(rows.length / pageSize));
  const sayfa = Math.min(Math.max(1, Number(q.page) || 1), sonSayfa);
  const ozet = { iletilen: 0, iletilemeyen: 0, test: 0, yenidenDenenecek: 0 };
  for (const r of rows) {
    if (r.durum === 'İletildi') ozet.iletilen++;
    else if (r.durum === 'İletilemedi') ozet.iletilemeyen++;
    else if (r.durum === 'Test') ozet.test++;
  }
  // Yeniden denenecek: ayın Beyanname/SGK/Tebligat hatalı (mükellef, tür) çiftleri — süzgeçten bağımsız
  const ciftler = new Set((GUNLUK[month] || []).filter((r) => r.durum === 'İletilemedi' && ['Beyanname', 'SGK', 'Tebligat'].includes(r.belgeTuru)).map((r) => `${r.belgeTuru}:${r.taxpayerId}`));
  ozet.yenidenDenenecek = ciftler.size;
  return { month, toplam: rows.length, sayfa, sayfaBoyutu: pageSize, satirlar: rows.slice((sayfa - 1) * pageSize, sayfa * pageSize), ozet };
}
function tarihSaatTR(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
/** xlsx — exceljs apps/api'de kurulu; bulunamazsa küçük sahte blob (indirme akışı yine denenir) */
async function gunlukExcel(q) {
  const { month, rows } = gunlukSuzSirala(q);
  let ExcelJS = null;
  try { ExcelJS = require('../../api/node_modules/exceljs'); } catch { /* yok */ }
  if (!ExcelJS) return Buffer.from(`SAHTE XLSX — ${month} — ${rows.length} satır`, 'utf8');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('İletim Günlüğü');
  ws.addRow([`İletim Günlüğü — ${ayAdi(month)} (${rows.length} kayıt)`]).font = { bold: true, size: 13 };
  const th = ws.addRow(['Tarih', 'Mükellef', 'Belge Türü', 'Belge Adı', 'Gönderim', 'Durum', 'Hata']);
  th.font = { bold: true };
  for (const r of rows) ws.addRow([tarihSaatTR(r.tarih), r.unvan, r.belgeTuru, r.belgeAdi, r.kanal, r.durum, r.hata || '']);
  ws.columns.forEach((c, i) => (c.width = [20, 38, 15, 44, 11, 12, 44][i]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** mock-api.cjs isle() içinden çağrılır; uç eşleşmezse false döner. */
function iletimRaporuUclari(yol, yontem, q, govde, jsonGonder, res) {
  if (yol === '/akilli-bildirim/__sifirla' && yontem === 'POST') { sifirla(); gunlukSifirla(); return jsonGonder(res, 200, { ok: true }); }
  if (yol === '/akilli-bildirim/iletim-gunlugu' && yontem === 'GET') {
    const y = gunlukYaniti(q);
    console.log(`[mock] iletim-gunlugu ${y.month} süzgeç=${JSON.stringify({ taxpayerId: q.taxpayerId, belgeTuru: q.belgeTuru, kanal: q.kanal, durum: q.durum, q: q.q })} → ${y.toplam} satır, sayfa ${y.sayfa}/${Math.max(1, Math.ceil(y.toplam / y.sayfaBoyutu))}`);
    return jsonGonder(res, 200, y);
  }
  if (yol === '/akilli-bildirim/iletim-gunlugu/excel' && yontem === 'GET') {
    gunlukExcel(q).then((buf) => {
      console.log(`[mock] iletim-gunlugu/excel ${q.month || BU_AY} → ${buf.length} bayt`);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Iletim-Gunlugu-${q.month || BU_AY}.xlsx"`,
        'Access-Control-Expose-Headers': 'Content-Disposition',
      });
      res.end(buf);
    }).catch((e) => jsonGonder(res, 500, { message: `Excel üretilemedi: ${e.message}` }));
    return true;
  }
  if (yol === '/akilli-bildirim/report' && yontem === 'GET') return jsonGonder(res, 200, rapor(q.month || BU_AY));
  if (yol === '/akilli-bildirim/resend-failed' && yontem === 'POST') {
    const month = govde.month || BU_AY;
    const ciftler = [];
    for (const r of DURUM[month] || []) {
      for (const k of ['VERGI', 'SGK', 'ETEBLIGAT', 'ODEME_LISTESI']) {
        const h = r[k];
        if (h && h.status === 'FAILED') ciftler.push([k, r.taxpayerId]);
      }
    }
    let denenen = 0, atlanan = 0;
    const out = [];
    for (const [k, id] of ciftler) {
      if (k === 'ODEME_LISTESI') { atlanan++; out.push({ kategori: k, taxpayerId: id, ok: false, error: 'ayar yok' }); continue; }
      denenen++;
      out.push({ kategori: k, taxpayerId: id, ...yenidenDene(month, k, id) });
    }
    const odemeAtlanan = ciftler.filter(([k]) => k === 'ODEME_LISTESI').length;
    const not = odemeAtlanan
      ? `${odemeAtlanan} başarısız gönderim Aylık Ödeme Listesi'ne ait. Tekrar denemek için Aylık Ödeme Listesi ekranından o mükellefe "Gönder" deyin (buradan denenirse cetvelin tamamı yeniden gider).`
      : null;
    console.log(`[mock] resend-failed ${month} → ${denenen} denendi, ${atlanan} atlandı`);
    return jsonGonder(res, 200, { denenen, atlanan, odemeAtlanan, not, toplamCift: ciftler.length, out });
  }
  if (yol === '/akilli-bildirim/run' && yontem === 'POST') {
    const kategori = govde.kategori;
    if (!['VERGI', 'SGK', 'ETEBLIGAT'].includes(kategori)) return jsonGonder(res, 200, { ok: false, error: 'ayar yok' });
    if (!govde.taxpayerId) return jsonGonder(res, 200, { ok: true, kategori, count: 0, results: [] });
    // Kategori kapalıysa sunucu gibi: gönderilmez
    const ayar = AYARLAR.find((a) => a.kategori === kategori);
    if (ayar && !ayar.enabled && !govde.force) return jsonGonder(res, 200, { ok: false, skipped: true, reason: 'kapalı (enabled=false)' });
    console.log(`[mock] run ${kategori} ${govde.taxpayerId} sinceHours=${govde.sinceHours}`);
    return jsonGonder(res, 200, yenidenDene(BU_AY, kategori, govde.taxpayerId));
  }
  return false;
}

module.exports = { iletimRaporuUclari };
