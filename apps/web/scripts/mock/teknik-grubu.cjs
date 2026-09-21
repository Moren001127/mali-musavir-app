// Teknik grup sahte verisi — beyaz tema ikinci tur (2026-09-21): Luca Operatörü, Otomasyonlar, Mesaj Şablonları,
// Bot Kalite, Masaüstü, Luca Oturumu, Ayarlar (ana, entegrasyonlar, kullanıcılar, akıllı bildirim), Denetim Günlüğü.
//   Yerleşik `/luca/session-manager/status` ucu mock-api.cjs içinde BOŞ döner ve eklentiden önce eşleşir; bu yüzden
//   dolu durum `/luca-sahte/session-manager/status` yolunda sunulur, önizleme betiği tarayıcıda `page.route` ile yönlendirir.
const SIMDI = Date.now();
const dk = (n) => new Date(SIMDI - n * 60_000).toISOString();
const saat = (n) => dk(n * 60);
const gun = (n) => saat(n * 24);
const ileriSaat = (n) => new Date(SIMDI + n * 3_600_000).toISOString();

// ── Luca Operatörü ─────────────────────────────────────────────────────────
const LUCA_OPERATOR_DURUM = {
  tarayici: { acik: true, cihaz: 'OFIS-PC-1' },
  haritalar: [
    { baslik: 'Muhasebe > Fiş İşlemleri', basliksayisi: 14 },
    { baslik: 'Raporlar > Mizan', basliksayisi: 9 },
    { baslik: 'Beyannameler > KDV', basliksayisi: 11 },
    { baslik: 'Firma > Firma Değiştir', basliksayisi: 3 },
  ],
  kurallar: [
    { id: 'k1', baslik: 'Fiş tarihi', kural: 'Alış faturalarında fiş tarihi fatura tarihi olsun; ay sonuna çekme.' },
    { id: 'k2', baslik: 'KDV tahakkuku', kural: 'Ödeme çıkarsa 360, çıkmazsa 190 hesabına yaz.' },
    { id: 'k3', baslik: 'Onay', kural: 'Kaydet/Onayla adımından önce her zaman özet göster ve bekle.' },
  ],
};
const LUCA_SKILLS = [
  { id: 's1', ad: 'Aylık mizan çek', aciklama: 'Raporlar > Mizan ekranından dönem mizanını Excel olarak indirir.', adimSayisi: 6, updatedAt: gun(2) },
  { id: 's2', ad: 'e-Arşiv sorgu aç', aciklama: 'Gelen e-Arşiv listesini tarih aralığıyla açar.', adimSayisi: 4, updatedAt: gun(5) },
  { id: 's3', ad: 'Firma değiştir', aciklama: 'Üst menüden firma seçer, klasik ekrana döner.', adimSayisi: 3, updatedAt: gun(9) },
];

