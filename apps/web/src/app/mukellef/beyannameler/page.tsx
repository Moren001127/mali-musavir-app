'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { fmtTRY, DURUM, Card, Empty, Spinner, PageTitle, GOLD, openBelge } from '../_lib/shared';
import { FileText, ReceiptText, FileCode2 } from 'lucide-react';

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
                const bl = b.belge;
                return (
                  <div key={i} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0">
                      <span className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>{b.beyanTipi}</span>
                      <span className="text-[12.5px] ml-2" style={{ color: 'rgba(250,250,249,0.45)' }}>{b.donem}</span>
                      {b.onayTarihi ? <span className="text-[11.5px] ml-2" style={{ color: 'rgba(250,250,249,0.35)' }}>· onay {new Date(b.onayTarihi).toLocaleDateString('tr-TR')}</span> : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {b.tahakkukTutari ? <span className="text-[13px] tabular-nums mr-1" style={{ color: 'rgba(250,250,249,0.65)' }}>{fmtTRY(b.tahakkukTutari)}</span> : null}
                      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-md" style={{ background: `${d.color}1a`, color: d.color }}><d.Icon size={12} /> {d.label}</span>
                      {bl?.beyanname && (
                        <BelgeBtn icon={FileText} title="Beyanname" onClick={() => openBelge('beyanname', bl.kayitId, 'beyanname')} />
                      )}
                      {bl?.pdf && (
                        <BelgeBtn icon={ReceiptText} title="Tahakkuk Fişi" onClick={() => openBelge('beyanname', bl.kayitId, 'pdf')} />
                      )}
                      {bl?.xml && (
                        <BelgeBtn icon={FileCode2} title="e-Beyanname XML" onClick={() => openBelge('beyanname', bl.kayitId, 'xml')} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
      <p className="text-[12px] mt-3" style={{ color: 'rgba(250,250,249,0.35)' }}>
        Göz / fiş simgeleriyle beyanname aslını, tahakkuk fişini veya e-Beyanname XML'ini görüntüleyebilirsiniz.
      </p>
    </div>
  );
}

function BelgeBtn({ icon: Icon, title, onClick }: { icon: any; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]"
      style={{ border: '1px solid rgba(212,184,118,0.28)', color: GOLD, background: 'rgba(212,184,118,0.08)' }}
    >
      <Icon size={15} />
    </button>
  );
}
