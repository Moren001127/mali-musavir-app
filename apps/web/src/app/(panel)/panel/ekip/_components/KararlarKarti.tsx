'use client';

import { Bell } from 'lucide-react';
import type { AkisSayaclari } from '@/lib/ekip';
import { CamKart, V5 } from './Cam';

/** Sayı kutusu — bekleyen varsa sarı parlar. */
function Sayi({ n, dikkat }: { n: number; dikkat: boolean }) {
  return (
    <span
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] text-[15px] font-extrabold"
      style={
        dikkat
          ? { fontFamily: V5.mono, color: '#ffd27a', background: 'rgba(242,182,77,0.12)', border: '1px solid rgba(242,182,77,0.5)', boxShadow: '0 0 16px rgba(242,182,77,0.2)' }
          : { fontFamily: V5.mono, color: V5.metin, background: 'rgba(0,0,0,0.3)', border: `1px solid ${V5.cizgi2}` }
      }
    >
      {n}
    </span>
  );
}

/**
 * Sizden beklenen v5 (sağ sütun): üç satır — onayınızı bekleyen gönderim · sizden istenen · geciken iş.
 * Satıra tıklayınca iş kayıtları o süzgece geçer.
 */
export function KararlarKarti({ sayaclar, onSuzgec }: { sayaclar: AkisSayaclari | undefined; onSuzgec: (f: 'onay' | 'istek' | 'suruyor') => void }) {
  const satirlar: Array<{ n: number; baslik: string; alt: string; suzgec: 'onay' | 'istek' | 'suruyor' }> = [
    { n: sayaclar?.onay ?? 0, baslik: 'Onayınızı bekleyen gönderim', alt: 'Mükellefe giden mesaj / e-posta', suzgec: 'onay' },
    { n: sayaclar?.istek ?? 0, baslik: 'Sizden istenen', alt: 'Karar, evrak, şifre', suzgec: 'istek' },
    { n: sayaclar?.gecikti ?? 0, baslik: 'Geciken iş', alt: '24 saati aşan ya da 2 devirden fazla', suzgec: 'suruyor' },
  ];
  return (
    <CamKart ton="coral" etiket="Sizden beklenen" ikon={<Bell size={17} />} baslik="Kararlar" dolguYok>
      <div className="flex flex-col gap-2 px-4 pb-4">
        {satirlar.map((s) => (
          <button
            key={s.suzgec}
            type="button"
            onClick={() => onSuzgec(s.suzgec)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-[filter] hover:brightness-125"
            style={{ background: 'rgba(255,255,255,0.035)', border: `1px solid ${V5.cizgi}` }}
            title="İş kayıtlarında bu kutuyu göster"
          >
            <Sayi n={s.n} dikkat={s.n > 0} />
            <span className="min-w-0">
              <span className="block text-[13px] font-bold" style={{ color: V5.metin }}>
                {s.baslik}
              </span>
              <span className="block text-[11.5px]" style={{ color: V5.soluk }}>
                {s.alt}
              </span>
            </span>
          </button>
        ))}
      </div>
    </CamKart>
  );
}
