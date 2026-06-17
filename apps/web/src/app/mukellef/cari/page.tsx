'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { fmtTRY, Section, Empty, Spinner, PageTitle, Th, THead } from '../_lib/shared';

const YESIL = '#4ade80';
const KIRMIZI = '#f87171';

const fmtTarih = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('tr-TR') : '—';
};

function Metric({ label, value, text, tone = 'neutral', suffix }: { label: string; value?: number; text?: string; tone?: 'neutral' | 'good' | 'bad'; suffix?: string }) {
  const color = tone === 'good' ? YESIL : tone === 'bad' ? KIRMIZI : '#fafaf9';
  return (
    <div className="rounded-xl p-4" style={{ background: tone === 'bad' ? 'rgba(248,113,113,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${tone === 'bad' ? 'rgba(248,113,113,0.22)' : 'rgba(255,255,255,0.07)'}` }}>
      <div className="text-[10.5px] font-bold uppercase tracking-[0.10em]" style={{ color: 'rgba(250,250,249,0.4)' }}>{label}</div>
      <div className="mt-2 text-[24px] font-semibold tabular-nums" style={{ color }}>{text ?? fmtTRY(value || 0)}</div>
      {suffix && <div className="mt-1 text-[11px] font-medium" style={{ color }}>{suffix}</div>}
    </div>
  );
}

const TIP_ETIKET: Record<string, string> = { TAHAKKUK: 'Tahakkuk', TAHSILAT: 'Tahsilat', IADE: 'İade', DUZELTME: 'Düzeltme' };

export default function MukellefCari() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-cari'],
    queryFn: () => taxpayerApi.get('/portal/cari').then((r) => r.data),
  });

  if (isLoading) return (<div><PageTitle ust="Ofis" baslik="Cari Hesabım" /><Spinner /></div>);

  const netBakiye = Number(data?.bakiye ?? 0);
  const borclu = netBakiye > 0;
  const hareketler: any[] = data?.hareketler || [];

  return (
    <div className="space-y-4">
      <PageTitle ust="Ofis" baslik="Cari Hesabım" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Toplam tahakkuk" value={data?.tahakkukToplam ?? 0} />
        <Metric label="Toplam tahsilat" value={data?.tahsilatToplam ?? 0} tone="good" />
        <Metric label="Açık bakiye" value={Math.abs(netBakiye)} tone={borclu ? 'bad' : 'good'} suffix={borclu ? 'Borç' : 'Borç yok'} />
        <Metric label="Hareket" text={`${hareketler.length} kayıt`} />
      </div>

      <Section baslik="Cari Hareketler" aciklama="Tahakkuk ve tahsilatlar; yeni tarihliler üstte, sağda yürüyen bakiye.">
        {hareketler.length === 0 ? <div className="px-4 py-5"><Empty>Cari hareket bulunamadı.</Empty></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <THead>
                <Th>Tarih</Th>
                <Th>Tip</Th>
                <Th>Açıklama</Th>
                <Th align="right">Borç</Th>
                <Th align="right">Alacak</Th>
                <Th align="right">Bakiye</Th>
              </THead>
              <tbody>
                {hareketler.map((h, i) => {
                  const tahsilat = h.tip === 'TAHSILAT';
                  const aciklama = [h.hizmetAdi, h.aciklama || h.donem].filter(Boolean).join(' · ') || '—';
                  return (
                    <tr key={i} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.055)' }}>
                      <td className="px-4 py-3 text-[12.5px] tabular-nums whitespace-nowrap" style={{ color: 'rgba(250,250,249,0.55)' }}>{fmtTarih(h.tarih)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-md px-2 py-1 text-[10.5px] font-bold" style={tahsilat ? { color: YESIL, background: 'rgba(74,222,128,0.10)' } : { color: '#d4b876', background: 'rgba(212,184,118,0.10)' }}>{TIP_ETIKET[h.tip] || h.tip}</span>
                      </td>
                      <td className="px-4 py-3 text-[12.5px] max-w-[360px] truncate" style={{ color: '#fafaf9' }}>{aciklama}</td>
                      <td className="px-4 py-3 text-right text-[12.5px] font-semibold tabular-nums" style={{ color: h.borc ? KIRMIZI : 'rgba(250,250,249,0.3)' }}>{h.borc ? `${fmtTRY(h.borc)}` : '—'}</td>
                      <td className="px-4 py-3 text-right text-[12.5px] font-semibold tabular-nums" style={{ color: h.alacak ? YESIL : 'rgba(250,250,249,0.3)' }}>{h.alacak ? `${fmtTRY(h.alacak)}` : '—'}</td>
                      <td className="px-4 py-3 text-right text-[12.5px] font-semibold tabular-nums" style={{ color: '#fafaf9' }}>{h.runningBakiye != null ? `${fmtTRY(h.runningBakiye)}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
