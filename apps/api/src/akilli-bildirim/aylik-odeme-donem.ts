/**
 * AYLIK ÖDEME LİSTESİ — DÖNEM EŞLEMESİ (saf hesap, veritabanı yok).
 *
 * Ödeme ayı M için hangi `beyan_kayitlari.donem` anahtarları listeye girer, hangi gruba düşer,
 * ham son ödeme günü nedir — hepsi burada. `list()` yalnız bu tabloyu uygular.
 *
 *   AYLIK   : dönem M-1 (Ağustos listesi Temmuz beyannameleri)            → `calculateBeyannameDeadline`
 *   3 AYLIK (geçici vergi DIŞI: MUHSGK/KDV1 üç aylık, POŞET …): M ∈ {1,4,7,10} → önceki çeyrek `YYYY-Qn`;
 *             son gün = çeyreğin son ayı için `calculateBeyannameDeadline` (MUHSGK 26, KDV 28 …)
 *   GEÇİCİ  : GGECICI/KGECICI — M ∈ {2,5,8,11}: Q4(önceki yıl)/Q1/Q2/Q3, son gün M'nin 17'si
 *   YILLIK  : GELIR/GMSI `YYYY-YIL` (YYYY = M yılı − 1): Mart 1. taksit (31 Mart), Temmuz 2. taksit (31 Temmuz)
 *             KURUMLAR: Nisan tek taksit (30 Nisan)
 *
 * Canlı veri deseni (2026-09-14): aylık '2026-07', çeyrek '2026-Q2' (GGECICI 46, KGECICI 19, MUHSGK 33),
 * yıllık '2025-YIL' (GELIR 51, KURUMLAR 12). `odemeTutari` HİÇBİR kayıtta dolu değil → taksit hesabı
 * `tahakkukTutari`'ndan yapılır.
 */
import { createHash } from 'crypto';
import { calculateBeyannameDeadline } from '../schedule/beyanname-deadline.util';

export type OdemeGrup = 'AYLIK' | 'GECICI' | 'YILLIK' | 'SGK';
export type OdemeKaynak = 'VERGI' | 'SGK';
export type GonderimKanali = 'WHATSAPP' | 'EMAIL';
export const GONDERIM_KANALLARI: readonly GonderimKanali[] = ['WHATSAPP', 'EMAIL'];
export type Taksit = '1/2' | '2/2';

export const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export const GECICI_TIPLER = new Set(['GGECICI', 'KGECICI', 'GECICI_VERGI']);
export const GELIR_TIPLER = new Set(['GELIR', 'GMSI']);
export const KURUMLAR_TIPLER = new Set(['KURUMLAR']);

/**
 * Yıllık gelir vergisi beyannamesinin DAMGA VERGİSİ (beyannamenin VERİLDİĞİ yıla göre).
 * Tahakkuk fişinde damga vergisi 1. taksitle birlikte TAMAMEN ödenir, ikiye BÖLÜNMEZ.
 * Canlı veride 2025-YIL GELIR kayıtlarının 24'ü tam 1.483,70 ₺ (= yalnız damga, gelir vergisi sıfır);
 * kör /2 yapılsa bu mükelleflere Temmuz'da olmayan bir taksit yazılırdı.
 * HER YIL GÜNCELLENMELİ; yılı tabloda olmayan beyannamede /2'ye düşülür.
 */
export const GELIR_BEYANNAME_DAMGA: Readonly<Record<number, number>> = { 2026: 1483.7 };

const yuvarla = (n: number) => Math.round(n * 100) / 100;

/** GELIR taksit tutarı: (tahakkuk − damga)/2, damga 1. taksite eklenir. */
export function gelirTaksitTutari(tahakkuk: number, beyanYili: number, taksit: Taksit): number {
  const damga = GELIR_BEYANNAME_DAMGA[beyanYili];
  if (damga == null) return yuvarla(tahakkuk / 2);
  const vergi = Math.max(0, tahakkuk - damga);
  const yarim = yuvarla(vergi / 2);
  if (taksit === '1/2') return yuvarla(Math.min(tahakkuk, damga) + yarim);
  return yuvarla(vergi - yarim); // kuruş farkı 2. taksitte kapanır
}

export function ayAdi(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return String(month || '');
  return `${AY_ADLARI[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

/** "2026-07" / "2026/07" → "Temmuz 2026"; "2026-Q2" → "Nisan–Haziran 2026"; "2025-YIL" → "2025 Yılı". */
export function donemEtiketi(donem: string | null | undefined): string {
  const s = String(donem || '').trim();
  if (!s) return '';
  const q = /^(\d{4})-Q([1-4])$/i.exec(s);
  if (q) {
    const ilk = (Number(q[2]) - 1) * 3;
    return `${AY_ADLARI[ilk]}–${AY_ADLARI[ilk + 2]} ${q[1]}`;
  }
  const y = /^(\d{4})-YIL$/i.exec(s);
  if (y) return `${y[1]} Yılı`;
  const m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${AY_ADLARI[Number(m[2]) - 1]} ${m[1]}`;
  return s;
}

