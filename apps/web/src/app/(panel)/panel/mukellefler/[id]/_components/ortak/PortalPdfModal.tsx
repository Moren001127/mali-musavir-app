'use client';
import { portalStyle } from '@/lib/portal-theme';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { CARD, HAIR, LINE, NOTR_DUGME, R_KART, TEXT } from '../../_lib/tema';

/** Aynı sayfada büyüyerek açılan PDF önizleme modalı (yeni sekme yerine). Esc kapatır. */
export function PortalPdfModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6"
         style={portalStyle({ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' })} onClick={onClose}>
      <div
        className="flex h-[90vh] w-[min(1040px,97vw)] flex-col overflow-hidden"
        style={portalStyle({ border: `1px solid ${LINE}`, borderRadius: R_KART, background: CARD, transform: shown ? 'scale(1)' : 'scale(0.94)', opacity: shown ? 1 : 0, transition: 'transform .18s ease, opacity .18s ease' })}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-4 py-3" style={portalStyle({ borderColor: HAIR })}>
          <div className="min-w-0 flex-1 truncate text-[14px] font-bold" style={portalStyle({ color: TEXT })}>{title}</div>
          <a href={url} target="_blank" rel="noopener noreferrer"
             className="inline-flex h-8 items-center gap-1.5 px-3 text-[13px] font-medium transition hover:brightness-125"
             style={portalStyle(NOTR_DUGME)}>
            <Download size={14} /> İndir
          </a>
          <button type="button" onClick={onClose}
            className="flex h-8 w-8 items-center justify-center transition hover:brightness-125"
            style={portalStyle(NOTR_DUGME)} title="Kapat (Esc)">
            <X size={16} />
          </button>
        </div>
        <iframe src={url} title="Belge önizleme" className="w-full flex-1" style={portalStyle({ border: 0, background: '#fff' })} />
      </div>
    </div>,
    document.body,
  );
}
