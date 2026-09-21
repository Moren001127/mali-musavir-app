'use client';
import { portalStyle } from '@/lib/portal-theme';


import { AlertTriangle, CalendarRange, CheckSquare, Clock, StickyNote, Users } from 'lucide-react';
import type { AjandaSayaclar } from '@/lib/tasks';
import { EKIP_RENK, GOLD, IKINCIL, KIRMIZI, NOT_RENK } from './ortak';

export type SayacAnahtari = 'acik' | 'bugun' | 'gecikmis' | 'buHafta' | 'istek' | 'not';

const HAPLAR: Array<{ key: SayacAnahtari; ad: string; renk: string; ikon: typeof Clock; ipucu: string }> = [
  { key: 'bugun', ad: 'Bugün', renk: GOLD, ikon: Clock, ipucu: 'Vadesi bugün olan açık görevler' },
  { key: 'gecikmis', ad: 'Gecikmiş', renk: KIRMIZI, ikon: AlertTriangle, ipucu: 'Vadesi geçmiş açık görevler' },
  { key: 'buHafta', ad: 'Bu hafta', renk: '#a78bfa', ikon: CalendarRange, ipucu: 'Bu hafta (Pazar dahil) vadesi gelen görevler' },
  { key: 'acik', ad: 'Açık', renk: '#e7e5e4', ikon: CheckSquare, ipucu: 'Tüm açık görevler' },
  { key: 'istek', ad: 'Sizden istenen', renk: EKIP_RENK, ikon: Users, ipucu: 'Ekip ajanlarının sizden beklediği işler' },
  { key: 'not', ad: 'Notlar', renk: NOT_RENK, ikon: StickyNote, ipucu: 'Serbest notlar' },
];

/** Tek satır hap sayaç şeridi — tıklanınca süzer (aktif hap dolu). Dar ekranda yatay kayar, sayfa kaymaz. Beyaz temada renk yalnız anlam (gorevler-white.css). */
export function SayacSeridi({ sayaclar, aktif, onSec }: { sayaclar?: AjandaSayaclar; aktif: SayacAnahtari; onSec: (k: SayacAnahtari) => void }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {HAPLAR.map((h) => {
        const Ikon = h.ikon;
        const secili = aktif === h.key;
        const sayi = sayaclar ? sayaclar[h.key] : undefined;
        const var_ = (sayi ?? 0) > 0;
        return (
          <button
            data-gorev-sayac={h.key}
            data-sayi={var_ ? 'var' : 'yok'}
            key={h.key}
            type="button"
            onClick={() => onSec(h.key)}
            aria-pressed={secili}
            title={h.ipucu}
            className="inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-px"
            style={
              portalStyle(secili
                ? { background: `linear-gradient(135deg, ${h.renk}, ${h.renk}bb)`, border: '1px solid transparent', color: '#0b1218' }
                : { background: var_ ? `${h.renk}12` : 'transparent', border: `1px solid ${var_ ? `${h.renk}55` : 'rgba(255,255,255,0.10)'}`, color: var_ ? h.renk : IKINCIL })
            }
          >
            <Ikon size={12} />
            {h.ad}
            {sayi === undefined ? (
              <span className="inline-block h-3 w-5 animate-pulse rounded" style={portalStyle({ background: 'rgba(255,255,255,0.12)' })} />
            ) : (
              <span data-gorev-sayac-rozet className="rounded-full px-1.5 text-[10px] font-bold leading-4 tabular-nums" style={portalStyle(secili ? { background: 'rgba(0,0,0,0.22)' } : { background: `${h.renk}22` })}>
                {sayi}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
