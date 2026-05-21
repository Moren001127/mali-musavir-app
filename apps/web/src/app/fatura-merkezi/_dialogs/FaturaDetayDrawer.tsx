'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, ChevronLeft, ChevronRight, Check, Trash2, Save, ArrowRight,
  Loader2, FileText, AlertTriangle, ListChecks,
} from 'lucide-react';
import { api } from '@/lib/api';

/* ════════════════════════════════════════════════════════════════════
   FATURA DETAY DRAWER — Mihsap referansı.
   Sol: PDF görüntü · Sağ: işleme formu.
   F8 = Geri, F9 = İleri (Kaydet ve Onayla)
   "Onaylanacak Fatura Sayısı: X" sayacı.
   ════════════════════════════════════════════════════════════════════ */

type Props = {
  taxpayerId: string;
  direction: 'ALIS' | 'SATIS';
  period: string;
  onClose: () => void;
};

export default function FaturaDetayDrawer({ taxpayerId, direction, period, onClose }: Props) {
  const qc = useQueryClient();
  const [cursor, setCursor] = useState(0);

  /* Bekleyen belge listesi */
  const listQ = useQuery({
    queryKey: ['fatura-merkezi', 'detail-list', taxpayerId, direction, period],
    queryFn: () => api
      .get('/fatura-muhasebelestirme/documents', {
        params: { taxpayerId, period, status: 'PENDING', limit: 200 },
      })
      .then((r) => Array.isArray(r.data) ? r.data : (r.data?.documents || r.data?.data || [])),
  });

  const allDocs: any[] = listQ.data || [];
  const docs = useMemo(
    () => allDocs.filter((d) => {
      const dir = String(d.direction || '').toUpperCase();
      return direction === 'ALIS' ? dir.startsWith('ALI') : !dir.startsWith('ALI');
    }),
    [allDocs, direction],
  );

  const current = docs[cursor];

  /* ESC + F8/F9 kısayolları */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'F8') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      if (e.key === 'F9') { e.preventDefault(); approveCurrent(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // eslint-disable-line

  const approveMut = useMutation({
    mutationFn: async (id: string) => api.post(`/fatura-muhasebelestirme/documents/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'detail-list'] });
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'per-taxpayer-summary'] });
      setCursor((c) => Math.min(docs.length - 2, c)); // sonraki belgeye geç
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/fatura-muhasebelestirme/documents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'detail-list'] });
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'per-taxpayer-summary'] });
    },
  });

  const approveAllMut = useMutation({
    mutationFn: async () => {
      for (const d of docs) await api.post(`/fatura-muhasebelestirme/documents/${d.id}/approve`).catch(() => null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'detail-list'] });
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'per-taxpayer-summary'] });
    },
  });

  const approveCurrent = () => { if (current?.id) approveMut.mutate(current.id); };

  /* Dosya URL */
  const fileQ = useQuery({
    queryKey: ['fatura-merkezi', 'file-url', current?.id],
    queryFn: () => api.get(`/fatura-muhasebelestirme/documents/${current.id}/file-url`).then((r) => r.data?.url || null),
    enabled: !!current?.id,
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(0,0,0,0.85)' }}>
      {/* Üst toolbar */}
      <header
        className="flex items-center gap-3 px-5 py-3"
        style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
      >
        <button onClick={onClose} className="p-2 rounded-md hover:bg-[var(--surface-2)]" style={{ color: 'var(--text-muted)' }}>
          <X size={16} />
        </button>

        <div>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
            Belge İşleme
          </div>
          <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {direction === 'ALIS' ? 'Alış (gelen)' : 'Satış (giden)'} faturaları · {period}
          </div>
        </div>

        <div className="flex-1" />

        {/* Sayaç */}
        <div className="px-3 py-1.5 rounded-lg text-[12.5px]" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
          <strong>{docs.length - cursor}</strong> belge bekliyor
        </div>

        {/* Toplu onayla */}
        <button
          onClick={() => { if (confirm(`${docs.length} bekleyen belgenin tümünü onaylamak istiyor musun?`)) approveAllMut.mutate(); }}
          disabled={approveAllMut.isPending || docs.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-semibold rounded-lg disabled:opacity-50"
          style={{ background: '#10b981', color: 'white' }}
        >
          {approveAllMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <ListChecks size={13} />}
          Tümünü Onayla ({docs.length})
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Sol: PDF viewer */}
        <div className="flex-1 flex items-center justify-center" style={{ background: '#1a1813' }}>
          {!current && (
            <div className="text-center" style={{ color: 'var(--text-muted)' }}>
              <Check size={42} className="mx-auto mb-3" style={{ color: '#10b981' }} />
              <div className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Tüm belgeler işlendi!</div>
              <div className="text-[12.5px] mt-1">Bu mukellefin {direction.toLowerCase()} kuyruğu boş.</div>
            </div>
          )}
          {current && fileQ.isLoading && (
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
          )}
          {current && fileQ.data && (
            <iframe
              src={fileQ.data}
              className="w-full h-full"
              style={{ background: 'white' }}
              title={current.documentNumber || current.id}
            />
          )}
          {current && !fileQ.isLoading && !fileQ.data && (
            <div className="text-center" style={{ color: 'var(--text-muted)' }}>
              <FileText size={36} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <div className="text-[13px]">Belge önizlemesi alınamadı.</div>
            </div>
          )}
        </div>

        {/* Sağ: form */}
        <div className="w-[420px] flex flex-col" style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border)' }}>
          {current ? (
            <FaturaForm
              key={current.id}
              doc={current}
              onApprove={() => approveCurrent()}
              onDelete={() => { if (confirm('Bu belgeyi silmek istiyor musun?')) deleteMut.mutate(current.id); }}
              approving={approveMut.isPending}
              deleting={deleteMut.isPending}
            />
          ) : (
            <div className="p-6 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Tebrikler — bekleyen kalmadı.
            </div>
          )}

          {/* Alt navigasyon */}
          <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <button
              onClick={() => setCursor((c) => Math.max(0, c - 1))}
              disabled={cursor === 0}
              className="flex items-center gap-1 px-3 py-1.5 text-[12px] rounded-md disabled:opacity-30"
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              title="Önceki (F8)"
            >
              <ChevronLeft size={13} />
              Önceki (F8)
            </button>

            <div className="flex-1 text-center text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              {docs.length > 0 ? `${cursor + 1} / ${docs.length}` : '—'}
            </div>

            <button
              onClick={() => setCursor((c) => Math.min(docs.length - 1, c + 1))}
              disabled={cursor >= docs.length - 1 || docs.length === 0}
              className="flex items-center gap-1 px-3 py-1.5 text-[12px] rounded-md disabled:opacity-30"
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              title="Sonraki"
            >
              Sonraki
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Tek belge formu ─── */
function FaturaForm({ doc, onApprove, onDelete, approving, deleting }: {
  doc: any;
  onApprove: () => void;
  onDelete: () => void;
  approving: boolean;
  deleting: boolean;
}) {
  const supplierName =
    doc.supplierName || doc.counterpartyName || doc.firmaUnvan || doc.unvan ||
    doc.metadata?.supplier?.name || '—';
  const supplierVkn = doc.supplierVkn || doc.counterpartyTaxNumber || doc.metadata?.supplier?.vkn || '—';
  const total = doc.totalAmount ?? doc.toplamTutar ?? doc.metadata?.total ?? 0;
  const kdv = doc.kdvAmount ?? doc.kdvToplam ?? doc.metadata?.kdv ?? 0;
  const lines = Array.isArray(doc.lines) ? doc.lines : Array.isArray(doc.metadata?.lines) ? doc.metadata.lines : [];

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      <div>
        <div className="text-[11px] tracking-wide font-semibold mb-1" style={{ color: 'var(--text-light)' }}>FİRMA</div>
        <div className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{supplierName}</div>
        <div className="text-[11.5px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>VKN: {supplierVkn}</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Belge No" value={doc.documentNumber || doc.faturaNo || '-'} mono />
        <Field label="Belge Tarihi" value={fmtDate(doc.documentDate || doc.faturaTarihi)} />
        <Field label="Belge Türü" value={doc.documentType || '-'} />
        <Field label="Yön" value={String(doc.direction || '').toUpperCase()} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Toplam Tutar" value={fmtTl(total)} tone="var(--accent)" />
        <Field label="KDV" value={fmtTl(kdv)} />
      </div>

      {/* OCR confidence */}
      {doc.ocrConfidence !== undefined && (
        <div className="p-2 rounded-md text-[11px]" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          OCR güveni: <strong style={{ color: doc.ocrConfidence > 0.85 ? '#10b981' : doc.ocrConfidence > 0.6 ? '#f59e0b' : '#ef4444' }}>
            %{Math.round((doc.ocrConfidence || 0) * 100)}
          </strong>
        </div>
      )}

      {/* Kalemler */}
      {lines.length > 0 && (
        <div>
          <div className="text-[11px] tracking-wide font-semibold mb-1" style={{ color: 'var(--text-light)' }}>
            KALEMLER ({lines.length})
          </div>
          <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            {lines.slice(0, 8).map((line: any, idx: number) => (
              <div
                key={idx}
                className="px-2.5 py-1.5 text-[11.5px]"
                style={{ borderBottom: idx === lines.length - 1 ? 'none' : '1px solid var(--border-soft)' }}
              >
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text)' }}>{line.description || line.name || `Kalem ${idx + 1}`}</span>
                  <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{fmtTl(line.total || line.amount || 0)}</span>
                </div>
                {(line.suggestedAccount || line.hesapKodu) && (
                  <div className="text-[10.5px] mt-0.5 font-mono" style={{ color: 'var(--accent)' }}>
                    → {line.suggestedAccount || line.hesapKodu}
                  </div>
                )}
              </div>
            ))}
            {lines.length > 8 && (
              <div className="px-2.5 py-1.5 text-[10.5px] text-center" style={{ color: 'var(--text-muted)' }}>
                ... ve {lines.length - 8} kalem daha
              </div>
            )}
          </div>
        </div>
      )}

      {/* Uyarılar */}
      {doc.warnings?.length > 0 && (
        <div className="p-2.5 rounded-md text-[11.5px]" style={{ background: '#f59e0b15', border: '1px solid #f59e0b40', color: '#fbbf24' }}>
          <AlertTriangle size={12} className="inline mr-1" />
          {doc.warnings.length} uyarı: {doc.warnings.slice(0, 2).map((w: any) => w.message || w).join('; ')}
        </div>
      )}

      {/* Onay butonları */}
      <div className="pt-3 grid grid-cols-2 gap-2" style={{ borderTop: '1px solid var(--border)' }}>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="flex items-center justify-center gap-1.5 py-2 text-[12.5px] font-medium rounded-lg disabled:opacity-50"
          style={{ background: 'transparent', border: '1px solid #ef444460', color: '#ef4444' }}
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          Sil
        </button>
        <button
          onClick={onApprove}
          disabled={approving}
          className="flex items-center justify-center gap-1.5 py-2 text-[12.5px] font-semibold rounded-lg disabled:opacity-50"
          style={{ background: '#10b981', color: 'white' }}
        >
          {approving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Onayla (F9)
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, mono, tone }: { label: string; value: any; mono?: boolean; tone?: string }) {
  return (
    <div className="p-2.5 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <div className="text-[10px] tracking-wide font-semibold mb-1" style={{ color: 'var(--text-light)' }}>{label.toUpperCase()}</div>
      <div className={`text-[12.5px] ${mono ? 'font-mono' : ''}`} style={{ color: tone || 'var(--text)' }}>{value || '-'}</div>
    </div>
  );
}

function fmtTl(value: number | string): string {
  const n = Number(value || 0);
  return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
}
function fmtDate(value: any): string {
  if (!value) return '-';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('tr-TR');
  } catch {
    return String(value);
  }
}
