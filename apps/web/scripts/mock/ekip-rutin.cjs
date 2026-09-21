/**
 * SAHTE API — Ekip "Dijital Ofis" ekleri (PLAN/20 §D, 2026-09-22): iş düzeni (rutin) + kuyruk + kota bekçisi + akış zenginleştirme.
 * mock-api.cjs bu dosyayı her istekte yeniden yükler (uclar imzası; eşleşmezse false).
 *
 * Bellek içi veri:
 *  - 1 tohum rutin: "KDV kontrolü — kontrol bekleyenler" (Beyanname Uzmanı, hafta içi 09:30–17:00, tavan 8, canlı, AÇIK).
 *  - 1 süren kuyruk (3/8; ilk okumadan sonra her 6 sn'de bir öğe biter) + 1 sırada bekleyen toplu kuyruk (2 mükellef, kuru).
 *  - 1 onay bekleyen PRV kaydı (Müşteri İlişkileri → WhatsApp hatırlatması) + kuyruktan türeyen bitti/sürüyor vakalar.
 *
 * Uçlar: GET/POST /ekip/rutinler · PATCH/DELETE /ekip/rutinler/:id · POST /ekip/rutinler/:id/simdi ·
 *        GET/POST /ekip/kuyruk · POST /ekip/kuyruk/:id/durdur|devam · POST /ekip/onaylar/:id/onayla|reddet (mock-ekip'te yok).
 *
 * SARMALAYICILAR: mock-api.cjs `/ekip/durum · kadro · akis · onaylar · isler/:id` uçlarını eklentilerden ÖNCE mock-ekip.cjs ile
 * cevaplar; eklenti onları ezemez. Bunun yerine `/ekip-ofis/durum|kadro|akis|onaylar|isler/:id` uçları mock-ekip cevabını çağırıp
 * (kota · kuyruk · bugunPlan · receteler · kapali · ek vakalar · PRV onayı) ÜZERİNE ekler. Önizleme çifti (ekip-sahte-b) bu yolları
 * küçük bir vekil ile `/ekip/…` → `/ekip-ofis/…` olarak yönlendirir; mock-ekip.cjs DEĞİŞMEZ.
 * Kota "doldu" senaryosu: `?kota=1` sorgusu (görüntü almak için). POST /ekip-ofis/sifirla → veriyi tohuma döndürür.
 */
const { ekipUclari, ekipMukellefler } = require('../mock-ekip.cjs');

const simdi = () => new Date();
const iso = (ms) => new Date(ms).toISOString();
const dk = (n) => n * 60_000;

