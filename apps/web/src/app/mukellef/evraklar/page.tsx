'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { GOLD, Card, Empty, Spinner, PageTitle } from '../_lib/shared';
import { FileText } from 'lucide-react';

export default function MukellefEvraklar() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['portal-evraklar'],
    queryFn: () => taxpayerApi.get('/portal/evraklar').then((r) => r.data),
  });

  return (
    <div>
      <PageTitle ust="Arşiv" baslik="Evraklarım" />
      {isLoading ? <Spinner /> : (
        <Card>
          {(!data || data.length === 0) ? <Empty>Henüz evrak bulunmuyor.</Empty> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {data.map((e: any) => (
                <div key={e.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD }}><FileText size={16} /></div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate" style={{ color: '#fafaf9' }}>{e.title}</p>
                    <p className="text-[11.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                      {e.category || 'Belge'}{e.createdAt ? ` · ${new Date(e.createdAt).toLocaleDateString('tr-TR')}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
