'use client';

import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { RENK, hapStili, kartArkaPlan, seritStili } from './ortak';

/**
 * Ortak kart dili — koyu gradyan zemin + ince kenar; isteğe bağlı 4px renk şeridi ve hover kaldırma (translateY(-1px) + kenar parlaması, 150ms).
 * Yapışkan/fixed YOK. Düz gri kutu YOK.
 */
export const Kart = forwardRef<
  HTMLElement,
  {
    renk: string;
    secili?: boolean;
    serit?: boolean;
    hover?: boolean;
    className?: string;
    style?: CSSProperties;
    children: ReactNode;
    id?: string;
  }
>(function Kart({ renk, secili = false, serit = false, hover = false, className = '', style, children, id }, ref) {
  const taban = kartArkaPlan(renk, secili);
  return (
    <section
      ref={ref}
      id={id}
      className={`relative min-w-0 overflow-hidden rounded-2xl border [border-color:var(--k-kenar)] transition-[transform,border-color] duration-150 ${
        hover ? 'hover:-translate-y-px hover:[border-color:var(--k-kenar-hover)]' : ''
      } ${className}`}
      style={{
        ...taban,
        // kenar rengi sınıftan (hover sınıfı inline stili ezemez) → değişken üzerinden
        border: undefined,
        ['--k-kenar' as string]: secili ? `${renk}66` : 'rgba(255,255,255,0.08)',
        ['--k-kenar-hover' as string]: `${renk}66`,
        ...style,
      }}
    >
      {serit && <div className="h-1 w-full" style={seritStili(renk)} />}
      {children}
    </section>
  );
});

/** Boş durum: ikon + tek cümle, ortalanmış, 40px dikey boşluk. */
export function BosDurum({ ikon, metin, renk = RENK.ikincil, ek }: { ikon: ReactNode; metin: ReactNode; renk?: string; ek?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: `${renk}14`, color: renk }}>
        {ikon}
      </span>
      <span className="text-[13px]" style={{ color: RENK.ikincil }}>
        {metin}
      </span>
      {ek}
    </div>
  );
}

/** Küçük hap rozet — 11px; `dolu` gradyan, değilse ince kenar. Tıklanabilirse düğme. */
export function Hap({
  renk,
  dolu = false,
  children,
  onClick,
  title,
  className = '',
}: {
  renk: string;
  dolu?: boolean;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  const stil = hapStili(renk, dolu);
  const sinif = `inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-semibold leading-4 ${className}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={`${sinif} transition-[transform,filter] duration-150 hover:-translate-y-px hover:brightness-125`} style={stil}>
        {children}
      </button>
    );
  }
  return (
    <span title={title} className={sinif} style={stil}>
      {children}
    </span>
  );
}
