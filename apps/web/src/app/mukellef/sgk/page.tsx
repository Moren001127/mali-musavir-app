'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { Section, Empty, Spinner, PageTitle, Th, THead, openBelge } from '../_lib/shared';
import { Eye } from 'lucide-react';

const GOLD = '#d4b876';
const STEEL = '#9da8b7';

type SgkRow = {
  id: string; belgeTuru: string; donem: string; mahiyet: string; calisan: string; tutar: string;
  viewedAt: string | null; goruntulenebilir: boolean;
};

export default function MukellefSgk() {
  const { data = [], isLoading } = useQuery<SgkRow[]>({
    queryKey: ['portal-sgk'],
    queryFn: () => taxpayerApi.get('/portal/sgk').then((r) => r.data),
  });

  const rows: SgkRow[] = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-4">
      <PageTitle ust="SGK" baslik="SGK Belgelerim" />
      {isLoading ? <Spinner /> : (
        <Section
          baslik="SGK — Tahakkuk Fişleri & Hizmet Listeleri"
          aciklama="Dönem azalan sırada. Satırdaki simge ile belgeyi (PDF) görüntüleyebilirsiniz."
        >
          {rows.length === 0 ? <div className="px-4 py-5"><Empty>SGK belgesi bulunmuyor.</Empty></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <THead>
                  <Th>Dönem</Th>
                  <Th>Tür</Th>
                  <Th>Mahiyet</Th>
                  <Th align="right">Çalışan</Th>
                  <Th align="right">Tutar</Th>
                  <Th align="right">Belge</Th>
                </THead>
                <tbody>
                  {rows.map((s) => {
                    const tahakkuk = s.belgeTuru === 'SGK_TAHAKKUK';
                    return (
                      <tr key={s.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.055)' }}>
                        <td className="px-4 py-3 text-[12.5px] font-semibold tabular-nums" style={{ color: '#fafaf9' }}>{s.donem || '—'}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-md px-2 py-1 text-[10.5px] font-bold"
                            style={tahakkuk ? { color: GOLD, background: 'rgba(212,184,118,0.13)' } : { color: STEEL, background: 'rgba(157,168,183,0.14)' }}>
                            {tahakkuk ? 'Tahakkuk' : 'Hizmet L.'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.55)' }}>{s.mahiyet || '—'}</td>
                        <td className="px-4 py-3 text-right text-[12.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.7)' }}>{s.calisan || '—'}</td>
                        <td className="px-4 py-3 text-right text-[12.5px] font-semibold tabular-nums" style={{ color: s.tutar ? '#fafaf9' : 'rgba(250,250,249,0.3)' }}>{s.tutar ? `${s.tutar} ₺` : '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            {s.goruntulenebilir
                              ? <button type="button" onClick={() => openBelge('sgk', s.id)} title="Belgeyi görüntüle" className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]" style={{ border: '1px solid rgba(157,168,183,0.35)', color: STEEL }}><Eye size={15} /></button>
                              : <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
