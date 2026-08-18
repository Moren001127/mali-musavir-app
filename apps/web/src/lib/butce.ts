import { api } from './api';

/* ===================== PIN BİLETİ =====================
 * Modül girişinde doğrulanan 6 haneli PIN karşılığında sunucudan alınan
 * süreli bilet. Sekme belleğinde tutulur — sekme kapanınca PIN yeniden sorulur.
 */
const PIN_ANAHTAR = 'moren-butce-pin-bilet';

export const pinBileti = {
  al: () => (typeof window === 'undefined' ? null : window.sessionStorage.getItem(PIN_ANAHTAR)),
  yaz: (bilet: string) => window.sessionStorage.setItem(PIN_ANAHTAR, bilet),
  sil: () => window.sessionStorage.removeItem(PIN_ANAHTAR),
};

/**
 * /butce ile başlayan her isteğe PIN biletini otomatik ekler.
 * Böylece tek tek çağrılara başlık geçirmek gerekmez ve bilet unutulmaz.
 */
let araciKuruldu = false;
if (!araciKuruldu) {
  araciKuruldu = true;
  api.interceptors.request.use((config) => {
    if (String(config.url || '').startsWith('/butce')) {
      const bilet = pinBileti.al();
      if (bilet) config.headers.set?.('X-Butce-Pin', bilet);
    }
    return config;
  });

  // PIN bileti düşerse (süre doldu / silindi) bileti temizle ki arayüz PIN ekranına dönsün.
  api.interceptors.response.use(
    (r) => r,
    (hata) => {
      const mesaj = String(hata?.response?.data?.message || '');
      if (hata?.response?.status === 403 && mesaj.includes('BUTCE_PIN_GEREKLI')) {
        pinBileti.sil();
        window.dispatchEvent(new CustomEvent('butce-pin-gerekli'));
      }
      return Promise.reject(hata);
    },
  );
}

/* ===================== TİPLER ===================== */

export type Tur = 'GELIR' | 'GIDER';
/** Şahsi mi ofis mi — aynı kart/hesap iki defter için de kullanılabilir, ayrım HAREKET düzeyinde */
export type Defter = 'SAHSI' | 'OFIS';
export type DefterSecim = Defter | 'TUMU';

/**
 * Şahıs firmasında ofisin geliri sahibinin geliridir; ayrım yalnız GİDER tarafındadır.
 * OFIS = mesleki gider (kazançtan indirilir), SAHSI = kişisel gider (indirilemez).
 */
export const DEFTER_ETIKET: Record<DefterSecim, string> = {
  SAHSI: 'Kişisel',
  OFIS: 'Ofis',
  TUMU: 'Tümü',
};

export interface BankaHesap {
  id: string;
  varsayilanDefter: Defter;
  ad: string;
  bankaAdi: string;
  iban4?: string | null;
  tur: 'VADESIZ' | 'KMH';
  acilisBakiye: number;
  acilisTarihi?: string | null;
  kmhLimiti: number;
  kmhAylikFaiz: number;
  /** Oran girilmemiş — ekran "TCMB tahmini kullanılıyor" diyebilsin */
  kmhFaizGirilmedi?: boolean;
  renk?: string | null;
  aktif: boolean;
  /** Cari Kasa > Tahsilat formundaki hesap kutusunda çıksın mı */
  tahsilataAcik: boolean;
  sira: number;
  bakiye: number;
  kmhBorcu: number;
  kmhKalanLimit: number;
  kmhDoluluk: number;
  kullanilabilir: number;
}

export interface HesapHareket {
  id: string;
  tarih: string;
  aciklama: string;
  kategori: string | null;
  defter: string | null;
  tutar: number;
  kayitTuru: 'ISLEM' | 'ODEME' | 'TRANSFER' | 'CARI_TAHSILAT';
}

export interface AkisHareketOzet {
  ad: string;
  tutar: number;
  tur: 'GELIR' | 'GIDER' | 'KART_ODEME' | 'KREDI_TAKSIT' | 'KMH_FAIZ';
  kesin: boolean;
}

export interface AkisGunu {
  tarih: string;
  giris: number;
  cikis: number;
  bakiye: number;
  hareketler: AkisHareketOzet[];
  acik: number;
}

