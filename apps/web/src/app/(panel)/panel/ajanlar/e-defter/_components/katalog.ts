// Kural kataloğu — sunucudan (GET /edefter-control/rule-settings → catalog) gelir; burada yalnız tip + yardımcılar.
export type KuralTanimi = {
  kod: string;
  ad: string;
  aciklama: string;
  oneri?: string;
  siddet: 'ERROR' | 'WARN' | 'INFO';
  alan: string;
  mevzuat?: string;
  varsayilanAktif: boolean;
  donemKisiti?: string;
  mizanGerekli?: boolean;
  motor?: 'ESKI' | 'HDD';
};

export type KuralDurumu = 'TEMIZ' | 'BULGU' | 'UYGULANMAZ' | 'VERI_YOK' | 'PASIF';

export type KontrolOzeti = {
  surum: number;
  uretim: string;
  ozet: {
    kural: number; calisti: number; temiz: number; bulgulu: number; uygulanmaz: number; veriYok: number; pasif: number;
    hesap: number; hareketsizHesap: number; mizanVar: boolean; aySayisi: number;
  };
  kapsam: Array<{ kod: string; durum: KuralDurumu; bulgu: number; not?: string }>;
  hesaplar: Array<{
    kod: string; ad: string; ana: string; borc: number; alacak: number; borcAdet: number; alacakAdet: number;
    acilis: number | null; kapanis: number | null; mizanKapanis: number | null; hareketsiz: boolean;
  }>;
};

// Alan sırası ve ikonları (sunucu ALAN adlarıyla birebir)
export const ALAN_SIRASI: string[] = [
  'Temel Bütünlük', 'Cari Hesaplar (120/320)', 'Vergi & SGK Ödemeleri (335/360/361)', 'Kasa & Banka', 'KDV', 'Bordro & Stopaj',
  'Stok & Maliyet', 'Gelir & Gider', 'Duran Varlık & Amortisman', 'Krediler & Finansman', 'Ortaklar (131/331)', 'Avans, Çek & Senet',
  'Dönem Sonu / Açılış-Kapanış', 'Özkaynak & Özellikli Hesaplar', 'Mizan Mutabakatı', 'Hesap Planı & Tabiat', 'Belge / Evrak',
  'Yevmiye / Fiş', 'Forensic / Anomali', 'Diğer',
];
export const ALAN_IKON: Record<string, string> = {
  'Temel Bütünlük': '🔍', 'Cari Hesaplar (120/320)': '👥', 'Vergi & SGK Ödemeleri (335/360/361)': '🏛️', 'Kasa & Banka': '🏦', 'KDV': '🧾',
  'Bordro & Stopaj': '👷', 'Stok & Maliyet': '📦', 'Gelir & Gider': '📈', 'Duran Varlık & Amortisman': '🏗️', 'Krediler & Finansman': '💳',
  'Ortaklar (131/331)': '⚖️', 'Avans, Çek & Senet': '📜', 'Dönem Sonu / Açılış-Kapanış': '📅', 'Özkaynak & Özellikli Hesaplar': '🏢',
  'Mizan Mutabakatı': '🔗', 'Hesap Planı & Tabiat': '🗂️', 'Belge / Evrak': '📄', 'Yevmiye / Fiş': '📋', 'Forensic / Anomali': '🔬', 'Diğer': '•',
};
export function alanSira(alan: string) { const i = ALAN_SIRASI.indexOf(alan); return i === -1 ? 99 : i; }

export const DURUM_ETIKET: Record<KuralDurumu, string> = {
  TEMIZ: 'Kontrol edildi, sorun yok',
  BULGU: 'Bulgu var',
  UYGULANMAZ: 'Bu dönem türünde uygulanmaz',
  VERI_YOK: 'Gerekli veri yok',
  PASIF: 'Kural kapalı',
};

// Eski ekran etiketleri — katalogda olmayan (çok eski) kodlar için yedek
export const ESKI_ETIKET: Record<string, string> = {
  FIS_TARIHI_EKSIK: 'Fiş tarihi eksik', KASA_GUNLUK_30000_TEVSIK_RISKI: 'Kasa 30.000 TL tevsik',
};
