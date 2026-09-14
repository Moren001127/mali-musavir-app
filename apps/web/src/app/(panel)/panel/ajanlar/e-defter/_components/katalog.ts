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

// ── Mizan modülünün KENDİ kontrol tipleri (mizan.service.ts analyzeAccounts) ──
//   Mizan Denetimi sekmesinde e-Defter'in mizana dayanan kurallarıyla TEK listede yazılır;
//   bu yüzden aynı KuralTanimi biçimine çevrilir (ad, alan, mevzuat). Kod: "MIZAN_MODUL:<tip>".
export const MIZAN_MODUL_ONEK = 'MIZAN_MODUL:';
const MIZAN_MODUL_TIPLERI: Record<string, { ad: string; alan: string; mevzuat?: string; aciklama: string }> = {
  TDHP_DISI: { ad: 'TDHP dışı hesap', alan: 'Hesap Planı & Tabiat', mevzuat: 'TDHP', aciklama: 'Ana hesap kodu Tek Düzen Hesap Planı\'nda yok — aktarım/kod hatası olabilir.' },
  NET_OLMAYAN: { ad: 'Hem borç hem alacak bakiye', alan: 'Hesap Planı & Tabiat', mevzuat: 'TDHP', aciklama: 'Hesap aynı anda borç ve alacak bakiyesi veriyor; mizan netleştirilmemiş.' },
  ZIT_BAKIYE: { ad: 'Ters bakiye (mizan)', alan: 'Hesap Planı & Tabiat', mevzuat: 'TDHP', aciklama: 'Hesap, tabiatının tersine bakiye veriyor (borç hesabı alacak ya da tersi).' },
  EKSIK_HESAP: { ad: 'Beklenen hesap yok', alan: 'KDV', mevzuat: 'KDVK 29/41', aciklama: 'Satış/alış hesapları varken karşılığı olan KDV hesabı (191/391) mizanda yok.' },
  SERMAYE_TAAHHUT_YOK: { ad: 'Sermaye taahhüdü yok', alan: 'Özkaynak & Özellikli Hesaplar', mevzuat: 'TTK 344', aciklama: '500 Sermaye hesabında hareket/bakiye yok.' },
  SERMAYE_SURE_DOLDU: { ad: 'Sermaye taahhüt süresi doldu', alan: 'Özkaynak & Özellikli Hesaplar', mevzuat: 'TTK 344', aciklama: 'Kuruluştan 24 ay geçti, 501 Ödenmemiş Sermaye hâlâ bakiye veriyor.' },
  'SERMAYE_SURE_YAKLAŞIYOR': { ad: 'Sermaye taahhüt süresi yaklaşıyor', alan: 'Özkaynak & Özellikli Hesaplar', mevzuat: 'TTK 344', aciklama: '24 aylık ödeme süresi dolmak üzere, 501 bakiye veriyor.' },
  KASA_NEGATIF: { ad: 'Kasa negatif (mizan)', alan: 'Kasa & Banka', mevzuat: 'TDHP', aciklama: '100 Kasa mizanda alacak bakiyesi veriyor; fiziki nakit eksiye düşemez.' },
  BANKA_NEGATIF: { ad: 'Banka negatif (mizan)', alan: 'Kasa & Banka', mevzuat: 'TDHP', aciklama: '102 Banka mizanda alacak bakiyesi veriyor.' },
  STOK_NEGATIF: { ad: 'Stok negatif (mizan)', alan: 'Stok & Maliyet', mevzuat: 'TDHP', aciklama: 'Stok hesabı mizanda alacak bakiyesi veriyor; sayım/maliyet kontrolü gerekir.' },
  AMORTISMAN_AYRILMAMIS: { ad: 'Amortisman ayrılmamış', alan: 'Duran Varlık & Amortisman', mevzuat: 'VUK 313/333', aciklama: 'Sabit kıymet var, 257 Birikmiş Amortisman\'da yıl sonu amortismanı görünmüyor.' },
  KAPANIS_YAPILMAMIS: { ad: 'Yıl sonu kapanış yapılmamış', alan: 'Dönem Sonu / Açılış-Kapanış', mevzuat: 'TDHP', aciklama: '6xx/690 hesapları yıl sonunda kapatılmamış, hâlâ bakiye veriyor.' },
  MALIYET_KAPANMAMIS: { ad: 'Maliyet (7xx) kapatılmamış', alan: 'Dönem Sonu / Açılış-Kapanış', mevzuat: 'TDHP', aciklama: '7\'li hesaplar dönem sonunda net sıfır olmalı; yansıtma eksik.' },
  DONEM_KARI_DEVREDILMEMIS: { ad: 'Dönem kârı devredilmemiş (590→570)', alan: 'Özkaynak & Özellikli Hesaplar', mevzuat: 'TDHP', aciklama: '590 Dönem Net Kârı geçmiş yıl kârlarına devredilmemiş.' },
  DONEM_ZARARI_DEVREDILMEMIS: { ad: 'Dönem zararı devredilmemiş (591→580)', alan: 'Özkaynak & Özellikli Hesaplar', mevzuat: 'TDHP', aciklama: '591 Dönem Net Zararı geçmiş yıl zararlarına devredilmemiş.' },
  ORTULU_SERMAYE_RISKI: { ad: 'Örtülü sermaye riski', alan: 'Özkaynak & Özellikli Hesaplar', mevzuat: 'KVK 12', aciklama: 'Ortaklara borçlar (331/431) özsermayenin 3 katını aşıyor.' },
  TTK376_TEKNIK_IFLAS: { ad: 'TTK 376 teknik iflas', alan: 'Özkaynak & Özellikli Hesaplar', mevzuat: 'TTK 376', aciklama: 'Özsermaye negatif — borca batıklık.' },
  TTK376_SERMAYE_KAYBI: { ad: 'TTK 376 sermaye kaybı', alan: 'Özkaynak & Özellikli Hesaplar', mevzuat: 'TTK 376', aciklama: 'Özsermaye sermayenin yarısının altında.' },
  ORTAK_CARI_CIFT_YONLU: { ad: 'Ortakla çift yönlü cari (131+331)', alan: 'Ortaklar (131/331)', mevzuat: 'KVK 13', aciklama: 'Aynı dönemde hem 131 hem 331 bakiye veriyor.' },
  KURUMLAR_VERGISI_TAHAKKUKU: { ad: 'Kurumlar vergisi tahakkuku', alan: 'Dönem Sonu / Açılış-Kapanış', mevzuat: 'KVK 32', aciklama: '370/371 vergi karşılığı açık, kapama hareketi görünmüyor.' },
  KDV_INDIRIM_YAPILMAMIS: { ad: 'KDV indirimi yapılmamış', alan: 'KDV', mevzuat: 'KDVK 29', aciklama: '191 İndirilecek KDV mizanda bakiye veriyor.' },
  KDV_BEYAN_TAMAMLANMAMIS: { ad: 'KDV beyanı tamamlanmamış', alan: 'KDV', mevzuat: 'KDVK 41', aciklama: '391 Hesaplanan KDV mizanda bakiye veriyor.' },
  MIZAN_DENGESIZ: { ad: 'Mizan dengesiz', alan: 'Mizan Mutabakatı', mevzuat: 'VUK 219', aciklama: 'Mizan toplam borç ile toplam alacak eşit değil.' },
};
export function mizanModulTanimi(tip: string): KuralTanimi {
  const t = String(tip || '').trim();
  const bilinen = MIZAN_MODUL_TIPLERI[t];
  const ad = bilinen?.ad || (t ? t.replace(/_/g, ' ').toLocaleLowerCase('tr-TR').replace(/^./, (c) => c.toLocaleUpperCase('tr-TR')) : 'Mizan bulgusu');
  return {
    kod: MIZAN_MODUL_ONEK + t, ad, aciklama: bilinen?.aciklama || 'Mizan modülünün kendi kontrolü.', oneri: '',
    siddet: 'WARN', alan: bilinen?.alan || 'Mizan Mutabakatı', mevzuat: bilinen?.mevzuat, varsayilanAktif: true, mizanGerekli: true,
  };
}
// Mizan modülü anomalisini (MizanAnomali) e-Defter bulgu satırı biçimine çevirir — salt görünüm (çözüldü/görmezden yok).
//   Mesaj başındaki `KOD "AD"` kalıbı hesap sütununa taşınır, satırda yalnız olgu kalır.
export function mizanAnomaliToBulgu(a: any) {
  const tip = String(a?.tip || '').trim();
  const kod = String(a?.hesapKodu || '').trim();
  let message = String(a?.mesaj || '').trim();
  let hesapAdi = '';
  const m = /^(\S+)\s+"([^"]+)"\s*(.*)$/s.exec(message);
  if (m && (!kod || m[1] === kod)) { hesapAdi = m[2]; message = m[3] || message; }
  return {
    id: `mizan:${a?.id || `${tip}:${kod}`}`, severity: String(a?.seviye || 'WARN').toUpperCase(), category: MIZAN_MODUL_ONEK + tip,
    message, hesapKodu: kod || null, status: 'OPEN', saltGorunum: true,
    detail: { hesapAdi: hesapAdi || undefined, tip, mizanModul: true },
  };
}