/** Bildirim şablonu önizlemesi */
export interface SablonOnizleme {
  anahtar: string;
  baslik: string;
  metin: string;
  gonderildi: boolean;
}

/** Kasadaki tek bir hareket */
export interface KasaHareket {
  id: string;
  tarih: string;
  donem: string;
  tur: 'GELIR' | 'GIDER';
  tutar: number;
  aciklama: string | null;
  defter: Defter;
  kategori: { ad: string; renk: string } | null;
}

/** Nakit kasa: banka hesabı seçilmeden girilmiş hareketlerin toplamı */
export interface KasaOzet {
  bakiye: number;
  giris: number;
  cikis: number;
  hareketSayisi: number;
  /** Kategori bazlı toplamlar — büyükten küçüğe */
  kirilim: Array<{ ad: string; renk: string; tur: 'GELIR' | 'GIDER'; tutar: number }>;
}

export interface AkisSecenek {
  ad: string;
  aciklama: string;
  maliyet: number;
  /** Faiz oranı girilmediği için maliyet hesaplanamadı — "maliyetsiz" sanılmasın */
  maliyetBilinmiyor?: boolean;
  /** Maliyet TCMB ortalamasından tahmin edildi, kesin değil */
  maliyetTahmini?: boolean;
  onerilen: boolean;
}

export interface AkisOnerisi {
  tarih: string;
  /** O günkü toplam açık (devreden dahil) */
  toplamAcik?: number;
  /** Önceki açık günlerinde kapatıldığı varsayılan tutar */
  devredenAcik?: number;
  /** O gün çıkan ödemeler */
  oGunkuOdemeler?: Array<{ ad: string; tutar: number; tur: string }>;
  acik: number;
  baslik: string;
  secenekler: AkisSecenek[];
}

export interface NakitAkis {
  baslangicNakit: number;
  gunler: AkisGunu[];
  enDusuk: { tarih: string; tutar: number };
  acikGunler: AkisGunu[];
  kmhIleKarsilanir: boolean;
  toplamGiris: number;
  toplamCikis: number;
  kmhLimitToplam: number;
  oneriler: AkisOnerisi[];
  hesaplar: Array<{ id: string; ad: string; bankaAdi: string; bakiye: number; renk?: string | null }>;
}

export interface TahsilatOzet {
  /** source boş + hesap boş — düzeltilebilir, hesabı seçilince bakiyeye girer */
  hesabiSecilmemis: { adet: number; toplam: number };
  /** Aktarımla gelen geçmiş (Hattat) — beyaz liste gereği asla akmaz */
  arsiv: { adet: number; toplam: number };
}

export type Strateji = 'CIG' | 'KARTOPU';
export type EkstreDurum = 'TUTAR_BEKLENIYOR' | 'ODENMEDI' | 'KISMI' | 'ODENDI' | 'GECIKTI';

export interface Kategori {
  id: string;
  defter: Defter;
  ad: string;
  tur: Tur;
  renk?: string | null;
  zorunlu: boolean;
  aktif: boolean;
  sira: number;
}

export interface Islem {
  id: string;
  defter: Defter;
  bankaHesapId?: string | null;
  bankaHesap?: { id: string; ad: string; bankaAdi: string } | null;
  transferGrupId?: string | null;
  tarih: string;
  donem: string;
  tur: Tur;
  tutar: number;
  kategoriId?: string | null;
  kategori?: { id: string; ad: string; renk?: string | null; zorunlu?: boolean } | null;
  aciklama?: string | null;
  kaynak: 'NAKIT' | 'BANKA' | 'KART';
  kartId?: string | null;
  planlanan: boolean;
  /** BUTCE = bu modülün kaydı · CARI_TAHSILAT = Cari Kasa'dan okunan tahsilat */
  kaynakTur?: 'BUTCE' | 'CARI_TAHSILAT';
  /** Cari Kasa'dan okunan satırlar burada düzenlenemez/silinemez */
  duzenlenebilir?: boolean;
}

