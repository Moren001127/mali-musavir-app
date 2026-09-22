// ============================================================
// İşletme Defteri (GİB Defter-Beyan) referans verisi
// Kaynak: Mihsap İşletme fatura-işleme formu — API yanıtları birebir yakalandı 2026-06-23.
// Hem web (Muhasebeleştir → İşletme formu) hem api (Luca İşletme CSV eşlemesi) kullanır.
// faturaTuru: SATIS = Gelir, ALIS = Gider (invoiceKind ile eşleşir).
// ============================================================

export type IsletmeRefItem = { kod: string; ad: string; donem?: boolean };

// İşlem Türü — SADECE SATIŞ (Gelir) formunda görünür (15)
export const ISLETME_ISLEM_TURU: IsletmeRefItem[] = [
  { kod: '1100', ad: 'Yurtiçi Teslim ve Hizmetleri' },
  { kod: '1101', ad: 'Yenilenmiş Cep Telefonu Satışları' },
  { kod: '701', ad: 'İhracatı Yapılacak Nihai Ürünlerin Teslimi (11/1-C)' },
  { kod: '702', ad: 'DİİB/GKİB Sahiplerine Geçici 17. Madde Kapsamında Teslim' },
  { kod: '1001', ad: 'Altından Mamul Eşya Teslimleri' },
  { kod: '1002', ad: 'Gümüşten Mamul Eşya Teslimleri' },
  { kod: '1003', ad: 'Kıymetli Taş Teslimleri' },
  { kod: '1004', ad: 'İkinci El Araç Ticareti' },
  { kod: '1005', ad: 'İkinci El Taşınmaz Ticareti' },
  { kod: '1006', ad: 'Gazete, Dergi ve Benzeri Periyodik Yayınlar' },
  { kod: '1007', ad: 'Tütün Mamulü Teslimleri' },
  { kod: '1008', ad: 'Belediyeler Tarafından Yapılan Şehir İçi Yolcu Taşımacılığı' },
  { kod: '1009', ad: 'Ön Ödemeli Elektronik Haberleşme Hizmetleri' },
  { kod: '1010', ad: 'TŞOF Tarafından Araç Plakaları ile Basılı Evrak Teslimi' },
  { kod: '1011', ad: 'Şans Oyunları, Profesyonel Gösteriler ve Açık Artırmalar' },
];

export const ISLETME_KDV_ORAN: IsletmeRefItem[] = [
  { kod: 'KDV20', ad: '%20 Kdv' },
  { kod: 'KDV10', ad: '%10 Kdv' },
  { kod: 'KDV1', ad: '%1 Kdv' },
  { kod: 'KDV0', ad: '%0 Kdv' },
];

// ===== SATIŞ (Gelir) =====
const SATIS_BELGE: IsletmeRefItem[] = [
  // 2026-09-15: Luca gelir belge türü listesi "e-Arşiv Fatura" (yalnız "e-Arşiv" CSV'de reddediliyordu: AYTEKİN ÖZDEMİR satış)
  { kod: '8', ad: 'e-Arşiv Fatura' }, { kod: '7', ad: 'e-Fatura' }, { kod: '1', ad: 'Fatura' },
  { kod: '3', ad: 'Perakende Satış Fişi' }, { kod: '2', ad: 'Z Raporu' }, { kod: '15', ad: 'e-Bilet' },
  { kod: '11', ad: 'Tevsiki Zaruri Olmayan Gelir' }, { kod: '13', ad: 'Yolcu Taşıma Bileti' }, { kod: '6', ad: 'Diğer' },
];
const SATIS_AS: IsletmeRefItem[] = [
  { kod: '1', ad: 'Normal Satış' }, { kod: '2', ad: 'Kısmi Tevkifat Uygulanan İşlemler' },
  { kod: '4', ad: 'Kısmi İstisna Kapsamına Giren İşlemler' }, { kod: '5', ad: 'Tam İstisna Kapsamına Giren İşlemler' },
  { kod: '3', ad: 'Diğer İşlemler (KDV Beyannamesi)' }, { kod: '6', ad: 'Özel Matrah' },
  { kod: '13', ad: 'İsteğe Bağlı Tam Tevkifat Uygulanan İşlemler' }, { kod: '10', ad: 'Diğer' },
];
const SATIS_KAYIT: IsletmeRefItem[] = [
  { kod: '1', ad: 'Mal Satışı' }, { kod: '2', ad: 'Hizmet Satışı' }, { kod: '4', ad: 'Diğer Hasılat' }, { kod: '14', ad: 'Diğer Gelir' },
];
const SATIS_ALT_MAL: IsletmeRefItem[] = [
  { kod: '2', ad: 'Mal Satışı' },
  { kod: '3', ad: 'Dönem Sonu Emtia' },
  { kod: '99043', ad: 'İkinci El Araç ve Taşınmaz Ticareti' },
  { kod: '99098', ad: 'Diğer Özel Matrah Satışları' },
  { kod: '99031', ad: 'Altından mamül veya altın ihtiva eden ziynet eşyaları ile sikke altınların teslim ve ithali (KDVK md. 23/e)' },
  { kod: '99034', ad: 'Külçe gümüş ve gümüşten mamül eşya teslimleri (69 no’lu KDV GT)' },
  { kod: '99032', ad: 'Tütün Mamulü Teslimleri' },
  { kod: '99033', ad: 'Gazete, dergi ve benzeri periyodik yayınlar (11 no’lu KDV GT)' },
  { kod: '99035', ad: 'Belediyeler tarafından yapılan şehiriçi yolcu taşımacılığı bilet/kart bayi satışı (81 no’lu KDV GT)' },
  { kod: '99028', ad: 'Gümrük depolarında ve müzayede salonlarında yapılan satışlar (KDVK md. 23/d)' },
  { kod: '99021', ad: 'Milli piyango, spor-toto ve benzeri Devletçe organize edilen organizasyonlar (KDVK md. 23/a)' },
  { kod: '99038', ad: 'Ön Ödemeli Elektronik Haberleşme Hizmet Teslimleri, telefon kartı ve jeton satışları' },
];
const SATIS_ALT_HIZMET: IsletmeRefItem[] = [
  { kod: '188', ad: 'Hizmet Satışı' },
  { kod: '189', ad: 'Konaklama Hizmeti' },
  { kod: '186', ad: 'Yıllara Yaygın İnşaat ve Onarım Hakediş Bedeli' },
  { kod: '99044', ad: 'İkinci El Araç ve Taşınmaz Ticareti' },
  { kod: '99099', ad: 'Diğer Özel Matrah Satışları' },
  { kod: '99041', ad: 'Ön Ödemeli Elektronik Haberleşme Hizmetleri' },
  { kod: '99024', ad: 'At yarışları ve diğer müşterek bahis ve talih oyunları (KDVK md. 23/b)' },
  { kod: '99022', ad: 'Milli piyango, spor-toto ve benzeri Devletçe organize edilen organizasyonlar (KDVK md. 23/a)' },
  { kod: '99026', ad: 'Profesyonel gösteri, konser ve sportif faaliyetler (KDVK md. 23/c)' },
  { kod: '99029', ad: 'Gümrük depolarında ve müzayede salonlarında yapılan satışlar (KDVK md. 23/d)' },
  { kod: '99036', ad: 'Belediyeler tarafından yapılan şehiriçi yolcu taşımacılığı bilet/kart bayi satışı (81 no’lu KDV GT)' },
  { kod: '99039', ad: 'TŞOF tarafından araç plakaları ile sürücü kurslarında kullanılan evrakın basımı (91 no’lu KDV GT)' },
];
const SATIS_ALT_DIGER_HASILAT: IsletmeRefItem[] = [
  { kod: '14', ad: 'Faiz Geliri' }, { kod: '15', ad: 'Kur Farkı Geliri' }, { kod: '138', ad: 'Komisyon Geliri' },
  { kod: '151', ad: 'Yansıtma Geliri' }, { kod: '171', ad: 'VUK 322 Kapsamına Giren Borçlara Ait Gelirler' },
  { kod: '8', ad: 'Ar-Ge Destekleri' }, { kod: '6', ad: 'Kosgeb Destekleri' }, { kod: '4', ad: 'SGK Teşvikleri' },
  { kod: '183', ad: 'Ticari Plaka Satış' }, { kod: '185', ad: 'İkinci El Motorlu Kara Taşıtı veya Taşınmaz Satışı' },
  { kod: '184', ad: 'İkinci El Motorlu Kara Taşıtlarının Ticareti (KDV Düzeltmesi)' }, { kod: '99001', ad: 'Diğer' },
  { kod: '99100', ad: 'Diğer Özel Matrah Satışları' }, { kod: '99045', ad: 'İkinci El Araç ve Taşınmaz Ticareti' },
  { kod: '99025', ad: 'At yarışları ve diğer müşterek bahis ve talih oyunları (KDVK md. 23/b)' },
  { kod: '99023', ad: 'Milli piyango, spor-toto ve benzeri organizasyonlar (KDVK md. 23/a)' },
  { kod: '99027', ad: 'Profesyonel gösteri, konser ve sportif faaliyetler (KDVK md. 23/c)' },
  { kod: '99030', ad: 'Gümrük depoları ve müzayede salonu satışları (KDVK md. 23/d)' },
  { kod: '99037', ad: 'Belediyeler şehiriçi yolcu taşımacılığı bilet/kart bayi satışı (81 no’lu KDV GT)' },
  { kod: '99040', ad: 'TŞOF araç plakaları ile sürücü kursu evrakı basımı (91 no’lu KDV GT)' },
  { kod: '99042', ad: 'Ön Ödemeli Elektronik Haberleşme Hizmetleri' },
];
const SATIS_ALT_DIGER_GELIR: IsletmeRefItem[] = [{ kod: '187', ad: 'Diğer Gelir' }];

