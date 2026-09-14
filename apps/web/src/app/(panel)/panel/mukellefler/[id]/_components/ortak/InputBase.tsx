'use client';
import React from 'react';
import { FIELD_CLS } from '../../_lib/tema';

/** 40px, 8px köşeli giriş alanı — tek stil kaynağı FIELD_CLS. */
export function InputBase({ className = '', style, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`${FIELD_CLS} ${className}`}
      style={{ colorScheme: 'dark', ...(style || {}) }}
    />
  );
}
