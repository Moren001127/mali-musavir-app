'use client';

import { useQueries } from '@tanstack/react-query';
import { SORGU_TURLERI, SORGU_TURU_ADI, genelSorgularApi, type GuncelYaniti, type SorguTuru } from '@/lib/genel-sorgular';
import { adet } from '../_lib/bicim';
import { TurIkonu } from './TurIkonu';

/**
 * Tür sekmeleri: Tümü + 5 sorgu türü. Her sekmede süzgece uyan GÜNCEL kayıt sayısı (kurşuni rozet):
 * Vergi Borcu → mükellef · E-Haciz → bildiri · Yoklama / Denetim → tutanak · POS → satır · Gelen e-Arşiv → fatura.
 * Sayılar tabloların kullandığı uçtan (pageSize=1) gelir; araç çubuğundaki Sorgula bitince aynı anahtarla yenilenir.
 * Sekmeler YALNIZ mükellef seçiliyken çizilir (2026-09-25): sayılar da o mükellefin sayılarıdır.
 * "Tümü" = o mükellefin türleri alt alta; tek tür seçilince yalnız o tablo (?tur=).
 */
export function TurSekmeleri({
  secili,
  onSec,
  suzgec,
}: {
  secili: SorguTuru | null;
  onSec: (t: SorguTuru | null) => void;
  suzgec: { taxpayerId?: string; donem?: string };
}) {
  const sayilar = useQueries({
    queries: SORGU_TURLERI.map((t) => {
      const ayBazli = t === 'POS' || t === 'GELEN_EARSIV';
      return {
        queryKey: ['genel-sorgular', 'guncel', 'sayi', t, suzgec.taxpayerId || '', ayBazli ? suzgec.donem || '' : ''],
        queryFn: () => genelSorgularApi.guncel({ tur: t, taxpayerId: suzgec.taxpayerId, donem: ayBazli ? suzgec.donem : undefined, page: 1, pageSize: 1 }),
        staleTime: 30_000,
        placeholderData: (onceki: GuncelYaniti | undefined) => onceki,
      };
    }),
  });

  return (
    <div className="gs-turler" role="tablist" aria-label="Sorgu türü">
      <button type="button" role="tab" className="gs-tur" aria-selected={secili === null} onClick={() => onSec(null)} title="Bütün sorgular alt alta">
        <TurIkonu tur="TUMU" />
        Tümü
      </button>
      {SORGU_TURLERI.map((t, i) => {
        const n = sayilar[i].data?.total ?? null;
        return (
          <button key={t} type="button" role="tab" className="gs-tur" aria-selected={secili === t} onClick={() => onSec(t)} title={`${SORGU_TURU_ADI[t]} — ${n === null ? 'sayılıyor' : `${adet(n)} ${birim(t)}`}`}>
            <TurIkonu tur={t} />
            {SORGU_TURU_ADI[t]}
            {n !== null && n > 0 && <span className="gs-tur-sayi">{adet(n)}</span>}
          </button>
        );
      })}
    </div>
  );
}

function birim(tur: SorguTuru): string {
  switch (tur) {
    case 'VERGI_BORCU': return 'mükellef';
    case 'E_HACIZ': return 'bildiri';
    case 'YOKLAMA_DENETIM': return 'tutanak';
    case 'POS': return 'satır';
    case 'GELEN_EARSIV': return 'fatura';
  }
}
