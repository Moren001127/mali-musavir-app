/**
 * Görevler & Notlar — ortak renkler, gruplama ve tarih yardımcıları.
 * Tasarım dili: koyu zemin + gradyan kart + radial parıltı; altın (#d4b876) yalnız vurgu.
 * Kart/Hap/BosDurum ve kart zeminleri Ekip modülünden yeniden kullanılır (ekip/_components/Kart.tsx, ortak.ts).
 */
import type { CSSProperties } from 'react';
import {
  PRIORITY_COLOR,
  getDueStatusForDate,
  gunFarki,
  type DueStatus,
  type EkipIstek,
  type TakvimKalemi,
  type Task,
} from '@/lib/tasks';

export const GOLD = '#d4b876';
export const GOLD_SOFT = '#b8a06f';
export const METIN = '#fafaf9';
export const IKINCIL = 'rgba(250,250,249,0.55)';
export const SONUK = 'rgba(250,250,249,0.35)';
/** Görünür tablo kenarlığı (koyu zeminde .07 görünmüyor → .14). */
export const KENAR = 'rgba(255,255,255,0.14)';
export const KENAR_YUMUSAK = 'rgba(255,255,255,0.08)';
export const ZEMIN_KOYU = '#0f0d0b';
export const EKIP_RENK = '#7dd3fc';
export const TAKVIM_RENK = '#a78bfa';
export const NOT_RENK = '#f59e0b';
export const YESIL = '#22c55e';
export const MOR = '#a855f7';
export const KIRMIZI = '#ef4444';
export const MAVI = '#3b82f6';

/** Ajanda grupları — sıra ve renk. */
export const GRUPLAR: Array<{ key: DueStatus; ad: string; renk: string }> = [
  { key: 'overdue', ad: 'Gecikmiş', renk: KIRMIZI },
  { key: 'today', ad: 'Bugün', renk: GOLD },
  { key: 'tomorrow', ad: 'Yarın', renk: '#7dd3fc' },
  { key: 'thisWeek', ad: 'Bu hafta', renk: '#a78bfa' },
  { key: 'later', ad: 'Sonra', renk: '#9ca3af' },
  { key: 'none', ad: 'Tarihsiz', renk: '#6b7280' },
];

/** Tablo satırı: görev · ekip isteği · mali takvim kalemi. */
export type Satir =
  | { tip: 'gorev'; gorev: Task }
  | { tip: 'istek'; istek: EkipIstek }
  | { tip: 'takvim'; kalem: TakvimKalemi };

export interface SatirGrubu {
  key: string;
  ad: string;
  renk: string;
  satirlar: Satir[];
  /** Grup başlığında ek bilgi (ör. mükellef açık görev sayısı) */
  ek?: string;
}

/** Ertelenmiş görevde etkin tarih = erteleme bitişi; yoksa vade. */
export function etkinTarih(t: Task): string | null {
  if (t.status === 'SNOOZED' && t.snoozedUntil) return t.snoozedUntil;
  return t.dueDate || null;
}

export function gorevGrubu(t: Task, simdi: Date = new Date()): DueStatus {
  return getDueStatusForDate(etkinTarih(t), simdi);
}

/** "3 gün gecikti" / "bugün" / "yarın" / "5 gün sonra" */
export function gecikmeMetni(iso: string | null | undefined, simdi: Date = new Date()): string {
  if (!iso) return '';
  const fark = gunFarki(simdi, new Date(iso));
  if (fark < 0) return `${-fark} gün gecikti`;
  if (fark === 0) return 'bugün';
  if (fark === 1) return 'yarın';
  return `${fark} gün sonra`;
}

/** "14 Eyl" */
export function kisaTarih(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}

/** "14 Eyl 2026, Pazartesi" */
export function uzunTarih(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', weekday: 'long' });
}

/** "14.09 10:32" */
export function tarihSaat(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** "5 sa önce" / "2 gün önce" / "az önce" */
export function goreliZaman(iso: string | null | undefined, simdi: Date = new Date()): string {
  if (!iso) return '';
  const ms = simdi.getTime() - new Date(iso).getTime();
  const dk = Math.round(ms / 60_000);
  if (dk < 1) return 'az önce';
  if (dk < 60) return `${dk} dk önce`;
  const sa = Math.round(dk / 60);
  if (sa < 24) return `${sa} sa önce`;
  const gun = Math.round(sa / 24);
  return `${gun} gün önce`;
}

/** "2026-08" → "Ağustos 2026", "2026-Q3" → "3. Çeyrek 2026" */
export function donemEtiketi(donem?: string | null): string {
  if (!donem) return '';
  const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const q = /^(\d{4})-Q([1-4])$/.exec(donem);
  if (q) return `${q[2]}. Çeyrek ${q[1]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(donem);
  if (m) return `${aylar[Number(m[2]) - 1] || m[2]} ${m[1]}`;
  return donem;
}

export function oncelikRengi(p: Task['priority']): string {
  return PRIORITY_COLOR[p] || PRIORITY_COLOR.MEDIUM;
}

/** Renkli etiket (kategori/öncelik/kaynak) stili — ince kenar, hafif dolgu. */
export function etiketStili(renk: string, dolu = false): CSSProperties {
  return dolu
    ? { background: renk, color: '#0f0d0b', border: '1px solid transparent' }
    : { background: `${renk}18`, color: renk, border: `1px solid ${renk}44` };
}

/** Giriş kutusu ortak stili. */
export const GIRDI: CSSProperties = {
  background: 'rgba(255,255,255,0.035)',
  border: `1px solid ${KENAR_YUMUSAK}`,
  color: METIN,
  borderRadius: 10,
  outline: 'none',
};

/** Açılır menü / panel zemini. */
export const MENU_ZEMIN: CSSProperties = {
  background: '#14110e',
  border: `1px solid rgba(255,255,255,0.10)`,
  boxShadow: '0 18px 48px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
  borderRadius: 12,
};

/** ISO tarihi (ya da YYYY-MM-DD) yerel gece yarısı ISO'ya çevirir — arka uca gönderim için. */
export function vadeIso(gun: string | null | undefined, saat?: string | null): string | undefined {
  if (!gun) return undefined;
  const [y, m, d] = gun.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return undefined;
  const t = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (saat && /^\d{2}:\d{2}$/.test(saat)) {
    const [h, dk] = saat.split(':').map(Number);
    t.setHours(h, dk, 0, 0);
  }
  return t.toISOString();
}

/** ISO → YYYY-MM-DD (yerel). */
export function gunDegeri(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const g = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${g}`;
}
