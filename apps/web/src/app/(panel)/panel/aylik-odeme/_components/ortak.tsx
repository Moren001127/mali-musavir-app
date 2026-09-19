'use client';
import { portalStyle } from '@/lib/portal-theme';


/**
 * Aylık Ödeme Listesi — ortak palet ve küçük parçalar.
 * SAKİN PALET (Görevler ile aynı dil): koyu zemin, nötr griler; altın (#d4b876) YALNIZ ana düğme ve genel toplamda
 * (Muzaffer Bey 2026-09-14: "her şey inanılmaz sarı, göz yoruyor" → başlıklar, grup bantları, tutarlar, sayaçlar NÖTR).
 * Dolu renkli rozet YOK, tek ton satır zeminleri, vade için tek yumuşak kırmızı.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export const GOLD = '#d4b876';
export const GOLD_SOFT = '#b8a06f';
export const METIN = '#fafaf9';
export const IKINCIL = 'rgba(250,250,249,0.55)';
export const SONUK = 'rgba(250,250,249,0.35)';
/** Eski adıyla "altın soluk" — artık NÖTR gri (başlık/etiket rengi); altın yalnız ana düğme + genel toplam */
export const ALTIN_SOLUK = 'rgba(250,250,249,0.62)';
export const KENAR_NOTR = 'rgba(255,255,255,0.10)';
export const KENAR_YUMUSAK = 'rgba(255,255,255,0.08)';
export const KIRMIZI_YUMUSAK = '#e0868f';
/** Yumuşak amber — yalnız TEST MODU bandı ve eksikler paneli */
export const AMBER = '#e2b563';
export const AMBER_ZEMIN = 'rgba(226,181,99,0.04)';
export const AMBER_KENAR = 'rgba(226,181,99,0.18)';

export const KART: CSSProperties = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${KENAR_NOTR}`, borderRadius: 16 };
export const GIRDI: CSSProperties = { background: 'rgba(255,255,255,0.035)', border: `1px solid ${KENAR_YUMUSAK}`, color: METIN, borderRadius: 10, outline: 'none' };
export const CIP_NOTR: CSSProperties = { background: 'rgba(255,255,255,0.03)', border: `1px solid ${KENAR_NOTR}`, color: 'rgba(250,250,249,0.7)' };

/** Tablo hücresi / başlığı — Görevler tablosuyla aynı ölçüler */
export const HUCRE: CSSProperties = { border: `1px solid ${KENAR_NOTR}`, padding: '8px 10px', verticalAlign: 'middle' };
export const HUCRE_BASLIK: CSSProperties = { ...HUCRE, padding: '7px 10px', fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: ALTIN_SOLUK, textAlign: 'left', whiteSpace: 'nowrap' };
/** Grup başlığı bandı — NÖTR dolu zemin + gri üst/alt çizgi (sarı yok) */
export const GRUP_ZEMIN = 'rgba(255,255,255,0.06)';
export const GRUP_CIZGI = '1px solid rgba(255,255,255,0.16)';
export const GRUP_BOSLUK = 18;

/** Nötr ince çip (taksit, kanal, sayı) */
export function Cip({ children, title, className = '', style }: { children: ReactNode; title?: string; className?: string; style?: CSSProperties }) {
  return (
    <span title={title} className={`inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-[2px] text-[10.5px] font-medium leading-4 ${className}`} style={portalStyle({ ...CIP_NOTR, ...style })}>
      {children}
    </span>
  );
}

/** Altın gradyan ana düğme */
export function AltinDugme({ children, onClick, disabled, yukleniyor, title, className = '', refDis, kucuk }: { children: ReactNode; onClick?: () => void; disabled?: boolean; yukleniyor?: boolean; title?: string; className?: string; refDis?: React.Ref<HTMLButtonElement>; kucuk?: boolean }) {
  return (
    <button
      ref={refDis}
      type="button"
      onClick={onClick}
      disabled={disabled || yukleniyor}
      title={title}
      className={`inline-flex ${kucuk ? 'h-8 px-3 text-[12px]' : 'h-9 px-3.5 text-[12.5px]'} flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] font-bold transition-[transform,filter] hover:-translate-y-px hover:brightness-110 disabled:opacity-45 disabled:hover:translate-y-0 ${className}`}
      style={portalStyle({ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b' })}
    >
      {yukleniyor ? <Loader2 size={13} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

/** İnce gri kenarlı ikincil düğme (Yazdır, PDF, Excel…) */
export function GriDugme({ children, onClick, disabled, yukleniyor, title, className = '', refDis, aktif, kucuk, ariaExpanded }: { children: ReactNode; onClick?: () => void; disabled?: boolean; yukleniyor?: boolean; title?: string; className?: string; refDis?: React.Ref<HTMLButtonElement>; aktif?: boolean; kucuk?: boolean; ariaExpanded?: boolean }) {
  return (
    <button
      ref={refDis}
      type="button"
      onClick={onClick}
      disabled={disabled || yukleniyor}
      title={title}
      aria-expanded={ariaExpanded}
      className={`inline-flex ${kucuk ? 'h-8 px-2.5 text-[12px]' : 'h-9 px-3 text-[12.5px]'} flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] font-semibold transition-[transform,background-color,border-color,color] hover:-translate-y-px disabled:opacity-40 disabled:hover:translate-y-0 ${className}`}
      style={
        portalStyle(aktif
          ? { background: 'rgba(212,184,118,0.10)', border: `1px solid ${GOLD}66`, color: GOLD }
          : { background: 'rgba(255,255,255,0.03)', border: `1px solid ${KENAR_NOTR}`, color: 'rgba(250,250,249,0.78)' })
      }
    >
      {yukleniyor ? <Loader2 size={13} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

/** Açma/kapama anahtarı — tek vurgu altın */
export function Anahtar({ acik, onDegis, title, disabled }: { acik: boolean; onDegis: (v: boolean) => void; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={acik}
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={() => onDegis(!acik)}
      className="relative inline-flex h-[20px] w-[36px] flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40"
      style={portalStyle({ background: acik ? GOLD : 'rgba(255,255,255,0.12)', border: `1px solid ${acik ? GOLD : KENAR_NOTR}` })}
    >
      <span className="absolute h-[14px] w-[14px] rounded-full transition-[left]" style={portalStyle({ left: acik ? 18 : 2, background: acik ? '#0f0d0b' : 'rgba(250,250,249,0.7)' })} />
    </button>
  );
}

/** Küçük bölüm başlığı (kart içinde) */
export function KartBaslik({ ikon, children, sag }: { ikon?: ReactNode; children: ReactNode; sag?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {ikon && <span style={portalStyle({ color: ALTIN_SOLUK })}>{ikon}</span>}
      <span className="text-[11px] font-bold uppercase tracking-[.14em]" style={portalStyle({ color: ALTIN_SOLUK })}>{children}</span>
      {sag && <span className="ml-auto">{sag}</span>}
    </div>
  );
}
