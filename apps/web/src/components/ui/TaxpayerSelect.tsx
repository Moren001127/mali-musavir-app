'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X, Check } from 'lucide-react';

/**
 * Türkçe locale-aware mükellef picker — search'lü, keyboard-friendly,
 * dropdown panel viewport'tan TAŞMAZ (portal + smart positioning).
 *
 * Native <select> Chrome'da uzun mükellef adlarında ekran dışına çıkıyordu;
 * bu component panel'i body'ye portal'lar, viewport sınırlarına göre konumlar.
 */

export interface TaxpayerLite {
  id: string;
  type?: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
}

interface Props {
  taxpayers: TaxpayerLite[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** "Tümü" gibi sentinel option (opsiyonel) */
  allLabel?: string;
  allValue?: string;
  className?: string;
  /** Inline style (border, background) için override */
  style?: React.CSSProperties;
  /** Custom display name builder (opsiyonel) */
  displayName?: (t: TaxpayerLite) => string;
}

const defaultDisplayName = (t: TaxpayerLite): string =>
  (t.companyName ||
    `${t.firstName || ''} ${t.lastName || ''}`.trim() ||
    t.taxNumber ||
    '').trim();

export default function TaxpayerSelect({
  taxpayers,
  value,
  onChange,
  placeholder = '— mükellef seçin —',
  disabled = false,
  allLabel,
  allValue = '__ALL__',
  className,
  style,
  displayName = defaultDisplayName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; flipUp: boolean }>({
    top: 0, left: 0, width: 0, flipUp: false,
  });

  // Türkçe locale-aware sıralama (backend zaten yapıyor ama defansif)
  const sortedTaxpayers = useMemo(() => {
    const collator = new Intl.Collator('tr', { sensitivity: 'base' });
    return [...taxpayers].sort((a, b) =>
      collator.compare(displayName(a), displayName(b)),
    );
  }, [taxpayers, displayName]);

  // Filtered list
  const filtered = useMemo(() => {
    if (!search.trim()) return sortedTaxpayers;
    const s = search.toLocaleLowerCase('tr');
    return sortedTaxpayers.filter((t) => {
      const name = displayName(t).toLocaleLowerCase('tr');
      const vkn = (t.taxNumber || '').toLowerCase();
      return name.includes(s) || vkn.includes(s);
    });
  }, [sortedTaxpayers, search, displayName]);

  // Selected label
  const selected = useMemo(() => {
    if (allLabel && value === allValue) return allLabel;
    const t = taxpayers.find((x) => x.id === value);
    return t ? displayName(t) : '';
  }, [taxpayers, value, allLabel, allValue, displayName]);

  // Position panel below/above trigger, within viewport
  const recalcPosition = () => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const PANEL_H = 380; // tahmini panel yüksekliği
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < PANEL_H + 16 && r.top > PANEL_H + 16;
    setPos({
      top: flipUp ? r.top - PANEL_H - 4 : r.bottom + 4,
      left: r.left,
      width: r.width,
      flipUp,
    });
  };

  useEffect(() => {
    if (!open) return;
    recalcPosition();
    const onScrollOrResize = () => recalcPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  // Close on outside click + ESC
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(target) &&
        triggerRef.current && !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
    setSearch('');
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`w-full px-3 py-2.5 rounded-[10px] text-[13px] outline-none flex items-center justify-between gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className || ''}`}
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: '#fafaf9',
          ...style,
        }}
      >
        <span className="truncate text-left flex-1" style={{ color: selected ? '#fafaf9' : 'rgba(250,250,249,0.45)' }}>
          {selected || placeholder}
        </span>
        <ChevronDown size={14} style={{ color: 'rgba(250,250,249,0.5)', flexShrink: 0 }} />
      </button>

      {open && typeof window !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: 380,
            zIndex: 9999,
            background: '#13110f',
            border: '1px solid rgba(212,184,118,0.35)',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Search */}
          <div style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(250,250,249,0.4)' }} />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ara — ad veya VKN…"
                style={{
                  width: '100%',
                  padding: '8px 30px 8px 32px',
                  fontSize: 13,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  color: '#fafaf9',
                  outline: 'none',
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 0, padding: 4, cursor: 'pointer', color: 'rgba(250,250,249,0.5)' }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {allLabel && (
              <div
                onClick={() => select(allValue)}
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  color: value === allValue ? '#d4b876' : 'rgba(250,250,249,0.85)',
                  background: value === allValue ? 'rgba(184,160,111,0.1)' : 'transparent',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
                onMouseEnter={(e) => { if (value !== allValue) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={(e) => { if (value !== allValue) e.currentTarget.style.background = 'transparent'; }}
              >
                <span>{allLabel}</span>
                {value === allValue && <Check size={14} />}
              </div>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'rgba(250,250,249,0.4)', fontSize: 12.5 }}>
                {search ? 'Eşleşen mükellef yok' : 'Mükellef yok'}
              </div>
            ) : (
              filtered.map((t) => {
                const sel = value === t.id;
                const name = displayName(t);
                return (
                  <div
                    key={t.id}
                    onClick={() => select(t.id)}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      fontSize: 13,
                      color: sel ? '#d4b876' : '#fafaf9',
                      background: sel ? 'rgba(184,160,111,0.1)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                    onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </div>
                      {t.taxNumber && (
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: 'rgba(250,250,249,0.4)', marginTop: 1 }}>
                          {t.taxNumber}
                        </div>
                      )}
                    </div>
                    {sel && <Check size={14} style={{ flexShrink: 0 }} />}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer count */}
          <div style={{ padding: '6px 12px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 11, color: 'rgba(250,250,249,0.4)' }}>
            {filtered.length} / {sortedTaxpayers.length} mükellef
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
