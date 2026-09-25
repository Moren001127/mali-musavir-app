/**
 * Mükellef kartı — tasarım sözlüğü (renkler, zeminler, alan sınıfları) ve saf yardımcılar.
 *
 * TASARIM DİLİ (2026-09-14, "sakin komuta merkezi"):
 * - Koyu sıcak zemin + altın (#d4b876) yalnız TEK vurguda (Kaydet, aktif sekme çizgisi, grup başlığı).
 * - Düz gri kutu YOK: kart = degrade + köşede hafif radyal parıltı.
 * - Tek köşe yarıçapı: kart 10px, alan 8px. Tek kenarlık tonu (LINE). İç ayraçlar HAIR.
 * - İki yazı ağırlığı: 500 (font-medium) ve 700 (font-bold). Boylar: 11.5 / 13 / 14 / 18.
 * - Yapışkan başlık YOK; işlev hover'a saklanmaz.
 */
import type { CSSProperties } from 'react';

// Inter (onaylanan tasarım). Font, globals/layout'taki Google Fonts bağlantısıyla yüklenir.
export const CARD_FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// ── Renkler ──
export const GOLD = '#d4b876';
export const GOLD_SOFT = '#b8a06f';
export const GOLD_BR = '#ecd6a4';
export const GOLD_DP = '#8b7649';
/** Soluk altın — tablo başlığı yazısı, grup başlığı. */
export const ALTIN_SOLUK = 'rgba(212,184,118,0.85)';
export const STEEL = '#4f86c9';
export const STEEL_BR = '#74a6e6';
export const STEEL_DP = '#2b5489';
export const STEEL_SF = 'rgba(79,134,201,0.13)';
export const STEEL_LN = 'rgba(79,134,201,0.32)';
export const TEXT = '#fafaf9';
export const MUTED = 'rgba(250,250,249,0.58)';
export const FAINT = 'rgba(250,250,249,0.36)';
/** Kart zemini (düz kullanım için; tercihen KART_ZEMIN/kartZemin). */
export const CARD = '#14110e';
export const CARD2 = '#0e0c0a';
export const RAISE = '#1a1613';
/** İç ayraç (hafif). */
export const HAIR = 'rgba(255,255,255,0.06)';
/** TEK kenarlık tonu. */
export const LINE = 'rgba(255,255,255,0.10)';
export const GREEN = '#5fcf8e';
export const AMBER = '#f0b755';
/** Tek yumuşak kırmızı (kalın değil). */
export const RED = '#e0868f';

// ── Köşe yarıçapları ──
export const R_KART = 10;
export const R_ALAN = 8;

// ── Zeminler ──
/** Kart zemini: degrade + köşede hafif parıltı. `renk` verilirse parıltı o renkte olur.
 *  TABAN KATMANI NÖTR (2026-09-25): eskiden `#15120f → #0d0b09` (kahverengi-siyah) idi; beyaz temada
 *  bej/krem bir zemine dönüşüyor, üstüne konan parıltı rengi görünmez hâle geliyordu
 *  (Muzaffer Bey: "üstte firma unvanının yazdığı tablonun arka plan renk geçişi kötü"). */
export function kartZemin(renk: string = GOLD, guc: 'hafif' | 'orta' = 'hafif'): CSSProperties {
  const a = guc === 'orta' ? '22' : '12';
  return {
    background: `radial-gradient(120% 90% at 0% 0%, ${renk}${a}, transparent 55%), linear-gradient(160deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01)), linear-gradient(160deg, #131519, #0c0d10)`,
    border: `1px solid ${LINE}`,
    borderRadius: R_KART,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 30px rgba(0,0,0,0.25)',
  };
}
export const KART_ZEMIN: CSSProperties = kartZemin();
/** Kart içinde ikinci düzey yüzey (tablo sarmalı, iç kutu) — kenarlık aynı ton, zemin biraz daha koyu. */
export const IC_ZEMIN: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(0,0,0,0.22), rgba(0,0,0,0.30))',
  border: `1px solid ${LINE}`,
  borderRadius: R_KART,
};
/** Renk şeridi (3px sol / 1px üst). */
export function seritStili(renk: string): CSSProperties {
  return { background: `linear-gradient(180deg, ${renk}, ${renk}66)` };
}

