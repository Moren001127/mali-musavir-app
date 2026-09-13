// HESAP DAVRANIS DENETIMI — ortak tipler.
//   Amac: e-Defter Detay Fis Listesi'ni (donem hareketleri) ve eslik eden Mizan'i (kumulatif bakiye)
//   HER yaprak hesap icin birlikte degerlendirip, gercek bir mali musavirin tek tek yaptigi
//   "hesap davranisi" kontrollerini uretmek (tek yonlu calisma, tahakkuk→odeme dongusu,
//   hareketsiz bakiye, ay atlama, tabiata aykiri bakiye...). Saf fonksiyonlar; Prisma yok.
import type { ParsedEDefterFisLine } from '../edefter-fis-listesi-parser.service';

export type Siddet = 'INFO' | 'WARN' | 'ERROR';

export type DonemTipi = 'AYLIK' | 'GECICI_Q1' | 'GECICI_Q2' | 'GECICI_Q3' | 'GECICI_Q4' | 'YILLIK';

// Servisteki FindingDraft ile birebir ayni sekil (servis dogrudan push eder).
export type Bulgu = {
  severity: Siddet;
  category: string;
  message: string;
  voucherKey?: string | null;
  rowIndex?: number | null;
  hesapKodu?: string | null;
  detail?: Record<string, unknown>;
};

// Mizan baglami (servisteki MizanCtx ile ayni; toplamlar 2026-09 ile eklendi).
export type MizanBaglami = {
  found: boolean;
  bakiyeByCode: Map<string, number>; // borcBakiye − alacakBakiye (borc pozitif)
  toplamByCode?: Map<string, { borc: number; alacak: number; ad: string }>; // yil basindan beri kumulatif hareket
};

// Bir hareketin, ayni fisteki KARSI taraf hesaplarina gore siniflandirilmasi.
//   FATURA: cari borclandirma/alacaklandirma karsisinda gelir/gider/stok/KDV var (satis-alis faturasi).
//   TAHAKKUK: borc hesabinin (3xx) alacaklanmasi karsisinda gider/KDV/ucret hesabi var (vergi, SGK, ucret tahakkuku).
//   ODEME/TAHSILAT: karsi tarafta kasa/banka/cek/ortak/avans gibi "para" hesabi var.
//   IADE: karsi tarafta satis/alis iadesi ya da KDV duzeltmesi var.
//   MAHSUP: karsi tarafta baska bir cari/avans/mahsup hesabi var (120↔320, 340, 159...).
//   DUZELTME: karsi tarafta gider/gelir hesabi var ama yon tahakkuk degil (SGK tesviki gibi) — odeme DEGIL.
//   DIGER: hicbiri.
export type HareketSinifi = 'FATURA' | 'TAHAKKUK' | 'ODEME' | 'TAHSILAT' | 'IADE' | 'MAHSUP' | 'DUZELTME' | 'DIGER';

export type AyIstatistik = {
  ay: string; // 'YYYY-MM'
  borc: number;
  alacak: number;
  borcAdet: number;
  alacakAdet: number;
};

export type Hareket = {
  satir: ParsedEDefterFisLine;
  taraf: 'BORC' | 'ALACAK';
  tutar: number;
  ay: string | null; // fis tarihi yoksa null (tarihsiz satir)
  tarih: Date | null;
  karsi: Set<string>; // ayni fiste karsi taraftaki hesaplarin ana kodlari (3 hane)
  sinif: HareketSinifi;
};

export type HesapIstatistik = {
  kod: string; // yaprak hesap kodu (orn "120.01.A001")
  ad: string;
  ana: string; // 3 haneli ana hesap ("120")
  grup: string; // 2 haneli hesap grubu ("12")
  sinif: string; // 1 haneli hesap sinifi ("1")
  hareketler: Hareket[]; // tarih sirali
  borc: number;
  alacak: number;
  borcAdet: number;
  alacakAdet: number;
  net: number; // borc − alacak (donem hareketi)
  tarihsizAdet: number;
  aylar: Map<string, AyIstatistik>;
  ilkSatir: ParsedEDefterFisLine;
  // Mizan (varsa): kapanis bakiyesi (borc pozitif) ve yil basindan beri kumulatif toplamlar
  mizanKapanis: number | null;
  mizanBorcToplam: number | null;
  mizanAlacakToplam: number | null;
  // acilis = mizanKapanis − net (Mizan kumulatif oldugundan donem basi bakiye kalir). Bilinmiyorsa null.
  acilis: number | null;
  // kapanis = acilis + net (acilis biliniyorsa); yoksa null
  kapanis: number | null;
};

// Yalniz Mizan'da olup donemde hic hareketi olmayan hesaplar (hareketsiz bakiye kontrolu icin).
export type MizanHesabi = {
  kod: string;
  ad: string;
  ana: string;
  kapanis: number; // borc pozitif
  borcToplam: number | null;
  alacakToplam: number | null;
};

export type DefterOzeti = {
  aylar: string[]; // donem araligindaki aylar (YYYY-MM), sirali
  aySayisi: number;
  isYillik: boolean;
  acilisFisiVeride: boolean;
  mizanVar: boolean;
  kasaHareketVar: boolean;
  bankaHareketVar: boolean;
  satisFisSayisi: number; // 600/601 alacak calisan fis sayisi
  alisFisSayisi: number; // 153/15x/7xx borc calisan fis sayisi
  bordroVar: boolean; // 335 ya da 361 hareketi var
  toplamSatir: number;
  toplamFis: number;
};

export type DenetimGirdisi = {
  rows: ParsedEDefterFisLine[];
  range: { start: Date; end: Date } | null;
  donemTipi?: DonemTipi | string | null;
  mizan?: MizanBaglami | null;
};

// Bir kuralin calisma durumu — "kontrol edildi, sorun yok" ile "calismadi" ayrimi icin.
//   TEMIZ: calisti, bulgu yok · BULGU: calisti, bulgu var · UYGULANMAZ: donem tipi/veri yapisi uygun degil
//   VERI_YOK: gerekli girdi (Mizan, tarih, ilgili hesap) yok · PASIF: kullanici/varsayilan kapali
export type KuralDurumu = 'TEMIZ' | 'BULGU' | 'UYGULANMAZ' | 'VERI_YOK' | 'PASIF';

export type KuralKapsami = {
  kod: string;
  durum: KuralDurumu;
  bulgu: number;
  not?: string; // neden calismadi / neye bakildi (kisa)
};

// Bir kural fonksiyonunun dondurdugu sonuc.
export type KuralSonucu = {
  kod: string;
  durum: KuralDurumu;
  bulgular: Bulgu[];
  not?: string;
};

export type DenetimBaglami = {
  hesaplar: Map<string, HesapIstatistik>; // yaprak kod → istatistik
  mizanHesaplari: Map<string, MizanHesabi>; // Mizan yaprak kodlari (hareketsizler dahil)
  ozet: DefterOzeti;
  girdi: DenetimGirdisi;
  fisler: Map<string, ParsedEDefterFisLine[]>; // voucherKey → satirlar
};

export type HesapKarti = {
  kod: string;
  ad: string;
  ana: string;
  borc: number;
  alacak: number;
  borcAdet: number;
  alacakAdet: number;
  acilis: number | null;
  kapanis: number | null;
  mizanKapanis: number | null;
  hareketsiz: boolean; // yalniz Mizan'da var, donemde hareket yok
};

export type DenetimSonucu = {
  bulgular: Bulgu[];
  kapsam: KuralKapsami[];
  hesapKartlari: HesapKarti[];
  ozet: DefterOzeti;
};
