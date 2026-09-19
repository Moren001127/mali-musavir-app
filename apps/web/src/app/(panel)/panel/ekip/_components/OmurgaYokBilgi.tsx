'use client';
import { portalStyle } from '@/lib/portal-theme';


import { PlugZap } from 'lucide-react';
import { SAKIN } from './ortak';

/** API 404 → omurga (backend) henüz yayında değil. Çökme yok, sakin bilgi. */
export function OmurgaYokBilgi({ kucuk = false }: { kucuk?: boolean }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl ${kucuk ? 'px-3 py-2.5' : 'px-4 py-4'}`}
      style={portalStyle({ background: SAKIN.zemin, border: `1px dashed ${SAKIN.vurgu}66` })}
    >
      <PlugZap size={kucuk ? 16 : 20} className="mt-0.5 flex-shrink-0" style={portalStyle({ color: SAKIN.vurguAcik })} />
      <div>
        <div className={`${kucuk ? 'text-xs' : 'text-sm'} font-semibold`} style={portalStyle({ color: SAKIN.metin })}>
          Omurga henüz yayında değil
        </div>
        <div className="text-[11px] leading-relaxed" style={portalStyle({ color: SAKIN.ikincil })}>
          Ekip uçları (<code className="opacity-80">/ekip/…</code>) sunucuda bulunamadı. Backend yayına alınınca bu ekran kendiliğinden dolar.
        </div>
      </div>
    </div>
  );
}
