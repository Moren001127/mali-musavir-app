/**
 * Aylık Ödeme Listesi — tipler, API çağrıları ve ekran yardımcıları.
 * Sözleşme (arka uç): GET /aylik-odeme, /aylik-odeme/ozet, /aylik-odeme/eksikler, /aylik-odeme/excel, /aylik-odeme/pdf,
 * /aylik-odeme/otomatik; POST /aylik-odeme/send, /aylik-odeme/ornek-gonder, /aylik-odeme/eksik/sgk-yok; PUT /aylik-odeme/otomatik.
 * Mükellef portalı: GET /taxpayer-portal/odeme-cetveli (mükellef JWT — taxpayerApi ile çağrılır).
 *
 * KALEM BAZLI GÖNDERİM (2026-09-14): her satırda `gonderim.WHATSAPP / EMAIL = { sentAt, test } | null`;
 * mükellef düzeyinde `gonderim.VERGI / SGK = { status, sentAt, kanallar, test, toplamKalem, gonderilenKalem, yeniKalem }`.
 * POST /aylik-odeme/send { month, taxpayerId?, mod?, kanal? } — 'gonderilmemis' modunda yalnız daha önce gitmemiş kalemler gider.
 */
import { api } from './api';
import { BEYAN_ETIKETLER } from './beyanname-takip';

// ─────────────────────────────────────────────────────────────────────────────
// Tipler
// ─────────────────────────────────────────────────────────────────────────────
export type OdemeKaynak = 'VERGI' | 'SGK';
export type OdemeGrup = 'AYLIK' | 'GECICI' | 'YILLIK' | 'SGK';
export type GonderimKanal = 'WHATSAPP' | 'EMAIL';
export const KANALLAR: GonderimKanal[] = ['WHATSAPP', 'EMAIL'];

/** Bir kalemin bir kanaldan gönderimi */
export interface KalemGonderimi {
  sentAt: string | null;
  test: boolean;
}

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
  /**
   * Kalem bazlı gönderim: kanal → { sentAt, test } ya da null (o kanaldan gitmedi).
   * Sunucu alanı hiç vermezse (undefined) kaynak düzeyindeki bilgiden türetilir.
   */
  gonderim?: { WHATSAPP: KalemGonderimi | null; EMAIL: KalemGonderimi | null } | null;
}

