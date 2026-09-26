'use client';
import { portalStyle } from '@/lib/portal-theme';

// Üst sıra 3 özet kartı (Hattat düzeni): e-Rapor · İş Kazası (Hastane Bildirimi) · İşe Giriş / Çıkış.
import React from 'react';
import { ArrowDown, ArrowLeftRight, Ambulance, Stethoscope } from 'lucide-react';
import type { SgkViziteOzet } from '@mali-musavir/shared';
import { GOLD, METIN } from '../belge-ortak';
import { SOLUK } from './ortak';

type Ton = 'mavi' | 'kirmizi' | 'notr';

function OzetKarti({ ton, ikon, etiket, sayi, not, link, children }: {
  ton: Ton;
  ikon: React.ReactNode;
  etiket: string;
  /** büyük rakam; yoksa `not` onun yerinde soluk yazı */
  sayi?: React.ReactNode;
  not?: string;
  link?: { ad: string; onClick: () => void };
  children?: React.ReactNode;
}) {
  return (
    <div data-sr-ozet={ton} className="flex flex-col rounded-2xl border px-4 pb-3 pt-4"
      style={portalStyle({ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.07)' })}>
      <div className="flex items-center gap-2.5">
        <span data-sr-ozet-ikon className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg" style={portalStyle({ background: 'rgba(212,184,118,0.12)', color: GOLD })}>{ikon}</span>
        <span data-sr-ozet-etiket className="text-[11px] font-bold uppercase tracking-[.1em]" style={portalStyle({ color: 'rgba(250,250,249,0.55)' })}>{etiket}</span>
      </div>
      <div className="mt-3 flex min-h-[40px] items-center">
        {sayi !== undefined ? (
          <span className="flex items-baseline gap-2">
            <span data-sr-ozet-sayi className="text-[30px] font-bold leading-none tabular-nums" style={portalStyle({ color: METIN })}>{sayi}</span>
            {not && <span data-sr-ozet-not className="text-[12px]" style={portalStyle({ color: SOLUK })}>{not}</span>}
          </span>
        ) : (
          <span data-sr-ozet-not className="text-[13px]" style={portalStyle({ color: SOLUK })}>{not}</span>
        )}
      </div>
      {children}
      <div className="mt-auto" />
      {link && (
        <button type="button" onClick={link.onClick} data-sr-ozet-link
          className="mt-3 inline-flex items-center gap-1.5 self-start border-t pt-2.5 text-[12.5px] font-semibold transition hover:brightness-125"
          style={portalStyle({ borderColor: 'rgba(255,255,255,0.07)', color: GOLD, width: '100%' })}>
          {link.ad} <ArrowDown size={13} />
        </button>
      )}
    </div>
  );
}

export function OzetKartlari({ ozet, onRaporaGit, onKazayaGit }: {
  ozet: SgkViziteOzet | undefined;
  onRaporaGit: () => void;
  onKazayaGit: () => void;
}) {
  const bekleyen = ozet?.onayBekleyen ?? 0;
  const onaylanan = ozet?.onaylanan ?? 0;
  const kaza = ozet?.isKazasi ?? 0;
  return (
    <div data-sr-ozetler className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <OzetKarti
        ton="mavi"
        ikon={<Stethoscope size={16} />}
        etiket="e-Rapor"
        sayi={ozet ? bekleyen + onaylanan : '—'}
        link={{ ad: 'Rapor listesine git', onClick: onRaporaGit }}
      >
        <div data-sr-ozet-ikili className="mt-3 grid grid-cols-2 rounded-lg border text-[13px]" style={portalStyle({ borderColor: 'rgba(255,255,255,0.07)' })}>
          <div className="flex items-baseline justify-between gap-2 px-3 py-2" title="Son 180 gün">
            <span data-sr-renk="yesil" style={portalStyle({ color: '#5cbf8a' })}>Onaylanmış</span>
            <b data-sr-renk="yesil" className="tabular-nums" style={portalStyle({ color: '#5cbf8a' })}>{ozet ? onaylanan : '—'}</b>
          </div>
          <div className="flex items-baseline justify-between gap-2 border-l px-3 py-2" style={portalStyle({ borderColor: 'rgba(255,255,255,0.07)' })}>
            <span data-sr-renk="kirmizi" style={portalStyle({ color: '#e2706f' })}>Onaylanmamış</span>
            <b data-sr-renk="kirmizi" className="tabular-nums" style={portalStyle({ color: '#e2706f' })}>{ozet ? bekleyen : '—'}</b>
          </div>
        </div>
      </OzetKarti>

      <OzetKarti
        ton={kaza > 0 ? 'kirmizi' : 'notr'}
        ikon={<Ambulance size={16} />}
        etiket="İş Kazası (Hastane Bildirimi)"
        sayi={ozet ? kaza : '—'}
        not="son 90 gün"
        link={{ ad: 'Hastane bildirim listesine git', onClick: onKazayaGit }}
      />

      <OzetKarti ton="notr" ikon={<ArrowLeftRight size={16} />} etiket="İşe Giriş / Çıkış" not="İkinci aşamada bağlanacak" />
    </div>
  );
}
