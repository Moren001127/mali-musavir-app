'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { Card, Empty, Spinner, PageTitle, Th, THead, openBelge } from '../_lib/shared';
import { ShieldCheck, ListChecks, Eye } from 'lucide-react';

function SgkTablo({ rows, accent }: { rows: any[]; accent: string }) {
  if (!rows || rows.length === 0) return <div className="px-5 pb-5"><Empty>Kayıt bulunmuyor.</Empty></div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <THead>
          <Th>Belge</Th>
          <Th>Dönem</Th>
          <Th>Tarih</Th>
          <Th align="center">Görüntüle</Th>
        </THead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <td className="px-4 py-2.5 text-[13px] max-w-[320px] truncate" style={{ color: '#fafaf9' }}>{s.title}</td>
              <td className="px-4 py-2.5 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.55)' }}>{s.period || '—'}</td>
              <td className="px-4 py-2.5 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>{s.issuedAt ? new Date(s.issuedAt).toLocaleDateString('tr-TR') : (s.createdAt ? new Date(s.createdAt).toLocaleDateString('tr-TR') : '—')}</td>
              <td className="px-4 py-2.5">
                <div className="flex justify-center">
                  {s.goruntulenebilir
                    ? <button type="button" onClick={() => openBelge('sgk', s.id)} title="Görüntüle" className="flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-white/[0.06]" style={{ border: `1px solid ${accent}45`, color: accent }}><Eye size={14} /></button>
                    : <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bolum({ icon: Icon, baslik, accent, children }: { icon: any; baslik: string; accent: string; children: React.ReactNode }) {
  return (
    <Card pad={false} accent={accent}>
      <div className="flex items-center gap-2 px-5 pt-4 pb-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${accent}18`, border: `1px solid ${accent}30`, color: accent }}><Icon size={14} /></span>
        <h2 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>{baslik}</h2>
      </div>
      {children}
    </Card>
  );
}

export default function MukellefSgk() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-sgk'],
    queryFn: () => taxpayerApi.get('/portal/sgk').then((r) => r.data),
  });

  return (
    <div className="space-y-5">
      <PageTitle ust="SGK" baslik="SGK Belgelerim" />
      {isLoading ? <Spinner /> : (
        <div className="space-y-5">
          <Bolum icon={ShieldCheck} baslik="SGK Tahakkuk Fişleri" accent="#4ade80">
            <SgkTablo rows={data?.tahakkuk || []} accent="#4ade80" />
          </Bolum>
          <Bolum icon={ListChecks} baslik="SGK Hizmet Listeleri" accent="#60a5fa">
            <SgkTablo rows={data?.hizmetListesi || []} accent="#60a5fa" />
          </Bolum>
          {data?.diger && data.diger.length > 0 && (
            <Bolum icon={ShieldCheck} baslik="Diğer SGK Belgeleri" accent="#d4b876">
              <SgkTablo rows={data.diger} accent="#d4b876" />
            </Bolum>
          )}
        </div>
      )}
    </div>
  );
}
