'use client';
import React from 'react';
import Link from 'next/link';
import { ChevronRight, Eye, Loader2 } from 'lucide-react';
import { FAINT, GRUP_CIZGI, GRUP_ZEMIN, HUCRE, HUCRE_BASLIK, LINE, MUTED, NOTR_DUGME, TABLO_CIZGI, TEXT, ikonRozeti } from '../../_lib/tema';

/** Sekme içi bekleme/boş durum sarmalı. */
export function PortalTabState({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[160px] items-center justify-center text-[13px]" style={{ color: MUTED }}>{children}</div>;
}

/** Boş durum: ikon + başlık + tek cümle (ortalanmış). */
export function BosDurum({ icon: Icon, title, text, renk = MUTED, children }: { icon: React.ElementType; title: string; text: string; renk?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <span className="mb-3 flex h-10 w-10 items-center justify-center" style={ikonRozeti(renk)}>
        <Icon size={18} />
      </span>
      <p className="text-[14px] font-bold" style={{ color: TEXT }}>{title}</p>
      <p className="mt-1 max-w-md text-[13px]" style={{ color: MUTED }}>{text}</p>
      {children}
    </div>
  );
}

/** Sekme başlık bandı: 14/700 başlık + 11.5 açıklama, sağda eylemler. */
export function SekmeBasligi({ title, text, children }: { title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[14px] font-bold leading-5" style={{ color: TEXT }}>{title}</h3>
        {text && <p className="mt-0.5 text-[11.5px]" style={{ color: MUTED }}>{text}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** Gerçek tablo sarmalı: kenarlıklı, yatay kaydırma kendi içinde, isteğe bağlı azami yükseklik. */
export function TabloSarmal({ children, maxHeight, minWidth = 760 }: { children: React.ReactNode; maxHeight?: number; minWidth?: number }) {
  return (
    <div className="overflow-auto" style={{ border: `1px solid ${TABLO_CIZGI}`, borderRadius: 8, background: 'rgba(0,0,0,0.12)', maxHeight }}>
      <table className="w-full" style={{ borderCollapse: 'collapse', minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, right, center, style }: { children?: React.ReactNode; right?: boolean; center?: boolean; style?: React.CSSProperties }) {
  return <th style={{ ...HUCRE_BASLIK, textAlign: right ? 'right' : center ? 'center' : 'left', ...style }}>{children}</th>;
}

export function Td({ children, right, center, muted, tabular, className = '', style, colSpan }: { children?: React.ReactNode; right?: boolean; center?: boolean; muted?: boolean; tabular?: boolean; className?: string; style?: React.CSSProperties; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={`${tabular ? 'tabular-nums' : ''} ${className}`} style={{ ...HUCRE, textAlign: right ? 'right' : center ? 'center' : 'left', color: muted ? MUTED : TEXT, ...style }}>
      {children}
    </td>
  );
}

/** Grup başlığı satırı (nötr): hafif zemin + büyük harf etiket + soluk sayı. Renk şeridi YOK. */
export function GrupSatiri({ ad, sayi, colSpan, ek }: { ad: string; sayi?: number; renk?: string; colSpan: number; ek?: React.ReactNode }) {
  return (
    <tr style={{ background: GRUP_ZEMIN }}>
      <td colSpan={colSpan} style={{ ...HUCRE, height: 38, borderTop: GRUP_CIZGI, borderBottom: GRUP_CIZGI }}>
        <div className="flex items-center gap-2.5">
          <span className="text-[12.5px] font-bold uppercase" style={{ color: 'rgba(250,250,249,0.80)', letterSpacing: '.06em' }}>{ad}</span>
          {sayi != null && <span className="text-[12px] font-medium tabular-nums" style={{ color: FAINT }}>{sayi}</span>}
          {ek}
        </div>
      </td>
    </tr>
  );
}

/** Tablo içi "belge aç" düğmesi — kutusuz (hayalet): soluk ikon, üzerine gelince parlar. */
export function DocBtn({ label, disabled, busy, onClick, muted }: { label: string; disabled?: boolean; busy?: boolean; onClick: () => void; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
      style={{ color: muted ? FAINT : MUTED }}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Eye size={16} />}
    </button>
  );
}

/** Tür/durum etiketi — nötr düz yazı (renkli çip YOK; `renk` geriye uyumluluk için kabul edilir, kullanılmaz). */
export function Cip({ renk: _renk, children, className = '' }: { renk?: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={`whitespace-nowrap text-[13px] font-medium ${className}`} style={{ color: 'rgba(250,250,249,0.80)' }}>
      {children}
    </span>
  );
}

/** Nötr açıklama satırı (tablo altı). */
export function Dipnot({ children }: { children: React.ReactNode }) {
  return <p className="mt-2.5 text-[11.5px]" style={{ color: FAINT }}>{children}</p>;
}

/** Bağlantı görünümlü düğme (nötr, 36px). */
export function BaglantiDugme({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-9 items-center gap-1.5 px-3.5 text-[13px] font-medium transition hover:brightness-125" style={NOTR_DUGME}>
      {children}
    </Link>
  );
}

export function PlaceholderTab({
  icon: Icon,
  title,
  description,
  linkLabel,
  linkHref,
  comingSoon,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  linkLabel?: string;
  linkHref?: string;
  comingSoon?: boolean;
}) {
  return (
    <BosDurum icon={Icon} title={title} text={description}>
      {comingSoon && (
        <span className="mt-3 rounded-md px-2 py-0.5 text-[11.5px] font-medium" style={{ border: `1px solid ${LINE}`, color: MUTED }}>Yakında</span>
      )}
      {linkLabel && linkHref && (
        <div className="mt-4">
          <BaglantiDugme href={linkHref}>{linkLabel} <ChevronRight size={13} /></BaglantiDugme>
        </div>
      )}
    </BosDurum>
  );
}