const TUR_ADLARI: Record<string, string> = {
  KDV1: 'KDV Beyannamesi',
  KDV2: 'KDV Tevkifat Beyannamesi (KDV2)',
  KDV4: 'KDV Beyannamesi (KDV4)',
  KDV9015: 'KDV Beyannamesi (9015)',
  MUHSGK: 'Muhtasar ve Prim Hizmet Beyannamesi',
  MUHSGK2: 'Muhtasar Beyannamesi (2)',
  DAMGA: 'Damga Vergisi Beyannamesi',
  POSET: 'Poşet Beyannamesi',
  KONAKLAMA: 'Konaklama Vergisi Beyannamesi',
  OIV: 'Özel İletişim Vergisi Beyannamesi',
  TURIZM: 'Turizm Payı Beyannamesi',
  OTV1: 'ÖTV Beyannamesi (1)',
  OTV3A: 'ÖTV Beyannamesi (3A)',
  OTV3B: 'ÖTV Beyannamesi (3B)',
  OTV4: 'ÖTV Beyannamesi (4)',
  EDEFTER: 'e-Defter Beratı',
  BILDIRGE: 'SGK Aylık Prim ve Hizmet Belgesi',
  GMSI: 'Yıllık Gelir Vergisi (Kira Geliri)',
  GELIR: 'Yıllık Gelir Vergisi',
  KURUMLAR: 'Kurumlar Vergisi',
  GGECICI: 'Gelir Geçici Vergi',
  KGECICI: 'Kurum Geçici Vergi',
  GECICI_VERGI: 'Geçici Vergi',
};

export const SGK_TUR_AD = 'SGK Prim Tahakkuku';

/** Okunur ad: "KDV Beyannamesi", "Gelir Geçici Vergi 2. Dönem", "Yıllık Gelir Vergisi 1. Taksit", "Muhtasar … (3 aylık)". */
export function turAdi(beyanTipi: string, donem: string, taksit?: Taksit | null): string {
  const tip = String(beyanTipi || '').toUpperCase();
  const temel = TUR_ADLARI[tip] || tip;
  const q = /^\d{4}-Q([1-4])$/i.exec(String(donem || ''));
  if (GECICI_TIPLER.has(tip)) return q ? `${temel} ${q[1]}. Dönem` : temel;
  if (GELIR_TIPLER.has(tip)) return taksit ? `${temel} ${taksit[0]}. Taksit` : temel;
  if (q) return `${temel} (3 aylık)`;
  return temel;
}

export interface DonemSecimi {
  donem: string;
  grup: OdemeGrup;
  /** 'GECICI' yalnız geçici tipler; 'GECICI_DISI' geçici olmayan çeyreklikler; küme = tam liste; yok = hepsi */
  tipler?: 'GECICI' | 'GECICI_DISI' | ReadonlySet<string>;
  taksit?: Taksit;
}

/** Ödeme ayı M için listeye giren dönem anahtarları. */
export function odemeAyiDonemleri(month: string): DonemSecimi[] {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return [];
  const my = Number(m[1]);
  const mm = Number(m[2]);
  const prev = new Date(my, mm - 2, 1);
  const secimler: DonemSecimi[] = [
    { donem: `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`, grup: 'AYLIK' },
  ];
  // Geçici vergi: Şubat→Q4(önceki yıl), Mayıs→Q1, Ağustos→Q2, Kasım→Q3 (17'si)
  if ([2, 5, 8, 11].includes(mm)) {
    const q = mm === 2 ? 4 : (mm - 2) / 3;
    secimler.push({ donem: `${mm === 2 ? my - 1 : my}-Q${q}`, grup: 'GECICI', tipler: 'GECICI' });
  }
  // Üç aylık diğer beyannameler: Ocak→Q4(önceki yıl), Nisan→Q1, Temmuz→Q2, Ekim→Q3
  if ([1, 4, 7, 10].includes(mm)) {
    const q = mm === 1 ? 4 : (mm - 1) / 3;
    secimler.push({ donem: `${mm === 1 ? my - 1 : my}-Q${q}`, grup: 'AYLIK', tipler: 'GECICI_DISI' });
  }
  // Yıllık: Mart 1. taksit, Temmuz 2. taksit (GELIR/GMSI); Nisan KURUMLAR
  if (mm === 3) secimler.push({ donem: `${my - 1}-YIL`, grup: 'YILLIK', tipler: GELIR_TIPLER, taksit: '1/2' });
  if (mm === 7) secimler.push({ donem: `${my - 1}-YIL`, grup: 'YILLIK', tipler: GELIR_TIPLER, taksit: '2/2' });
  if (mm === 4) secimler.push({ donem: `${my - 1}-YIL`, grup: 'YILLIK', tipler: KURUMLAR_TIPLER });
  return secimler;
}