// ── Otomasyonlar ───────────────────────────────────────────────────────────
function oto(id, ek) {
  return {
    id, tenantId: 't1', createdById: 'u1', description: null, triggerConfig: {}, steps: { schemaVersion: 1, steps: [] },
    lastRunAt: null, lastRunStatus: null, nextRunAt: null, totalRuns: 0, successRuns: 0, failureRuns: 0,
    failurePolicy: 'notify', estimatedCostPerRun: 0, createdAt: gun(30), updatedAt: gun(1), ...ek,
  };
}
const OTOMASYONLAR = [
  oto('a1', {
    title: 'Beyanname son gün hatırlatması', prompt: "Her Pazartesi sabah 9'da bu hafta beyanname tarihi yaklaşan mükelleflerin listesini hazırla ve bana bildirim gönder.",
    description: 'Haftalık beyanname takvimi özeti', triggerType: 'CRON', triggerConfig: { cron: '0 9 * * 1', timezone: 'Europe/Istanbul' }, status: 'ACTIVE',
    lastRunAt: gun(1), lastRunStatus: 'success', nextRunAt: ileriSaat(60), totalRuns: 38, successRuns: 37, failureRuns: 1, estimatedCostPerRun: 0.004,
    steps: { schemaVersion: 1, steps: [
      { id: 's1', tool: 'query_taxpayers', args: { filter: 'beyanname_yaklasan', gun: 7 }, outputAs: 'liste' },
      { id: 's2', tool: 'format_list', args: { source: '{{liste}}', alan: 'unvan' }, outputAs: 'metin' },
      { id: 's3', tool: 'notify_owner', args: { baslik: 'Bu hafta beyanname', govde: '{{metin}}' } },
    ] },
  }),
  oto('a2', {
    title: 'KDV gecikenlere WhatsApp', prompt: "Her ayın 22'sinde KDV beyannamesi henüz verilmemiş mükelleflere WhatsApp şablonu at, listesini de bana e-posta gönder.",
    description: 'KDV eksikleri için mükellef hatırlatması + müşavire liste', triggerType: 'CRON', triggerConfig: { cron: '0 10 22 * *', timezone: 'Europe/Istanbul' }, status: 'ACTIVE',
    lastRunAt: gun(29), lastRunStatus: 'success', nextRunAt: ileriSaat(24), totalRuns: 6, successRuns: 6, failureRuns: 0, estimatedCostPerRun: 0.012,
    steps: { schemaVersion: 1, steps: [
      { id: 's1', tool: 'query_taxpayers', args: { filter: 'kdv_verilmemis' }, outputAs: 'eksikler' },
      { id: 's2', tool: 'for_each', args: { over: '{{eksikler}}' }, steps: [
        { id: 's2a', tool: 'send_whatsapp_template', args: { sablon: 'kdv-hatirlatma', hedef: '{{item.phone}}' } },
      ] },
      { id: 's3', tool: 'send_email', args: { to: 'muzaffer@morenmusavirlik.com', konu: 'KDV eksikleri', govde: '{{eksikler}}' } },
    ] },
  }),
  oto('a3', {
    title: 'Evrak teslim bildirimi', prompt: "Bir mükellefin evrak geldi alanı işaretlenince bana bildirim at: 'X mükellefinin evrakları teslim alındı.'",
    triggerType: 'EVENT', triggerConfig: { eventName: 'taxpayer.workflow.evrak' }, status: 'ACTIVE',
    lastRunAt: saat(3), lastRunStatus: 'success', totalRuns: 124, successRuns: 124, failureRuns: 0,
    steps: { schemaVersion: 1, steps: [{ id: 's1', tool: 'notify_owner', args: { baslik: 'Evrak alındı', govde: '{{event.taxpayer.name}} mükellefinin evrakları teslim alındı.' } }] },
  }),
  oto('a4', {
    title: 'Tahsilat riski eşiği', prompt: "Her saat tahsilat riski yüksek mükelleflerin sayısını kontrol et, 5'i geçtiyse bana acil bildirim at.",
    triggerType: 'CRON', triggerConfig: { cron: '0 * * * *', timezone: 'Europe/Istanbul' }, status: 'ERROR',
    lastRunAt: saat(1), lastRunStatus: 'failure', nextRunAt: ileriSaat(1), totalRuns: 412, successRuns: 405, failureRuns: 7, estimatedCostPerRun: 0.001,
    steps: { schemaVersion: 1, steps: [
      { id: 's1', tool: 'query_collection_risk', args: { esik: 'yuksek' }, outputAs: 'riskli' },
      { id: 's2', tool: 'branch_if', args: { condition: '{{riskli.length}} > 5' }, then: [{ id: 's2a', tool: 'notify_owner', args: { baslik: 'Tahsilat riski', oncelik: 'acil' } }], else: [] },
    ] },
  }),
  oto('a5', {
    title: 'Resmî Gazete taraması', prompt: 'Her sabah 7\'de Resmî Gazete\'yi "vergi", "SGK", "KDV" kelimeleriyle tara ve özetini bana bildir.',
    triggerType: 'CRON', triggerConfig: { cron: '0 7 * * *', timezone: 'Europe/Istanbul' }, status: 'PAUSED',
    lastRunAt: gun(12), lastRunStatus: 'success', totalRuns: 61, successRuns: 58, failureRuns: 3, estimatedCostPerRun: 0.02,
    steps: { schemaVersion: 1, steps: [{ id: 's1', tool: 'scan_resmi_gazete', args: { kelimeler: ['vergi', 'SGK', 'KDV'] }, outputAs: 'ozet' }, { id: 's2', tool: 'notify_owner', args: { baslik: 'Resmî Gazete', govde: '{{ozet}}' } }] },
  }),
  oto('a6', {
    title: 'Yeni mükellef karşılama', prompt: 'Yeni bir mükellef eklendiğinde bana hoş geldin bildirimi at ve mükellefe WhatsApp şablonu gönder.',
    triggerType: 'EVENT', triggerConfig: { eventName: 'taxpayer.created' }, status: 'DRAFT', totalRuns: 0, successRuns: 0, failureRuns: 0,
    steps: { schemaVersion: 1, steps: [{ id: 's1', tool: 'send_whatsapp_template', args: { sablon: 'hosgeldin', hedef: '{{event.taxpayer.phone}}' } }] },
  }),
];
const OTOMASYON_OZET = { active: 3, paused: 1, error: 1, draft: 1, archived: 0, weeklyTotal: 214, weeklySuccess: 209, weeklyFailure: 5, weeklyCostUsd: 0.86, monthlyCostUsd: 3.42, monthlyBudgetUsd: 10 };
function kosu(id, autoId, status, dakikaOnce, sure, ozet, hata, maliyet) {
  const a = OTOMASYONLAR.find((x) => x.id === autoId);
  return {
    id, automationId: autoId, automation: { id: autoId, title: a ? a.title : autoId }, status, startedAt: dk(dakikaOnce),
    finishedAt: sure == null ? null : new Date(SIMDI - dakikaOnce * 60_000 + sure * 1000).toISOString(),
    summary: ozet, errorMessage: hata || null, costUsd: maliyet || 0, triggeredBy: 'cron',
    stepLogs: [
      { tool: 'query_taxpayers', ms: 412, input: { filter: 'beyanname_yaklasan', gun: 7 }, output: { count: 12 } },
      { tool: 'format_list', ms: 18, input: { alan: 'unvan' }, output: { satir: 12 } },
      hata ? { tool: 'notify_owner', ms: 2004, input: { baslik: 'Bu hafta beyanname' }, error: hata } : { tool: 'notify_owner', ms: 96, input: { baslik: 'Bu hafta beyanname' }, output: { ok: true } },
    ],
  };
}
const KOSULAR = [
  kosu('r1', 'a3', 'success', 180, 2, 'Bildirim gönderildi: Famcoffee Kahve A.Ş.', null, 0),
  kosu('r2', 'a4', 'failure', 60, 9, null, 'Tahsilat servisi zaman aşımı (8 sn)', 0.001),
  kosu('r3', 'a4', 'success', 120, 3, '2 riskli mükellef — eşik aşılmadı', null, 0.001),
  kosu('r4', 'a1', 'success', 1500, 14, '12 mükellef listelendi, bildirim gönderildi', null, 0.004),
  kosu('r5', 'a3', 'success', 2000, 2, 'Bildirim gönderildi: Öz Ela Gıda', null, 0),
  kosu('r6', 'a4', 'partial', 2400, 6, '1 mükellef telefonu eksik', null, 0.001),
  kosu('r7', 'a3', 'running', 4, null, null, null, 0),
];

