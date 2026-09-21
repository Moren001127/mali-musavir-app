// Mali tablolar (Mizan, Gelir Tablosu, Bilanço, İşletme Hesap Özeti, AI mali yorum) — beyaz tema önizlemesi
// için sahte veri (2026-09-21). mock-api.cjs bu dosyayı her istekte otomatik yükler; eşleşmeyen yol için false döner.
//
//   Mizan:           GET /mizan?taxpayerId · GET /mizan/:id · GET /mizan/denetim-kriterleri · PATCH lock/unlock · POST analyze · DELETE
//   Gelir tablosu:   GET /gelir-tablosu?taxpayerId · GET /gelir-tablosu/:id · PATCH duzeltmeler/lock/unlock · DELETE
//   Bilanço:         GET /bilanco?taxpayerId · GET /bilanco/:id · PATCH duzeltmeler/lock/unlock · DELETE
//   İHÖ:             GET /isletme-hesap-ozeti/yil/:taxpayerId/:yil · PATCH /isletme-hesap-ozeti/:id · lock/unlock · DELETE
//   Mali yorum:      GET /mali-yorum/:kaynak/:id · POST /mali-yorum/:kaynak/:id/uret
// Kilit/durum değişimleri bellekte tutulur; sunucu yeniden başlayınca sıfırlanır.

const SIMDI = new Date().toISOString();
const gunOnce = (n) => new Date(Date.now() - n * 86400000).toISOString();

