'use client';

import { forwardRef, type CSSProperties, type ReactNode } from 'react';

/**
 * EKİP v5 — "premium komuta merkezi" tasarım dili (Muzaffer Bey 2026-09-15: "çok profesyonel bir arayüz istiyorum";
 * onaylanan görsel: _previews/ekip-v5/ekip-v5.html). Yalnız Ekip ekranı kullanır; Kart.tsx (v3) diğer sayfalar için duruyor.
 *
 * Dil: cam yüzeyli kartlar (saydam gradyan + ince ışıklı kenar + derin gölge + köşede kartın kendi renginde ışık),
 * gradyanlı avatarlar, parlayan durum noktaları, kapsül rozetler, altın parlayan ana düğme, tek genişlikli rakamlar.
 * Renk aileleri: altın = görev/ana eylem · mavi = çalışan iş · mor = kadro · bordo = sizden beklenen · yeşil = özet/bitti.
 */
export const V5 = {
  metin: '#eef2f8',
  ikincil: '#a9b4c7',
  soluk: '#6c7a92',
  altin: '#e3c26f',
  altinKoyu: '#b8933f',
  mavi: '#6ea3ff',
  maviKoyu: '#3b6fd6',
  mint: '#3fd39a',
  coral: '#ff6b7a',
  mor: '#a78bfa',
  amber: '#f2b64d',
  cyan: '#4dd6e6',
  cizgi: 'rgba(255,255,255,0.09)',
  cizgi2: 'rgba(255,255,255,0.14)',
  cukur: 'rgba(0,0,0,0.32)',
  cam: 'rgba(255,255,255,0.045)',
  mono: "'JetBrains Mono', 'Roboto Mono', monospace",
} as const;

export type Ton = 'altin' | 'mavi' | 'mor' | 'mint' | 'coral' | 'cyan' | 'notr';

export const TON_RENGI: Record<Ton, string> = {
  altin: V5.altin,
  mavi: V5.mavi,
  mor: V5.mor,
  mint: V5.mint,
  coral: V5.coral,
  cyan: V5.cyan,
  notr: V5.ikincil,
};

const TON_ISIGI: Record<Ton, string> = {
  altin: 'rgba(227,194,111,0.20)',
  mavi: 'rgba(110,163,255,0.22)',
  mor: 'rgba(167,139,250,0.20)',
  mint: 'rgba(63,211,154,0.16)',
  coral: 'rgba(255,107,122,0.18)',
  cyan: 'rgba(77,214,230,0.16)',
  notr: 'rgba(169,180,199,0.10)',
};

/** Kart içi koyu "çukur" alan (giriş kutusu, tablo zemini). */
export function cukur(ek?: CSSProperties): CSSProperties {
  return { background: V5.cukur, border: `1px solid ${V5.cizgi2}`, borderRadius: 14, ...ek };
}

/** Kart içi açık cam blok (satır, kutu). */
export function camBlok(ek?: CSSProperties): CSSProperties {
  return { background: 'rgba(255,255,255,0.035)', border: `1px solid ${V5.cizgi}`, borderRadius: 12, ...ek };
}

