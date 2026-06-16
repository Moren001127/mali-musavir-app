'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, Check, Loader2, Inbox, Database, RefreshCw,
  ArrowDownLeft, ArrowUpRight, Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';
import FaturaDetayDrawer from '../_dialogs/FaturaDetayDrawer';

type Props = {
  taxpayerId?: string;
  period: string;
  taxpayers: Array<any>;
  onMihsapCek?: () => void;
  mihsapLoading?: boolean;
};

const SOURCE_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  mihsap:        { label: 'Mihsap',    color: '#2dd4bf', bg: 'rgba(45,212,191,0.12)'  },
  'manual-web':  { label: 'Yüklendi',  color: '#60a5fa', bg: 'rgba(96,165,250,0.12)'  },
  efatura:       { label: 'e-Fatura',  color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  NEEDS_REVIEW:  { label: 'İnceleme Bekliyor', color: '#fbbf24' },
  READY:         { label: 'Hazır',             color: '#4ade80' },
  PENDING:       { label: 'Onay Bekliyor',     color: '#60a5fa' },
  APPROVED:      { label: 'Onaylandı',         color: '#2dd4bf' },
  REJECTED:      { label: 'Reddedildi',        color: '#f87171' },
};

function fmt(n: number | null | undefined) {
  if (!n) return '—';
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

export default function GeldenBelgelerPanel({ taxpayerId, period, taxpayers, onMihsapCek, mihsapLoading }: Props) {
  const qc = useQueryClient();
  const [drawerDoc, setDrawerDoc] = useState<{ taxpayerId: string; direction: 'ALIS' | 'SATIS'; defterTuru?: string | null } | null>(null);
  const [filterStatus, setFilterStatus] = useState<'NEEDS_REVIEW' | 'ALL'>('NEEDS_REVIEW');

  const docsQ = useQuery({
    queryKey: ['fatura-merkezi', 'gelen-belgeler', taxpayerId, period, filterStatus],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/documents', {
          params: {
            taxpayerId,
            period,
            status: filterStatus === 'ALL' ? 'PENDING' : 'NEEDS_REVIEW',
            limit: 500,
          },
        })
        .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.documents || r.data?.data || [])))
        .catch(() => []),
  });

  const docs: any[] = docsQ.data || [];
  const needsReviewCount = docs.filter((d) => d.status === 'NEEDS_REVIEW').length;
  const selectedTaxpayer = taxpayers.find((t) => t.id === taxpayerId);

  const approveMut = useMutation({
    mutationFn: async (id: string) => api.post(`/fatura-muhasebelestirme/documents/${id}/approve`),
    onSuccess: () => {
      toast.success('Belge onaylandı');
      qc.invalidateQueries({ queryKey: ['fatura-merkezi'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Onay hatası'),
  });

  const bulkApproveMut = useMutation({
    mutationFn: async () => {
      const pending = docs.filter((d) => d.status === 'NEEDS_REVIEW');
      for (const d of pending) {
        await api.post(`/fatura-muhasebelestirme/documents/${d.id}/approve`).catch(() => null);
      }
    },
    onSuccess: () => {
      toast.success(`${needsReviewCount} belge toplu onaylandı`);
      qc.invalidateQueries({ queryKey: ['fatura-merkezi'] });
    },
  });

  return (
    <div style={{ padding: '20px 24px', height: '100%', display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Başlık + araçlar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#fafaf9', letterSpacing: -0.3 }}>Gelen Belgeler</span>
        {needsReviewCount > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 20, padding: '0 7px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, background: 'rgba(251,191,36,0.18)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
            {needsReviewCount}
          </span>
        )}
        <div style={{ flex: 1 }} />

        {/* Filtre */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
          {(['NEEDS_REVIEW', 'ALL'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilterStatus(f)}
              style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none', background: filterStatus === f ? 'rgba(255,255,255,0.08)' : 'transparent', color: filterStatus === f ? '#fafaf9' : 'rgba(250,250,249,0.4)', transition: 'all 0.12s' }}>
              {f === 'NEEDS_REVIEW' ? 'İnceleme Bekliyor' : 'Tümü'}
            </button>
          ))}
        </div>

        {/* Mihsap'tan Çek */}
        {onMihsapCek && (
          <button type="button" onClick={onMihsapCek} disabled={mihsapLoading || !taxpayerId}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.25)', color: '#2dd4bf', fontSize: 12, fontWeight: 600, cursor: mihsapLoading || !taxpayerId ? 'not-allowed' : 'pointer', opacity: !taxpayerId ? 0.45 : 1, height: 32 }}>
            {mihsapLoading ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
            Mihsap'tan Çek
          </button>
        )}

        {needsReviewCount > 0 && (
          <button type="button" onClick={() => bulkApproveMut.mutate()} disabled={bulkApproveMut.isPending}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80', fontSize: 12, fontWeight: 600, cursor: 'pointer', height: 32 }}>
            {bulkApproveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Tümünü Onayla ({needsReviewCount})
          </button>
        )}

        <button type="button" onClick={() => docsQ.refetch()} disabled={docsQ.isFetching}
          style={{ display: 'flex', alignItems: 'center', padding: '5px 9px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.5)', cursor: 'pointer', height: 32 }}>
          <RefreshCw size={13} className={docsQ.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Boş durum — mükellef seçilmemiş */}
      {!taxpayerId && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'rgba(250,250,249,0.3)' }}>
          <Inbox size={40} strokeWidth={1.2} />
          <span style={{ fontSize: 14 }}>Mükellef seçin</span>
        </div>
      )}

      {/* Boş durum — belge yok */}
      {taxpayerId && !docsQ.isLoading && docs.length === 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: 'rgba(250,250,249,0.3)' }}>
          <Inbox size={40} strokeWidth={1.2} />
          <span style={{ fontSize: 14 }}>Bu dönem için belge yok</span>
          {onMihsapCek && (
            <button type="button" onClick={onMihsapCek} disabled={mihsapLoading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, background: 'rgba(45,212,191,0.12)', border: '1px solid rgba(45,212,191,0.3)', color: '#2dd4bf', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {mihsapLoading ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
              Mihsap'tan Çek
            </button>
          )}
        </div>
      )}

      {/* Tablo */}
      {taxpayerId && (docsQ.isLoading || docs.length > 0) && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)', position: 'sticky', top: 0 }}>
                {['YÖN', 'BELGE NO', 'TARİH', 'FİRMA', 'TUTAR', 'KAYNAK', 'DURUM', ''].map((h) => (
                  <th key={h} style={{ padding: '9px 12px', textAlign: h === 'TUTAR' ? 'right' : 'left', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', color: 'rgba(250,250,249,0.3)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docsQ.isLoading && (
                <tr><td colSpan={8} style={{ padding: '36px', textAlign: 'center', fontSize: 13, color: 'rgba(250,250,249,0.3)' }}>Yükleniyor...</td></tr>
              )}
              {docs.map((doc, idx) => {
                const src = SOURCE_LABEL[doc.source] || SOURCE_LABEL['manual-web'];
                const st = STATUS_LABEL[doc.status] || { label: doc.status, color: 'rgba(250,250,249,0.4)' };
                const isAlis = doc.invoiceKind === 'ALIS';
                const tp = taxpayers.find((t) => t.id === doc.taxpayerId);
                const vendorOrBuyer = doc.vendorName || doc.sellerName || doc.buyerName || '—';

                return (
                  <tr key={doc.id}
                    style={{ borderBottom: idx === docs.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.04)', transition: 'background 0.1s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* YÖN */}
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: isAlis ? 'rgba(96,165,250,0.12)' : 'rgba(251,191,36,0.12)', color: isAlis ? '#60a5fa' : '#fbbf24' }}>
                        {isAlis ? <ArrowDownLeft size={10} /> : <ArrowUpRight size={10} />}
                        {isAlis ? 'Alış' : 'Satış'}
                      </span>
                    </td>

                    {/* BELGE NO */}
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: 'rgba(250,250,249,0.7)', whiteSpace: 'nowrap' }}>
                      {doc.belgeNo || doc.invoiceNumber || '—'}
                    </td>

                    {/* TARİH */}
                    <td style={{ padding: '10px 12px', fontSize: 12, color: 'rgba(250,250,249,0.55)', whiteSpace: 'nowrap' }}>
                      {fmtDate(doc.invoiceDate || doc.createdAt)}
                    </td>

                    {/* FİRMA */}
                    <td style={{ padding: '10px 12px', fontSize: 13, color: '#fafaf9', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vendorOrBuyer}</div>
                      {tp && !taxpayerId && <div style={{ fontSize: 11, color: 'rgba(250,250,249,0.35)', marginTop: 1 }}>{taxpayerName(tp)}</div>}
                    </td>

                    {/* TUTAR */}
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#fafaf9', whiteSpace: 'nowrap' }}>
                      {fmt(doc.totalAmount)} ₺
                    </td>

                    {/* KAYNAK */}
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: src.color, background: src.bg }}>
                        {src.label}
                      </span>
                    </td>

                    {/* DURUM */}
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: st.color, whiteSpace: 'nowrap' }}>
                        {st.label}
                      </span>
                    </td>

                    {/* AKSIYONLAR */}
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        <button type="button" title="İncele"
                          onClick={() => setDrawerDoc({ taxpayerId: doc.taxpayerId || taxpayerId || '', direction: doc.invoiceKind || 'ALIS', defterTuru: tp?.defterTuru })}
                          style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', color: '#a78bfa', cursor: 'pointer' }}>
                          <Eye size={13} />
                        </button>
                        {doc.status === 'NEEDS_REVIEW' && (
                          <button type="button" title="Onayla"
                            onClick={() => approveMut.mutate(doc.id)}
                            disabled={approveMut.isPending}
                            style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', color: '#4ade80', cursor: 'pointer' }}>
                            {approveMut.isPending && approveMut.variables === doc.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {drawerDoc && (
        <FaturaDetayDrawer
          taxpayerId={drawerDoc.taxpayerId}
          direction={drawerDoc.direction}
          defterTuru={drawerDoc.defterTuru}
          period={period}
          onClose={() => setDrawerDoc(null)}
        />
      )}
    </div>
  );
}
