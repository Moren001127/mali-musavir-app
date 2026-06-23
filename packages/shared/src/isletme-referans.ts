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
  { kod: '8', ad: 'e-Arşiv' }, { kod: '7', ad: 'e-Fatura' }, { kod: '1', ad: 'Fatura' },
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
const GIDER_AS: IsletmeRefItem[] = [{ kod: '1', ad: 'Normal Alım' }, { kod: '2', ad: 'Satıştan İade' }];
const GIDER_KAYIT: IsletmeRefItem[] = [
  { kod: '1', ad: 'Mal Alışı' }, { kod: '4', ad: 'İndirilecek Giderler (GVK Md. 40)' },
  { kod: '5', ad: 'Gider Kabul Edilmeyen Ödemeler (GVK Md. 41)' }, { kod: '13', ad: 'Sabit Kıymet Alışı' }, { kod: '10', ad: 'Sabit Kıymet Ek Maliyet' },
];
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
  tevkifat: boolean;  // Tevkifat İşlemleri satırı (sadece gider)
};

export const ISLETME_REFERANS: Record<'SATIS' | 'ALIS', IsletmeContext> = {
  SATIS: { belgeTuru: SATIS_BELGE, alisSatisTuru: SATIS_AS, kayitTuru: SATIS_KAYIT, plaka: false, islemTuru: true, kredili: true, tevkifat: false },
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
  return [];
}

/** Kayıt türü seçilince Mihsap-benzeri varsayılan alt tür kodu. Hizmet/Mal Satışı gibi
 *  ad eşleşeni varsa onu seçer; yoksa boş (Mihsap çoğu kayıt türünde alt'ı boş bırakır). */
export function defaultKayitAltKod(invoiceKind: string | null | undefined, kayitTuruKod: string, kayitTuruAd?: string): string {
  const list = getKayitAltList(invoiceKind, kayitTuruKod);
  if (!list.length || !kayitTuruAd) return '';
  const byName = list.find((x) => x.ad.toLowerCase() === String(kayitTuruAd).toLowerCase());
  return byName ? byName.kod : '';
}

/** Mihsap-benzeri akıllı varsayılan: belge türü kodu (documentType → İşletme belge kodu) */
export function defaultBelgeTuruKod(documentType?: string | null, invoiceKind?: string | null): string {
  const sale = String(invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
  const t = String(documentType || '').toUpperCase();
  if (t === 'E_FATURA') return sale ? '7' : '9';
  if (t === 'E_ARSIV') return sale ? '8' : '10';
  if (t === 'E_SMM') return sale ? '6' : '13';
  if (t === 'OKC_FIS') return '2';
  if (t === 'Z_RAPORU') return '2';
  if (t === 'PERAKENDE' || t === 'PERAKENDE_SATIS') return '3';
  return '1';
}
