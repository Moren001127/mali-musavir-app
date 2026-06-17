'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { GOLD, Card, Empty, Spinner, PageTitle, Th, THead, openBelge } from '../_lib/shared';
import { Eye } from 'lucide-react';

const KATEGORI: Record<string, string> = {
  SOZLESME: 'Sözleşme', FATURA: 'Fatura', BEYANNAME: 'Beyanname', EVRAK: 'Evrak', DIGER: 'Diğer',
};

export default function MukellefEvraklar() {
  const { data: evraklar = [], isLoading } = useQuery({
    queryKey: ['portal-evraklar'],
    queryFn: () => taxpayerApi.get('/portal/evraklar').then((r) => r.data),
  });

  return (
    <div>
      <PageTitle ust="Arşiv" baslik="Evraklarım" />
      {isLoading ? <Spinner /> : (
        <Card pad={false}>
          {(!evraklar || evraklar.length === 0) ? (
            <div className="p-5"><Empty>Müşaviriniz tarafından kartınıza yüklenen belge bulunmuyor.</Empty></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <THead>
                  <Th>Belge</Th>
                  <Th>Kategori</Th>
                  <Th>Tarih</Th>
                  <Th align="center">Görüntüle</Th>
                </THead>
                <tbody>
                  {evraklar.map((e: any) => (
                    <tr key={e.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                      <td className="px-4 py-2.5 text-[13px] max-w-[360px] truncate" style={{ color: '#fafaf9' }}>{e.title}</td>
                      <td className="px-4 py-2.5 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.55)' }}>{KATEGORI[e.category] || 'Belge'}</td>
                      <td className="px-4 py-2.5 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>{e.createdAt ? new Date(e.createdAt).toLocaleDateString('tr-TR') : '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-center">
                          {e.goruntulenebilir
                            ? <button type="button" onClick={() => openBelge('evrak', e.id)} title="Görüntüle" className="flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-white/[0.06]" style={{ border: '1px solid rgba(212,184,118,0.25)', color: GOLD }}><Eye size={14} /></button>
                            : <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <p className="text-[12px] mt-3" style={{ color: 'rgba(250,250,249,0.35)' }}>
        Bu alanda müşavirinizin mükellef kartınıza yüklediği dosyalar yer alır.
      </p>
    </div>
  );
}
