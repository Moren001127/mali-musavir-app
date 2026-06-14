'use client';

import { ShieldCheck } from 'lucide-react';
import SgkBildirgeModule from '@/components/portal-automation/SgkBildirgeModule';

export default function SgkAutomationPage() {
  return (
    <div className="space-y-5 max-w-7xl">
      {/* ── Başlık kartı (Fiş Yazdırma / e-Tebligat stili) ── */}
      <div className="rounded-2xl border overflow-hidden relative" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #d4b876, transparent)' }} />
        <div className="p-6 flex items-start gap-4">
          <span className="grid place-items-center rounded-2xl flex-shrink-0" style={{ width: 56, height: 56, background: 'radial-gradient(circle at 30% 30%, rgba(212,184,118,0.22), rgba(212,184,118,0.06))', border: '1px solid rgba(212,184,118,0.25)', color: '#d4b876' }}>
            <ShieldCheck size={26} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 mb-1">
              <span className="w-[22px] h-px" style={{ background: '#d4b876' }} />
              <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>SGK · e-BİLDİRGE</span>
            </div>
            <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.02em', lineHeight: 1.1 }}>
              SGK Bildirge ve Raporlar
            </h1>
            <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Onaylı tahakkuk fişleri ve hizmet listeleri her gece otomatik çekilir; dönem, mahiyet, kanun no ve tutar ile kaydedilir.
            </p>
          </div>
        </div>
      </div>

      <SgkBildirgeModule />
    </div>
  );
}