export interface DuzenliOdeme {
  id: string;
  defter: Defter;
  ad: string;
  tur: Tur;
  tutar: number;
  kategoriId?: string | null;
  kategori?: { id: string; ad: string; renk?: string | null } | null;
  ayinGunu: number;
  baslangicDonem: string;
  bitisDonem?: string | null;
  kaynak: string;
  kartId?: string | null;
  zorunlu: boolean;
  aktif: boolean;
}

export interface Ekstre {
  id: string;
  kartId: string;
  donem: string;
  kesimTarihi: string;
  sonOdemeTarihi: string;
  borcTutari: number | null;
  asgariTutar: number | null;
  odenenTutar: number;
  kalanTutar: number | null;
  durum: EkstreDurum;
  odemeTarihi?: string | null;
  notlar?: string | null;
  kalanGun?: number;
  /** Kesim tarihi henüz gelmedi — "tutar girilmedi" uyarısı gösterilmez */
  kesilmedi?: boolean;
  /** Bu ekstrenin kapsadığı harcama aralığı */
  harcamaBaslangic?: string | null;
  harcamaBitis?: string | null;
  /** Daha yeni bir ekstreye devretmiş, borç toplamına girmez */
  devretti?: boolean;
  kart?: { id: string; bankaAdi: string; kartAdi: string; renk?: string | null };
}

export interface Kart {
  id: string;
  varsayilanDefter: Defter;
  bankaAdi: string;
  kartAdi: string;
  sonDortHane?: string | null;
  kartLimiti: number;
  kesimGunu: number;
  sonOdemeGunFarki: number;
  asgariOran: number;
  aylikFaizOrani: number;
  gecikmeFaizOrani: number;
  renk?: string | null;
  aktif: boolean;
  ekstreler: Ekstre[];
  guncelEkstre: Ekstre | null;
  /** Borcun hesaplandığı ekstre (tutarı girilmiş en son ekstre) */
  borcEkstresi: Ekstre | null;
  /** Kesilmiş ekstrenin ödenmemiş kısmı */
  ekstreBorcu: number;
  /** Son kesimden sonra yapılan, henüz ekstreye girmemiş harcama */
  donemIciHarcama: number;
  donemIciBaslangic: string;
  /** ekstreBorcu + donemIciHarcama */
  guncelBorc: number;
  kalanBorc: number;
  kullanilabilirLimit: number;
  limitDoluluk: number;
}

export interface KartHareket {
  id: string;
  ekstreId: string;
  tarih: string;
  aciklama: string;
  satici?: string | null;
  tutar: number;
  taksitBilgi?: string | null;
  kategoriId?: string | null;
  kategori?: { id: string; ad: string; renk?: string | null } | null;
  kategoriKaynak: 'HAFIZA' | 'AI' | 'ELLE';
  onaylandi: boolean;
}

export interface Borc {
  id: string;
  defter: Defter;
  ad: string;
  tur: string;
  kurum?: string | null;
  toplamTutar: number;
  kalanAnapara: number;
  yillikFaiz: number;
  aylikFaiz: number;
  taksitTutari: number;
  toplamTaksit: number;
  odenenTaksit: number;
  kalanTaksit: number;
  odemeGunu: number;
  bitisTarihi?: string | null;
  erkenKapamaCezasi?: number | null;
  durum: 'AKTIF' | 'KAPANDI';
  notlar?: string | null;
}

export interface Ayar {
  nakitYastigi: number;
  strateji: Strateji;
  hatirlatmaWhatsapp: boolean;
  hatirlatmaPortal: boolean;
  hatirlatmaEmail: boolean;
  whatsappNumara?: string | null;
  sabahSaati: number;
}

export interface Uyari {
  seviye: 'KRITIK' | 'UYARI' | 'BILGI';
  baslik: string;
  mesaj: string;
}

