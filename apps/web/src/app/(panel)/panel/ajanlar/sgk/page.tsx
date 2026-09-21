'use client';
import '@/app/(panel)/panel/ajanlar/_components/operations-white.css';
import '@/components/portal-automation/portal-automation-white.css';

import { portalStyle } from '@/lib/portal-theme';


import { ShieldCheck } from 'lucide-react';
import SgkBildirgeModule from '@/components/portal-automation/SgkBildirgeModule';

export default function SgkAutomationPage() {
  return (
    <div data-ops-page="ajanlar" data-pa-page="sgk" className="space-y-5 max-w-7xl">
      {/* ── Başlık kartı — koyu temada (A) kart + altın şerit; beyaz temada (D) sade sayfa başlığı ── */}
      <div data-pa-header className="rounded-2xl border overflow-hidden relative" style={portalStyle({ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.07)' })}>
        <div data-pa-header-line className="absolute top-0 left-0 right-0 h-[3px]" style={portalStyle({ background: 'linear-gradient(90deg, #d4b876, transparent)' })} />
        <div data-pa-header-body className="p-6 flex items-start gap-4">
          <span data-pa-header-icon className="grid place-items-center rounded-2xl flex-shrink-0" style={portalStyle({ width: 56, height: 56, background: 'radial-gradient(circle at 30% 30%, rgba(212,184,118,0.22), rgba(212,184,118,0.06))', border: '1px solid rgba(212,184,118,0.25)', color: '#d4b876' })}>
            <ShieldCheck size={26} />
          </span>
          <div className="min-w-0">
            <div data-pa-eyebrow className="flex items-center gap-2.5 mb-1">
              <span className="w-[22px] h-px" style={portalStyle({ background: '#d4b876' })} />
              <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={portalStyle({ color: '#b8a06f' })}>SGK · e-BİLDİRGE</span>
            </div>
            <h1 style={portalStyle({ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.02em', lineHeight: 1.1 })}>
              SGK Bildirge ve Raporlar
            </h1>
            <p className="text-[13px] mt-1.5" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>
              Onaylı tahakkuk fişleri ve hizmet listeleri her gece otomatik çekilir; dönem, mahiyet, kanun no ve tutar ile kaydedilir.
            </p>
          </div>
        </div>
      </div>

      <SgkBildirgeModule />
    </div>
  );
}
