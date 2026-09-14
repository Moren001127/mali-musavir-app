'use client';
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { portalAutomationApi } from '@/lib/portal-automation';
import { FAINT, GOLD, STEEL_BR } from '../_lib/tema';
import { PortalPdfModal } from './ortak/PortalPdfModal';
import { BosDurum, Cip, DocBtn, GrupSatiri, PortalTabState, SekmeBasligi, TabloSarmal, Td, Th } from './ortak/Tablo';

// SGK satır meta: backend PDF'ten raw'a yazdı; yoksa ham metinden çıkar (SGK modülüyle aynı).
export function sgkDocMeta(d: any): { donem: string; mahiyet: string; kanunNo: string; calisan: string; tutar: string } {
  const raw = d?.raw || {};
  const cells: string[] = Array.isArray(raw.cells) ? raw.cells : [];
  const text = String(raw.rowText || cells.join(' ') || '');
  const donem = String(raw.donem || d?.period || '').trim();
  const mahiyet = String(raw.belgeMahiyeti || '').trim() || (text.match(/\b(ASIL|EK|İPTAL|IPTAL)\b/i) || [])[0] || '';
  const kanunRaw = String(raw.kanunNo || '').trim() || (text.match(/\b0?5510\b/) || text.match(/\b\d{5}\b/) || [])[0] || '';
  let tutar = String(raw.tutar || '').trim();
  if (!tutar) { const tt = text.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || []; tutar = tt.length ? tt[tt.length - 1] : ''; }
  const calisan = String(raw.calisan || '').trim();
  return { donem, mahiyet, kanunNo: kanunRaw.replace(/^0/, '') || kanunRaw, calisan, tutar };
}

const SUTUN = 6;

/** SGK — tahakkuk fişleri & hizmet listeleri; gerçek tablo, satıra tıklayınca PDF modalı. */
export function SgkTab({ taxpayerId }: { taxpayerId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['sgk-docs', taxpayerId],
    queryFn: () => portalAutomationApi.documents({ taxpayerId, belgeTuru: 'SGK_TAHAKKUK,SGK_HIZMET_LISTESI', limit: 200 }),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ url: string; title: string } | null>(null);
  const rows = useMemo(
    () => [...(Array.isArray(data) ? data : [])].sort((a, b) => sgkDocMeta(b).donem.localeCompare(sgkDocMeta(a).donem)),
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
    <BosDurum icon={Shield} title="SGK kaydı yok" text="SGK tahakkuk fişi ve hizmet listeleri otomasyon çalışınca burada görünür." />
  );

  return (
    <div>
      <SekmeBasligi title="SGK — Tahakkuk Fişleri & Hizmet Listeleri" text={`${rows.length} belge · satıra tıklayınca belge (PDF) açılır.`} />
      <TabloSarmal maxHeight={560} minWidth={720}>
        <colgroup>
          <col style={{ width: 110 }} />
          <col style={{ width: 120 }} />
          <col />
          <col style={{ width: 100 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 64 }} />
        </colgroup>
        <thead>
          <tr>
            <Th>Dönem</Th><Th>Tür</Th><Th>Mahiyet</Th>
            <Th right>Çalışan</Th><Th right>Tutar</Th><Th center>Belge</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d: any) => {
            const m = sgkDocMeta(d);
            const tahakkuk = d.belgeTuru === 'SGK_TAHAKKUK';
            const baslik = `${tahakkuk ? 'SGK Tahakkuk Fişi' : 'SGK Hizmet Listesi'} · ${m.donem || ''}`;
            return (
              <tr key={d.id} onClick={() => openDoc(d.id, baslik)} className="cursor-pointer transition-colors hover:bg-white/[0.03]">
                <Td tabular style={{ fontWeight: 700 }}>{m.donem || '—'}</Td>
                <Td><Cip>{tahakkuk ? 'Tahakkuk' : 'Hizmet L.'}</Cip></Td>
                <Td muted>{m.mahiyet || '—'}</Td>
                <Td right tabular>{m.calisan || '—'}</Td>
                <Td right tabular style={{ color: m.tutar ? undefined : FAINT, fontWeight: 700 }}>{m.tutar ? `${m.tutar} ₺` : '—'}</Td>
                <Td center style={{ padding: '4px 6px' }}>
                  <DocBtn label="Belgeyi aç" busy={busy === d.id} onClick={() => openDoc(d.id, baslik)} />
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
