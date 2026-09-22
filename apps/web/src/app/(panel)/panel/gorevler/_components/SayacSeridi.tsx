'use client';
import { portalStyle } from '@/lib/portal-theme';


import { AlertTriangle, CalendarRange, CheckSquare, Clock, StickyNote, Users } from 'lucide-react';
import type { AjandaSayaclar } from '@/lib/tasks';
import { EKIP_RENK, GOLD, IKINCIL, KIRMIZI, NOT_RENK, SONUK } from './ortak';

export type SayacAnahtari = 'acik' | 'bugun' | 'gecikmis' | 'buHafta' | 'istek' | 'not';

const HAPLAR: Array<{ key: SayacAnahtari; ad: string; alt: string; renk: string; ikon: typeof Clock; ipucu: string }> = [
  { key: 'bugun', ad: 'Bugün', alt: 'vadesi bugün', renk: GOLD, ikon: Clock, ipucu: 'Vadesi bugün olan açık görevler' },
  { key: 'gecikmis', ad: 'Gecikmiş', alt: 'vadesi geçti', renk: KIRMIZI, ikon: AlertTriangle, ipucu: 'Vadesi geçmiş açık görevler' },
  { key: 'buHafta', ad: 'Bu hafta', alt: 'pazara kadar', renk: '#a78bfa', ikon: CalendarRange, ipucu: 'Bu hafta (Pazar dahil) vadesi gelen görevler' },
  { key: 'acik', ad: 'Açık', alt: 'tüm açık işler', renk: '#e7e5e4', ikon: CheckSquare, ipucu: 'Tüm açık görevler' },
  { key: 'istek', ad: 'Sizden istenen', alt: 'ekip bekliyor', renk: EKIP_RENK, ikon: Users, ipucu: 'Ekip ajanlarının sizden beklediği işler' },
  { key: 'not', ad: 'Notlar', alt: 'serbest not', renk: NOT_RENK, ikon: StickyNote, ipucu: 'Serbest notlar' },
];

/**
 * Sayaç panosu (2026-09-22 yeniden tasarım — Muzaffer Bey: "sayaçlar her yerde aynı tarz").
 * Dağınık hap yerine TEK ŞERİT: altı bölme yan yana, aralarında ince ayraç; her bölmede büyük sayı,
 * altında ad ve tek kelimelik açıklama, solda tonlu simge. Etkin bölme üstten renk çizgisi + hafif yıkama alır,
 * sıfır olan bölme soluk kalır. Tıklama = süzgeç (aynı davranış). Beyaz tema görünümü gorevler-white.css'te.
 */
export function SayacSeridi({ sayaclar, aktif, onSec }: { sayaclar?: AjandaSayaclar; aktif: SayacAnahtari; onSec: (k: SayacAnahtari) => void }) {
  return (
    <div
      data-gorev-sayac-pano
      className="grid grid-cols-2 overflow-hidden rounded-[14px] sm:grid-cols-3 lg:grid-cols-6"
      style={portalStyle({ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.09)' })}
    >
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
            className="group relative flex items-center gap-3 px-3.5 py-3 text-left transition-colors duration-150"
            style={portalStyle(secili
              ? { background: `${h.renk}1a`, borderLeft: '1px solid rgba(255,255,255,0.08)' }
              : { background: 'transparent', borderLeft: '1px solid rgba(255,255,255,0.08)' })}
          >
            {/* Etkin bölme: üstte renk çizgisi */}
            <span data-gorev-sayac-cizgi aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={portalStyle({ background: secili ? h.renk : 'transparent' })} />
            <span
              data-gorev-sayac-ikon
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
              style={portalStyle({ background: `${h.renk}${var_ ? '1f' : '12'}`, color: var_ ? h.renk : SONUK })}
            >
              <Ikon size={16} />
            </span>
            <span className="min-w-0">
              {sayi === undefined ? (
                <span className="block h-[22px] w-8 animate-pulse rounded" style={portalStyle({ background: 'rgba(255,255,255,0.12)' })} />
              ) : (
                <span data-gorev-sayac-sayi className="block text-[22px] font-bold leading-none tabular-nums" style={portalStyle({ color: var_ ? '#fafaf9' : SONUK })}>
                  {sayi}
                </span>
              )}
              <span data-gorev-sayac-ad className="mt-1 block truncate text-[12px] font-semibold leading-tight" style={portalStyle({ color: var_ ? h.renk : IKINCIL })}>
                {h.ad}
              </span>
              <span data-gorev-sayac-alt className="block truncate text-[10.5px] leading-tight" style={portalStyle({ color: SONUK })}>
                {h.alt}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
