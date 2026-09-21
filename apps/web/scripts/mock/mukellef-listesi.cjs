// Mükellef Listesi (/panel/mukellef-listesi) — beyaz tema önizlemesi için sahte veri (2026-09-21).
//
// Yerleşik `GET /taxpayers` ucu (mock-api.cjs) eklentilerden ÖNCE yanıt verdiği ve isActive / taxOffice /
// şifre alanlarını döndürmediği için, zengin liste burada `GET /sahte/mukellef-listesi/taxpayers` olarak sunulur;
// önizleme betiği (scripts/onizleme/mukellef-listesi-goruntule.cjs) tarayıcı isteğini bu uca yönlendirir.
// Durum değişimi (PUT) ve silme (DELETE) bellekte tutulur; sunucu yeniden başlayınca sıfırlanır.

const VD = ['BÜYÜKÇEKMECE', 'BEYLİKDÜZÜ', 'AVCILAR', 'ESENYURT', 'SİLİVRİ', 'BAKIRKÖY'];

function firma(id, ad, vkn, i, ek = {}) {
  return {
    id, type: 'TUZEL_KISI', companyName: ad, firstName: null, lastName: null, taxNumber: vkn,
    taxOffice: VD[i % VD.length], email: `info@${id}.com.tr`, emails: [], phone: `0532 ${String(100 + i).padStart(3, '0')} ${String(10 + i).padStart(2, '0')} ${String(20 + i).padStart(2, '0')}`, phones: [],
    isActive: true, isEFaturaMukellefi: true, mihsapDefterTuru: 'BILANCO', defterTuru: 'BILANCO', lucaSlug: id, mihsapId: String(1000 + i),
    hasVergiDairesiCredential: true, hasSgkCredential: true, startDate: '2021-03-01T00:00:00.000Z', endDate: null,
    address: 'Örnek Mah. Deneme Cad. No: 1', evrakTeslimGunu: 10, ...ek,
  };
}
function sahis(id, ad, soyad, tc, i, ek = {}) {
  return {
    id, type: 'GERCEK_KISI', companyName: null, firstName: ad, lastName: soyad, taxNumber: tc,
    taxOffice: VD[i % VD.length], email: `${id}@ornek.com`, emails: [], phone: `0533 ${String(200 + i).padStart(3, '0')} ${String(30 + i).padStart(2, '0')} ${String(40 + i).padStart(2, '0')}`, phones: [],
    isActive: true, isEFaturaMukellefi: false, mihsapDefterTuru: 'ISLETME', defterTuru: 'ISLETME', lucaSlug: id, mihsapId: String(2000 + i),
    hasVergiDairesiCredential: true, hasSgkCredential: false, startDate: '2022-01-15T00:00:00.000Z', endDate: null,
    address: 'Örnek Mah. Deneme Sok. No: 5', evrakTeslimGunu: 12, ...ek,
  };
}

/** İlk 8 kayıt yerleşik sahte listeyle aynı kimlik/adı taşır (mükellef kartı uçları çalışsın). */
const MUKELLEFLER = [
  firma('m1', 'Öz Ela Gıda San. ve Tic. Ltd. Şti.', '6420011234', 0),
  sahis('m2', 'Erdoğan', 'Balçık', '14523698745', 1),
  sahis('m3', 'Ayşegül', 'Kaya', '25874136982', 2, { mihsapDefterTuru: 'BASIT_USUL', defterTuru: 'BASIT_USUL', hasVergiDairesiCredential: false }),
  firma('m4', 'Mert Reklam Ajansı Ltd. Şti.', '6170045678', 3, { hasSgkCredential: false }),
  firma('m5', 'Famcoffee Kahve A.Ş.', '3850098765', 4),
  firma('m6', 'Ela Tekstil Ltd. Şti.', '3250076543', 5, { isActive: false, endDate: '2025-12-31T00:00:00.000Z' }),
  firma('m7', 'Balçık İnşaat A.Ş.', '1400032109', 6),
  sahis('m8', 'Dilek', 'Bayageldi', '36985214778', 7, { email: '', phone: '' }),
  firma('m9', 'Çınar Nakliyat Ltd. Şti.', '2310067890', 8, { phone: '' }),
  sahis('m10', 'Gülşah', 'Demir', '41236587412', 9, { mihsapDefterTuru: 'BASIT_USUL', defterTuru: 'BASIT_USUL' }),
  sahis('m11', 'Hüseyin', 'Salı', '52147896325', 10, { hasSgkCredential: true }),
  firma('m12', 'İpek Mobilya San. Tic. Ltd. Şti.', '4720098123', 11),
  sahis('m13', 'Selin', 'Aydın', '63258741596', 12, { companyName: 'Kardelen Eczanesi', hasSgkCredential: true }),
  firma('m14', 'Lale Turizm A.Ş.', '6080034567', 13, { isActive: false, endDate: '2026-02-28T00:00:00.000Z', hasVergiDairesiCredential: false }),
  sahis('m15', 'Mehmet', 'Yıldız', '74125896321', 14, { isActive: false, endDate: '2024-06-30T00:00:00.000Z' }),
  firma('m16', 'Nur Otomotiv Ltd. Şti.', '6310056789', 15),
  sahis('m17', 'Ömer', 'Özen', '85214796352', 16),
  sahis('m18', 'Pınar', 'Çelik', '96325874125', 17, { companyName: 'Pınar Kuaför', email: '' }),
  firma('m19', 'Sakarya Hayvancılık Ltd. Şti.', '7400021345', 18, { hasVergiDairesiCredential: false }),
  firma('m20', 'Şahin Elektrik Ltd. Şti.', '7990054321', 19),
  firma('m21', 'Tuna Bilişim A.Ş.', '8590076543', 20),
  sahis('m22', 'Uğur', 'Kaplan', '15975346821', 21, { companyName: 'Uğur Market', mihsapDefterTuru: 'BASIT_USUL', defterTuru: 'BASIT_USUL', phone: '' }),
  firma('m23', 'Zeyrek Lojistik Ltd. Şti.', '9980012345', 22),
  sahis('m24', 'Ali', 'Yılmaz', '35715948623', 23, { companyName: 'Yılmaz Kırtasiye', isActive: false, endDate: '2025-09-30T00:00:00.000Z' }),
  firma('m25', 'Vadi Yapı Ltd. Şti.', '9210034567', 24),
  firma('m26', 'Rüzgar Enerji A.Ş.', '7350065432', 25, { isActive: false, endDate: '2026-05-31T00:00:00.000Z', hasSgkCredential: false }),
];

