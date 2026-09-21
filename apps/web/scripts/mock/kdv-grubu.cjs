// KDV grubu sahte uçları (2026-09-21, ikinci tur beyaz tema): KDV Kontrol, KDV Durum Panosu,
// Toplu Beyanname (portal-automation/summary), e-Tebligat Kontrol, SGK Otomasyonu.
// mock-api.cjs bu dosyayı her istekte otomatik yükler; eşleşmeyen yol için `false` döner.
const gun = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
const saat = (n) => new Date(Date.now() + n * 3_600_000).toISOString();
const iso = (y, m, d) => new Date(y, m - 1, d, 10, 30).toISOString();

const MUK = {
  m1: { id: 'm1', companyName: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', firstName: null, lastName: null, taxNumber: '6420011234' },
  m2: { id: 'm2', companyName: null, firstName: 'Erdoğan', lastName: 'Balçık', taxNumber: '14523698745' },
  m3: { id: 'm3', companyName: null, firstName: 'Ayşegül', lastName: 'Kaya', taxNumber: '25874136982' },
  m4: { id: 'm4', companyName: 'Mert Reklam Ajansı Ltd. Şti.', firstName: null, lastName: null, taxNumber: '6170045678' },
  m5: { id: 'm5', companyName: 'Famcoffee Kahve A.Ş.', firstName: null, lastName: null, taxNumber: '3850098765' },
  m6: { id: 'm6', companyName: 'Ela Tekstil Ltd. Şti.', firstName: null, lastName: null, taxNumber: '3250076543' },
  m7: { id: 'm7', companyName: 'Balçık İnşaat A.Ş.', firstName: null, lastName: null, taxNumber: '1400032109' },
  m8: { id: 'm8', companyName: null, firstName: 'Dilek', lastName: 'Bayageldi', taxNumber: '36985214778' },
};
const ad = (m) => m.companyName || `${m.firstName} ${m.lastName}`;

// ─────────────────────────────────────────────────────────────────────────────
// KDV KONTROL
// ─────────────────────────────────────────────────────────────────────────────
const KDV_SEANSLAR = [
  { id: 'ks1', taxpayerId: 'm7', taxpayer: MUK.m7, periodLabel: '2026/08', type: 'KDV_191', status: 'ACTIVE', isLocked: false, createdAt: gun(-2), maliyetUsd: 0.0184,
    _count: { kdvRecords: 42, images: 39 }, matchSummary: { matched: 31, reviewTotal: 6, amountMismatch: 1, unmatched: 4, rejected: 1, totalResults: 42 } },
  { id: 'ks2', taxpayerId: 'm7', taxpayer: MUK.m7, periodLabel: '2026/08', type: 'KDV_391', status: 'COMPLETED', isLocked: true, createdAt: gun(-2), maliyetUsd: 0.0061,
    _count: { kdvRecords: 18, images: 18 }, matchSummary: { matched: 18, reviewTotal: 0, amountMismatch: 0, unmatched: 0, rejected: 0, totalResults: 18 } },
  { id: 'ks3', taxpayerId: 'm1', taxpayer: MUK.m1, periodLabel: '2026/08', type: 'KDV_191', status: 'COMPLETED', isLocked: true, createdAt: gun(-3), maliyetUsd: 0.0122,
    _count: { kdvRecords: 64, images: 63 }, matchSummary: { matched: 63, reviewTotal: 0, amountMismatch: 0, unmatched: 1, rejected: 0, totalResults: 64 } },
  { id: 'ks4', taxpayerId: 'm4', taxpayer: MUK.m4, periodLabel: '2026/08', type: 'KDV_391', status: 'ACTIVE', isLocked: false, createdAt: gun(-4), maliyetUsd: 0,
    _count: { kdvRecords: 27, images: 25 }, matchSummary: { matched: 21, reviewTotal: 3, amountMismatch: 2, unmatched: 3, rejected: 0, totalResults: 27 } },
  { id: 'ks5', taxpayerId: 'm3', taxpayer: MUK.m3, periodLabel: '2026/08', type: 'ISLETME_GIDER', status: 'ACTIVE', isLocked: false, createdAt: gun(-5), maliyetUsd: 0.0034,
    _count: { kdvRecords: 12, images: 9 }, matchSummary: null },
  { id: 'ks6', taxpayerId: 'm5', taxpayer: MUK.m5, periodLabel: '2026/07', type: 'KDV_191', status: 'COMPLETED', isLocked: true, createdAt: gun(-33), maliyetUsd: 0.0208,
    _count: { kdvRecords: 88, images: 88 }, matchSummary: { matched: 88, reviewTotal: 0, amountMismatch: 0, unmatched: 0, rejected: 0, totalResults: 88 } },
  { id: 'ks7', taxpayerId: 'm6', taxpayer: MUK.m6, periodLabel: '2026/07', type: 'KDV_391', status: 'ACTIVE', isLocked: false, createdAt: gun(-34), maliyetUsd: 0,
    _count: { kdvRecords: 0, images: 0 }, matchSummary: null },
];
const KDV_CIKTILAR = [
  { id: 'ko1', mukellefName: 'Balçık İnşaat A.Ş.', donem: '2026/08', tip: 'KDV_391', createdAt: gun(-2), filename: 'Balcik-Insaat-2026-08-KDV_391.xlsx', matchedCount: 18, partialCount: 0, unmatchedCount: 0 },
  { id: 'ko2', mukellefName: 'Famcoffee Kahve A.Ş.', donem: '2026/07', tip: 'KDV_191', createdAt: gun(-33), filename: 'Famcoffee-2026-07-KDV_191.xlsx', matchedCount: 88, partialCount: 0, unmatchedCount: 0 },
  { id: 'ko3', mukellefName: 'Yavuz Nakliyat Ltd. Şti.', donem: '2026/06', tip: 'KDV_191', createdAt: gun(-60), filename: 'Yavuz-Nakliyat-2026-06-KDV_191.xlsx', matchedCount: 40, partialCount: 2, unmatchedCount: 1 },
];
const KDV_STATS = {
  ks1: {
    totalRecords: 42, totalImages: 39, matched: 31, needsReview: 3, partialMatch: 2, amountMismatch: 1, reviewTotal: 6, rejected: 1, mismatch: 0,
    unmatched: 4, lucaOnlyMissing: 3, imageOnlyMissing: 1, otherUnmatched: 0, needsOcrConfirm: 4,
    balance: { luca: { matched: 31, review: 6, rejected: 1 }, image: { matched: 31, review: 6, rejected: 1 } },
    ocrCost: { paidCalls: 12, cacheHits: 20, xmlParsed: 7, azureReads: 12, claudeEscalations: 2, actualCostUsd: 0.0184, estimatedSavedUsd: 0.041 },
    seriUyarilari: [
      { tip: 'seri_gap', mesaj: 'BLC2026 serisinde 000000412 → 000000415 arası 2 belge no atlanmış (413, 414).' },
      { tip: 'z_duplicate', mesaj: 'Z raporu 0087 iki kez kaydedilmiş (12.08 ve 13.08).' },
    ],
  },
};
const IMG = (i, o) => ({
  id: `img${i}`, originalName: o.name || `fatura-${String(i).padStart(3, '0')}.jpg`, ocrStatus: o.st || 'SUCCESS',
  ocrBelgeNo: o.no ?? `ABC2026000000${100 + i}`, ocrDate: o.tarih ?? `1${(i % 9) + 1}.08.2026`, ocrKdvTutari: o.kdv ?? `${(i * 137.4).toFixed(2).replace('.', ',')}`,
  ocrKdvTevkifat: o.tevkifat ?? null, ocrBelgeTipi: o.tip || 'e-Arşiv Fatura', ocrKdvBreakdown: o.breakdown ?? null, ocrValidationScore: o.val ?? 0.94,
  ocrBelgeNoConfidence: o.c1 ?? 0.97, ocrDateConfidence: o.c2 ?? 0.95, ocrKdvConfidence: o.c3 ?? 0.93, ocrEngine: o.engine || 'azure-read',
  confirmedBelgeNo: o.confNo ?? null, confirmedDate: null, confirmedKdvTutari: null, confirmedKdvTevkifat: null, confirmedKdvBreakdown: null,
  isManuallyConfirmed: !!o.confirmed,
  contentAuditStatus: o.audit ? 'DONE' : null, contentAuditRisk: o.audit || null, contentAuditSummary: o.ozet || null, contentAuditSuggestion: o.oneri || null,
  contentAuditConfidence: o.audit ? 0.88 : null, contentAuditModel: o.model || (o.audit ? 'claude-haiku' : null), contentAuditFindings: [],
});
const KDV_GORSELLER = [
  IMG(1, { st: 'NEEDS_REVIEW', c1: 0.62, c2: 0.9, c3: 0.55, val: 0.61, name: 'ARC2026000000731.jpg', no: 'ARC2026000000731', kdv: '1.240,00', audit: 'KONTROL_ET', ozet: 'Kalem: 3 adet klima (25.000 TL) — inşaat faaliyetinde demirbaş olabilir.', oneri: 'Demirbaş kaydı ve amortisman kontrol edilmeli.' }),
  IMG(2, { st: 'LOW_CONFIDENCE', c1: 0.41, c2: 0.52, c3: 0.38, val: 0.4, name: 'fis-0088.jpg', no: null, kdv: '', tip: 'ÖKC Fişi', engine: 'azure-read', audit: 'RISKLI', ozet: 'Restoran fişi, hafta sonu tarihli; faaliyetle ilişkisi kurulamadı.', oneri: 'Kanunen kabul edilmeyen gider olarak ayrılmalı.' }),
  IMG(3, { st: 'NEEDS_REVIEW', c1: 0.88, c2: 0.66, c3: 0.9, val: 0.72, tevkifat: '2.160,00', kdv: '3.240,00', name: 'YMM2026000001042.pdf', no: 'YMM2026000001042', audit: 'UYGUN', ozet: 'Taşeron hakedişi, 4/10 tevkifat uygulanmış.' }),
  IMG(4, { st: 'FAILED', c1: null, c2: null, c3: null, val: 0.1, name: 'IMG_2026_0811.jpg', no: null, kdv: '', tarih: '', engine: 'claude-vision', audit: null }),
  IMG(5, { st: 'SUCCESS', breakdown: [{ oran: 20, tutar: 812.5, matrah: 4062.5 }, { oran: 10, tutar: 145, matrah: 1450 }], name: 'z-raporu-0087.jpg', no: 'Z0087', kdv: '957,50', tip: 'Z Raporu', audit: 'UYGUN', ozet: 'Günlük Z raporu; oranlar tutarlı.' }),
  IMG(6, { st: 'SUCCESS', engine: 'cache', audit: 'UYGUN', ozet: 'Şantiye elektrik faturası; faaliyetle uyumlu.' }),
  IMG(7, { st: 'SUCCESS', engine: 'xml', audit: 'UYGUN', ozet: 'Demir-çelik alımı; inşaat faaliyetiyle uyumlu.', model: 'rule-based' }),
  IMG(8, { st: 'SUCCESS', confirmed: true, confNo: 'GIB2026000000118', engine: 'azure-read', audit: 'UYGUN', ozet: 'Akaryakıt; araç bakım kuralı uygulanmadı.' }),
  IMG(9, { st: 'SUCCESS', confirmed: true, confNo: 'GIB2026000000119', engine: 'claude-vision', audit: 'KONTROL_ET', ozet: 'Ofis mobilyası 18.500 TL — demirbaş sınırı üstünde.', oneri: 'Demirbaş olarak kaydedilmeli.', model: 'rule-fallback' }),
  IMG(10, { st: 'PROCESSING', c1: null, c2: null, c3: null, no: null, kdv: '', tarih: '' }),
];
const KDV_SONUCLAR = [
  { id: 'r1', status: 'NEEDS_REVIEW', matchScore: 0.71, mismatchReasons: ['Tarih farkı (1 gün)', 'KDV 12,40 ₺ fark'],
    kdvRecord: { belgeNo: 'ARC2026000000731', belgeDate: iso(2026, 8, 12), kdvTutari: '1252.40', kdvOrani: 20 },
    image: { id: 'img1', originalName: 'ARC2026000000731.jpg', ocrBelgeNo: 'ARC2026000000731', ocrDate: '11.08.2026', ocrKdvTutari: '1.240,00' } },
  { id: 'r2', status: 'PARTIAL_MATCH', matchScore: 0.83, mismatchReasons: ['Belge no kısmi eşleşti'],
    kdvRecord: { belgeNo: 'YMM2026000001042', belgeDate: iso(2026, 8, 14), kdvTutari: '3240.00', kdvOrani: 20 },
    image: { id: 'img3', originalName: 'YMM2026000001042.pdf', ocrBelgeNo: 'YMM2026000001O42', ocrDate: '14.08.2026', ocrKdvTutari: '3.240,00', ocrKdvTevkifat: '2.160,00' } },
  { id: 'r3', status: 'NEEDS_REVIEW', matchScore: 0.64, mismatchReasons: ['Tutar farkı'],
    kdvRecord: { belgeNo: 'Z0087', belgeDate: iso(2026, 8, 13), kdvTutari: '960.00', kdvOrani: 20 },
    image: { id: 'img5', originalName: 'z-raporu-0087.jpg', ocrBelgeNo: 'Z0087', ocrDate: '13.08.2026', ocrKdvTutari: '957,50', ocrKdvBreakdown: [{ oran: 20, tutar: 812.5 }, { oran: 10, tutar: 145 }] } },
  ...Array.from({ length: 31 }, (_, i) => ({ id: `rm${i}`, status: 'MATCHED', matchScore: 1, mismatchReasons: [] })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `ru${i}`, status: 'UNMATCHED', matchScore: 0, mismatchReasons: ['Karşılık yok'] })),
];
const FATURA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="820" viewBox="0 0 620 820"><rect width="620" height="820" fill="#fff"/><rect x="40" y="40" width="540" height="740" fill="none" stroke="#cbd5e1" stroke-width="2"/><text x="70" y="100" font-family="Arial" font-size="26" font-weight="700" fill="#0f172a">e-ARŞİV FATURA</text><text x="70" y="140" font-family="Arial" font-size="14" fill="#475569">Balçık İnşaat A.Ş. · VKN 1400032109</text><text x="70" y="165" font-family="Arial" font-size="14" fill="#475569">Fatura No: ARC2026000000731 · Tarih: 11.08.2026</text><line x1="70" y1="200" x2="550" y2="200" stroke="#e2e8f0"/><g font-family="Arial" font-size="13" fill="#1e293b"><text x="70" y="240">1. Klima 12000 BTU × 3</text><text x="470" y="240" text-anchor="end">6.200,00</text><text x="70" y="270">2. Montaj hizmeti</text><text x="470" y="270" text-anchor="end">1.200,00</text><text x="70" y="300">3. Nakliye</text><text x="470" y="300" text-anchor="end">400,00</text></g><line x1="70" y1="330" x2="550" y2="330" stroke="#e2e8f0"/><g font-family="Arial" font-size="14" fill="#0f172a"><text x="330" y="370">Matrah</text><text x="550" y="370" text-anchor="end">6.200,00</text><text x="330" y="400">KDV %20</text><text x="550" y="400" text-anchor="end">1.240,00</text><text x="330" y="440" font-weight="700">Genel Toplam</text><text x="550" y="440" text-anchor="end" font-weight="700">7.440,00</text></g></svg>`;

function kdvKontrolUclari(yol, yontem, q, govde, jsonGonder, res) {
  if (yol === '/sahte/fatura.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(FATURA_SVG); return true; }
  if (yol === '/kdv-control/sessions' && yontem === 'GET') return jsonGonder(res, 200, KDV_SEANSLAR);
  if (yol === '/kdv-control/sessions/find-or-create' && yontem === 'POST') {
    const s = KDV_SEANSLAR.find((x) => x.taxpayerId === govde.taxpayerId && x.periodLabel === govde.periodLabel && x.type === govde.type) || KDV_SEANSLAR[0];
    return jsonGonder(res, 200, { session: s, created: false });
  }
  if (yol === '/kdv-control/outputs' && yontem === 'GET') return jsonGonder(res, 200, KDV_CIKTILAR);
  const m = /^\/kdv-control\/sessions\/([^/]+)\/(stats|results|images|records)$/.exec(yol);
  if (m && yontem === 'GET') {
    const [, id, alt] = m;
    if (alt === 'stats') return jsonGonder(res, 200, KDV_STATS[id] || { totalRecords: 0, totalImages: 0, matched: 0, needsReview: 0, partialMatch: 0, amountMismatch: 0, unmatched: 0, rejected: 0, needsOcrConfirm: 0 });
    if (alt === 'results') return jsonGonder(res, 200, id === 'ks1' ? KDV_SONUCLAR : []);
    if (alt === 'images') return jsonGonder(res, 200, id === 'ks1' ? KDV_GORSELLER : []);
    return jsonGonder(res, 200, []);
  }
  if (/^\/kdv-control\/images\/[^/]+\/download$/.test(yol)) return jsonGonder(res, 200, { url: `http://localhost:${process.env.PORT || 3006}/api/v1/sahte/fatura.svg` });
  if (yol.startsWith('/kdv-control/') && yontem !== 'GET') return jsonGonder(res, 200, { ok: true, session: KDV_SEANSLAR[0], jobId: null });
  if (yol === '/agent/me/token') return jsonGonder(res, 200, { token: 'sahte-ajan' });
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// KDV DURUM PANOSU (kdv-beyanname)
// ─────────────────────────────────────────────────────────────────────────────
const PANO_SATIR = (m, o) => ({
  mukellefId: m.id, ad: ad(m), faturaAdet: o.f, hesaplananKdv: o.h, indirilecekKdv: o.i, devredenKdv: o.d, odenecekKdv: Math.max(0, o.h - o.i - o.d),
  sonrakiAyaDevreden: Math.max(0, o.i + o.d - o.h), veriGuveniPuan: o.p, veriGuveniSeviye: o.p >= 90 ? 'kesin' : o.p >= 60 ? 'kontrol_gerekli' : 'eksik',
  durum: o.f === 0 ? 'bos' : o.p >= 90 ? 'hazir' : 'eksik', kdv1Var: o.f > 0, kdv1Verildi: !!o.v1, kdv2Var: !!o.t, kdv2TevkifatTutari: o.t || 0, kdv2FaturaAdet: o.t ? 2 : 0, kdv2Verildi: !!o.v2,
});
function genelBakis(donem) {
  const satirlar = [
    PANO_SATIR(MUK.m7, { f: 81, h: 96420.15, i: 61218.4, d: 0, p: 96, t: 2160, v1: false, v2: false }),
    PANO_SATIR(MUK.m1, { f: 64, h: 41250.8, i: 52310.2, d: 3840, p: 92, v1: true }),
    PANO_SATIR(MUK.m4, { f: 27, h: 18640, i: 9120.5, d: 0, p: 74, t: 480 }),
    PANO_SATIR(MUK.m5, { f: 88, h: 120400, i: 84210.9, d: 12500, p: 95, v1: true, v2: false }),
    PANO_SATIR(MUK.m3, { f: 12, h: 4200, i: 3980, d: 0, p: 58 }),
    PANO_SATIR(MUK.m6, { f: 0, h: 0, i: 0, d: 6120, p: 0 }),
    PANO_SATIR(MUK.m2, { f: 9, h: 2680, i: 1120, d: 0, p: 91, v1: true }),
    PANO_SATIR(MUK.m8, { f: 14, h: 5310.4, i: 7420.1, d: 0, p: 88 }),
  ];
  const toplamOdenecek = satirlar.reduce((s, r) => s + r.odenecekKdv, 0);
  const toplamDevreden = satirlar.reduce((s, r) => s + r.sonrakiAyaDevreden, 0);
  return {
    donem, hesaplandiAt: saat(-1),
    toplam: {
      mukellefAdet: satirlar.length, hazirAdet: satirlar.filter((r) => r.durum === 'hazir').length, dikkatAdet: satirlar.filter((r) => r.durum !== 'hazir').length,
      toplamOdenecek, toplamDevreden, kdv2Adet: satirlar.filter((r) => r.kdv2Var).length,
      kdv1VerilmeyenAdet: satirlar.filter((r) => r.kdv1Var && !r.kdv1Verildi).length, kdv2VerilmeyenAdet: satirlar.filter((r) => r.kdv2Var && !r.kdv2Verildi).length,
    },
    satirlar,
  };
}
function kdv1(mukellefId, donem) {
  const m = MUK[mukellefId] || MUK.m7;
  return {
    mukellefId: m.id, mukellefAd: ad(m), donem,
    satis: { oranlar: [{ oran: 20, matrah: 402300.5, kdv: 80460.1, adet: 61 }, { oran: 10, matrah: 118900, kdv: 11890, adet: 14 }, { oran: 1, matrah: 407000, kdv: 4070.05, adet: 6 }], toplamMatrah: 928200.5, toplamHesaplananKdv: 96420.15, faturaAdet: 81, oranBelirsizKdv: 0, oranBelirsizAdet: 0 },
    alis: {
      oranlar: [{ oran: 20, matrah: 261000, kdv: 52200, adet: 29 }, { oran: 10, matrah: 74184, kdv: 7418.4, adet: 8 }], toplamMatrah: 335184, toplamIndirilecekKdv: 61218.4, faturaAdet: 39,
      tevkifatsiz: { matrah: 318984, kdv: 57978.4, adet: 37 }, tevkifatli: { matrah: 16200, kdv: 3240, adet: 2 }, oranBelirsizKdv: 1600, oranBelirsizAdet: 2,
    },
    devreden: { tutar: 0, kaynak: 'beyanname_pdf', sonKayitDonem: '2026-07' },
    sonuc: { hesaplananKdv: 96420.15, indirilecekKdv: 61218.4, devredenKdv: 0, odenecekKdv: 35201.75, sonrakiAyaDevreden: 0 },
    lucaKontrol: { mizanVar: true, luca391Bakiye: 96420.15, luca191Bakiye: 61230.9, luca190Bakiye: 0, fark391: 0, fark191: -12.5, uyarilar: ['191 hesabında Luca ile 12,50 ₺ fark var.'] },
    kaliteRapor: { ocrliFaturaOrani: 0.91, tahminFaturaOrani: 0.04, uyarilar: [] },
    eksikVeriler: [
      { tur: 'oran', seviye: 'uyari', belgeNo: 'ARC2026000000731', taraf: 'alis', mesaj: 'KDV oranı OCR ile okunamadı; matrahtan %20 türetildi.', aksiyon: 'Teyit panelinden doğrula' },
      { tur: 'tevkifat', seviye: 'kritik', belgeNo: 'YMM2026000001042', taraf: 'alis', mesaj: 'Tevkifat kodu belirsiz (4/10 varsayıldı).', aksiyon: 'KDV2 için kod seç' },
      { tur: 'bilgi', seviye: 'bilgi', belgeNo: null, mesaj: '2 belge Luca satırından alındı (görsel yok).' },
    ],
    veriGuveni: { seviye: 'kesin', puan: 96, kesinFaturaAdet: 116, toplamFaturaAdet: 120, kontrolGerekliAdet: 4, lucaMizanVar: true },
  };
}
function kdv2(mukellefId, donem) {
  const m = MUK[mukellefId] || MUK.m7;
  return {
    mukellefId: m.id, mukellefAd: ad(m), donem,
    tevkifatli: [
      { belgeNo: 'YMM2026000001042', satici: 'Yılmaz Müh. Müş. Ltd. Şti.', saticiVkn: '9870012345', tarih: '14.08.2026', matrah: 16200, hesaplananKdv: 3240, tevkifatOrani: '4/10', tevkifatKodu: '610', tevkifatTutari: 1296, kaynak: 'ocr' },
      { belgeNo: 'TMZ2026000000318', satici: 'Temizlik Hizmetleri A.Ş.', saticiVkn: '8400011122', tarih: '20.08.2026', matrah: 4320, hesaplananKdv: 864, tevkifatOrani: '9/10', tevkifatKodu: '608', tevkifatTutari: 777.6, kaynak: 'ocr' },
      { belgeNo: 'GUV2026000000077', satici: 'Kale Güvenlik Ltd. Şti.', saticiVkn: '5200099887', tarih: '25.08.2026', matrah: 2400, hesaplananKdv: 480, tevkifatOrani: '9/10', tevkifatKodu: 'KOD_YOK', tevkifatTutari: 86.4, kaynak: 'ocr_eksik' },
    ],
    toplamlar: { faturaAdet: 3, toplamMatrah: 22920, toplamHesaplananKdv: 4584, toplamTevkifat: 2160 },
    tevkifatKodlari: [{ kod: '610', matrah: 16200, tevkifat: 1296, adet: 1 }, { kod: '608', matrah: 6720, tevkifat: 864, adet: 2 }],
    uyarilar: ['GUV2026000000077 için tevkifat kodu okunamadı; 9/10 oranı varsayıldı.'],
    eksikVeriler: [{ tur: 'kod', seviye: 'uyari', belgeNo: 'GUV2026000000077', mesaj: 'Tevkifat kodu eksik.', aksiyon: 'Kodu seç' }],
    veriGuveni: { seviye: 'kontrol_gerekli', puan: 78, kesinFaturaAdet: 2, toplamFaturaAdet: 3, kontrolGerekliAdet: 1, lucaMizanVar: true },
  };
}
function kdvBeyannameUclari(yol, yontem, q, govde, jsonGonder, res) {
  if (yol === '/kdv-beyanname/genel-bakis') return jsonGonder(res, 200, genelBakis(q.donem || '2026-08'));
  if (yol === '/beyanname-takip/configs' && yontem === 'GET') return jsonGonder(res, 200, []);
  if (yol === '/kdv-beyanname/on-hazirlik/kdv1') return jsonGonder(res, 200, kdv1(q.mukellefId, q.donem || '2026-08'));
  if (yol === '/kdv-beyanname/on-hazirlik/kdv2') return jsonGonder(res, 200, kdv2(q.mukellefId, q.donem || '2026-08'));
  if (yol === '/kdv-beyanname/luca-snapshot' && yontem === 'GET') {
    return jsonGonder(res, 200, {
      exists: true, cekildiAt: saat(-5), toplamHesapAdet: 412,
      kdvSatirlari: [
        { kod: '191', ad: 'İNDİRİLECEK KDV', borcToplami: 61230.9, alacakToplami: 0, borcBakiye: 61230.9, alacakBakiye: 0 },
        { kod: '191.01', ad: 'İNDİRİLECEK KDV %20', borcToplami: 52200, alacakToplami: 0, borcBakiye: 52200, alacakBakiye: 0 },
        { kod: '191.02', ad: 'İNDİRİLECEK KDV %10', borcToplami: 7430.9, alacakToplami: 0, borcBakiye: 7430.9, alacakBakiye: 0 },
        { kod: '191.03', ad: 'TEVKİFATLI ALIŞ KDV', borcToplami: 1600, alacakToplami: 0, borcBakiye: 1600, alacakBakiye: 0 },
        { kod: '391', ad: 'HESAPLANAN KDV', borcToplami: 0, alacakToplami: 96420.15, borcBakiye: 0, alacakBakiye: 96420.15 },
        { kod: '190', ad: 'DEVREDEN KDV', borcToplami: 0, alacakToplami: 0, borcBakiye: 0, alacakBakiye: 0 },
      ],
    });
  }
  if (yol.startsWith('/kdv-beyanname/') && yontem !== 'GET') return jsonGonder(res, 200, { ok: true, kdv2Adet: 2, bildirimAdet: 1, verilmeyenAdet: 2 });
  if (yol === '/kdv-beyanname/xlsx') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end('sahte'); return true; }
  if (yol.startsWith('/beyanname-takip/durum/') && (yontem === 'PUT' || yontem === 'PATCH')) return jsonGonder(res, 200, { ok: true });
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// PORTAL OTOMASYON (e-Tebligat, SGK, Toplu Beyanname özeti)
// ─────────────────────────────────────────────────────────────────────────────
const ILETIM_OK = [{ channel: 'WHATSAPP', status: 'SENT', sentAt: gun(-2), error: null, testMode: false }, { channel: 'EMAIL', status: 'SENT', sentAt: gun(-2), error: null, testMode: false }];
const ILETIM_HATA = [{ channel: 'WHATSAPP', status: 'FAILED', sentAt: null, error: 'Numara kayıtlı değil', testMode: false }];
const ILETIM_SIRA = [{ channel: 'WHATSAPP', status: 'PENDING', sentAt: null, error: null, testMode: true }];
const TEB = (i, m, o) => ({
  id: `teb${i}`, taxpayerId: m.id, taxpayer: m, belgeTuru: 'E_TEBLIGAT', title: o.tur, referenceNo: `2026-TB-${String(400 + i).padStart(6, '0')}`, period: null,
  issuedAt: gun(-o.g), receivedAt: gun(-o.g + 5), createdAt: gun(-o.g), pdfVar: o.pdf !== false, viewedAt: o.viewed ? gun(-o.g + 1) : null,
  ozet: { kurumAciklama: o.kurum, altKurum: o.alt || null, gonderimZamani: gun(-o.g), tebligZamani: gun(-o.g + 5), tebligTarihi: gun(-o.g + 5), tebligDurumu: o.durum || (o.g >= 5 ? 'edildi' : 'yaklasiyor') },
  iletim: o.iletim || [],
});
const TEBLIGATLAR = [
  TEB(1, MUK.m7, { tur: 'Vergi/Ceza İhbarnamesi', kurum: 'Büyükçekmece Vergi Dairesi', g: 3, iletim: ILETIM_OK }),
  TEB(2, MUK.m1, { tur: 'Ödeme Emri', kurum: 'Beylikdüzü Vergi Dairesi', g: 1, iletim: ILETIM_SIRA }),
  TEB(3, MUK.m4, { tur: 'Yoklama Fişi', kurum: 'Avcılar Vergi Dairesi', alt: 'Yoklama Servisi', g: 4, iletim: ILETIM_HATA }),
  TEB(4, MUK.m5, { tur: 'Bilgi İsteme Yazısı', kurum: 'İstanbul Vergi Dairesi Başkanlığı', alt: 'Denetim Grup Müdürlüğü', g: 9, viewed: true, iletim: ILETIM_OK }),
  TEB(5, MUK.m2, { tur: 'Vergi/Ceza İhbarnamesi', kurum: 'Büyükçekmece Vergi Dairesi', g: 12, viewed: true, iletim: ILETIM_OK }),
  TEB(6, MUK.m3, { tur: 'Tebliğ Zarfı', kurum: 'Esenyurt Vergi Dairesi', g: 2, pdf: false }),
  TEB(7, MUK.m6, { tur: 'Ödeme Emri', kurum: 'Beylikdüzü Vergi Dairesi', g: 20, viewed: true, iletim: ILETIM_OK }),
  TEB(8, MUK.m8, { tur: 'Mükellefiyet Yazısı', kurum: 'Bakırköy Vergi Dairesi', g: 26, viewed: true }),
];
const SGK = (i, m, o) => ({
  id: `sgkt${i}`, taxpayerId: m.id, taxpayer: m, belgeTuru: 'SGK_TAHAKKUK', title: `Tahakkuk Fişi ${o.donem}`, referenceNo: `THK-${o.donem.replace('/', '-')}-${i}`, period: o.donem,
  issuedAt: gun(-o.g), receivedAt: gun(-o.g), createdAt: gun(-o.g), pdfVar: true, viewedAt: o.viewed ? gun(-o.g + 1) : null,
  ozet: { kanunNo: o.kanun || '05510', calisan: o.c, tutar: o.t, mahiyet: o.mahiyet || 'ASIL' }, iletim: o.iletim || [],
  hizmet: o.hizmet === false ? null : { id: `sgkh${i}`, pdfVar: o.hizmetPdf !== false, viewedAt: o.hizmetViewed ? gun(-o.g + 1) : null },
  tahakkuk: { id: `sgkt${i}`, pdfVar: true, viewedAt: o.viewed ? gun(-o.g + 1) : null, tutar: o.t },
});
const SGK_KAYITLAR = [
  SGK(1, MUK.m7, { donem: '2026/08', g: 10, c: 12, t: 48320.15, iletim: ILETIM_OK }),
  SGK(2, MUK.m1, { donem: '2026/08', g: 10, c: 7, t: 26140.4, hizmetViewed: true, iletim: ILETIM_OK }),
  SGK(3, MUK.m4, { donem: '2026/08', g: 9, c: 3, t: 11020.9, mahiyet: 'EK', iletim: ILETIM_SIRA }),
  SGK(4, MUK.m5, { donem: '2026/08', g: 9, c: 21, t: 88410.3, viewed: true, hizmetViewed: true, iletim: ILETIM_OK }),
  SGK(5, MUK.m6, { donem: '2026/08', g: 8, c: 4, t: 15200, mahiyet: 'İPTAL', hizmet: false, iletim: ILETIM_HATA }),
  SGK(6, MUK.m3, { donem: '2026/07', g: 40, c: 2, t: 7320.55, viewed: true, hizmetViewed: true, kanun: '06111', iletim: ILETIM_OK }),
  SGK(7, MUK.m7, { donem: '2026/07', g: 41, c: 12, t: 47990.2, viewed: true, hizmetViewed: true, iletim: ILETIM_OK }),
  SGK(8, MUK.m2, { donem: '2026/07', g: 41, c: 1, t: 3840, viewed: true, hizmetPdf: false, iletim: [] }),
];
const ISLER = [
  { id: 'pj1', tenantId: 't1', taxpayerId: null, jobType: 'EBEYANNAME_DAILY_DOWNLOAD', status: 'done', source: 'manual', periodStart: gun(-3), periodEnd: gun(0), donem: null, payload: {}, result: { progress: { current: 6, total: 6 } }, errorMessage: null, recordCount: 6, createdAt: saat(-3), startedAt: saat(-3), finishedAt: saat(-2.8) },
  { id: 'pj2', tenantId: 't1', taxpayerId: 'm7', jobType: 'E_TEBLIGAT_CHECK', status: 'running', source: 'nightly', periodStart: null, periodEnd: null, donem: null, payload: {}, result: { progress: { current: 3, total: 8, message: 'Balçık İnşaat sorgulanıyor' } }, errorMessage: null, recordCount: 0, createdAt: saat(-0.2), startedAt: saat(-0.1), finishedAt: null },
];
const OZET = () => ({
  nightly: { active: true, time: '03:00', timezone: 'Europe/Istanbul', declarationRange: { start: gun(-3).slice(0, 10), end: gun(0).slice(0, 10) } },
  runner: { enabled: true, includeNightly: true, deviceId: 'ofis-pc-1', jobTypes: ['EBEYANNAME_DAILY_DOWNLOAD', 'E_TEBLIGAT_CHECK', 'SGK_TAHAKKUK', 'SGK_HIZMET_LISTESI'] },
  stats: {
    activeJobs: 1, failed24h: 1, done24h: 9, docs7d: 14, tebligat7d: 4, tebligatTotal: 2714, tebligatErrorCount: 1,
    tebligatErrors: [{ taxpayerId: 'm6', name: ad(MUK.m6), taxNumber: MUK.m6.taxNumber, reason: 'Şifre hatalı', hata: { tur: 'sifre', metin: 'Vergi dairesi şifresi hatalı; mükellef kartından güncelleyin.', ham: 'HTTP 401 login failed' } }],
    tebligatBuHaftaTeblig: 2, sgkTotal: 690, sgkErrorCount: 0, sgkErrors: [],
  },
  credentials: { eBeyannameReady: true, eTebligatTaxpayerCount: 77, sgkTaxpayerCount: 54, byProvider: { GIB_EBEYANNAME: { total: 1, active: 1 }, GIB_IVD: { total: 77, active: 76 }, SGK_EBILDIRGE: { total: 54, active: 54 } } },
  latestJobs: ISLER, latestDocuments: [],
  credentialsBlocked: [{ provider: 'GIB_IVD', taxpayerId: 'm8', ad: ad(MUK.m8), taxNumber: MUK.m8.taxNumber, since: gun(-3), hata: { tur: 'sifre', metin: '3 gece üst üste şifre hatası.', ham: 'login 401' }, geceSayisi: 3 }],
});
function mukellefListesi(rows, sifreli) {
  const sayac = new Map();
  for (const r of rows) sayac.set(r.taxpayerId, (sayac.get(r.taxpayerId) || 0) + 1);
  return { rows: Object.values(MUK).map((m) => ({ id: m.id, ad: ad(m), taxNumber: m.taxNumber, belgeSayisi: sayac.get(m.id) || 0, sifreVar: sifreli.includes(m.id), sifreHatasi: m.id === 'm6' ? 'Şifre hatalı' : null })) };
}
function portalOtomasyonUclari(yol, yontem, q, govde, jsonGonder, res) {
  if (yol === '/portal-automation/summary') return jsonGonder(res, 200, OZET());
  if (yol === '/portal-automation/jobs') return jsonGonder(res, 200, ISLER);
  if (yol === '/portal-automation/documents/mukellefler') {
    const sgk = String(q.belgeTuru || '').includes('SGK');
    return jsonGonder(res, 200, mukellefListesi(sgk ? SGK_KAYITLAR : TEBLIGATLAR, sgk ? ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'] : ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']));
  }
  if (yol === '/portal-automation/documents/sayfa') {
    const sgk = String(q.belgeTuru || '').includes('SGK');
    let rows = sgk ? SGK_KAYITLAR : TEBLIGATLAR;
    if (q.taxpayerId) rows = rows.filter((r) => r.taxpayerId === q.taxpayerId);
    if (q.period) rows = rows.filter((r) => r.period === q.period);
    if (q.search) { const s = String(q.search).toLocaleLowerCase('tr-TR'); rows = rows.filter((r) => JSON.stringify(r).toLocaleLowerCase('tr-TR').includes(s)); }
    if (!sgk && q.durum === 'goruntulenmemis') rows = rows.filter((r) => !r.viewedAt);
    if (!sgk && q.durum === 'teblig_yaklasan') rows = rows.filter((r) => r.ozet.tebligDurumu === 'yaklasiyor');
    if (!sgk && q.durum === 'teblig_edildi') rows = rows.filter((r) => r.ozet.tebligDurumu === 'edildi');
    if (sgk && q.durum === 'hizmet') rows = rows.filter((r) => r.hizmet);
    if (sgk && q.durum === 'tahakkuk') rows = rows.filter((r) => r.tahakkuk);
    const page = Number(q.page || 1), pageSize = Number(q.pageSize || 50);
    return jsonGonder(res, 200, { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize });
  }
  if (yol === '/portal-automation/documents/mark-viewed' && yontem === 'POST') {
    const ids = new Set(govde.ids || []);
    for (const r of [...TEBLIGATLAR, ...SGK_KAYITLAR]) {
      if (ids.has(r.id)) r.viewedAt = new Date().toISOString();
      if (r.hizmet && ids.has(r.hizmet.id)) r.hizmet.viewedAt = new Date().toISOString();
      if (r.tahakkuk && ids.has(r.tahakkuk.id)) r.tahakkuk.viewedAt = new Date().toISOString();
    }
    return jsonGonder(res, 200, { updated: ids.size, viewedAt: new Date().toISOString() });
  }
  if (yol === '/portal-automation/manual-run' && yontem === 'POST') return jsonGonder(res, 200, { created: [ISLER[1]], skipped: [], message: 'Sorgu kuyruğa alındı.' });
  if (/^\/portal-automation\/jobs\/[^/]+\/cancel$/.test(yol) && yontem === 'POST') return jsonGonder(res, 200, { ...ISLER[1], status: 'cancelled' });
  if (yol === '/akilli-bildirim/settings' || yol === '/akilli-bildirim/ayarlar') return jsonGonder(res, 200, { VERGI: { testMode: false } });
  return false;
}

function uclar(yol, yontem, q, govde, jsonGonder, res) {
  if (kdvKontrolUclari(yol, yontem, q, govde, jsonGonder, res) !== false) return true;
  if (kdvBeyannameUclari(yol, yontem, q, govde, jsonGonder, res) !== false) return true;
  if (portalOtomasyonUclari(yol, yontem, q, govde, jsonGonder, res) !== false) return true;
  return false;
}
module.exports = { uclar };
