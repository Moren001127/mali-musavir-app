'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { fmtTRY, DURUM, Card, Empty, Spinner, PageTitle, GOLD, Badge, Th, THead, openBelge } from '../_lib/shared';
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
        <Card pad={false}>
          {(!data || data.length === 0) ? <div className="p-5"><Empty>Beyanname kaydı bulunamadı.</Empty></div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <THead>
                  <Th>Beyanname</Th>
                  <Th>Dönem</Th>
                  <Th align="right">Tahakkuk</Th>
                  <Th align="center">Durum</Th>
                  <Th align="right">Belge</Th>
                </THead>
                <tbody>
                  {data.map((b: any, i: number) => {
                    const d = DURUM[b.durum] || DURUM.beklemede;
                    const bl = b.belge;
                    return (
                      <tr key={i} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                        <td className="px-4 py-3">
                          <span className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>{b.beyanTipi}</span>
                          {b.onayTarihi ? <span className="text-[11px] ml-2" style={{ color: 'rgba(250,250,249,0.35)' }}>onay {new Date(b.onayTarihi).toLocaleDateString('tr-TR')}</span> : null}
                        </td>
                        <td className="px-4 py-3 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.55)' }}>{b.donem}</td>
                        <td className="px-4 py-3 text-right text-[13px] tabular-nums" style={{ color: 'rgba(250,250,249,0.7)' }}>{b.tahakkukTutari ? fmtTRY(b.tahakkukTutari) : '—'}</td>
                        <td className="px-4 py-3 text-center"><Badge color={d.color} icon={d.Icon}>{d.label}</Badge></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            {bl?.beyanname && <BelgeBtn icon={FileText} title="Beyanname" onClick={() => openBelge('beyanname', bl.kayitId, 'beyanname')} />}
                            {bl?.pdf && <BelgeBtn icon={ReceiptText} title="Tahakkuk Fişi" onClick={() => openBelge('beyanname', bl.kayitId, 'pdf')} />}
                            {bl?.xml && <BelgeBtn icon={FileCode2} title="e-Beyanname XML" onClick={() => openBelge('beyanname', bl.kayitId, 'xml')} />}
                            {!bl?.beyanname && !bl?.pdf && !bl?.xml && <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <p className="text-[12px] mt-3" style={{ color: 'rgba(250,250,249,0.35)' }}>
        Belge sütunundaki simgelerle beyanname aslını, tahakkuk fişini veya e-Beyanname XML'ini görüntüleyebilirsiniz.
      </p>
    </div>
  );
}

function BelgeBtn({ icon: Icon, title, onClick }: { icon: any; title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="flex h-7 w-7 items-center justify-center rounded-lg transition hover:bg-white/[0.06]"
      style={{ border: '1px solid rgba(212,184,118,0.25)', color: GOLD }}>
      <Icon size={14} />
    </button>
  );
}
