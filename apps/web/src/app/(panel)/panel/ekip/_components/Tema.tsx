'use client';
import { portalStyle } from '@/lib/portal-theme';


import type { ReactNode, ComponentProps } from 'react';
import { Dugme as TemelDugme } from '../../butce/ui';
import { CARD_BORDER, GOLD, KIRMIZI, MAVI, MOR, MUTED, OK, TEXT, TURUNCU } from '../../butce/ui';

/**
 * EKİP — küçük ortak parçalar.
 * Koyu tema (A): renkler `../../butce/ui` paletinden satır içi gelir (GOLD/OK/KIRMIZI/MAVI/MOR).
 * Beyaz tema (D): her parça `data-ton` kancası taşır; renkler `ekip-white.css`'te (bilgi/BEYAZ-TEMA-TASARIM-DILI.md ailesi).
 * Renk yalnız anlam taşır: çivit = sürüyor/birincil · kehribar = bekleyen · yeşil = bitti · kırmızı = yarım/tehlike · kurşuni = nötr.
 */
export { GOLD, OK, KIRMIZI, MAVI, MOR, TURUNCU, TEXT, MUTED, CARD_BG, CARD_BORDER, ROW_SEP } from '../../butce/ui';

/** Beyaz rehberin ton aileleri. */
export type Ton = 'civit' | 'mavi' | 'deniz' | 'yesil' | 'kehribar' | 'sari' | 'kirmizi' | 'mor' | 'gul' | 'kursuni';

/** Koyu palet rengi → ton ailesi (eski `renk` alan çağrılar için). */
export function renkTonu(renk?: string): Ton {
  switch (renk) {
    case GOLD:
      return 'kehribar';
    case OK:
      return 'yesil';
    case KIRMIZI:
      return 'kirmizi';
    case MAVI:
      return 'civit';
    case MOR:
      return 'mor';
    case TURUNCU:
      return 'kehribar';
    default:
      return 'kursuni';
  }
}

/** Personel → ton ailesi (Kadro kartı ve liste avatarları; yumuşak kutu, rol ayrımı için). */
export const AJAN_TON: Record<string, Ton> = {
  koordinator: 'civit',
  fatura: 'mavi',
  'banka-kasa': 'yesil',
  beyanname: 'mor',
  'bordro-sgk': 'deniz',
  edefter: 'yesil',
  'luca-operator': 'kursuni',
  denetci: 'kehribar',
  analist: 'gul',
  mevzuat: 'sari',
  risk: 'kirmizi',
  musteri: 'deniz',
};
export function ajanTonu(id: string): Ton {
  return AJAN_TON[id] || 'kursuni';
}

/** Koyu tema kadro renkleri (A): her personelin kendi tonu. */
export const AJAN_RENK: Record<string, string> = {
  koordinator: GOLD,
  fatura: TURUNCU,
  'banka-kasa': OK,
  beyanname: MAVI,
  'bordro-sgk': MOR,
  edefter: '#72cdbd',
  'luca-operator': '#9da8b7',
  denetci: '#d59bd9',
  analist: '#a9c98c',
  mevzuat: '#94a8ec',
  risk: '#f09aa8',
  musteri: '#e8a98a',
};
export function ajanRengi(id: string): string {
  return AJAN_RENK[id] || '#9da8b7';
}

export function Dugme(props: ComponentProps<typeof TemelDugme>) {
  return <TemelDugme {...props} className={`ekip-button ekip-button--${props.tur || 'ikincil'} ${props.className || ''}`} />;
}

export type AvatarTonu = 'gold' | 'mavi' | 'gri' | 'kirmizi';

const AVATAR_RENK: Record<AvatarTonu, string> = { gold: GOLD, mavi: MAVI, gri: MUTED, kirmizi: KIRMIZI };

