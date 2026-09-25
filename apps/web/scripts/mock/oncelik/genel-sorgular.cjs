// Genel Sorgulamalar — ÖNCELİKLİ sahte veri eklentisi (2026-09-22). Yerleşik /genel-sorgular uçlarını ezer.
//   GET  /genel-sorgular · GET /genel-sorgular/ozet · GET /genel-sorgular/guncel
//   POST /portal-automation/dvd-sorgu · GET /portal-automation/jobs
//   GET  /portal-automation/credentials · GET /taxpayers · GET /portal-automation/documents/:id/view · GET /sahte/tutanak.pdf
// Veri şekilleri: packages/shared/src/constants/genel-sorgu-veri.ts (canlı keşif değerleri: EDELER YEMEK, SEDA İŞ GÜVENLİĞİ).
// Elle sorgu bellekte KUYRUĞA alınır ve zamanla ilerler (kuyrukta → çalışıyor → tamamlandı); bitince sonuç satırı eklenir.

const simdi = () => new Date();
const iso = (d) => new Date(d).toISOString();
/** bugün saat hh:mm (yerel) */
function bugun(hh, mm = 0) { const d = simdi(); d.setHours(hh, mm, 0, 0); return iso(d); }
function gunOnce(n, hh = 3, mm = 12) { const d = simdi(); d.setDate(d.getDate() - n); d.setHours(hh, mm, 0, 0); return iso(d); }
const p2 = (n) => Math.round(n * 100) / 100;