/** mock-ekip'teki mükellefler (4) + mock-api listesindeki sahte adlar (4) — gerçek mükellef adı YOK. */
const MUKELLEFLER = [
  ...ekipMukellefler().map((m) => ({ id: m.id, ad: m.companyName })),
  { id: 'm1', ad: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.' },
  { id: 'm2', ad: 'Erdoğan Balçık' },
  { id: 'm4', ad: 'Mert Reklam Ajansı Ltd. Şti.' },
  { id: 'm5', ad: 'Famcoffee Kahve A.Ş.' },
];
const mukellef = (id) => MUKELLEFLER.find((m) => m.id === id) || { id, ad: id };

/** Personel reçeteleri (apps/api/src/ekip/receteler.md ile aynı kodlar; başlık kısa Türkçe). */
const RECETELER = {
  koordinator: [
    { kod: 'K1', baslik: 'Sabah özeti' },
    { kod: 'K2', baslik: 'Görev dağıtımı' },
    { kod: 'K3', baslik: 'Okuma işleri (tebligat · borç · evrak)' },
    { kod: 'K4', baslik: 'Cevap ve bildirim' },
  ],
  fatura: [
    { kod: 'R4', baslik: 'Muhasebeleştirme önerisi' },
    { kod: 'R5', baslik: 'Fatura çekimi' },
    { kod: 'R5b', baslik: 'Şüpheli fatura ayrımı' },
  ],
  beyanname: [
    { kod: 'R1', baslik: 'KDV kontrolü' },
    { kod: 'R3', baslik: 'KDV1 ön hazırlık' },
    { kod: 'R3b', baslik: 'Tahakkuk taslağı' },
    { kod: 'R7', baslik: 'Geçici vergi paketi' },
    { kod: 'R8', baslik: 'Hazır işaretlenebilecekler' },
  ],
  'bordro-sgk': [
    { kod: 'B1', baslik: 'Bordro özeti' },
    { kod: 'B2', baslik: 'SGK bildirge kontrolü' },
  ],
  edefter: [
    { kod: 'E1', baslik: 'Berat takvimi' },
    { kod: 'E2', baslik: 'Negatif kasa/stok/banka taraması' },
  ],
  'luca-operator': [
    { kod: 'L1', baslik: 'Luca oturum kontrolü' },
    { kod: 'L2', baslik: 'Luca ekran işlemleri' },
  ],
  denetci: [{ kod: 'R6', baslik: 'Dönem denetimi' }],
  analist: [
    { kod: 'R2', baslik: 'Gelir tablosu / İHÖ yorumu' },
    { kod: 'R2b', baslik: 'Dönem karşılaştırma' },
  ],
  mevzuat: [{ kod: 'M1', baslik: 'Resmî Gazete taraması' }],
  risk: [{ kod: 'S1', baslik: 'Risk puanı güncelleme' }],
  musteri: [
    { kod: 'C1', baslik: 'Cevapsız mesajlar' },
    { kod: 'C2', baslik: 'Cevap taslağı' },
  ],
};

const RAPOR_KDV = (ad) =>
  [
    `Yaptığım iş: ${ad} için Ağustos 2026 KDV kontrolünü yaptım: iki oturum açıldı, Luca çekimi bitti, Mihsap faturaları bağlandı, OCR tamamlandı, eşleştirme yapıldı.`,
    'Baktığım kaynaklar: KDV Kontrol modülü (191 + 391 oturumları), Mihsap faturaları, Luca gelir-gider listesi.',
    'Bulgular:',
    '- 191: 41 satır — 40 tam, 1 incele (tutar farkı 6,20 TL).',
    '- 391: 3 satır — 3 tam.',
    'Onayınızı bekleyen: yok',
    'Öğrendiklerim: yok',
  ].join('\n');

let t0 = simdi().getTime();
let sayac = 0;

/** Tohum rutin — AÇIK gelir (backend tohumu); ekran hiçbir rutini kendiliğinden açmaz. */
function tohumRutin() {
  return {
    id: 'rt-kdv-kontrol',
    ad: 'KDV kontrolü — kontrol bekleyenler',
    ajanId: 'beyanname',
    sablon: '{mukellef} için {donem} KDV kontrolünü yap (R1): oturumları bul/aç, Luca çekimi ve fatura bağlama + OCR, eşleştir, hatalı satırları belge no ile listele. Kilitleme bende.',
    kapsam: 'pano:kontrol_bekleyen',
    zaman: { tur: 'haftalik', gunler: [1, 2, 3, 4, 5], baslangic: '09:30', bitis: '17:00' },
    gunlukTavan: 8,
    dryRun: false,
    aktif: true,
    sonKosuAt: iso(t0 - dk(41)),
    sonSonuc: '3 kontrol bitti, 0 hatalı',
    bugun: { planlanan: 8, biten: 3, hatali: 0 },
  };
}
const RUTINLER = [tohumRutin()];

/** Kuyruk öğeleri: ilk 3 bitti (zamanları t0'a göre), 4. sürüyor, kalanı bekliyor. */
function tohumKuyruk() {
  const ogeler = MUKELLEFLER.slice(0, 8).map((m, i) => ({
    taxpayerId: m.id,
    ad: m.ad,
    durum: i < 3 ? 'bitti' : i === 3 ? 'suruyor' : 'bekliyor',
    isId: i < 4 ? `is-kuyruk-${i + 1}` : null,
    hata: null,
    basladi: i < 3 ? t0 - dk(38 - i * 9) : i === 3 ? t0 - dk(4) : null,
    bitti: i < 3 ? t0 - dk(35 - i * 9) : null,
  }));
  sayac = 4;
  return {
    id: 'kq-kdv-1',
    ad: 'KDV kontrolü — kontrol bekleyenler',
    ajanId: 'beyanname',
    dryRun: false,
    kaynak: 'rutin',
    rutinId: 'rt-kdv-kontrol',
    durum: 'suruyor',
    ogeler,
    createdAt: iso(t0 - dk(41)),
    bitisAt: null,
    sonAdim: null, // ilk kuyruk/durum okumasında başlar (ekran açılınca 3/8'den ilerlesin)
  };
}
/** Sırada bekleyen toplu kuyruk (panodan "Personele ver" ile açılmış gibi). */
function tohumTopluKuyruk() {
  return {
    id: 'kq-toplu-1',
    ad: 'Faturaları işle — 2 mükellef · Ağustos 2026',
    ajanId: 'fatura',
    dryRun: true,
    kaynak: 'toplu',
    rutinId: null,
    durum: 'bekliyor',
    ogeler: [MUKELLEFLER[4], MUKELLEFLER[6]].map((m) => ({ taxpayerId: m.id, ad: m.ad, durum: 'bekliyor', isId: null, hata: null, basladi: null, bitti: null })),
    createdAt: iso(t0 - dk(12)),
    bitisAt: null,
    sonAdim: null,
  };
}
const KUYRUKLAR = [tohumKuyruk(), tohumTopluKuyruk()];

/** Onay bekleyen PRV kaydı (dışarı gönderim → Muzaffer Bey onayı). */
function tohumOnay() {
  const m = mukellef('m-omer');
  return {
    id: 'prv-1',
    previewId: 'PRV-3f9a12',
    ajanId: 'musteri',
    ajanAd: 'Müşteri İlişkileri',
    arac: 'send_whatsapp_freeform',
    kademe: 'disari_gonder',
    hedef: m.id,
    mesaj: `Sayın ${m.ad}, Ağustos 2026 dönemine ait 3 gider faturanız henüz ulaşmadı. Bu hafta içinde iletebilir misiniz?`,
    payload: null,
    etki: 'Mükellefe WhatsApp mesajı gider',
    isId: 'is-onay-musteri',
    status: 'PENDING',
    createdAt: iso(t0 - dk(22)),
    expiresAt: iso(t0 + dk(60 * 21)),
    approvedAt: null,
    responseText: null,
    confirmationText: 'ONAYLIYORUM #PRV-3f9a12',
    mukellefAd: m.ad,
  };
}
const ONAYLAR = [tohumOnay()];

/** Önizleme betiği için: bellek içi veriyi tohuma döndür (POST /ekip-ofis/sifirla). */
function sifirla() {
  t0 = simdi().getTime();
  KUYRUKLAR.splice(0, KUYRUKLAR.length, tohumKuyruk(), tohumTopluKuyruk());
  RUTINLER.splice(0, RUTINLER.length, tohumRutin());
  ONAYLAR.splice(0, ONAYLAR.length, tohumOnay());
}

/** Türetilen alanlar (toplam · biten · hatalı · sıradaki · aktifIsId). */
function kuyrukGoruntu(k) {
  const biten = k.ogeler.filter((o) => o.durum === 'bitti').length;
  const hatali = k.ogeler.filter((o) => o.durum === 'hatali').length;
  const suren = k.ogeler.find((o) => o.durum === 'suruyor');
  const siradaki = k.ogeler.find((o) => o.durum === 'bekliyor');
  const { sonAdim, ...temiz } = k; // eslint-disable-line no-unused-vars
  return {
    ...temiz,
    ogeler: k.ogeler.map(({ basladi, bitti, ...o }) => o), // eslint-disable-line no-unused-vars
    toplam: k.ogeler.length,
    biten,
    hatali,
    siradaki: siradaki ? { taxpayerId: siradaki.taxpayerId, ad: siradaki.ad } : null,
    aktifIsId: suren?.isId || null,
  };
}

/** Kuyruk ilerlemesi: süren kuyrukta her 6 sn'de bir öğe biter, sıradaki sürmeye başlar; kalan yoksa kuyruk biter. */
function ilerlet(saatBaslat = false) {
  const t = simdi().getTime();
  for (const k of KUYRUKLAR) {
    if (k.durum !== 'suruyor') continue;
    if (k.sonAdim == null) {
      if (saatBaslat) k.sonAdim = t;
      continue;
    }
    while (t - k.sonAdim >= 6000) {
      k.sonAdim += 6000;
      const suren = k.ogeler.find((o) => o.durum === 'suruyor');
      if (suren) {
        suren.durum = 'bitti';
        suren.bitti = k.sonAdim;
        suren.isId = suren.isId || `is-kuyruk-${++sayac}`;
      }
      const siradaki = k.ogeler.find((o) => o.durum === 'bekliyor');
      if (siradaki) {
        siradaki.durum = 'suruyor';
        siradaki.basladi = k.sonAdim;
        siradaki.isId = `is-kuyruk-${++sayac}`;
      } else {
        k.durum = 'bitti';
        k.bitisAt = iso(t);
        break;
      }
    }
  }
}

/** mock-ekip cevabını yakala (jsonGonder yerine kutuya yazar). */
function mockEkipCevabi(yol, q, yontem = 'GET', govde = {}) {
  let sonuc = null;
  const yakala = (_res, kod, veri) => {
    sonuc = { kod, veri };
    return true;
  };
  const r = ekipUclari(yol, yontem, q || {}, govde || {}, yakala, {});
  return r === false ? null : sonuc;
}

/* ─────────────── kuyruk → iş dosyası ve vaka (akış) ─────────────── */

const KDV_PLANI = [
  ['get_taxpayer', 1200],
  ['kdv_kontrol_oturum_bul_olustur', 1500],
  ['kdv_kontrol_luca_cek', 2500],
  ['kdv_kontrol_fatura_bagla', 1800],
  ['kdv_kontrol_ocr_baslat', 900],
  ['kdv_kontrol_ocr_bekle', 9000],
];

function kuyrukOgesiBul(isId) {
  for (const k of KUYRUKLAR) {
    const o = k.ogeler.find((x) => x.isId === isId);
    if (o) return { k, o };
  }
  return null;
}

/** Kuyruk öğesi → iş dosyası (GET /ekip/isler/:id biçimi); koşarken canlı adımlar. */
function kuyrukIsi(k, o) {
  const bas = o.basladi || t0;
  const gorev = `KDV Kontrol (R1). Mükellef: ${o.ad} (taxpayerId: ${o.taxpayerId}). Dönem: 2026/08. ${k.dryRun ? 'Kuru test.' : 'Canlı.'}`;
  if (o.durum === 'suruyor') {
    const gecen = simdi().getTime() - bas;
    const adimlar = [];
    let t = 0;
    for (const [ad, sure] of KDV_PLANI) {
      if (t > gecen) break;
      const bitti = t + sure <= gecen;
      adimlar.push({ ad, args: { taxpayerId: o.taxpayerId }, basladi: iso(bas + t), bitti: bitti ? iso(bas + t + sure) : undefined, durum: bitti ? 'bitti' : 'suruyor' });
      t += sure;
    }
    return { id: o.isId, ajanId: k.ajanId, gorev, status: 'running', dryRun: k.dryRun, taxpayerId: o.taxpayerId, createdAt: iso(bas), startedAt: iso(bas), finishedAt: null, kaynak: k.kaynak, model: 'claude-opus-4-1', durationMs: null, result: null, canli: { adimlar, guncellendi: iso(simdi().getTime()) } };
  }
  const bit = o.bitti || bas;
  const hatali = o.durum === 'hatali';
  return {
    id: o.isId,
    ajanId: k.ajanId,
    gorev,
    status: hatali ? 'failed' : 'done',
    dryRun: k.dryRun,
    taxpayerId: o.taxpayerId,
    createdAt: iso(bas),
    startedAt: iso(bas),
    finishedAt: iso(bit),
    kaynak: k.kaynak,
    model: 'claude-opus-4-1',
    durationMs: Math.max(1000, bit - bas),
    hata: hatali ? o.hata || 'iptal edildi (Muzaffer Bey)' : undefined,
    result: hatali ? null : { rapor: RAPOR_KDV(o.ad), toolUses: KDV_PLANI.map(([ad]) => ({ name: ad, args: { taxpayerId: o.taxpayerId } })), kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], model: 'claude-opus-4-1', durationMs: Math.max(1000, bit - bas) },
  };
}

