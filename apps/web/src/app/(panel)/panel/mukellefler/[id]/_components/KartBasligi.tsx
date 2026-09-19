'use client';
import { portalStyle } from '@/lib/portal-theme';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Loader2, Save, Trash2 } from 'lucide-react';
import { ALTIN_DUGME, AMBER, CARD, FAINT, GREEN, LINE, MUTED, NOTR_DUGME, R_ALAN, RED, TEXT, displayName, kartZemin } from '../_lib/tema';
import { taxpayerKindLabel, type TaxpayerKind } from '../_lib/form';

export type CardNav = { index: number; total: number; prev: any; next: any };

/**
 * Kompakt tek bant başlık: ← · avatar (baş harf + doluluk %) · ad 18px · Aktif/Pasif · tür rozeti
 * alt satır: VKN · vergi dairesi · sıra; sağda Önceki/Sonraki + Kaydet (sayfadaki TEK altın dolgu).
 * Eksikler ince amber şerit olarak altta. Yapışkan değil.
 */
export function KartBasligi({
  isNew,
  currentName,
  avatarText,
  logoUrl,
  taxNumber,
  taxOffice,
  kind,
  compScore,
  compColor,
  eksikler,
  isTaxpayerActive,
  isActiveChanging,
  activeActionOpen,
  setActiveActionOpen,
  setActiveStatus,
  cardNav,
  router,
  isPending,
  deleteMukellef,
  isDeleting,
}: {
  isNew: boolean;
  currentName: string;
  avatarText: string;
  logoUrl: string;
  taxNumber: string;
  taxOffice: string;
  kind: TaxpayerKind;
  compScore: number | null;
  compColor: string;
  eksikler: any[];
  isTaxpayerActive: boolean;
  isActiveChanging: boolean;
  activeActionOpen: boolean;
  setActiveActionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveStatus: (isActive: boolean) => void;
  cardNav: CardNav;
  router: any;
  isPending: boolean;
  deleteMukellef: () => void;
  isDeleting: boolean;
}) {
  const durumRenk = isTaxpayerActive ? GREEN : RED;
  return (
    <header data-review-heading className="overflow-hidden" style={portalStyle(kartZemin())}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Link
          href="/panel/mukellef-listesi"
          className="flex h-9 w-9 shrink-0 items-center justify-center transition hover:brightness-125"
          style={portalStyle(NOTR_DUGME)}
          title="Mükellef listesine dön"
        >
          <ArrowLeft size={16} />
        </Link>

        {/* Avatar + doluluk */}
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center" style={portalStyle({ border: `1px solid ${LINE}`, background: 'rgba(0,0,0,0.30)', borderRadius: R_ALAN })}>
          {logoUrl ? (
            <div className="h-full w-full bg-cover bg-center" style={portalStyle({ backgroundImage: `url(${logoUrl})`, borderRadius: R_ALAN })} />
          ) : (
            <span className="text-[18px] font-bold" style={portalStyle({ color: TEXT })}>{avatarText}</span>
          )}
          {compScore != null && (
            <span
              className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 text-[11.5px] font-bold leading-4 tabular-nums"
              style={portalStyle({ background: CARD, border: `1px solid ${LINE}`, color: compColor })}
              title="Kart doluluk oranı"
            >
              %{compScore}
            </span>
          )}
        </div>

        {/* Ad + rozetler + alt satır */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-[18px] font-bold leading-6 tracking-[-0.01em]" style={portalStyle({ color: TEXT })}>{currentName}</h1>
            {!isNew && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setActiveActionOpen((v) => !v)}
                  disabled={isActiveChanging}
                  className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium transition hover:brightness-125 disabled:opacity-50"
                  style={portalStyle({ border: `1px solid ${durumRenk}55`, background: `${durumRenk}14`, color: durumRenk })}
                  title="Durumu değiştir"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={portalStyle({ background: durumRenk })} />
                  {isTaxpayerActive ? 'Aktif' : 'Pasif'}
                  <ChevronDown size={11} style={portalStyle({ opacity: 0.7 })} />
                </button>
                {activeActionOpen && (
                  <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[150px] p-1" style={portalStyle({ background: '#14110e', border: `1px solid ${LINE}`, borderRadius: R_ALAN, boxShadow: '0 18px 48px rgba(0,0,0,0.6)' })}>
                    <button
                      type="button"
                      className="w-full rounded-[6px] px-3 py-2 text-left text-[13px] font-medium transition hover:bg-white/[0.06]"
                      style={portalStyle({ color: isTaxpayerActive ? RED : GREEN })}
                      onClick={() => {
                        setActiveActionOpen(false);
                        setActiveStatus(!isTaxpayerActive);
                      }}
                    >
                      {isTaxpayerActive ? 'Pasife al' : 'Aktife al'}
                    </button>
                  </div>
                )}
              </div>
            )}
            <span className="inline-flex h-6 items-center rounded-md px-2 text-[11.5px] font-medium" style={portalStyle({ border: `1px solid ${LINE}`, color: MUTED })}>
              {taxpayerKindLabel(kind)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]" style={portalStyle({ color: MUTED })}>
            <span className="tabular-nums">{taxNumber || 'VKN/TC yok'}</span>
            <span style={portalStyle({ color: FAINT })}>·</span>
            <span className="truncate">{taxOffice || 'Vergi dairesi yok'}</span>
            {!isNew && cardNav.total > 0 && (
              <>
                <span style={portalStyle({ color: FAINT })}>·</span>
                <span className="tabular-nums">{cardNav.index >= 0 ? cardNav.index + 1 : '-'} / {cardNav.total}</span>
              </>
            )}
          </div>
        </div>

        {/* Sağ: gezinme + Kaydet */}
        <div className="flex shrink-0 items-center gap-2">
          {!isNew && <CardNavButtons cardNav={cardNav} isNew={isNew} router={router} />}
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-9 items-center gap-2 px-4 text-[13px] font-bold transition duration-150 hover:brightness-105 disabled:opacity-50"
            style={portalStyle(ALTIN_DUGME)}
          >
            {isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {isNew ? 'Kaydı Oluştur' : 'Kaydet'}
          </button>
          {!isNew && (
            <button
              type="button"
              onClick={() => {
                if (confirm('Mükellef pasife alınsın mı?')) deleteMukellef();
              }}
              disabled={isDeleting}
              className="hidden"
              style={portalStyle({ borderColor: 'rgba(248,113,113,0.32)', color: '#fca5a5' })}
              title="Mükellefi pasife al"
            >
              {isDeleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            </button>
          )}
        </div>
      </div>

      {/* Eksikler — ince amber şerit */}
      {!isNew && eksikler.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1.5 text-[11.5px]" style={portalStyle({ background: 'rgba(240,183,85,0.08)', borderTop: '1px solid rgba(240,183,85,0.22)', color: AMBER })}>
          <AlertTriangle size={12} />
          <span className="font-medium">Eksik:</span>
          <span style={portalStyle({ color: 'rgba(240,183,85,0.85)' })}>
            {eksikler.slice(0, 5).map((f) => f.label).join(', ')}
            {eksikler.length > 5 ? ` +${eksikler.length - 5}` : ''}
          </span>
        </div>
      )}
    </header>
  );
}