// ── Mükellefler (yerleşik 8 + keşiften 2) ────────────────────────────────────────
const MUKELLEFLER = [
  { id: 'gs1', type: 'COMPANY', companyName: 'EDELER YEMEK ÜRETİM SAN. LTD. ŞTİ.', firstName: null, lastName: null, taxNumber: '3241199696', status: 'active' },
  { id: 'gs2', type: 'COMPANY', companyName: 'SEDA İŞ GÜVENLİĞİ LTD. ŞTİ.', firstName: null, lastName: null, taxNumber: '7580412345', status: 'active' },
  { id: 'm1', type: 'COMPANY', companyName: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', firstName: null, lastName: null, taxNumber: '6420011234', status: 'active' },
  { id: 'm2', type: 'INDIVIDUAL', companyName: null, firstName: 'Erdoğan', lastName: 'Balçık', taxNumber: '14523698745', status: 'active' },
  { id: 'm3', type: 'INDIVIDUAL', companyName: null, firstName: 'Ayşegül', lastName: 'Kaya', taxNumber: '25874136982', status: 'active' },
  { id: 'm4', type: 'COMPANY', companyName: 'Mert Reklam Ajansı Ltd. Şti.', firstName: null, lastName: null, taxNumber: '6170045678', status: 'active' },
  { id: 'm5', type: 'COMPANY', companyName: 'Famcoffee Kahve A.Ş.', firstName: null, lastName: null, taxNumber: '3850098765', status: 'active' },
  { id: 'm6', type: 'COMPANY', companyName: 'Ela Tekstil Ltd. Şti.', firstName: null, lastName: null, taxNumber: '3250076543', status: 'active' },
  { id: 'm7', type: 'COMPANY', companyName: 'Balçık İnşaat A.Ş.', firstName: null, lastName: null, taxNumber: '1400032109', status: 'active' },
  { id: 'm8', type: 'INDIVIDUAL', companyName: null, firstName: 'Dilek', lastName: 'Bayageldi', taxNumber: '36985214778', status: 'active' },
];
const mukellef = (id) => MUKELLEFLER.find((m) => m.id === id) || null;
const ozet = (id) => { const m = mukellef(id); return m ? { id: m.id, companyName: m.companyName, firstName: m.firstName, lastName: m.lastName, taxNumber: m.taxNumber } : null; };
/** DVD (GIB_IVD) şifresi tanımlı mükellefler */
const SIFRELI = new Set(['gs1', 'gs2', 'm1', 'm2', 'm3', 'm4', 'm5', 'm7']);

// ── Vergi borcu — EDELER: 14 kalem, toplam 384.303,91 / vadesi geçmiş 379.614,21 ──────────
function kalem(vergiKodu, vergiTuru, donem, vade, asil, gz, gecmis = true, vd = 'BÜYÜKÇEKMECE', vdKodu = '034204') {
  return { vergiTuru: `${vergiKodu} ${vergiTuru}`, vergiKodu, donem, vadeTarihi: vade, asilBorc: asil, gecikmeZammi: gz, toplam: p2(asil + gz), vergiDairesi: vd, vergiDairesiKodu: vdKodu, belgeNo: null, vadesiGecmisMi: gecmis };
}
const KDV = 'GERÇEK USULDE KATMA DEĞER VERGİSİ';
const MUH = 'GELİR VERGİSİ STOPAJI (MUHTASAR)';
const KGV = 'KURUM GEÇİCİ VERGİSİ';
const EDELER_KALEMLER = [
  kalem('0015', KDV, '2026/01-2026/01', '2026-02-26', 48210.0, 8437.15),
  kalem('0015', KDV, '2026/02-2026/02', '2026-03-26', 41880.5, 6282.08),
  kalem('0015', KDV, '2026/03-2026/03', '2026-04-28', 39455.0, 4934.2),
  kalem('0015', KDV, '2026/04-2026/04', '2026-05-26', 44120.75, 4412.08),
  kalem('0015', KDV, '2026/05-2026/05', '2026-06-26', 37900.0, 2842.5),
  kalem('0015', KDV, '2026/06-2026/06', '2026-07-28', 35610.4, 1780.52),
  kalem('0015', KDV, '2026/07-2026/07', '2026-08-26', 33200.0, 830.0),
  kalem('0003', MUH, '2026/03-2026/03', '2026-04-26', 12480.0, 1560.0),
  kalem('0003', MUH, '2026/04-2026/04', '2026-05-26', 12480.0, 1248.0),
  kalem('0003', MUH, '2026/05-2026/05', '2026-06-26', 12480.0, 936.0),
  kalem('0003', MUH, '2026/06-2026/06', '2026-07-26', 12480.0, 624.0),
  kalem('0033', KGV, '2026/01-2026/03', '2026-05-17', 8150.0, 815.0),
  kalem('0033', KGV, '2025/10-2025/12', '2026-02-17', 5620.9, 845.13),
  kalem('0015', KDV, '2026/08-2026/08', '2026-09-26', 4689.7, 0, false),
];
function vergiBorcuVerisi(kalemler, hesaplamaZamani) {
  const gecmis = kalemler.filter((k) => k.vadesiGecmisMi);
  const gelmemis = kalemler.filter((k) => !k.vadesiGecmisMi);
  const topla = (l, a) => p2(l.reduce((s, k) => s + k[a], 0));
  const turler = new Map();
  for (const k of kalemler) {
    const t = turler.get(k.vergiKodu) || { vergiKodu: k.vergiKodu, vergiTuru: k.vergiTuru, toplam: 0, asilBorc: 0, gecikmeZammi: 0 };
    t.toplam = p2(t.toplam + k.toplam); t.asilBorc = p2(t.asilBorc + k.asilBorc); t.gecikmeZammi = p2(t.gecikmeZammi + k.gecikmeZammi);
    turler.set(k.vergiKodu, t);
  }
  return {
    vadesiGecmis: topla(gecmis, 'toplam'), vadesiGelmemis: topla(gelmemis, 'toplam'), toplam: topla(kalemler, 'toplam'),
    gecikmeZammiToplam: topla(kalemler, 'gecikmeZammi'), kalemSayisi: kalemler.length, kalemler, turOzeti: [...turler.values()], hesaplamaZamani,
  };
}

/** m2 Erdoğan Balçık borcu — EDELER'in muhtasar (0003) kalemlerinden türetildi; tamamı vadesi geçmiş. */
const BALCIK_KALEMLER = EDELER_KALEMLER.filter((k) => k.vergiKodu === '0003');

// ── e-Haciz — SEDA: 3 banka bildirisi (2 tatbik edilmiş) ──────────────────────────
const TATBIK = 'HACİZ TATBİK EDİLMİŞTİR';
const VARLIK_YOK = 'HACİZ TATBİK EDİLECEK VARLIK BULUNAMAMIŞTIR';
const SEDA_HACIZ = {
  bildiriSayisi: 3, tatbikEdilenSayisi: 2, toplamTutar: p2(113505.77 + 43509.54 + 16887.67),
  bildiriler: [
    { kapsam: 'BANKA', bildiriNo: '2026030412034294001', tutar: 113505.77, durum: TATBIK, vergiDairesiKodu: '034294', vergiDairesi: 'AVCILAR', borclar: [{ vergiTuru: '0015 KDV', vergiDonem: '2025/03-2025/06' }, { vergiTuru: '0003 MUHTASAR', vergiDonem: '2025/04-2025/06' }], hesaplar: [] },
    { kapsam: 'BANKA', bildiriNo: '2026051912034294007', tutar: 43509.54, durum: TATBIK, vergiDairesiKodu: '034294', vergiDairesi: 'AVCILAR', borclar: [{ vergiTuru: '0015 KDV', vergiDonem: '2025/07-2025/09' }], hesaplar: [] },
    { kapsam: 'BANKA', bildiriNo: '2026081112034294013', tutar: 16887.67, durum: VARLIK_YOK, vergiDairesiKodu: '034294', vergiDairesi: 'AVCILAR', borclar: [{ vergiTuru: '0033 KURUM GEÇİCİ', vergiDonem: '2025/10-2025/12' }], hesaplar: [] },
  ],
};

/** m3 Ayşegül Kaya haczi — SEDA'nın tatbik EDİLMEMİŞ bildirisinden türetildi (bildiri var, tatbik yok). */
const KAYA_HACIZ = { bildiriSayisi: 1, tatbikEdilenSayisi: 0, toplamTutar: SEDA_HACIZ.bildiriler[2].tutar, bildiriler: [SEDA_HACIZ.bildiriler[2]] };

// ── Yoklama / Denetim — SEDA: 4 yoklama (2025) ────────────────────────────────────
const SEDA_YOKLAMA = {
  yoklamaSayisi: 4, denetimSayisi: 0, sonYoklamaTarihi: '2025-09-26T12:32:16',
  yoklamalar: [
    { yoklamaKodu: 'YK2025092600471', tarih: '2025-09-26T12:32:16', vergiDairesi: 'AVCILAR (034294)', vergiDairesiKodu: '034294', yoklamaTuru: 'Nakil İşe Başlama Yoklaması', yoklamaTuruKodu: '12', pdfVarMi: true, pdfDocumentId: 'yk-pdf-1' },
    { yoklamaKodu: 'YK2025071400218', tarih: '2025-07-14T10:05:40', vergiDairesi: 'HALKALI (034268)', vergiDairesiKodu: '034268', yoklamaTuru: 'Adres Tespit Yoklaması', yoklamaTuruKodu: '07', pdfVarMi: true, pdfDocumentId: 'yk-pdf-2' },
    { yoklamaKodu: 'YK2025040300094', tarih: '2025-04-03T15:48:02', vergiDairesi: 'HALKALI (034268)', vergiDairesiKodu: '034268', yoklamaTuru: 'Genel Yoklama', yoklamaTuruKodu: '01', pdfVarMi: true, pdfDocumentId: 'yk-pdf-3' },
    { yoklamaKodu: 'YK2025011700012', tarih: '2025-01-17T09:20:11', vergiDairesi: 'BÜYÜKÇEKMECE (034204)', vergiDairesiKodu: '034204', yoklamaTuru: 'İşi Bırakma Yoklaması', yoklamaTuruKodu: '03', pdfVarMi: false, pdfDocumentId: null },
  ],
  denetimler: [],
};
const BALCIK_YOKLAMA = {
  yoklamaSayisi: 1, denetimSayisi: 1, sonYoklamaTarihi: '2026-03-11T11:14:30',
  yoklamalar: [{ yoklamaKodu: 'YK2026031100301', tarih: '2026-03-11T11:14:30', vergiDairesi: 'BÜYÜKÇEKMECE (034204)', vergiDairesiKodu: '034204', yoklamaTuru: 'Genel Yoklama', yoklamaTuruKodu: '01', pdfVarMi: true, pdfDocumentId: 'yk-pdf-4' }],
  denetimler: [{ belgeKodu: 'DN2026052200087', denetimAdi: 'Yaygın ve Yoğun Vergi Denetimi', denetimTuru: 'Belge Düzeni', tarih: '2026-05-22T14:02:00', sonuc: 'Usulsüzlük tespit edilmedi' }],
};

// ── POS — EDELER Temmuz 2026: VAKIFBANK 2 üye işyeri ─────────────────────────────
const EDELER_POS_07 = {
  yil: 2026, ay: 7, toplamTutar: p2(220179 + 3970), satirSayisi: 2,
  satirlar: [
    { kaynak: 'BANKA', unvan: 'VAKIFBANK', vkn: '9250006721', uyeIsyeriNo: '004586123', tutar: 220179.0 },
    { kaynak: 'BANKA', unvan: 'VAKIFBANK', vkn: '9250006721', uyeIsyeriNo: '004586124', tutar: 3970.0 },
  ],
};
const FAM_POS_07 = {
  yil: 2026, ay: 7, toplamTutar: p2(158420.6 + 92310.15 + 12480.0), satirSayisi: 3,
  satirlar: [
    { kaynak: 'BANKA', unvan: 'T. GARANTİ BANKASI A.Ş.', vkn: '3880033470', uyeIsyeriNo: '112345678', tutar: 158420.6 },
    { kaynak: 'BANKA', unvan: 'T.C. ZİRAAT BANKASI A.Ş.', vkn: '9980000000', uyeIsyeriNo: '223456789', tutar: 92310.15 },
    { kaynak: 'ODEME_KURULUSU', unvan: 'İYZİ ÖDEME VE ELEKTRONİK PARA HİZMETLERİ A.Ş.', vkn: '4830034859', uyeIsyeriNo: 'IYZ-778812', tutar: 12480.0 },
  ],
};
const FAM_POS_08 = { ...FAM_POS_07, ay: 8, toplamTutar: p2(171204.3 + 88650.0 + 9990.5), satirlar: FAM_POS_07.satirlar.map((s, i) => ({ ...s, tutar: [171204.3, 88650.0, 9990.5][i] })) };

// ── Gelen e-Arşiv — EDELER Ağustos 2026 (16) ve Eylül 2026 (11) ──────────────────
function fatura(no, tarih, unvan, vkn, tutar, kdvOran = 0.1, gonderim = 'ELEKTRONIK') {
  const vergi = p2(tutar * kdvOran);
  return { faturaNo: no, duzenlenmeTarihi: tarih, saticiUnvan: unvan, saticiVkn: vkn, gonderimSekli: gonderim, toplamTutar: tutar, vergilerTutari: vergi, odenecekTutar: p2(tutar + vergi), paraBirimi: 'TRY', iptalItirazDurum: null };
}
const SATICI = {
  yeni: ['YENİ MAĞAZACILIK A.Ş.', '9430027565'],
  banvit: ['BANVİT BANDIRMA VİTAMİNLİ YEM SAN. A.Ş.', '1400012345'],
  file: ['FİLE MARKET A.Ş.', '3880462185'],
  metro: ['METRO GROSMARKET BAKIRKÖY ALIŞVERİŞ HİZ. TİC. LTD. ŞTİ.', '6190049875'],
  igdas: ['İGDAŞ İSTANBUL GAZ DAĞITIM SAN. VE TİC. A.Ş.', '4700009821'],
  ck: ['CK BOĞAZİÇİ ELEKTRİK PERAKENDE SATIŞ A.Ş.', '2110535212'],
  turkcell: ['TURKCELL İLETİŞİM HİZMETLERİ A.Ş.', '8710014103'],
  opet: ['OPET PETROLCÜLÜK A.Ş.', '6440041233'],
  iski: ['İSKİ İSTANBUL SU VE KANALİZASYON İDARESİ', '4810040207'],
  namet: ['NAMET GIDA SAN. VE TİC. A.Ş.', '6280048215'],
};
const EDELER_EARSIV_08 = {
  baslangic: '2026-08-01', bitis: '2026-08-31', pencereSayisi: 5, hataliPencereler: [],
  faturalar: [
    fatura('YMA2026000481203', '2026-08-01', ...SATICI.yeni, 4820.5),
    fatura('BNV2026000091877', '2026-08-03', ...SATICI.banvit, 38940.0),
    fatura('FLM2026000512094', '2026-08-04', ...SATICI.file, 6215.8),
    fatura('MGB2026000330157', '2026-08-06', ...SATICI.metro, 21480.25),
    fatura('YMA2026000487720', '2026-08-08', ...SATICI.yeni, 3390.0),
    fatura('IGD2026008812345', '2026-08-10', ...SATICI.igdas, 14620.4, 0.2),
    fatura('CKB2026007712340', '2026-08-11', ...SATICI.ck, 27810.9, 0.2),
    fatura('BNV2026000093410', '2026-08-13', ...SATICI.banvit, 41260.0),
    fatura('FLM2026000519371', '2026-08-15', ...SATICI.file, 5875.3),
    fatura('TCL2026011234567', '2026-08-17', ...SATICI.turkcell, 2480.0, 0.2),
    fatura('OPT2026000662310', '2026-08-19', ...SATICI.opet, 9340.6, 0.2),
    fatura('NMT2026000221004', '2026-08-21', ...SATICI.namet, 18775.0),
    fatura('YMA2026000495012', '2026-08-23', ...SATICI.yeni, 2960.75),
    fatura('MGB2026000338804', '2026-08-26', ...SATICI.metro, 19980.0),
    fatura('ISK2026004410098', '2026-08-28', ...SATICI.iski, 3120.45, 0.1, 'KAGIT'),
    fatura('BNV2026000095522', '2026-08-31', ...SATICI.banvit, 36410.0),
  ],
};
const EDELER_EARSIV_09 = {
  baslangic: '2026-09-01', bitis: '2026-09-21', pencereSayisi: 3, hataliPencereler: [],
  faturalar: [
    fatura('YMA2026000501277', '2026-09-02', ...SATICI.yeni, 4115.0),
    fatura('BNV2026000097108', '2026-09-03', ...SATICI.banvit, 39820.0),
    fatura('FLM2026000526640', '2026-09-05', ...SATICI.file, 6480.9),
    fatura('MGB2026000345120', '2026-09-08', ...SATICI.metro, 22310.5),
    fatura('IGD2026009123456', '2026-09-10', ...SATICI.igdas, 11890.2, 0.2),
    fatura('CKB2026008201133', '2026-09-11', ...SATICI.ck, 26450.0, 0.2),
    fatura('BNV2026000098750', '2026-09-13', ...SATICI.banvit, 40105.0),
    fatura('OPT2026000671004', '2026-09-15', ...SATICI.opet, 8760.4, 0.2),
    fatura('NMT2026000226318', '2026-09-17', ...SATICI.namet, 17940.0),
    fatura('YMA2026000508841', '2026-09-19', ...SATICI.yeni, 3275.25),
    fatura('FLM2026000531902', '2026-09-21', ...SATICI.file, 5630.0),
  ],
};
for (const e of [EDELER_EARSIV_08, EDELER_EARSIV_09]) { e.faturaSayisi = e.faturalar.length; e.toplamOdenecek = p2(e.faturalar.reduce((s, f) => s + f.odenecekTutar, 0)); }
const FAM_EARSIV_08 = {
  baslangic: '2026-08-01', bitis: '2026-08-31', pencereSayisi: 5, hataliPencereler: [{ baslangic: '2026-08-22', bitis: '2026-08-28', hata: 'GİB servisi zaman aşımı' }],
  faturalar: [
    fatura('MGB2026000331900', '2026-08-05', ...SATICI.metro, 12480.0),
    fatura('CKB2026007719981', '2026-08-12', ...SATICI.ck, 8120.4, 0.2),
    fatura('TCL2026011250021', '2026-08-17', ...SATICI.turkcell, 1890.0, 0.2),
    fatura('ISK2026004412210', '2026-08-29', ...SATICI.iski, 940.15, 0.1, 'KAGIT'),
  ],
};
FAM_EARSIV_08.faturaSayisi = 4; FAM_EARSIV_08.toplamOdenecek = p2(FAM_EARSIV_08.faturalar.reduce((s, f) => s + f.odenecekTutar, 0));
/** m3 Ayşegül Kaya Eylül e-Arşivi — EDELER Eylül listesinin son 4 faturasından türetildi. */
const KAYA_EARSIV_09 = { ...EDELER_EARSIV_09, faturalar: EDELER_EARSIV_09.faturalar.slice(-4) };
KAYA_EARSIV_09.faturaSayisi = KAYA_EARSIV_09.faturalar.length;
KAYA_EARSIV_09.toplamOdenecek = p2(KAYA_EARSIV_09.faturalar.reduce((s, f) => s + f.odenecekTutar, 0));

// ── Sonuç satırları (bellekte; elle sorgu bitince eklenir) ───────────────────────
let sira = 1000;
function sonuc(taxpayerId, tur, donem, sorguTarihi, ozetMetni, veri, kaynak = 'nightly', whatsapp = false) {
  return { id: `gs-${++sira}`, taxpayerId, taxpayer: ozet(taxpayerId), tur, donem, sorguTarihi, ozet: ozetMetni, veri, kaynak, whatsappGonderildiMi: whatsapp };
}
const EDELER_BORC = vergiBorcuVerisi(EDELER_KALEMLER, bugun(3, 40));
const SONUCLAR = [
  sonuc('gs1', 'VERGI_BORCU', null, bugun(3, 40), '14 kalem borç; vadesi geçmiş 379.614,21 ₺', EDELER_BORC, 'nightly', true),
  sonuc('gs1', 'VERGI_BORCU', null, gunOnce(1, 3, 11), '14 kalem borç; vadesi geçmiş 379.614,21 ₺', vergiBorcuVerisi(EDELER_KALEMLER, gunOnce(1, 3, 11)), 'nightly', false),
  sonuc('m7', 'VERGI_BORCU', null, bugun(3, 22), '2 kalem borç; vadesi gelmemiş', vergiBorcuVerisi([kalem('0015', KDV, '2026/08-2026/08', '2026-09-26', 21340.0, 0, false), kalem('0003', MUH, '2026/08-2026/08', '2026-09-26', 6120.0, 0, false)], bugun(3, 22)), 'nightly', false),
  sonuc('m4', 'VERGI_BORCU', null, gunOnce(2, 3, 18), '1 kalem borç; vadesi geçmiş 9.130,00 ₺', vergiBorcuVerisi([kalem('0015', KDV, '2026/06-2026/06', '2026-07-28', 8300.0, 830.0, true, 'AVCILAR', '034294')], gunOnce(2, 3, 18)), 'nightly', true),
  sonuc('m5', 'VERGI_BORCU', null, bugun(3, 26), 'Borç yok', vergiBorcuVerisi([], bugun(3, 26)), 'nightly', false),
  sonuc('gs2', 'E_HACIZ', null, bugun(3, 31), '3 banka bildirisi; 2 tatbik edilmiş; 173.902,98 ₺', SEDA_HACIZ, 'nightly', true),
  sonuc('m7', 'E_HACIZ', null, bugun(3, 23), 'e-Haciz bildirisi yok', { bildiriSayisi: 0, tatbikEdilenSayisi: 0, toplamTutar: 0, bildiriler: [] }, 'nightly', false),
  sonuc('gs2', 'YOKLAMA_DENETIM', null, bugun(3, 33), '4 yoklama; son: Nakil İşe Başlama (26.09.2025)', SEDA_YOKLAMA, 'nightly', false),
  sonuc('m7', 'YOKLAMA_DENETIM', null, bugun(3, 24), '1 yoklama, 1 denetim', BALCIK_YOKLAMA, 'nightly', false),
  sonuc('gs1', 'POS', '2026-07', bugun(3, 42), 'Temmuz 2026: VAKIFBANK 2 üye işyeri, 224.149,00 ₺', EDELER_POS_07, 'nightly', true),
  sonuc('m5', 'POS', '2026-08', bugun(3, 27), 'Ağustos 2026: 3 kaynak, 269.844,80 ₺', FAM_POS_08, 'nightly', false),
  sonuc('m5', 'POS', '2026-07', gunOnce(31, 3, 27), 'Temmuz 2026: 3 kaynak, 263.210,75 ₺', FAM_POS_07, 'nightly', false),
  sonuc('gs1', 'GELEN_EARSIV', '2026-09', bugun(3, 44), `Eylül 2026: ${EDELER_EARSIV_09.faturaSayisi} fatura, ${EDELER_EARSIV_09.toplamOdenecek.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`, EDELER_EARSIV_09, 'nightly', false),
  sonuc('gs1', 'GELEN_EARSIV', '2026-08', gunOnce(21, 3, 17), `Ağustos 2026: ${EDELER_EARSIV_08.faturaSayisi} fatura, ${EDELER_EARSIV_08.toplamOdenecek.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`, EDELER_EARSIV_08, 'nightly', true),
  sonuc('m5', 'GELEN_EARSIV', '2026-08', gunOnce(21, 3, 29), 'Ağustos 2026: 4 fatura (1 pencere hatalı)', FAM_EARSIV_08, 'nightly', false),
  // Önizlemede daha çok mükellefte veri olsun diye 3 mükellef daha (hepsi mevcut veriden türetildi)
  sonuc('m1', 'VERGI_BORCU', null, bugun(3, 37), 'Borç yok', vergiBorcuVerisi([], bugun(3, 37)), 'nightly', false),
  sonuc('m2', 'VERGI_BORCU', null, bugun(3, 15), `${BALCIK_KALEMLER.length} kalem muhtasar borcu; tamamı vadesi geçmiş`, vergiBorcuVerisi(BALCIK_KALEMLER, bugun(3, 15)), 'nightly', true),
  sonuc('m2', 'YOKLAMA_DENETIM', null, bugun(3, 16), 'Yoklama / denetim kaydı yok', { yoklamaSayisi: 0, denetimSayisi: 0, sonYoklamaTarihi: null, yoklamalar: [], denetimler: [] }, 'nightly', false),
  sonuc('m3', 'E_HACIZ', null, bugun(3, 12), '1 banka bildirisi; tatbik edilmemiş', KAYA_HACIZ, 'nightly', false),
  sonuc('m3', 'GELEN_EARSIV', '2026-09', bugun(3, 13), `Eylül 2026: ${KAYA_EARSIV_09.faturaSayisi} fatura`, KAYA_EARSIV_09, 'nightly', false),
];
const sirala = () => SONUCLAR.sort((a, b) => (a.sorguTarihi < b.sorguTarihi ? 1 : -1));
sirala();

/** Elle sorgu bitince: mükellefin en son satırını kopyalayıp yeni sorgu tarihiyle ekler (ya da boş sonuç). */
const SORGU_TUR_ESLE = { vergiBorcu: 'VERGI_BORCU', eHaciz: 'E_HACIZ', yoklama: 'YOKLAMA_DENETIM', pos: 'POS', gelenEArsiv: 'GELEN_EARSIV' };
const BOS_VERI = {
  VERGI_BORCU: () => vergiBorcuVerisi([], iso(simdi())),
  E_HACIZ: () => ({ bildiriSayisi: 0, tatbikEdilenSayisi: 0, toplamTutar: 0, bildiriler: [] }),
  YOKLAMA_DENETIM: () => ({ yoklamaSayisi: 0, denetimSayisi: 0, sonYoklamaTarihi: null, yoklamalar: [], denetimler: [] }),
  POS: () => { const d = simdi(); return { yil: d.getFullYear(), ay: d.getMonth() + 1, toplamTutar: 0, satirSayisi: 0, satirlar: [] }; },
  GELEN_EARSIV: () => { const d = simdi(); const ay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; return { baslangic: `${ay}-01`, bitis: d.toISOString().slice(0, 10), faturaSayisi: 0, toplamOdenecek: 0, faturalar: [], pencereSayisi: 1, hataliPencereler: [] }; },
};
function elleSonucEkle(taxpayerId, sorgular) {
  for (const s of sorgular) {
    const tur = SORGU_TUR_ESLE[s];
    if (!tur) continue; // eDefter → ayrı tablo
    const onceki = SONUCLAR.find((r) => r.taxpayerId === taxpayerId && r.tur === tur);
    const d = simdi();
    const donem = tur === 'POS' || tur === 'GELEN_EARSIV' ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null;
    SONUCLAR.push(sonuc(taxpayerId, tur, onceki?.donem ?? donem, iso(d), onceki ? `${onceki.ozet} (elle sorgu)` : 'Kayıt yok', onceki ? onceki.veri : BOS_VERI[tur](), 'manual', false));
  }
  sirala();
}

// ── Koşular (işler) ─────────────────────────────────────────────────────────────
let isSira = 500;
const ADIM_SN = 2.5;
const SORGU_ADI = { vergiBorcu: 'Vergi borcu', eHaciz: 'e-Haciz', yoklama: 'Yoklama / denetim', pos: 'POS', gelenEArsiv: 'Gelen e-Arşiv', eDefter: 'e-Defter' };
function geceIsi(taxpayerId, ekSorgular, bas, sureDk, status = 'done', hata = null, sorguHatalari = []) {
  const b = new Date(bugun(3, 0)); b.setMinutes(bas);
  const e = new Date(b.getTime() + sureDk * 60_000);
  return {
    id: `is-gece-${taxpayerId}`, tenantId: 't1', taxpayerId, jobType: 'E_TEBLIGAT_CHECK', status, source: 'nightly',
    periodStart: null, periodEnd: null, donem: null,
    payload: { ekSorgular, progress: { message: status === 'failed' ? hata : 'Tamamlandı' } },
    result: status === 'done' ? { sorguHatalari } : null, errorMessage: hata, recordCount: 0,
    createdAt: iso(b), startedAt: iso(b), finishedAt: iso(e), taxpayer: ozet(taxpayerId),
  };
}
const ISLER = [
  geceIsi('gs1', ['vergiBorcu', 'pos', 'gelenEArsiv', 'eDefter'], 38, 7),
  geceIsi('gs2', ['eHaciz', 'yoklama'], 29, 5),
  geceIsi('m7', ['vergiBorcu', 'eHaciz', 'yoklama'], 20, 6),
  geceIsi('m5', ['vergiBorcu', 'pos', 'gelenEArsiv'], 24, 5),
  geceIsi('m1', ['vergiBorcu', 'pos'], 36, 4, 'done', null, [{ sorgu: 'pos', hata: 'GİB POS servisi yanıt vermedi' }]),
  geceIsi('m4', ['vergiBorcu'], 41, 1, 'failed', 'Dijital Vergi Dairesi girişi başarısız: şifre hatalı'),
  geceIsi('m2', ['vergiBorcu', 'yoklama'], 14, 3),
  geceIsi('m3', ['eHaciz', 'gelenEArsiv'], 11, 3),
];
/** Elle işleri zamanla ilerlet: 3 sn kuyrukta → adım adım çalışıyor → tamamlandı (sonuç satırı eklenir). */
function isleriIlerlet() {
  const t = Date.now();
  for (const is of ISLER) {
    if (is.source !== 'manual' || is.status === 'done' || is.status === 'failed') continue;
    const gecen = (t - new Date(is.createdAt).getTime()) / 1000;
    const adimlar = ["Dijital Vergi Dairesi'ne giriliyor", ...is.payload.sorgular.map((s) => `${SORGU_ADI[s] || s} sorgulanıyor`), 'Güvenli çıkış yapılıyor'];
    if (gecen < 3) continue;
    if (is.status === 'pending') { is.status = 'running'; is.startedAt = iso(new Date(is.createdAt).getTime() + 3000); }
    const adim = Math.floor((gecen - 3) / ADIM_SN);
    if (adim >= adimlar.length) {
      is.status = 'done'; is.finishedAt = iso(t); is.payload.progress = { message: 'Tamamlandı', step: adimlar.length, total: adimlar.length }; is.result = { sorguHatalari: [] };
      elleSonucEkle(is.taxpayerId, is.payload.sorgular);
    } else {
      is.payload.progress = { message: `${adimlar[adim]} (${adim + 1}/${adimlar.length})`, step: adim + 1, total: adimlar.length };
    }
  }
}

// ── Küçük bir PDF (yoklama tutanağı yer tutucusu) ────────────────────────────────
function tutanakPdf() {
  const metin = 'YOKLAMA TUTANAGI - SAHTE ORNEK (Genel Sorgulamalar onizleme)';
  const icerik = `BT /F1 16 Tf 60 740 Td (${metin}) Tj ET`;
  const nesneler = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(icerik)} >>\nstream\n${icerik}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let govde = '%PDF-1.4\n';
  const konumlar = [];
  nesneler.forEach((n, i) => { konumlar.push(Buffer.byteLength(govde)); govde += `${i + 1} 0 obj\n${n}\nendobj\n`; });
  const xref = Buffer.byteLength(govde);
  govde += `xref\n0 ${nesneler.length + 1}\n0000000000 65535 f \n${konumlar.map((k) => `${String(k).padStart(10, '0')} 00000 n \n`).join('')}`;
  govde += `trailer\n<< /Size ${nesneler.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(govde, 'latin1');
}

// ── Uçlar ────────────────────────────────────────────────────────────────────────
function uclar(yol, yontem, q, govde, jsonGonder, res) {
  // Görseli eksik faturalar (DVD ↔ Luca) — sahte karşılaştırma
  if (yontem === 'GET' && yol === '/genel-sorgular/earsiv-eksik') {
    const tp = (id, ad, vkn) => ({ id, companyName: ad, firstName: null, lastName: null, taxNumber: vkn });
    const rows = [
      { taxpayerId: 'gs1', taxpayer: tp('gs1', 'EDELER YEMEK ÜRETİM SAN. LTD. ŞTİ.', '3241199696'), donem: '2026-08', sorguTarihi: new Date().toISOString(), faturaNo: 'ANE2026000000178', duzenlenmeTarihi: '2026-08-26T14:34:33', saticiUnvan: 'ANDON GIDA SANAYİ VE TİCARET LİMİTED ŞİRKETİ', saticiVkn: '0691547818', toplamTutar: 69982.5, vergilerTutari: 9528.3, odenecekTutar: 79510.8, durum: 'LUCA_YOK' },
      { taxpayerId: 'gs1', taxpayer: tp('gs1', 'EDELER YEMEK ÜRETİM SAN. LTD. ŞTİ.', '3241199696'), donem: '2026-08', sorguTarihi: new Date().toISOString(), faturaNo: 'G292026002743927', duzenlenmeTarihi: '2026-08-29T16:53:00', saticiUnvan: 'YENİ MAĞAZACILIK ANONİM ŞİRKETİ', saticiVkn: '9480423762', toplamTutar: 2355.45, vergilerTutari: 23.55, odenecekTutar: 2379, durum: 'GORSEL_YOK' },
      { taxpayerId: 'gs1', taxpayer: tp('gs1', 'EDELER YEMEK ÜRETİM SAN. LTD. ŞTİ.', '3241199696'), donem: '2026-09', sorguTarihi: new Date().toISOString(), faturaNo: 'EAR2026000000261', duzenlenmeTarihi: '2026-09-09T02:47:37', saticiUnvan: 'YAĞMUR NUR TARIM ÜRÜNLERİ LİMİTED ŞİRKETİ', saticiVkn: '9280886533', toplamTutar: 72600, vergilerTutari: 726, odenecekTutar: 73326, durum: 'LUCA_YOK' },
    ].filter((r) => (!q.taxpayerId || r.taxpayerId === q.taxpayerId) && (!q.donem || r.donem === q.donem));
    return jsonGonder(res, 200, { rows, ozet: { dvd: 27, lucaVar: 27 - rows.length, lucaYok: rows.filter((r) => r.durum === 'LUCA_YOK').length, gorselYok: rows.filter((r) => r.durum === 'GORSEL_YOK').length, sorguSayisi: 2 } });
  }
  if (yontem === 'GET' && yol === '/taxpayers') return jsonGonder(res, 200, MUKELLEFLER);

  if (yontem === 'GET' && yol === '/genel-sorgular/ozet') {
    const out = {};
    for (const tur of ['VERGI_BORCU', 'E_HACIZ', 'YOKLAMA_DENETIM', 'POS', 'GELEN_EARSIV']) {
      const l = SONUCLAR.filter((r) => r.tur === tur);
      out[tur] = { adet: l.length, sonSorgu: l[0]?.sorguTarihi ?? null };
    }
    return jsonGonder(res, 200, out);
  }
  // GÜNCEL DURUM — gerçek çözümleyicinin (apps/api/src/genel-sorgular/guncel-durum.ts) sahte kopyası: mükellef (+ay) başına en son sonuç → düz satırlar
  if (yontem === 'GET' && yol === '/genel-sorgular/guncel') {
    const tur = String(q.tur || '');
    const ayBazli = tur === 'POS' || tur === 'GELEN_EARSIV';
    const gorulen = new Set();
    const enSon = sirala().filter((r) => r.tur === tur && (!q.taxpayerId || r.taxpayerId === q.taxpayerId) && (!(ayBazli && q.donem) || r.donem === q.donem)).filter((r) => {
      const k = ayBazli ? `${r.taxpayerId}::${r.donem || ''}` : r.taxpayerId; if (gorulen.has(k)) return false; gorulen.add(k); return true;
    });
    const n = (v) => Number(v) || 0;
    const ortak = (r) => ({ sonucId: r.id, taxpayerId: r.taxpayerId, taxpayer: r.taxpayer, sorguTarihi: r.sorguTarihi, kaynak: r.kaynak, donem: r.donem });
    let rows = []; let bos = 0;
    for (const r of enSon) {
      const v = r.veri || {};
      if (tur === 'VERGI_BORCU') { if (!n(v.toplam)) bos++; rows.push({ kind: 'borc', ...ortak(r), vadesiGecmis: n(v.vadesiGecmis), vadesiGelmemis: n(v.vadesiGelmemis), toplam: n(v.toplam), gecikmeZammi: n(v.gecikmeZammiToplam), kalemSayisi: (v.kalemler || []).length, kalemler: v.kalemler || [], hesaplamaZamani: v.hesaplamaZamani || null }); }
      else if (tur === 'E_HACIZ') { const l = v.bildiriler || []; if (!l.length) bos++; for (const b of l) rows.push({ kind: 'haciz', ...ortak(r), kapsam: b.kapsam, bildiriNo: b.bildiriNo, vergiDairesi: b.vergiDairesi, vergiDairesiKodu: b.vergiDairesiKodu, tutar: n(b.tutar), durum: b.durum, tatbikEdildi: /EDİLMİŞTİR$/i.test(b.durum || ''), borclar: b.borclar || [] }); }
      else if (tur === 'YOKLAMA_DENETIM') { const y = v.yoklamalar || [], d = v.denetimler || []; if (!y.length && !d.length) bos++; for (const x of y) rows.push({ kind: 'yoklama', ...ortak(r), kayit: 'YOKLAMA', kod: x.yoklamaKodu, vergiDairesi: x.vergiDairesi, turu: x.yoklamaTuru, tarih: x.tarih, sonuc: null, pdfDocumentId: x.pdfDocumentId || null, pdfVarMi: !!x.pdfVarMi }); for (const x of d) rows.push({ kind: 'yoklama', ...ortak(r), kayit: 'DENETIM', kod: x.belgeKodu, vergiDairesi: '', turu: x.denetimAdi || x.denetimTuru, tarih: x.tarih, sonuc: x.sonuc || null, pdfDocumentId: null, pdfVarMi: false }); }
      else if (tur === 'POS') { const l = v.satirlar || []; if (!l.length) bos++; for (const x of l) rows.push({ kind: 'pos', ...ortak(r), kaynak: x.kaynak, unvan: x.unvan, vkn: x.vkn, uyeIsyeriNo: x.uyeIsyeriNo, tutar: n(x.tutar), donemToplami: n(v.toplamTutar) }); }
      else if (tur === 'GELEN_EARSIV') { const l = v.faturalar || []; if (!l.length) bos++; for (const f of l) rows.push({ kind: 'fatura', ...ortak(r), faturaNo: f.faturaNo, duzenlenmeTarihi: f.duzenlenmeTarihi, saticiUnvan: f.saticiUnvan, saticiVkn: f.saticiVkn, gonderimSekli: f.gonderimSekli, toplamTutar: n(f.toplamTutar), vergilerTutari: n(f.vergilerTutari), odenecekTutar: n(f.odenecekTutar), iptalItirazDurum: f.iptalItirazDurum || null }); }
    }
    if (tur === 'VERGI_BORCU') rows.sort((a, b) => b.toplam - a.toplam);
    const page = Math.max(1, Number(q.page) || 1); const pageSize = Math.min(5000, Math.max(1, Number(q.pageSize) || 50));
    const z = enSon.map((r) => r.sorguTarihi).sort();
    return jsonGonder(res, 200, { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, ozet: { mukellef: new Set(enSon.map((r) => r.taxpayerId)).size, bos, enEskiSorgu: z[0] || null, enYeniSorgu: z[z.length - 1] || null } });
  }
  if (yontem === 'GET' && yol === '/genel-sorgular') {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const hepsi = SONUCLAR.filter((r) => (!q.tur || r.tur === q.tur) && (!q.taxpayerId || r.taxpayerId === q.taxpayerId) && (!q.donem || r.donem === q.donem));
    return jsonGonder(res, 200, { rows: hepsi.slice((page - 1) * pageSize, page * pageSize), total: hepsi.length, page, pageSize });
  }

  if (yontem === 'GET' && yol === '/portal-automation/credentials') {
    const rows = [...SIFRELI].map((id, i) => ({ id: `c-gib-${i}`, provider: 'GIB_IVD', ownerType: 'TAXPAYER', ownerId: id, taxpayerId: id, taxpayer: ozet(id), username: null, userCode: mukellef(id)?.taxNumber || '', officeCode: null, workplaceCode: null, hasPassword: true, hasSecondaryPassword: false, isActive: true, lastCheckedAt: bugun(3, 5), lastSuccessAt: bugun(3, 5), lastError: null, updatedAt: bugun(3, 5), notes: null }));
    rows.push({ id: 'c-sgk-1', provider: 'SGK_EBILDIRGE', ownerType: 'TAXPAYER', ownerId: 'm7', taxpayerId: 'm7', taxpayer: ozet('m7'), username: 'balcik', userCode: '', officeCode: null, workplaceCode: '2 1234 01 01 1234567 034 12 34', hasPassword: true, hasSecondaryPassword: true, isActive: true, lastCheckedAt: bugun(3, 5), lastSuccessAt: bugun(3, 5), lastError: null, updatedAt: bugun(3, 5), notes: null });
    return jsonGonder(res, 200, { summary: { total: rows.length, active: rows.length }, rows });
  }

  if (yontem === 'GET' && yol === '/portal-automation/jobs') {
    isleriIlerlet();
    const turler = q.jobType ? String(q.jobType).split(',') : null;
    const durumlar = q.status ? String(q.status).split(',') : null;
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 30));
    const liste = ISLER.filter((i) => (!turler || turler.includes(i.jobType)) && (!durumlar || durumlar.includes(i.status)))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
    return jsonGonder(res, 200, liste);
  }

  // Not: oncelik/edefter-takip.cjs (alfabetik önce yüklenir) aynı POST ucunu kendi verisiyle ele alıyor; önizleme betiği
  // isteği `page.route` ile /sahte/genel-sorgular/dvd-sorgu yoluna yönlendirir (bkz. onizleme/genel-sorgular-goruntule.cjs).
  if (yontem === 'POST' && (yol === '/portal-automation/dvd-sorgu' || yol === '/sahte/genel-sorgular/dvd-sorgu')) {
    const sorgular = Array.isArray(govde.sorgular) ? govde.sorgular.filter((s) => SORGU_ADI[s]) : [];
    if (sorgular.length === 0) return jsonGonder(res, 400, { message: 'En az bir sorgu türü seçin' });
    const hedefler = Array.isArray(govde.taxpayerIds) && govde.taxpayerIds.length ? govde.taxpayerIds : [...SIFRELI];
    const created = []; const skipped = [];
    for (const id of hedefler) {
      if (!mukellef(id)) { skipped.push({ taxpayerId: id, jobType: 'DVD_SORGU', reason: 'mükellef bulunamadı' }); continue; }
      if (!SIFRELI.has(id)) { skipped.push({ taxpayerId: id, jobType: 'DVD_SORGU', reason: 'DVD şifresi yok' }); continue; }
      if (ISLER.some((i) => i.taxpayerId === id && (i.status === 'pending' || i.status === 'running'))) { skipped.push({ taxpayerId: id, jobType: 'DVD_SORGU', reason: 'zaten kuyrukta' }); continue; }
      const is = {
        id: `is-${++isSira}`, tenantId: 't1', taxpayerId: id, jobType: 'DVD_SORGU', status: 'pending', source: 'manual',
        periodStart: null, periodEnd: null, donem: null, payload: { sorgular, progress: { message: 'Sırada bekliyor', step: 0, total: sorgular.length + 2 } },
        result: null, errorMessage: null, recordCount: 0, createdAt: iso(simdi()), startedAt: null, finishedAt: null, taxpayer: ozet(id),
      };
      ISLER.push(is); created.push({ id: is.id, taxpayerId: id, jobType: 'DVD_SORGU' });
    }
    console.log('[mock] dvd-sorgu', { created: created.length, skipped: skipped.length, sorgular });
    return jsonGonder(res, 200, { created, skipped, message: `${created.length} iş kuyruğa alındı`, runnerWake: true });
  }

  const gorunum = /^\/portal-automation\/documents\/([^/]+)\/view$/.exec(yol);
  if (yontem === 'GET' && gorunum) return jsonGonder(res, 200, { url: `http://localhost:${process.env.PORT || 3001}/api/v1/sahte/tutanak.pdf?id=${gorunum[1]}`, viewedAt: iso(simdi()) });
  if (yontem === 'GET' && yol === '/sahte/tutanak.pdf') {
    const pdf = tutanakPdf();
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length });
    res.end(pdf);
    return true;
  }
  return false;
}
module.exports = { uclar };