// ===== GİDER (Alış) =====
const GIDER_BELGE: IsletmeRefItem[] = [
  { kod: '10', ad: 'e-Arşiv Fatura' }, { kod: '9', ad: 'e-Fatura' }, { kod: '1', ad: 'Fatura' }, { kod: '2', ad: 'ÖKC Fişi' },
  { kod: '3', ad: 'Perakende Satış Fişi' }, { kod: '5', ad: 'Gider Pusulası' }, { kod: '4', ad: 'Serbest Meslek Makbuzu' },
  { kod: '13', ad: 'e-Serbest Meslek Makbuzu' }, { kod: '18', ad: 'e-Bilet' }, { kod: '19', ad: 'Yolcu Taşıma Bileti' }, { kod: '8', ad: 'Diğer' },
];
// PLAN/15 Faz 3 (#38, 2026-09-12): "Sabit Kıymet Satış Zararı" DBS'de alış türü + kayıt türü + alt tür olarak
//   üçü de aynı adla var (defterbeyan.gov.tr yardım: Gider ekle → belge türü Diğer → alış türü / kayıt türü / alt tür
//   "Sabit Kıymet Satış Zararı"). Mihsap yakalamasında yoktu → liste sonuna eklendi. KODLAR portal-içi (CSV ada çevirir;
//   luca-excel.service adOf/kayitAltAdResolved) — DBS'nin resmi sayısal kodu bilinmiyor, çakışmayan değer seçildi.
const GIDER_AS: IsletmeRefItem[] = [{ kod: '1', ad: 'Normal Alım' }, { kod: '2', ad: 'Satıştan İade' }, { kod: '3', ad: 'Sabit Kıymet Satış Zararı' }];
const GIDER_KAYIT: IsletmeRefItem[] = [
  { kod: '1', ad: 'Mal Alışı' }, { kod: '4', ad: 'İndirilecek Giderler (GVK Md. 40)' },
  { kod: '5', ad: 'Gider Kabul Edilmeyen Ödemeler (GVK Md. 41)' }, { kod: '13', ad: 'Sabit Kıymet Alışı' }, { kod: '10', ad: 'Sabit Kıymet Ek Maliyet' },
  { kod: '20', ad: 'Sabit Kıymet Satış Zararı' },
];
const GIDER_ALT_SABIT_SATIS_ZARARI: IsletmeRefItem[] = [{ kod: '600', ad: 'Sabit Kıymet Satış Zararı' }];
const GIDER_ALT_MAL: IsletmeRefItem[] = [{ kod: '186', ad: 'Mal Alışı' }, { kod: '164', ad: 'Dönem Başı Emtia' }];
const GIDER_ALT_SABIT_EK: IsletmeRefItem[] = [
  { kod: '249', ad: 'Sabit Kıymetin Ekonomik Faydasını Artıran Bakım Onarım ve Ek Harcamalar' },
  { kod: '248', ad: 'Sabit Kıymetin Ekonomik Ömrünü Uzatan Bakım Onarım ve Ek Harcamalar' },
  { kod: '244', ad: 'Nakliye Giderleri' }, { kod: '245', ad: 'Navlun ve Sigorta Giderleri' },
  { kod: '246', ad: 'Gümrükleme ve Antrepo Giderleri' }, { kod: '500', ad: 'Tapu Harcı' },
  { kod: '259', ad: 'Faiz Giderleri' }, { kod: '243', ad: 'Kur Farkı Giderleri' }, { kod: '247', ad: 'Vade Farkı Giderleri' }, { kod: '258', ad: 'Diğer' },
];
const GIDER_ALT_SABIT: IsletmeRefItem[] = [
  { kod: '253', ad: 'Amortisman Giderleri (GVK 40/7)' }, { kod: '254', ad: 'Amortisman Giderleri (GVK 57/6)' },
  { kod: '336', ad: 'Amortisman Giderleri (40/7) - Binek İkinci El Araç' },
  { kod: '337', ad: 'Amortisman Giderleri (40/7) - Binek Sıfır Araç (KDV-ÖTV Dâhil)' },
  { kod: '338', ad: 'Amortisman Giderleri (40/7) - Binek Sıfır Araç (KDV-ÖTV Hariç)' },
  { kod: '256', ad: 'Esas Faaliyet Konusu İle İlgili Olmayan Vasıtalara Ait Amortismanlar (4008 Md.25)' },
  { kod: '501', ad: 'Esas Faaliyetle İlgili Olmayan Yat/Kotra/Tekne/Uçak/Helikopter Amortismanları' },
  { kod: '257', ad: 'VUK Hükümlerine Aykırı Olarak Ayrılan Amortismanlar' },
  { kod: '255', ad: 'Zirai Faaliyet Yanında Şahsi/Ailevi İhtiyaçlarda Kullanılan Taşıtlar' },
];
const GIDER_ALT_GKEG: IsletmeRefItem[] = [
  { kod: '201', ad: 'Diğer K.K.E.G.', donem: true },
  { kod: '200', ad: 'Bağış ve Yardımlar' },
  { kod: '219', ad: 'Binek otomobillerin MTV’si' },
  { kod: '317', ad: 'Brüt Ücret' }, { kod: '320', ad: 'İkramiye Ödemeleri' }, { kod: '321', ad: 'Prim Ödemeleri' },
  { kod: '318', ad: 'Sgk İşveren Payı' }, { kod: '319', ad: 'İşsizlik İşveren Payı' },
  { kod: '159', ad: 'Her türlü para/vergi cezaları ile teşebbüs sahibinin suçlarından doğan tazminatlar' },
  { kod: '169', ad: 'Öz sermayeyi aşan yabancı kaynaklar için faiz/komisyon/vade farkı/kur farkı vb. gider ve maliyetler', donem: true },
  { kod: '167', ad: 'Alkol/alkollü içki ve tütün mamullerine ait ilan ve reklam giderlerinin %50’si (3571 Md.8)', donem: true },
  { kod: '158', ad: 'İlişkili kişilerle emsallere uygunluk ilkesine aykırı oluşan giderler (5615 Md.3)', donem: true },
  { kod: '154', ad: 'Teşebbüs sahibi/eşi/çocuklarının işletmeden çektikleri paralar veya aynen aldıkları sair değerler' },
  { kod: '155', ad: 'Teşebbüs sahibinin kendisine/eşine/çocuklarına ödenen aylık/ücret/ikramiye/komisyon/tazminat' },
  { kod: '156', ad: 'Teşebbüs sahibinin işletmeye koyduğu sermaye için yürütülecek faizler' },
  { kod: '157', ad: 'Teşebbüs sahibinin/eşinin/çocuklarının cari hesap alacakları üzerinden yürütülecek faizler' },
  { kod: '170', ad: 'Basın/yayın yoluyla işlenen fiillerden doğan maddi-manevi zarar tazminatları (4756 Md.28)' },
  { kod: '221', ad: 'KDV Kanunu Md. 30/d Uyarınca İndirilemeyen KDV Tutarı' },
  { kod: '240', ad: 'Kayıp ve Zayi Olan Mallara Ait Giderler' },
  { kod: '261', ad: 'Esas faaliyet konusu ile ilgili olmayan vasıta giderleri (4008 Md.25)', donem: true },
  { kod: '262', ad: 'Esas faaliyet konusu ile ilgili olmayan vasıtalara ait amortismanlar (4008 Md.25)' },
  { kod: '234', ad: 'Esas faaliyetle ilgili olmayan yat/kotra/tekne/uçak/helikopter amortismanları', donem: true },
  { kod: '241', ad: 'Esas faaliyetle ilgili olmayan yat/kotra/tekne/uçak/helikopter giderleri', donem: true },
  { kod: '238', ad: 'İşsizlik Sigortası Fonu’ndan Karşılanan Sigorta Primleri' },
  { kod: '239', ad: 'Hazine Tarafından Karşılanan Özürlü Personelin Sigorta Primi' },
  { kod: '172', ad: 'Özel iletişim vergisi' },
];