/** Kuyruktan türeyen vakalar (bitti · sürüyor · yarım) — akışta görünür. */
function kuyrukVakalari() {
  const out = [];
  for (const k of KUYRUKLAR) {
    for (const o of k.ogeler) {
      if (!o.isId || o.durum === 'bekliyor') continue;
      const bas = o.basladi || t0;
      const bit = o.bitti || null;
      const durum = o.durum === 'suruyor' ? 'running' : o.durum === 'hatali' ? 'failed' : 'done';
      out.push({
        vakaId: `vk-${o.isId}`,
        mukellef: { id: o.taxpayerId, ad: o.ad },
        konu: `KDV kontrolü · Ağustos 2026`,
        kuru: k.dryRun,
        kimde: o.durum === 'suruyor' ? { ajanId: k.ajanId, ad: 'Beyanname Uzmanı' } : { ajanId: 'siz', ad: 'Siz' },
        durum: o.durum === 'suruyor' ? 'suruyor' : o.durum === 'hatali' ? 'hata' : 'bitti',
        kutu: o.durum === 'suruyor' ? 'suruyor' : 'bitti',
        guncellendi: iso(bit || simdi().getTime()),
        olusturuldu: iso(bas),
        gecikti: false,
        adimlar: [{ tip: 'is', isId: o.isId, ajanId: k.ajanId, baslik: `KDV Kontrol (R1) · ${o.ad} · 2026/08`, durum, baslangic: iso(bas), bitis: bit ? iso(bit) : null, raporOzet: durum === 'done' ? '191: 41 satır — 40 tam, 1 incele; 391: 3 tam.' : null, hata: o.durum === 'hatali' ? o.hata || 'iptal edildi (Muzaffer Bey)' : null, devir: null, kuru: k.dryRun }],
        acikKalemler: [],
      });
    }
  }
  return out;
}

