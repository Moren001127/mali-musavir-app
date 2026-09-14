'use client';
import React from 'react';
import { GREEN, LINE, MUTED, R_ALAN, TEXT } from '../../_lib/tema';

/** Şalter satırı: başlık + açıklama, sağda 36×20 şalter. Açıkken yeşil, kapalıyken nötr. */
export function ToggleRow({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
      style={{ border: `1px solid ${checked ? 'rgba(95,207,142,0.32)' : LINE}`, background: checked ? 'rgba(95,207,142,0.06)' : 'rgba(0,0,0,0.18)', borderRadius: R_ALAN }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium" style={{ color: TEXT }}>{title}</span>
        <span className="mt-0.5 block text-[11.5px]" style={{ color: MUTED }}>{detail}</span>
      </span>
      <Salter checked={checked} />
    </label>
  );
}

/** Salt görsel şalter (36×20). Tıklama sarmal etiketten/düğmeden gelir. */
export function Salter({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors duration-150"
      style={{
        background: checked ? GREEN : 'rgba(255,255,255,0.14)',
        opacity: disabled ? 0.4 : 1,
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.35)',
      }}
    >
      <span
        className="absolute top-[2px] h-4 w-4 rounded-full transition-[left] duration-150"
        style={{ left: checked ? 18 : 2, background: checked ? '#0f0d0b' : '#fafaf9', boxShadow: '0 1px 2px rgba(0,0,0,0.4)' }}
      />
    </span>
  );
}
