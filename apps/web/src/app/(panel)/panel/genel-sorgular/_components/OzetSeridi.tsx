'use client';
import { portalStyle } from '@/lib/portal-theme';


import { SORGU_TURLERI, SORGU_TURU_ADI, type SorguOzeti, type SorguTuru } from '@/lib/genel-sorgular';
import { IKINCIL, METIN, SONUK, TUR_RENK, kartZemini, tarihSaat } from './ortak';

/** Özet şeridi: 5 tür için küçük kart — adet + son sorgu tarihi. Tıklanınca o tür süzgece alınır. */
export function OzetSeridi({
  ozet,
  seciliTurler,
  onTur,
  yukleniyor,
}: {
  ozet?: SorguOzeti;
  seciliTurler: SorguTuru[];
  onTur: (t: SorguTuru) => void;
  yukleniyor?: boolean;
}) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {SORGU_TURLERI.map((t) => {
        const k = ozet?.[t];
        const renk = TUR_RENK[t];
        const secili = seciliTurler.includes(t);
        return (
          <button data-review-counter={t}
            key={t}
            type="button"
            onClick={() => onTur(t)}
            aria-pressed={secili}
            title={secili ? 'Süzgeçten çıkar' : 'Yalnız bu türü göster'}
            className="relative min-w-0 overflow-hidden rounded-xl px-3 py-2.5 text-left transition-[transform,border-color] duration-150 hover:-translate-y-px"
            style={portalStyle({ ...kartZemini(renk), ...(secili ? { border: `1px solid ${renk}66` } : {}) })}
          >
            <div className="absolute left-0 top-0 h-full w-[3px]" style={portalStyle({ background: `linear-gradient(180deg, ${renk}, ${renk}44)` })} />
            <div className="text-[10.5px] font-semibold uppercase tracking-[.08em]" style={portalStyle({ color: IKINCIL })}>
              {SORGU_TURU_ADI[t]}
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-[20px] font-semibold leading-none tabular-nums" style={portalStyle({ color: METIN })}>
                {yukleniyor && !k ? '…' : (k?.adet ?? 0).toLocaleString('tr-TR')}
              </span>
              <span className="text-[11px]" style={portalStyle({ color: SONUK })}>sorgu</span>
            </div>
            <div className="mt-1 truncate text-[11px]" style={portalStyle({ color: SONUK })}>
              {k?.sonSorgu ? `Son: ${tarihSaat(k.sonSorgu)}` : 'Henüz sorgu yok'}
            </div>
          </button>
        );
      })}
    </div>
  );
}
