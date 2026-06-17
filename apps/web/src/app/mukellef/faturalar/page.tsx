'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { fmtTRY, Card, Empty, Spinner, PageTitle, OzetCard, GOLD, openBelge } from '../_lib/shared';
import { ArrowDownLeft, ArrowUpRight, ReceiptText, Eye, BarChart3 } from 'lucide-react';

const ALIS = '#d4b876';
const SATIS = '#4ade80';

const AY_KISA = (donem: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(donem || '');
  if (!m) return donem || '—';
  const aylar = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${aylar[Number(m[2]) - 1] || m[2]} ${m[1].slice(2)}`;
};
const turEtiket = (t: string) => /SATIS/i.test(t) ? 'Satış' : /TEVKIFAT/i.test(t) ? 'Tevkifatlı Alış' : 'Alış';
const belgeEtiket = (t: string) => (t === 'E_FATURA' ? 'e-Fatura' : t === 'E_ARSIV' ? 'e-Arşiv' : t === 'FIS' ? 'Fiş' : t || '—');

export default function MukellefFaturalar() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-faturalar'],
    queryFn: () => taxpayerApi.get('/portal/faturalar').then((r) => r.data),
  });

  if (isLoading) return (<div><PageTitle ust="Fatura Merkezi" baslik="Faturalarım" /><Spinner /></div>);

  const ozet = data?.ozet || {};
  const aylik: any[] = data?.aylik || [];
  const faturalar: any[] = data?.faturalar || [];
  const maxAy = Math.max(1, ...aylik.map((a) => Math.max(a.alis, a.satis)));

  return (
    <div className="space-y-6">
      <PageTitle ust="Fatura Merkezi" baslik="Faturalarım" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <OzetCard icon={ArrowDownLeft} label="Alış Faturaları" value={fmtTRY(ozet.alisToplam ?? 0)} accent={ALIS} sub={`${ozet.alisAdet ?? 0} belge`} />
        <OzetCard icon={ArrowUpRight} label="Satış Faturaları" value={fmtTRY(ozet.satisToplam ?? 0)} accent={SATIS} sub={`${ozet.satisAdet ?? 0} belge`} />
      </div>

      {/* Aylık grafik */}
      <Card accent={GOLD}>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={15} style={{ color: GOLD }} />
          <h2 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Aylık Alış / Satış</h2>
          <div className="ml-auto flex items-center gap-3 text-[11.5px]">
            <span className="inline-flex items-center gap-1.5" style={{ color: 'rgba(250,250,249,0.6)' }}><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ALIS }} /> Alış</span>
            <span className="inline-flex items-center gap-1.5" style={{ color: 'rgba(250,250,249,0.6)' }}><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SATIS }} /> Satış</span>
          </div>
        </div>
        {aylik.length === 0 ? <Empty>Grafik için yeterli veri yok.</Empty> : (
          <div className="flex items-end gap-3 overflow-x-auto pb-1" style={{ height: 180 }}>
            {aylik.map((a) => (
              <div key={a.donem} className="flex flex-col items-center gap-1.5 shrink-0" style={{ minWidth: 46 }}>
                <div className="flex items-end gap-1" style={{ height: 132 }}>
                  <div title={`Alış: ${fmtTRY(a.alis)}`} className="w-3.5 rounded-t" style={{ height: `${Math.max(2, (a.alis / maxAy) * 132)}px`, background: `linear-gradient(180deg, ${ALIS}, ${ALIS}66)` }} />
                  <div title={`Satış: ${fmtTRY(a.satis)}`} className="w-3.5 rounded-t" style={{ height: `${Math.max(2, (a.satis / maxAy) * 132)}px`, background: `linear-gradient(180deg, ${SATIS}, ${SATIS}66)` }} />
                </div>
                <span className="text-[10.5px] whitespace-nowrap" style={{ color: 'rgba(250,250,249,0.45)' }}>{AY_KISA(a.donem)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Liste */}
      <Card>
        <div className="flex items-center gap-2 mb-3"><ReceiptText size={15} style={{ color: GOLD }} /><h2 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>İşlenen Faturalar</h2></div>
        {faturalar.length === 0 ? <Empty>İşlenen fatura bulunamadı.</Empty> : (
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            {faturalar.map((f) => {
              const satis = /SATIS/i.test(f.faturaTuru || '');
              const renk = satis ? SATIS : ALIS;
              return (
                <div key={f.id} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ background: `${renk}1a`, color: renk }}>{turEtiket(f.faturaTuru)}</span>
                      <span className="text-[13px] font-medium truncate" style={{ color: '#fafaf9' }}>{f.firmaUnvan || f.faturaNo || '—'}</span>
                    </div>
                    <p className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.4)' }}>
                      {belgeEtiket(f.belgeTuru)} · {f.faturaNo}{f.faturaTarihi ? ` · ${new Date(f.faturaTarihi).toLocaleDateString('tr-TR')}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[13px] tabular-nums font-semibold" style={{ color: '#fafaf9' }}>{fmtTRY(f.toplamTutar)}</span>
                    {f.goruntulenebilir && (
                      <button type="button" onClick={() => openBelge('fatura', f.id)} title="Görüntüle"
                        className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]"
                        style={{ border: '1px solid rgba(212,184,118,0.28)', color: GOLD, background: 'rgba(212,184,118,0.08)' }}>
                        <Eye size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
