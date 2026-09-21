'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SORGU } from '../kosular';
import { DEPO, depoOku, depoYaz } from '../ortak';
import { AltSayfa } from './AltSayfa';
import { DonemHatti } from './DonemHatti';
import type { KomutTaslak } from './GorevKutusu';
import { taslakBirak } from './yardimci';

/**
 * /panel/ekip/donem — Dönem tablosu: boru + tablo + çoklu seçim "Personele ver" (kuyruk).
 * Satırdaki İşle/Kontrol et/Hazırla düğmeleri görev kutusunu doldurur (çalıştırmaz): taslak oturum deposuna bırakılır, ana sayfa açılır.
 */
export function DonemSayfasi() {
  const router = useRouter();
  const qc = useQueryClient();
  const [seciliDonem, setSeciliDonemState] = useState<string | null>(null);
  useEffect(() => {
    const d = depoOku(DEPO.donem);
    if (d) setSeciliDonemState(d);
  }, []);
  const setSeciliDonem = useCallback((d: string) => {
    setSeciliDonemState(d);
    depoYaz(DEPO.donem, d);
  }, []);
  const panoS = useQuery(SORGU.pano);
  const kadroS = useQuery(SORGU.kadro);
  const kuyrukS = useQuery(SORGU.kuyruk(false));
  const ajanlar = useMemo(() => kadroS.data || [], [kadroS.data]);
  const panoDonem = useMemo(() => {
    const s = new Set<string>();
    for (const o of panoS.data?.donemOzetleri || []) if (o.donem) s.add(o.donem);
    const liste = [...s].sort().reverse();
    return seciliDonem && liste.includes(seciliDonem) ? seciliDonem : liste[0] || null;
  }, [panoS.data, seciliDonem]);
  const panoOzet = useMemo(() => panoS.data?.donemOzetleri.find((o) => o.donem === panoDonem), [panoS.data, panoDonem]);

  const onTaslak = useCallback(
    (t: Omit<KomutTaslak, 'nonce'>) => {
      taslakBirak({ gorev: t.gorev, taxpayerId: t.taxpayerId, kaynak: 'pano' });
      router.push('/panel/ekip');
    },
    [router],
  );

  return (
    <AltSayfa baslik="Dönem tablosu" alt="Mükellef × aşama; seçip personele verebilirsiniz. İşlem düğmeleri Ekip sayfasındaki görev kutusunu doldurur, çalıştırmaz.">
      <DonemHatti
        pano={panoS.data}
        ozet={panoOzet}
        isLoading={panoS.isLoading}
        error={panoS.error}
        seciliDonem={seciliDonem}
        onDonemSec={setSeciliDonem}
        onTaslak={onTaslak}
        ajanlar={ajanlar}
        kuyrukDestek={kuyrukS.data?.destek !== false}
        onKuyrukOlustu={() => {
          qc.invalidateQueries({ queryKey: ['ekip-kuyruk'] });
          qc.invalidateQueries({ queryKey: ['ekip-durum'] });
        }}
      />
    </AltSayfa>
  );
}
