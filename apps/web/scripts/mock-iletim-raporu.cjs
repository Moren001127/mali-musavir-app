/**
 * SAHTE API — İletim Raporu uçları (mock-api.cjs bunu tek satırla bağlar).
 *
 *   GET  /akilli-bildirim/report?month=YYYY-MM
 *   POST /akilli-bildirim/resend-failed   { month }
 *   POST /akilli-bildirim/run             { kategori, taxpayerId, sinceHours }   (satır bazlı yeniden deneme)
 *   POST /akilli-bildirim/__sifirla                                             (önizleme betiği için)
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

/** mock-api.cjs isle() içinden çağrılır; uç eşleşmezse false döner. */
function iletimRaporuUclari(yol, yontem, q, govde, jsonGonder, res) {
  if (yol === '/akilli-bildirim/__sifirla' && yontem === 'POST') { sifirla(); return jsonGonder(res, 200, { ok: true }); }
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