export function secimTipeUyar(secim: DonemSecimi, beyanTipi: string): boolean {
  const tip = String(beyanTipi || '').toUpperCase();
  if (!secim.tipler) return true;
  if (secim.tipler === 'GECICI') return GECICI_TIPLER.has(tip);
  if (secim.tipler === 'GECICI_DISI') return !GECICI_TIPLER.has(tip);
  return secim.tipler.has(tip);
}

/** Beyan kaydını, ödeme ayının seçimlerinden uyanla eşler (yoksa null → listeye girmez). */
export function kaydinSecimi(secimler: DonemSecimi[], beyanTipi: string, donem: string): DonemSecimi | null {
  return secimler.find((s) => s.donem === donem && secimTipeUyar(s, beyanTipi)) || null;
}

/**
 * HAM son ödeme günü (hafta sonu/tatil kayması uygulanmamış). Aylık dönemlerde tek kaynak
 * `calculateBeyannameDeadline`; çeyrek ve yıllıkta bu dosyadaki takvim.
 */
export function hamSonGun(beyanTipi: string, donem: string, month: string): Date | null {
  const tip = String(beyanTipi || '').toUpperCase();
  const mAy = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!mAy) return null;
  const my = Number(mAy[1]);
  const mm = Number(mAy[2]);

  if (/^\d{4}-\d{2}$/.test(donem)) return calculateBeyannameDeadline(tip, donem);

  const q = /^(\d{4})-Q([1-4])$/i.exec(donem);
  if (q) {
    if (GECICI_TIPLER.has(tip)) return new Date(my, mm - 1, 17, 23, 59, 59);
    const sonAy = `${q[1]}-${String(Number(q[2]) * 3).padStart(2, '0')}`;
    return calculateBeyannameDeadline(tip, sonAy);
  }

  if (/^\d{4}-YIL$/i.test(donem)) {
    if (KURUMLAR_TIPLER.has(tip)) return new Date(my, 3, 30, 23, 59, 59); // 30 Nisan
    if (GELIR_TIPLER.has(tip)) return mm === 7 ? new Date(my, 6, 31, 23, 59, 59) : new Date(my, 2, 31, 23, 59, 59);
  }
  return null;
}

