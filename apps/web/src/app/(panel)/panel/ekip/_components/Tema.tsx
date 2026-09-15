'use client';

import type { CSSProperties, ReactNode } from 'react';
import { CARD_BORDER, GOLD, KIRMIZI, MAVI, MUTED, OK, ROW_SEP, TEXT } from '../../butce/ui';

/**
 * EKİP — TASARIM DİLİ = Kişisel Bütçe / Cari Kasa (Muzaffer Bey 2026-09-15: "Bütçe / Cari Kasa gibi").
 * Kutu, KPI, Rozet, Dugme, Girdi, Bos, Yukleniyor ve renkler `../../butce/ui`'dan gelir (tek kaynak, kopya yok).
 * Burada yalnız Ekip'e özgü küçük parçalar var: avatar, sekme şeridi, süzgeç çipi, ilerleme çubuğu, alıntı, iç kutu.
 *
 * Renk yalnız anlam taşır: altın = sizden beklenen / işlem · mavi = sürüyor · yeşil = bitti · kırmızı = yarım / durdur.
 */
export { Kutu, KPI, Rozet, Dugme, Girdi, Bos, Yukleniyor, GOLD, OK, KIRMIZI, MAVI, MOR, TURUNCU, TEXT, MUTED, CARD_BG, CARD_BORDER, ROW_SEP } from '../../butce/ui';

export type AvatarTonu = 'gold' | 'mavi' | 'gri' | 'kirmizi';

const AVATAR_RENK: Record<AvatarTonu, string> = { gold: GOLD, mavi: MAVI, gri: MUTED, kirmizi: KIRMIZI };

/** Personel avatarı: iki harf, nötr daire; çalışıyorsa mavi halka (nabız), Koordinatör altın. */
export function Avatar({ kisaltma, ton = 'gri', boyut = 28, nabiz = false, title }: { kisaltma: string; ton?: AvatarTonu; boyut?: number; nabiz?: boolean; title?: string }) {
  const renk = AVATAR_RENK[ton];
  const vurgulu = ton !== 'gri';
  return (
    <span
      title={title}
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full font-bold ${nabiz ? 'animate-pulse' : ''}`}
      style={{
        width: boyut,
        height: boyut,
        fontSize: Math.max(9, Math.round(boyut * 0.36)),
        color: vurgulu ? renk : MUTED,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${vurgulu ? `${renk}80` : CARD_BORDER}`,
        boxShadow: ton === 'mavi' ? `0 0 0 3px ${MAVI}1f` : 'none',
      }}
    >
      {kisaltma}
    </span>
  );
}

/** Altın sekme şeridi (Bütçe page.tsx ile aynı görünüm). */
export function Sekmeler<T extends string>({ sekmeler, secili, onSec }: { sekmeler: Array<{ id: T; etiket: string; ikon?: ReactNode; rozet?: number | string | null; dikkat?: boolean }>; secili: T; onSec: (id: T) => void }) {
  return (
    <nav
      className="flex items-center gap-0.5 overflow-x-auto rounded-2xl p-1.5 [scrollbar-width:thin]"
      style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(0,0,0,0.25))', border: `1px solid ${CARD_BORDER}` }}
      role="tablist"
    >
      {sekmeler.map((s) => {
        const aktif = s.id === secili;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={aktif}
            onClick={() => onSec(s.id)}
            className="relative flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-[7px] text-[12.5px] font-medium transition-all duration-150 hover:bg-white/[0.045]"
            style={{
              background: aktif ? `linear-gradient(180deg, ${GOLD}2b, ${GOLD}12)` : 'transparent',
              boxShadow: aktif ? `inset 0 0 0 1px ${GOLD}4d, 0 6px 18px -12px ${GOLD}99` : 'none',
              color: aktif ? GOLD : MUTED,
            }}
          >
            {s.ikon && <span style={{ opacity: aktif ? 1 : 0.75, display: 'inline-flex' }}>{s.ikon}</span>}
            {s.etiket}
            {s.rozet != null && s.rozet !== 0 && s.rozet !== '' && (
              <span
                className="rounded-full px-1.5 py-px text-[10px] font-semibold"
                style={{ background: `${s.dikkat ? GOLD : MUTED}1f`, border: `1px solid ${s.dikkat ? GOLD : MUTED}44`, color: s.dikkat ? GOLD : MUTED }}
              >
                {s.rozet}
              </span>
            )}
            {aktif && <span className="absolute inset-x-3 -bottom-[1px] h-[2px] rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />}
          </button>
        );
      })}
    </nav>
  );
}