export interface Ozet {
  donem: string;
  gelir: number;
  gider: number;
  /** Kartla yapılan harcamalar (o ay nakit çıkışı değildir) */
  /** Kazançtan indirilebilen mesleki (ofis) giderler */
  meslekiGider: number;
  /** İndirilemeyen kişisel harcamalar */
  kisiselGider: number;
  /** Vergi matrahına esas: gelir − mesleki gider */
  meslekiKazanc: number;
  /** Cepte kalan: gelir − tüm giderler */
  cepteKalan: number;
  kartGideri: number;
  /** Nakit/banka ile yapılan gider */
  nakitGider: number;
  /** Banka hesaplarındaki bakiye */
  bankaBakiyesi: number;
  /** Hesap seçilmeden girilmiş hareketlerin net etkisi (eldeki nakit) */
  nakitKasasi: number;
  /** Borca ayrılabilecek para — Ödeme Planı ile aynı hesap */
  odemeKapasitesi: number;
  net: number;
  /** Nakit akışı: gelir − nakit gider */
  nakitNet: number;
  nakitYastigi: number;
  defter: DefterSecim;
  nakitVarlik: number;
  netVarlik: number;
  hesapOzet: Array<{ id: string; ad: string; bankaAdi: string; bakiye: number; kmhBorcu: number; renk?: string | null }>;
  borcOzet: {
    kart: number;
    kartDonemIci: number;
    kredi: number;
    kmh: number;
    toplam: number;
    aylikZorunluOdeme: number;
  };
  kategoriKirilim: Array<{ ad: string; renk: string; tutar: number; zorunlu: boolean ; defter: Defter }>;
  trend: Array<{ donem: string; gelir: number; gider: number }>;
  yaklasanOdemeler: Ekstre[];
  uyarilar: Uyari[];
}

export interface KalemOdeme {
  id: string;
  ad: string;
  tip: 'KART' | 'KREDI';
  /** Ödenmesi GEREKEN tutar (kapasiteye göre kırpılmaz) */
  zorunlu: number;
  /** Kapasiteden bu borca ayrılabilen */
  odenen: number;
  /** Karşılanamayan kısım */
  eksik: number;
  ekstra: number;
  toplam: number;
  kalanSonra: number;
}

export interface PlanSonuc {
  strateji: Strateji;
  ayAdedi: number | null;
  toplamFaiz: number;
  toplamOdeme: number;
  ilkAy: KalemOdeme[];
  kapanisSirasi: Array<{ id: string; ad: string; ay: number }>;
  acik: number;
  kapanmiyor: boolean;
}

export interface Plan {
  donem: string;
  defter: DefterSecim;
  gelir: number;
  gider: number;
  nakitYastigi: number;
  /** Elde olan toplam para: banka bakiyeleri + nakit kasası */
  nakitVarlik: number;
  /** Banka hesaplarındaki bakiye */
  bankaBakiyesi: number;
  /** Hesap seçilmeden girilmiş hareketlerin net etkisi */
  nakitKasasi: number;
  /** Yastık düşülmeden önce elde olan toplam para */
  kullanilabilirNakit: number;
  /** Bu ay öncesinden devreden para — her ay tekrarlamaz */
  birikim: number;
  /** Ortalamanın kaç aylık veriye dayandığı (1 ise yalnız bu ay) */
  ortalamaAySayisi: number;
  /** Ortalama aylık gelir */
  ortalamaGelir: number;
  /** Ortalama aylık nakit gider */
  ortalamaGider: number;
  /** Bu ay fiilen ödeyebileceğiniz toplam */
  buAyToplam: number;
  otomatikKapasite: number;
  kapasite: number;
  strateji: Strateji;
  kalemler: Array<{ id: string; ad: string; tip: 'KART' | 'KREDI'; kalan: number; aylikFaiz: number }>;
  secilen: PlanSonuc;
  karsilastirma: {
    onerilen: Strateji;
    cig: PlanSonuc;
    kartopu: PlanSonuc;
    faizFarki: number;
    ayFarki: number;
  };
  fayda: Array<{ id: string; ad: string; kazanc: number; ay: number }>;
  not: string;
}

export interface AiRapor {
  id: string;
  tur: string;
  donem?: string | null;
  soru?: string | null;
  icerik: string;
  model: string;
  createdAt: string;
  hata?: boolean;
  onbellek?: boolean;
}

