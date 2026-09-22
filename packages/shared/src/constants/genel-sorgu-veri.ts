/**
 * Genel Sorgulamalar — sonuç VERİ şekilleri (GenelSorguSonucu.veri JSON) — 2026-09-22
 *
 * Kaynak: Dijital Vergi Dairesi (dijital.gib.gov.tr) ve İnternet Vergi Dairesi (intvrg.gib.gov.tr) canlı
 * keşfi, bkz. apps/../bilgi/DVD-SORGU-UCLARI.md. Runner bu şekilleri ÜRETİR, ekran bu şekilleri OKUR;
 * iki taraf da yalnız buradaki alan adlarına güvenir. Ham GİB yanıtı `ham` altında saklanır (ileride
 * yeni alan lazım olursa yeniden sorgu gerekmesin).
 *
 * Sayısal tutarlar her zaman number (TL, 2 hane); tarihler ISO ("2026-09-09" veya "2026-09-09T21:58:07").
 */

// ---- Vergi borcu (DVD → Borç Ödeme ve Detay → payment/api/debtinformation/true) ----
export interface VergiBorcuKalemi {
  vergiTuru: string; // "0015 GERÇEK USULDE KATMA DEĞER VERGİSİ"
  vergiKodu: string; // "0015"
  donem: string; // "2026/01-2026/01"
  vadeTarihi: string | null; // "2026-02-28"
  asilBorc: number;
  gecikmeZammi: number;
  toplam: number;
  vergiDairesi: string; // "BÜYÜKÇEKMECE"
  vergiDairesiKodu: string; // "034204"
  belgeNo: string | null;
  vadesiGecmisMi: boolean;
}

export interface VergiBorcuVeri {
  vadesiGecmis: number; // ozetBilgi tip 1 toplam
  vadesiGelmemis: number; // ozetBilgi tip 2 toplam
  toplam: number; // ozetBilgi tip 3 toplam
  gecikmeZammiToplam: number;
  kalemSayisi: number;
  kalemler: VergiBorcuKalemi[];
  /** Vergi türü bazında özet (ozetBilgi.vergiKoduDetay) */
  turOzeti: Array<{ vergiKodu: string; vergiTuru: string; toplam: number; asilBorc: number; gecikmeZammi: number }>;
  hesaplamaZamani: string | null;
  ham?: unknown;
}

// ---- e-Haciz (İnternet Vergi Dairesi → E-Haciz Bildirileri Sorgulama) ----
export type EHacizKapsam = 'BANKA' | 'ARAC';

export interface EHacizBildirisi {
  kapsam: EHacizKapsam; // secim 1 = banka, 2 = araç
  bildiriNo: string; // hbno
  tutar: number; // htutar
  durum: string; // "HACİZ TATBİK EDİLMİŞTİR" | "HACİZ TATBİK EDİLECEK VARLIK BULUNAMAMIŞTIR"
  vergiDairesiKodu: string; // vdkod
  vergiDairesi: string | null; // kod → ad eşlemesi yapılabildiyse
  /** Detay: bildiriyi oluşturan borçların vergi türü/dönemi */
  borclar: Array<{ vergiTuru: string; vergiDonem: string }>;
  /** Detay: banka/hesap bilgisi (GİB çoğu zaman boş döndürüyor) */
  hesaplar: Array<Record<string, unknown>>;
}

export interface EHacizVeri {
  bildiriSayisi: number;
  tatbikEdilenSayisi: number; // durum "TATBİK EDİLMİŞTİR"
  toplamTutar: number;
  bildiriler: EHacizBildirisi[];
  ham?: unknown;
}

// ---- Yoklama / Denetim (DVD → e-Yoklamalarım) ----
export interface YoklamaTutanagi {
  yoklamaKodu: string; // ykodu
  tarih: string; // ISO "2025-09-26T12:32:16"
  vergiDairesi: string; // vdKoduText "AVCILAR (034294)"
  vergiDairesiKodu: string;
  yoklamaTuru: string; // yoklamaTuruText
  yoklamaTuruKodu: string; // yturu
  /** PDF portal belgesi olarak saklandıysa (PortalDocument.referenceNo = yoklamaKodu, belgeTuru E_YOKLAMA) */
  pdfVarMi: boolean;
  /** completeJob saklama sonrası doldurur → ekran GET /portal-automation/documents/:id/view ile açar */
  pdfDocumentId?: string | null;
}

export interface DenetimTutanagi {
  belgeKodu: string;
  denetimAdi: string;
  denetimTuru: string;
  tarih: string;
  sonuc: string | null;
  ham?: unknown;
}