/** Süzgeç çipi (hap): seçili altın, dikkat gerektiren kehribar sayı. */
export function Cip({ aktif, onClick, children, sayi, dikkat = false, title }: { aktif: boolean; onClick: () => void; children: ReactNode; sayi?: number | null; dikkat?: boolean; title?: string }) {
  const renk = aktif ? GOLD : dikkat ? GOLD : MUTED;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-medium transition-all hover:brightness-110"
      style={
        aktif
          ? { background: `${GOLD}1a`, border: `1px solid ${GOLD}59`, color: GOLD }
          : { background: 'rgba(255,255,255,0.02)', border: `1px solid ${dikkat ? `${GOLD}44` : CARD_BORDER}`, color: dikkat ? GOLD : MUTED }
      }
    >
      {children}
      {sayi != null && (
        <span className="text-[10.5px] tabular-nums" style={{ color: renk, opacity: aktif || dikkat ? 0.9 : 0.7 }}>
          {sayi}
        </span>
      )}
    </button>
  );
}

/** İnce ilerleme çubuğu (mavi gradyan). */
export function Ilerleme({ yuzde, renk = MAVI, className = '' }: { yuzde: number; renk?: string; className?: string }) {
  return (
    <span className={`block h-[5px] w-full overflow-hidden rounded-full ${className}`} style={{ background: 'rgba(255,255,255,0.06)' }}>
      <i className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(4, Math.min(100, yuzde))}%`, background: `linear-gradient(90deg, ${renk}80, ${renk})` }} />
    </span>
  );
}

/** Durum noktası (kelimenin yanında). */
export function Nokta({ renk, nabiz = false }: { renk: string; nabiz?: boolean }) {
  return <span className={`inline-block h-[6px] w-[6px] flex-shrink-0 rounded-full ${nabiz ? 'animate-pulse' : ''}`} style={{ background: renk, boxShadow: `0 0 8px ${renk}66` }} />;
}

/** Alıntı bloğu: sol altın çizgi (onay bekleyen mesaj metni). */
export function Alinti({ children, renk = GOLD, className = '' }: { children: ReactNode; renk?: string; className?: string }) {
  return (
    <div className={`whitespace-pre-wrap rounded-r-lg px-3 py-2 text-[12.5px] leading-relaxed ${className}`} style={{ borderLeft: `2px solid ${renk}8c`, background: `${renk}0d`, color: TEXT }}>
      {children}
    </div>
  );
}

/** Kutu içi küçük bölüm (Sonuç blokları: Yaptığı iş / Bulgular …). */
export function IcKutu({ baslik, children, renk = MUTED, className = '', style }: { baslik?: ReactNode; children: ReactNode; renk?: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 ${className}`} style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${CARD_BORDER}`, ...style }}>
      {baslik && (
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: renk }}>
          {baslik}
        </div>
      )}
      {children}
    </div>
  );
}

/** Ortak stiller */
export const satirAyrac: CSSProperties = { borderTop: `1px solid ${ROW_SEP}` };
export const ipucuStil: CSSProperties = { color: 'rgba(113,113,122,0.9)', fontSize: 10.5 };
export const koyuAlan: CSSProperties = { background: 'rgba(0,0,0,0.3)', border: `1px solid ${CARD_BORDER}` };

/** Klavye tuşu görünümü */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md px-1.5 py-px font-mono text-[10px]" style={{ border: `1px solid ${CARD_BORDER}`, background: 'rgba(255,255,255,0.04)', color: MUTED }}>
      {children}
    </kbd>
  );
}

/** Durum kelimesi rengi (vaka kutusu / iş durumu) */
export function durumRengi(d: 'suruyor' | 'karar' | 'bitti' | 'hata' | 'cevaplandi'): string {
  if (d === 'suruyor') return MAVI;
  if (d === 'karar') return GOLD;
  if (d === 'hata') return KIRMIZI;
  if (d === 'cevaplandi') return MUTED;
  return OK;
}
