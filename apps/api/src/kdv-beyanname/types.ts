/**
 * KDV Beyanname Ön Hazırlık — tip tanımları.
 *
 * KDV1 ve KDV2 için gereken verileri Mihsap fatura + Luca mizan + geçmiş
 * BeyanKaydi'ndan derler, mali müşavirin BDP'ye elle girmesi için özet sunar.
 */

export type KdvTip = 'KDV1' | 'KDV2';

/** Tek bir oranın satır breakdown'u — matrah + KDV */
export interface OranRow {
  oran: number; // 1 | 10 | 20
  matrah: number;
  kdv: number;
  kaynak?: 'kdv_kontrol' | 'mihsap_xml';
  adet: number; // Kaç fatura bu orana dahil
}

export interface KdvEksikVeri {
  tur: 'kdv_orani' | 'kdv_kontrol' | 'luca_mizan' | 'devreden_kdv' | 'tevkifat_ocr' | 'tevkifat_kodu';
  seviye: 'bilgi' | 'uyari' | 'kritik';
  belgeNo?: string | null;
  taraf?: 'ALIS' | 'SATIS' | 'GENEL' | 'LUCA' | 'KDV2';
  mesaj: string;
  aksiyon?: string;
}

export interface VeriGuveni {
  seviye: 'kesin' | 'kontrol_gerekli' | 'eksik';
  puan: number;
  kesinFaturaAdet: number;
  toplamFaturaAdet: number;
  kontrolGerekliAdet: number;
  lucaMizanVar: boolean;
}

/** KDV1 Beyannamesi Ön Hazırlık sonucu */
export interface Kdv1OnHazirlik {
  mukellefId: string;
  mukellefAd: string;
  donem: string;

  // === MATRAHLAR (SATIŞ tarafı) ===
  satis: {
    oranlar: OranRow[]; // %1, %10, %20 kırılımı
    toplamMatrah: number;
    toplamHesaplananKdv: number;
    faturaAdet: number;
  };

  // === İNDİRİLECEK KDV (ALIŞ tarafı) ===
  alis: {
    oranlar: OranRow[];
    toplamMatrah: number;
    toplamIndirilecekKdv: number;
    faturaAdet: number;
    tevkifatsiz: { matrah: number; kdv: number; adet: number }; // Normal alış
    tevkifatli: { matrah: number; kdv: number; adet: number };  // Tevkifatlı alış (KDV2'ye)
  };

  // === GEÇEN DÖNEMDEN DEVREDEN KDV ===
  devreden: {
    tutar: number;
    kaynak: 'manuel' | 'beyan_durumu' | 'beyanname_pdf' | 'beyan_kaydi' | 'luca_mizan' | 'yok';
    sonKayitDonem: string | null;
  };

  // === SONUÇ ===
  sonuc: {
    hesaplananKdv: number;
    indirilecekKdv: number;
    devredenKdv: number;
    odenecekKdv: number;      // Hesaplanan > İndirilecek + Devreden → fark
    sonrakiAyaDevreden: number; // İndirilecek + Devreden > Hesaplanan → fark
  };

  // === LUCA ÇAPRAZ KONTROL ===
  lucaKontrol: {
    mizanVar: boolean;
    luca391Bakiye: number | null;     // Hesaplanan KDV (alacak bakiye)
    luca191Bakiye: number | null;     // İndirilecek KDV (borç bakiye)
    luca190Bakiye: number | null;     // Devreden KDV (aktif borç bakiye)
    fark391: number | null;           // Mihsap hesaplanan - Luca 391
    fark191: number | null;           // Mihsap indirilecek - Luca 191
    cekildiAt?: Date | string | null;
    donemTipi?: 'AYLIK';
    uyarilar: string[];
  };