/** Bölüm etiketi: "— GÖREV MERKEZİ" (küçük, aralıklı, tonun renginde çizgi). */
export function Etiket({ ton = 'altin', children, className = '' }: { ton?: Ton; children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] ${className}`} style={{ color: V5.soluk }}>
      <i className="inline-block h-[2px] w-[18px] rounded-sm" style={{ background: TON_RENGI[ton] }} />
      {children}
    </div>
  );
}

/** Simge kutusu (başlık yanı). */
export function IkonKutu({ ton = 'altin', children, boyut = 34 }: { ton?: Ton; children: ReactNode; boyut?: number }) {
  return (
    <span className="flex flex-shrink-0 items-center justify-center rounded-[10px]" style={{ width: boyut, height: boyut, background: 'rgba(255,255,255,0.06)', border: `1px solid ${V5.cizgi}`, color: TON_RENGI[ton], boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
      {children}
    </span>
  );
}

/**
 * Cam kart — v5 yüzeyi. `etiket` + `baslik` (+ `ikon`) başlık satırı; `sag` sağ alan; `dolguYok` gövde dolgusunu kaldırır.
 */
export const CamKart = forwardRef<
  HTMLElement,
  {
    ton?: Ton;
    etiket?: ReactNode;
    baslik?: ReactNode;
    ikon?: ReactNode;
    sag?: ReactNode;
    dolguYok?: boolean;
    className?: string;
    style?: CSSProperties;
    id?: string;
    children: ReactNode;
  }
>(function CamKart({ ton = 'notr', etiket, baslik, ikon, sag, dolguYok = false, className = '', style, id, children }, ref) {
  return (
    <section
      ref={ref}
      id={id}
      className={`relative min-w-0 overflow-hidden rounded-2xl ${className}`}
      style={{
        background: 'linear-gradient(160deg, rgba(255,255,255,0.065), rgba(255,255,255,0.025))',
        border: `1px solid ${V5.cizgi}`,
        boxShadow: '0 24px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.07)',
        backdropFilter: 'blur(14px)',
        ...style,
      }}
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(600px 220px at 0% 0%, ${TON_ISIGI[ton]}, transparent 70%)` }} />
      {(etiket || baslik) && (
        <header className="relative flex flex-wrap items-center justify-between gap-3 px-5 pb-3.5 pt-[18px]">
          <div className="min-w-0">
            {etiket && <Etiket ton={ton} className="mb-1">{etiket}</Etiket>}
            {baslik && (
              <h2 className="flex min-w-0 items-center gap-2.5 text-[16px] font-bold" style={{ color: V5.metin, fontFamily: "var(--font-body, 'Inter'), system-ui, sans-serif" }}>
                {ikon && <IkonKutu ton={ton}>{ikon}</IkonKutu>}
                <span className="min-w-0">{baslik}</span>
              </h2>
            )}
          </div>
          {sag && <div className="flex min-w-0 flex-wrap items-center gap-2">{sag}</div>}
        </header>
      )}
      <div className={`relative ${dolguYok ? '' : etiket || baslik ? 'px-5 pb-5' : 'p-5'}`}>{children}</div>
    </section>
  );
});

export type KapsulTuru = 'canli' | 'kuru' | 'calisiyor' | 'bitti' | 'karar' | 'hata' | 'notr' | 'mor';

const KAPSUL: Record<KapsulTuru, { renk: string; zemin: string; kenar: string }> = {
  canli: { renk: '#ff8a96', zemin: 'rgba(255,107,122,0.12)', kenar: 'rgba(255,107,122,0.5)' },
  kuru: { renk: '#a9b4c7', zemin: 'rgba(255,255,255,0.04)', kenar: 'rgba(255,255,255,0.14)' },
  calisiyor: { renk: '#9cc0ff', zemin: 'rgba(110,163,255,0.12)', kenar: 'rgba(110,163,255,0.5)' },
  bitti: { renk: '#79e6b8', zemin: 'rgba(63,211,154,0.12)', kenar: 'rgba(63,211,154,0.5)' },
  karar: { renk: '#ffd27a', zemin: 'rgba(242,182,77,0.12)', kenar: 'rgba(242,182,77,0.5)' },
  hata: { renk: '#ff8a96', zemin: 'rgba(255,107,122,0.10)', kenar: 'rgba(255,107,122,0.45)' },
  notr: { renk: '#a9b4c7', zemin: 'rgba(255,255,255,0.04)', kenar: 'rgba(255,255,255,0.14)' },
  mor: { renk: '#c4b5fd', zemin: 'rgba(167,139,250,0.12)', kenar: 'rgba(167,139,250,0.5)' },
};

/** Kapsül rozet — durum/mod; `nokta` parlayan nokta, `nabiz` yanıp söner. */
export function Kapsul({ tur = 'notr', nokta = false, nabiz = false, children, title, className = '' }: { tur?: KapsulTuru; nokta?: boolean; nabiz?: boolean; children: ReactNode; title?: string; className?: string }) {
  const k = KAPSUL[tur];
  return (
    <span className={`inline-flex h-6 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-bold tracking-wide ${className}`} style={{ color: k.renk, background: k.zemin, border: `1px solid ${k.kenar}` }} title={title}>
      {nokta && <span className={`inline-block h-1.5 w-1.5 rounded-full ${nabiz ? 'animate-pulse' : ''}`} style={{ background: 'currentColor', boxShadow: '0 0 8px currentColor' }} />}
      {children}
    </span>
  );
}

