'use client';
import { portalStyle } from '@/lib/portal-theme';

import React from 'react';
import { AMBER, MUTED } from '../../_lib/tema';

/** Form alanı sarmalı: 11.5px normal etiket (büyük harf değil) + alan. */
export function Field({ label, required, className = '', children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[11.5px] font-medium" style={portalStyle({ color: MUTED })}>
        {label}{required ? <span style={portalStyle({ color: AMBER })}> *</span> : ''}
      </span>
      {children}
    </label>
  );
}
