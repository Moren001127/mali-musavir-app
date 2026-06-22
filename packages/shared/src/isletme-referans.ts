// ============================================================
// İşletme Defteri (GİB Defter-Beyan) referans verisi
// Kaynak: Mihsap İşletme fatura-işleme formu (React props) — birebir çekildi 2026-06-22.
// Hem web (Muhasebeleştir → İşletme formu) hem api (Luca İşletme CSV eşlemesi) kullanır.
// faturaTuru: SATIS = Gelir, ALIS = Gider (invoiceKind ile eşleşir).
// ============================================================

export type IsletmeRefItem = { kod: string; ad: string; donem?: boolean };

// İşlem Türü — bağlamdan bağımsız (15)
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

// KDV Oranı — bağlamdan bağımsız
export const ISLETME_KDV_ORAN: IsletmeRefItem[] = [
  { kod: 'KDV20', ad: '%20 Kdv' },
  { kod: 'KDV10', ad: '%10 Kdv' },
  { kod: 'KDV1', ad: '%1 Kdv' },
  { kod: 'KDV0', ad: '%0 Kdv' },
];

// SATIŞ (Gelir) bağlamı
const SATIS_BELGE: IsletmeRefItem[] = [
  { kod: '8', ad: 'e-Arşiv' },
  { kod: '7', ad: 'e-Fatura' },
  { kod: '1', ad: 'Fatura' },
  { kod: '3', ad: 'Perakende Satış Fişi' },
  { kod: '2', ad: 'Z Raporu' },
  { kod: '15', ad: 'e-Bilet' },
  { kod: '11', ad: 'Tevsiki Zaruri Olmayan Gelir' },
  { kod: '13', ad: 'Yolcu Taşıma Bileti' },
  { kod: '6', ad: 'Diğer' },
];
const SATIS_AS: IsletmeRefItem[] = [
  { kod: '1', ad: 'Normal Satış' },
  { kod: '2', ad: 'Kısmi Tevkifat Uygulanan İşlemler' },
  { kod: '4', ad: 'Kısmi İstisna Kapsamına Giren İşlemler' },
  { kod: '5', ad: 'Tam İstisna Kapsamına Giren İşlemler' },
  { kod: '3', ad: 'Diğer İşlemler (KDV Beyannamesi)' },
  { kod: '6', ad: 'Özel Matrah' },
  { kod: '13', ad: 'İsteğe Bağlı Tam Tevkifat Uygulanan İşlemler' },
  { kod: '10', ad: 'Diğer' },
];
const SATIS_KAYIT: IsletmeRefItem[] = [
  { kod: '1', ad: 'Mal Satışı' },
  { kod: '2', ad: 'Hizmet Satışı' },
  { kod: '4', ad: 'Diğer Hasılat' },
  { kod: '14', ad: 'Diğer Gelir' },
];
const SATIS_ALT_HIZMET: IsletmeRefItem[] = [
  { kod: '188', ad: 'Hizmet Satışı' },
  { kod: '189', ad: 'Konaklama Hizmeti' },
  { kod: '186', ad: 'Yıllara Yaygın İnşaat ve Onarım Hakediş Bedeli' },
  { kod: '99099', ad: 'Diğer Özel Matrah Satışları' },
  { kod: '99044', ad: 'İkinci El Araç ve Taşınmaz Ticareti' },
  { kod: '99041', ad: 'Ön Ödemeli Elektronik Haberleşme Hizmetleri' },
  { kod: '99024', ad: 'At Yarışları ve Müşterek Bahis/Talih Oyunları (KDVK 23/b)' },
  { kod: '99022', ad: 'Milli Piyango, Spor-Toto vb. (KDVK 23/a)' },
  { kod: '99026', ad: 'Profesyonel Gösteri, Konser ve Sportif Faaliyetler (KDVK 23/c)' },
  { kod: '99029', ad: 'Gümrük Depoları ve Müzayede Salonu Satışları (KDVK 23/d)' },
];