const adi = (m) => m.companyName || `${m.firstName || ''} ${m.lastName || ''}`.trim();

function ozet(m, reason) {
  return { id: m.id, name: adi(m), taxNumber: m.taxNumber, taxOffice: m.taxOffice, reason };
}

/** Şifre / uyarı sayaçları — canlı uçtaki kart yapısı (key, label, tone, count, taxpayers). */
function sifreSayaclari() {
  const bul = (id) => MUKELLEFLER.find((m) => m.id === id);
  const gibYanlis = [ozet(bul('m4'), 'İnteraktif VD girişi: şifre hatalı (son deneme 3 gün önce)'), ozet(bul('m19'), 'İnteraktif VD girişi: şifre hatalı (son deneme dün)')];
  const sgkYanlis = [ozet(bul('m7'), 'e-Bildirge girişi: sistem şifresi reddedildi'), ozet(bul('m11'), 'e-Bildirge girişi: işyeri şifresi reddedildi')];
  return {
    cards: [
      { key: 'sgk_same', label: 'Bildirge şifresi aynı olanlar', tone: 'blue', count: 0, taxpayers: [] },
      { key: 'gib_same', label: 'VD şifresi aynı olanlar', tone: 'blue', count: 0, taxpayers: [] },
      { key: 'gib_wrong', label: 'VD şifresi yanlış olanlar', tone: 'amber', count: gibYanlis.length, taxpayers: gibYanlis },
      { key: 'sgk_wrong', label: 'Bildirge şifresi yanlış olanlar', tone: 'amber', count: sgkYanlis.length, taxpayers: sgkYanlis },
      { key: 'workplace_iz', label: 'İş yeri "iz" olanlar', tone: 'blue', count: 0, taxpayers: [] },
    ],
  };
}

function aramaUyar(m, arama) {
  if (!arama) return true;
  const a = String(arama).toLocaleLowerCase('tr-TR');
  return [adi(m), m.taxNumber, m.taxOffice].some((v) => String(v || '').toLocaleLowerCase('tr-TR').includes(a));
}

function uclar(yol, yontem, q, govde, jsonGonder, res) {
  if (yontem === 'GET' && yol === '/portal-automation/credential-insights') return jsonGonder(res, 200, sifreSayaclari());
  if (yontem === 'GET' && yol === '/sahte/mukellef-listesi/taxpayers') {
    return jsonGonder(res, 200, MUKELLEFLER.filter((m) => aramaUyar(m, q.search)));
  }
  const tek = /^\/(?:sahte\/mukellef-listesi\/)?taxpayers\/([^/]+)$/.exec(yol);
  if (tek && yontem === 'PUT') {
    const m = MUKELLEFLER.find((x) => x.id === tek[1]);
    if (!m) return false;
    if (govde && typeof govde.isActive === 'boolean') m.isActive = govde.isActive;
    console.log('[mock] mükellef durum', m.id, m.isActive ? 'aktif' : 'pasif');
    return jsonGonder(res, 200, m);
  }
  if (tek && yontem === 'DELETE') {
    const i = MUKELLEFLER.findIndex((x) => x.id === tek[1]);
    if (i < 0) return jsonGonder(res, 404, { message: 'Mükellef bulunamadı' });
    const [silinen] = MUKELLEFLER.splice(i, 1);
    console.log('[mock] mükellef silindi', silinen.id);
    return jsonGonder(res, 200, { ok: true, id: silinen.id });
  }
  return false;
}

module.exports = { uclar, MUKELLEFLER, mukellefAdi: adi };
