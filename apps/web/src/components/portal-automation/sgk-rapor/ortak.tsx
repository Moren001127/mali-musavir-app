'use client';
import { portalStyle, portalCss } from '@/lib/portal-theme';
import './sgk-rapor-white.css';

// SGK Rapor bölümü ortak parçaları: tarih biçimleri · mükellefe göre gruplama · pencere kabuğu · kart başlığı ·
// SGK sonuç satırı. Koyu tema (A) satır içi renklerle; beyaz tema (D) sgk-rapor-white.css kancalarıyla (data-sr-*).
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { isoGunuBicimle } from '@mali-musavir/shared';
import { METIN } from '../belge-ortak';

export const KENAR = 'rgba(255,255,255,0.09)';
export const SOLUK = 'rgba(250,250,249,0.45)';
export const IKINCIL = 'rgba(250,250,249,0.72)';

// ── Tarihler (Europe/Istanbul) ─────────────────────────────────────────────────────────────────────────────────────
const TZ = 'Europe/Istanbul';
const GUN_ANAHTARI = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const ZAMAN = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const SADECE_GUN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Bugün "YYYY-AA-GG" (İstanbul). */
export function bugunIso(): string {
  return GUN_ANAHTARI.format(new Date());
}

/** "2026-09-26" → "26.09.2026". Boş / SGK boş tarihi ("0001-01-01", "-") → "—". Saatli ISO → yerel gün. */
export function gunYaz(v: string | null | undefined): string {
  const s = String(v || '').trim();
  const m = SADECE_GUN.exec(s.slice(0, 10));
  if (!m || Number(m[1]) < 1900) return '—';
  if (s.length > 10) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return isoGunuBicimle(GUN_ANAHTARI.format(d));
  }
  return isoGunuBicimle(s.slice(0, 10));
}

/** ISO zaman → "26.09.2026 14:20". */
export function zamanYaz(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return ZAMAN.format(d);
}

/** Aralık: "05.08.2026–31.08.2026". */
export function aralikYaz(bas: string | null | undefined, bit: string | null | undefined): string {
  return `${gunYaz(bas)}–${gunYaz(bit)}`;
}

// ── Mükellefe göre gruplama (grup başlığı = işyeri; satırlarda işyeri adı tekrar yazılmaz) ────────────────────────────
export type Grup<T> = { taxpayerId: string; ad: string; satirlar: T[] };
export function mukellefeGoreGrupla<T extends { taxpayerId: string; mukellefAdi: string }>(
  satirlar: T[],
  sirala: (a: T, b: T) => number,
): Grup<T>[] {
  const map = new Map<string, Grup<T>>();
  for (const s of satirlar) {
    let g = map.get(s.taxpayerId);
    if (!g) { g = { taxpayerId: s.taxpayerId, ad: s.mukellefAdi || '—', satirlar: [] }; map.set(s.taxpayerId, g); }
    g.satirlar.push(s);
  }
  return [...map.values()]
    .sort((a, b) => a.ad.localeCompare(b.ad, 'tr'))
    .map((g) => ({ ...g, satirlar: [...g.satirlar].sort(sirala) }));
}

