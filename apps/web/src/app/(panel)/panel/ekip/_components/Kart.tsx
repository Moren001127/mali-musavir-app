'use client';
import { portalStyle } from '@/lib/portal-theme';


import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { TEMA } from './ortak';

/**
 * YÜZEY TONLARI (Muzaffer Bey 2026-09-15: "her şey simsiyah, bölümlerin arka planı ayırt edici olsun"):
 * her bölümün kartı sayfadan (#050505) belirgin biçimde açık ve kendi tonunda; iç bloklar bir kademe daha açık.
 */
export const YUZEY = {
  notr: 'linear-gradient(160deg, #202127 0%, #141519 100%)',
  mavi: 'linear-gradient(160deg, #1b2533 0%, #11181f 100%)',
  altin: 'linear-gradient(160deg, #2b2518 0%, #1a1711 100%)',
  yesil: 'linear-gradient(160deg, #182b22 0%, #101b15 100%)',
  kirmizi: 'linear-gradient(160deg, #2d1a1e 0%, #1a1013 100%)',
  mor: 'linear-gradient(160deg, #252030 0%, #17131e 100%)',
  /** kart içi açık blok (adımlar, sonuç, aşama çubuğu) */
  ic: 'rgba(255,255,255,0.055)',
  icKenar: 'rgba(255,255,255,0.10)',
  /** giriş alanı — kartın içinde koyu çukur */
  cukur: 'rgba(0,0,0,0.32)',
  kenar: 'rgba(255,255,255,0.09)',
} as const;
export type YuzeyTonu = 'notr' | 'mavi' | 'altin' | 'yesil' | 'kirmizi' | 'mor';

/** Kart içi açık blok stili (başlıklı alt bölüm). */
export function icBlok(ek?: CSSProperties): CSSProperties {
  return { background: YUZEY.ic, border: `1px solid ${YUZEY.icKenar}`, borderRadius: 12, ...ek };
}

/**
 * Kart dili v3 — Bütçe/Cari Kasa'da beğenilen kalıp (2026-09-14 gece, baştan tasarım):
 * koyu kart + üstte ince renk çizgisi + sağ üstte hafif parıltı + yumuşak gölge; başlık/açıklama/sağ alan.
 * Yapışkan/fixed YOK. Renk yalnız çizgi ve parıltıda; gövde nötr.
 */
export const Kart = forwardRef<
  HTMLElement,
  {
    renk?: string;
    baslik?: ReactNode;
    aciklama?: ReactNode;
    sag?: ReactNode;
    /** Başlık altı içerik dolgusunu kaldırır (tablo/liste kartları). */
    dolguYok?: boolean;
    /** Yüzey tonu (bölüm rengi). */
    ton?: YuzeyTonu;
    /** Geriye uyumluluk (e-Defter, Görevler): üstte 3px renk şeridi. */
    serit?: boolean;
    /** Geriye uyumluluk: seçili kenar. */
    secili?: boolean;
    hover?: boolean;
    className?: string;
    style?: CSSProperties;
    children: ReactNode;
    id?: string;
  }
>(function Kart({ renk = TEMA.mavi, ton = 'notr', baslik, aciklama, sag, dolguYok = false, serit = false, secili = false, className = '', style, children, id }, ref) {
  return (
    <section
      ref={ref}
      id={id}
      className={`relative min-w-0 overflow-hidden rounded-2xl ${className}`}
      style={portalStyle({ background: YUZEY[ton], border: `1px solid ${secili ? `${renk}66` : YUZEY.kenar}`, boxShadow: '0 18px 44px rgba(0,0,0,0.30)', ...style })}
    >
      {serit ? (
        <div className="h-[3px] w-full" style={portalStyle({ background: `linear-gradient(90deg, ${renk}, ${renk}55 55%, transparent)` })} />
      ) : (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={portalStyle({ background: `linear-gradient(90deg, transparent, ${renk}66, transparent)` })} />
      )}
      <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full opacity-[0.14]" style={portalStyle({ background: `radial-gradient(circle, ${renk}, transparent 68%)` })} />
      {baslik && (
        <header className="relative flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h3 className="text-[13.5px] font-semibold tracking-wide" style={portalStyle({ color: TEMA.metin })}>
              {baslik}
            </h3>
            {aciklama && (
              <p className="mt-0.5 text-[11.5px]" style={portalStyle({ color: TEMA.ikincil })}>
                {aciklama}
              </p>
            )}
          </div>
          {sag && <div className="flex min-w-0 flex-shrink-0 items-center gap-2">{sag}</div>}
        </header>
      )}
      <div className={`relative ${dolguYok ? '' : baslik ? 'px-5 pb-5' : 'p-5'}`}>{children}</div>
    </section>
  );
});

