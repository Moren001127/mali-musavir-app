'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { fmtTRY, Card, Empty, Spinner, PageTitle, OzetCard } from '../_lib/shared';
import { Wallet, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

export default function MukellefCari() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-cari'],
    queryFn: () => taxpayerApi.get('/portal/cari').then((r) => r.data),
  });

  if (isLoading) return (<div><PageTitle ust="Ofis" baslik="Cari Hesabım" /><Spinner /></div>);

  const bakiye = data?.bakiye ?? 0;

  return (
    <div>
      <PageTitle ust="Ofis" baslik="Cari Hesabım" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <OzetCard icon={ArrowUpRight} label="Toplam Tahakkuk" value={fmtTRY(data?.tahakkukToplam ?? 0)} accent="#fbbf24" sub="tahakkuk eden" />
        <OzetCard icon={ArrowDownLeft} label="Toplam Tahsilat" value={fmtTRY(data?.tahsilatToplam ?? 0)} accent="#4ade80" sub="ödenen" />
        <OzetCard icon={Wallet} label="Açık Bakiye" value={fmtTRY(bakiye)} accent={bakiye > 0 ? '#f87171' : '#4ade80'} sub={bakiye > 0 ? 'kalan borç' : 'bakiye'} />
      </div>

      <Card>
        <h2 className="text-[14px] font-semibold mb-3" style={{ color: '#fafaf9' }}>Hareketler</h2>
        {(!data?.hareketler || data.hareketler.length === 0) ? <Empty>Cari hareket bulunamadı.</Empty> : (
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            {data.hareketler.map((h: any, i: number) => {
              const tahsilat = h.tip === 'TAHSILAT' || h.tip === 'IADE';
              const renk = tahsilat ? '#4ade80' : '#fbbf24';
              const Icon = tahsilat ? ArrowDownLeft : ArrowUpRight;
              const turLabel = h.tip === 'TAHSILAT' ? 'Tahsilat' : h.tip === 'IADE' ? 'İade' : h.tip === 'TAHAKKUK' ? 'Tahakkuk' : (h.tip || '');
              return (
                <div key={i} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0" style={{ background: `${renk}16`, border: `1px solid ${renk}30`, color: renk }}><Icon size={14} /></span>
                    <div className="min-w-0">
                      <span className="text-[13px] block truncate" style={{ color: '#fafaf9' }}>{h.aciklama || turLabel}</span>
                      <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>{turLabel}{h.tarih ? ` · ${new Date(h.tarih).toLocaleDateString('tr-TR')}` : ''}</span>
                    </div>
                  </div>
                  <span className="text-[13px] tabular-nums font-semibold shrink-0" style={{ color: tahsilat ? '#4ade80' : '#fafaf9' }}>
                    {tahsilat ? '−' : '+'}{fmtTRY(h.tutar)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
