'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Loader2 } from 'lucide-react';
import { getPano, isOmurgaYok, type PanoSatiri } from '@/lib/ekip';
import { ASAMALAR, asamaRengi, donemEtiketi, kartArkaPlan } from './ortak';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';

const ACCENT = '#a78bfa'; // dönem panosu — mor

/** Son 3 dönemi (tüm satırlardan) azalan sırayla topla. */
function sonDonemler(satirlar: PanoSatiri[], n = 3): string[] {
  const s = new Set<string>();
  for (const r of satirlar) for (const d of r.donemler || []) if (d.donem) s.add(d.donem);
  return [...s].sort().reverse().slice(0, n);
}

function AsamaNoktalari({ satir, donem }: { satir: PanoSatiri; donem: string }) {
  const d = satir.donemler?.find((x) => x.donem === donem);
  if (!d) {
    return <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>;
  }
  const tamam = ASAMALAR.filter((a) => d.asamalar?.[a.key] === 'tamam').length;
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {ASAMALAR.map((a) => {
          const durum = d.asamalar?.[a.key];
          return (
            <span
              key={a.key}
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                background: asamaRengi(durum),
                boxShadow: durum === 'tamam' ? '0 0 6px rgba(74,222,128,0.6)' : durum === 'eksik' ? '0 0 6px rgba(251,146,60,0.5)' : 'none',
              }}
              title={`${a.ad}: ${durum === 'tamam' ? 'tamam' : durum === 'eksik' ? 'eksik' : 'yok'}`}
            />
          );
        })}
      </div>
      <span className="text-[10px] tabular-nums" style={{ color: 'rgba(250,250,249,0.45)' }}>
        {tamam}/{ASAMALAR.length}
      </span>
    </div>
  );
}

/** Mükellef × son 3 dönem × 6 aşama. Tablo kendi içinde kayar; sayfa yatay kaymaz. */
export function DonemPanosu() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ekip-pano'],
    queryFn: getPano,
    refetchInterval: 60_000,
    retry: (n, e) => !isOmurgaYok(e) && n < 2,
  });
  const donemler = useMemo(() => sonDonemler(data || []), [data]);

  return (
    <section className="relative overflow-hidden rounded-2xl" style={kartArkaPlan(ACCENT)}>
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT}55 55%, transparent)` }} />
      <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <CalendarRange size={16} style={{ color: ACCENT }} />
        <h2 className="text-sm font-bold" style={{ color: '#fafaf9' }}>Dönem Panosu</h2>
        <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>mükellef × dönem × aşama — koordinatörün ana verisi</span>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[10px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: asamaRengi('tamam') }} /> tamam</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: asamaRengi('eksik') }} /> eksik</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: asamaRengi('yok') }} /> yok</span>
        </div>
      </div>

      <div className="px-2 py-2 text-[10px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
        Nokta sırası: {ASAMALAR.map((a) => a.ad).join(' · ')}
      </div>

      <div className="p-3 pt-0">
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-xs" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Loader2 size={12} className="animate-spin" /> Pano yükleniyor…
          </div>
        ) : error ? (
          isOmurgaYok(error) ? (
            <OmurgaYokBilgi kucuk />
          ) : (
            <div className="py-4 text-xs" style={{ color: '#fca5a5' }}>Pano alınamadı: {(error as any)?.message || 'hata'}</div>
          )
        ) : !data?.length ? (
          <div className="py-8 text-center text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Pano boş — koordinatör ilk koşusunda dönemleri dolduracak.
          </div>
        ) : (
          <div className="max-h-[520px] overflow-auto rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.35)' }}>
                  <th className="px-3 py-2 text-left font-semibold" style={{ color: 'rgba(250,250,249,0.7)' }}>Mükellef</th>
                  <th className="px-3 py-2 text-left font-semibold" style={{ color: 'rgba(250,250,249,0.7)' }}>Defter</th>
                  {donemler.map((d) => (
                    <th key={d} className="px-3 py-2 text-left font-semibold" style={{ color: ACCENT }}>
                      {donemEtiketi(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((s, i) => (
                  <tr
                    key={s.taxpayerId}
                    style={{ background: i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent', borderTop: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <td className="max-w-[260px] truncate px-3 py-2 font-medium" style={{ color: '#fafaf9' }} title={s.unvan}>
                      {s.unvan}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'rgba(250,250,249,0.55)' }}>{s.defterTuru || '-'}</td>
                    {donemler.map((d) => (
                      <td key={d} className="px-3 py-2">
                        <AsamaNoktalari satir={s} donem={d} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