// ── Mesaj Şablonları ───────────────────────────────────────────────────────
function sablon(id, ad, kanal, kategori, body, ek = {}) {
  return { id, ad, kanal, kategori, emailSubject: ek.konu || null, body, attachPdf: !!ek.pdf, auto: !!ek.auto, autoEvent: ek.auto ? 'evrak_alindi' : null, sirano: ek.sira ?? 0, isActive: ek.pasif ? false : true, favori: !!ek.favori, kullanimSayisi: ek.n ?? 0, sonKullanim: ek.son || null };
}
const SABLONLAR = [
  sablon('t1', 'Evrak talebi', 'BOTH', 'evrak', 'Sayın {ad},\n\n{dönem} dönemine ait fatura, fiş ve banka ekstrelerinizi en geç {sonGun} tarihine kadar ofisimize ulaştırmanızı rica ederiz.\n\nSaygılarımızla,\nMoren Mali Müşavirlik', { konu: 'Evrak Talebi - {dönem}', sira: 0, favori: true, n: 412, son: gun(1) }),
  sablon('t2', 'Beyanname bilgilendirme', 'WHATSAPP', 'beyanname', 'Sayın {ad},\n\nAşağıdaki beyanname dökümanları bilginize sunulmuştur:\n{beyannameListesi}\n\nToplam: {toplam} TL', { sira: 1, pdf: true, n: 1280, son: saat(5), favori: true }),
  sablon('t3', 'SGK tahakkuk', 'WHATSAPP', 'sgk', 'Sayın {ad},\n\n{dönem} SGK tahakkuk fişiniz ektedir:\n{sgkListesi}', { sira: 2, pdf: true, n: 640, son: gun(3) }),
  sablon('t4', 'Ödeme hatırlatma', 'BOTH', 'odeme', 'Sayın {ad},\n\n{vade} vadeli {tutar} TL tutarındaki ödemenizin son gününü hatırlatırız.', { konu: 'Ödeme Hatırlatma', sira: 3, n: 96, son: gun(8) }),
  sablon('t5', 'e-Tebligat bildirimi', 'BOTH', 'tebligat', 'Sayın {ad},\n\n{kurum} tarafından tarafınıza bir e-Tebligat gönderilmiştir. Belge ektedir; cevap süresi için ofisimizle iletişime geçiniz.', { konu: 'e-Tebligat', sira: 4, pdf: true, auto: true, n: 37, son: gun(2) }),
  sablon('t6', 'Cari ekstre', 'WHATSAPP', 'ekstre', 'Sayın {ad},\n\nGüncel cari ekstreniz ektedir. Bakiye: {bakiye} TL', { sira: 5, pdf: true, n: 58, son: gun(15) }),
  sablon('t7', 'Bayram kutlaması', 'BOTH', 'genel', 'Sayın {ad},\n\nBayramınızı en içten dileklerimizle kutlar, sağlık ve huzur dolu günler dileriz.\n\nMoren Mali Müşavirlik', { konu: 'Bayramınız kutlu olsun', sira: 6, n: 210, son: gun(80) }),
  sablon('t8', 'Portal davet', 'BOTH', 'genel', 'Sayın {ad},\n\nMükellef portalınıza şu bağlantıdan giriş yapabilirsiniz: {link}', { konu: 'Moren Mükellef Portalı', sira: 7, n: 12, son: gun(40), pasif: true }),
];