// GİDER (Alış) bağlamı
const GIDER_BELGE: IsletmeRefItem[] = [
  { kod: '10', ad: 'e-Arşiv Fatura' },
  { kod: '9', ad: 'e-Fatura' },
  { kod: '1', ad: 'Fatura' },
  { kod: '2', ad: 'ÖKC Fişi' },
  { kod: '3', ad: 'Perakende Satış Fişi' },
  { kod: '5', ad: 'Gider Pusulası' },
  { kod: '4', ad: 'Serbest Meslek Makbuzu' },
  { kod: '13', ad: 'e-Serbest Meslek Makbuzu' },
  { kod: '18', ad: 'e-Bilet' },
  { kod: '19', ad: 'Yolcu Taşıma Bileti' },
  { kod: '8', ad: 'Diğer' },
];
const GIDER_AS: IsletmeRefItem[] = [
  { kod: '1', ad: 'Normal Alım' },
  { kod: '2', ad: 'Satıştan İade' },
];
const GIDER_KAYIT: IsletmeRefItem[] = [
  { kod: '1', ad: 'Mal Alışı' },
  { kod: '4', ad: 'İndirilecek Giderler (GVK Md. 40)' },
  { kod: '5', ad: 'Gider Kabul Edilmeyen Ödemeler (GVK Md. 41)' },
  { kod: '13', ad: 'Sabit Kıymet Alışı' },
  { kod: '10', ad: 'Sabit Kıymet Ek Maliyet' },
];
// İndirilecek Giderler (GVK 40) alt türleri — 62 kalem (donemsellikIlkesi bayraklı)
const GIDER_ALT_GVK40: IsletmeRefItem[] = [
  { kod: '113', ad: 'Taşıt Akaryakıt Giderleri (GVK 40/1-40/5)', donem: false },
  { kod: '114', ad: 'Taşıt Bakım Onarım Giderleri (GVK 40/5)', donem: false },
  { kod: '165', ad: 'Kira Gideri (GVK 40/1)', donem: true },
  { kod: '82', ad: 'Elektrik Giderleri (GVK 40/1)', donem: true },
  { kod: '84', ad: 'Doğalgaz Giderleri (GVK 40/1)', donem: true },
  { kod: '83', ad: 'Su Giderleri (GVK 40/1)', donem: true },
  { kod: '87', ad: 'Telefon Giderleri (GVK 40/1)', donem: true },
  { kod: '88', ad: 'Diğer Haberleşme Giderleri (Faks, internet vb) (GVK 40/1)', donem: true },
  { kod: '179', ad: 'Muhasebe/Mali Müşavirlik Giderleri (GVK 40/1)', donem: true },
  { kod: '196', ad: 'Avukatlık, Hukuk ve Müşavirlik Giderleri (GVK 40/1)', donem: true },
  { kod: '95', ad: 'Kırtasiye Harcamaları (GVK 40/1)', donem: true },
  { kod: '89', ad: 'Ofis Giderleri (Çay, Kahve, Şeker, Temizlik vb.) (GVK 40/1)', donem: true },
  { kod: '97', ad: 'Temsil ve Ağırlama Gideri (İş yemeği vb.) (GVK 40/1)', donem: true },
  { kod: '90', ad: 'Gıda Harcamaları (GVK 40/1-40/2)', donem: true },
  { kod: '101', ad: 'Giyim Giderleri (GVK 40/2)', donem: true },
  { kod: '96', ad: 'Pazarlama Satış Dağıtım Giderleri (GVK 40/1)', donem: true },
  { kod: '189', ad: 'Seyahat ve Ulaşım Giderleri (Oto Kiralama, Otobüs, Taksi, Uçak) (GVK 40/4-5)', donem: false },
  { kod: '112', ad: 'Ulaşım Giderleri (Oto Kiralama, Taksi, Uçak vb) (GVK 40/4-5)', donem: false },
  { kod: '111', ad: 'Konaklama Giderleri (GVK 40/4)', donem: false },
  { kod: '115', ad: 'Araç Kiralama Giderleri (GVK 40/1)', donem: true },
  { kod: '116', ad: 'Araç Sigorta Giderleri (Zorunlu Trafik, Kasko vb) (GVK 40/5)', donem: false },
  { kod: '191', ad: 'Otopark Gideri (GVK 40/5)', donem: false },
  { kod: '324', ad: 'Otoyol ve Gişe (OGS, HGS vb.) (GVK 40/4-5)', donem: true },
  { kod: '344', ad: 'Motorlu Taşıtlar Vergisi (GVK 40/5)', donem: false },
  { kod: '86', ad: 'Amortisman Giderleri (GVK 40/7)', donem: false },
  { kod: '85', ad: 'Normal Bakım Onarım Giderleri (GVK 40/1 - 40/7)', donem: true },
  { kod: '185', ad: 'Doğrudan Gider Yazılan Demirbaş (GVK 40/1)', donem: false },
  { kod: '92', ad: 'İşyeri Sigorta Giderleri (GVK 40/1)', donem: true },
  { kod: '81', ad: 'İşyeri Aidat Gideri (GVK 40/1)', donem: true },
  { kod: '93', ad: 'Güvenlik Harcamaları (GVK 40/1)', donem: true },
  { kod: '177', ad: 'Faiz ve Finansman Giderleri (GVK 40/1 - 40/3 - 40/9)', donem: true },
  { kod: '206', ad: 'Bankacılık İşlem Giderleri (GVK 40/1)', donem: false },
  { kod: '188', ad: 'Komisyon Giderleri (GVK 40/1)', donem: true },
  { kod: '193', ad: 'Kargo ve Posta Giderleri (GVK 40/1)', donem: false },
  { kod: '205', ad: 'Nakliye Giderleri (GVK 40/1)', donem: false },
  { kod: '194', ad: 'Dışarıdan Sağlanan Fayda ve Hizmetler (GVK 40/1)', donem: true },
  { kod: '195', ad: 'Diğer Hizmet Giderleri (GVK 40/1)', donem: true },
  { kod: '228', ad: 'Diğer Sarf Malzeme Giderleri (GVK 40/1)', donem: false },
  { kod: '162', ad: 'Diğer (GVK 40/1)', donem: true },
  { kod: '190', ad: 'Götürü Gider (GVK 40/1)', donem: false },
  { kod: '327', ad: 'İnternet Reklam Hizmet Alım Giderleri (GVK 40/1)', donem: true },
  { kod: '328', ad: 'İnternet Reklam Hizmetlerine Aracılık Giderleri (GVK 40/1)', donem: true },
  { kod: '322', ad: 'İş Güvenliği ve İş Sağlığı Hizmet Alımları (GVK 40/1)', donem: true },
  { kod: '117', ad: 'Isı Yalıtımı ve Enerji Tasarrufu Giderleri (GVK 40/7)', donem: true },
  { kod: '100', ad: 'Çalışan Tedavi ve İlaç Gideri (GVK 40/2)', donem: true },
  { kod: '232', ad: 'Hizmetli ve İşçilerin GVK 27 Giyim Giderleri (GVK 40/2)', donem: false },
  { kod: '106', ad: 'İşverenlerce Sendikalara Ödenen Aidatlar (GVK 40/8)', donem: false },
  { kod: '174', ad: 'Beyanname/Bildirge Damga Vergisi Giderleri (GVK 40/6)', donem: false },
  { kod: '166', ad: 'Beyannameye Konu Damga Vergisi Giderleri (GVK 40/1)', donem: false },
  { kod: '147', ad: 'Tek Başına Alınabilen Damga Vergisi (GVK 40/1)', donem: false },
  { kod: '187', ad: 'Diğer Vergi Resim ve Harçlar (GVK 40/6)', donem: false },
  { kod: '217', ad: 'Noter Makbuzları (GVK 40/1)', donem: false },
  { kod: '98', ad: 'İşle İlgili Ödenen Zarar, Ziyan ve Tazminat (GVK 40/3)', donem: false },
  { kod: '102', ad: 'Sözleşme/Yargı/Kanun Gereği Zarar/Ziyan/Tazminat (GVK 40/3)', donem: true },
  { kod: '172', ad: 'Yıllara Yaygın İnşaat Maliyetleri', donem: true },
  { kod: '192', ad: 'Dernek/Vakıflara Gıda, Temizlik, Giyecek, Yakacak Bağışları (GVK 40/10)', donem: false },
  { kod: '279', ad: 'Değersiz Hale Gelen Alacağa İlişkin Giderler', donem: false },
  { kod: '284', ad: 'Hal Komisyoncusu Alımı', donem: false },
  { kod: '282', ad: 'Hasılat Esaslı Ödenen KDV', donem: false },
  { kod: '326', ad: 'İkinci El Motorlu Kara Taşıtı Ticareti (KDV Düzeltmesi)', donem: false },
  { kod: '224', ad: 'Sıfır Araçlara Ait KDV Gideri (GVK 40/1)', donem: false },
  { kod: '225', ad: 'Sıfır Araçlara Ait ÖTV (GVK 40/1)', donem: false },
];