// ── Çipler / haplar ──
/** Nötr çip: ince kenar, dolgu yok. */
export const CIP_NOTR: CSSProperties = { background: 'rgba(255,255,255,0.03)', border: `1px solid ${LINE}`, color: 'rgba(250,250,249,0.72)' };
/** Renkli hap: ince renkli kenar + çok hafif dolgu. `dolu` = altın/renk dolgulu, koyu yazı (yalnız TEK vurgu). */
export function hapStili(renk: string, dolu = false): CSSProperties {
  return dolu
    ? { background: `linear-gradient(135deg, ${renk}, ${renk}bb)`, border: '1px solid transparent', color: '#0f0d0b' }
    : { background: `${renk}14`, border: `1px solid ${renk}44`, color: renk };
}
/** 34px ikon rozeti (akordeon/sekme başlıkları): renkli hafif dolgu, renkli ikon. */
export function ikonRozeti(renk: string): CSSProperties {
  return { background: `${renk}1a`, border: `1px solid ${renk}3d`, color: renk, borderRadius: R_ALAN };
}
/** Altın birincil düğme (Kaydet) — sayfada TEK altın dolgu. */
export const ALTIN_DUGME: CSSProperties = {
  background: `linear-gradient(135deg, ${GOLD_BR}, ${GOLD_SOFT})`,
  color: '#0f0d0b',
  boxShadow: '0 6px 16px rgba(212,184,118,0.22), inset 0 1px 0 rgba(255,255,255,0.35)',
  borderRadius: R_ALAN,
};
/** Nötr ikincil düğme. */
export const NOTR_DUGME: CSSProperties = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${LINE}`, color: MUTED, borderRadius: R_ALAN };

// ── Tablo (gerçek <table>) ──
// v2 (2026-09-14): SAKİN tablo — altın yok; tam çizgili, nötr başlık bandı, nötr grup satırı.
export const TABLO_CIZGI = 'rgba(255,255,255,0.12)';
/** Hücre ayracı: YALNIZ yatay. 2026-09-25'e kadar her hücrenin dört yanı çizgiliydi, tablo ızgara gibi görünüyordu. */
export const HUCRE_AYRAC = 'rgba(255,255,255,0.07)';
export const HUCRE: CSSProperties = { borderBottom: `1px solid ${HUCRE_AYRAC}`, padding: '0 12px', height: 38, verticalAlign: 'middle', fontSize: 13 };
export const HUCRE_BASLIK: CSSProperties = { ...HUCRE, height: 32, fontSize: 10.5, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: 'rgba(250,250,249,0.55)', textAlign: 'left', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.05)', borderBottom: `1px solid ${TABLO_CIZGI}` };
export const GRUP_ZEMIN = 'rgba(255,255,255,0.045)';
export const GRUP_CIZGI = `1px solid ${TABLO_CIZGI}`;

// ── Form alanları (40px, 8px köşe) ──
export const FIELD_CLS = 'h-10 w-full rounded-[8px] border border-white/[0.10] bg-black/30 px-3 text-[13px] font-medium text-[#fafaf9] outline-none transition-colors duration-150 placeholder:text-white/25 hover:border-white/[0.18] focus:border-[#d4b876]/60 focus:shadow-[0_0_0_3px_rgba(212,184,118,0.14)]';
export const SELECT_CLS = `${FIELD_CLS} cursor-pointer`;
export const TEXTAREA_CLS = 'w-full resize-none rounded-[8px] border border-white/[0.10] bg-black/30 px-3 py-2.5 text-[13px] font-medium text-[#fafaf9] outline-none transition-colors duration-150 placeholder:text-white/25 hover:border-white/[0.18] focus:border-[#d4b876]/60 focus:shadow-[0_0_0_3px_rgba(212,184,118,0.14)]';


// ── Yardımcılar ──
// Telefon maskesi: rakamları 0(5XX) XXX XX XX biçiminde gösterir; sakla=temiz 10 hane
export function formatTrPhone(raw: string): string {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('90')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  d = d.slice(0, 10);
  if (!d) return '';
  let out = '0(' + d.slice(0, 3);
  if (d.length >= 3) out += ')';
  if (d.length > 3) out += ' ' + d.slice(3, 6);
  if (d.length > 6) out += ' ' + d.slice(6, 8);
  if (d.length > 8) out += ' ' + d.slice(8, 10);
  return out;
}
export function cleanTrPhone(raw: string): string {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('90')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

export function displayName(item: any) {
  return (
    item?.companyName ||
    [item?.firstName, item?.lastName].filter(Boolean).join(' ') ||
    item?.taxNumber ||
    'Mükellef'
  );
}

export function initialsFor(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function fmtDateTR(iso: string): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export const COMPLETENESS_COLOR: Record<string, string> = {
  TAM: GREEN,
  IYI: '#9bd445',
  EKSIK: AMBER,
  KRITIK_EKSIK: RED,
};

export function toMoneyNumber(n: number | string | null | undefined): number {
  if (typeof n === 'number') return Number.isFinite(n) ? n : 0;
  const raw = String(n ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function portalDateTr(v: any): string {
  if (!v) return '—';
  const s = String(v).trim();
  const tr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (tr) return `${tr[1]}/${tr[2]}/${tr[3]} ${tr[4]}:${tr[5]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return s.slice(0, 16);
}

export function fmtBeyanDonem(donem: string): string {
  if (!donem) return '—';
  const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  let m = /^(\d{4})-(\d{2})$/.exec(donem);
  if (m) { const ay = +m[2]; return ay >= 1 && ay <= 12 ? `${aylar[ay - 1]} ${m[1]}` : donem; }
  m = /^(\d{4})-Q(\d)$/.exec(donem); if (m) return `${m[1]} ${m[2]}. Dönem`;
  m = /^(\d{4})-YIL$/.exec(donem); if (m) return `${m[1]} Yıllık`;
  return donem;
}

export function fmtTutar(n: number | string | null | undefined): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '0,00';
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

