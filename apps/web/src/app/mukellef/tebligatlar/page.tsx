'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { Section, Empty, Spinner, PageTitle, Th, THead, openBelge, ozetBelge } from '../_lib/shared';
import { Eye, BellDot, Sparkles, MailWarning } from 'lucide-react';

const SARI = '#fbbf24';
const YESIL = '#4ade80';
const KIRMIZI = '#f87171';

const fmtTarih = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR');
};

export default function MukellefTebligatlar() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ['portal-tebligatlar'],
    queryFn: () => taxpayerApi.get('/portal/tebligatlar').then((r) => r.data),
  });
  // Tebligat açılınca backend viewedAt yazar; "okundu" durumu + dashboard rozeti
  // anında yansısın diye kısa süre sonra listeyi tazele.
  const acVeTazele = (id: string, baslik: string) => {
    openBelge('tebligat', id, undefined, baslik);
    setTimeout(() => {
      qc.invalidateQueries({ queryKey: ['portal-tebligatlar'] });
      qc.invalidateQueries({ queryKey: ['portal-dashboard'] });
    }, 1500);
  };

  const liste: any[] = Array.isArray(data) ? data : [];
  const okunmamis = liste.filter((t) => !t.viewedAt).length;

  return (
    <div className="space-y-4">
      <PageTitle ust="GİB" baslik="e-Tebligatlarım" icon={MailWarning} aciklama={`${liste.length} tebligat${okunmamis > 0 ? ` · ${okunmamis} okunmamış` : ''}`} />

      {isLoading ? <Spinner /> : (
        <>
          {okunmamis > 0 && (
            <div className="flex items-center gap-2.5 rounded-2xl px-4 py-3" style={{ background: `${SARI}14`, border: `1px solid ${SARI}3a` }}>
              <BellDot size={16} style={{ color: SARI }} />
              <span className="text-[13px]" style={{ color: '#fafaf9' }}>
                <strong>{okunmamis}</strong> okunmamış e-Tebligatınız var. Açtığınızda okundu olarak işaretlenir.
              </span>
            </div>
          )}

          <Section baslik="e-Tebligat" aciklama="GİB'den gelen tebligatlar, yeni tarihliler üstte. Satırdaki simge ile tebligatı (PDF) açabilirsiniz.">
            {liste.length === 0 ? <div className="px-4 py-5"><Empty>e-Tebligat bulunmuyor.</Empty></div> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <THead>
                    <Th>Gönderen Kurum</Th>
                    <Th>Belge No</Th>
                    <Th>Tebliğ</Th>
                    <Th align="center">Durum</Th>
                    <Th align="right">Belge</Th>
                  </THead>
                  <tbody>
                    {liste.map((t: any) => {
                      const okundu = !!t.viewedAt;
                      return (
                        <tr key={t.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.055)' }}>
                          <td className="px-4 py-3">
                            <div className="text-[12.5px] font-semibold max-w-[320px] truncate" style={{ color: '#fafaf9' }}>{t.kurumAciklama || t.title || '—'}</div>
                            {t.altKurum && <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.4)' }}>{t.altKurum}</div>}
                          </td>
                          <td className="px-4 py-3 text-[12.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.55)' }}>{t.referenceNo || '—'}</td>
                          <td className="px-4 py-3 text-[12.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.7)' }}>{fmtTarih(t.tebligZamani || t.issuedAt || t.receivedAt || t.createdAt)}</td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: okundu ? YESIL : KIRMIZI }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: okundu ? YESIL : KIRMIZI, display: 'inline-block' }} />
                              {okundu ? 'Okundu' : 'Okunmadı'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1.5">
                              {t.goruntulenebilir ? (
                                <>
                                  <button type="button" onClick={() => ozetBelge('tebligat', t.id, undefined, t.kurumAciklama || t.title || 'e-Tebligat')} title="MOREN AI ile özetle" className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]" style={{ border: '1px solid rgba(184,160,111,0.4)', color: '#d4b876', background: 'rgba(184,160,111,0.1)' }}><Sparkles size={15} /></button>
                                  <button type="button" onClick={() => acVeTazele(t.id, t.kurumAciklama || t.title || 'e-Tebligat')} title="Tebligatı görüntüle" className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]" style={{ border: `1px solid ${SARI}45`, color: SARI, background: `${SARI}12` }}><Eye size={15} /></button>
                                </>
                              ) : <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>}
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
        </>
      )}
    </div>
  );
}