export type IsletmeContext = {
  belgeTuru: IsletmeRefItem[];
  alisSatisTuru: IsletmeRefItem[];
  kayitTuru: IsletmeRefItem[];
  /** kayitTuru kod → alt tür listesi (yakalananlar; yoksa boş = serbest/opsiyonel) */
  kayitAltTuru: Record<string, IsletmeRefItem[]>;
  /** giderde araç plakası alanı görünür */
  plaka: boolean;
};

export const ISLETME_REFERANS: Record<'SATIS' | 'ALIS', IsletmeContext> = {
  SATIS: {
    belgeTuru: SATIS_BELGE,
    alisSatisTuru: SATIS_AS,
    kayitTuru: SATIS_KAYIT,
    kayitAltTuru: { '2': SATIS_ALT_HIZMET, '1': [], '4': [], '14': [] },
    plaka: false,
  },
  ALIS: {
    belgeTuru: GIDER_BELGE,
    alisSatisTuru: GIDER_AS,
    kayitTuru: GIDER_KAYIT,
    kayitAltTuru: { '4': GIDER_ALT_GVK40, '1': [], '5': [], '13': [], '10': [] },
    plaka: true,
  },
};

/** invoiceKind (SATIS/ALIS) → İşletme referans bağlamı */
export function isletmeRef(invoiceKind?: string | null): IsletmeContext {
  return String(invoiceKind || 'ALIS').toUpperCase() === 'SATIS' ? ISLETME_REFERANS.SATIS : ISLETME_REFERANS.ALIS;
}

