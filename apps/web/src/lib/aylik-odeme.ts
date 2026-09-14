/**
 * Aylık Ödeme Listesi — tipler, API çağrıları ve ekran yardımcıları.
 * Sözleşme (arka uç): GET /aylik-odeme, /aylik-odeme/ozet, /aylik-odeme/eksikler, /aylik-odeme/excel, /aylik-odeme/pdf,
 * /aylik-odeme/otomatik; POST /aylik-odeme/send, /aylik-odeme/ornek-gonder, /aylik-odeme/eksik/sgk-yok; PUT /aylik-odeme/otomatik.
 * Mükellef portalı: GET /taxpayer-portal/odeme-cetveli (mükellef JWT — taxpayerApi ile çağrılır).
 */
import { api } from './api';
import { BEYAN_ETIKETLER } from './beyanname-takip';

// ─────────────────────────────────────────────────────────────────────────────
// Tipler
// ─────────────────────────────────────────────────────────────────────────────
export type OdemeKaynak = 'VERGI' | 'SGK';
export type OdemeGrup = 'AYLIK' | 'GECICI' | 'YILLIK' | 'SGK';

export interface OdemeSatiri {
  /** Ham kod (KDV1, MUHSGK, "Tahakkuk Fişi"…) — WhatsApp mesajında da kullanılır, ekranda `turAd` gösterilir */
  tur: string;
  turAd?: string | null;
  kaynak: OdemeKaynak;
  grup: OdemeGrup;
  donem: string;
  /** Kaydırılmış son ödeme günü — "g.a.yyyy" */
  sonGun: string | null;
  /** Kaydırılmadan önceki gün — "g.a.yyyy" (hafta sonuna denk geldiyse sonGun'dan farklıdır) */
  sonGunHam?: string | null;
  /** Kaydırılmış son ödeme günü — "YYYY-MM-DD" */
  sonGunIso?: string | null;
  taksit?: '1/2' | '2/2' | null;
  tutar: number;
  /** Belge PDF anahtarı ya da tam bağlantı (varsa) */
  storageKey?: string | null;
}

export interface GonderimBilgisi {
  status: 'SENT' | 'FAILED';
  sentAt: string | null;
  kanallar: string[];
  test: boolean;
}

export interface OdemeListesi {
  taxpayerId: string;
  unvan: string;
  phone: string | null;
  email: string | null;
  toplam: number;
  satirlar: OdemeSatiri[];
  gonderim?: { VERGI: GonderimBilgisi | null; SGK: GonderimBilgisi | null } | null;
}

export interface OtomatikAyar {
  aktif: boolean;
  /** Ayın günü 1-28 */
  gun: number;
  /** Saat 0-23 */
  saat: number;
  onayGerekli: boolean;
  /** Son koşu: ISO tarih ya da { tarih, sonuc, gonderilen } */
  sonKosu?: string | { tarih?: string | null; sonuc?: string | null; gonderilen?: number | null } | null;
}

export interface OdemeOzet {
  month: string;
  mukellef: number;
  kalem: number;
  vergiToplam: number;
  sgkToplam: number;
  geciciToplam: number;
  yillikToplam: number;
  toplam: number;
  gonderilen: number;
  bekleyen: number;
  hatali: number;
  enYakinSonGun: { tarih: string; turAd: string } | null;
  testMode: boolean;
  testPhone?: string | null;
  testEmail?: string | null;
  kanallar: { whatsapp: boolean; email: boolean };
  otomatik?: OtomatikAyar | null;
}

export interface EksikSatiri {
  taxpayerId: string;
  unvan: string;
  kaynak: string;
  sebep: string;
  beyanTipi?: string;
  donem?: string;
  listedeVar: boolean;
}

export interface EksiklerYaniti {
  eksik: EksikSatiri[];
  takipUyeSayisi?: number;
}

export type GonderimModu = 'gonderilmemis' | 'hepsi' | 'yeniden';

export interface GonderimSonucu {
  ok: boolean;
  testMode: boolean;
  count: number;
  atlanan: number;
  results: Array<{ taxpayerId: string; unvan: string; grup?: string; channel?: string; status: 'SENT' | 'FAILED' | string; error?: string | null }>;
}

