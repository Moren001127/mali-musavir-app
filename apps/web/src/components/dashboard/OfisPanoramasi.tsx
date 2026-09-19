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

export function OfisPanoramasi({ donem, donemTuru, setDonem, setDonemTuru }: PanoramaPeriodProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const fit = () => {
      const available = window.innerHeight - grid.getBoundingClientRect().top - 16;
      grid.style.setProperty('--panorama-height', `${Math.max(330, Math.min(550, available))}px`);
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
  return (
    <section className="ofis-panorama" aria-label="Ofisin beyanname, SGK, e-defter ve fatura görünümü">
      <div className="ofis-panorama__controls">
        <span>Ofisin genel görünümü</span>
        <div>
          <select aria-label="Grafik dönem türü" value={donemTuru} onChange={event => setDonemTuru(event.target.value as DonemTuru)}>
            <option value="VERILME">Verilme dönemi</option><option value="VERGI">Vergi dönemi</option>
          </select>
          <input aria-label="Grafik dönemi" type="month" value={donem} onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) setDonem(event.target.value); }} />
        </div>
      </div>
      <div ref={gridRef} className="ofis-panorama__grid">
        <BeyanGrafigi rows={rows} loading={query.isLoading} error={query.isError} />
        <div className="ofis-panorama__aside">
          <YukumlulukKarti kind="sgk" row={rows.find(row => row.beyanTipi === 'BILDIRGE')} loading={query.isLoading} error={query.isError} />
          <YukumlulukKarti kind="edefter" row={rows.find(row => row.beyanTipi === 'EDEFTER')} loading={query.isLoading} error={query.isError} />
          <FaturaGrafikKarti period={donem} />
        </div>
      </div>
    </section>
  );
}