export type IsletmeContext = {
  belgeTuru: IsletmeRefItem[];
  alisSatisTuru: IsletmeRefItem[];
  kayitTuru: IsletmeRefItem[];
  plaka: boolean;
  islemTuru: boolean; // İşlem Türü alanı bu bağlamda görünür mü (sadece satış)
  kredili: boolean;   // Kredili Tutar alanı (sadece satış)
  tevkifat: boolean;  // Tevkifat İşlemleri satırı (2026-09-23: SATIŞTA DA açık — kısmi tevkifatlı satış faturasında
                      //   oran + KOD (614 gibi) girilmeli; eskiden yalnız giderde açıktı ve satıcı tarafı boş kalıyordu)
};

export const ISLETME_REFERANS: Record<'SATIS' | 'ALIS', IsletmeContext> = {
  SATIS: { belgeTuru: SATIS_BELGE, alisSatisTuru: SATIS_AS, kayitTuru: SATIS_KAYIT, plaka: false, islemTuru: true, kredili: true, tevkifat: true },
  ALIS: { belgeTuru: GIDER_BELGE, alisSatisTuru: GIDER_AS, kayitTuru: GIDER_KAYIT, plaka: true, islemTuru: false, kredili: false, tevkifat: true },
};

/** invoiceKind (SATIS/ALIS) → İşletme referans bağlamı */
export function isletmeRef(invoiceKind?: string | null): IsletmeContext {
  return String(invoiceKind || 'ALIS').toUpperCase() === 'SATIS' ? ISLETME_REFERANS.SATIS : ISLETME_REFERANS.ALIS;
}

// Kayıt türü → alt tür listesi. ÇAĞRI ANINDA değerlendirilir (nesne-literal init sırası tuzağına karşı).
// GİDER İndirilecek Giderler (GVK 40) — 62 kalem.
const GIDER_ALT_GVK40: IsletmeRefItem[] = [
  { kod: '113', ad: 'Taşıt Akaryakıt Giderleri (GVK 40/1-40/5)' }, { kod: '114', ad: 'Taşıt Bakım Onarım Giderleri (GVK 40/5)' },
  { kod: '165', ad: 'Kira Gideri (GVK 40/1)', donem: true }, { kod: '82', ad: 'Elektrik Giderleri (GVK 40/1)', donem: true },
  { kod: '84', ad: 'Doğalgaz Giderleri (GVK 40/1)', donem: true }, { kod: '83', ad: 'Su Giderleri (GVK 40/1)', donem: true },
  { kod: '87', ad: 'Telefon Giderleri (GVK 40/1)', donem: true }, { kod: '88', ad: 'Diğer Haberleşme Giderleri (Faks, internet vb) (GVK 40/1)', donem: true },
  { kod: '179', ad: 'Muhasebe/Mali Müşavirlik Giderleri (GVK 40/1)', donem: true }, { kod: '196', ad: 'Avukatlık, Hukuk ve Müşavirlik Giderleri (GVK 40/1)', donem: true },
  { kod: '95', ad: 'Kırtasiye Harcamaları (GVK 40/1)', donem: true }, { kod: '89', ad: 'Ofis Giderleri (Çay, Kahve, Şeker, Temizlik vb.) (GVK 40/1)', donem: true },
  { kod: '97', ad: 'Temsil ve Ağırlama Gideri (İş yemeği vb.) (GVK 40/1)', donem: true }, { kod: '90', ad: 'Gıda Harcamaları (GVK 40/1-40/2)', donem: true },
  { kod: '101', ad: 'Giyim Giderleri (GVK 40/2)', donem: true }, { kod: '96', ad: 'Pazarlama Satış Dağıtım Giderleri (GVK 40/1)', donem: true },
  { kod: '189', ad: 'Seyahat ve Ulaşım Giderleri (Oto Kiralama, Otobüs, Taksi, Uçak) (GVK 40/4-5)' }, { kod: '112', ad: 'Ulaşım Giderleri (Oto Kiralama, Taksi, Uçak vb) (GVK 40/4-5)' },
  { kod: '111', ad: 'Konaklama Giderleri (GVK 40/4)' }, { kod: '115', ad: 'Araç Kiralama Giderleri (GVK 40/1)', donem: true },
  { kod: '116', ad: 'Araç Sigorta Giderleri (Zorunlu Trafik, Kasko vb) (GVK 40/5)' }, { kod: '191', ad: 'Otopark Gideri (GVK 40/5)' },
  { kod: '324', ad: 'Otoyol ve Gişe (OGS, HGS vb.) (GVK 40/4-5)', donem: true }, { kod: '344', ad: 'Motorlu Taşıtlar Vergisi (GVK 40/5)' },
  { kod: '86', ad: 'Amortisman Giderleri (GVK 40/7)' }, { kod: '85', ad: 'Normal Bakım Onarım Giderleri (GVK 40/1 - 40/7)', donem: true },
  { kod: '185', ad: 'Doğrudan Gider Yazılan Demirbaş (GVK 40/1)' }, { kod: '92', ad: 'İşyeri Sigorta Giderleri (GVK 40/1)', donem: true },
  { kod: '81', ad: 'İşyeri Aidat Gideri (GVK 40/1)', donem: true }, { kod: '93', ad: 'Güvenlik Harcamaları (GVK 40/1)', donem: true },
  { kod: '177', ad: 'Faiz ve Finansman Giderleri (GVK 40/1 - 40/3 - 40/9)', donem: true }, { kod: '206', ad: 'Bankacılık İşlem Giderleri (GVK 40/1)' },
  { kod: '188', ad: 'Komisyon Giderleri (GVK 40/1)', donem: true }, { kod: '193', ad: 'Kargo ve Posta Giderleri (GVK 40/1)' },
  { kod: '205', ad: 'Nakliye Giderleri (GVK 40/1)' }, { kod: '194', ad: 'Dışarıdan Sağlanan Fayda ve Hizmetler (GVK 40/1)', donem: true },
  { kod: '195', ad: 'Diğer Hizmet Giderleri (GVK 40/1)', donem: true }, { kod: '228', ad: 'Diğer Sarf Malzeme Giderleri (GVK 40/1)' },
  { kod: '162', ad: 'Diğer (GVK 40/1)', donem: true }, { kod: '190', ad: 'Götürü Gider (GVK 40/1)' },
  { kod: '327', ad: 'İnternet Reklam Hizmet Alım Giderleri (GVK 40/1)', donem: true }, { kod: '328', ad: 'İnternet Reklam Hizmetlerine Aracılık Giderleri (GVK 40/1)', donem: true },
  { kod: '322', ad: 'İş Güvenliği ve İş Sağlığı Hizmet Alımları (GVK 40/1)', donem: true }, { kod: '117', ad: 'Isı Yalıtımı ve Enerji Tasarrufu Giderleri (GVK 40/7)', donem: true },
  { kod: '100', ad: 'Çalışan Tedavi ve İlaç Gideri (GVK 40/2)', donem: true }, { kod: '232', ad: 'Hizmetli ve İşçilerin GVK 27 Giyim Giderleri (GVK 40/2)' },
  { kod: '106', ad: 'İşverenlerce Sendikalara Ödenen Aidatlar (GVK 40/8)' }, { kod: '174', ad: 'Beyanname/Bildirge Damga Vergisi Giderleri (GVK 40/6)' },
  { kod: '166', ad: 'Beyannameye Konu Damga Vergisi Giderleri (GVK 40/1)' }, { kod: '147', ad: 'Tek Başına Alınabilen Damga Vergisi (GVK 40/1)' },
  { kod: '187', ad: 'Diğer Vergi Resim ve Harçlar (GVK 40/6)' }, { kod: '217', ad: 'Noter Makbuzları (GVK 40/1)' },
  { kod: '98', ad: 'İşle İlgili Ödenen Zarar, Ziyan ve Tazminat (GVK 40/3)' }, { kod: '102', ad: 'Sözleşme/Yargı/Kanun Gereği Zarar/Ziyan/Tazminat (GVK 40/3)', donem: true },
  { kod: '172', ad: 'Yıllara Yaygın İnşaat Maliyetleri', donem: true }, { kod: '192', ad: 'Dernek/Vakıflara Gıda, Temizlik, Giyecek, Yakacak Bağışları (GVK 40/10)' },
  { kod: '279', ad: 'Değersiz Hale Gelen Alacağa İlişkin Giderler' }, { kod: '284', ad: 'Hal Komisyoncusu Alımı' },
  { kod: '282', ad: 'Hasılat Esaslı Ödenen KDV' }, { kod: '326', ad: 'İkinci El Motorlu Kara Taşıtı Ticareti (KDV Düzeltmesi)' },
  { kod: '224', ad: 'Sıfır Araçlara Ait KDV Gideri (GVK 40/1)' }, { kod: '225', ad: 'Sıfır Araçlara Ait ÖTV (GVK 40/1)' },
];

