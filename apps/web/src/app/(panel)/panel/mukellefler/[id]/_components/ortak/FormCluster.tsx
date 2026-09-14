'use client';
import React from 'react';
import { GOLD, HAIR, TEXT } from '../../_lib/tema';

/** Form grup başlığı: altın küçük nokta + 12px/700 yazı, altında ince çizgi. Kutu çerçevesi YOK. */
export function FormCluster({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3.5 flex items-center gap-2 border-b pb-2" style={{ borderColor: HAIR }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: GOLD }} />
        <span className="text-[12px] font-bold" style={{ color: TEXT }}>{title}</span>
      </div>
      {children}
    </div>
  );
}
