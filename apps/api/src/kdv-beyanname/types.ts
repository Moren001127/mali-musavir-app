/**
 * KDV Beyanname Ön Hazırlık — tip tanımları.
 *
 * KDV1 ve KDV2 için gereken verileri Mihsap fatura + Luca mizan + geçmiş
 * BeyanKaydi'ndan derler, mali müşavirin BDP'ye elle girmesi için özet sunar.
 */

export type KdvTip = 'KDV1' | 'KDV2';

/** Tek bir oranın satır breakdown'u — matrah + KDV */
export interface OranRow {
  oran: number; // 1 | 8 | 10 | 18 | 20
  matrah: number;
  kdv: number;
  adet: number; // Kaç fatura bu orana dahil
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
    kaynak: 'beyan_kaydi' | 'luca_mizan' | 'yok';
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
    uyarilar: string[];
  };

  // === VERİ KAYNAĞI KALİTESİ ===
  kaliteRapor: {
    ocrliFaturaOrani: number; // 0-1 — KDV Kontrol'den geçmiş oran. Yüksekse veri kesin.
    tahminFaturaOrani: number; // 0-1 — Sadece varsayılan %20 ile tahmin edilen oran
    uyarilar: string[];
  };
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
    tevkifatTutari: number;
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