export interface OrnekGonderSonucu {
  ok: boolean;
  telefonlar?: string[];
  mesajlar?: string[];
}

/** Mükellef portalı cetveli */
export interface PortalOdemeCetveli {
  month: string;
  satirlar: OdemeSatiri[];
  toplam: number;
  gonderim?: { VERGI: GonderimBilgisi | null; SGK: GonderimBilgisi | null } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────
export const aylikOdemeApi = {
  liste: (month: string) => api.get<OdemeListesi[]>('/aylik-odeme', { params: { month } }).then((r) => r.data),
  ozet: (month: string) => api.get<OdemeOzet>('/aylik-odeme/ozet', { params: { month } }).then((r) => r.data),
  eksikler: (month: string) => api.get<EksiklerYaniti>('/aylik-odeme/eksikler', { params: { month } }).then((r) => r.data),
  gonder: (body: { month: string; taxpayerId?: string; mod?: GonderimModu }) => api.post<GonderimSonucu>('/aylik-odeme/send', body).then((r) => r.data),
  ornekGonder: (body: { month: string; taxpayerId?: string }) => api.post<OrnekGonderSonucu>('/aylik-odeme/ornek-gonder', body).then((r) => r.data),
  excel: (month: string) => api.get<Blob>('/aylik-odeme/excel', { params: { month }, responseType: 'blob' }).then((r) => r.data),
  pdf: (month: string, taxpayerId?: string) =>
    api.get<Blob>('/aylik-odeme/pdf', { params: taxpayerId ? { month, taxpayerId } : { month }, responseType: 'blob' }).then((r) => r.data),
  sgkYok: (taxpayerId: string) => api.post<{ ok: boolean }>('/aylik-odeme/eksik/sgk-yok', { taxpayerId }).then((r) => r.data),
  otomatik: () => api.get<OtomatikAyar>('/aylik-odeme/otomatik').then((r) => r.data),
  otomatikKaydet: (body: { aktif: boolean; gun: number; saat: number; onayGerekli: boolean }) => api.put<OtomatikAyar>('/aylik-odeme/otomatik', body).then((r) => r.data),
};

// ─────────────────────────────────────────────────────────────────────────────
// Ay yardımcıları
// ─────────────────────────────────────────────────────────────────────────────
export const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const AYLAR_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** "2026-09" */
export function buAy(simdi: Date = new Date()): string {
  return `${simdi.getFullYear()}-${String(simdi.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-09" + 1 → "2026-10"; −1 → "2026-08" */
export function ayKaydir(month: string, fark: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return buAy();
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + fark, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-09" → "Eylül 2026" */
export function ayAdi(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `${AYLAR[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

/** "2026-07" / "2026/07" → "Temmuz 2026"; "2026-Q3" → "3. Çeyrek 2026"; "2025" → "2025 yılı" */
export function donemAdi(donem: string | null | undefined): string {
  const s = String(donem || '').trim();
  if (!s) return '—';
  const q = /^(\d{4})[-/]?Q([1-4])$/i.exec(s);
  if (q) return `${q[2]}. Çeyrek ${q[1]}`;
  const y = /^(\d{4})$/.exec(s);
  if (y) return `${y[1]} yılı`;
  const m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (!m) return s;
  const ay = Number(m[2]);
  if (ay < 1 || ay > 12) return s;
  return `${AYLAR[ay - 1]} ${m[1]}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tarih yardımcıları
// ─────────────────────────────────────────────────────────────────────────────
/** "28.8.2026" → "28.08.2026" (sunucu sıfırsız gönderiyor) */
export function tarihAdi(t: string | null | undefined): string {
  if (!t) return '—';
  const m = String(t).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return t;
  return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
}

/** "g.a.yyyy" ya da "YYYY-MM-DD" → yerel gece yarısı Date (geçersizse null) */
export function tarihNesnesi(t: string | null | undefined): Date | null {
  if (!t) return null;
  const s = String(t).trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** "2026-09-26" → "26 Eyl" */
export function kisaGun(t: string | null | undefined): string {
  const d = tarihNesnesi(t);
  if (!d) return '—';
  return `${d.getDate()} ${AYLAR_KISA[d.getMonth()]}`;
}

/** ISO → "12.09.2026 14:30" */
export function tarihSaat(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Son ödeme gününe kalan gün — vadesi yaklaşan satır öne çıksın. Renkler: tek yumuşak kırmızı (geçti/bugün), soluk altın (≤3 gün). */
export const VADE_KIRMIZI = '#e0868f';
export const VADE_ALTIN = 'rgba(212,184,118,0.85)';
export function vadeDurumu(s: Pick<OdemeSatiri, 'sonGun' | 'sonGunIso'>, simdi: Date = new Date()): { gun: number | null; renk: string | null; etiket: string | null } {
  const son = tarihNesnesi(s.sonGunIso || s.sonGun);
  if (!son) return { gun: null, renk: null, etiket: null };
  const bugun = new Date(simdi);
  bugun.setHours(0, 0, 0, 0);
  const gun = Math.round((son.getTime() - bugun.getTime()) / 86400000);
  if (gun < 0) return { gun, renk: VADE_KIRMIZI, etiket: 'geçti' };
  if (gun === 0) return { gun, renk: VADE_KIRMIZI, etiket: 'bugün' };
  if (gun <= 3) return { gun, renk: VADE_ALTIN, etiket: `${gun} gün` };
  return { gun, renk: null, etiket: null };
}

/** Son ödeme günü hafta sonundan ilk iş gününe kaydırıldı mı? */
export function vadeKaydirildi(s: Pick<OdemeSatiri, 'sonGun' | 'sonGunHam'>): boolean {
  if (!s.sonGunHam || !s.sonGun) return false;
  const a = tarihNesnesi(s.sonGunHam);
  const b = tarihNesnesi(s.sonGun);
  if (!a || !b) return s.sonGunHam !== s.sonGun;
  return a.getTime() !== b.getTime();
}

// ─────────────────────────────────────────────────────────────────────────────
// Para
// ─────────────────────────────────────────────────────────────────────────────
export function trMoney(n: number | null | undefined): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0) + ' ₺';
}
/** Hap şeridi için kısa para (kuruşsuz, tam değer ipucunda): "₺1.234.568" */
export function kisaPara(n: number | null | undefined): string {
  return '₺' + new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Number(n) || 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Satır / grup yardımcıları
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ÖDEME ADI — sunucu `turAd` gönderiyorsa o; yoksa ham `tur` BEYAN_ETIKETLER ile okunur ada çevrilir
 * (SGK'da sunucu "Tahakkuk Fişi" bırakıyor → "SGK Prim Tahakkuku").
 */
export function odemeAdi(s: Pick<OdemeSatiri, 'tur' | 'turAd' | 'kaynak'>): string {
  const hazir = (s.turAd || '').trim();
  if (hazir) return hazir;
  const ham = (s.tur || '').trim();
  if (s.kaynak === 'SGK') return /tahakkuk/i.test(ham) ? 'SGK Prim Tahakkuku' : `SGK ${ham}`.trim();
  return (BEYAN_ETIKETLER as Record<string, string>)[ham] || ham || '—';
}

/** Kayıt grubu — sunucu `grup` vermezse kaynaktan/koddan türetilir. */
export function satirGrubu(s: Pick<OdemeSatiri, 'grup' | 'kaynak' | 'tur'>): OdemeGrup {
  if (s.grup) return s.grup;
  if (s.kaynak === 'SGK') return 'SGK';
  const kod = (s.tur || '').toUpperCase();
  if (/GECICI/.test(kod)) return 'GECICI';
  if (/^(KURUMLAR|GELIR)$/.test(kod)) return 'YILLIK';
  return 'AYLIK';
}

export const GRUP_SIRASI: Array<{ key: OdemeGrup; ad: string }> = [
  { key: 'AYLIK', ad: 'Vergi · aylık' },
  { key: 'GECICI', ad: 'Geçici vergi' },
  { key: 'YILLIK', ad: 'Yıllık' },
  { key: 'SGK', ad: 'SGK' },
];

export interface OdemeGrubu {
  key: OdemeGrup;
  ad: string;
  satirlar: OdemeSatiri[];
  araToplam: number;
}

/** Satırları sabit sırada gruplar (boş gruplar atılır) ve ara toplamlarını hesaplar. */
export function grupla(satirlar: OdemeSatiri[]): OdemeGrubu[] {
  return GRUP_SIRASI.map((g) => {
    const s = satirlar.filter((x) => satirGrubu(x) === g.key);
    return { key: g.key, ad: g.ad, satirlar: s, araToplam: s.reduce((a, x) => a + (Number(x.tutar) || 0), 0) };
  }).filter((g) => g.satirlar.length > 0);
}

/** Belge bağlantısı: yalnız tam URL ise gösterilir (depo anahtarını açan uç yok). */
export function fisBaglantisi(s: Pick<OdemeSatiri, 'storageKey'>): string | null {
  const k = (s.storageKey || '').trim();
  return /^https?:\/\//i.test(k) ? k : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gönderim durumu
// ─────────────────────────────────────────────────────────────────────────────
export type GonderimDurumu = 'gonderildi' | 'hata' | 'bekliyor';

export interface GonderimOzeti {
  durum: GonderimDurumu;
  /** Son gönderim zamanı (ISO) */
  sentAt: string | null;
  /** Yalnız bir kaynağı (vergi ya da SGK) gitti, diğeri bekliyor */
  kismi: boolean;
  test: boolean;
  hata: string | null;
}

/** Mükellefin VERGİ + SGK gönderimlerini tek duruma indirger (listede tek ikon, cetvelde ayrıntı). */
export function gonderimOzeti(r: Pick<OdemeListesi, 'gonderim' | 'satirlar'>): GonderimOzeti {
  const g = r.gonderim || { VERGI: null, SGK: null };
  const vergiVar = r.satirlar.some((s) => s.kaynak !== 'SGK');
  const sgkVar = r.satirlar.some((s) => s.kaynak === 'SGK');
  const parcalar: Array<GonderimBilgisi | null> = [];
  if (vergiVar) parcalar.push(g.VERGI || null);
  if (sgkVar) parcalar.push(g.SGK || null);
  if (parcalar.length === 0) parcalar.push(g.VERGI || null, g.SGK || null);
  const dolu = parcalar.filter((p): p is GonderimBilgisi => !!p);
  const sentAt = dolu.map((p) => p.sentAt).filter(Boolean).sort().reverse()[0] || null;
  const test = dolu.some((p) => p.test);
  if (dolu.some((p) => p.status === 'FAILED')) return { durum: 'hata', sentAt, kismi: false, test, hata: 'Gönderim hatası' };
  const gonderilen = dolu.filter((p) => p.status === 'SENT').length;
  if (gonderilen > 0 && gonderilen === parcalar.length) return { durum: 'gonderildi', sentAt, kismi: false, test, hata: null };
  if (gonderilen > 0) return { durum: 'bekliyor', sentAt, kismi: true, test, hata: null };
  return { durum: 'bekliyor', sentAt: null, kismi: false, test: false, hata: null };
}

/**
 * İletişim eksiği ipucu — telefon ya da e-posta yoksa. Kapalı kanal (ör. e-posta kanalı kapalıysa e-posta) aranmaz;
 * kanallar verilmezse ikisi de aranır. Dönüş: { metin, kritik } — kritik = açık kanalların HİÇBİRİ için bilgi yok.
 */
export function iletisimEksigi(r: Pick<OdemeListesi, 'phone' | 'email'>, kanallar?: { whatsapp: boolean; email: boolean } | null): { metin: string; kritik: boolean } | null {
  const telGerek = kanallar ? kanallar.whatsapp : true;
  const epGerek = kanallar ? kanallar.email : true;
  const tel = !!(r.phone || '').trim();
  const ep = !!(r.email || '').trim();
  const eksik: string[] = [];
  if (telGerek && !tel) eksik.push('Telefon');
  if (epGerek && !ep) eksik.push('E-posta');
  if (eksik.length === 0) return null;
  const gerekli = Number(telGerek) + Number(epGerek);
  const kritik = eksik.length >= Math.max(1, gerekli);
  return { metin: `${eksik.join(' ve ')} yok${kritik ? ' — gönderim yapılamaz' : ''}`, kritik };
}

// ─────────────────────────────────────────────────────────────────────────────
// Liste süzme / sıralama
// ─────────────────────────────────────────────────────────────────────────────
export type ListeSuzgeci = 'tumu' | 'sgk' | 'vergi' | 'eksik' | 'gonderilmemis' | 'gonderildi' | 'bekliyor' | 'hata';
export type ListeSiralama = 'ad' | 'tutar';

export const SUZGEC_ADLARI: Record<ListeSuzgeci, string> = {
  tumu: 'Tümü',
  sgk: 'Yalnız SGK',
  vergi: 'Yalnız vergi',
  eksik: 'Eksiği olan',
  gonderilmemis: 'Gönderilmeyen',
  gonderildi: 'Gönderildi',
  bekliyor: 'Bekliyor',
  hata: 'Hata',
};

const kucuk = (s: string) => String(s || '').toLocaleLowerCase('tr-TR');

export function listeyiSuz(
  rows: OdemeListesi[],
  o: { arama: string; suzgec: ListeSuzgeci; siralama: ListeSiralama; eksikIdler: Set<string> },
): OdemeListesi[] {
  const q = kucuk(o.arama.trim());
  const out = rows.filter((r) => {
    if (q && !kucuk(r.unvan).includes(q)) return false;
    const g = gonderimOzeti(r);
    switch (o.suzgec) {
      case 'sgk': return r.satirlar.some((s) => s.kaynak === 'SGK');
      case 'vergi': return r.satirlar.some((s) => s.kaynak !== 'SGK');
      case 'eksik': return o.eksikIdler.has(r.taxpayerId);
      case 'gonderilmemis': return g.durum !== 'gonderildi';
      case 'gonderildi': return g.durum === 'gonderildi';
      case 'bekliyor': return g.durum === 'bekliyor';
      case 'hata': return g.durum === 'hata';
      default: return true;
    }
  });
  return out.sort((a, b) => (o.siralama === 'tutar' ? (b.toplam || 0) - (a.toplam || 0) : a.unvan.localeCompare(b.unvan, 'tr-TR')));
}

// ─────────────────────────────────────────────────────────────────────────────
// Dosya indirme / açma
// ─────────────────────────────────────────────────────────────────────────────
/** Blob'u dosya olarak indirir (tarayıcı). */
export function dosyaIndir(blob: Blob, ad: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = ad;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * PDF'i yeni sekmede açar. Sekme TIKLAMA ANINDA (senkron) açılır; blob gelince adres yazılır —
 * aksi hâlde açılır pencere engelleyicisi sekmeyi yutar.
 */
export function yeniSekmeAc(): Window | null {
  try {
    const w = window.open('', '_blank');
    if (w) w.document.write('<title>PDF hazırlanıyor…</title><p style="font-family:sans-serif;color:#555;padding:24px">PDF hazırlanıyor…</p>');
    return w;
  } catch {
    return null;
  }
}
export function sekmeyeBlobYaz(w: Window | null, blob: Blob) {
  const url = URL.createObjectURL(blob);
  if (w && !w.closed) w.location.href = url;
  else window.open(url, '_blank');
}

/** Otomatik gönderim "son koşu" alanını okunur yazıya çevirir. */
export function sonKosuMetni(v: OtomatikAyar['sonKosu']): string | null {
  if (!v) return null;
  if (typeof v === 'string') return tarihSaat(v) || null;
  const parca: string[] = [];
  if (v.tarih) parca.push(tarihSaat(v.tarih));
  if (typeof v.gonderilen === 'number') parca.push(`${v.gonderilen} gönderim`);
  if (v.sonuc) parca.push(v.sonuc);
  return parca.filter(Boolean).join(' · ') || null;
}