// Kayıt türü → alt tür listesi. ÇAĞRI ANINDA değerlendirilir; nesne-literal init sırası
// tuzaklarından bağımsız (deploy'da alt listenin boş gelmesi bu yüzdendi). Yeni liste
// yakaladıkça buraya eklenir; yoksa boş (alt tür opsiyonel kalır).
export function getKayitAltList(invoiceKind: string | null | undefined, kayitTuruKod: string): IsletmeRefItem[] {
  const sale = String(invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
  const kt = String(kayitTuruKod || '');
  if (sale) {
    if (kt === '2') return SATIS_ALT_HIZMET; // Hizmet Satışı
    return [];                                // Mal Satışı/Diğer — henüz yakalanmadı
  }
  if (kt === '4') return GIDER_ALT_GVK40;     // İndirilecek Giderler (GVK 40)
  return [];                                  // Mal Alışı/Sabit Kıymet/GKEÖ — henüz yakalanmadı
}

/** Kayıt türü seçilince Mihsap-benzeri varsayılan alt tür kodu (alt = kayıt türünün kendisi). */
export function defaultKayitAltKod(invoiceKind: string | null | undefined, kayitTuruKod: string, kayitTuruAd?: string): string {
  const list = getKayitAltList(invoiceKind, kayitTuruKod);
  if (!list.length) return '';
  const byName = kayitTuruAd ? list.find((x) => x.ad.toLowerCase() === String(kayitTuruAd).toLowerCase()) : undefined;
  return (byName || list[0]).kod;
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
  return '1'; // Fatura
}