/** ISO gün karşılaştırıcısı (boşlar sona). */
export function gunSirasi(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── Kart kabuğu + başlığı ─────────────────────────────────────────────────────────────────────────────────────────
export const Kart = React.forwardRef<HTMLDivElement, { children: React.ReactNode; tur: string }>(function Kart({ children, tur }, ref) {
  return (
    <section
      ref={ref}
      data-sr-kart={tur}
      className="overflow-hidden rounded-2xl border scroll-mt-4"
      style={portalStyle({ borderColor: 'rgba(255,255,255,0.07)', background: 'linear-gradient(160deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 30px rgba(0,0,0,0.25)' })}
    >
      {children}
    </section>
  );
});

export function KartBasligi({ ikon, ton, baslik, alt, sag }: {
  ikon: React.ReactNode;
  /** beyaz tema simge tonu */
  ton: 'mavi' | 'kirmizi' | 'notr';
  baslik: string;
  alt?: React.ReactNode;
  sag?: React.ReactNode;
}) {
  return (
    <div data-sr-kart-bas className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" style={portalStyle({ borderBottom: `1px solid ${KENAR}` })}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span data-sr-kart-ikon={ton} className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg" style={portalStyle({ background: 'rgba(212,184,118,0.12)', color: '#d4b876' })}>{ikon}</span>
        <div className="min-w-0">
          <h2 data-sr-kart-baslik className="text-[15px] font-bold leading-tight" style={portalStyle({ color: METIN })}>{baslik}</h2>
          {alt && <div data-sr-kart-alt className="mt-0.5 text-[12px]" style={portalStyle({ color: SOLUK })}>{alt}</div>}
        </div>
      </div>
      {sag && <div className="ml-auto flex flex-wrap items-center gap-2">{sag}</div>}
    </div>
  );
}

/** Tek satır durum metni (yükleniyor / boş / hata). */
export function DurumSatiri({ ton = 'soluk', children }: { ton?: 'soluk' | 'hata'; children: React.ReactNode }) {
  return (
    <div data-sr-durum-satiri={ton} className="px-4 py-6 text-[13px]" style={portalStyle({ color: ton === 'hata' ? '#e2706f' : SOLUK })}>
      {children}
    </div>
  );
}

/** İkili seçici ("Onay bekleyen (4) | Onaylanmış (15)"). */
export function IkiliSecici<T extends string>({ deger, secenekler, onSec, etiket }: {
  deger: T;
  secenekler: Array<{ deger: T; ad: string }>;
  onSec: (d: T) => void;
  etiket: string;
}) {
  return (
    <div data-sr-ikili role="tablist" aria-label={etiket} className="inline-flex items-center gap-0.5 rounded-[10px] border p-[3px]" style={portalStyle({ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' })}>
      {secenekler.map((s) => {
        const secili = s.deger === deger;
        return (
          <button
            key={s.deger}
            type="button"
            role="tab"
            aria-selected={secili}
            data-sr-ikili-dugme
            onClick={() => onSec(s.deger)}
            className="h-7 whitespace-nowrap rounded-[8px] px-3 text-[12.5px] font-semibold tabular-nums transition"
            style={portalStyle(secili ? { background: 'rgba(212,184,118,0.16)', color: '#d4b876' } : { background: 'transparent', color: IKINCIL })}
          >
            {s.ad}
          </button>
        );
      })}
    </div>
  );
}

// ── SGK sonuç satırı (onay / personelim değil) ───────────────────────────────────────────────────────────────────
export type IslemSonucu = { basarili: boolean; metin: string; kod?: number | null } | null;
export function SonucSatiri({ sonuc }: { sonuc: IslemSonucu }) {
  if (!sonuc) return null;
  return (
    <div
      role="status"
      data-sr-sonuc={sonuc.basarili ? 'basarili' : 'hata'}
      title={sonuc.kod !== null && sonuc.kod !== undefined ? `SGK sonuç kodu: ${sonuc.kod}` : undefined}
      className="mt-3 rounded-lg border px-3 py-2 text-[13px] font-semibold leading-snug"
      style={portalStyle(sonuc.basarili
        ? { background: 'rgba(92,191,138,0.12)', borderColor: 'rgba(92,191,138,0.4)', color: '#5cbf8a' }
        : { background: 'rgba(226,112,111,0.12)', borderColor: 'rgba(226,112,111,0.45)', color: '#e2706f' })}
    >
      {sonuc.metin}
    </div>
  );
}

/** Axios hatasından okunur metin. */
export function hataMetni(e: unknown, varsayilan: string): string {
  const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(m)) return m.join(' · ');
  return typeof m === 'string' && m.trim() ? m : varsayilan;
}

// ── Pencere kabuğu: ekran ortasında, Esc ve dış tıklama kapatır (işlem sürerken kapanmaz) ──────────────────────────
export function Pencere({ acik, onKapat, baslik, ikon, tur, genislik = 560, kilitli = false, alt, children }: {
  acik: boolean;
  onKapat: () => void;
  baslik: string;
  /** başlığın solunda küçük simge (ör. hata penceresinde uyarı) */
  ikon?: React.ReactNode;
  /** data-pa-modal değeri ('hata' kırmızı başlık bandı verir) */
  tur: string;
  genislik?: number;
  /** true iken (gönderim sürüyor) kapatılamaz */
  kilitli?: boolean;
  /** alt düğme şeridi */
  alt?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!acik) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !kilitli) onKapat(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [acik, kilitli, onKapat]);
  if (!acik || typeof document === 'undefined') return null;
  return createPortal(
    <div
      onClick={() => { if (!kilitli) onKapat(); }}
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={portalStyle({ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' })}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={baslik}
        onClick={(e) => e.stopPropagation()}
        data-pa-modal={tur}
        data-sr-pencere={tur}
        className="relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={portalStyle({ maxWidth: genislik, background: '#1a1410', borderColor: 'rgba(212,184,118,0.25)', animation: 'belgeZoom .22s ease-out' })}
      >
        <div data-pa-modal-head className="flex flex-shrink-0 items-center justify-between gap-3 border-b px-5 py-3" style={portalStyle({ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' })}>
          <div className="flex min-w-0 items-center gap-2">
            {ikon}
            <span className="text-[14.5px] font-bold" style={portalStyle({ color: METIN })}>{baslik}</span>
          </div>
          <button type="button" onClick={onKapat} disabled={kilitli} data-pa-btn="ikincil" aria-label="Kapat"
            className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border hover:brightness-110 disabled:opacity-40"
            style={portalStyle({ borderColor: 'rgba(255,255,255,0.12)', color: METIN })}>
            <X size={16} />
          </button>
        </div>
        <div data-sr-pencere-govde className="overflow-y-auto px-5 py-4 text-[13px]" style={portalStyle({ color: IKINCIL })}>{children}</div>
        {alt && (
          <div data-sr-pencere-alt className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 border-t px-5 py-3" style={portalStyle({ borderColor: 'rgba(255,255,255,0.08)' })}>
            {alt}
          </div>
        )}
      </div>
      <style>{portalCss(`@keyframes belgeZoom { from { transform: scale(.9); opacity: 0 } to { transform: scale(1); opacity: 1 } }`)}</style>
    </div>,
    document.body,
  );
}

/** Pencere alt şeridi düğmeleri (birincil = mevcut "Şimdi sorgula" ile aynı görünüm). */
export function PencereDugmesi({ tur, onClick, disabled, children }: { tur: 'birincil' | 'ikincil'; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-pa-btn={tur}
      className="flex h-9 items-center gap-2 rounded-[10px] border px-4 text-[13px] font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      style={portalStyle(tur === 'birincil'
        ? { background: 'linear-gradient(135deg, #d4b876, #b8a06f)', color: '#1a1410', borderColor: 'transparent' }
        : { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.12)', color: METIN })}
    >
      {children}
    </button>
  );
}