/** Sayaç kutusu — etiket + büyük sayı + alt bilgi; `vurgu` renkli gradyan zemin. */
export function KPI({ etiket, deger, altBilgi, renk = TEMA.mavi, ikon, vurgu = false, onClick, title }: { etiket: string; deger: string | number; altBilgi?: string; renk?: string; ikon?: ReactNode; vurgu?: boolean; onClick?: () => void; title?: string }) {
  const icerik = (
    <>
      <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-[0.16]" style={portalStyle({ background: `radial-gradient(circle, ${renk}, transparent 68%)` })} />
      <div className="flex items-center gap-1.5">
        {ikon && <span style={portalStyle({ color: renk })}>{ikon}</span>}
        <span className="text-[10.5px] uppercase tracking-wider" style={portalStyle({ color: TEMA.soluk })}>
          {etiket}
        </span>
      </div>
      <div className="mt-1 text-[22px] font-semibold leading-none tabular-nums" style={portalStyle({ color: vurgu ? renk : TEMA.metin })}>
        {deger}
      </div>
      {altBilgi && (
        <div className="mt-1 truncate text-[11px]" style={portalStyle({ color: TEMA.ikincil })}>
          {altBilgi}
        </div>
      )}
    </>
  );
  const stil: CSSProperties = {
    background: vurgu ? `linear-gradient(140deg, ${renk}2e, #1a1b21 65%)` : YUZEY.notr,
    border: `1px solid ${vurgu ? `${renk}55` : YUZEY.kenar}`,
    boxShadow: '0 14px 32px rgba(0,0,0,0.26)',
  };
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className="relative min-w-0 overflow-hidden rounded-2xl px-4 py-3 text-left transition-[transform] duration-150 hover:-translate-y-px" style={portalStyle(stil)}>
        {icerik}
      </button>
    );
  }
  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl px-4 py-3" style={portalStyle(stil)} title={title}>
      {icerik}
    </div>
  );
}

/** Rozet — küçük yuvarlak etiket. */
export function Rozet({ children, renk = TEMA.altin, title }: { children: ReactNode; renk?: string; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={portalStyle({ background: `${renk}1f`, border: `1px solid ${renk}44`, color: renk })} title={title}>
      {children}
    </span>
  );
}

/** Düğme — birincil (altın dolu), ikincil (kenarlı), tehlike (kırmızı), sessiz (metin), yesil (onay). */
export const Dugme = forwardRef<
  HTMLButtonElement,
  {
    tur?: 'birincil' | 'ikincil' | 'tehlike' | 'sessiz' | 'yesil';
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    className?: string;
    buyuk?: boolean;
  } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'title' | 'className' | 'disabled' | 'children'>