/** Önceki / sıra / Sonraki — nötr, 36px. */
export function CardNavButtons({ cardNav, isNew, router }: { cardNav: any; isNew: boolean; router: any }) {
  if (isNew || cardNav.total <= 1) return null;
  return (
    <div className="inline-flex h-9 overflow-hidden" style={portalStyle({ border: `1px solid ${LINE}`, borderRadius: R_ALAN, background: 'rgba(255,255,255,0.03)' })}>
      <button
        type="button"
        onClick={() => cardNav.prev && router.push(`/panel/mukellefler/${cardNav.prev.id}`)}
        disabled={!cardNav.prev}
        title={cardNav.prev ? displayName(cardNav.prev) : 'İlk mükellef'}
        className="inline-flex items-center gap-1 px-2.5 text-[13px] font-medium transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
        style={portalStyle({ color: MUTED })}
      >
        <ChevronLeft size={15} /> <span className="hidden sm:inline">Önceki</span>
      </button>
      <span className="inline-flex items-center border-x px-2.5 text-[11.5px] font-bold tabular-nums" style={portalStyle({ borderColor: LINE, color: TEXT })}>
        {cardNav.index >= 0 ? cardNav.index + 1 : '-'} / {cardNav.total}
      </span>
      <button
        type="button"
        onClick={() => cardNav.next && router.push(`/panel/mukellefler/${cardNav.next.id}`)}
        disabled={!cardNav.next}
        title={cardNav.next ? displayName(cardNav.next) : 'Son mükellef'}
        className="inline-flex items-center gap-1 px-2.5 text-[13px] font-medium transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
        style={portalStyle({ color: MUTED })}
      >
        <span className="hidden sm:inline">Sonraki</span> <ChevronRight size={15} />
      </button>
    </div>
  );
}
