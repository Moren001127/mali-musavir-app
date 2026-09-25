'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { donemEtiketi } from '../_lib/bicim';

/*
 * DÖNEM SEÇİCİ — takvimli (2026-09-25, Muzaffer Bey: "döneme tıklayınca en fazla Eylül 2026 çıkıyor, Ekim ayı
 * ne olacak · dönem seçme tablosu da çok kötü, onu da tekrar tasarla, takvimli olsun").
 * Eski hâli bu aydan geriye 12 aylık düz bir <select> idi: yıl değiştirilemiyor, ileri gidilemiyordu.
 * Yeni hâli yıl gezinmeli 12 aylık ızgara — geçmiş yıllara da gidilir, yıl değişince aylar yerinde kalır.
 * Henüz gelmemiş aylar soluk ve tıklanamaz (Dijital Vergi Dairesi'nde o ayın verisi olamaz); ay dönünce
 * kendiliğinden açılır. En üstte "Tüm dönemler".
 */

const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
/** Portalda veri olan en eski yıl — daha geriye gitmenin anlamı yok. */
const EN_ESKI_YIL = 2020;

const ay2 = (n: number) => String(n).padStart(2, '0');

export interface DonemSeciciProps {
  /** 'YYYY-MM' ya da '' (tüm dönemler) */
  deger: string;
  onDegis: (donem: string) => void;
  disabled?: boolean;
  /** Kapalıyken gösterilecek sebep (title) */
  kapaliIpucu?: string;
}

export function DonemSecici({ deger, onDegis, disabled = false, kapaliIpucu }: DonemSeciciProps) {
  const [acik, setAcik] = useState(false);
  const kok = useRef<HTMLDivElement>(null);

  const bugun = useMemo(() => new Date(), []);
  const buYil = bugun.getFullYear();
  const buAy = bugun.getMonth() + 1;

  const seciliYil = useMemo(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(deger);
    return m ? Number(m[1]) : buYil;
  }, [deger, buYil]);
  const seciliAy = useMemo(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(deger);
    return m ? Number(m[2]) : 0;
  }, [deger]);

  const [yil, setYil] = useState(seciliYil);
  useEffect(() => { if (acik) setYil(seciliYil); }, [acik, seciliYil]);

  // Dışarı tıklama + Esc
  useEffect(() => {
    if (!acik) return;
    const disari = (e: MouseEvent) => { if (kok.current && !kok.current.contains(e.target as Node)) setAcik(false); };
    const tus = (e: KeyboardEvent) => { if (e.key === 'Escape') setAcik(false); };
    document.addEventListener('mousedown', disari);
    document.addEventListener('keydown', tus);
    return () => { document.removeEventListener('mousedown', disari); document.removeEventListener('keydown', tus); };
  }, [acik]);

  const sec = (ay: number) => { onDegis(`${yil}-${ay2(ay)}`); setAcik(false); };
  const gelecekMi = (ay: number) => yil > buYil || (yil === buYil && ay > buAy);

  return (
    <div className="gs-donem" ref={kok}>
      <button
        type="button"
        className="gs-donem-dugme"
        disabled={disabled}
        title={disabled ? kapaliIpucu : 'Dönem seçin — yıl okları ile geçmiş yıllara gidebilirsiniz'}
        aria-haspopup="dialog"
        aria-expanded={acik}
        onClick={() => setAcik((a) => !a)}
      >
        <span className="gs-alan-ikon" data-ton="donem" aria-hidden><CalendarDays size={14} strokeWidth={2} /></span>
        <span className="gs-donem-metin">{deger ? donemEtiketi(deger) : 'Tüm dönemler'}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden className="gs-donem-ok" />
      </button>

      {acik && !disabled && (
        <div className="gs-donem-panel" role="dialog" aria-label="Dönem seçimi">
          <button type="button" className="gs-donem-tumu" data-secili={deger === '' ? 'true' : undefined} onClick={() => { onDegis(''); setAcik(false); }}>
            Tüm dönemler
          </button>

          <div className="gs-donem-yil">
            <button type="button" className="gs-donem-gez" disabled={yil <= EN_ESKI_YIL} onClick={() => setYil((y) => y - 1)} aria-label="Önceki yıl">
              <ChevronLeft size={16} strokeWidth={2.2} />
            </button>
            <b>{yil}</b>
            <button type="button" className="gs-donem-gez" disabled={yil >= buYil} onClick={() => setYil((y) => y + 1)} aria-label="Sonraki yıl">
              <ChevronRight size={16} strokeWidth={2.2} />
            </button>
          </div>

          <div className="gs-donem-izgara">
            {AY_KISA.map((ad, i) => {
              const ay = i + 1;
              const kapali = gelecekMi(ay);
              return (
                <button
                  key={ad}
                  type="button"
                  className="gs-donem-ay"
                  disabled={kapali}
                  data-secili={yil === seciliYil && ay === seciliAy ? 'true' : undefined}
                  data-buay={yil === buYil && ay === buAy ? 'true' : undefined}
                  title={kapali ? `${ad} ${yil} henüz gelmedi` : `${ad} ${yil}`}
                  onClick={() => sec(ay)}
                >
                  {ad}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