/** Onay bekleyen vaka (Müşteri İlişkileri → WhatsApp hatırlatması; PRV kaydı ONAYLAR'da). */
function onayVakasi() {
  return ONAYLAR.map((o) => {
    const m = mukellef(o.hedef);
    const bekliyor = o.status === 'PENDING';
    return {
      vakaId: 'vk-onay-1',
      mukellef: { id: m.id, ad: m.ad },
      konu: 'Eksik evrak hatırlatması (WhatsApp)',
      kuru: false,
      kimde: bekliyor ? { ajanId: 'siz', ad: 'Siz' } : { ajanId: 'musteri', ad: 'Müşteri İlişkileri' },
      durum: bekliyor ? 'suruyor' : 'bitti',
      kutu: bekliyor ? 'onay' : 'bitti',
      guncellendi: o.approvedAt || o.createdAt,
      olusturuldu: iso(t0 - dk(24)),
      gecikti: false,
      adimlar: [
        { tip: 'is', isId: 'is-onay-kok', ajanId: 'koordinator', baslik: 'Eksik evrakı olan mükelleflere hatırlatma hazırla', durum: 'done', baslangic: iso(t0 - dk(24)), bitis: iso(t0 - dk(23)), raporOzet: 'Müşteri İlişkileri’ne verildi.', devir: null, kuru: false },
        { tip: 'is', isId: 'is-onay-musteri', ajanId: 'musteri', baslik: `Hatırlatma taslağı · ${m.ad}`, durum: 'done', baslangic: iso(t0 - dk(23)), bitis: iso(t0 - dk(22)), raporOzet: 'Mesaj taslağı hazır; gönderim onayınızda.', devir: 1, kuru: false },
        { tip: 'onay', id: o.previewId, ajanId: 'musteri', baslik: 'WhatsApp mesajı', durum: o.status, baslangic: o.createdAt, hedef: m.id, confirmationText: o.confirmationText },
      ],
      acikKalemler: bekliyor ? [{ tip: 'onay', id: o.previewId, baslik: 'WhatsApp mesajı için onayınız', kaynak: 'PRV', confirmationText: o.confirmationText }] : [],
    };
  });
}

