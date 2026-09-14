'use client';

import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { SAKIN, sakinKart } from './ortak';

/**
 * Ortak kart dili — SAKİN (PLAN/19 §A.2, 2026-09-14): düz koyu zemin + 1px kılcal kenar, 12px köşe.
 * Gradyan, parıltı, gölge, hover kaldırma YOK. `serit` → üstte 1px çelik mavi çizgi (portal dilinden tek iz).
 * Yapışkan/fixed YOK. `renk` geriye uyumluluk için kalır (yalnız `secili` kenarında ve şeritte kullanılır).
 */
export const Kart = forwardRef<
  HTMLElement,
  {
    renk?: string;
    secili?: boolean;
    serit?: boolean;
    hover?: boolean;
    className?: string;
    style?: CSSProperties;
    children: ReactNode;
    id?: string;
  }
>(function Kart({ renk = SAKIN.vurgu, secili = false, serit = false, className = '', style, children, id }, ref) {
  return (
    <section
      ref={ref}
      id={id}
      className={`relative min-w-0 overflow-hidden ${className}`}
      style={{ ...sakinKart(secili), ...(secili ? { borderColor: `${renk}66` } : {}), ...style }}
    >
      {serit && <div className="h-px w-full" style={{ background: `${renk}99` }} />}
      {children}
    </section>
  );
});

/** Boş durum: ikon + tek cümle, ortalanmış, 40px dikey boşluk. */
export function BosDurum({ ikon, metin, renk = SAKIN.ikincil, ek }: { ikon: ReactNode; metin: ReactNode; renk?: string; ek?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: SAKIN.zeminAcik, color: renk }}>
        {ikon}
      </span>
      <span className="text-[13px]" style={{ color: SAKIN.ikincil }}>
        {metin}
      </span>
      {ek}
    </div>
  );
}

/**
 * Küçük hap rozet — sakin: kılcal kenar, renk yalnız yazıda; `dolu` → hafif renkli zemin.
 * Tıklanabilirse düğme (altı çizili değil, kenarlı).
 */
export function Hap({
  renk = SAKIN.ikincil,
  dolu = false,
  children,
  onClick,
  title,
  className = '',
}: {
  renk?: string;
  dolu?: boolean;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  const stil: CSSProperties = dolu
    ? { background: `${renk}1f`, border: `1px solid ${renk}66`, color: renk }
    : { background: 'transparent', border: `1px solid ${SAKIN.cizgi}`, color: renk };
  const sinif = `inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-semibold leading-4 ${className}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={`${sinif} transition-[border-color] duration-150 hover:[border-color:rgba(255,255,255,0.22)]`} style={stil}>
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

/** Durum kelimesi + 6px nokta (sakin dilde tek durum göstergesi). */
export function DurumKelimesi({ renk, nabiz = false, children, title }: { renk: string; nabiz?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold" style={{ color: renk }} title={title}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${nabiz ? 'animate-pulse' : ''}`} style={{ background: renk, boxShadow: nabiz ? `0 0 0 3px ${renk}33` : 'none' }} />
      {children}
    </span>
  );
}
