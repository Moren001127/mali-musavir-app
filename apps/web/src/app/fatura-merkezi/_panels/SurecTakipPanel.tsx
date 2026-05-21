'use client';

import { Workflow, CheckCircle2 } from 'lucide-react';

/* SÜREÇ TAKİBİ — Mihsap referansı.
   Dönem bazlı onay akışı:
     Onay Tamamlanmayanlar → Rapor Bekleyenler → Kontrol Bekleyenler → Kontrol Edilenler */
export default function SurecTakipPanel({ period, taxpayers }: { period: string; taxpayers: Array<any> }) {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5">
        <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
          Süreç Takibi
        </div>
        <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Dönem {period} · {taxpayers.length} mükellef
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        <Stage label="Onay Tamamlanmayanlar" count={taxpayers.length} tone="#ef4444" active />
        <Stage label="Rapor Bekleyenler" count={0} tone="#f59e0b" />
        <Stage label="Kontrol Bekleyenler" count={0} tone="#60a5fa" />
        <Stage label="Kontrol Edilenler" count={0} tone="#10b981" />
      </div>

      <div className="rounded-xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <Workflow size={32} className="mx-auto mb-3" style={{ color: 'var(--accent)' }} />
        <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text)' }}>Dönem bazlı kapanış akışı</h3>
        <p className="text-[12.5px] max-w-lg mx-auto" style={{ color: 'var(--text-muted)' }}>
          Her mükellef için Onay → Rapor → Kontrol → Tamamlandı akışı. Tek tıkla &quot;Süreci Tamamla&quot; ile dönem kapanır, sonraki aşamaya geçilir.
        </p>
      </div>
    </div>
  );
}

function Stage({ label, count, tone, active }: { label: string; count: number; tone: string; active?: boolean }) {
  return (
    <div
      className="rounded-xl p-4 transition-colors cursor-pointer"
      style={{
        background: active ? `${tone}10` : 'var(--surface)',
        border: `1px solid ${active ? `${tone}50` : 'var(--border)'}`,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full" style={{ background: tone }} />
        <span className="text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>{label.toUpperCase()}</span>
      </div>
      <div className="text-[26px] font-semibold tabular-nums" style={{ color: tone, fontFamily: 'var(--font-heading)' }}>{count}</div>
    </div>
  );
}
