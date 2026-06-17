'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { GOLD, Card, Empty, Spinner, PageTitle, openBelge } from '../_lib/shared';
import { FileText, FolderArchive, ShieldCheck, ListChecks, Eye } from 'lucide-react';

const KATEGORI: Record<string, string> = {
  SOZLESME: 'Sözleşme', FATURA: 'Fatura', BEYANNAME: 'Beyanname', EVRAK: 'Evrak', DIGER: 'Diğer',
};

function BelgeRow({ tur, id, title, alt, viewable, accent = GOLD }: { tur: string; id: string; title: string; alt?: string; viewable?: boolean; accent?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0" style={{ background: `${accent}14`, border: `1px solid ${accent}28`, color: accent }}><FileText size={16} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium truncate" style={{ color: '#fafaf9' }}>{title}</p>
        {alt ? <p className="text-[11.5px] truncate" style={{ color: 'rgba(250,250,249,0.4)' }}>{alt}</p> : null}
      </div>
      {viewable && (
        <button type="button" onClick={() => openBelge(tur, id)} title="Görüntüle"
          className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0 transition hover:bg-white/[0.06]"
          style={{ border: `1px solid ${accent}45`, color: accent, background: `${accent}12` }}>
          <Eye size={15} />
        </button>
      )}
    </div>
  );
}

function Bolum({ icon: Icon, baslik, accent, children }: { icon: any; baslik: string; accent: string; children: React.ReactNode }) {
  return (
    <Card accent={accent}>
      <div className="flex items-center gap-2 mb-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${accent}18`, border: `1px solid ${accent}30`, color: accent }}><Icon size={14} /></span>
        <h2 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>{baslik}</h2>
      </div>
      {children}
    </Card>
  );
}

export default function MukellefEvraklar() {
  const { data: evraklar = [], isLoading: l1 } = useQuery({
    queryKey: ['portal-evraklar'],
    queryFn: () => taxpayerApi.get('/portal/evraklar').then((r) => r.data),
  });
  const { data: sgk, isLoading: l2 } = useQuery({
    queryKey: ['portal-sgk'],
    queryFn: () => taxpayerApi.get('/portal/sgk').then((r) => r.data),
  });

  return (
    <div className="space-y-5">
      <PageTitle ust="Arşiv" baslik="Evraklarım" />

      {l1 ? <Spinner /> : (
        <Bolum icon={FolderArchive} baslik="Belgelerim" accent={GOLD}>
          {(!evraklar || evraklar.length === 0) ? <Empty>Müşaviriniz tarafından yüklenen belge bulunmuyor.</Empty> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {evraklar.map((e: any) => (
                <BelgeRow key={e.id} tur="evrak" id={e.id} title={e.title}
                  alt={`${KATEGORI[e.category] || 'Belge'}${e.createdAt ? ` · ${new Date(e.createdAt).toLocaleDateString('tr-TR')}` : ''}`}
                  viewable={e.goruntulenebilir} />
              ))}
            </div>
          )}
        </Bolum>
      )}

      {l2 ? null : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Bolum icon={ShieldCheck} baslik="SGK Tahakkuk Fişleri" accent="#4ade80">
            {(!sgk?.tahakkuk || sgk.tahakkuk.length === 0) ? <Empty>SGK tahakkuk fişi bulunmuyor.</Empty> : (
              <div className="space-y-2.5">
                {sgk.tahakkuk.map((s: any) => (
                  <BelgeRow key={s.id} tur="sgk" id={s.id} title={s.title}
                    alt={`${s.period || ''}${s.createdAt ? ` · ${new Date(s.createdAt).toLocaleDateString('tr-TR')}` : ''}`}
                    viewable={s.goruntulenebilir} accent="#4ade80" />
                ))}
              </div>
            )}
          </Bolum>
          <Bolum icon={ListChecks} baslik="SGK Hizmet Listeleri" accent="#60a5fa">
            {(!sgk?.hizmetListesi || sgk.hizmetListesi.length === 0) ? <Empty>SGK hizmet listesi bulunmuyor.</Empty> : (
              <div className="space-y-2.5">
                {sgk.hizmetListesi.map((s: any) => (
                  <BelgeRow key={s.id} tur="sgk" id={s.id} title={s.title}
                    alt={`${s.period || ''}${s.createdAt ? ` · ${new Date(s.createdAt).toLocaleDateString('tr-TR')}` : ''}`}
                    viewable={s.goruntulenebilir} accent="#60a5fa" />
                ))}
              </div>
            )}
          </Bolum>
        </div>
      )}
    </div>
  );
}
