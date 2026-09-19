'use client';
import { portalStyle } from '@/lib/portal-theme';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { portalAutomationApi } from '@/lib/portal-automation';
import { FAINT, GREEN, RED, portalDateTr } from '../_lib/tema';
import { PortalPdfModal } from './ortak/PortalPdfModal';
import { BosDurum, DocBtn, GrupSatiri, PortalTabState, SekmeBasligi, TabloSarmal, Td, Th } from './ortak/Tablo';

const SUTUN = 5;

/** E-Tebligat — gerçek tablo; satıra tıklayınca tebligat (PDF) modalı. */
export function ETebligatTab({ taxpayerId }: { taxpayerId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['etebligat-docs', taxpayerId],
    queryFn: () => portalAutomationApi.documents({ taxpayerId, belgeTuru: 'E_TEBLIGAT', limit: 200 }),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ url: string; title: string } | null>(null);
  const rows = useMemo(
    () => [...(Array.isArray(data) ? data : [])].sort((a, b) =>
      String(b.receivedAt || b.createdAt || '').localeCompare(String(a.receivedAt || a.createdAt || ''))),
    [data],
  );
  const openDoc = async (docId: string, title: string) => {
    setBusy(docId);
    try {
      const { url } = await portalAutomationApi.documentViewUrl(docId);
      if (url) setPdf({ url, title }); else toast.warning('Belge bulunamadı');
    } catch (e: any) { toast.error(e?.response?.data?.message || e?.message || 'Belge açılamadı'); }
    finally { setBusy(null); }
  };

  if (isLoading) return <PortalTabState><Loader2 className="mr-2 animate-spin" size={16} /> Yükleniyor…</PortalTabState>;
  if (!rows.length) return (
    <BosDurum icon={Mail} title="E-Tebligat yok" text="GİB e-Tebligat kayıtları otomasyon çalışınca burada görünür." />
  );

  const okunmamis = rows.filter((d: any) => !(d.viewedAt || d.raw?.mukellefOkumaZamani)).length;

  return (
    <div>
      <SekmeBasligi title="E-Tebligat" text={`${rows.length} tebligat${okunmamis ? ` · ${okunmamis} okunmadı` : ''} · satıra tıklayınca tebligat (PDF) açılır.`} />
      <TabloSarmal maxHeight={560} minWidth={720}>
        <colgroup>
          <col />
          <col style={portalStyle({ width: 150 })} />
          <col style={portalStyle({ width: 140 })} />
          <col style={portalStyle({ width: 110 })} />
          <col style={portalStyle({ width: 64 })} />
        </colgroup>
        <thead>
          <tr>
            <Th>Gönderen Kurum</Th><Th>Belge No</Th><Th>Tebliğ</Th>
            <Th>Durum</Th><Th center>Belge</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d: any) => {
            const raw = d.raw || {};
            const okundu = !!(d.viewedAt || raw.mukellefOkumaZamani);
            const baslik = `E-Tebligat · ${raw.kurumAciklama || d.title || ''}`;
            return (
              <tr key={d.id} onClick={() => openDoc(d.id, baslik)} className="cursor-pointer transition-colors hover:bg-white/[0.03]">
                <Td>
                  <div className="font-bold">{raw.kurumAciklama || d.title || '—'}</div>
                  {raw.altKurum ? <div className="text-[11.5px]" style={portalStyle({ color: FAINT })}>{raw.altKurum}</div> : null}
                </Td>
                <Td muted tabular>{d.referenceNo || '—'}</Td>
                <Td tabular>{portalDateTr(raw.tebligZamani || d.receivedAt)}</Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={portalStyle({ color: okundu ? GREEN : RED })}>
                    <span className="h-1.5 w-1.5 rounded-full" style={portalStyle({ background: okundu ? GREEN : RED })} />
                    {okundu ? 'Okundu' : 'Okunmadı'}
                  </span>
                </Td>
                <Td center style={portalStyle({ padding: '4px 6px' })}>
                  <DocBtn label="Tebligatı aç" busy={busy === d.id} onClick={() => openDoc(d.id, baslik)} />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TabloSarmal>
      {pdf && <PortalPdfModal url={pdf.url} title={pdf.title} onClose={() => setPdf(null)} />}
    </div>
  );
}