  // === VERİ KAYNAĞI KALİTESİ ===
  kaliteRapor: {
    ocrliFaturaOrani: number; // 0-1 — KDV Kontrol'den geçmiş oran. Yüksekse veri kesin.
    tahminFaturaOrani: number; // 0-1 — Sadece varsayılan %20 ile tahmin edilen oran
    uyarilar: string[];
  };

  eksikVeriler: KdvEksikVeri[];
  veriGuveni: VeriGuveni;
}

/** KDV2 Beyannamesi Ön Hazırlık (Tevkifat Sorumlusu) */
export interface Kdv2OnHazirlik {
  mukellefId: string;
  mukellefAd: string;
  donem: string;

  tevkifatli: Array<{
    belgeNo: string;
    satici: string;
    saticiVkn: string;
    tarih: string;
    matrah: number;
    hesaplananKdv: number;
    tevkifatOrani: string; // "1/10", "5/10", "9/10" vb.
    tevkifatKodu: string; // "601", "602" vb. bulunamazsa "KOD_YOK"
    tevkifatTutari: number;
    kaynak: 'ocr' | 'ocr_eksik';
  }>;

  toplamlar: {
    faturaAdet: number;
    toplamMatrah: number;
    toplamHesaplananKdv: number;
    toplamTevkifat: number;
  };

  // Tevkifat kodu bazlı gruplama (ileride BDP için)
  tevkifatKodlari: Array<{
    kod: string;         // "601", "602" vb. GIB tevkifat kodu
    matrah: number;
    tevkifat: number;
    adet: number;
  }>;

  uyarilar: string[];
  eksikVeriler: KdvEksikVeri[];
  veriGuveni: VeriGuveni;
}

/** Tüm mükellefler için aylık özet (dashboard benzeri) */
export interface DonemOzet {
  donem: string;
  tip: KdvTip;
  toplam: {
    mukellefAdet: number;
    hazirMukellefAdet: number;    // Fatura sayısı > 0 olanlar
    toplamOdenecek: number;
    toplamDevreden: number;
  };
  mukellefler: Array<{
    mukellefId: string;
    ad: string;
    faturaAdet: number;
    hesaplananKdv: number;
    indirilecekKdv: number;
    odenecek: number;
    devreden: number;
    durum: 'hazir' | 'eksik' | 'bos'; // hazir = veri tam, eksik = OCR gerekli, bos = fatura yok
  }>;
}

/**
 * KDV Durum Panosu — tüm KDV mükelleflerinin bir dönemdeki anlık durumu.
 * Otomatik: KDV Kontrol'ü biten mükellefte veri zaten DB'de olduğundan,
 * canlı agent çağrısı OLMADAN hesaplanır. KDV2 tespiti + verilme takibi içerir.
 */
export interface GenelBakisRow {
  mukellefId: string;
  ad: string;
  faturaAdet: number;
  hesaplananKdv: number;
  indirilecekKdv: number;
  devredenKdv: number;
  odenecekKdv: number;
  sonrakiAyaDevreden: number;
  veriGuveniPuan: number;
  veriGuveniSeviye: 'kesin' | 'kontrol_gerekli' | 'eksik';
  durum: 'hazir' | 'eksik' | 'bos';
  kdv1Var: boolean;
  kdv1Verildi: boolean;
  kdv2Var: boolean;            // KDV2 mükellefiyeti açık VEYA tevkifatlı alış var
  kdv2TevkifatTutari: number;  // tevkifatlı alış KDV'si (genel bakış göstergesi)
  kdv2FaturaAdet: number;
  kdv2Verildi: boolean;
}

export interface GenelBakis {
  donem: string;
  hesaplandiAt: string;
  toplam: {
    mukellefAdet: number;
    hazirAdet: number;
    dikkatAdet: number;
    toplamOdenecek: number;
    toplamDevreden: number;
    kdv2Adet: number;
    kdv1VerilmeyenAdet: number;
    kdv2VerilmeyenAdet: number;
  };
  satirlar: GenelBakisRow[];
}
