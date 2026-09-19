'use client';
import { portalStyle } from '@/lib/portal-theme';


import { CalendarDays, X } from 'lucide-react';
import TaxpayerSelect, { type TaxpayerLite } from '@/components/ui/TaxpayerSelect';
import { SORGU_TURLERI, SORGU_TURU_ADI, type SorguTuru } from '@/lib/genel-sorgular';
import { GOLD, IKINCIL, METIN, TUR_RENK, kartZemini } from './ortak';

export interface Suzgec {
  /** '' → tüm mükellefler */
  mukellefId: string;
  /** boş → hepsi */
  turler: SorguTuru[];
  /** 'YYYY-MM' ya da '' (tüm dönemler) */
  donem: string;
}

/** Süzgeç bandı: mükellef seçici · tür hapları (çoklu) · dönem (ay / tüm dönemler). Yapışkan değil. */
export function SuzgecBandi({
  suzgec,
  onSuzgec,
  mukellefler,
  buAy,
}: {
  suzgec: Suzgec;
  onSuzgec: (s: Suzgec) => void;
  mukellefler: TaxpayerLite[];
  buAy: string;
}) {
  const tumDonemler = suzgec.donem === '';
  const suzgecVar = !!suzgec.mukellefId || suzgec.turler.length > 0 || suzgec.donem !== buAy;

  const turDegistir = (t: SorguTuru) => {
    const set = new Set(suzgec.turler);
    if (set.has(t)) set.delete(t);
    else set.add(t);
    onSuzgec({ ...suzgec, turler: SORGU_TURLERI.filter((x) => set.has(x)) });
  };

  return (
    <div className="mb-3 rounded-2xl px-4 py-3" style={portalStyle(kartZemini(GOLD))}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {/* Mükellef */}
        <div className="w-full sm:w-[280px]">
          <TaxpayerSelect
            taxpayers={mukellefler}
            value={suzgec.mukellefId || '__ALL__'}
            onChange={(id) => onSuzgec({ ...suzgec, mukellefId: id === '__ALL__' ? '' : id })}
            allLabel="Tüm mükellefler"
            allValue="__ALL__"
            style={portalStyle({ padding: '6px 12px', borderRadius: 999, fontSize: 12 })}
          />
        </div>

        <span className="mx-0.5 hidden h-4 w-px flex-shrink-0 sm:block" style={portalStyle({ background: 'rgba(255,255,255,0.12)' })} />

        {/* Sorgu türü hapları — çoklu seçim; hiçbiri seçili değilse hepsi */}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sorgu türü">
          {SORGU_TURLERI.map((t) => {
            const secili = suzgec.turler.includes(t);
            const renk = TUR_RENK[t];
            return (
              <button
                key={t}
                type="button"
                aria-pressed={secili}
                onClick={() => turDegistir(t)}
                title={secili ? `${SORGU_TURU_ADI[t]} — seçimi kaldır` : `${SORGU_TURU_ADI[t]} — yalnız bu türü göster`}
                className="inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-[transform,filter] hover:-translate-y-px hover:brightness-125"
                style={portalStyle(secili ? { background: `${renk}18`, border: `1px solid ${renk}66`, color: renk } : { background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: IKINCIL })}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={portalStyle({ background: renk, opacity: secili ? 1 : 0.55 })} />
                {SORGU_TURU_ADI[t]}
              </button>
            );
          })}
        </div>

        <span className="mx-0.5 hidden h-4 w-px flex-shrink-0 sm:block" style={portalStyle({ background: 'rgba(255,255,255,0.12)' })} />

        {/* Dönem */}
        <div className="flex items-center gap-1.5">
          <label
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold"
            style={portalStyle({ border: `1px solid ${tumDonemler ? 'rgba(255,255,255,0.12)' : `${GOLD}66`}`, background: tumDonemler ? 'transparent' : `${GOLD}18`, color: tumDonemler ? IKINCIL : GOLD })}
            title="Dönem (ay)"
          >
            <CalendarDays size={12} />
            <input
              type="month"
              value={tumDonemler ? '' : suzgec.donem}
              onChange={(e) => onSuzgec({ ...suzgec, donem: e.target.value || buAy })}
              aria-label="Dönem"
              className="bg-transparent outline-none [color-scheme:dark]"
              style={portalStyle({ color: tumDonemler ? IKINCIL : METIN, fontSize: 12, width: 120 })}
            />
          </label>
          <button
            type="button"
            aria-pressed={tumDonemler}
            onClick={() => onSuzgec({ ...suzgec, donem: tumDonemler ? buAy : '' })}
            title={tumDonemler ? 'Bu aya dön' : 'Tüm dönemleri göster'}
            className="inline-flex h-8 flex-shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[11.5px] font-semibold transition hover:brightness-125"
            style={portalStyle(tumDonemler ? { background: `${GOLD}18`, border: `1px solid ${GOLD}66`, color: GOLD } : { background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: IKINCIL })}
          >
            Tüm dönemler
          </button>
        </div>

        {suzgecVar && (
          <button
            type="button"
            onClick={() => onSuzgec({ mukellefId: '', turler: [], donem: buAy })}
            title="Süzgeçleri temizle"
            className="inline-flex h-8 flex-shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-semibold transition hover:brightness-125"
            style={portalStyle({ color: IKINCIL, border: '1px solid rgba(255,255,255,0.10)' })}
          >
            <X size={12} /> Temizle
          </button>
        )}
      </div>
    </div>
  );
}