>(function Dugme({ tur = 'ikincil', children, onClick, disabled, title, className = '', buyuk = false, ...rest }, ref) {
  const stil: CSSProperties =
    tur === 'birincil'
      ? { background: `linear-gradient(135deg, ${TEMA.altin}, ${TEMA.altinSoft})`, border: '1px solid transparent', color: '#1a1410' }
      : tur === 'yesil'
        ? { background: `${TEMA.yesil}22`, border: `1px solid ${TEMA.yesil}66`, color: TEMA.yesil }
        : tur === 'tehlike'
          ? { background: `${TEMA.kirmizi}1a`, border: `1px solid ${TEMA.kirmizi}66`, color: TEMA.kirmizi }
          : tur === 'sessiz'
            ? { background: 'transparent', border: '1px solid transparent', color: TEMA.ikincil }
            : { background: 'rgba(255,255,255,0.04)', border: `1px solid ${TEMA.alanKenar}`, color: TEMA.metin };
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-[transform,filter,opacity] duration-150 hover:-translate-y-px hover:brightness-110 disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:brightness-100 ${buyuk ? 'px-4 py-2 text-[13px]' : 'px-3 py-1.5 text-[12px]'} ${className}`}
      style={portalStyle(stil)}
      {...rest}
    >
      {children}
    </button>
  );
});

/** Boş durum: ikon + tek cümle, ortalanmış. */
export function BosDurum({ ikon, metin, renk = TEMA.mavi, ek }: { ikon: ReactNode; metin: ReactNode; renk?: string; ek?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full" style={portalStyle({ background: `${renk}14`, color: renk })}>
        {ikon}
      </span>
      <span className="text-[13px]" style={portalStyle({ color: TEMA.ikincil })}>
        {metin}
      </span>
      {ek}
    </div>
  );
}

/** Durum kelimesi + nokta. */
export function DurumKelimesi({ renk, nabiz = false, children, title }: { renk: string; nabiz?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold" style={portalStyle({ color: renk })} title={title}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${nabiz ? 'animate-pulse' : ''}`} style={portalStyle({ background: renk, boxShadow: nabiz ? `0 0 0 3px ${renk}33` : 'none' })} />
      {children}
    </span>
  );
}

/** Personel avatarı (2 harf) — nötr; çalışıyor: mavi halka; hata: kırmızı; siz: altın. */
export function Avatar({ kisaltma, boyut = 32, durum = 'bos', title }: { kisaltma: string; boyut?: 24 | 28 | 32 | 40; durum?: 'bos' | 'calisiyor' | 'hata' | 'siz'; title?: string }) {
  const renk = durum === 'calisiyor' ? TEMA.mavi : durum === 'hata' ? TEMA.kirmizi : durum === 'siz' ? TEMA.altin : 'rgba(255,255,255,0.16)';
  const px = boyut === 24 ? 'h-6 w-6 text-[9px]' : boyut === 28 ? 'h-7 w-7 text-[9.5px]' : boyut === 40 ? 'h-10 w-10 text-[12px]' : 'h-8 w-8 text-[10.5px]';
  return (
    <span
      className={`flex ${px} flex-shrink-0 items-center justify-center rounded-full font-bold tracking-wide`}
      style={portalStyle({
        background: durum === 'bos' ? 'rgba(255,255,255,0.08)' : `${renk}22`,
        border: `1px solid ${renk}`,
        color: durum === 'bos' ? TEMA.ikincil : renk,
        boxShadow: durum === 'calisiyor' ? `0 0 0 3px ${renk}22` : 'none',
      })}
      title={title}
    >
      {kisaltma}
    </span>
  );
}

/** Küçük hap rozet (geriye uyumluluk: e-Defter sayfası) — `dolu` renkli zemin, değilse ince kenar; tıklanabilirse düğme. */
export function Hap({ renk = TEMA.ikincil, dolu = false, children, onClick, title, className = '' }: { renk?: string; dolu?: boolean; children: ReactNode; onClick?: () => void; title?: string; className?: string }) {
  const stil: CSSProperties = dolu ? { background: `${renk}22`, border: `1px solid ${renk}66`, color: renk } : { background: `${renk}12`, border: `1px solid ${renk}3d`, color: renk };
  const sinif = `inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-semibold leading-4 ${className}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={`${sinif} transition-[filter] duration-150 hover:brightness-125`} style={portalStyle(stil)}>
        {children}
      </button>
    );
  }
  return (
    <span title={title} className={sinif} style={portalStyle(stil)}>
      {children}
    </span>
  );
}
