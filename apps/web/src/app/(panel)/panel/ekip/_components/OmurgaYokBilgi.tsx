'use client';

import { PlugZap } from 'lucide-react';
import { EKIP_ACCENT } from './ortak';

/** API 404 → omurga (backend) henüz yayında değil. Çökme yok, sakin bilgi. */
export function OmurgaYokBilgi({ kucuk = false }: { kucuk?: boolean }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl ${kucuk ? 'px-3 py-2.5' : 'px-4 py-4'}`}
      style={{
        background: `radial-gradient(120% 120% at 0% 0%, ${EKIP_ACCENT}18, transparent 50%), rgba(255,255,255,0.03)`,
        border: `1px dashed ${EKIP_ACCENT}55`,
      }}
    >
      <PlugZap size={kucuk ? 16 : 20} className="mt-0.5 flex-shrink-0" style={{ color: EKIP_ACCENT }} />
      <div>
        <div className={`${kucuk ? 'text-xs' : 'text-sm'} font-bold`} style={{ color: '#fafaf9' }}>
          Omurga henüz yayında değil
        </div>
        <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.6)' }}>
          Ekip uçları (<code className="opacity-80">/ekip/…</code>) sunucuda bulunamadı. Backend yayına alınınca bu ekran kendiliğinden dolar.
        </div>
      </div>
    </div>
  );
}