/** Durum sözü: parlayan nokta + kelime (tablo hücresi). */
export function DurumSozu({ renk, nabiz = false, children, className = '' }: { renk: string; nabiz?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[7px] whitespace-nowrap text-[12.3px] font-bold ${className}`} style={{ color: renk }}>
      <span className={`inline-block h-[7px] w-[7px] rounded-full ${nabiz ? 'animate-pulse' : ''}`} style={{ background: 'currentColor', boxShadow: '0 0 8px currentColor' }} />
      {children}
    </span>
  );
}

export type DugTuru = 'altin' | 'mavi' | 'cam' | 'hayalet' | 'tehlike' | 'mint';

/** Düğme — altın (ana), mavi (onay), cam (ikincil), hayalet, tehlike, mint. */
export const Dug = forwardRef<
  HTMLButtonElement,
  {
    tur?: DugTuru;
    kucuk?: boolean;
    buyuk?: boolean;
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    className?: string;
  } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'title' | 'className' | 'disabled' | 'children'>
>(function Dug({ tur = 'cam', kucuk = false, buyuk = false, children, onClick, disabled, title, className = '', ...rest }, ref) {
  const stil: CSSProperties =
    tur === 'altin'
      ? { background: 'linear-gradient(180deg, #f0d78f 0%, #d4ad4f 100%)', border: '1px solid #b8933f', color: '#1b1607', boxShadow: '0 10px 26px rgba(227,194,111,0.28), inset 0 1px 0 rgba(255,255,255,0.5)' }
      : tur === 'mavi'
        ? { background: 'linear-gradient(180deg, #4f86ea, #3163c9)', border: '1px solid #2f5cb8', color: '#fff', boxShadow: '0 8px 22px rgba(110,163,255,0.28), inset 0 1px 0 rgba(255,255,255,0.2)' }
        : tur === 'tehlike'
          ? { background: 'rgba(255,107,122,0.12)', border: '1px solid rgba(255,107,122,0.5)', color: '#ff8a96' }
          : tur === 'mint'
            ? { background: 'rgba(63,211,154,0.12)', border: '1px solid rgba(63,211,154,0.5)', color: '#79e6b8' }
            : tur === 'hayalet'
              ? { background: 'transparent', border: `1px solid ${V5.cizgi}`, color: V5.ikincil }
              : { background: 'rgba(255,255,255,0.05)', border: `1px solid ${V5.cizgi2}`, color: V5.metin, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' };
  const boy = kucuk ? 'h-8 px-3 text-[12.5px] rounded-[9px]' : buyuk ? 'h-[42px] px-6 text-[14px] rounded-xl' : 'h-[38px] px-[18px] text-[13px] rounded-[11px]';
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex flex-shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[transform,filter,opacity] duration-150 hover:-translate-y-px hover:brightness-110 disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:brightness-100 ${boy} ${tur === 'altin' ? 'font-bold' : ''} ${className}`}
      style={stil}
      {...rest}
    >
      {children}
    </button>
  );
});

export type AvatarTonu = 'altin' | 'mavi' | 'mor' | 'gri' | 'coral';

const AVATAR: Record<AvatarTonu, { bg: string; halka: string }> = {
  altin: { bg: 'linear-gradient(145deg, #8b6b2a, #d9b45f)', halka: 'rgba(227,194,111,0.25)' },
  mavi: { bg: 'linear-gradient(145deg, #2f5cb8, #6ea3ff)', halka: 'rgba(110,163,255,0.25)' },
  mor: { bg: 'linear-gradient(145deg, #5b3fb0, #a78bfa)', halka: 'rgba(167,139,250,0.25)' },
  gri: { bg: 'linear-gradient(145deg, #3a4557, #5b6b85)', halka: 'rgba(255,255,255,0.06)' },
  coral: { bg: 'linear-gradient(145deg, #b03c4a, #ff6b7a)', halka: 'rgba(255,107,122,0.25)' },
};

/** Gradyanlı avatar; `nokta` sağ altta yeşil canlı noktası; `kare` köşeli (zaman çizgisi). */
export function AvatarV5({ kisaltma, ton = 'gri', boyut = 40, nokta = false, kare = false, nabiz = false, title }: { kisaltma: string; ton?: AvatarTonu; boyut?: number; nokta?: boolean; kare?: boolean; nabiz?: boolean; title?: string }) {
  const a = AVATAR[ton];
  return (
    <span
      className={`relative flex flex-shrink-0 items-center justify-center font-extrabold uppercase tracking-wider text-white ${nabiz ? 'animate-pulse' : ''}`}
      style={{ width: boyut, height: boyut, borderRadius: kare ? Math.round(boyut * 0.3) : '50%', fontSize: Math.max(9, Math.round(boyut * 0.29)), background: a.bg, boxShadow: `0 0 0 ${kare ? 2 : 3}px ${a.halka}, 0 8px 20px rgba(0,0,0,0.4)` }}
      title={title}
    >
      {kisaltma}
      {nokta && <span className="absolute -bottom-px -right-px h-3 w-3 rounded-full" style={{ background: V5.mint, border: '2px solid #12151f', boxShadow: `0 0 10px ${V5.mint}` }} />}
    </span>
  );
}

