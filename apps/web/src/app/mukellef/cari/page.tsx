'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { fmtTRY, Section, Empty, Spinner, PageTitle, OzetCard, Badge, Th, THead } from '../_lib/shared';
import { Wallet, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

export default function MukellefCari() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-cari'],
    queryFn: () => taxpayerApi.get('/portal/cari').then((r) => r.data),
  });

  if (isLoading) return (<div><PageTitle ust="Ofis" baslik="Cari Hesabım" /><Spinner /></div>);

  const bakiye = data?.bakiye ?? 0;
  const hareketler: any[] = data?.hareketler || [];

  return (
    <div>
      <PageTitle ust="Ofis" baslik="Cari Hesabım" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <OzetCard icon={ArrowUpRight} label="Toplam Tahakkuk" value={fmtTRY(data?.tahakkukToplam ?? 0)} accent="#fbbf24" sub="tahakkuk eden" />
        <OzetCard icon={ArrowDownLeft} label="Toplam Tahsilat" value={fmtTRY(data?.tahsilatToplam ?? 0)} accent="#4ade80" sub="ödenen" />
        <OzetCard icon={Wallet} label="Açık Bakiye" value={fmtTRY(bakiye)} accent={bakiye > 0 ? '#f87171' : '#4ade80'} valueColor={bakiye > 0 ? '#f87171' : '#4ade80'} sub={bakiye > 0 ? 'kalan borç' : 'bakiye kapalı'} />
      </div>

      <Section baslik="Hareketler" aciklama="Tahakkuk ve tahsilat hareketleriniz, yeni tarihliler üstte.">
        {hareketler.length === 0 ? <div className="px-5 py-5"><Empty>Cari hareket bulunamadı.</Empty></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <THead>
                <Th>Tarih</Th>
                <Th>Açıklama</Th>
                <Th align="center">Tür</Th>
                <Th align="right">Tutar</Th>
              </THead>
              <tbody>
                {hareketler.map((h, i) => {
                  const tahsilat = h.tip === 'TAHSILAT' || h.tip === 'IADE';
                  const renk = tahsilat ? '#4ade80' : '#fbbf24';
                  const turLabel = h.tip === 'TAHSILAT' ? 'Tahsilat' : h.tip === 'IADE' ? 'İade' : h.tip === 'TAHAKKUK' ? 'Tahakkuk' : (h.tip || '');
                  return (
                    <tr key={i} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                      <td className="px-4 py-2.5 text-[12.5px] whitespace-nowrap" style={{ color: 'rgba(250,250,249,0.55)' }}>{h.tarih ? new Date(h.tarih).toLocaleDateString('tr-TR') : '—'}</td>
                      <td className="px-4 py-2.5 text-[13px] max-w-[360px] truncate" style={{ color: '#fafaf9' }}>{h.aciklama || turLabel}</td>
                      <td className="px-4 py-2.5 text-center"><Badge color={renk} icon={tahsilat ? ArrowDownLeft : ArrowUpRight}>{turLabel}</Badge></td>
                      <td className="px-4 py-2.5 text-right text-[13px] tabular-nums font-semibold" style={{ color: tahsilat ? '#4ade80' : '#fafaf9' }}>{tahsilat ? '−' : '+'}{fmtTRY(h.tutar)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
