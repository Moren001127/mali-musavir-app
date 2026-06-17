'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { Section, Empty, Spinner, PageTitle, openBelge } from '../_lib/shared';
import { Eye, FolderArchive } from 'lucide-react';

const STEEL = '#9da8b7';
const KATEGORI: Record<string, string> = {
  SOZLESME: 'Sözleşme', FATURA: 'Fatura', BEYANNAME: 'Beyanname', EVRAK: 'Evrak', DIGER: 'Diğer',
};
const fmtTarih = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('tr-TR') : '—';
};
function fmtBoyut(b?: number | null) {
  if (!b || b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function MukellefEvraklar() {
  const { data: evraklar = [], isLoading } = useQuery<any[]>({
    queryKey: ['portal-evraklar'],
    queryFn: () => taxpayerApi.get('/portal/evraklar').then((r) => r.data),
  });

  const liste: any[] = Array.isArray(evraklar) ? evraklar : [];

  return (
    <div className="space-y-4">
      <PageTitle ust="Arşiv" baslik="Evraklarım" icon={FolderArchive} aciklama={`${liste.length} belge`} />
      {isLoading ? <Spinner /> : (
        <Section baslik="Yüklü evraklar" aciklama="Müşavirinizin mükellef kartınıza yüklediği dosyalar. Simge ile görüntüleyebilirsiniz.">
          {liste.length === 0 ? (
            <div className="px-4 py-6"><Empty>Kartınıza yüklenmiş belge bulunmuyor.</Empty></div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.055)' }}>
              {liste.map((e) => {
                const boyut = fmtBoyut(e.sizeBytes);
                return (
                  <div key={e.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_200px_56px] md:items-center">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{e.title}</div>
                      <div className="mt-0.5 truncate text-[11.5px]" style={{ color: e.notes ? 'rgba(250,250,249,0.5)' : 'rgba(250,250,249,0.3)' }}>{e.notes || 'Açıklama yok'}</div>
                    </div>
                    <div className="text-[11.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
                      <div>{KATEGORI[e.category] || 'Belge'}{boyut ? ` · ${boyut}` : ''}</div>
                      <div className="mt-0.5">{fmtTarih(e.updatedAt || e.createdAt)}</div>
                    </div>
                    <div className="flex md:justify-end">
                      {e.goruntulenebilir
                        ? <button type="button" onClick={() => openBelge('evrak', e.id)} title="Görüntüle" className="flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-white/[0.06]" style={{ border: `1px solid ${STEEL}40`, color: STEEL }}><Eye size={15} /></button>
                        : <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