/** İlerleme halkası (yüzde). */
export function Halka({ yuzde, renk = V5.mavi, etiket, boyut = 74 }: { yuzde: number; renk?: string; etiket?: string; boyut?: number }) {
  const r = 31;
  const c = 2 * Math.PI * r;
  const y = Math.max(0, Math.min(100, Math.round(yuzde)));
  return (
    <span className="relative inline-block flex-shrink-0" style={{ width: boyut, height: boyut }}>
      <svg viewBox="0 0 74 74" width={boyut} height={boyut} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="37" cy="37" r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="7" fill="none" />
        <circle cx="37" cy="37" r={r} stroke={renk} strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - y / 100)} style={{ filter: `drop-shadow(0 0 6px ${renk})`, transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center font-bold leading-none" style={{ fontFamily: V5.mono, fontSize: Math.round(boyut * 0.2), color: V5.metin }}>
        {y}%
        {etiket && (
          <small className="mt-0.5 font-semibold uppercase" style={{ fontSize: 8, letterSpacing: '0.06em', color: V5.soluk }}>
            {etiket}
          </small>
        )}
      </span>
    </span>
  );
}

/** Segment anahtarı (Kuru test / Canlı · Bugün / 7 gün / 30 gün). */
export function Anahtar<T extends string | number>({ secenekler, deger, onChange, kucuk = false, title }: { secenekler: Array<{ id: T; etiket: ReactNode; tehlike?: boolean; title?: string }>; deger: T; onChange: (id: T) => void; kucuk?: boolean; title?: string }) {
  return (
    <span className={`inline-flex flex-shrink-0 gap-[3px] rounded-[10px] p-[3px] ${kucuk ? 'h-8' : 'h-8'}`} style={{ background: 'rgba(0,0,0,0.35)', border: `1px solid ${V5.cizgi2}` }} title={title} role="tablist">
      {secenekler.map((s) => {
        const secili = s.id === deger;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={secili}
            onClick={() => onChange(s.id)}
            title={s.title}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors duration-150`}
            style={secili ? { background: s.tehlike ? 'linear-gradient(180deg, rgba(255,107,122,0.4), rgba(255,107,122,0.18))' : 'linear-gradient(180deg, rgba(110,163,255,0.35), rgba(110,163,255,0.15))', color: '#fff', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)' } : { background: 'transparent', color: V5.soluk }}
          >
            {s.etiket}
          </button>
        );
      })}
    </span>
  );
}

/** Küçük metrik kutusu: büyük sayı + etiket. */
export function MetrikKutu({ deger, etiket, renk, ortala = false, title }: { deger: ReactNode; etiket: string; renk?: string; ortala?: boolean; title?: string }) {
  return (
    <div className={`rounded-[10px] px-2.5 py-2 ${ortala ? 'text-center' : ''}`} style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${V5.cizgi}` }} title={title}>
      <b className="block text-[17px] font-extrabold leading-tight" style={{ fontFamily: V5.mono, color: renk || V5.metin }}>
        {deger}
      </b>
      <span className="text-[10.5px] uppercase tracking-[0.08em]" style={{ color: V5.soluk }}>
        {etiket}
      </span>
    </div>
  );
}

/** İnce yük çubuğu (0–100). */
export function Yuk({ yuzde, renk = V5.mavi, className = '' }: { yuzde: number; renk?: string; className?: string }) {
  return (
    <span className={`block h-1 w-full overflow-hidden rounded-full ${className}`} style={{ background: 'rgba(255,255,255,0.07)' }}>
      <i className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, yuzde))}%`, background: `linear-gradient(90deg, ${V5.maviKoyu}, ${renk})` }} />
    </span>
  );
}

/** Klavye tuşu görünümü. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[5px] px-1.5 py-px text-[11px]" style={{ fontFamily: V5.mono, border: `1px solid ${V5.cizgi2}`, borderBottomWidth: 2, color: V5.ikincil, background: 'rgba(0,0,0,0.3)' }}>
      {children}
    </kbd>
  );
}
