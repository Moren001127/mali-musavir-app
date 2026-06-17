'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { fmtTRY, DURUM, Card, Empty, Spinner, PortalHeader, StatStrip, GOLD, Badge, Th, THead, openBelge } from '../_lib/shared';
import { FileText, ReceiptText, FileCode2, CheckCircle2, Clock, Coins } from 'lucide-react';

const AMBER = '#d8ad70';

export default function MukellefBeyannameler() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['portal-beyannameler'],
    queryFn: () => taxpayerApi.get('/portal/beyannameler').then((r) => r.data),
  });

  const liste: any[] = Array.isArray(data) ? data : [];
  const verilen = liste.filter((b) => b.durum === 'verildi' || b.durum === 'onaylandi').length;
  const bekleyen = liste.filter((b) => b.durum === 'beklemede').length;
  const tahakkukToplam = liste.reduce((s, b) => s + (Number(b.tahakkukTutari) || 0), 0);

  return (
    <div className="space-y-5">
      <PortalHeader
        ust="Vergi & Beyan"
        baslik="Beyannamelerim"
        aciklama={`${liste.length} beyanname kaydı`}
        icon={FileText}
        accent={AMBER}
      />

      {isLoading ? <Spinner /> : (
        <>
          <StatStrip
            items={[
              { label: 'Verilen', value: String(verilen), icon: CheckCircle2, accent: '#4ade80' },
              { label: 'Bekleyen', value: String(bekleyen), icon: Clock, accent: '#fbbf24' },
              { label: 'Toplam Tahakkuk', value: fmtTRY(tahakkukToplam), icon: Coins, accent: AMBER },
            ]}
          />

          <Card pad={false} accent={AMBER}>
            {liste.length === 0 ? <div className="p-5"><Empty>Beyanname kaydı bulunamadı.</Empty></div> : (
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
                    {liste.map((b: any, i: number) => {
                      const d = DURUM[b.durum] || DURUM.beklemede;
                      const bl = b.belge;
                      const verildiTarih = b.verildiTarihi ? new Date(b.verildiTarihi).toLocaleDateString('tr-TR') : null;
                      return (
                        <tr key={i} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                          <td className="px-4 py-3">
                            <span className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>{b.beyanTipi}</span>
                            {verildiTarih ? <span className="text-[11px] ml-2" style={{ color: 'rgba(250,250,249,0.35)' }}>{verildiTarih}</span> : null}
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
          <p className="text-[12px]" style={{ color: 'rgba(250,250,249,0.35)' }}>
            Belge sütunundaki simgelerle beyanname aslını, tahakkuk fişini veya e-Beyanname XML'ini görüntüleyebilirsiniz.
          </p>
        </>
      )}
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
