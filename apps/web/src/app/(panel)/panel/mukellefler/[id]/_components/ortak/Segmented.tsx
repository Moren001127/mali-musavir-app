'use client';
import React from 'react';
import { GOLD, GOLD_SOFT, LINE, MUTED, R_ALAN } from '../../_lib/tema';

/** Bölümlü seçici (Firma / Şahıs / Basit): 40px, seçili parça altın dolgu. */
export function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex h-10 w-full p-[3px]" style={{ border: `1px solid ${LINE}`, background: 'rgba(0,0,0,0.30)', borderRadius: R_ALAN }}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="flex-1 rounded-[6px] px-4 text-[13px] transition-colors duration-150"
            style={on ? { background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b', fontWeight: 700 } : { color: MUTED, background: 'transparent', fontWeight: 500 }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
