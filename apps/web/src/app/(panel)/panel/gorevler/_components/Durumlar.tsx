'use client';

import { Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { IKINCIL, KENAR, KIRMIZI, METIN } from './ortak';

/** Yükleniyor iskeleti — tablo biçiminde 6 satır. */
export function Iskelet({ satir = 6 }: { satir?: number }) {
  return (
    <div className="overflow-hidden rounded-xl" style={{ border: `1px solid ${KENAR}`, background: 'rgba(255,255,255,0.02)' }} aria-busy="true" aria-label="Yükleniyor">
      <div className="h-8" style={{ background: 'rgba(91,141,239,.14)', borderBottom: `1px solid ${KENAR}` }} />
      {Array.from({ length: satir }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3" style={{ borderBottom: i < satir - 1 ? `1px solid ${KENAR}` : undefined }}>
          <span className="h-3.5 w-3.5 rounded" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <span className="h-3.5 animate-pulse rounded" style={{ background: 'rgba(255,255,255,0.10)', width: `${38 + ((i * 17) % 40)}%` }} />
          <span className="ml-auto h-3.5 w-16 animate-pulse rounded" style={{ background: 'rgba(255,255,255,0.07)' }} />
          <span className="h-3.5 w-12 animate-pulse rounded" style={{ background: 'rgba(255,255,255,0.07)' }} />
          <span className="h-3.5 w-20 animate-pulse rounded" style={{ background: 'rgba(255,255,255,0.07)' }} />
        </div>
      ))}
      <div className="flex items-center justify-center gap-2 py-3 text-[12px]" style={{ color: IKINCIL }}>
        <Loader2 size={13} className="animate-spin" /> Ajanda alınıyor…
      </div>
    </div>
  );
}

/** Hata durumu — "Veri alınamadı · Tekrar dene". */
export function HataDurumu({ mesaj, onTekrar, deneniyor }: { mesaj?: string; onTekrar: () => void; deneniyor?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl px-4 py-10 text-center" style={{ border: `1px solid ${KIRMIZI}44`, background: `${KIRMIZI}0d` }} role="alert">
      <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: `${KIRMIZI}1a`, color: KIRMIZI }}>
        <WifiOff size={18} />
      </span>
      <div className="text-[13.5px] font-bold" style={{ color: METIN }}>
        Veri alınamadı
      </div>
      {mesaj && (
        <div className="max-w-md text-[12px]" style={{ color: IKINCIL }}>
          {mesaj}
        </div>
      )}
      <button
        type="button"
        onClick={onTekrar}
        disabled={deneniyor}
        className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-bold transition hover:brightness-110 disabled:opacity-50"
        style={{ background: `${KIRMIZI}22`, color: '#fca5a5', border: `1px solid ${KIRMIZI}66` }}
      >
        {deneniyor ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Tekrar dene
      </button>
    </div>
  );
}
