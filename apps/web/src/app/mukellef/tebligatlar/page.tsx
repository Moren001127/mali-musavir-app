'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { Section, Empty, Spinner, PageTitle, openBelge } from '../_lib/shared';
import { MailWarning, Eye, BellDot } from 'lucide-react';

const SARI = '#fbbf24';

export default function MukellefTebligatlar() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['portal-tebligatlar'],
    queryFn: () => taxpayerApi.get('/portal/tebligatlar').then((r) => r.data),
  });

  const liste: any[] = Array.isArray(data) ? data : [];
  const okunmamis = liste.filter((t) => !t.viewedAt).length;

  return (
    <div className="space-y-5">
      <PageTitle ust="GİB" baslik="e-Tebligatlarım" />

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

          <Section baslik="Gelen e-Tebligatlar" aciklama="Açtığınızda okundu olarak işaretlenir.">
            {liste.length === 0 ? <div className="px-4 py-5"><Empty>e-Tebligat bulunmuyor.</Empty></div> : (
              <div className="divide-y px-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                {liste.map((t: any) => {
                  const yeni = !t.viewedAt;
                  return (
                    <div key={t.id} className="flex items-center justify-between py-3 gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0" style={{ background: `${SARI}14`, border: `1px solid ${SARI}30`, color: SARI }}><MailWarning size={16} /></span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-[13.5px] font-medium truncate" style={{ color: '#fafaf9' }}>{t.title}</p>
                            {yeni && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${SARI}22`, color: SARI }}>YENİ</span>}
                          </div>
                          <p className="text-[11.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                            {t.referenceNo ? `${t.referenceNo} · ` : ''}{t.issuedAt ? new Date(t.issuedAt).toLocaleDateString('tr-TR') : (t.createdAt ? new Date(t.createdAt).toLocaleDateString('tr-TR') : '')}
                          </p>
                        </div>
                      </div>
                      {t.goruntulenebilir && (
                        <button type="button" onClick={() => openBelge('tebligat', t.id)} title="Görüntüle"
                          className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0 transition hover:bg-white/[0.06]"
                          style={{ border: `1px solid ${SARI}45`, color: SARI, background: `${SARI}12` }}>
                          <Eye size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