/** Onay vakasının iş dosyaları (Koordinatör kök işi + Müşteri İlişkileri taslağı) — GET /ekip/isler/:id. */
function onayIsleri() {
  const o = ONAYLAR[0];
  const m = mukellef(o.hedef);
  const kok = { id: 'is-onay-kok', ajanId: 'koordinator', gorev: 'Eksik evrakı olan mükelleflere hatırlatma hazırla', status: 'done', dryRun: false, taxpayerId: m.id, createdAt: iso(t0 - dk(24)), startedAt: iso(t0 - dk(24)), finishedAt: iso(t0 - dk(23)), kaynak: 'portal', model: 'claude-sonnet-4-6', durationMs: 52000, result: { rapor: `Yaptığım iş: Eksik evrakı olan mükellefler arasından ${m.ad} için hatırlatma taslağını Müşteri İlişkileri’ne verdim.
Baktığım kaynaklar: Evrak takibi, aylık takip.
Bulgular:
- ${m.ad}: Ağustos 2026 · 3 gider faturası eksik.
Onayınızı bekleyen: WhatsApp mesajı (Müşteri İlişkileri).
Öğrendiklerim: yok`, toolUses: [{ name: 'list_taxpayers_monthly_status', args: {} }, { name: 'ekip_ajan_baslat', args: { ajanId: 'musteri', gorev: `Eksik evrak hatırlatması · ${m.ad}` } }], kuruTestYapilacaktilar: [], onayBekleyen: [], ogrenilen: [], model: 'claude-sonnet-4-6', durationMs: 52000 } };
  const musteri = { id: 'is-onay-musteri', ajanId: 'musteri', gorev: `Eksik evrak hatırlatması · ${m.ad}`, status: 'done', dryRun: false, taxpayerId: m.id, createdAt: iso(t0 - dk(23)), startedAt: iso(t0 - dk(23)), finishedAt: iso(t0 - dk(22)), kaynak: 'koordinator', model: 'claude-sonnet-4-6', durationMs: 41000, result: { rapor: `Yaptığım iş: ${m.ad} için eksik evrak hatırlatma mesajını hazırladım; gönderim onayınızda.
Baktığım kaynaklar: Mükellef kartı, son mesajlar.
Bulgular:
- Mesaj: “${o.mesaj}”
Onayınızı bekleyen: WhatsApp mesajı #${o.previewId}
Öğrendiklerim: yok`, toolUses: [{ name: 'get_taxpayer', args: { taxpayerId: m.id } }, { name: 'get_my_recent_messages', args: { taxpayerId: m.id } }, { name: 'preview_agent_command', args: { previewId: o.previewId } }], kuruTestYapilacaktilar: [], onayBekleyen: [{ previewId: o.previewId, arac: o.arac }], ogrenilen: [], model: 'claude-sonnet-4-6', durationMs: 41000 } };
  return { 'is-onay-kok': kok, 'is-onay-musteri': musteri };
}

function ekVakalar(q) {
  const f = q?.filtre || 'tumu';
  return [...onayVakasi(), ...kuyrukVakalari()].filter((v) => (f === 'tumu' ? true : v.kutu === f) && (!q?.taxpayerId || v.mukellef?.id === q.taxpayerId));
}

function bugunPlani() {
  const kuyrukOgeleri = KUYRUKLAR.flatMap((k) => k.ogeler);
  const suruyor = kuyrukOgeleri.filter((o) => o.durum === 'suruyor').length;
  const biten = kuyrukOgeleri.filter((o) => o.durum === 'bitti').length + 1;
  const yarim = kuyrukOgeleri.filter((o) => o.durum === 'hatali').length;
  const planlanan = Math.max(RUTINLER.filter((r) => r.aktif).reduce((t, r) => t + r.bugun.planlanan, 0) + KUYRUKLAR.filter((k) => k.kaynak === 'toplu').reduce((t, k) => t + k.ogeler.length, 0), biten + suruyor);
  return { planlanan, suruyor, biten, yarim };
}

function kotaDurumu(q) {
  if (q && (q.kota === '1' || q.kota === 'true')) {
    const yarin = new Date(simdi());
    yarin.setDate(yarin.getDate() + 1);
    yarin.setHours(9, 0, 0, 0);
    return { doldu: true, sifirlanma: yarin.toISOString(), sonHata: "You've hit your weekly limit" };
  }
  return { doldu: false, sifirlanma: null, sonHata: null };
}