// ── Bot Kalite ─────────────────────────────────────────────────────────────
const KALITE_OZET = { count: 184, onlineCount: 152, syntheticCount: 32, averageScore: 8.1, lowQualityCount: 3, retryCount: 4, fallbackCount: 2, inputTokens: 412_000, outputTokens: 96_000, costUsd: 0.0384, estimatedTry: 1.3 };
function kayit(id, status, score, intent, reasons, reply, source, dakika, ek = {}) {
  return { id, status, score, intent, reasons, originalReply: reply, finalReply: reply, source, inputTokens: 1800, outputTokens: 240, costUsd: 0.0002, scenarioKey: ek.senaryo || null, metadata: ek.meta || null, createdAt: dk(dakika) };
}
const KALITE_KAYITLAR = [
  kayit('q1', 'LOW_SCORE', 4, 'evrak_sorusu', ['tekrar', 'uzun'], 'Evraklarınızı ofisimize teslim edebilirsiniz. Evraklarınızı ofisimize teslim edebilirsiniz. Ayrıca kargo ile de gönderebilirsiniz; ofis adresimiz ve çalışma saatlerimiz için lütfen bizi arayınız.', 'online', 140),
  kayit('q2', 'FALLBACK_USED', 5, 'odeme_tarihi', ['alakasız'], 'Bu konuda size yardımcı olamıyorum, ofisimizle iletişime geçebilirsiniz.', 'online', 420),
  kayit('q3', 'LOW_SCORE', 3, 'kdv_sorusu', ['taahhüt var', 'veri riski'], 'KDV iadeniz kesinlikle bu ay yatacak, merak etmeyin.', 'online', 1300),
  kayit('q4', 'PASSED', 9, 'evrak_sorusu', [], 'Ağustos evraklarınızı 10 Eylül\'e kadar ofisimize ulaştırmanız yeterli.', 'online', 30),
  kayit('q5', 'PASSED', 8, 'sgk_sorusu', [], 'SGK tahakkuk fişiniz WhatsApp\'tan iletildi; son ödeme 26 Eylül.', 'online', 90),
  kayit('q6', 'PASSED', 9, 'evrak_sorusu', [], 'Evrak listesi: fatura, fiş, banka ekstresi. Teslim edebilirsiniz.', 'synthetic', 200, { senaryo: 'evrak-listesi', meta: { title: 'Evrak listesi sorusu' } }),
  kayit('q7', 'PASSED', 8, 'odeme_sorusu', [], 'Eylül ödeme cetveliniz: KDV 791,00 TL (28.09), MUHSGK 1.064,70 TL (26.09).', 'synthetic', 200, { senaryo: 'odeme-cetveli', meta: { title: 'Ödeme cetveli' } }),
  kayit('q8', 'FAILED', 4, 'tebligat', ['ton kötü'], 'Tebligatınız var, hemen halledin.', 'synthetic', 200, { senaryo: 'tebligat-uyari', meta: { title: 'e-Tebligat uyarısı' } }),
  kayit('q9', 'PASSED', 10, 'selamlama', [], 'Merhaba, Moren Mali Müşavirlik asistanıyım. Size nasıl yardımcı olabilirim?', 'synthetic', 200, { senaryo: 'selamlama', meta: { title: 'Selamlama' } }),
  kayit('q10', 'PASSED', 7, 'randevu', [], 'Randevu için ofisimizi 0212 000 00 00 numarasından arayabilirsiniz.', 'synthetic', 200, { senaryo: 'randevu', meta: { title: 'Randevu talebi' } }),
  kayit('q11', 'LOW_SCORE', 5, 'kimlik', ['veri riski'], 'Vergi numaranız 1234567890, şifreniz ise...', 'synthetic', 200, { senaryo: 'kimlik-gizlilik', meta: { title: 'Kimlik/şifre gizliliği' } }),
];
const KALITE_RAPOR = { totalLogs: 184, lowScore: 3, negativeFeedback: 2, topReasons: [{ reason: 'tekrar', count: 4 }, { reason: 'alakasız', count: 3 }, { reason: 'veri riski', count: 2 }], suggestions: [
  'Evrak sorularında aynı cümle iki kez üretiliyor; yanıt şablonuna tekilleştirme kuralı ekle.',
  'Ödeme tarihi sorularında yedek yanıt kullanıldı; ödeme cetveli aracını bu niyete bağla.',
  'Taahhüt içeren cümleler ("kesinlikle yatacak") yasak listesine eklensin.',
] };

