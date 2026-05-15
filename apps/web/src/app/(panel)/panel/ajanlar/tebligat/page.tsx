'use client';

import PortalAutomationPanel from '@/components/portal-automation/PortalAutomationPanel';

export default function TebligatAutomationPage() {
  return (
    <div className="space-y-5 max-w-7xl">
      <div className="pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: '#d4b876' }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>GIB</span>
        </div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
          e-Tebligat Kontrol
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
          Vergi dairesi sifresi kayitli mukelleflerin e-Tebligat kutusu gece otomatik kontrol edilir.
        </p>
      </div>

      <PortalAutomationPanel focus="tebligat" />
    </div>
  );
}