export function getKayitAltList(invoiceKind: string | null | undefined, kayitTuruKod: string): IsletmeRefItem[] {
  const sale = String(invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
  const kt = String(kayitTuruKod || '');
  if (sale) {
    if (kt === '1') return SATIS_ALT_MAL;
    if (kt === '2') return SATIS_ALT_HIZMET;
    if (kt === '4') return SATIS_ALT_DIGER_HASILAT;
    if (kt === '14') return SATIS_ALT_DIGER_GELIR;
    return [];
  }
  if (kt === '1') return GIDER_ALT_MAL;
  if (kt === '4') return GIDER_ALT_GVK40;
  if (kt === '5') return GIDER_ALT_GKEG;
  if (kt === '13') return GIDER_ALT_SABIT;
  if (kt === '10') return GIDER_ALT_SABIT_EK;
  if (kt === '20') return GIDER_ALT_SABIT_SATIS_ZARARI;
  return [];
}

// Ad eşleştirme anahtarı: Türkçe küçük harf → ascii, "(GVK 40/1)" / "(GVK Md. 40)" gibi parantez etiketleri at,
//   boşluk/noktalama sil. "İndirilecek Giderler (GVK Md. 40)" ↔ "indirilecek giderler" aynı anahtara iner.
function adAnahtar(s: string): string {
  return asciiTr(String(s || '').replace(/\([^)]*\)/g, ' ')).replace(/[^a-z0-9]+/g, '');
}

export type IsletmeKodCozum = {
  kayitTuruKod: string; kayitTuruAd: string;
  kayitAltKod: string; kayitAltAd: string;
  /** Alt tür verildiyse listede bulundu mu (verilmediyse true). Okuyan katı olmak isterse buna bakar. */
  altCozuldu: boolean;
};

/**
 * PLAN/15 Faz 3 (#6, 2026-09-12) — Kayıt türü / alt türü AD ya da KOD olarak gelir, KODA çevirir.
 *   • Eski öğrenme kayıtları (vendorMemoryDecision kararTipi='isletme') AD yazılmıştı ("Diğer Hasılat") → kod değildi diye
 *     pickIsletmeMemory hepsini eliyordu (canlıda 38 kayıt ölüydü). AI cevabı da AD döner (islPromptSeg).
 *   • Eşleşme: önce tam kod, sonra tam ad (normalize), sonra kapsama (liste adı ⊇ verilen ya da tersi; ilk eşleşen — liste sırası).
 *   • Kayıt türü çözülemezse null. Alt tür: verilmediyse '' (altCozuldu=true); verilip bulunamazsa '' + altCozuldu=false
 *     (çağıran katı olmak isterse kaydı yok sayar — hafıza yolu böyle; AI yolu deterministik alt'a düşer).
 */
export function isletmeKodCoz(invoiceKind: string | null | undefined, kayitTuruAdVeyaKod?: string | null, kayitAltAdVeyaKod?: string | null): IsletmeKodCozum | null {
  const ref = isletmeRef(invoiceKind);
  const ktRaw = String(kayitTuruAdVeyaKod || '').trim();
  if (!ktRaw) return null;
  const tamAnahtar = (s: string) => asciiTr(s).replace(/[^a-z0-9]+/g, ''); // parantez dahil (eski islNorm davranışı — "GVK 40" gibi kısaltma da tutsun)
  const bul = (list: IsletmeRefItem[], raw: string): IsletmeRefItem | null => {
    if (/^\d+$/.test(raw)) return list.find((x) => x.kod === raw) || null;
    const k = adAnahtar(raw);
    if (!k) return null;
    const kTam = tamAnahtar(raw);
    return list.find((x) => adAnahtar(x.ad) === k)
      || list.find((x) => { const a = adAnahtar(x.ad); return a.includes(k) || k.includes(a); })
      || list.find((x) => { const a = tamAnahtar(x.ad); return a.includes(kTam) || kTam.includes(a); })
      || null;
  };
  const kt = bul(ref.kayitTuru, ktRaw);
  if (!kt) return null;
  const altList = getKayitAltList(invoiceKind, kt.kod);
  const altRaw = String(kayitAltAdVeyaKod || '').trim();
  if (!altRaw || !altList.length) return { kayitTuruKod: kt.kod, kayitTuruAd: kt.ad, kayitAltKod: '', kayitAltAd: '', altCozuldu: !altRaw || !altList.length };
  const alt = bul(altList, altRaw);
  return { kayitTuruKod: kt.kod, kayitTuruAd: kt.ad, kayitAltKod: alt?.kod || '', kayitAltAd: alt?.ad || '', altCozuldu: !!alt };
}

/** Kayıt türü seçilince Mihsap-benzeri varsayılan alt tür kodu. Hizmet/Mal Satışı gibi
 *  ad eşleşeni varsa onu seçer; yoksa boş (Mihsap çoğu kayıt türünde alt'ı boş bırakır). */
export function defaultKayitAltKod(invoiceKind: string | null | undefined, kayitTuruKod: string, kayitTuruAd?: string): string {
  const list = getKayitAltList(invoiceKind, kayitTuruKod);
  if (!list.length || !kayitTuruAd) return '';
  const byName = list.find((x) => x.ad.toLowerCase() === String(kayitTuruAd).toLowerCase());
  return byName ? byName.kod : '';
}

// Türkçe metni ascii'ye indir (ş→s, ç→c, ğ→g, ü→u, ö→o, ı→i, İ→i) — anahtar kelime eşleşmesi için.
function asciiTr(s: string): string {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
}

