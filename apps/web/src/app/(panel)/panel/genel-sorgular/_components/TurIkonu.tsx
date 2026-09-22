'use client';

import { ClipboardList, CreditCard, FileText, Gavel, LayoutGrid, Wallet, type LucideIcon } from 'lucide-react';
import type { SorguTuru } from '@/lib/genel-sorgular';

/*
 * Tür simgeleri (2026-09-22, Muzaffer Bey: "filtreleme ikonlarını da renklendirelim, çok düz duruyor").
 * Her sorgu türünün kendi rengi var (rehber ailesi): Vergi Borcu çivit · e-Haciz kırmızı · Yoklama / Denetim kehribar ·
 * POS mor · Gelen e-Arşiv mavi · Tümü kurşuni. Simge her zaman YAZININ YANINDA durur, yerine geçmez.
 * Renkler CSS'te `.gs-tur-ikon[data-tur=…]` altında; burada yalnız hangi simge.
 */
export type IkonTuru = SorguTuru | 'TUMU';

const IKON: Record<IkonTuru, LucideIcon> = {
  TUMU: LayoutGrid,
  VERGI_BORCU: Wallet,
  E_HACIZ: Gavel,
  YOKLAMA_DENETIM: ClipboardList,
  POS: CreditCard,
  GELEN_EARSIV: FileText,
};

/** Yumuşak tonlu kutu içinde tür simgesi. `buyuk` → kart başlığı (30px), değilse sekme (22px). */
export function TurIkonu({ tur, buyuk = false }: { tur: IkonTuru; buyuk?: boolean }) {
  const Simge = IKON[tur];
  return (
    <span className="gs-tur-ikon" data-tur={tur} data-buyuk={buyuk ? 'true' : undefined} aria-hidden>
      <Simge size={buyuk ? 16 : 13} strokeWidth={2} />
    </span>
  );
}
