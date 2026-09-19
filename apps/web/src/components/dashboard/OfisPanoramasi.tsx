'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { beyannameTakipApi, type DonemTuru } from '@/lib/beyanname-takip';
import { BeyanGrafigi } from './BeyanGrafigi';
import { YukumlulukKarti } from './YukumlulukKarti';
import { FaturaGrafikKarti } from './FaturaGrafikKarti';
import './ofis-panoramasi.css';

export type PanoramaPeriodProps = {
  donem: string;
  donemTuru: DonemTuru;
  setDonem: (value: string) => void;
  setDonemTuru: (value: DonemTuru) => void;
};

export function OfisPanoramasi({ donem, donemTuru }: PanoramaPeriodProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const fit = () => {
      // Alttaki dönem seçimine kaydırıldığında grafik yüksekliği büyümesin.
      let scrollOffset = window.scrollY;
      let parent = grid.parentElement;
      while (parent && parent !== document.body) {
        scrollOffset += parent.scrollTop;
        parent = parent.parentElement;
      }
      const available = window.innerHeight - grid.getBoundingClientRect().top - scrollOffset - 16;
      grid.style.setProperty('--panorama-height', `${Math.max(280, Math.min(680, available))}px`);
    };
    const observer = new ResizeObserver(fit);
    const root = grid.closest('[data-dashboard-root]');
    if (root) observer.observe(root);
    window.addEventListener('resize', fit);
    fit();
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, []);
  const query = useQuery({
    queryKey: ['beyanname-ozet', donem, donemTuru],
    queryFn: () => beyannameTakipApi.listOzet(donem, donemTuru),
    staleTime: 5 * 60 * 1000,
  });
  const rows = query.data?.rows ?? [];
  const invoicePeriod = donemTuru === 'VERGI' ? donem : rows.find(row => row.beyanTipi === 'KDV1')?.vergiDonem ?? '';
  return (
    <section className="ofis-panorama" aria-label="Ofisin beyanname, SGK, e-defter ve fatura görünümü">
      <div ref={gridRef} className="ofis-panorama__grid">
        <BeyanGrafigi rows={rows} loading={query.isLoading} error={query.isError} />
        <div className="ofis-panorama__aside">
          <YukumlulukKarti kind="sgk" row={rows.find(row => row.beyanTipi === 'BILDIRGE')} loading={query.isLoading} error={query.isError} />
          <YukumlulukKarti kind="edefter" row={rows.find(row => row.beyanTipi === 'EDEFTER')} loading={query.isLoading} error={query.isError} />
          <FaturaGrafikKarti period={invoicePeriod} />
        </div>
      </div>
    </section>
  );
}