/** Belge turunu tek enum'a indirir: E_ARSIV / E_FATURA / E_SMM / OKC_FIS / Z_RAPORU. */
export function normalizeDocumentType(documentType?: string | null): string {
  const raw = String(documentType || '').trim();
  if (!raw) return '';
  const enumLike = raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (['E_ARSIV', 'E_FATURA', 'E_SMM', 'OKC_FIS', 'Z_RAPORU', 'DIGER'].includes(enumLike)) return enumLike;
  const t = asciiTr(raw).replace(/[^a-z0-9]+/g, '');
  if (!t) return '';
  if (/zraporu|zreport/.test(t)) return 'Z_RAPORU';
  if (/serbestmeslek|esmm|smm/.test(t)) return 'E_SMM';
  if (/earsiv|earsivfatura|earchive|earchiveinvoice/.test(t)) return 'E_ARSIV';
  if (/efatura|temelfatura|ticarifatura|einvoice/.test(t)) return 'E_FATURA';
  if (/okc|yazarkasa|fis|makbuz/.test(t)) return 'OKC_FIS';
  if (/diger|other/.test(t)) return 'DIGER';
  return '';
}

/**
 * Mükellefin FAALİYETİNE göre İşletme defteri Kayıt Türü'nü otomatik belirler (Bilanço'daki
 * otomatik eşleşmenin İşletme karşılığı). Satışta: Hizmet Satışı('2') / Mal Satışı('1').
 * Alışta: en yaygın İndirilecek Giderler('4') varsayılır (Muhasebeleştir'de Mal Alışı'na çevrilebilir).
 * Belirlenemezse '' döner → "İncele".
 */