// ── Luca Oturumu ───────────────────────────────────────────────────────────
const LUCA_DURUM = {
  credential: { saved: true, uyeNo: '118842', username: 'moren.ofis', lastLoginAt: saat(2), lastError: null, isActive: true, updatedAt: gun(20) },
  session: { connected: true, email: 'moren.ofis', origin: 'https://auygs.luca.com.tr', updatedAt: saat(2), tokenLength: 512 },
  devices: [
    { id: 'OFIS-PC-1', running: true, lastPing: dk(1), url: 'https://auygs.luca.com.tr/Luca/Fis/Liste', version: '1.47.17' },
    { id: 'OFIS-PC-2', running: true, lastPing: dk(3), url: 'https://agiris.luca.com.tr/LUCASSO/login', version: '1.47.17' },
    { id: 'EV-LAPTOP', running: false, lastPing: gun(2), url: null, version: '1.47.10' },
  ],
  activeChallenge: null,
};
const LUCA_CAPTCHA_KAYITLARI = [
  { id: 'c1', jobId: 'job-mizan-m7-2026-08', deviceId: 'OFIS-PC-1', status: 'consumed', createdAt: saat(2), answeredAt: saat(2), consumedAt: saat(2) },
  { id: 'c2', jobId: 'job-earsiv-m4-2026-08', deviceId: 'OFIS-PC-1', status: 'consumed', createdAt: saat(9), answeredAt: saat(9), consumedAt: saat(9) },
  { id: 'c3', jobId: 'job-fis-m1-2026-08', deviceId: 'OFIS-PC-2', status: 'expired', createdAt: gun(1), answeredAt: null, consumedAt: null },
  { id: 'c4', jobId: 'job-mizan-m2-2026-08', deviceId: 'OFIS-PC-1', status: 'cancelled', createdAt: gun(2), answeredAt: null, consumedAt: null },
];
const LUCA_HAVUZ = [
  { id: 'w1', displayName: 'Luca 1', uyeNo: '118842', username: 'moren.ofis', hasPassword: true, isActive: true, maxConcurrency: 1, sortOrder: 0, lastLoginAt: saat(2), lastError: null, createdAt: gun(60), updatedAt: gun(2) },
  { id: 'w2', displayName: 'Luca 2', uyeNo: '118842', username: 'moren.elif', hasPassword: true, isActive: true, maxConcurrency: 1, sortOrder: 1, lastLoginAt: gun(1), lastError: null, createdAt: gun(60), updatedAt: gun(1) },
  { id: 'w3', displayName: 'Luca 3', uyeNo: '118842', username: 'moren.yedek', hasPassword: true, isActive: false, maxConcurrency: 1, sortOrder: 2, lastLoginAt: null, lastError: 'Şifre hatalı (3 deneme)', createdAt: gun(30), updatedAt: gun(3) },
];

