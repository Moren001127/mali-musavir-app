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

// Türkçe metni ascii'ye indir (ş→s, ç→c, ğ→g, ü→u, ö→o, ı→i, İ→i) — anahtar kelime eşleşmesi için.
function asciiTr(s: string): string {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
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
  [/elektrik|enerjisa|\bbedas\b|\bayedas\b|\btedas\b|\buedas\b|\bgdz\b|\bedas\b|enerji perakende|elektrik perakende|elektrik dagitim/, '82'], // Elektrik
  [/dogalgaz|\bigdas\b|baskentgaz|\bizgaz\b|\bagdas\b|\bgazel\b|gaz dagitim|\bgaznet\b|\bbursagaz\b|\bpalgaz\b|\bakmercan\b/, '84'],          // Doğalgaz
  [/\bsu\b|\biski\b|\baski\b|\bizsu\b|\bbuski\b|\basat\b|\bmuski\b|\bsuski\b|\bkaski\b|su ve kanalizasyon|su idaresi|su tuketim/, '83'],     // Su
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
  [/ozel guvenlik|guvenlik hizmet|guvenlik personel|koruma hizmet|guvenlik sirket|devriye hizmet/, '93'],                     // Güvenlik Harcamaları
  [/\bkomisyon\b/, '188'],                                                                                                     // Komisyon
  [/danisman|musavirlik hizmet|\bdanismanlik\b|disaridan saglanan|\btaseron\b|\bfason\b|yazilim hizmet|bilisim hizmet|teknik destek|yazilim abonelik|lisans bedeli/, '194'], // Dışarıdan Sağlanan Fayda ve Hizmet
  // ── KONAKLAMA / SEYAHAT ──
  [/konaklama|\botel\b|\bhotel\b|\bpansiyon\b/, '111'],                                                                        // Konaklama
  [/seyahat|otobus bileti|ucak bileti|\bthy\b|pegasus|\bbilet\b|tren bileti|seyahat gider/, '189'],                           // Seyahat ve Ulaşım
  // ── OFİS / SARF / GIDA / GİYİM ──
  [/kirtasiye|\btoner\b|kartus|fotokopi kagidi|yazici kagidi|ofis kagit|\bdosya\b|\bklasor\b|kirtasiye malzeme/, '95'],        // Kırtasiye
  [/\bgiyim\b|kiyafet|uniforma|\bayakkabi\b|\btekstil\b|konfeksiyon|personel kiyafet/, '101'],                                 // Giyim Giderleri
  [/is yemegi|\bagirlama\b|\btemsil\b|misafir ikram|toplanti ikram|temsil agirlama/, '97'],                                    // Temsil ve Ağırlama
  [/temizlik|\bcay\b|\bkahve\b|\bseker\b|deterjan|\bpecete\b|hijyen|kagit havlu|tuvalet kagidi|cop poseti|temizlik malzeme/, '89'], // Ofis (temizlik/çay/kahve)
  [/\bgida\b|sebze|\bmeyve\b|bakkal|\bmarket\b|\bmanav\b|\bkasap\b|\bfirin\b|bakliyat|\bicecek\b|kuruyemis|gida urun|\berzak\b/, '90'], // Gıda Harcamaları
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
  if (String(kayitTuruKod || '') !== '4') return ''; // sadece İndirilecek Giderler
  const t = asciiTr(text || '');
  if (!t) return '';
  for (const [re, kod] of GVK40_ALT_KURAL) if (re.test(t)) return kod;
  return '';
}

/**
 * GİDER faturası için İşletme sınıfını BELGE İÇERİĞİNDEN belirler (Kayıt Türü + Alt Türü).
 *   - matrahKategori (AI, mükellef-faaliyet-bilinçli): ticari_mal/hammadde → Mal Alışı; demirbas → Sabit Kıymet.
 *   - giderTuru (AI içerik) / satıcı → İndirilecek Giderler + özel alt (Elektrik/Akaryakıt/Kira…).
 *   - Hiçbir kesin sinyal yok → null (= "Eşleşmedi", körü körüne İndirilecek Gider'e ATILMAZ).
 * Sadece gider (ALIŞ) için; satış faaliyet-tabanlı isletmeAutoKayitTuru ile ayrı işlenir.
 */
export function isletmeGiderSinifi(input: {
  matrahKategori?: string | null;
  giderTuru?: string | null;
  vendorName?: string | null;
  documentType?: string | null;
}): { kayitTuruKod: string; kayitAltKod: string } | null {
  const mk = asciiTr(input.matrahKategori || '');
  if (mk === 'ticari_mal' || mk === 'hammadde') return { kayitTuruKod: '1', kayitAltKod: '186' }; // Mal Alışı
  if (mk === 'demirbas' || mk === 'demirbas alimi' || mk === 'sabit kiymet') return { kayitTuruKod: '13', kayitAltKod: '' }; // Sabit Kıymet Alışı
  const alt = isletmeAutoKayitAltKod('ALIS', '4', `${input.giderTuru || ''} ${input.vendorName || ''} ${input.documentType || ''}`);
  if (alt) return { kayitTuruKod: '4', kayitAltKod: alt };
  return null; // kesin sinyal yok → Eşleşmedi
}

/** "Elektrik Giderleri (GVK 40/1)" → "Elektrik Giderleri" — listede sade gösterim için GVK etiketini at. */
export function kayitAltKisaAd(ad?: string | null): string {
  return String(ad || '').replace(/\s*\(GVK[^)]*\)\s*$/i, '').trim();
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
  if (opts.kdvVar === false) return '';               // KDV=0 → istisna/%0 belirsiz → İncele
  return '1';                                          // Normal Satışlar
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