export function isletmeAutoKayitTuru(invoiceKind?: string | null, nace?: string | null, faaliyet?: string | null): string {
  const sale = String(invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
  if (!sale) return '4'; // İndirilecek Giderler — alışta yaygın varsayılan
  const f = asciiTr(faaliyet || '');
  const n2 = String(nace || '').replace(/\D/g, '').slice(0, 2);
  const HIZMET = /(hizmet|tasi|nakliye|lojistik|kargo|danisman|musavir|muhasebe|yemek|restoran|lokanta|kafe|kahve|konaklama|otel|pansiyon|kuafor|berber|guzellik|tamir|onarim|servis|bakim|egitim|kurs|saglik|doktor|dis hek|avukat|hukuk|kiral|reklam|temizlik|guvenlik|organizasyon|fotograf|matbaa|yazilim|bilisim|acente|komisyon|spor|dans|terzi)/;
  const MAL = /(market|bakkal|bufe|sarkuteri|manav|kasap|firin|imalat|ureti|fabrika|toptan|perakende|magaza|ticaret|alim.?sat|nalbur|hirdavat|tekstil|giyim|konfeksiyon|mobilya|beyaz esya|elektronik|oto yedek|akaryakit|petrol|kirtasiye|eczane|gida|et ve|sebze|meyve)/;
  if (HIZMET.test(f)) return '2';
  if (MAL.test(f)) return '1';
  const HN = new Set(['49','50','51','52','53','55','56','58','59','60','61','62','63','64','65','66','68','69','70','71','72','73','74','75','77','78','79','80','81','82','84','85','86','87','88','90','91','92','93','94','95','96']);
  const MN = new Set(['01','02','03','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','45','46','47']);
  if (HN.has(n2)) return '2';
  if (MN.has(n2)) return '1';
  return ''; // belirlenemedi → İncele
}

// İndirilecek Giderler (GVK40) ALT türü kuralları. ÖNCELİK: belge içeriği (AI giderTuru: "elektrik","akaryakıt",
//   "kira"...). Satıcı ünvanı sadece ZAYIF yedek. Sıra önemli (özelden genele).
// GİDER (İndirilecek Giderler GVK 40) alt türü deterministik eşleştirme.
// Kaynak = resmi GIDER_ALT_GVK40 listesi (Mihsap/Defter-Beyan). SIRA ÖNEMLİ: SPESİFİK → GENEL,
// ilk eşleşen kazanır. Önce araç/taşıt-spesifik, sonra banka, en sonda genel hizmet/sarf.
const GVK40_ALT_KURAL: Array<[RegExp, string]> = [
  // ── ARAÇ / TAŞIT (spesifik — genel "bakım/sigorta/kira" kurallarından ÖNCE) ──
  [/akaryakit|motorin|\bbenzin\b|\bmazot\b|\bdizel\b|\blpg\b|\bopet\b|\bshell\b|aytemiz|lukoil|petrol ofisi|\bpetrol\b|totalenergies|\bmoil\b|\balpet\b|akaryakit istasyon|yakit gideri/, '113'], // Taşıt Akaryakıt
  [/oto servis|oto tamir|oto bakim|arac bakim|tasit bakim|arac tamir|tasit tamir|\blastik\b|yedek parca|oto yedek|\bbalata\b|oto elektrik|oto yikama|rot balans|oto cam|periyodik bakim|\bakumulator\b|oto lastik|motor yagi|fren balata/, '114'], // Taşıt Bakım Onarım
  [/arac kira|oto kira|rent.?a.?car|filo kira|tasit kira|otomobil kira/, '115'],                                               // Araç Kiralama
  [/\bkasko\b|trafik sigorta|zorunlu trafik|arac sigorta|tasit sigorta|motorlu tasit sigorta/, '116'],                        // Araç Sigorta (kasko/trafik)
  [/motorlu tasitlar vergisi|\bmtv\b/, '344'],                                                                                 // Motorlu Taşıtlar Vergisi
  [/otopark|park ucret|\bvale\b|kapali otopark/, '191'],                                                                       // Otopark
  [/\bhgs\b|\bogs\b|otoyol|gecis ucret|\bkgm\b|koprusu|otoyollari|otoyol gecis/, '324'],                                       // Otoyol/Gişe (HGS/OGS)
  // ── İŞYERİ / ENERJİ / HABERLEŞME ──
  // PLAN/15 Faz 3 (#8, 2026-09-12): "elektrik malzemesi / kablo / priz" ELEKTRİK FATURASI DEĞİLDİR (sarf); "elektrik
  //   tesisat/montaj/arıza" onarımdır. Bare "elektrik" kuralından ÖNCE ki içerik ünvana/enerjiye kapılmasın.
  [/elektrik malzeme|elektrik sarf|\bkablo\b|\bpriz\b|\bsigorta kutu|\bkablo kanal/, '228'],                                   // Elektrik malzemesi → Sarf
  [/elektrik tesisat|elektrik montaj|elektrik onarim|elektrik ariza|elektrik iscilik|elektrik tamir/, '85'],                   // Elektrik tesisat/onarım
  [/elektrik|enerjisa|\bbedas\b|\bayedas\b|\btedas\b|\buedas\b|\bgdz\b|\bedas\b|enerji perakende|elektrik perakende|elektrik dagitim/, '82'], // Elektrik
  [/dogalgaz|\bigdas\b|baskentgaz|\bizgaz\b|\bagdas\b|\bgazel\b|gaz dagitim|\bgaznet\b|\bbursagaz\b|\bpalgaz\b|\bakmercan\b/, '84'],          // Doğalgaz
  [/\biski\b|\baski\b|\bizsu\b|\bbuski\b|\basat\b|\bmuski\b|\bsuski\b|\bkaski\b|su ve kanalizasyon|su idaresi|su tuketim|su faturasi|su bedeli|sebeke suyu|damacana|icme suyu/, '83'],     // Su (bare "su" KALDIRILDI — "su bazlı boya" yanlış-pozitifti; kurum/bağlam şart)
  [/telefon|turkcell|vodafone|turk telekom|\bavea\b|gsm hat|mobil hat/, '87'],                                                 // Telefon
  [/internet|\bfaks\b|\bfiber\b|\bttnet\b|superonline|kablonet|d-?smart|\bturknet\b|hosting|alan adi|\bdomain\b|web hosting/, '88'], // Haberleşme (internet/faks)
  [/isi yalitim|enerji tasarruf|mantolama|\byalitim\b/, '117'],                                                                // Isı Yalıtımı/Enerji Tasarrufu
  [/\baidat\b|site aidat|plaza aidat|yonetim gideri|ortak gider|apartman aidat/, '81'],                                        // İşyeri Aidat
  [/\bdask\b|isyeri sigorta|yangin sigorta|isyeri paket sigorta|hirsizlik sigorta/, '92'],                                     // İşyeri Sigorta
  [/\bkira\b(?!lama)|kira gider|isyeri kira|dukkan kira|ofis kira|magaza kira|gayrimenkul kira/, '165'],                       // Kira (işyeri)
  // ── PROFESYONEL / DIŞARIDAN HİZMET ──
  [/muhasebe|mali musavir|\bsmmm\b|\bymm\b|musavirlik hizmet|defter tutma/, '179'],                                            // Muhasebe/Mali Müşavirlik
  [/avukat|hukuk buro|hukuki danis|hukuk musavir|vekalet ucret|hukuk hizmet/, '196'],                                         // Avukatlık/Hukuk
  [/koruyucu eldiven|is guvenligi ayakkabi|koruyucu gozluk|is elbisesi|koruyucu ekipman|\bbaret\b|reflektif yelek|is ayakkabi|koruyucu kiyafet|is guvenligi malzeme/, '232'], // İşçi Koruyucu Giyim/Ekipman (GVK 27) — iş güvenliği HİZMETİNDEN önce (ayakkabı/eldiven ≠ OSGB hizmeti)
  [/is sagligi|is guvenligi|\bisg\b|\bosgb\b|isyeri hekim|is yeri hekim|ortak saglik guvenlik/, '322'],                       // İş Güvenliği/Sağlığı HİZMETİ (322 — DİKKAT: 194 değil)
  [/calisan tedavi|personel saglik|calisan ilac|saglik raporu|\bportor\b|isyeri muayene|personel muayene|saglik tarama/, '100'], // Çalışan Tedavi ve İlaç
  [/google reklam|google ads|\badwords\b|facebook reklam|meta reklam|instagram reklam|internet reklam|dijital reklam|sponsorlu|online reklam|sosyal medya reklam|youtube reklam/, '327'], // İnternet Reklam
  [/\breklam\b|\bilan\b|tanitim|billboard|\bafis\b|\bbrosur\b|\bkatalog\b|\bfuar\b|\bstand\b|promosyon|pazarlama/, '96'],       // Pazarlama/Reklam
  [/\bnoter\b/, '217'],                                                                                                        // Noter
  [/banka masraf|banka komisyon|\beft\b|havale ucret|hesap isletim|\bbsmv\b|banka isletim|pos komisyon|uye isyeri komisyon|kredi karti komisyon/, '206'], // Bankacılık İşlem
  [/\bkargo\b|\bptt\b|\baras kargo\b|yurtici kargo|\bmng\b|surat kargo|\bups\b|\bdhl\b|fedex|\bsendeo\b|\bhepsijet\b|\bposta\b/, '193'], // Kargo ve Posta
  [/nakliye|tasimacilik|\bnavlun\b|lojistik|sevkiyat|tasima hizmet/, '205'],                                                   // Nakliye
  [/ozel guvenlik|guvenlik hizmet|guvenlik personel|koruma hizmet|guvenlik sirket|devriye hizmet|alarm izleme|alarm hizmet|kamera izleme|\bcctv\b|guvenlik kamera|guvenlik sistem/, '93'],                     // Güvenlik Harcamaları
  [/\bkomisyon\b/, '188'],                                                                                                     // Komisyon
  [/\babonelik\b|\buyelik\b|\bpremium\b|membership|e-?ticaret platform|platform hizmet|dijital hizmet|bulut hizmet|yazilim abonelik|lisans bedeli/, '194'], // Abonelik/üyelik/platform hizmeti → Dışarıdan Sağlanan Hizmet (gıdadan ÖNCE — "premium abonelik" gıdaya düşmesin)
  [/danisman|musavirlik hizmet|\bdanismanlik\b|disaridan saglanan|\btaseron\b|\bfason\b|yazilim hizmet|bilisim hizmet|teknik destek/, '194'], // Dışarıdan Sağlanan Fayda ve Hizmet
  // ── KONAKLAMA / SEYAHAT ──
  [/konaklama|\botel\b|\bhotel\b|\bpansiyon\b/, '111'],                                                                        // Konaklama
  [/seyahat|otobus bileti|ucak bileti|\bthy\b|pegasus|\bbilet\b|tren bileti|seyahat gider/, '189'],                           // Seyahat ve Ulaşım
  // ── OFİS / SARF / GIDA / GİYİM ──
  [/kirtasiye|\btoner\b|kartus|fotokopi kagidi|yazici kagidi|ofis kagit|\bdosya\b|\bklasor\b|kirtasiye malzeme/, '95'],        // Kırtasiye
  [/\bgiyim\b|kiyafet|uniforma|\bayakkabi\b|\btekstil\b|konfeksiyon|personel kiyafet/, '101'],                                 // Giyim Giderleri
  [/is yemegi|\bagirlama\b|\btemsil\b|misafir ikram|toplanti ikram|temsil agirlama/, '97'],                                    // Temsil ve Ağırlama
  [/temizlik|\bcay\b|\bkahve\b|\bseker\b|deterjan|\bpecete\b|hijyen|kagit havlu|tuvalet kagidi|cop poseti|temizlik malzeme/, '89'], // Ofis (temizlik/çay/kahve)
  [/gida urun|gida malzeme|\bsebze\b|\bmeyve\b|\bet urun\b|sut urun|\bekmek\b|bakliyat|kuruyemis|\berzak\b|\bbaharat\b|\bzeytin\b|\bpeynir\b|\brestoran\b|\blokanta\b|\byemek\b|catering|yemek servis|tabldot|\bicecek\b|mesrubat/, '90'], // Gıda Harcamaları (İÇERİK kelimeleri — "market/bakkal" gibi SATICI TİPİ değil, vendor adı yanlış pozitif yapıyordu: "D-MARKET"). "is yemegi/temsil" ZATEN YUKARIDA (97) önce eşleşir.
  [/ambalaj|\bposet\b|\bstrec\b|\bkoli\b|tek kullanim|sarf malzeme|\bsarf\b|isletme malzeme|\bnaylon\b|paketleme/, '228'],     // Diğer Sarf Malzeme
  // ── BAKIM/ONARIM (genel — araç-bakım yukarıda öncelikli) ──
  [/bakim onarim|bakim-onarim|\bonarim\b|\btamir\b|servis bedeli|tadilat|tesisat onarim/, '85'],                              // Normal Bakım Onarım
  // ── VERGİ / HARÇ / FİNANS ──
  [/damga vergisi/, '147'],                                                                                                    // Damga Vergisi (tek başına)
  [/\bfaiz\b|finansman gider|kredi faiz|vade farki|finansman/, '177'],                                                         // Faiz ve Finansman
];

/**
 * GİDER (İndirilecek Giderler — GVK40) için ALT türü tahmin eder. Metin = AI'ın belge içeriğinden
 * çıkardığı giderTuru + (yedek) satıcı ünvanı. Bulamazsa '' (zorlama yok).
 */
export function isletmeAutoKayitAltKod(invoiceKind?: string | null, kayitTuruKod?: string | null, text?: string | null): string {
  const sale = String(invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
  if (sale) return '';
  const kt = String(kayitTuruKod || '');
  // PLAN/15 Faz 3 (#18, 2026-09-12): KKEG (GVK 41) alt türü de içerikten seçilir (ceza/bağış/binek/kişisel).
  if (kt === '5') return isletmeKkegTespit(text)?.kayitAltKod || '';
  if (kt !== '4') return ''; // sadece İndirilecek Giderler
  const t = asciiTr(text || '');
  if (!t) return '';
  for (const [re, kod] of GVK40_ALT_KURAL) if (re.test(t)) return kod;
  return '';
}

// ── KKEG (GVK 41) — PLAN/15 Faz 3 (#18, 2026-09-12) ──
// Belge içeriği GVK 41 / 40-5 kalıplarına uyuyorsa: alt tür (GIDER_ALT_GKEG kodları) + kısa etiket + oran notu.
//   Binek otomobil yakıt/bakım/kira/sigorta: giderin EN ÇOK %70'i indirilebilir (GVK 40/5, 7194 s.K.), %30'u KKEG.
//   DBS alt listesinde %70/%30'a özel bir alt tür YOK (Mihsap yakalaması 2026-06-23) → en yakın: 201 "Diğer K.K.E.G.".
//   Tek belge = tek tür (PLAN/15 #26 bu turda değil) → belge İndirilecek Gider'de kalır, KKEG_SUPHESI uyarısı %30'u hatırlatır.
const BINEK_RE = /(\bbinek\b|otomobil|\bhususi\b|\begea\b|\bclio\b|\bmegane\b|\bcorolla\b|\bpassat\b|\bastra\b|\bsandero\b|\boctavia\b|\bfabia\b|\byaris\b|\bcivic\b|\bsedan\b|hatchback|\bsuv\b)/;
const TICARI_ARAC_RE = /(kamyon|kamyonet|minibus|otobus|panelvan|panel van|pikap|pick ?up|\bcekici\b|\btir\b|dorse|romork|treyler|traktor|is makine|forklift|ambulans)/;
const BINEK_GIDER_RE = /(akaryakit|motorin|\bbenzin\b|\bmazot\b|\bdizel\b|\blpg\b|yakit|bakim|onarim|\blastik\b|yedek parca|\bkira\b|kiralama|rent.?a.?car|\bkasko\b|trafik sigorta|arac sigorta|otopark|\bhgs\b|\bogs\b|oto yikama)/;
export type IsletmeKkegTespiti = { kayitAltKod: string; kayitAltAd: string; etiket: string; indirilebilirYuzde?: number };
export function isletmeKkegTespit(text?: string | null): IsletmeKkegTespiti | null {
  const t = asciiTr(text || '');
  if (!t) return null;
  const alt = (kod: string) => GIDER_ALT_GKEG.find((x) => x.kod === kod);
  const yap = (kod: string, etiket: string, yuzde?: number): IsletmeKkegTespiti | null => {
    const a = alt(kod);
    return a ? { kayitAltKod: a.kod, kayitAltAd: a.ad, etiket, ...(yuzde ? { indirilebilirYuzde: yuzde } : {}) } : null;
  };
  // Sıra: kesin KKEG (ceza / bağış / kişisel) → binek MTV → binek gider (%70 kuralı).
  if (/(para cezasi|vergi cezasi|trafik cezasi|idari para cezasi|usulsuzluk cezasi|gecikme zammi|gecikme faizi|\bceza\b|cezasi)/.test(t)) return yap('159', 'Para/vergi cezası, gecikme zammı');
  if (/(\bbagis\b|bagis makbuz|yardim makbuz|\bhibe\b|sponsorluk)/.test(t)) return yap('200', 'Bağış ve yardım');
  if (/(kisisel|sahsi|ozel tuketim|ev esyasi|kozmetik|parfum|makyaj|sac bakim|cilt bakim|oyuncak|tatil paketi)/.test(t)) return yap('154', 'Kişisel/şahsi harcama (işletmeden çekiş)');
  const binek = BINEK_RE.test(t) && !TICARI_ARAC_RE.test(t);
  if (binek && /(motorlu tasitlar vergisi|\bmtv\b)/.test(t)) return yap('219', "Binek otomobil MTV'si");
  if (binek && BINEK_GIDER_RE.test(t)) return yap('201', 'Binek otomobil gideri — en çok %70 indirilebilir (GVK 40/5), %30 KKEG', 70);
  return null;
}

// ── SATICI ÜNVANI = KURUM TİPİ kalıbı — PLAN/15 Faz 3 (#8, 2026-09-12) ──
// Ünvan yalnız kurum tipi BELLİYSE gider türü söyler: elektrik dağıtım/perakende (EDAŞ/EPSAŞ), doğalgaz dağıtım (İGDAŞ…),
//   su ve kanalizasyon idaresi (İSKİ/ASKİ…), telekom operatörü, belediye. "SİMTAŞ ELEKTRİK SAN. TİC." (üretici/tüccar)
//   TETİKLEMEZ — o ünvan 'Elektrik Gideri' yapıyordu; "SİMURG AMBALAJ" 736.943 TL streç filmi sarf malzeme yapıyordu.
const KURUM_UNVAN_KALIBI = /(elektrik dagitim|elektrik perakende|enerji perakende|\bedas\b|\bepsas\b|\bbedas\b|\bayedas\b|\btedas\b|\buedas\b|\bgdz\b|enerjisa|\bck enerji|dogalgaz dagitim|gaz dagitim|\bigdas\b|baskentgaz|\bizgaz\b|\bagdas\b|\bbursagaz\b|\bpalgaz\b|\bgaznet\b|su ve kanalizasyon|su idaresi|\biski\b|\baski\b|\bizsu\b|\bbuski\b|\basat\b|\bmuski\b|\bsuski\b|\bkaski\b|turkcell|vodafone|turk telekom|\bttnet\b|superonline|\bturknet\b|\bbelediye)/;
/** Satıcı ünvanı bir KURUM TİPİ (dağıtım şirketi / su idaresi / telekom / belediye) mi? Yalnız o zaman ünvan gider türü kanıtıdır. */
export function isletmeKurumUnvaniMi(vendorName?: string | null): boolean {
  const v = asciiTr(vendorName || '');
  if (!v) return false;
  return KURUM_UNVAN_KALIBI.test(v);
}

/**
 * GİDER faturası için İşletme sınıfını BELGE İÇERİĞİNDEN belirler (Kayıt Türü + Alt Türü).
 *   - matrahKategori (AI, mükellef-faaliyet-bilinçli): ticari_mal/hammadde → Mal Alışı; demirbas → Sabit Kıymet.
 *   - giderTuru (AI içerik) + kalemler → İndirilecek Giderler + özel alt (Elektrik/Akaryakıt/Kira…). İÇERİK VARKEN ÜNVANA BAKILMAZ.
 *   - İçerik yoksa satıcı ünvanı YALNIZ kurum tipi belliyse (isletmeKurumUnvaniMi) kullanılır (PLAN/15 Faz 3 #8).
 *   - Hiçbir kesin sinyal yok → null (= "Eşleşmedi", körü körüne İndirilecek Gider'e ATILMAZ).
 * Sadece gider (ALIŞ) için; satış faaliyet-tabanlı isletmeAutoKayitTuru ile ayrı işlenir.
 */
export function isletmeGiderSinifi(input: {
  matrahKategori?: string | null;
  giderTuru?: string | null;
  vendorName?: string | null;
  documentType?: string | null;
  /** Belge kalem adları (içerik). Varsa giderTuru ile birlikte içerik sayılır. */
  kalemler?: Array<string | null | undefined> | null;
}): { kayitTuruKod: string; kayitAltKod: string } | null {
  const mk = asciiTr(input.matrahKategori || '');
  // AI kategoriyi "ticari mal" (boşluklu), "emtia", "mal" gibi varyantla dönebiliyor → tolere et.
  if (mk === 'ticari_mal' || mk === 'ticari mal' || mk === 'hammadde' || mk === 'emtia' || mk === 'mal' || mk.includes('ticari')) return { kayitTuruKod: '1', kayitAltKod: '186' }; // Mal Alışı
  if (mk === 'demirbas' || mk === 'demirbas alimi' || mk === 'sabit kiymet') return { kayitTuruKod: '13', kayitAltKod: '' }; // Sabit Kıymet Alışı
  const kalemMetni = (Array.isArray(input.kalemler) ? input.kalemler : []).map((k) => String(k || '').trim()).filter(Boolean).join(' ');
  const icerik = `${input.giderTuru || ''} ${kalemMetni}`.trim();
  if (icerik) {
    // İçerik var → içerik kazanır; ünvan hiç okunmaz (giderTuru "streç film" + "SİMURG AMBALAJ" → 228 zaten içerikten).
    const alt = isletmeAutoKayitAltKod('ALIS', '4', `${icerik} ${input.documentType || ''}`);
    return alt ? { kayitTuruKod: '4', kayitAltKod: alt } : null;
  }
  // İçerik yok → ünvan yalnız KURUM TİPİ belliyse (dağıtım/idare/operatör) gider türü söyler.
  if (isletmeKurumUnvaniMi(input.vendorName)) {
    const alt = isletmeAutoKayitAltKod('ALIS', '4', `${input.vendorName || ''} ${input.documentType || ''}`);
    if (alt) return { kayitTuruKod: '4', kayitAltKod: alt };
  }
  return null; // kesin sinyal yok → Eşleşmedi
}

/** "Elektrik Giderleri (GVK 40/1)" → "Elektrik Giderleri" — listede sade gösterim için GVK etiketini at. */
export function kayitAltKisaAd(ad?: string | null): string {
  return String(ad || '').replace(/\s*\(GVK[^)]*\)\s*$/i, '').trim();
}

/** Mihsap-benzeri akıllı varsayılan: belge türü kodu (documentType → İşletme belge kodu) */
export function defaultBelgeTuruKod(documentType?: string | null, invoiceKind?: string | null): string {
  const sale = String(invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
  const t = normalizeDocumentType(documentType);
  if (t === 'E_FATURA') return sale ? '7' : '9';
  if (t === 'E_ARSIV') return sale ? '8' : '10';
  if (t === 'E_SMM') return sale ? '6' : '13';
  if (t === 'OKC_FIS') return '2';
  if (t === 'Z_RAPORU') return '2';
  if (t === 'PERAKENDE' || t === 'PERAKENDE_SATIS') return '3';
  return '1';
}

/**
 * İkinci el araç/taşınmaz (özel matrah) tespiti — belge içeriğinden. GİB SSS: ikinci el araç/taşınmaz
 * satışı Özel Matrah'a ve İşlem Türü 1004/1005'e gider. Belirgin ikinci-el ibaresi yoksa '' (zorlama yok).
 */
export function isletmeIkinciElTipi(text?: string | null): 'arac' | 'tasinmaz' | '' {
  const t = asciiTr(text || '');
  if (!t) return '';
  if (!/ikinci el|2\.?\s?el|kullanilmis|\b2el\b/.test(t)) return '';
  if (/tasinmaz|gayrimenkul|\bdaire\b|\barsa\b|isyeri|\bkonut\b|\bbina\b|\bdukkan\b/.test(t)) return 'tasinmaz';
  if (/\barac\b|otomobil|\bbinek\b|kamyonet|motosiklet|\btasit\b|vasita|\bplaka\b|\boto\b/.test(t)) return 'arac';
  return '';
}

/**
 * ALIŞ/SATIŞ TÜRÜ otomatik türetimi (GİB Defter-Beyan SSS desenleri — kanıt: defterbeyan.gov.tr SSS v1.3).
 *   ALIŞ:  iade → Satıştan İade (2); normal → Normal Alım (1).
 *   SATIŞ: tevkifat → Kısmi Tevkifat (2); ikinci el araç/taşınmaz → Özel Matrah (6); KDV=0 → İSTİSNA mı
 *          %0 mı BELİRSİZ → '' (İncele, tahmin yok); aksi → Normal Satışlar (1).
 * Dönen kodlar isletme-referans SATIS_AS/GIDER_AS listelerindeki kodlardır.
 */
export function isletmeAlisSatisTuru(
  invoiceKind: string | null | undefined,
  opts: { isReturn?: boolean; tevkifat?: boolean; kdvVar?: boolean; text?: string | null },
): string {
  const sale = String(invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
  if (!sale) return opts.isReturn ? '2' : '1';      // Satıştan İade : Normal Alım
  if (opts.tevkifat) return '2';                      // Kısmi Tevkifat Uygulanan İşlemler
  if (isletmeIkinciElTipi(opts.text)) return '6';     // Özel Matrah
  if (opts.kdvVar === false) {
    // PLAN/15 Faz 3 (#38, 2026-09-12): KDV=0 eskiden hep '' (İncele) idi. İçerik/belge ipucu ayırır:
    //   "ihracat / istisna / KDVK 11-13-17 / serbest bölge / diplomatik" → İSTİSNA (kısmi ibaresi varsa 4, aksi tam 5);
    //   ipucu yoksa KDV'siz normal satış (1) — %0 KDV oranıyla (KDV0) işlenir.
    const t = asciiTr(opts.text || '');
    if (/(kismi istisna|kdvk 17|madde 17|\b17\/4)/.test(t)) return '4';               // Kısmi İstisna
    if (/(ihracat|ihrac kayit|istisna|serbest bolge|diplomatik|\b11\/1|\b13\/|kdvk 11|kdvk 13|gumruk beyan|yurt disi|yurtdisi)/.test(t)) return '5'; // Tam İstisna
    return '1';                                        // KDV'siz normal satış (%0)
  }
  return '1';                                          // Normal Satışlar
}

/**
 * STOPAJ TÜRÜ türetimi — PLAN/15 Faz 3 (#38, 2026-09-12). Yalnız GİDER (alış) tarafı (mükellef ödemede stopaj keser):
 *   e-SMM / serbest meslek makbuzu → 022 (serbest meslek ödemeleri); işyeri kira faturası / kira gideri → 041 (GVK 94/5).
 *   Araç kiralama stopaja tabi değildir (kiralama sözcüğü elenir). Sinyal yoksa ''.
 * ocrData.isletme.stopajKod'a yazılır (FE alanı yok — yalnız veri; luca CSV 33. sütun st.stopajOrani'nı yazar).
 */
export function isletmeStopajTuru(
  invoiceKind: string | null | undefined,
  opts: { belgeTuru?: string | null; giderTuru?: string | null; text?: string | null },
): '022' | '041' | '' {
  const sale = String(invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
  if (sale) return '';
  const bt = normalizeDocumentType(opts.belgeTuru);
  const t = asciiTr(`${opts.giderTuru || ''} ${opts.text || ''}`);
  if (bt === 'E_SMM' || /(serbest meslek makbuz|\besmm\b|\be-smm\b|serbest meslek kazanc)/.test(t)) return '022';
  const kiraVar = /(\bkira\b(?!lama)|kira gider|kira bedeli|isyeri kira|dukkan kira|ofis kira|magaza kira|gayrimenkul kira|depo kira)/.test(t);
  const aracKira = /(arac kira|oto kira|rent.?a.?car|filo kira|tasit kira|otomobil kira|arac kiralama|oto kiralama)/.test(t);
  if (kiraVar && !aracKira) return '041';
  return '';
}

// Plaka desenindeki harf grubu BİRİM/kısaltma olamaz ("34 KG 100", "10 AD 2024" plaka değildir).
const PLAKA_HARF_YASAK = new Set(['KG', 'GR', 'LT', 'ML', 'CL', 'CM', 'MM', 'MT', 'KM', 'AD', 'PK', 'PKT', 'KDV', 'TL', 'GB', 'MB', 'TB', 'KW', 'KWH', 'HP', 'CC', 'TON', 'MG', 'DB', 'NO', 'SN', 'TK', 'PC', 'PCS', 'KOL', 'ADT']);
/**
 * PLAKA bulma — PLAN/15 Faz 3 (#38, 2026-09-12): kalem/açıklama metninde Türk plakası (il 01-81 + 1-3 harf + 2-4 rakam).
 *   Bulunursa "34 ABC 123" biçiminde normalize döner; yoksa ''. Birim kısaltmaları (KG/AD/LT…) elenir.
 *   ocrData.isletme.plakaNo BOŞSA doldurulur (ALIŞ formunda Plaka No alanı var; satışta alan yok).
 */
export function isletmePlakaBul(text?: string | null): string {
  const t = String(text || '').toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
  if (!t) return '';
  const re = /\b(0[1-9]|[1-7]\d|8[01])\s?([A-Z]{1,3})\s?(\d{2,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (PLAKA_HARF_YASAK.has(m[2])) continue;
    return `${m[1]} ${m[2]} ${m[3]}`;
  }
  return '';
}

/**
 * İŞLEM TÜRÜ otomatik türetimi — SADECE satış (gider tarafında İşlem Türü yoktur).
 * Varsayılan 1100 Yurtiçi Teslim ve Hizmetleri; ikinci el araç → 1004, ikinci el taşınmaz → 1005.
 * (Diğer nadir kodlar — ihracat/altın/tütün — araştırmada tam doğrulanmadı, zorlanmaz.)
 */
export function isletmeIslemTuru(invoiceKind: string | null | undefined, text?: string | null): string {
  const sale = String(invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
  if (!sale) return ''; // İşlem Türü sadece satış formunda görünür
  const ie = isletmeIkinciElTipi(text);
  if (ie === 'arac') return '1004';     // İkinci El Araç Ticareti
  if (ie === 'tasinmaz') return '1005'; // İkinci El Taşınmaz Ticareti
  return '1100';                        // Yurtiçi Teslim ve Hizmetleri
}