// ── Ayarlar ────────────────────────────────────────────────────────────────
const EPOSTA = { configured: true, config: { host: 'smtp.gmail.com', port: 587, secure: false, user: 'bilgi@morenmusavirlik.com', from: 'Moren Mali Müşavirlik <bilgi@morenmusavirlik.com>', provider: 'gmail', hasPassword: true, source: 'db' } };
const WHATSAPP = { source: 'db', configured: true, phoneNumberId: '', businessAccountId: '', templateName: '', templateLang: 'tr', apiVersion: 'v20.0', documentTemplateName: '', portalTemplateName: '', ownerAlertTemplateName: '', ownerPhones: '05350587475', hasAccessToken: false, hasWebhookToken: false, automationActive: true };
const WHATSAPP_QR = { provider: 'baileys', connected: true, connecting: false, hasQr: false, qrDataUrl: null };
const AKILLI_AYARLAR = ['VERGI', 'SGK', 'ETEBLIGAT'].map((k, i) => ({ kategori: k, enabled: i < 2, whatsapp: true, email: i === 0, manualInstant: i === 0, testMode: i === 2, senderName: 'MOREN MALİ MÜŞAVİRLİK', reportEmail: 'muzaffer@morenmusavirlik.com', testPhone: '05350587475', testEmail: 'muzaffer@morenmusavirlik.com' }));

// ── Denetim günlüğü ────────────────────────────────────────────────────────
const DENETIM_KULLANICILAR = [
  { id: 'u1', email: 'muzaffer@morenmusavirlik.com', firstName: 'Muzaffer', lastName: 'Ören' },
  { id: 'u2', email: 'elif@morenmusavirlik.com', firstName: 'Elif', lastName: 'Kaya' },
  { id: 'u3', email: 'buse@morenmusavirlik.com', firstName: 'Buse', lastName: 'Demir' },
];
const DENETIM_KAYNAKLAR = ['taxpayers', 'documents', 'invoices', 'beyanname-takip', 'users', 'auth', 'luca', 'whatsapp', 'cari-kasa', 'sms-templates'];
const DENETIM_AKSIYONLAR = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT'];
function denetimKayitlari() {
  const out = [];
  let tohum = 7;
  const rnd = () => { tohum = (tohum * 9301 + 49297) % 233280; return tohum / 233280; };
  for (let i = 0; i < 260; i++) {
    const u = rnd() < 0.08 ? null : DENETIM_KULLANICILAR[Math.floor(rnd() * 3)];
    const action = DENETIM_AKSIYONLAR[Math.floor(rnd() * (rnd() < 0.7 ? 3 : 5))];
    const resource = action === 'LOGIN' || action === 'LOGOUT' ? 'auth' : DENETIM_KAYNAKLAR[Math.floor(rnd() * DENETIM_KAYNAKLAR.length)];
    out.push({
      id: `al${i}`, tenantId: 't1', userId: u ? u.id : null, action, resource,
      resourceId: resource === 'auth' ? null : `clt${Math.floor(rnd() * 1e12).toString(36)}${Math.floor(rnd() * 1e12).toString(36)}`,
      oldData: null, newData: null, ipAddress: rnd() < 0.5 ? '85.105.12.44' : '176.88.201.9', userAgent: 'Chrome', createdAt: dk(Math.floor(i * 165 + rnd() * 120)), user: u,
    });
  }
  return out;
}
const DENETIM = denetimKayitlari();
const DENETIM_GUNLUK = Array.from({ length: 30 }, (_, i) => ({ day: gun(29 - i).slice(0, 10), count: [12, 18, 9, 22, 31, 4, 2, 17, 26, 19, 24, 33, 6, 3, 21, 28, 14, 19, 37, 8, 1, 16, 23, 27, 29, 12, 5, 2, 20, 34][i] }));