const MUKELLEF_FIRMA = { id: 'm1', type: 'TUZEL_KISI', companyName: 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', firstName: null, lastName: null, taxNumber: '6420011234' };
const MUKELLEF_SAHIS = { id: 'm2', type: 'GERCEK_KISI', companyName: null, firstName: 'Erdoğan', lastName: 'Balçık', taxNumber: '14523698745' };

// ─────────────────────────────────────────────────────────────────────────────
// MİZAN
// ─────────────────────────────────────────────────────────────────────────────
function hesap(hesapKodu, hesapAdi, borc, alacak) {
  const fark = Math.round((borc - alacak) * 100) / 100;
  return {
    id: `h-${hesapKodu}`, hesapKodu, hesapAdi,
    borcToplami: borc, alacakToplami: alacak,
    borcBakiye: fark > 0 ? fark : 0, alacakBakiye: fark < 0 ? -fark : 0,
  };
}
const MIZAN_HESAPLAR = [
  hesap('1', 'DÖNEN VARLIKLAR', 9214830.35, 6653210.00),
  hesap('10', 'HAZIR DEĞERLER', 3418640.35, 2806160.00),
  hesap('100', 'KASA', 486230.00, 444100.00),
  hesap('100.01', 'MERKEZ KASA', 486230.00, 444100.00),
  hesap('102', 'BANKALAR', 2932410.35, 2362060.00),
  hesap('102.01', 'ZİRAAT BANKASI - VADESİZ', 2104880.35, 1698400.00),
  hesap('102.02', 'GARANTİ BBVA - VADESİZ', 827530.00, 663660.00),
  hesap('12', 'TİCARİ ALACAKLAR', 5116300.00, 3831400.00),
  hesap('120', 'ALICILAR', 5116300.00, 3831400.00),
  hesap('120.01.001', 'MİGROS TİCARET A.Ş.', 2140600.00, 1612300.00),
  hesap('120.01.002', 'ŞOK MARKETLER T.A.Ş.', 1486400.00, 1084700.00),
  hesap('120.01.003', 'YILMAZ GIDA PAZARLAMA', 1489300.00, 1134400.00),
  hesap('13', 'DİĞER ALACAKLAR', 15000.00, 0),
  hesap('131', 'ORTAKLARDAN ALACAKLAR', 15000.00, 0),
  hesap('15', 'STOKLAR', 3998970.00, 3512750.00),
  hesap('153', 'TİCARİ MALLAR', 3998970.00, 3512750.00),
  hesap('18', 'GELECEK AYLARA AİT GİDERLER', 24600.00, 0),
  hesap('180', 'GELECEK AYLARA AİT GİDERLER', 24600.00, 0),
  hesap('19', 'DİĞER DÖNEN VARLIKLAR', 641320.00, 502900.00),
  hesap('191', 'İNDİRİLECEK KDV', 641320.00, 502900.00),
  hesap('2', 'DURAN VARLIKLAR', 922800.00, 162500.00),
  hesap('25', 'MADDİ DURAN VARLIKLAR', 904800.00, 162500.00),
  hesap('254', 'TAŞITLAR', 690000.00, 0),
  hesap('255', 'DEMİRBAŞLAR', 214800.00, 0),
  hesap('257', 'BİRİKMİŞ AMORTİSMANLAR (-)', 0, 162500.00),
  hesap('26', 'MADDİ OLMAYAN DURAN VARLIKLAR', 18000.00, 0),
  hesap('260', 'HAKLAR', 18000.00, 0),
  hesap('3', 'KISA VADELİ YABANCI KAYNAKLAR', 4102640.00, 5446750.35),
  hesap('30', 'MALİ BORÇLAR', 90000.00, 300000.00),
  hesap('300', 'BANKA KREDİLERİ', 90000.00, 300000.00),
  hesap('32', 'TİCARİ BORÇLAR', 3486200.00, 4420810.00),
  hesap('320', 'SATICILAR', 3486200.00, 4420810.00),
  hesap('320.01.001', 'ANADOLU UN SAN. A.Ş.', 1840300.00, 2310650.00),
  hesap('320.01.002', 'MARMARA AMBALAJ LTD.', 1645900.00, 2110160.00),
  hesap('33', 'DİĞER BORÇLAR', 112400.00, 140800.00),
  hesap('335', 'PERSONELE BORÇLAR', 112400.00, 140800.00),
  hesap('36', 'ÖDENECEK VERGİ VE DİĞER YÜKÜMLÜLÜKLER', 214040.00, 310280.35),
  hesap('360', 'ÖDENECEK VERGİ VE FONLAR', 128900.00, 190790.35),
  hesap('361', 'ÖDENECEK SOSYAL GÜVENLİK KESİNTİLERİ', 85140.00, 119490.00),
  hesap('39', 'DİĞER KISA VADELİ YABANCI KAYNAKLAR', 200000.00, 274860.00),
  hesap('391', 'HESAPLANAN KDV', 200000.00, 274860.00),
  hesap('4', 'UZUN VADELİ YABANCI KAYNAKLAR', 0, 320000.00),
  hesap('40', 'MALİ BORÇLAR', 0, 320000.00),
  hesap('400', 'BANKA KREDİLERİ', 0, 320000.00),
  hesap('5', 'ÖZKAYNAKLAR', 0, 1130200.00),
  hesap('50', 'ÖDENMİŞ SERMAYE', 0, 500000.00),
  hesap('500', 'SERMAYE', 0, 500000.00),
  hesap('54', 'KÂR YEDEKLERİ', 0, 86400.00),
  hesap('540', 'YASAL YEDEKLER', 0, 86400.00),
  hesap('57', 'GEÇMİŞ YILLAR KÂRLARI', 0, 543800.00),
  hesap('570', 'GEÇMİŞ YILLAR KÂRLARI', 0, 543800.00),
  hesap('6', 'GELİR TABLOSU HESAPLARI', 4370710.00, 4895350.00),
  hesap('60', 'BRÜT SATIŞLAR', 0, 4872500.00),
  hesap('600', 'YURTİÇİ SATIŞLAR', 0, 4860000.00),
  hesap('602', 'DİĞER GELİRLER', 0, 12500.00),
  hesap('61', 'SATIŞ İNDİRİMLERİ (-)', 38400.00, 0),
  hesap('610', 'SATIŞTAN İADELER (-)', 38400.00, 0),
  hesap('62', 'SATIŞLARIN MALİYETİ (-)', 3512750.00, 0),
  hesap('621', 'SATILAN TİCARİ MALLAR MALİYETİ (-)', 3512750.00, 0),
  hesap('63', 'FAALİYET GİDERLERİ (-)', 761330.00, 0),
  hesap('631', 'PAZARLAMA SATIŞ VE DAĞITIM GİDERLERİ (-)', 148900.00, 0),
  hesap('632', 'GENEL YÖNETİM GİDERLERİ (-)', 612430.00, 0),
  hesap('64', 'DİĞER FAALİYETLERDEN OLAĞAN GELİR VE KÂRLAR', 0, 22850.00),
  hesap('642', 'FAİZ GELİRLERİ', 0, 18640.00),
  hesap('646', 'KAMBİYO KÂRLARI', 0, 4210.00),
  hesap('65', 'DİĞER FAALİYETLERDEN OLAĞAN GİDER VE ZARARLAR (-)', 9030.00, 0),
  hesap('653', 'KOMİSYON GİDERLERİ (-)', 2100.00, 0),
  hesap('656', 'KAMBİYO ZARARLARI (-)', 6930.00, 0),
  hesap('66', 'FİNANSMAN GİDERLERİ (-)', 41780.00, 0),
  hesap('660', 'KISA VADELİ BORÇLANMA GİDERLERİ (-)', 41780.00, 0),
  hesap('67', 'OLAĞANDIŞI GELİR VE KÂRLAR', 0, 0),
  hesap('679', 'DİĞER OLAĞANDIŞI GELİR VE KÂRLAR', 0, 0),
  hesap('68', 'OLAĞANDIŞI GİDER VE ZARARLAR (-)', 7420.00, 0),
  hesap('689', 'DİĞER OLAĞANDIŞI GİDER VE ZARARLAR (-)', 7420.00, 0),
  hesap('7', 'MALİYET HESAPLARI', 761330.00, 761330.00),
  hesap('76', 'PAZARLAMA SATIŞ VE DAĞITIM GİDERLERİ', 148900.00, 148900.00),
  hesap('760', 'PAZARLAMA SATIŞ VE DAĞITIM GİDERLERİ', 148900.00, 0),
  hesap('761', 'PAZARLAMA SATIŞ VE DAĞITIM GİDERLERİ YANSITMA', 0, 148900.00),
  hesap('77', 'GENEL YÖNETİM GİDERLERİ', 612430.00, 612430.00),
  hesap('770', 'GENEL YÖNETİM GİDERLERİ', 612430.00, 0),
  hesap('771', 'GENEL YÖNETİM GİDERLERİ YANSITMA', 0, 612430.00),
];
const MIZAN_ANOMALILER = [
  { id: 'an1', hesapKodu: '131', tip: 'ORTAK_CARI_BAKIYE', seviye: 'WARN', mesaj: '131 Ortaklardan Alacaklar 15.000,00 TL borç bakiyesi veriyor; dönem sonunda adat faizi hesaplanmalı.' },
  { id: 'an2', hesapKodu: '335', tip: 'PERSONEL_BORC_ARTIS', seviye: 'WARN', mesaj: '335 Personele Borçlar 28.400,00 TL alacak bakiyesi taşıyor; ödenmemiş ücret bordrosu olabilir.' },
  { id: 'an3', hesapKodu: '191', tip: 'KDV_DEVREDEN_UYUM', seviye: 'ERROR', mesaj: '191 İndirilecek KDV bakiyesi (138.420,00) KDV beyannamesindeki devreden KDV ile uyuşmuyor (fark 4.180,00).' },
  { id: 'an4', hesapKodu: '360', tip: 'ODENECEK_VERGI_GECIKME', seviye: 'WARN', mesaj: '360 Ödenecek Vergi ve Fonlar 61.890,35 TL; önceki ay tahakkuku 26 Eylül vadesinde ödenmemiş görünüyor.' },
];
const MIZAN_TOPLAMLAR = { borcToplami: 18611220.35, alacakToplami: 18611220.35, borcBakiye: 5091760.35, alacakBakiye: 5091760.35 };
const MIZANLAR = [
  { id: 'mz-2026-09', taxpayerId: 'm1', taxpayer: MUKELLEF_FIRMA, donem: '2026-09', donemTipi: 'AYLIK', createdAt: gunOnce(1), locked: false, lockedAt: null, lockNote: null, kaynak: 'LUCA', anomaliSayisi: MIZAN_ANOMALILER.length },
  { id: 'mz-2026-q2', taxpayerId: 'm1', taxpayer: MUKELLEF_FIRMA, donem: '2026-Q2', donemTipi: 'GECICI_Q2', createdAt: gunOnce(52), locked: true, lockedAt: gunOnce(48), lockNote: 'Geçici vergi beyannamesi 2026/2', kaynak: 'LUCA', anomaliSayisi: 2 },
  { id: 'mz-2026-q1', taxpayerId: 'm1', taxpayer: MUKELLEF_FIRMA, donem: '2026-Q1', donemTipi: 'GECICI_Q1', createdAt: gunOnce(140), locked: true, lockedAt: gunOnce(136), lockNote: 'Geçici vergi beyannamesi 2026/1', kaynak: 'EXCEL', anomaliSayisi: 0 },
  { id: 'mz-2026-08', taxpayerId: 'm1', taxpayer: MUKELLEF_FIRMA, donem: '2026-08', donemTipi: 'AYLIK', createdAt: gunOnce(31), locked: false, lockedAt: null, lockNote: null, kaynak: 'LUCA', anomaliSayisi: 1 },
];
function mizanOzet(m) {
  return {
    ...m,
    toplamBorc: MIZAN_TOPLAMLAR.borcToplami, toplamAlacak: MIZAN_TOPLAMLAR.alacakToplami,
    toplamBorcBakiye: MIZAN_TOPLAMLAR.borcBakiye, toplamAlacakBakiye: MIZAN_TOPLAMLAR.alacakBakiye,
    _count: { hesaplar: MIZAN_HESAPLAR.length, anomaliler: m.anomaliSayisi },
  };
}
function mizanDetay(m) {
  return { ...mizanOzet(m), hesaplar: MIZAN_HESAPLAR, anomaliler: m.anomaliSayisi ? MIZAN_ANOMALILER.slice(0, m.anomaliSayisi) : [], toplamlar: MIZAN_TOPLAMLAR };
}
const DENETIM_KRITERLERI = [
  { id: 'dk1', ad: 'Kasa tavanı', aktif: true, hesapPattern: '100*', kosul: 'BORC_BAKIYE_USTU', esik: 250000, seviye: 'WARN', mesaj: '{hesapKodu} kasa bakiyesi {esik} TL üstünde; adat faizi riski', taxpayerId: null, createdAt: gunOnce(60) },
  { id: 'dk2', ad: 'Ortak cari sıfır olmalı', aktif: true, hesapPattern: '131', kosul: 'BAKIYE_VAR', esik: null, seviye: 'ERROR', mesaj: '131 hesabı dönem sonunda bakiye vermemeli', taxpayerId: 'm1', createdAt: gunOnce(20) },
  { id: 'dk3', ad: 'Şüpheli alacak karşılığı', aktif: false, hesapPattern: '128', kosul: 'BAKIYE_VAR', esik: null, seviye: 'WARN', mesaj: '128 varsa 129 karşılık ayrılmalı', taxpayerId: null, createdAt: gunOnce(90) },
];

// ─────────────────────────────────────────────────────────────────────────────
// GELİR TABLOSU (2026 Q1 ve Q2 dolu; Q3/Q4 yok)
// ─────────────────────────────────────────────────────────────────────────────
function gt(id, q, createdAt, locked, k) {
  const r = (x) => Math.round(x * 100) / 100;
  const brutSatislar = r(k.s600 + k.s601 + k.s602);
  const satisIndirimleri = r(k.s610 + k.s611);
  const netSatislar = r(brutSatislar - satisIndirimleri);
  const satisMaliyeti = r(k.s621 + k.s622);
  const brutSatisKari = r(netSatislar - satisMaliyeti);
  const faaliyetGiderleri = r(k.s760 + k.s770);
  const faaliyetKari = r(brutSatisKari - faaliyetGiderleri);
  const digerGelirler = r(k.s642 + k.s646);
  const digerGiderler = r(k.s653 + k.s656);
  const finansmanGiderleri = r(k.s660);
  const olaganKar = r(faaliyetKari + digerGelirler - digerGiderler - finansmanGiderleri);
  const olaganDisiGelir = r(k.s679);
  const olaganDisiGider = r(k.s689);
  const donemKari = r(olaganKar + olaganDisiGelir - olaganDisiGider);
  const vergiKarsiligi = 0;
  const donemNetKari = r(donemKari - vergiKarsiligi);
  const detayKalem = (kod, hesapAdi, tutar) => ({ kod, hesapAdi, tutar });
  return {
    id, taxpayerId: 'm1', taxpayer: MUKELLEF_FIRMA, mizanId: q === 1 ? 'mz-2026-q1' : 'mz-2026-q2',
    donem: `2026-Q${q}`, donemTipi: `GECICI_Q${q}`, createdAt, locked, lockedAt: locked ? createdAt : null, lockNote: locked ? `Geçici vergi 2026/${q}` : null,
    brutSatislar, satisIndirimleri, netSatislar, satisMaliyeti, brutSatisKari, faaliyetGiderleri, faaliyetKari,
    digerGelirler, digerGiderler, finansmanGiderleri, olaganKar, olaganDisiGelir, olaganDisiGider, donemKari, vergiKarsiligi, donemNetKari,
    duzeltmeler: k.duzeltmeler || {},
    detay: {
      brutSatis: { toplam: brutSatislar, detay: [detayKalem('600', 'Yurtiçi Satışlar', k.s600), detayKalem('601', 'Yurtdışı Satışlar', k.s601), detayKalem('602', 'Diğer Gelirler', k.s602)] },
      satisIndirim: { toplam: satisIndirimleri, detay: [detayKalem('610', 'Satıştan İadeler (-)', k.s610), detayKalem('611', 'Satış İskontoları (-)', k.s611)] },
      satisMal: { toplam: satisMaliyeti, detay: [detayKalem('621', 'Satılan Ticari Mallar Maliyeti (-)', k.s621), detayKalem('622', 'Satılan Hizmet Maliyeti (-)', k.s622)] },
      faaliyetGider: { toplam: faaliyetGiderleri, detay: [detayKalem('760', 'Pazarlama Satış ve Dağıtım Giderleri (-)', k.s760), detayKalem('770', 'Genel Yönetim Giderleri (-)', k.s770)] },
      digerGelir: { toplam: digerGelirler, detay: [detayKalem('642', 'Faiz Gelirleri', k.s642), detayKalem('646', 'Kambiyo Kârları', k.s646)] },
      digerGider: { toplam: digerGiderler, detay: [detayKalem('653', 'Komisyon Giderleri (-)', k.s653), detayKalem('656', 'Kambiyo Zararları (-)', k.s656)] },
      finansman: { toplam: finansmanGiderleri, detay: [detayKalem('660', 'Kısa Vadeli Borçlanma Giderleri (-)', k.s660)] },
      olaganDisiGelir: { toplam: olaganDisiGelir, detay: [detayKalem('679', 'Diğer Olağandışı Gelir ve Kârlar', k.s679)] },
      olaganDisiGider: { toplam: olaganDisiGider, detay: [detayKalem('689', 'Diğer Olağandışı Gider ve Zararlar (-)', k.s689)] },
    },
    geciciVergiHesabi: {
      donemSirasi: q, kkeg: k.kkeg, donemNetKari, toplamKar: r(donemNetKari + k.kkeg), gecmisYilZarari: 0,
      gecicVergiMatrahi: r(donemNetKari + k.kkeg), gecicVergiOrani: 0.25,
      hesaplananGeciciVergi: r((donemNetKari + k.kkeg) * 0.25),
      oncekiDonemOdenen: k.oncekiOdenen, odenecekGeciciVergi: r((donemNetKari + k.kkeg) * 0.25 - k.oncekiOdenen),
    },
    stokMaliyetOzet: {
      stokHesaplari: [{ kod: '153', hesapAdi: 'Ticari Mallar', bakiye: k.stok153 }],
      maliyetHesaplari: [{ kod: '621', hesapAdi: 'Satılan Ticari Mallar Maliyeti', bakiye: k.s621 }],
      toplamStok: r(k.stok153 + k.s621), satisMaliyeti: k.s621, kalanStok: k.stok153,
    },
  };
}
const GELIR_TABLOLARI = [
  gt('gt-2026-q2', 2, gunOnce(50), true, { s600: 4860000, s601: 0, s602: 12500, s610: 38400, s611: 0, s621: 3512750, s622: 0, s760: 148900, s770: 612430, s642: 18640, s646: 4210, s653: 2100, s656: 6930, s660: 41780, s679: 0, s689: 7420, kkeg: 12400, oncekiOdenen: 60420, stok153: 486220 }),
  gt('gt-2026-q1', 1, gunOnce(138), true, { s600: 2214000, s601: 0, s602: 4800, s610: 16900, s611: 0, s621: 1604300, s622: 0, s760: 71200, s770: 296150, s642: 8120, s646: 1450, s653: 900, s656: 2380, s660: 19860, s679: 0, s689: 3200, kkeg: 5200, oncekiOdenen: 0, stok153: 391600 }),
];
function gtOzet(g) { const { geciciVergiHesabi, stokMaliyetOzet, ...rest } = g; return rest; }

// ─────────────────────────────────────────────────────────────────────────────
// BİLANÇO (2026 Q2 — 30.06.2026, denk)
// ─────────────────────────────────────────────────────────────────────────────
function grup(ad, hesaplar) {
  const toplam = Math.round(hesaplar.reduce((s, h) => s + h.tutar, 0) * 100) / 100;
  return { grup: ad, toplam, hesaplar };
}
const BILANCO_AKTIF = {
  hazirDegerler: grup('A. Hazır Değerler', [{ kod: '100', ad: 'Kasa', tutar: 42130 }, { kod: '102', ad: 'Bankalar', tutar: 570350.35 }]),
  menkulKiymetler: grup('B. Menkul Kıymetler', []),
  ticariAlacaklar: grup('C. Ticari Alacaklar', [{ kod: '120', ad: 'Alıcılar', tutar: 1284900 }]),
  digerAlacaklar: grup('D. Diğer Alacaklar', [{ kod: '131', ad: 'Ortaklardan Alacaklar', tutar: 15000 }]),
  stoklar: grup('E. Stoklar', [{ kod: '153', ad: 'Ticari Mallar', tutar: 486220 }]),
  gelecekAylaraGiderler: grup('G. Gelecek Aylara Ait Giderler', [{ kod: '180', ad: 'Gelecek Aylara Ait Giderler', tutar: 24600 }]),
  digerDonenVarliklar: grup('H. Diğer Dönen Varlıklar', [{ kod: '191', ad: 'İndirilecek KDV', tutar: 138420 }]),
  maddiDuran: grup('D. Maddi Duran Varlıklar', [{ kod: '254', ad: 'Taşıtlar', tutar: 690000 }, { kod: '255', ad: 'Demirbaşlar', tutar: 214800 }, { kod: '257', ad: 'Birikmiş Amortismanlar (-)', tutar: -162500 }]),
  maddiOlmayanDuran: grup('E. Maddi Olmayan Duran Varlıklar', [{ kod: '260', ad: 'Haklar', tutar: 18000 }]),
};
const BILANCO_PASIF = {
  kvMaliBorclar: grup('A. Mali Borçlar', [{ kod: '300', ad: 'Banka Kredileri', tutar: 210000 }]),
  kvTicariBorclar: grup('B. Ticari Borçlar', [{ kod: '320', ad: 'Satıcılar', tutar: 934610 }]),
  kvDigerBorclar: grup('C. Diğer Borçlar', [{ kod: '335', ad: 'Personele Borçlar', tutar: 28400 }]),
  odenecekVergi: grup('F. Ödenecek Vergi ve Diğer Yükümlülükler', [{ kod: '360', ad: 'Ödenecek Vergi ve Fonlar', tutar: 61890.35 }, { kod: '361', ad: 'Ödenecek Sosyal Güvenlik Kesintileri', tutar: 34350 }]),
  digerKVYK: grup('I. Diğer Kısa Vadeli Yabancı Kaynaklar', [{ kod: '391', ad: 'Hesaplanan KDV', tutar: 74860 }]),
  uvMaliBorclar: grup('A. Mali Borçlar', [{ kod: '400', ad: 'Banka Kredileri', tutar: 320000 }]),
  odenmisSermaye: grup('A. Ödenmiş Sermaye', [{ kod: '500', ad: 'Sermaye', tutar: 500000 }]),
  karYedekleri: grup('C. Kâr Yedekleri', [{ kod: '540', ad: 'Yasal Yedekler', tutar: 86400 }]),
  gecmisKarZarar: grup('D. Geçmiş Yıllar Kârları', [{ kod: '570', ad: 'Geçmiş Yıllar Kârları', tutar: 543800 }]),
  donemKarZarar: grup('F. Dönem Net Kârı', [{ kod: '590', ad: 'Dönem Net Kârı', tutar: 527610 }]),
};
const topla = (o, keys) => Math.round(keys.reduce((s, k) => s + (o[k]?.toplam || 0), 0) * 100) / 100;
const DONEN = topla(BILANCO_AKTIF, ['hazirDegerler', 'menkulKiymetler', 'ticariAlacaklar', 'digerAlacaklar', 'stoklar', 'gelecekAylaraGiderler', 'digerDonenVarliklar']);
const DURAN = topla(BILANCO_AKTIF, ['maddiDuran', 'maddiOlmayanDuran']);
const KVYK = topla(BILANCO_PASIF, ['kvMaliBorclar', 'kvTicariBorclar', 'kvDigerBorclar', 'odenecekVergi', 'digerKVYK']);
const UVYK = topla(BILANCO_PASIF, ['uvMaliBorclar']);
const OZK = topla(BILANCO_PASIF, ['odenmisSermaye', 'karYedekleri', 'gecmisKarZarar', 'donemKarZarar']);
const BILANCOLAR = [
  {
    id: 'bl-2026-q2', taxpayerId: 'm1', taxpayer: MUKELLEF_FIRMA, mizanId: 'mz-2026-q2', donem: '2026-Q2', donemTipi: 'GECICI_Q2', tarih: '2026-06-30T00:00:00.000Z',
    createdAt: gunOnce(49), locked: false, lockedAt: null, lockNote: null,
    aktifToplami: DONEN + DURAN, pasifToplami: KVYK + UVYK + OZK, donenVarliklar: DONEN, duranVarliklar: DURAN, kvYabanciKaynak: KVYK, uvYabanciKaynak: UVYK, ozkaynaklar: OZK,
    aktif: BILANCO_AKTIF, pasif: BILANCO_PASIF,
    detay: { duzeltmeler: { donemNetKari: 527610, donemNetZarari: 0 } },
    gelirTablosuBagli: { id: 'gt-2026-q2', donemNetKari: 527610, onerilenKar: 527610, onerilenZarar: 0 },
    otomatikKaynak: null,
    finansalOzet: 'Likidite ve kârlılık güçlü; nakit oranındaki gerileme ve ortak cari bakiyesi izlenmeli.',
    oncekiDonemBilgi: { donem: '2026 1. Dönem' },
    finansalOranlar: {
      likidite: [
        { kod: 'cari', ad: 'Cari Oran', ideal: '1,5 – 2', degerFmt: '1,91', trend: 'up', degisimYuzde: 4.2, oncekiFmt: '1,83', yorum: '✓ Kısa vadeli borçları karşılama gücü yeterli' },
        { kod: 'asit', ad: 'Asit-Test Oranı', ideal: '≥ 1', degerFmt: '1,54', trend: 'flat', degisimYuzde: 0.6, oncekiFmt: '1,53', yorum: '✓ Stoksuz likidite güçlü' },
        { kod: 'nakit', ad: 'Nakit Oranı', ideal: '≥ 0,2', degerFmt: '0,46', trend: 'down', degisimYuzde: -8.1, oncekiFmt: '0,50', yorum: '⚠ Nakit oranı geriledi; tahsilat hızı izlenmeli' },
      ],
      maliYapi: [
        { kod: 'kaldirac', ad: 'Kaldıraç Oranı', ideal: '≤ 0,5', degerFmt: '0,50', trend: 'down', degisimYuzde: -3.4, oncekiFmt: '0,52', yorum: '✓ Yabancı kaynak payı dengeli' },
        { kod: 'borcOzk', ad: 'Borç / Özkaynak', ideal: '≤ 1', degerFmt: '1,00', trend: 'down', degisimYuzde: -5.0, oncekiFmt: '1,06', yorum: '⚠ Sınırda; iyileşme sürüyor' },
        { kod: 'ozkOran', ad: 'Özkaynak Oranı', ideal: '≥ 0,5', degerFmt: '0,50', trend: 'up', degisimYuzde: 3.1, oncekiFmt: '0,48', yorum: '✓ Özkaynak payı güçleniyor' },
      ],
      karlilik: [
        { kod: 'roa', ad: 'Aktif Kârlılığı', ideal: '≥ %5', degerFmt: '%15,9', trend: 'up', degisimYuzde: 12.4, oncekiFmt: '%14,1', yorum: '✓ Varlıklar verimli kullanılıyor' },
        { kod: 'roe', ad: 'Özkaynak Kârlılığı', ideal: '≥ %10', degerFmt: '%31,8', trend: 'up', degisimYuzde: 9.8, oncekiFmt: '%29,0', yorum: '✓ Ortaklar için yüksek getiri' },
        { kod: 'netMarj', ad: 'Net Kâr Marjı', ideal: '≥ %5', degerFmt: '%10,9', trend: 'flat', degisimYuzde: 0.4, oncekiFmt: '%10,9', yorum: '✓ Marj korunuyor' },
      ],
    },
  },
  {
    id: 'bl-2026-q1', taxpayerId: 'm1', taxpayer: MUKELLEF_FIRMA, mizanId: 'mz-2026-q1', donem: '2026-Q1', donemTipi: 'GECICI_Q1', tarih: '2026-03-31T00:00:00.000Z',
    createdAt: gunOnce(136), locked: true, lockedAt: gunOnce(134), lockNote: 'Geçici vergi 2026/1',
    aktifToplami: 2984310.2, pasifToplami: 2984310.2, donenVarliklar: 2236410.2, duranVarliklar: 747900, kvYabanciKaynak: 1246900.2, uvYabanciKaynak: 340000, ozkaynaklar: 1397410,
    aktif: BILANCO_AKTIF, pasif: BILANCO_PASIF, detay: { duzeltmeler: { donemNetKari: 236480, donemNetZarari: 0 } }, gelirTablosuBagli: null, otomatikKaynak: 'GELIR_TABLOSU', finansalOranlar: null,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// İŞLETME HESAP ÖZETİ (Erdoğan Balçık — 2026: 1. dönem kilitli, 2–3 açık, 4 yok)
// ─────────────────────────────────────────────────────────────────────────────
function iho(donem, k, locked) {
  const r = (x) => Math.round(x * 100) / 100;
  const toplamStok = r(k.donemBasiStok + k.malAlisi);
  const kalanStok = r(toplamStok - k.satilanMalMaliyeti);
  const netSatislar = r(k.satisHasilati - k.satilanMalMaliyeti);
  const donemKari = r(netSatislar - k.donemIciGiderler);
  const matrah = Math.max(0, r(donemKari - k.gecmisYilZarari));
  const hes = r(matrah * 0.15);
  return {
    id: `iho-2026-${donem}`, tenantId: 'moren', taxpayerId: 'm2', yil: 2026, donem,
    satisHasilati: k.satisHasilati, digerGelir: 0, malAlisi: k.malAlisi, donemBasiStok: k.donemBasiStok, kalanStok, toplamStok, satilanMalMaliyeti: k.satilanMalMaliyeti, netSatislar,
    donemIciGiderler: k.donemIciGiderler, donemKari, gecmisYilZarari: k.gecmisYilZarari, gecVergiMatrahi: matrah, hesaplananGecVergi: hes,
    oncekiOdenenGecVergi: k.oncekiOdenen, odenecekGecVergi: Math.max(0, r(hes - k.oncekiOdenen)), not: null,
    locked, lockedAt: locked ? gunOnce(120) : null, lockedBy: locked ? 'muzaffer' : null, lockNote: locked ? 'Geçici vergi 2026/1' : null,
    createdAt: gunOnce(150), updatedAt: gunOnce(2), taxpayer: MUKELLEF_SAHIS,
  };
}
const IHO_CEYREKLER = [
  iho(1, { satisHasilati: 412500, malAlisi: 296300, donemBasiStok: 58200, satilanMalMaliyeti: 288400, donemIciGiderler: 61750, gecmisYilZarari: 0, oncekiOdenen: 0 }, true),
  iho(2, { satisHasilati: 468900, malAlisi: 318750, donemBasiStok: 66100, satilanMalMaliyeti: 331200, donemIciGiderler: 66300, gecmisYilZarari: 0, oncekiOdenen: 9352.5 }, false),
  iho(3, { satisHasilati: 503200, malAlisi: 342600, donemBasiStok: 53650, satilanMalMaliyeti: 349800, donemIciGiderler: 70900, gecmisYilZarari: 0, oncekiOdenen: 20062.5 }, false),
  null,
];

// ─────────────────────────────────────────────────────────────────────────────
// AI MALİ YORUM
// ─────────────────────────────────────────────────────────────────────────────
const YORUMLAR = {
  MIZAN: 'Genel durum: Eylül 2026 mizanı borç/alacak dengesi içinde; hesap toplamları tutarlı, ana hesap kırılımları alt hesaplarla uyuşuyor.\n\nDikkat çekenler:\n- 131 Ortaklardan Alacaklar 15.000,00 TL bakiye taşıyor; dönem sonunda adat faizi hesaplanmalı.\n- 191 İndirilecek KDV bakiyesi KDV beyannamesindeki devreden tutarla 4.180,00 TL farklı; fatura girişleri kontrol edilmeli.\n- 335 Personele Borçlar alacak bakiyesi veriyor; ödenmemiş bordro olabilir.\n\nÖneriler:\n- Ortak cari hesabını kapatın ya da adat faizi faturası düzenleyin.\n- KDV farkı için Eylül alış faturalarını Fatura Merkezi ile karşılaştırın.',
  BILANCO: 'Genel durum: 30.06.2026 bilançosu denk; aktif toplamı 3,32 milyon TL, özkaynaklar toplam kaynakların yarısını oluşturuyor.\n\nDikkat çekenler:\n- Nakit oranı 0,50\'den 0,46\'ya geriledi; alıcılar bakiyesi (1,28 milyon TL) tahsilat hızını yavaşlatıyor.\n- Satıcılar 934.610,00 TL ile kısa vadeli borçların büyük kısmını oluşturuyor.\n\nÖneriler:\n- Vadesi 60 günü aşan alıcı bakiyeleri için tahsilat planı çıkarın.\n- Kısa vadeli banka kredisinin (210.000 TL) yenilenme koşullarını gözden geçirin.',
  GELIR_TABLOSU: 'Genel durum: 2026 ikinci geçici vergi dönemi net satışları 4,83 milyon TL; brüt kâr marjı %27,3 ile önceki döneme yakın seyretti.\n\nDikkat çekenler:\n- Genel yönetim giderleri (612.430,00 TL) net satışların %12,7\'si; ilk döneme göre pay arttı.\n- Finansman giderleri 41.780,00 TL; kısa vadeli kredi faizleri kâr üzerinde baskı yaratıyor.\n\nÖneriler:\n- Ödenecek geçici vergi 74.582,50 TL; beyanname öncesi KKEG tutarını (12.400,00 TL) belgeleriyle doğrulayın.\n- Satılan ticari mallar maliyeti için manuel düzeltme girildiyse stok sayımıyla karşılaştırın.',
  IHO: 'Genel durum: 2026 yılının ilk üç döneminde satış hasılatı düzenli artıyor (412.500 → 503.200 TL); brüt kâr marjı %30 civarında korunuyor.\n\nDikkat çekenler:\n- 3. dönem dönem içi giderleri 70.900,00 TL ile en yüksek seviyede; kira ve personel kalemleri incelenmeli.\n- Kalan stok 46.450,00 TL\'ye geriledi; dönem sonu sayımı ile teyit edilmeli.\n\nÖneriler:\n- 3. dönem geçici vergi matrahı için geçmiş yıl zararı girilmemiş; varsa beyanname öncesi işleyin.',
};
const yorumKaydi = new Map(); // `${kaynak}:${id}` → kayıt
function yorumUret(kaynak, kaynakId, derin) {
  const kayit = { id: `my-${kaynak}-${kaynakId}`, kaynak, kaynakId, donem: null, ozet: YORUMLAR[kaynak] || YORUMLAR.MIZAN, model: derin ? 'claude-sonnet-4' : 'claude-haiku-4', createdAt: gunOnce(1), updatedAt: gunOnce(1) };
  yorumKaydi.set(`${kaynak}:${kaynakId}`, kayit);
  return kayit;
}
// Önizlemede kutu dolu görünsün diye başlangıçta kayıt var
yorumUret('MIZAN', 'mz-2026-09', false);
yorumUret('BILANCO', 'bl-2026-q2', false);
yorumUret('GELIR_TABLOSU', 'gt-2026-q2', true);
yorumUret('IHO', 'm2:2026', false);

// ─────────────────────────────────────────────────────────────────────────────
// UÇLAR
// ─────────────────────────────────────────────────────────────────────────────
function uclar(yol, yontem, q, govde, jsonGonder, res) {
  let m;
  // ── Mizan ──
  if (yol === '/mizan/denetim-kriterleri' && yontem === 'GET') return jsonGonder(res, 200, DENETIM_KRITERLERI);
  if (yol === '/mizan/denetim-kriterleri' && yontem === 'POST') {
    const k = { id: `dk${DENETIM_KRITERLERI.length + 1}`, aktif: true, createdAt: SIMDI, ...(govde || {}) };
    DENETIM_KRITERLERI.push(k); return jsonGonder(res, 201, k);
  }
  if ((m = yol.match(/^\/mizan\/denetim-kriterleri\/([^/]+)$/))) {
    const i = DENETIM_KRITERLERI.findIndex((k) => k.id === m[1]);
    if (yontem === 'PATCH' && i >= 0) { Object.assign(DENETIM_KRITERLERI[i], govde || {}); return jsonGonder(res, 200, DENETIM_KRITERLERI[i]); }
    if (yontem === 'DELETE' && i >= 0) { DENETIM_KRITERLERI.splice(i, 1); return jsonGonder(res, 200, { ok: true }); }
  }
  if (yol === '/mizan' && yontem === 'GET') return jsonGonder(res, 200, MIZANLAR.filter((x) => !q.taxpayerId || x.taxpayerId === q.taxpayerId).map(mizanOzet));
  if ((m = yol.match(/^\/mizan\/([^/]+)$/))) {
    const x = MIZANLAR.find((y) => y.id === m[1]);
    if (!x) return jsonGonder(res, 404, { message: 'Mizan yok' });
    if (yontem === 'GET') return jsonGonder(res, 200, mizanDetay(x));
    if (yontem === 'DELETE') { MIZANLAR.splice(MIZANLAR.indexOf(x), 1); return jsonGonder(res, 200, { ok: true }); }
  }
  if ((m = yol.match(/^\/mizan\/([^/]+)\/(lock|unlock|analyze)$/))) {
    const x = MIZANLAR.find((y) => y.id === m[1]);
    if (!x) return jsonGonder(res, 404, { message: 'Mizan yok' });
    if (m[2] === 'lock') { x.locked = true; x.lockedAt = SIMDI; x.lockNote = (govde && govde.note) || null; }
    if (m[2] === 'unlock') { x.locked = false; x.lockedAt = null; x.lockNote = null; }
    return jsonGonder(res, 200, mizanDetay(x));
  }
  if ((m = yol.match(/^\/mizan\/([^/]+)\/export-excel$/))) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(Buffer.from('sahte')); return true; }

  // ── Gelir tablosu ──
  if (yol === '/gelir-tablosu' && yontem === 'GET') return jsonGonder(res, 200, GELIR_TABLOLARI.filter((x) => !q.taxpayerId || x.taxpayerId === q.taxpayerId).map(gtOzet));
  if ((m = yol.match(/^\/gelir-tablosu\/([^/]+)$/))) {
    const x = GELIR_TABLOLARI.find((y) => y.id === m[1]);
    if (!x) return jsonGonder(res, 404, { message: 'Gelir tablosu yok' });
    if (yontem === 'GET') return jsonGonder(res, 200, x);
    if (yontem === 'DELETE') { GELIR_TABLOLARI.splice(GELIR_TABLOLARI.indexOf(x), 1); return jsonGonder(res, 200, { ok: true }); }
  }
  if ((m = yol.match(/^\/gelir-tablosu\/([^/]+)\/(lock|unlock|duzeltmeler)$/))) {
    const x = GELIR_TABLOLARI.find((y) => y.id === m[1]);
    if (!x) return jsonGonder(res, 404, { message: 'Gelir tablosu yok' });
    if (m[2] === 'lock') { x.locked = true; x.lockedAt = SIMDI; }
    if (m[2] === 'unlock') { x.locked = false; x.lockedAt = null; }
    if (m[2] === 'duzeltmeler') x.duzeltmeler = { ...(x.duzeltmeler || {}), ...((govde && govde.duzeltmeler) || {}) };
    return jsonGonder(res, 200, x);
  }
  if ((m = yol.match(/^\/gelir-tablosu\/([^/]+)\/export-excel$/))) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(Buffer.from('sahte')); return true; }

  // ── Bilanço ──
  if (yol === '/bilanco' && yontem === 'GET') return jsonGonder(res, 200, BILANCOLAR.filter((x) => !q.taxpayerId || x.taxpayerId === q.taxpayerId));
  if ((m = yol.match(/^\/bilanco\/([^/]+)$/))) {
    const x = BILANCOLAR.find((y) => y.id === m[1]);
    if (!x) return jsonGonder(res, 404, { message: 'Bilanço yok' });
    if (yontem === 'GET') return jsonGonder(res, 200, x);
    if (yontem === 'DELETE') { BILANCOLAR.splice(BILANCOLAR.indexOf(x), 1); return jsonGonder(res, 200, { ok: true }); }
  }
  if ((m = yol.match(/^\/bilanco\/([^/]+)\/(lock|unlock|duzeltmeler)$/))) {
    const x = BILANCOLAR.find((y) => y.id === m[1]);
    if (!x) return jsonGonder(res, 404, { message: 'Bilanço yok' });
    if (m[2] === 'lock') { x.locked = true; x.lockedAt = SIMDI; x.lockNote = (govde && govde.note) || null; }
    if (m[2] === 'unlock') { x.locked = false; x.lockedAt = null; x.lockNote = null; }
    if (m[2] === 'duzeltmeler') x.detay = { ...(x.detay || {}), duzeltmeler: { ...((x.detay || {}).duzeltmeler || {}), ...((govde && govde.duzeltmeler) || {}) } };
    return jsonGonder(res, 200, x);
  }
  if ((m = yol.match(/^\/bilanco\/([^/]+)\/export-excel$/))) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(Buffer.from('sahte')); return true; }

  // ── İşletme Hesap Özeti ──
  if ((m = yol.match(/^\/isletme-hesap-ozeti\/yil\/([^/]+)\/(\d{4})$/))) {
    const yil = Number(m[2]);
    if (m[1] !== 'm2' || yil !== 2026) return jsonGonder(res, 200, { yil, taxpayer: null, ceyrekler: [null, null, null, null] });
    return jsonGonder(res, 200, { yil: 2026, taxpayer: MUKELLEF_SAHIS, ceyrekler: IHO_CEYREKLER });
  }
  if (yol === '/isletme-hesap-ozeti' && yontem === 'GET') return jsonGonder(res, 200, IHO_CEYREKLER.filter(Boolean));
  if (yol === '/isletme-hesap-ozeti/olustur' && yontem === 'POST') return jsonGonder(res, 201, IHO_CEYREKLER[1]);
  if ((m = yol.match(/^\/isletme-hesap-ozeti\/([^/]+)\/(lock|unlock|luca-cek)$/))) {
    const x = IHO_CEYREKLER.find((y) => y && y.id === m[1]);
    if (!x) return jsonGonder(res, 404, { message: 'Dönem yok' });
    if (m[2] === 'lock') { x.locked = true; x.lockedAt = SIMDI; }
    if (m[2] === 'unlock') { x.locked = false; x.lockedAt = null; }
    if (m[2] === 'luca-cek') return jsonGonder(res, 200, { jobId: 'sahte-luca-job', status: 'pending' });
    return jsonGonder(res, 200, x);
  }
  if ((m = yol.match(/^\/isletme-hesap-ozeti\/luca-job\/([^/]+)$/))) return jsonGonder(res, 200, { job: { id: m[1], status: 'done', message: 'Tamamlandı' }, kayit: IHO_CEYREKLER[1] });
  if ((m = yol.match(/^\/isletme-hesap-ozeti\/([^/]+)$/))) {
    const x = IHO_CEYREKLER.find((y) => y && y.id === m[1]);
    if (!x) return jsonGonder(res, 404, { message: 'Dönem yok' });
    if (yontem === 'PATCH') { Object.assign(x, govde || {}); x.updatedAt = SIMDI; return jsonGonder(res, 200, x); }
    if (yontem === 'DELETE') return jsonGonder(res, 200, { ok: true });
    if (yontem === 'GET') return jsonGonder(res, 200, x);
  }
  if ((m = yol.match(/^\/isletme-hesap-ozeti\/([^/]+)\/export-excel$/))) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(Buffer.from('sahte')); return true; }

  // ── AI mali yorum ──
  if ((m = yol.match(/^\/mali-yorum\/([A-Z_]+)\/([^/]+)\/uret$/)) && yontem === 'POST') return jsonGonder(res, 200, yorumUret(m[1], decodeURIComponent(m[2]), q.derin === '1'));
  if ((m = yol.match(/^\/mali-yorum\/([A-Z_]+)\/([^/]+)$/)) && yontem === 'GET') return jsonGonder(res, 200, yorumKaydi.get(`${m[1]}:${decodeURIComponent(m[2])}`) || null);

  return false;
}
module.exports = { uclar };