/**
 * Personel avatarı: iki harf. Koyu temada daire; beyaz temada yumuşak tonlu kutu (rehber: avatar kutusu 36–40px).
 * Ton önceliği: kırmızı (hata) > mavi/çivit (çalışıyor) > personelin kendi ailesi (`ajanId`) > altın/kehribar > kurşuni.
 */
export function Avatar({ kisaltma, ton = 'gri', renk: ozelRenk, ajanId, boyut = 28, nabiz = false, title }: { kisaltma: string; ton?: AvatarTonu; renk?: string; ajanId?: string; boyut?: number; nabiz?: boolean; title?: string }) {
  const renk = ozelRenk || AVATAR_RENK[ton];
  const vurgulu = !!ozelRenk || ton !== 'gri';
  const aile: Ton = ton === 'kirmizi' ? 'kirmizi' : ton === 'mavi' ? 'civit' : ajanId ? ajanTonu(ajanId) : ton === 'gold' ? 'kehribar' : 'kursuni';
  return (
    <span
      title={title}
      data-ekip-avatar
      data-ton={aile}
      data-nabiz={nabiz || undefined}
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full font-bold ${nabiz ? 'animate-pulse' : ''}`}
      style={portalStyle({
        width: boyut,
        height: boyut,
        fontSize: Math.max(9, Math.round(boyut * 0.36)),
        color: vurgulu ? renk : MUTED,
        background: ozelRenk ? `${renk}1a` : 'rgba(255,255,255,0.04)',
        border: `1px solid ${vurgulu ? `${renk}80` : CARD_BORDER}`,
        boxShadow: ton === 'mavi' || (ozelRenk && nabiz) ? `0 0 0 3px ${renk}1f` : 'none',
      })}
    >
      {kisaltma}
    </span>
  );
}

/** Rozet — küçük kapsül etiket; `ton` verilmezse koyu renkten türetilir. */
export function Rozet({ metin, renk = GOLD, ton, title }: { metin: string; renk?: string; ton?: Ton; title?: string }) {
  return (
    <span data-ekip-rozet data-ton={ton || renkTonu(renk)} title={title} className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={portalStyle({ background: `${renk}1f`, border: `1px solid ${renk}44`, color: renk })}>
      {metin}
    </span>
  );
}

/** Boş durum: kesik çizgili kutu + soluk simge + tek cümle. */
export function Bos({ metin, ikon }: { metin: string; ikon?: ReactNode }) {
  return (
    <div data-ekip-bos className="flex flex-col items-center justify-center gap-2 rounded-xl py-9 text-center" style={portalStyle({ border: `1px dashed ${CARD_BORDER}`, color: MUTED })}>
      {ikon}
      <span className="text-[12.5px]">{metin}</span>
    </div>
  );
}

/** İnce ilerleme çubuğu (varsayılan çivit/mavi). */
export function Ilerleme({ yuzde, renk = MAVI, className = '' }: { yuzde: number; renk?: string; className?: string }) {
  return (
    <span data-ekip-ilerleme data-ton={renkTonu(renk)} className={`block h-[5px] w-full overflow-hidden rounded-full ${className}`} style={portalStyle({ background: 'rgba(255,255,255,0.06)' })}>
      <i className="block h-full rounded-full transition-[width] duration-500" style={portalStyle({ width: `${Math.max(4, Math.min(100, yuzde))}%`, background: `linear-gradient(90deg, ${renk}80, ${renk})` })} />
    </span>
  );
}

/** Alıntı bloğu: sol çizgi + yumuşak zemin (onay bekleyen mesaj metni). */
export function Alinti({ children, renk = GOLD, className = '' }: { children: ReactNode; renk?: string; className?: string }) {
  return (
    <div data-ekip-alinti data-ton={renkTonu(renk)} className={`whitespace-pre-wrap rounded-r-lg px-3 py-2 text-[12.5px] leading-relaxed ${className}`} style={portalStyle({ borderLeft: `2px solid ${renk}8c`, background: `${renk}0d`, color: TEXT })}>
      {children}
    </div>
  );
}
