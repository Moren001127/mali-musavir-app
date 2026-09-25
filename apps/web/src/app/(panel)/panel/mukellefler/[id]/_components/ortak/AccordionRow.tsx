'use client';
import { portalStyle } from '@/lib/portal-theme';

import React from 'react';
import { ChevronDown } from 'lucide-react';
import { GREEN, HAIR, LINE, MUTED, R_KART, TEXT, ikonRozeti } from '../../_lib/tema';

/**
 * Tek katmanlı akordeon satırı: 3px sol renk şeridi · 28px ikon rozeti · başlık 12.5/700 · alt yazı 11 · sağda "Tanımlı".
 * Satır yüksekliği 2026-09-25'te 120px'ten ~52px'e indirildi: dokuz bölüm alt alta dizildiğinde ekranı dolduruyordu.
 * Açıkken hafif degrade zemin; içerik doğrudan açılan alana (iç kutu YOK).
 */
export function AccordionRow({
  icon: Icon,
  title,
  subtitle,
  filled,
  renk,
  open,
  onToggle,
  children,
  filledLabel = 'Tanımlı',
  id,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  filled: boolean;
  renk: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  filledLabel?: string;
  id?: string;
}) {
  return (
    <section data-review-surface
      id={id}
      className="relative overflow-hidden transition-colors duration-150"
      style={portalStyle({
        border: `1px solid ${open ? `${renk}55` : LINE}`,
        borderRadius: R_KART,
        background: open
          ? `radial-gradient(110% 80% at 0% 0%, ${renk}16, transparent 55%), linear-gradient(160deg, rgba(255,255,255,0.03), rgba(255,255,255,0.008))`
          : 'linear-gradient(160deg, rgba(255,255,255,0.02), rgba(255,255,255,0.005))',
      })}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={portalStyle({ background: renk, opacity: open ? 1 : 0.55 })} />
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 py-2 pl-3.5 pr-3 text-left transition-colors hover:bg-white/[0.025]"
      >
        <span className="flex h-[28px] w-[28px] shrink-0 items-center justify-center" style={portalStyle(ikonRozeti(renk))}>
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-bold leading-[17px]" style={portalStyle({ color: TEXT })}>{title}</span>
          <span className="mt-[1px] block truncate text-[11px] leading-[14px]" style={portalStyle({ color: MUTED })}>{subtitle}</span>
        </span>
        {filled && (
          <span className="hidden items-center gap-1.5 text-[11px] font-medium sm:inline-flex" style={portalStyle({ color: GREEN })}>
            <span className="h-1.5 w-1.5 rounded-full" style={portalStyle({ background: GREEN })} />
            {filledLabel}
          </span>
        )}
        <ChevronDown
          size={16}
          className="shrink-0 transition-transform duration-200"
          style={portalStyle({ color: open ? renk : MUTED, transform: open ? 'rotate(180deg)' : 'rotate(0deg)' })}
        />
      </button>
      {open && (
        <div className="border-t px-3.5 py-3.5 pl-[17px] sm:px-4 sm:pl-[19px]" style={portalStyle({ borderColor: HAIR })}>
          {children}
        </div>
      )}
    </section>
  );
}
