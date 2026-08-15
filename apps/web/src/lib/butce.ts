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
export type Strateji = 'CIG' | 'KARTOPU';
export type EkstreDurum = 'TUTAR_BEKLENIYOR' | 'ODENMEDI' | 'KISMI' | 'ODENDI' | 'GECIKTI';

export interface Kategori {
  id: string;
  ad: string;
  tur: Tur;
  renk?: string | null;
  zorunlu: boolean;
  aktif: boolean;
  sira: number;
}

export interface Islem {
  id: string;
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
}

export interface DuzenliOdeme {
  id: string;
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
  kart?: { id: string; bankaAdi: string; kartAdi: string; renk?: string | null };
}

export interface Kart {
  id: string;
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
  kalanBorc: number;
  kullanilabilirLimit: number;
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
  kartGideri: number;
  /** Nakit/banka ile yapılan gider */
  nakitGider: number;
  net: number;
  /** Nakit akışı: gelir − nakit gider */
  nakitNet: number;
  zorunluGider: number;
  istegeBagliGider: number;
  nakitYastigi: number;
  borcOzet: { kart: number; kredi: number; toplam: number; aylikZorunluOdeme: number };
  kategoriKirilim: Array<{ ad: string; renk: string; tutar: number; zorunlu: boolean }>;
  trend: Array<{ donem: string; gelir: number; gider: number }>;
  yaklasanOdemeler: Ekstre[];
  uyarilar: Uyari[];
}

export interface KalemOdeme {
  id: string;
  ad: string;
  tip: 'KART' | 'KREDI';
  zorunlu: number;
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
  gelir: number;
  gider: number;
  nakitYastigi: number;
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
  id?: string;
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

  ozet: (donem?: string) => al<Ozet>(api.get('/butce/ozet', { params: { donem } })),

  ayar: () => al<Ayar>(api.get('/butce/ayar')),
  ayarKaydet: (body: Partial<Ayar>) => al<Ayar>(api.put('/butce/ayar', body)),

  kategoriler: () => al<Kategori[]>(api.get('/butce/kategoriler')),
  kategoriEkle: (body: Partial<Kategori>) => al<Kategori>(api.post('/butce/kategoriler', body)),
  kategoriGuncelle: (id: string, body: Partial<Kategori>) =>
    al<Kategori>(api.put(`/butce/kategoriler/${id}`, body)),
  kategoriSil: (id: string) => al(api.delete(`/butce/kategoriler/${id}`)),

  islemler: (p: { donem?: string; tur?: string; kategoriId?: string; kartId?: string } = {}) =>
    al<Islem[]>(api.get('/butce/islemler', { params: p })),
  islemEkle: (body: Partial<Islem>) => al<Islem>(api.post('/butce/islemler', body)),
  islemGuncelle: (id: string, body: Partial<Islem>) => al<Islem>(api.put(`/butce/islemler/${id}`, body)),
  islemSil: (id: string) => al(api.delete(`/butce/islemler/${id}`)),

  duzenliler: () => al<DuzenliOdeme[]>(api.get('/butce/duzenliler')),
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
  ekstreOdeme: (id: string, body: { tutar: number; tarih?: string; tip?: string }) =>
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

  borclar: (hepsi = false) => al<Borc[]>(api.get('/butce/borclar', { params: { hepsi: hepsi ? 1 : 0 } })),
  borcEkle: (body: Partial<Borc>) => al<Borc>(api.post('/butce/borclar', body)),
  borcGuncelle: (id: string, body: Partial<Borc>) => al<Borc>(api.put(`/butce/borclar/${id}`, body)),
  borcSil: (id: string) => al(api.delete(`/butce/borclar/${id}`)),
  borcOdeme: (id: string, body: { tutar: number; tarih?: string; tip?: string }) =>
    al<Borc>(api.post(`/butce/borclar/${id}/odeme`, body)),

  plan: (p: { donem?: string; kapasite?: number; strateji?: Strateji } = {}) =>
    al<Plan>(api.get('/butce/plan', { params: p })),
  fayda: (tutar: number) =>
    al<{ tutar: number; siralama: Array<{ id: string; ad: string; kazanc: number; ay: number }> }>(
      api.get('/butce/fayda', { params: { tutar } }),
    ),

  aiAylik: (donem?: string, yenile = false) => al<AiRapor>(api.post('/butce/ai/aylik-yorum', { donem, yenile })),
  aiPlan: (yenile = false) => al<AiRapor>(api.post('/butce/ai/plan-yorum', { yenile })),
  aiSoru: (soru: string) => al<AiRapor>(api.post('/butce/ai/soru', { soru })),
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

export const EKSTRE_DURUM_ETIKET: Record<EkstreDurum, { etiket: string; renk: string }> = {
  TUTAR_BEKLENIYOR: { etiket: 'Tutar bekleniyor', renk: '#d8ad70' },
  ODENMEDI: { etiket: 'Ödenmedi', renk: '#e0697a' },
  KISMI: { etiket: 'Kısmi ödendi', renk: '#d9a06c' },
  ODENDI: { etiket: 'Ödendi', renk: '#5ad18a' },
  GECIKTI: { etiket: 'GECİKTİ', renk: '#ff5f6d' },
};
