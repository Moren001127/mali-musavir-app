'use client';
import { portalStyle } from '@/lib/portal-theme';


import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Send } from 'lucide-react';
import type { EkipOnay } from '@/lib/ekip';
import { SAKIN, sakinDugme, telefonMaskele, telefonMu } from './ortak';

/**
 * Kart içi iki adımlı teyit — tarayıcı onay penceresi kullanılmaz.
 * 5 sn sonra kendiliğinden kapanır; `mesgul` çift tıkı keser. CanliAkis ve VakaSatiri ortak kullanır.
 * (OnayKuyrugu 2026-09-13'te KALKTI: onaylar artık akışta vaka satırının içinde — "Onayınızı bekleyen" kutusu.)
 */
export function OnayTeyit({
  metin,
  evetEtiketi = 'Evet, gönder',
  mesgul,
  onEvet,
  onVazgec,
}: {
  metin: ReactNode;
  evetEtiketi?: string;
  mesgul: boolean;
  onEvet: () => void;
  onVazgec: () => void;
}) {
  const [kalan, setKalan] = useState(5);
  // Üst bileşen saniyede bir yeniden çizilse de (canlı sayaç) geri sayım sıfırlanmasın: sayaç render'dan bağımsız
  const vazgecRef = useRef(onVazgec);
  vazgecRef.current = onVazgec;
  useEffect(() => {
    if (mesgul) return;
    const t = setInterval(() => setKalan((k) => k - 1), 1000);
    return () => clearInterval(t);
  }, [mesgul]);
  useEffect(() => {
    if (kalan <= 0 && !mesgul) vazgecRef.current();
  }, [kalan, mesgul]);

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg px-3 py-2 text-[12.5px]" style={portalStyle({ background: 'rgba(214,69,69,0.08)', border: `1px solid ${SAKIN.kirmizi}88`, color: SAKIN.metin })}>
      <span className="min-w-0 leading-snug">{metin}</span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={mesgul}
          onClick={onEvet}
          className="flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
          style={portalStyle({ background: SAKIN.kirmizi, border: `1px solid ${SAKIN.kirmizi}`, color: '#fff' })}
        >
          {mesgul ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} {evetEtiketi}
        </button>
        <button
          type="button"
          disabled={mesgul}
          onClick={onVazgec}
          className="rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
          style={portalStyle(sakinDugme('ikincil'))}
        >
          Vazgeç {!mesgul && <span className="opacity-60">({kalan})</span>}
        </button>
      </div>
    </div>
  );
}

/** Hedef: telefon ise maskeli, taxpayerId ise mükellef adı (backend `mukellefAd` varsa o). */
export function hedefMetni(o: Pick<EkipOnay, 'mukellefAd' | 'hedef'>, mukellefAd: (id?: string | null) => string | undefined): string {
  if (o.mukellefAd) return o.mukellefAd;
  if (!o.hedef) return '';
  if (telefonMu(o.hedef)) return telefonMaskele(o.hedef);
  return mukellefAd(o.hedef) || o.hedef;
}