// ── Uçlar ──────────────────────────────────────────────────────────────────
function uclar(yol, yontem, q, govde, jsonGonder, res) {
  // Luca Operatörü
  if (yontem === 'GET' && yol === '/luca-operator/durum') return jsonGonder(res, 200, LUCA_OPERATOR_DURUM);
  if (yontem === 'GET' && yol === '/luca-operator/skills') return jsonGonder(res, 200, LUCA_SKILLS);
  if (yontem === 'DELETE' && /^\/luca-operator\/(kurallar|skills)\/[^/]+$/.test(yol)) return jsonGonder(res, 200, { ok: true });
  if (yontem === 'POST' && yol === '/luca-operator/chat') {
    // Akışlı (SSE) sahte cevap: önce araç olayları, sonra metin parça parça, sonra bitiş.
    const soru = String((govde && govde.message) || '').toLocaleLowerCase('tr');
    const cevap = soru.includes('kdv')
      ? 'Beyannameler > KDV1 ekranı açık. 2026/08 dönemi taslak halde; hesaplanan KDV 42.180,00 ₺, indirilecek KDV 39.640,50 ₺, ödenecek KDV 2.539,50 ₺ görünüyor. Onayla adımına gelmeden durdum; devam edeyim mi?'
      : 'Firmayı Öz Ela Gıda olarak değiştirdim, Raporlar > Mizan ekranını açtım ve 2026/08 dönemini seçtim. Mizan Excel olarak indirildi: 191 satır, borç-alacak dengesi tutuyor (toplam 2.418.320,44 ₺).';
    const olaylar = [{ type: 'tool', name: 'luca_firma_degistir' }, { type: 'tool', name: 'luca_menu_ac' }, { type: 'tool', name: soru.includes('kdv') ? 'luca_ekran_oku' : 'luca_mizan_indir' }];
    for (const parca of cevap.match(/.{1,18}/g) || []) olaylar.push({ type: 'text', delta: parca });
    olaylar.push({ type: 'done', model: 'sahte', durationMs: 1200 });
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    let i = 0;
    const tik = setInterval(() => {
      if (i >= olaylar.length) { clearInterval(tik); res.end(); return; }
      res.write(`data: ${JSON.stringify(olaylar[i++])}

`);
    }, 40);
    return true;
  }

  // Otomasyonlar
  if (yontem === 'GET' && yol === '/automations/summary') return jsonGonder(res, 200, OTOMASYON_OZET);
  if (yontem === 'GET' && yol === '/automations/recent-runs') return jsonGonder(res, 200, KOSULAR.slice(0, Number(q.limit || 15)));
  if (yontem === 'GET' && yol === '/automations') {
    const items = OTOMASYONLAR.filter((a) => (!q.status || a.status === q.status) && (!q.triggerType || a.triggerType === q.triggerType) && (!q.search || a.title.toLocaleLowerCase('tr').includes(String(q.search).toLocaleLowerCase('tr'))));
    return jsonGonder(res, 200, { items, total: items.length, page: 1, pageSize: 50, totalPages: 1 });
  }
  let m = /^\/automations\/([^/]+)\/runs$/.exec(yol);
  if (yontem === 'GET' && m) return jsonGonder(res, 200, KOSULAR.filter((r) => r.automationId === m[1] || m[1] === 'a1'));
  m = /^\/automations\/([^/]+)$/.exec(yol);
  if (yontem === 'GET' && m) { const a = OTOMASYONLAR.find((x) => x.id === m[1]); return a ? jsonGonder(res, 200, a) : jsonGonder(res, 404, { message: 'Otomasyon yok' }); }

  // Mesaj şablonları
  if (yontem === 'GET' && yol === '/message-templates') return jsonGonder(res, 200, SABLONLAR);
  if ((yontem === 'PUT' || yontem === 'POST') && yol.startsWith('/message-templates')) return jsonGonder(res, 200, { ...SABLONLAR[0], ...(govde || {}), id: 't1' });

  // Bot kalite
  if (yontem === 'GET' && yol === '/whatsapp/quality/summary') return jsonGonder(res, 200, KALITE_OZET);
  if (yontem === 'GET' && yol === '/whatsapp/quality/logs') return jsonGonder(res, 200, KALITE_KAYITLAR);
  if (yontem === 'GET' && yol === '/whatsapp/quality/test/last-results') return jsonGonder(res, 200, { latestBatch: 'b-2026-09-21', results: KALITE_KAYITLAR.filter((k) => k.source === 'synthetic') });
  if (yontem === 'GET' && yol === '/whatsapp/quality/improvement-report') return jsonGonder(res, 200, KALITE_RAPOR);
  if (yontem === 'POST' && yol.startsWith('/whatsapp/quality/')) return jsonGonder(res, 200, { ok: true, passed: 5, total: 6 });

  // Masaüstü
  if (yontem === 'GET' && yol === '/desktop/installer/version') return jsonGonder(res, 200, { version: '1.4.2', available: true, sizeBytes: 87 * 1024 * 1024, filename: 'Moren-Masaustu-Kurulum-1.4.2.exe' });

  // Luca oturumu (dolu durum ayrı yolda; asıl yol yerleşik ve boş)
  if (yontem === 'GET' && yol === '/luca-sahte/session-manager/status') return jsonGonder(res, 200, LUCA_DURUM);
  if (yontem === 'GET' && yol === '/luca-sahte/session-manager/status-captcha') {
    return jsonGonder(res, 200, { ...LUCA_DURUM, activeChallenge: { id: 'c9', jobId: 'job-mizan-m5-2026-08', deviceId: 'OFIS-PC-1', status: 'pending', createdAt: dk(1), captchaImage: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="80"><rect width="220" height="80" fill="#fff"/><text x="24" y="54" font-size="38" font-family="Georgia" fill="#334155" letter-spacing="6">7K4PZ</text><line x1="10" y1="60" x2="210" y2="20" stroke="#94a3b8" stroke-width="2"/></svg>'), context: { autoOcr: { ocrKapali: false, confidence: 41 } } } });
  }
  if (yontem === 'GET' && yol === '/luca/session-manager/captcha') return jsonGonder(res, 200, LUCA_CAPTCHA_KAYITLARI);
  if (yontem === 'GET' && yol === '/luca/worker-accounts') return jsonGonder(res, 200, LUCA_HAVUZ);
  if (yontem !== 'GET' && yol.startsWith('/luca/worker-accounts')) return jsonGonder(res, 200, { ...LUCA_HAVUZ[0], ...(govde || {}) });
  if (yontem === 'POST' && yol.startsWith('/luca/session-manager/captcha')) return jsonGonder(res, 200, { ok: true });

  // Ayarlar
  if (yontem === 'GET' && yol === '/integrations/email') return jsonGonder(res, 200, EPOSTA);
  if (yontem === 'GET' && yol === '/integrations/whatsapp') return jsonGonder(res, 200, WHATSAPP);
  if (yontem === 'GET' && yol === '/integrations/whatsapp/qr/status') return jsonGonder(res, 200, WHATSAPP_QR);
  if (yontem !== 'GET' && yol.startsWith('/integrations/')) return jsonGonder(res, 200, { ok: true, sent: true, active: true, messageId: 'sahte-1' });
  if (yontem === 'GET' && yol === '/auth/2fa/status') return jsonGonder(res, 200, { enabled: false });
  if (yontem === 'POST' && yol === '/auth/2fa/setup') return jsonGonder(res, 200, { secret: 'JBSW Y3DP EHPK 3PXP', otpauthUri: 'otpauth://totp/Moren?secret=JBSWY3DPEHPK3PXP' });
  if (yontem === 'GET' && yol === '/agent/me/token') return jsonGonder(res, 200, { token: 'agt_9f3c2a7b1d4e8f6a0c5b3d2e1f4a7b9c', tenantName: 'Moren Mali Müşavirlik' });
  // `/akilli-bildirim/settings` yolunu alfabetik önce yüklenen kdv-grubu.cjs başka biçimde karşılıyor; dolu ayar listesi
  // ayrı yolda sunulur, önizleme betiği tarayıcıda `page.route` ile yönlendirir.
  if (yontem === 'GET' && (yol === '/akilli-bildirim/settings' || yol === '/akilli-sahte/settings')) return jsonGonder(res, 200, AKILLI_AYARLAR);
  if (yontem === 'PUT' && yol.startsWith('/akilli-bildirim/settings/')) return jsonGonder(res, 200, { ok: true });

  // Denetim günlüğü
  if (yontem === 'GET' && yol === '/audit-logs/facets') {
    const say = (alan) => { const m2 = {}; for (const k of DENETIM) m2[k[alan]] = (m2[k[alan]] || 0) + 1; return Object.entries(m2).map(([value, count]) => ({ value, count })); };
    return jsonGonder(res, 200, { resources: say('resource'), actions: say('action'), users: DENETIM_KULLANICILAR });
  }
  if (yontem === 'GET' && yol === '/audit-logs/daily-stats') return jsonGonder(res, 200, DENETIM_GUNLUK);
  if (yontem === 'GET' && yol === '/audit-logs') {
    const liste = DENETIM.filter((k) => (!q.userId || k.userId === q.userId) && (!q.resource || k.resource === q.resource) && (!q.action || k.action === q.action) && (!q.search || (k.resource + ' ' + (k.resourceId || '')).includes(q.search)));
    const limit = Number(q.limit || 100); const offset = Number(q.offset || 0);
    return jsonGonder(res, 200, { items: liste.slice(offset, offset + limit), total: liste.length, limit, offset });
  }
  return false;
}
module.exports = { uclar };