export interface PdfSonuc {
  ekstreId: string;
  donem: string;
  yontem: 'KURAL' | 'AI' | 'KURAL+AI';
  hareketSayisi: number;
  hareketToplami: number;
  okunanOzet: {
    donemBorcu: number | null;
    asgariTutar: number | null;
    sonOdemeTarihi: string | null;
    kesimTarihi: string | null;
  };
  kategoriKaynak: { hafiza: number; ai: number; bos: number };
  uyari: string | null;
}

/* ===================== API ===================== */

const al = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export interface PinDurum {
  kurulu: boolean;
  kilitli: boolean;
  kilitBitis: string | null;
  kalanDeneme: number;
}

export const butceApi = {
  erisim: () => al<{ yetkili: boolean }>(api.get('/butce/erisim')),

  pinDurum: () => al<PinDurum>(api.get('/butce/pin/durum')),
  pinKur: (pin: string, eskiPin?: string) =>
    al<{ bilet: string; bitis: number }>(api.post('/butce/pin/kur', { pin, eskiPin })),
  pinAc: (pin: string) => al<{ bilet: string; bitis: number }>(api.post('/butce/pin/ac', { pin })),

  ozet: (donem?: string, defter?: DefterSecim) =>
    al<Ozet>(api.get('/butce/ozet', { params: { donem, defter } })),

  hesaplar: () => al<BankaHesap[]>(api.get('/butce/hesaplar')),
  tahsilatOzeti: () => al<TahsilatOzet>(api.get('/butce/tahsilat-ozet')),
  kasa: () => al<KasaOzet>(api.get('/butce/kasa')),
  sablonTesti: (gonder = false) =>
    al<SablonOnizleme[]>(api.post('/butce/sablon-testi', { gonder })),
  kasaHareketleri: (donem?: string) =>
    al<KasaHareket[]>(api.get('/butce/kasa/hareketler', { params: { donem } })),
  hesapEkle: (body: Partial<BankaHesap>) => al<BankaHesap>(api.post('/butce/hesaplar', body)),
  hesapGuncelle: (id: string, body: Partial<BankaHesap>) =>
    al<BankaHesap>(api.put(`/butce/hesaplar/${id}`, body)),
  hesapSil: (id: string) =>
    al<{ ok: boolean; pasifeAlindi: boolean; kullanim?: number }>(api.delete(`/butce/hesaplar/${id}`)),
  hesapHareketleri: (id: string, donem?: string) =>
    al<HesapHareket[]>(api.get(`/butce/hesaplar/${id}/hareketler`, { params: { donem } })),

  transfer: (body: {
    tutar: number;
    tarih?: string;
    kaynakDefter?: Defter;
    hedefDefter?: Defter;
    kaynakHesapId?: string | null;
    hedefHesapId?: string | null;
    aciklama?: string;
  }) => al<{ ok: boolean; transferGrupId: string; tutar: number; aciklama: string }>(api.post('/butce/transfer', body)),

  nakitAkis: (gunSayisi?: number) => al<NakitAkis>(api.get('/butce/nakit-akis', { params: { gunSayisi } })),

  islemGerceklesti: (id: string, body: { tarih?: string; tutar?: number; bankaHesapId?: string }) =>
    al<Islem>(api.post(`/butce/islemler/${id}/gerceklesti`, body)),
  odemeSil: (id: string) => al(api.delete(`/butce/odemeler/${id}`)),
  hareketDefter: (id: string, defter: Defter, hepsineUygula = true) =>
    al(api.put(`/butce/hareketler/${id}/defter`, { defter, hepsineUygula })),

  ayar: () => al<Ayar>(api.get('/butce/ayar')),
  ayarKaydet: (body: Partial<Ayar>) => al<Ayar>(api.put('/butce/ayar', body)),

  kategoriler: (defter?: DefterSecim) =>
    al<Kategori[]>(api.get('/butce/kategoriler', { params: { defter } })),
  kategoriEkle: (body: Partial<Kategori>) => al<Kategori>(api.post('/butce/kategoriler', body)),
  hazirKategoriler: () =>
    al<{ eklenen: number; toplam: number }>(api.post('/butce/kategoriler/hazir-set')),
  kategoriGuncelle: (id: string, body: Partial<Kategori>) =>
    al<Kategori>(api.put(`/butce/kategoriler/${id}`, body)),
  kategoriSil: (id: string) => al(api.delete(`/butce/kategoriler/${id}`)),

  islemler: (
    p: {
      donem?: string;
      tur?: string;
      kategoriId?: string;
      kartId?: string;
      bankaHesapId?: string;
      defter?: DefterSecim;
      planlanan?: boolean;
    } = {},
  ) => al<Islem[]>(api.get('/butce/islemler', { params: { ...p, planlanan: p.planlanan ? 1 : undefined } })),
  islemEkle: (body: Partial<Islem>) => al<Islem>(api.post('/butce/islemler', body)),
  islemGuncelle: (id: string, body: Partial<Islem>) => al<Islem>(api.put(`/butce/islemler/${id}`, body)),
  islemSil: (id: string) => al(api.delete(`/butce/islemler/${id}`)),

  duzenliler: (defter?: DefterSecim) =>
    al<DuzenliOdeme[]>(api.get('/butce/duzenliler', { params: { defter } })),
  duzenliEkle: (body: Partial<DuzenliOdeme>) => al<DuzenliOdeme>(api.post('/butce/duzenliler', body)),
  duzenliGuncelle: (id: string, body: Partial<DuzenliOdeme>) =>
    al<DuzenliOdeme>(api.put(`/butce/duzenliler/${id}`, body)),
  duzenliSil: (id: string) => al(api.delete(`/butce/duzenliler/${id}`)),
  duzenliUygula: (donem?: string) =>
    al<{ donem: string; eklenen: number }>(api.post('/butce/duzenliler/uygula', { donem })),

  kartlar: () => al<Kart[]>(api.get('/butce/kartlar')),
  kartEkle: (body: Partial<Kart>) => al<Kart>(api.post('/butce/kartlar', body)),
  kartGuncelle: (id: string, body: Partial<Kart>) => al<Kart>(api.put(`/butce/kartlar/${id}`, body)),
  kartSil: (id: string) => al(api.delete(`/butce/kartlar/${id}`)),

  ekstreler: (kartId?: string) => al<Ekstre[]>(api.get('/butce/ekstreler', { params: { kartId } })),
  ekstreUret: (kartId: string, donem?: string) =>
    al<Ekstre>(api.post('/butce/ekstreler/uret', { kartId, donem })),
  ekstreTutar: (id: string, body: { borcTutari: number; asgariTutar?: number; notlar?: string }) =>
    al<Ekstre>(api.put(`/butce/ekstreler/${id}/tutar`, body)),
  ekstreOdeme: (id: string, body: { tutar: number; tarih?: string; tip?: string; bankaHesapId?: string | null }) =>
    al<Ekstre>(api.post(`/butce/ekstreler/${id}/odeme`, body)),

  ekstrePdfYukle: (kartId: string, dosya: File, opts: { donem?: string; sifre?: string } = {}) => {
    const form = new FormData();
    form.append('dosya', dosya);
    form.append('kartId', kartId);
    if (opts.donem) form.append('donem', opts.donem);
    if (opts.sifre) form.append('sifre', opts.sifre);
    return al<PdfSonuc>(
      api.post('/butce/ekstreler/pdf', form, { headers: { 'Content-Type': 'multipart/form-data' } }),
    );
  },
  hareketler: (ekstreId: string) => al<KartHareket[]>(api.get(`/butce/ekstreler/${ekstreId}/hareketler`)),
  hareketKategori: (id: string, kategoriId: string, hepsineUygula = true) =>
    al(api.put(`/butce/hareketler/${id}/kategori`, { kategoriId, hepsineUygula })),
  hareketOnayla: (ekstreId: string) =>
    al<{ islenen: number }>(api.post(`/butce/ekstreler/${ekstreId}/hareketler/onayla`)),
  hareketGeriAl: (ekstreId: string) =>
    al<{ geriAlinan: number }>(api.post(`/butce/ekstreler/${ekstreId}/hareketler/geri-al`)),

  borclar: (hepsi = false, defter?: DefterSecim) =>
    al<Borc[]>(api.get('/butce/borclar', { params: { hepsi: hepsi ? 1 : 0, defter } })),
  borcEkle: (body: Partial<Borc>) => al<Borc>(api.post('/butce/borclar', body)),
  borcGuncelle: (id: string, body: Partial<Borc>) => al<Borc>(api.put(`/butce/borclar/${id}`, body)),
  borcSil: (id: string) => al(api.delete(`/butce/borclar/${id}`)),
  borcOdeme: (
    id: string,
    body: { tutar: number; tarih?: string; tip?: string; bankaHesapId?: string | null },
  ) => al<Borc>(api.post(`/butce/borclar/${id}/odeme`, body)),

  plan: (p: { donem?: string; kapasite?: number; strateji?: Strateji; defter?: DefterSecim } = {}) =>
    al<Plan>(api.get('/butce/plan', { params: p })),
  fayda: (tutar: number) =>
    al<{ tutar: number; siralama: Array<{ id: string; ad: string; kazanc: number; ay: number }> }>(
      api.get('/butce/fayda', { params: { tutar } }),
    ),

  aiAylik: (donem?: string, yenile = false) => al<AiRapor>(api.post('/butce/ai/aylik-yorum', { donem, yenile })),
  aiPlan: (yenile = false) => al<AiRapor>(api.post('/butce/ai/plan-yorum', { yenile })),
  aiSoru: (soru: string) => al<AiRapor>(api.post('/butce/ai/soru', { soru })),
  aiGecmis: (tur?: string) => al<AiRapor[]>(api.get('/butce/ai/gecmis', { params: { tur } })),
};

