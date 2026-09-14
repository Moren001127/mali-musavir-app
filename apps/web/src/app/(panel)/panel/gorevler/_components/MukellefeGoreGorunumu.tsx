'use client';

import { useMemo } from 'react';
import { Building2 } from 'lucide-react';
import { taxpayerName, type EkipIstek, type Task } from '@/lib/tasks';
import { BosDurum } from '../../ekip/_components/Kart';
import type { GorevEylemleri } from './eylemler';
import { GorevTablosu } from './GorevTablosu';
import { EKIP_RENK, etkinTarih, type Satir, type SatirGrubu } from './ortak';

/** SAKİN PALET (2026-09-14): mükellef grupları için gökkuşağı şerit YOK — hepsi aynı soluk gri (GorevTablosu 3px şerit). */
const GRUP_SERIT = '#9ca3af';

/** Mükellefe göre — mükellef başlıklı gruplar (açık görev sayısı), grup içi aynı tablo; mükellefsizler en sonda. */
export function MukellefeGoreGorunumu({
  gorevler,
  istekler,
  eylemler,
  secili,
  onSec,
  onGrupSec,
  acikId,
}: {
  gorevler: Task[];
  istekler: EkipIstek[];
  eylemler: GorevEylemleri;
  secili: Set<string>;
  onSec: (id: string, v: boolean) => void;
  onGrupSec: (ids: string[], v: boolean) => void;
  acikId?: string | null;
}) {
  const gruplar = useMemo<SatirGrubu[]>(() => {
    const m = new Map<string, { ad: string; satirlar: Satir[]; acik: number }>();
    const al = (id: string, ad: string) => {
      let v = m.get(id);
      if (!v) {
        v = { ad, satirlar: [], acik: 0 };
        m.set(id, v);
      }
      return v;
    };
    for (const i of istekler) {
      const v = al(i.taxpayerId || '__yok', i.mukellefAd || 'Mükellefsiz');
      v.satirlar.push({ tip: 'istek', istek: i });
      v.acik += 1;
    }
    const sirali = [...gorevler].sort((a, b) => {
      const ta = etkinTarih(a) || '9999';
      const tb = etkinTarih(b) || '9999';
      return ta.localeCompare(tb);
    });
    for (const t of sirali) {
      const v = al(t.taxpayerId || '__yok', taxpayerName(t.taxpayer) || 'Mükellefsiz');
      v.satirlar.push({ tip: 'gorev', gorev: t });
      if (t.status !== 'DONE' && t.status !== 'CANCELLED') v.acik += 1;
    }
    const liste = [...m.entries()]
      .sort(([ka, a], [kb, b]) => {
        if (ka === '__yok') return 1;
        if (kb === '__yok') return -1;
        return b.acik - a.acik || a.ad.localeCompare(b.ad, 'tr');
      })
      .map(([key, v]) => ({
        key,
        ad: v.ad,
        renk: GRUP_SERIT,
        satirlar: v.satirlar,
        ek: `${v.acik} açık`,
      }));
    return liste;
  }, [gorevler, istekler]);

  return (
    <GorevTablosu
      gruplar={gruplar}
      secili={secili}
      onSec={onSec}
      onGrupSec={onGrupSec}
      eylemler={eylemler}
      acikId={acikId}
      bos={<BosDurum ikon={<Building2 size={18} />} metin="Mükellefe bağlı görev yok" renk={EKIP_RENK} />}
    />
  );
}