export interface YoklamaDenetimVeri {
  yoklamaSayisi: number;
  denetimSayisi: number;
  sonYoklamaTarihi: string | null;
  yoklamalar: YoklamaTutanagi[];
  denetimler: DenetimTutanagi[];
  ham?: unknown;
}

// ---- POS (DVD → POS İşlem Bilgilerim; yıl+ay) ----
export interface PosSatiri {
  kaynak: 'BANKA' | 'ODEME_KURULUSU';
  unvan: string; // "VAKIFBANK"
  vkn: string;
  uyeIsyeriNo: string;
  tutar: number;
}

export interface PosVeri {
  yil: number;
  ay: number; // 1-12
  toplamTutar: number;
  satirSayisi: number;
  satirlar: PosSatiri[];
  ham?: unknown;
}

// ---- Gelen e-Arşiv (DVD → e-Arşiv Faturalarım; 7 günlük pencerelerle) ----
export interface GelenEArsivFaturasi {
  faturaNo: string;
  duzenlenmeTarihi: string; // ISO
  saticiUnvan: string; // unvan
  saticiVkn: string; // tcknVkn / mukellefVkn
  gonderimSekli: string; // ELEKTRONIK | KAGIT
  toplamTutar: number; // vergiler hariç
  vergilerTutari: number;
  odenecekTutar: number;
  paraBirimi: string;
  iptalItirazDurum: string | null;
}

export interface GelenEArsivVeri {
  /** Sorgulanan tarih aralığı (ISO gün) */
  baslangic: string;
  bitis: string;
  faturaSayisi: number;
  toplamOdenecek: number;
  faturalar: GelenEArsivFaturasi[];
  /** GİB'in 7 günlük sınırı yüzünden atılan pencere sayısı ve hatalı pencereler */
  pencereSayisi: number;
  hataliPencereler: Array<{ baslangic: string; bitis: string; hata: string }>;
}

export type GenelSorguVeri = VergiBorcuVeri | EHacizVeri | YoklamaDenetimVeri | PosVeri | GelenEArsivVeri;

// ---- e-Defter beratı (e-Defter uygulaması → Paket Listesi) — EDefterBerat tablosu ----
/** GİB belge türü kodları: KB = Kebir (Büyük Defter) Beratı, YB = Yevmiye Beratı, Y = Yevmiye Defteri, K = Kebir Defteri */
export const EDEFTER_BELGE_TURLERI = ['KB', 'YB', 'Y', 'K'] as const;
export type EDefterBelgeTuru = (typeof EDEFTER_BELGE_TURLERI)[number];

export const EDEFTER_BELGE_ETIKETLERI: Record<EDefterBelgeTuru, string> = {
  KB: 'Kebir Beratı',
  YB: 'Yevmiye Beratı',
  Y: 'Yevmiye Defteri',
  K: 'Kebir Defteri',
};

export interface EDefterBeratGirdisi {
  donem: string; // "2026-05"
  belgeTuru: string; // KB | YB | Y | K (bilinmeyen kod da saklanır)
  paketId: string; // "3241199696-202605-KB-000000"
  islemOid: string | null; // İşlem Numarası (ekranda gösterilen)
  oid: string | null;
  alinmaZamani: string | null; // ISO — GİB yükleme zamanı
  durumKodu: number | null; // 0 = başarılı
  durumAciklama: string | null;
  ham?: unknown;
}

/** Runner'ın iş sonucunda döndürdüğü e-Defter sorgu kaydı (dönem başına) */
export interface EDefterSorguSonucu {
  donem: string; // "2026-05"
  paketSayisi: number;
  hata: string | null;
}

/**
 * Runner → completeJob sözleşmesi: iş sonucunun (result) içinde bu alanlar taşınır.
 *   result.genelSorgular   → GenelSorguSonucu satırları
 *   result.eDefterBeratlar → EDefterBerat upsert
 *   result.eDefterSorgular → EDefterSorguKaydi satırları
 *   result.sorguHatalari   → sorgu bazında hata (iş yine 'done' biter; ekranda gösterilir)
 */
export interface DvdSorguSonucPaketi {
  genelSorgular?: Array<{ tur: string; donem: string | null; ozet: string; veri: GenelSorguVeri }>;
  eDefterBeratlar?: EDefterBeratGirdisi[];
  eDefterSorgular?: EDefterSorguSonucu[];
  sorguHatalari?: Array<{ sorgu: string; hata: string }>;
}