/* ===================== YARDIMCI ===================== */

export const para = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const paraKisa = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}B`;
  return v.toLocaleString('tr-TR', { maximumFractionDigits: 0 });
};

export const tarihTR = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export const donemTR = (donem: string) => {
  const [y, a] = donem.split('-').map(Number);
  const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  return `${aylar[(a || 1) - 1]} ${y}`;
};

export const buDonem = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const donemKaydir = (donem: string, n: number) => {
  const [y, a] = donem.split('-').map(Number);
  const d = new Date(Date.UTC(y, a - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const BORC_TURLERI: Array<{ deger: string; etiket: string }> = [
  { deger: 'IHTIYAC', etiket: 'İhtiyaç Kredisi' },
  { deger: 'TASIT', etiket: 'Taşıt Kredisi' },
  { deger: 'KONUT', etiket: 'Konut Kredisi' },
  { deger: 'KMH', etiket: 'KMH / Ek Hesap' },
  { deger: 'SENET', etiket: 'Senet' },
  { deger: 'KISISEL', etiket: 'Kişiye Borç' },
  { deger: 'DIGER', etiket: 'Diğer' },
];

/**
 * Sunucu ASGARI_ODENDI durumunu da döndürür. Bu eşleme eksik kaldığında
 * `EKSTRE_DURUM_ETIKET[durum].renk` okunurken ekran tümden çöküyordu
 * (kullanıcı asgariyi ödeyince Genel Bakış açılmaz oldu). Asgarisi ödenmiş
 * ekstre GECİKME DEĞİLDİR; uyarı rengi değil bilgi rengi kullanılır.
 */
export const EKSTRE_DURUM_ETIKET: Record<string, { etiket: string; renk: string }> = {
  TUTAR_BEKLENIYOR: { etiket: 'Tutar bekleniyor', renk: '#d8ad70' },
  ODENMEDI: { etiket: 'Ödenmedi', renk: '#e0697a' },
  KISMI: { etiket: 'Kısmi ödendi', renk: '#d9a06c' },
  ODENDI: { etiket: 'Ödendi', renk: '#5ad18a' },
  ASGARI_ODENDI: { etiket: 'Asgari ödendi', renk: '#6aa9e8' },
  GECIKTI: { etiket: 'GECİKTİ', renk: '#ff5f6d' },
};

/**
 * Durum etiketine GÜVENLİ erişim. Sunucu ileride yeni bir durum eklerse
 * arayüz çökmemeli; bilinmeyen durum nötr renkle gösterilir.
 */
export const ekstreDurumBilgi = (durum?: string | null) =>
  (durum && EKSTRE_DURUM_ETIKET[durum]) || { etiket: String(durum || '—'), renk: '#8b8b93' };