/** "YYYY-YIL" → beyannamenin verildiği yıl (YYYY + 1); damga tablosu bu yıla göre okunur. */
export function beyanYili(donem: string): number | null {
  const y = /^(\d{4})-YIL$/i.exec(String(donem || ''));
  return y ? Number(y[1]) + 1 : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Satır tipleri — ekran (apps/web/src/lib/aylik-odeme.ts) ile birebir sözleşme
// ─────────────────────────────────────────────────────────────────────────────
/** Bir kalemin bir kanaldan gönderim izi (yalnız SENT). Gerçek gönderim varsa o, yoksa test gönderimi (`test:true`). */
export interface KalemGonderimi {
  sentAt: string; // ISO
  test: boolean;
  /** Gönderim anındaki tutar (docRefs'ten) — sonradan düzeltilen tahakkuk ekranda ayırt edilebilsin. */
  tutar: number | null;
}

export type KalemGonderimHaritasi = { WHATSAPP: KalemGonderimi | null; EMAIL: KalemGonderimi | null };

export interface OdemeSatiri {
  tur: string; // ham kod: KDV1, MUHSGK, Tahakkuk Fişi… (eski WhatsApp metni ve ekran bunu kullanır)
  turAd: string; // okunur ad: "KDV Beyannamesi", "Gelir Geçici Vergi 2. Dönem"…
  kaynak: OdemeKaynak;
  grup: OdemeGrup;
  donem: string;
  sonGun: string | null; // KAYDIRILMIŞ son ödeme günü — "g.a.yyyy" (Hattat biçimi, sıfırsız)
  sonGunHam: string | null; // kaydırılmadan önceki ham gün — "g.a.yyyy"
  sonGunIso: string | null; // kaydırılmış — "YYYY-MM-DD"
  taksit?: Taksit | null;
  tutar: number;
  storageKey?: string | null; // belge PDF anahtarı (link için)
  /**
   * Belge referansı — SGK'da bildirge ref no (ör. "80646-2026-7"). Aynı mükellef+dönemde birden çok
   * SGK fişi olabilir (canlıda 579 çiftin 110'u); kalem anahtarı bununla ayrışır. VERGI'de boş
   * (beyanTipi+dönem mükellef başına zaten tekil).
   */
  ref?: string | null;
  /** Kalem bazlı gönderim izi (kanal → son gönderim). Kanal null = bu kalem o kanaldan hiç gitmedi. */
  gonderim?: KalemGonderimHaritasi;
}

/**
 * KALEM ANAHTARI — "hangi beyanname/fiş gönderildi" takibinin birimi; documentDispatch.docRefs[].key.
 *   VERGI: "VERGI|KDV1|2026-07|"            (taksit varsa: "VERGI|GELIR|2025-YIL|1/2")
 *   SGK  : "SGK|Tahakkuk Fişi|2026/07||80646-2026-7"  (ref eklenir — aynı dönemde çoklu fiş)
 */
export function kalemAnahtari(s: Pick<OdemeSatiri, 'kaynak' | 'tur' | 'donem'> & { taksit?: Taksit | null; ref?: string | null }): string {
  const temel = `${s.kaynak}|${s.tur}|${s.donem}|${s.taksit || ''}`;
  return s.ref ? `${temel}|${s.ref}` : temel;
}

/** Gönderilen kalem kümesinin kısa sha1'i (10 hex) — sıra ve tekrar bağımsız. */
export function kalemHash(anahtarlar: Iterable<string>): string {
  const sirali = Array.from(new Set(anahtarlar)).sort();
  return createHash('sha1').update(sirali.join('\n')).digest('hex').slice(0, 10);
}

/**
 * documentDispatch.dedupeKey — "ODEME:<taxpayerId>:<month>:<grup>:<kalemHash>[:T]".
 * Aynı kalem kümesi aynı kanaldan yeniden giderse aynı anahtar (upsert); farklı küme = YENİ satır (geçmiş korunur).
 * Test gönderimi ":T" ekiyle ayrılır: gerçek gönderim satırı test satırıyla EZİLMEZ (ezilseydi mükellefe
 * gerçekten gitmiş kalem "gitmedi" sayılıp ikinci kez giderdi).
 * Eski biçimler: "ODEME:<tid>:<month>" ve "ODEME:<tid>:<month>:<grup>" (hash'siz, docRefs null).
 */
export function odemeDedupeKey(taxpayerId: string, month: string, grup: OdemeKaynak, anahtarlar: Iterable<string>, test = false): string {
  return `ODEME:${taxpayerId}:${month}:${grup}:${kalemHash(anahtarlar)}${test ? ':T' : ''}`;
}

/** dedupeKey'den grup ("VERGI"|"SGK"); eski/yabancı biçimde null. */
export function dedupeKeyGrubu(dedupeKey: string | null | undefined): OdemeKaynak | null {
  const grup = String(dedupeKey || '').split(':')[3];
  return grup === 'VERGI' || grup === 'SGK' ? grup : null;
}

/** documentDispatch.docRefs öğesi — gönderilen kalemin o anki hâli. */
export interface OdemeDocRef {
  key: string;
  tur: string;
  donem: string;
  taksit: Taksit | null;
  tutar: number;
}

export function docRefOlustur(s: OdemeSatiri): OdemeDocRef {
  return { key: kalemAnahtari(s), tur: s.tur, donem: s.donem, taksit: s.taksit || null, tutar: s.tutar };
}

export interface GonderimBilgisi {
  status: 'SENT' | 'FAILED';
  sentAt: string | null;
  kanallar: string[];
  test: boolean;
  /** Bu gruptaki kalem sayısı. */
  toplamKalem: number;
  /** En az bir kanaldan GERÇEK (test olmayan) gitmiş kalem sayısı. */
  gonderilenKalem: number;
  /** Hiçbir kanaldan gerçek gitmemiş kalem sayısı (= toplamKalem − gonderilenKalem). */
  yeniKalem: number;
}

export interface OdemeListesi {
  taxpayerId: string;
  unvan: string;
  phone: string | null;
  email: string | null;
  satirlar: OdemeSatiri[];
  toplam: number;
  gonderim: { VERGI: GonderimBilgisi | null; SGK: GonderimBilgisi | null };
}

/** Kalem gerçekten (test olmayan) en az bir kanaldan gitti mi. */
export function kalemGercekGitti(s: Pick<OdemeSatiri, 'gonderim'>): boolean {
  const g = s.gonderim;
  return !!g && GONDERIM_KANALLARI.some((k) => !!g[k] && !g[k]!.test);
}
