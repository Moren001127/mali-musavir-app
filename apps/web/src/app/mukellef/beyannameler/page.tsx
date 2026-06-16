'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { fmtTRY, DURUM, Card, Empty, Spinner, PageTitle } from '../_lib/shared';

export default function MukellefBeyannameler() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['portal-beyannameler'],
    queryFn: () => taxpayerApi.get('/portal/beyannameler').then((r) => r.data),
  });

  return (
    <div>
      <PageTitle ust="Vergi & Beyan" baslik="Beyannamelerim" />
      {isLoading ? <Spinner /> : (
        <Card>
          {(!data || data.length === 0) ? <Empty>Beyanname kaydı bulunamadı.</Empty> : (
            <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              {data.map((b: any, i: number) => {
                const d = DURUM[b.durum] || DURUM.beklemede;
                return (
                  <div key={i} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0">
                      <span className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>{b.beyanTipi}</span>
                      <span className="text-[12.5px] ml-2" style={{ color: 'rgba(250,250,249,0.45)' }}>{b.donem}</span>
                      {b.onayTarihi ? <span className="text-[11.5px] ml-2" style={{ color: 'rgba(250,250,249,0.35)' }}>· onay {new Date(b.onayTarihi).toLocaleDateString('tr-TR')}</span> : null}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {b.tahakkukTutari ? <span className="text-[13px] tabular-nums" style={{ color: 'rgba(250,250,249,0.65)' }}>{fmtTRY(b.tahakkukTutari)}</span> : null}
                      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-md" style={{ background: `${d.color}1a`, color: d.color }}><d.Icon size={12} /> {d.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