/** mock-api.cjs: eşleşmezse false döner. */
function uclar(yol, yontem, q, govde, jsonGonder, res) {
  // Kuyruk saati ekran ilk kez kuyruğu/durumu okuyunca başlar; diğer isteklerde yalnız ilerletir.
  ilerlet(yontem === 'GET' && (yol === '/ekip/kuyruk' || yol === '/ekip-ofis/durum'));

  if (yontem === 'POST' && yol === '/ekip-ofis/sifirla') {
    sifirla();
    return jsonGonder(res, 200, { ok: true });
  }

  // ── Sarmalayıcılar: mock-ekip cevabı + yeni alanlar ──
  if (yontem === 'GET' && yol === '/ekip-ofis/durum') {
    const c = mockEkipCevabi('/ekip/durum', q);
    if (!c) return jsonGonder(res, 500, { message: 'mock-ekip durum cevabı alınamadı' });
    const suren = KUYRUKLAR.find((k) => k.durum === 'suruyor' || k.durum === 'kota_bekliyor');
    const g = suren ? kuyrukGoruntu(suren) : null;
    const kota = kotaDurumu(q);
    const ek = ekVakalar({ filtre: 'tumu' });
    const akis = { ...(c.veri.akis || {}) };
    for (const v of ek) akis[v.kutu] = (akis[v.kutu] || 0) + 1;
    return jsonGonder(res, c.kod, {
      ...c.veri,
      bekleyenOnay: ONAYLAR.filter((o) => o.status === 'PENDING').length,
      calisan: (c.veri.calisan || 0) + ek.filter((v) => v.kutu === 'suruyor').length,
      akis,
      sonSabahOzeti: c.veri.sonSabahOzeti ? { ...c.veri.sonSabahOzeti, raporIlkSatir: '65 aktif mükellef; Ağustos: 8 beyanname hazır, 12 KDV kontrol eksik. 26 mükellefte evrak gelmedi.' } : c.veri.sonSabahOzeti,
      kota,
      kuyruk: { aktif: KUYRUKLAR.filter((k) => k.durum === 'suruyor' || k.durum === 'kota_bekliyor').length, suruyorId: g?.id || null, siradaki: g?.siradaki || null },
      bugunPlan: bugunPlani(),
    });
  }
  if (yontem === 'GET' && yol === '/ekip-ofis/kadro') {
    const c = mockEkipCevabi('/ekip/kadro', q);
    if (!c) return jsonGonder(res, 500, { message: 'mock-ekip kadro cevabı alınamadı' });
    const surenOge = KUYRUKLAR.flatMap((k) => k.ogeler.map((o) => ({ k, o }))).find(({ o }) => o.durum === 'suruyor');
    const ajanlar = (c.veri.ajanlar || []).map((a) => ({
      ...a,
      receteler: RECETELER[a.id] || [],
      kapali: a.id === 'bordro-sgk' ? { neden: 'Bordro/SGK modülü kapalı' } : null,
      bugunKosu: a.id === 'beyanname' ? KUYRUKLAR[0].ogeler.filter((o) => o.durum === 'bitti').length : a.id === 'koordinator' ? 2 : a.id === 'musteri' ? 1 : a.bugunKosu || 0,
      suAn: a.suAn || (surenOge && surenOge.k.ajanId === a.id ? { vakaId: `vk-${surenOge.o.isId}`, isId: surenOge.o.isId, mukellefId: surenOge.o.taxpayerId, mukellefAd: surenOge.o.ad, konu: 'KDV kontrolü · Ağustos 2026', basladi: iso(surenOge.o.basladi || t0) } : null),
      sonKosu: a.id === 'beyanname' ? { id: 'is-kuyruk-3', createdAt: iso(t0 - dk(17)), status: 'done', dryRun: false } : a.id === 'koordinator' ? { id: 'is-tebligat', createdAt: iso(t0 - dk(95)), status: 'done', dryRun: true } : a.id === 'musteri' ? { id: 'is-onay-musteri', createdAt: iso(t0 - dk(22)), status: 'done', dryRun: false } : a.id === 'fatura' ? { id: 'is-zeyrek', createdAt: iso(t0 - dk(400)), status: 'failed', dryRun: true } : a.sonKosu || null,
    }));
    return jsonGonder(res, c.kod, { ...c.veri, ajanlar });
  }
  if (yontem === 'GET' && yol === '/ekip-ofis/akis') {
    const c = mockEkipCevabi('/ekip/akis', q);
    if (!c) return jsonGonder(res, 500, { message: 'mock-ekip akış cevabı alınamadı' });
    const ek = ekVakalar(q);
    const sayaclar = { ...(c.veri.sayaclar || {}) };
    for (const v of ekVakalar({ filtre: 'tumu' })) sayaclar[v.kutu] = (sayaclar[v.kutu] || 0) + 1;
    return jsonGonder(res, c.kod, { ...c.veri, vakalar: [...ek, ...(c.veri.vakalar || [])], sayaclar });
  }
  if (yontem === 'GET' && yol === '/ekip-ofis/onaylar') {
    const c = mockEkipCevabi('/ekip/onaylar', q);
    const durum = q?.durum || 'PENDING';
    return jsonGonder(res, 200, { onaylar: [...ONAYLAR.filter((o) => durum === 'tumu' || o.status === durum), ...((c && c.veri.onaylar) || [])] });
  }
  const onayM = /^\/ekip(?:-ofis)?\/onaylar\/([^/]+)\/(onayla|reddet)$/.exec(yol);
  if (yontem === 'POST' && onayM) {
    const o = ONAYLAR.find((x) => x.previewId === onayM[1] || x.id === onayM[1]);
    if (!o) {
      const c = mockEkipCevabi(yol.replace('/ekip-ofis/', '/ekip/'), q, 'POST', govde);
      return c ? jsonGonder(res, c.kod, c.veri) : jsonGonder(res, 404, { message: 'onay kaydı yok' });
    }
    if (onayM[2] === 'onayla' && String(govde?.onayMetni || '') !== o.confirmationText) return jsonGonder(res, 400, { ok: false, error: 'Onay metni eşleşmedi' });
    o.status = onayM[2] === 'onayla' ? 'EXECUTED' : 'REJECTED';
    o.approvedAt = iso(simdi().getTime());
    o.responseText = onayM[2] === 'reddet' ? String(govde?.not || '') : null;
    return jsonGonder(res, 200, { ok: true, sonuc: onayM[2] === 'onayla' ? { gonderildi: 1 } : undefined });
  }
  const isM = /^\/ekip-ofis\/isler\/([^/]+)$/.exec(yol);
  if (yontem === 'GET' && isM) {
    const b = kuyrukOgesiBul(isM[1]);
    if (b) return jsonGonder(res, 200, kuyrukIsi(b.k, b.o));
    const onayIsi = onayIsleri()[isM[1]];
    if (onayIsi) return jsonGonder(res, 200, onayIsi);
    const c = mockEkipCevabi(`/ekip/isler/${isM[1]}`, q);
    return c ? jsonGonder(res, c.kod, c.veri) : jsonGonder(res, 404, { message: 'iş yok' });
  }
  const iptalM = /^\/ekip-ofis\/isler\/([^/]+)\/iptal$/.exec(yol);
  if (yontem === 'POST' && iptalM) {
    const b = kuyrukOgesiBul(iptalM[1]);
    if (b && b.o.durum === 'suruyor') {
      b.o.durum = 'hatali';
      b.o.hata = 'iptal edildi (Muzaffer Bey)';
      b.o.bitti = simdi().getTime();
      b.k.sonAdim = simdi().getTime();
      const siradaki = b.k.ogeler.find((x) => x.durum === 'bekliyor');
      if (siradaki) {
        siradaki.durum = 'suruyor';
        siradaki.basladi = simdi().getTime();
        siradaki.isId = `is-kuyruk-${++sayac}`;
      } else {
        b.k.durum = 'bitti';
        b.k.bitisAt = iso(simdi().getTime());
      }
      return jsonGonder(res, 200, { ok: true, isId: iptalM[1] });
    }
    const c = mockEkipCevabi(`/ekip/isler/${iptalM[1]}/iptal`, q, 'POST', govde);
    return c ? jsonGonder(res, c.kod, c.veri) : jsonGonder(res, 200, { ok: false, isId: iptalM[1], error: 'çalışan iş yok' });
  }

  // ── Rutinler ──
  if (yontem === 'GET' && yol === '/ekip/rutinler') return jsonGonder(res, 200, { rutinler: RUTINLER });
  if (yontem === 'POST' && yol === '/ekip/rutinler') {
    const b = govde || {};
    const r = {
      id: `rt-${Date.now().toString(36)}`,
      ad: String(b.ad || 'Yeni rutin'),
      ajanId: String(b.ajanId || 'koordinator'),
      sablon: String(b.sablon || ''),
      kapsam: b.kapsam || 'ofis',
      taxpayerIds: Array.isArray(b.taxpayerIds) ? b.taxpayerIds : undefined,
      zaman: b.zaman || { tur: 'haftalik', gunler: [1, 2, 3, 4, 5], baslangic: '09:30', bitis: '17:00' },
      gunlukTavan: Number(b.gunlukTavan || 8),
      dryRun: b.dryRun !== false,
      aktif: b.aktif === true, // varsayılan KAPALI
      sonKosuAt: null,
      sonSonuc: null,
      bugun: { planlanan: 0, biten: 0, hatali: 0 },
    };
    RUTINLER.push(r);
    return jsonGonder(res, 201, { ok: true, rutin: r });
  }
  const rutinM = /^\/ekip\/rutinler\/([^/]+)$/.exec(yol);
  if (rutinM && (yontem === 'PATCH' || yontem === 'DELETE')) {
    const i = RUTINLER.findIndex((r) => r.id === rutinM[1]);
    if (i < 0) return jsonGonder(res, 404, { message: 'rutin yok' });
    if (yontem === 'DELETE') {
      RUTINLER.splice(i, 1);
      return jsonGonder(res, 200, { ok: true });
    }
    const b = govde || {};
    const izinli = ['ad', 'ajanId', 'sablon', 'kapsam', 'taxpayerIds', 'zaman', 'gunlukTavan', 'dryRun', 'aktif'];
    for (const k of izinli) if (k in b) RUTINLER[i][k] = b[k];
    return jsonGonder(res, 200, { ok: true, rutin: RUTINLER[i] });
  }
  const simdiM = /^\/ekip\/rutinler\/([^/]+)\/simdi$/.exec(yol);
  if (yontem === 'POST' && simdiM) {
    const r = RUTINLER.find((x) => x.id === simdiM[1]);
    if (!r) return jsonGonder(res, 404, { message: 'rutin yok' });
    const kapsamdakiler = MUKELLEFLER.slice(0, Math.min(r.gunlukTavan, 4));
    const surenVar = KUYRUKLAR.some((x) => x.durum === 'suruyor');
    const k = {
      id: `kq-${Date.now().toString(36)}`,
      ad: r.ad,
      ajanId: r.ajanId,
      dryRun: r.dryRun,
      kaynak: 'rutin',
      rutinId: r.id,
      durum: surenVar ? 'bekliyor' : 'suruyor',
      ogeler: kapsamdakiler.map((m, i) => ({ taxpayerId: m.id, ad: m.ad, durum: i === 0 && !surenVar ? 'suruyor' : 'bekliyor', isId: i === 0 && !surenVar ? `is-kuyruk-${++sayac}` : null, hata: null, basladi: i === 0 && !surenVar ? simdi().getTime() : null, bitti: null })),
      createdAt: iso(simdi().getTime()),
      bitisAt: null,
      sonAdim: simdi().getTime(),
    };
    KUYRUKLAR.unshift(k);
    r.sonKosuAt = k.createdAt;
    r.bugun.planlanan += k.ogeler.length;
    return jsonGonder(res, 200, { ok: true, eklenen: k.ogeler.length, kuyrukId: k.id });
  }

  // ── Kuyruk ──
  if (yontem === 'GET' && yol === '/ekip/kuyruk') return jsonGonder(res, 200, { kuyruklar: KUYRUKLAR.map(kuyrukGoruntu) });
  if (yontem === 'POST' && yol === '/ekip/kuyruk') {
    const b = govde || {};
    const ids = Array.isArray(b.taxpayerIds) ? b.taxpayerIds.map(String) : [];
    if (!ids.length || !b.ajanId || !b.sablon) return jsonGonder(res, 400, { message: 'ajanId, sablon ve taxpayerIds gerekli' });
    const surenVar = KUYRUKLAR.some((x) => x.durum === 'suruyor');
    const k = {
      id: `kq-${Date.now().toString(36)}`,
      ad: String(b.ad || 'Toplu görev'),
      ajanId: String(b.ajanId),
      dryRun: b.dryRun !== false,
      kaynak: 'toplu',
      rutinId: null,
      durum: surenVar ? 'bekliyor' : 'suruyor',
      ogeler: ids.map((id, i) => ({ taxpayerId: id, ad: mukellef(id).ad, durum: i === 0 && !surenVar ? 'suruyor' : 'bekliyor', isId: i === 0 && !surenVar ? `is-kuyruk-${++sayac}` : null, hata: null, basladi: i === 0 && !surenVar ? simdi().getTime() : null, bitti: null })),
      createdAt: iso(simdi().getTime()),
      bitisAt: null,
      sonAdim: simdi().getTime(),
    };
    KUYRUKLAR.unshift(k);
    return jsonGonder(res, 201, { ok: true, kuyruk: kuyrukGoruntu(k) });
  }
  const kuyrukM = /^\/ekip\/kuyruk\/([^/]+)\/(durdur|devam)$/.exec(yol);
  if (yontem === 'POST' && kuyrukM) {
    const k = KUYRUKLAR.find((x) => x.id === kuyrukM[1]);
    if (!k) return jsonGonder(res, 404, { message: 'kuyruk yok' });
    if (kuyrukM[2] === 'durdur') {
      if (k.durum === 'suruyor' || k.durum === 'bekliyor' || k.durum === 'kota_bekliyor') k.durum = 'durduruldu';
    } else if (k.durum === 'durduruldu') {
      k.durum = KUYRUKLAR.some((x) => x !== k && x.durum === 'suruyor') ? 'bekliyor' : 'suruyor';
      k.sonAdim = simdi().getTime();
      if (k.durum === 'suruyor' && !k.ogeler.some((o) => o.durum === 'suruyor')) {
        const s = k.ogeler.find((o) => o.durum === 'bekliyor');
        if (s) {
          s.durum = 'suruyor';
          s.basladi = simdi().getTime();
          s.isId = `is-kuyruk-${++sayac}`;
        } else k.durum = 'bitti';
      }
    }
    return jsonGonder(res, 200, { ok: true, kuyruk: kuyrukGoruntu(k) });
  }
  return false;
}

module.exports = { uclar };