/** Kaynak (VERGİ / SGK) düzeyinde gönderim bilgisi */
export interface GonderimBilgisi {
  status: 'SENT' | 'FAILED';
  sentAt: string | null;
  kanallar: string[];
  test: boolean;
  toplamKalem?: number;
  gonderilenKalem?: number;
  /** Henüz hiçbir kanaldan gitmemiş kalem sayısı */
  yeniKalem?: number;
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
  /** Yeni (gönderilmemiş) kalemi olan mükellef sayısı */
  bekleyen: number;
  hatali: number;
  /** Henüz gönderilmemiş kalem toplamı (tüm mükellefler) */
  yeniKalemToplam?: number;
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

export interface GonderimIstegi {
  month: string;
  taxpayerId?: string;
  mod?: GonderimModu;
  /** Verilmezse açık kanalların hepsi */
  kanal?: GonderimKanal;
}

export interface GonderimSonucu {
  ok: boolean;
  testMode: boolean;
  count: number;
  atlanan: number;
  results: Array<{
    taxpayerId: string;
    unvan: string;
    grup?: string;
    channel?: string;
    status: 'SENT' | 'FAILED' | string;
    error?: string | null;
    /** Bu gönderimde giden kalem sayısı */
    kalem?: number;
    /** Bunların kaçı ilk kez gitti */
    yeni?: number;
  }>;
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
  gonder: (body: GonderimIstegi) => api.post<GonderimSonucu>('/aylik-odeme/send', body).then((r) => r.data),
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

/**
 * Dönem yazımı — Muzaffer Bey'in istediği biçim (2026-09-14: "2. çeyrek yazma, 4-6/2026 gibi yaz"):
 *   "2026-07" / "2026/07" → "07/2026"; "2026-Q2" → "04-06/2026"; "2025" / "2025-YIL" → "2025".
 */
export function donemAdi(donem: string | null | undefined): string {
  const s = String(donem || '').trim();
  if (!s) return '—';
  const q = /^(\d{4})[-/]?Q([1-4])$/i.exec(s);
  if (q) {
    const ilk = (Number(q[2]) - 1) * 3 + 1;
    return `${String(ilk).padStart(2, '0')}-${String(ilk + 2).padStart(2, '0')}/${q[1]}`;
  }
  const y = /^(\d{4})(?:-YIL)?$/i.exec(s);
  if (y) return y[1];
  const m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (!m) return s;
  const ay = Number(m[2]);
  if (ay < 1 || ay > 12) return s;
  return `${String(ay).padStart(2, '0')}/${m[1]}`;
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

/** ISO → "12.09" (gönderim sütunu / durum satırı için kısa gün.ay) */
export function gunAy(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
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

/** Kayıt türü (aylık / geçici / yıllık / SGK) — sunucu `grup` vermezse kaynaktan/koddan türetilir. */
export function satirGrubu(s: Pick<OdemeSatiri, 'grup' | 'kaynak' | 'tur'>): OdemeGrup {
  if (s.grup) return s.grup;
  if (s.kaynak === 'SGK') return 'SGK';
  const kod = (s.tur || '').toUpperCase();
  if (/GECICI/.test(kod)) return 'GECICI';
  if (/^(KURUMLAR|GELIR)$/.test(kod)) return 'YILLIK';
  return 'AYLIK';
}

/** Satırın cetvel bölümü: VERGİ (aylık + geçici + yıllık) ya da SGK */
export function satirKaynagi(s: Pick<OdemeSatiri, 'grup' | 'kaynak' | 'tur'>): OdemeKaynak {
  if (s.kaynak === 'SGK' || satirGrubu(s) === 'SGK') return 'SGK';
  return 'VERGI';
}

/** Cetvel yalnız İKİ bölüm: "Vergi ödemeleri" (aylık + geçici + yıllık, son ödeme gününe göre sıralı) ve "SGK ödemeleri". */
export const GRUP_SIRASI: Array<{ key: OdemeKaynak; ad: string }> = [
  { key: 'VERGI', ad: 'Vergi ödemeleri' },
  { key: 'SGK', ad: 'SGK ödemeleri' },
];

export interface OdemeGrubu {
  key: OdemeKaynak;
  ad: string;
  satirlar: OdemeSatiri[];
  /** Bölüm toplamı (ekranda etiketsiz gösterilir) */
  araToplam: number;
}

/** Son ödeme gününe göre (erken önce); günü olmayan sona; eşitse ödeme adına göre */
export function sonGuneGore(a: OdemeSatiri, b: OdemeSatiri): number {
  const ta = tarihNesnesi(a.sonGunIso || a.sonGun)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const tb = tarihNesnesi(b.sonGunIso || b.sonGun)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta - tb;
  return odemeAdi(a).localeCompare(odemeAdi(b), 'tr-TR');
}

/** Satırları iki bölüme ayırır (boş bölüm atılır), her bölümü son ödeme gününe göre sıralar, toplamlarını hesaplar. */
export function grupla(satirlar: OdemeSatiri[]): OdemeGrubu[] {
  return GRUP_SIRASI.map((g) => {
    const s = satirlar.filter((x) => satirKaynagi(x) === g.key).sort(sonGuneGore);
    return { key: g.key, ad: g.ad, satirlar: s, araToplam: s.reduce((a, x) => a + (Number(x.tutar) || 0), 0) };
  }).filter((g) => g.satirlar.length > 0);
}

/** Belge bağlantısı: yalnız tam URL ise gösterilir (depo anahtarını açan uç yok). */
export function fisBaglantisi(s: Pick<OdemeSatiri, 'storageKey'>): string | null {
  const k = (s.storageKey || '').trim();
  return /^https?:\/\//i.test(k) ? k : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gönderim durumu — kalem bazlı
// ─────────────────────────────────────────────────────────────────────────────
/** 'WHATSAPP' / 'whatsapp' → 'WhatsApp'; 'EMAIL' / 'email' / 'e-posta' → 'E-posta' */
export function kanalAdi(k: string | null | undefined): string {
  const s = String(k || '');
  if (/whatsapp/i.test(s)) return 'WhatsApp';
  if (/mail|posta/i.test(s)) return 'E-posta';
  return s;
}
export function kanalAnahtari(k: string | null | undefined): GonderimKanal | null {
  const s = String(k || '');
  if (/whatsapp/i.test(s)) return 'WHATSAPP';
  if (/mail|posta/i.test(s)) return 'EMAIL';
  return null;
}
/** Kanal, ofis ayarında (ozet.kanallar) açık mı? Ayar gelmediyse açık sayılır. */
export function kanalAcik(kanal: GonderimKanal, kanallar?: { whatsapp: boolean; email: boolean } | null): boolean {
  if (!kanallar) return true;
  return kanal === 'WHATSAPP' ? !!kanallar.whatsapp : !!kanallar.email;
}

/** Kalem herhangi bir kanaldan gitti mi? (yalnız satır düzeyi bilgiden) */
export function kalemGonderildi(s: Pick<OdemeSatiri, 'gonderim'>): boolean {
  const g = s.gonderim;
  if (!g) return false;
  return KANALLAR.some((k) => !!g[k]?.sentAt);
}

export interface KalemGonderimParcasi {
  kanal: GonderimKanal;
  ad: string;
  sentAt: string | null;
  /** "12.09" */
  tarih: string;
  test: boolean;
}

/**
 * Cetvel "GÖNDERİM" sütunu: kanal-tarih parçaları ("WhatsApp 12.09", "E-posta 12.09") + test etiketi.
 * Satırda `gonderim` yoksa (eski sunucu) kaynak düzeyindeki bilgiden türetilir; hiçbiri yoksa boş → "gönderilmedi".
 */
export function kalemGonderimParcalari(s: Pick<OdemeSatiri, 'gonderim'>, kaynakBilgi?: GonderimBilgisi | null): { parcalar: KalemGonderimParcasi[]; test: boolean } {
  const parcalar: KalemGonderimParcasi[] = [];
  if (s.gonderim !== undefined) {
    const g = s.gonderim;
    if (g) {
      for (const k of KANALLAR) {
        const p = g[k];
        if (p?.sentAt) parcalar.push({ kanal: k, ad: kanalAdi(k), sentAt: p.sentAt, tarih: gunAy(p.sentAt), test: !!p.test });
      }
    }
  } else if (kaynakBilgi && kaynakBilgi.status === 'SENT') {
    for (const k of kaynakBilgi.kanallar || []) {
      const anahtar = kanalAnahtari(k);
      if (!anahtar) continue;
      parcalar.push({ kanal: anahtar, ad: kanalAdi(anahtar), sentAt: kaynakBilgi.sentAt, tarih: gunAy(kaynakBilgi.sentAt), test: !!kaynakBilgi.test });
    }
  }
  return { parcalar, test: parcalar.some((p) => p.test) };
}

/** Kaynak (VERGİ / SGK) bazında kalem sayımı */
export interface KaynakGonderimi {
  kaynak: OdemeKaynak;
  toplam: number;
  /** En az bir kanaldan gitmiş kalem */
  gonderilen: number;
  /** Hiç gitmemiş kalem */
  yeni: number;
  hata: boolean;
  sentAt: string | null;
  test: boolean;
  /** Kanal bazında gitmiş kalem sayısı */
  kanalGonderilen: Record<GonderimKanal, number>;
}

const EN_SON = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : a > b ? a : b);

/**
 * Bir kaynağın (VERGİ ya da SGK) gönderim sayımı. Öncelik: satır düzeyi `gonderim` (kalem bazlı) →
 * kaynak düzeyi sayaçlar (toplamKalem / gonderilenKalem / yeniKalem) → eski tek durum (SENT = hepsi gitti).
 */
export function kaynakGonderimi(r: Pick<OdemeListesi, 'gonderim' | 'satirlar'>, kaynak: OdemeKaynak): KaynakGonderimi {
  const satirlar = r.satirlar.filter((s) => satirKaynagi(s) === kaynak);
  const g = r.gonderim?.[kaynak] || null;
  const toplam = satirlar.length;
  const kanalGonderilen: Record<GonderimKanal, number> = { WHATSAPP: 0, EMAIL: 0 };
  let gonderilen = 0;
  let yeni = toplam;
  let sentAt: string | null = g?.sentAt || null;
  let test = !!g?.test;
  const hata = g?.status === 'FAILED';

  if (satirlar.some((s) => s.gonderim !== undefined)) {
    for (const s of satirlar) {
      let gitti = false;
      for (const k of KANALLAR) {
        const p = s.gonderim?.[k];
        if (p?.sentAt) {
          gitti = true;
          kanalGonderilen[k]++;
          sentAt = EN_SON(sentAt, p.sentAt);
          test = test || !!p.test;
        }
      }
      if (gitti) gonderilen++;
    }
    yeni = toplam - gonderilen;
  } else if (g && typeof g.gonderilenKalem === 'number') {
    gonderilen = Math.min(toplam, Math.max(0, g.gonderilenKalem));
    yeni = typeof g.yeniKalem === 'number' ? Math.min(toplam, Math.max(0, g.yeniKalem)) : toplam - gonderilen;
    for (const k of g.kanallar || []) {
      const a = kanalAnahtari(k);
      if (a) kanalGonderilen[a] = gonderilen;
    }
  } else if (g && g.status === 'SENT') {
    gonderilen = toplam;
    yeni = 0;
    for (const k of g.kanallar || []) {
      const a = kanalAnahtari(k);
      if (a) kanalGonderilen[a] = toplam;
    }
  }
  return { kaynak, toplam, gonderilen, yeni, hata, sentAt, test, kanalGonderilen };
}

export type GonderimDurumu = 'gonderildi' | 'hata' | 'bekliyor';

export interface GonderimOzeti {
  durum: GonderimDurumu;
  /** Bir bölümü gitti, bir bölümü yeni */
  kismi: boolean;
  toplam: number;
  gonderilen: number;
  yeni: number;
  /** Son gönderim zamanı (ISO) */
  sentAt: string | null;
  test: boolean;
  hata: string | null;
  /** Kalemi olan kaynaklar (VERGİ, SGK) */
  kaynaklar: KaynakGonderimi[];
}

/** Mükellefin VERGİ + SGK gönderimlerini tek duruma indirger (listede tek yazı, cetvelde ayrıntı). */
export function gonderimOzeti(r: Pick<OdemeListesi, 'gonderim' | 'satirlar'>): GonderimOzeti {
  const kaynaklar = (['VERGI', 'SGK'] as OdemeKaynak[]).map((k) => kaynakGonderimi(r, k)).filter((k) => k.toplam > 0);
  const toplam = kaynaklar.reduce((a, k) => a + k.toplam, 0);
  const gonderilen = kaynaklar.reduce((a, k) => a + k.gonderilen, 0);
  const yeni = kaynaklar.reduce((a, k) => a + k.yeni, 0);
  const sentAt = kaynaklar.reduce<string | null>((a, k) => EN_SON(a, k.sentAt), null);
  const test = kaynaklar.some((k) => k.test);
  if (kaynaklar.some((k) => k.hata)) return { durum: 'hata', kismi: gonderilen > 0, toplam, gonderilen, yeni, sentAt, test, hata: 'Gönderim hatası', kaynaklar };
  if (toplam > 0 && yeni === 0) return { durum: 'gonderildi', kismi: false, toplam, gonderilen, yeni, sentAt, test, hata: null, kaynaklar };
  return { durum: 'bekliyor', kismi: gonderilen > 0, toplam, gonderilen, yeni, sentAt, test, hata: null, kaynaklar };
}

/** Sol liste satırı: "2/3 gönderildi · 1 yeni" / "hepsi gönderildi" / "gönderilmedi" / "hata" */
export function mukellefGonderimYazisi(g: GonderimOzeti): string {
  if (g.durum === 'hata') return g.gonderilen > 0 ? `${g.gonderilen}/${g.toplam} gönderildi · hata` : 'hata';
  if (g.durum === 'gonderildi') return 'hepsi gönderildi';
  if (g.kismi) return `${g.gonderilen}/${g.toplam} gönderildi · ${g.yeni} yeni`;
  return 'gönderilmedi';
}

/** Cetvel başlığı durum parçası: "2/3 kalem gönderildi (1 yeni)" / "gönderildi 12.09" / "gönderilmedi" / "gönderim hatası" */
export function kaynakDurumYazisi(k: KaynakGonderimi): { yazi: string; ton: 'normal' | 'soluk' | 'hata' } {
  if (k.hata) return { yazi: k.gonderilen > 0 ? `${k.gonderilen}/${k.toplam} kalem gönderildi · gönderim hatası` : 'gönderim hatası', ton: 'hata' };
  if (k.toplam > 0 && k.yeni === 0) return { yazi: `gönderildi${k.sentAt ? ' ' + gunAy(k.sentAt) : ''}${k.test ? ' · test' : ''}`, ton: 'normal' };
  if (k.gonderilen > 0) return { yazi: `${k.gonderilen}/${k.toplam} kalem gönderildi (${k.yeni} yeni)${k.test ? ' · test' : ''}`, ton: 'normal' };
  return { yazi: 'gönderilmedi', ton: 'soluk' };
}

/** Kanal düğmesinin (WhatsApp / E-posta) durumu — yazı, mod, pasiflik ve ipucu */
export interface KanalDugmeDurumu {
  kanal: GonderimKanal;
  ad: string;
  etiket: string;
  mod: GonderimModu;
  /** Tüm kalemler bu kanaldan zaten gitti → onay penceresi + mod 'yeniden' */
  yeniden: boolean;
  pasif: boolean;
  ipucu: string | null;
  /** Bu kanaldan henüz gitmemiş kalem */
  yeni: number;
}

/**
 * Kanal düğmesi: yalnız açık kanal aktif; telefon/e-posta yoksa pasif + ipucu (test modunda alıcı test numarası
 * olduğundan pasif olmaz). Yazı: "WhatsApp ile gönder" · "WhatsApp ile gönder (1 yeni)" · "WhatsApp ile yeniden gönder" ·
 * test modunda "WhatsApp (test alıcısına)".
 */
export function kanalDugmesi(
  r: Pick<OdemeListesi, 'gonderim' | 'satirlar' | 'phone' | 'email'>,
  kanal: GonderimKanal,
  o: { kanallar?: { whatsapp: boolean; email: boolean } | null; testMode: boolean },
): KanalDugmeDurumu {
  const ad = kanalAdi(kanal);
  const g = gonderimOzeti(r);
  const kanalGiden = g.kaynaklar.reduce((a, k) => a + k.kanalGonderilen[kanal], 0);
  const yeni = Math.max(0, g.toplam - kanalGiden);
  const yeniden = g.toplam > 0 && yeni === 0;
  const iletisim = !!((kanal === 'WHATSAPP' ? r.phone : r.email) || '').trim();
  const temel = { kanal, ad, mod: (yeniden ? 'yeniden' : 'gonderilmemis') as GonderimModu, yeniden, yeni };

  if (!kanalAcik(kanal, o.kanallar)) {
    return { ...temel, etiket: `${ad} ile gönder`, pasif: true, ipucu: `${ad} kanalı kapalı — Ayarlar → Akıllı Bildirim` };
  }
  if (!iletisim && !o.testMode) {
    return { ...temel, etiket: `${ad} ile gönder`, pasif: true, ipucu: kanal === 'WHATSAPP' ? 'Telefon kayıtlı değil — WhatsApp ile gönderilemez' : 'E-posta kayıtlı değil — e-posta ile gönderilemez' };
  }
  if (o.testMode) {
    return {
      ...temel,
      etiket: `${ad} (test alıcısına)`,
      pasif: false,
      ipucu: `TEST MODU: mesaj mükellefe değil test alıcısına gider${!iletisim ? ` (mükellefin ${kanal === 'WHATSAPP' ? 'telefonu' : 'e-postası'} kayıtlı değil)` : ''}`,
    };
  }
  if (yeniden) return { ...temel, etiket: `${ad} ile yeniden gönder`, pasif: false, ipucu: `Tüm kalemler ${ad} ile daha önce gönderildi — hepsini yeniden gönderir` };
  if (kanalGiden > 0) return { ...temel, etiket: `${ad} ile gönder (${yeni} yeni)`, pasif: false, ipucu: `Yalnız henüz gitmemiş ${yeni} kalem gönderilir` };
  return { ...temel, etiket: `${ad} ile gönder`, pasif: false, ipucu: `Cetveli ${ad} ile gönder` };
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
      case 'sgk': return r.satirlar.some((s) => satirKaynagi(s) === 'SGK');
      case 'vergi': return r.satirlar.some((s) => satirKaynagi(s) !== 'SGK');
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
