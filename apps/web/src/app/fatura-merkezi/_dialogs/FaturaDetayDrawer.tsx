'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, ChevronLeft, ChevronRight, Check, Trash2, Save,
  Loader2, FileText, AlertTriangle, ListChecks, Plus,
} from 'lucide-react';
import { api } from '@/lib/api';

/* ════════════════════════════════════════════════════════════════════
   FATURA DETAY DRAWER v2.2 — kompakt + editable yevmiye + hesap planı autocomplete
   Sol: fatura görseli (büyük) · Sağ: kompakt form + yevmiye editor
   F8 = Önceki belge · F9 = Onayla
   ════════════════════════════════════════════════════════════════════ */

type Props = {
  taxpayerId: string;
  direction: 'ALIS' | 'SATIS';
  period: string;
  onClose: () => void;
};

type EditableLine = {
  id?: string;
  group: string;
  accountCode: string;
  description: string;
  rate?: string | null;
  debit: string;     // string olarak tut, input rahat çalışsın
  credit: string;
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
      const kind = String(d.invoiceKind ?? d.direction ?? '').toUpperCase();
      return direction === 'ALIS' ? kind.startsWith('ALI') : !kind.startsWith('ALI');
    }),
    [allDocs, direction],
  );

  const current = docs[cursor];

  /* ESC + F8/F9 kısayolları */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'F8') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // eslint-disable-line

  const approveMut = useMutation({
    mutationFn: async (id: string) => api.post(`/fatura-muhasebelestirme/documents/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'detail-list'] });
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'per-taxpayer-summary'] });
      setCursor((c) => Math.min(docs.length - 2, c));
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

  /* Dosya URL veya inline HTML */
  const fileQ = useQuery({
    queryKey: ['fatura-merkezi', 'file-url', current?.id],
    queryFn: () => api.get(`/fatura-muhasebelestirme/documents/${current.id}/file-url`).then((r) => ({
      url: (r.data?.url as string) || null,
      inlineHtml: (r.data?.inlineHtml as string) || null,
      source: (r.data?.source as string) || null,
    })),
    enabled: !!current?.id,
  });
  const hasPreview = !!(fileQ.data?.url || fileQ.data?.inlineHtml);
  const previewSource = fileQ.data?.source;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(0,0,0,0.85)' }}>
      {/* Üst toolbar */}
      <header
        className="flex items-center gap-3 px-5 py-2.5"
        style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
      >
        <button onClick={onClose} className="p-2 rounded-md hover:bg-[var(--surface-2)]" style={{ color: 'var(--text-muted)' }}>
          <X size={16} />
        </button>

        <div>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Belge İşleme</div>
          <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {direction === 'ALIS' ? 'Alış (gelen)' : 'Satış (giden)'} · {period}
          </div>
        </div>

        <div className="flex-1" />

        <div className="px-3 py-1.5 rounded-lg text-[12.5px]" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
          <strong>{docs.length - cursor}</strong> belge bekliyor
        </div>

        <button
          onClick={() => { if (confirm(`${docs.length} bekleyen belgenin tümünü onaylamak istiyor musun? Hatalı belgeler atlanır.`)) approveAllMut.mutate(); }}
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
        {/* Sol: fatura görseli */}
        <div className="flex-1 flex flex-col min-h-0" style={{ background: '#1a1813' }}>
          {/* Preview kaynak rozet bandı */}
          {current && previewSource && (
            <div
              className="px-3 py-1.5 flex items-center gap-2 text-[11px]"
              style={{
                background: previewSource === 'rendered-from-xml' || previewSource === 'placeholder' ? '#f59e0b25' : '#10b98125',
                borderBottom: `1px solid ${previewSource === 'rendered-from-xml' || previewSource === 'placeholder' ? '#f59e0b60' : '#10b98160'}`,
                color: previewSource === 'rendered-from-xml' || previewSource === 'placeholder' ? '#fbbf24' : '#86efac',
              }}
            >
              {previewSource === 'original-pdf' && '📄 Orijinal PDF (Luca\'dan)'}
              {previewSource === 'original-html' && '✓ Luca orijinal HTML'}
              {previewSource === 'stored-html' && '✓ Kayıtlı HTML'}
              {previewSource === 'stored-file' && '✓ Kayıtlı dosya'}
              {previewSource === 'rendered-from-xml' && '⚠ Sistem render\'ı — Luca\'da bu fatura için PDF/HTML inmemiş, sadece XML var. Görüntü basit.'}
              {previewSource === 'placeholder' && '⚠ Orijinal belge dosyası yok'}
            </div>
          )}
          <div className="flex-1 flex items-center justify-center min-h-0">
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
            {current && fileQ.data?.url && (
              <iframe src={fileQ.data.url} className="w-full h-full" style={{ background: 'white' }} title={current.belgeNo || current.id} />
            )}
            {current && !fileQ.data?.url && fileQ.data?.inlineHtml && (
              <iframe srcDoc={fileQ.data.inlineHtml} className="w-full h-full" style={{ background: 'white' }} title={current.belgeNo || current.id} sandbox="allow-same-origin" />
            )}
            {current && !fileQ.isLoading && !hasPreview && (
              <div className="text-center" style={{ color: 'var(--text-muted)' }}>
                <FileText size={36} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                <div className="text-[13px]">Belge önizlemesi alınamadı.</div>
              </div>
            )}
          </div>
        </div>

        {/* Sağ: kompakt editable form */}
        <div className="w-[480px] flex flex-col" style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border)' }}>
          {current ? (
            <FaturaForm
              key={current.id}
              doc={current}
              taxpayerId={taxpayerId}
              onApprove={() => current?.id && approveMut.mutate(current.id)}
              onDelete={() => { if (confirm('Bu belgeyi silmek istiyor musun?')) deleteMut.mutate(current.id); }}
              approving={approveMut.isPending}
              deleting={deleteMut.isPending}
              approveError={approveMut.error as any}
            />
          ) : (
            <div className="p-6 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Tebrikler — bekleyen kalmadı.
            </div>
          )}

          {/* Alt navigasyon */}
          <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <button
              onClick={() => setCursor((c) => Math.max(0, c - 1))}
              disabled={cursor === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] rounded-md disabled:opacity-30"
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              <ChevronLeft size={12} /> Önceki (F8)
            </button>
            <div className="flex-1 text-center text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              {docs.length > 0 ? `${cursor + 1} / ${docs.length}` : '—'}
            </div>
            <button
              onClick={() => setCursor((c) => Math.min(docs.length - 1, c + 1))}
              disabled={cursor >= docs.length - 1 || docs.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] rounded-md disabled:opacity-30"
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              Sonraki <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Tek belge formu (kompakt + editable yevmiye) ─── */
function FaturaForm({ doc, taxpayerId, onApprove, onDelete, approving, deleting, approveError }: {
  doc: any;
  taxpayerId: string;
  onApprove: () => void;
  onDelete: () => void;
  approving: boolean;
  deleting: boolean;
  approveError?: any;
}) {
  const qc = useQueryClient();
  const isSale = String(doc.invoiceKind || '').toUpperCase() === 'SATIS';
  const supplierName = (isSale ? doc.customerName : doc.vendorName) || '—';
  const supplierVkn = (isSale ? doc.buyerVkn : doc.sellerVkn) || '—';
  const total = Number(doc.totalAmount ?? doc.toplamTutar ?? 0);

  /* Hesap planı (taxpayer-bazlı) — autocomplete önerileri */
  const accountsQ = useQuery({
    queryKey: ['fatura-merkezi', 'account-plan', taxpayerId],
    queryFn: () => api
      .get('/fatura-muhasebelestirme/account-plan', { params: { taxpayerId, limit: 500 } })
      .then((r) => Array.isArray(r.data) ? r.data : (r.data?.lines || r.data?.data || [])),
    enabled: !!taxpayerId,
  });
  const accounts: any[] = accountsQ.data || [];

  /* Editable line state */
  const [lines, setLines] = useState<EditableLine[]>(() =>
    (Array.isArray(doc.lines) ? doc.lines : []).map((l: any) => ({
      id: l.id,
      group: l.group || 'matrah',
      accountCode: l.accountCode || '',
      description: l.description || '',
      rate: l.rate || '',
      debit: Number(l.debit || 0) > 0 ? String(l.debit) : '',
      credit: Number(l.credit || 0) > 0 ? String(l.credit) : '',
    })),
  );
  const [dirty, setDirty] = useState(false);

  const updateLine = (idx: number, patch: Partial<EditableLine>) => {
    setLines((arr) => arr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const addLine = () => {
    setLines((arr) => [...arr, { group: 'matrah', accountCode: '', description: '', debit: '', credit: '' }]);
    setDirty(true);
  };
  const removeLine = (idx: number) => {
    setLines((arr) => arr.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const sumDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const sumCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const isBalanced = Math.abs(sumDebit - sumCredit) < 0.02;
  const matchesTotal = total > 0 ? Math.abs(Math.max(sumDebit, sumCredit) - total) < 0.02 : true;

  const saveMut = useMutation({
    mutationFn: async () => api.patch(`/fatura-muhasebelestirme/documents/${doc.id}`, {
      lines: lines.map((l) => ({
        group: l.group,
        accountCode: l.accountCode,
        description: l.description,
        rate: l.rate || null,
        debit: l.debit || '0',
        credit: l.credit || '0',
      })),
    }),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'detail-list'] });
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'per-taxpayer-summary'] });
    },
  });

  const handleApprove = () => {
    if (dirty) {
      if (!confirm('Kaydedilmemiş değişiklikler var. Önce kaydet?')) return;
      saveMut.mutate(undefined, { onSuccess: () => setTimeout(() => onApprove(), 200) });
    } else {
      onApprove();
    }
  };

  // F9 = Onayla
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F9') { e.preventDefault(); handleApprove(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirty, lines]); // eslint-disable-line

  const blocked = doc.validationStatus === 'INVALID' || doc.validationStatus === 'INCOMPLETE' || !isBalanced || !matchesTotal;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Kompakt başlık paneli */}
      <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        <div>
          <div className="text-[10px] tracking-wider font-semibold mb-0.5" style={{ color: 'var(--text-light)' }}>FİRMA</div>
          <div className="text-[13px] font-semibold leading-tight" style={{ color: 'var(--text)' }}>{supplierName}</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <div>
            <div className="text-[9.5px] tracking-wider mb-0.5" style={{ color: 'var(--text-light)' }}>VKN/TC</div>
            <div className="font-mono" style={{ color: 'var(--text)' }}>{supplierVkn}</div>
          </div>
          <div>
            <div className="text-[9.5px] tracking-wider mb-0.5" style={{ color: 'var(--text-light)' }}>BELGE NO</div>
            <div className="font-mono truncate" style={{ color: 'var(--text)' }}>{doc.belgeNo || '-'}</div>
          </div>
          <div>
            <div className="text-[9.5px] tracking-wider mb-0.5" style={{ color: 'var(--text-light)' }}>TARİH</div>
            <div style={{ color: 'var(--text)' }}>{fmtDate(doc.faturaTarihi)}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1.5 mt-0.5" style={{ borderTop: '1px solid var(--border-soft)' }}>
          <span className="text-[10px] tracking-wider" style={{ color: 'var(--text-light)' }}>TOPLAM</span>
          <span className="text-[15px] font-bold tabular-nums" style={{ color: 'var(--accent)' }}>{fmtTl(total)}</span>
          <div className="flex-1" />
          <span className="text-[10px] tracking-wider" style={{ color: 'var(--text-light)' }}>{doc.documentType || 'E_FATURA'} · {isSale ? 'SATIŞ' : 'ALIŞ'}</span>
        </div>
      </div>

      {/* Validation hata paneli */}
      {(doc.validationStatus === 'INVALID' || doc.validationStatus === 'INCOMPLETE') && Array.isArray(doc.validationIssues) && doc.validationIssues.length > 0 && (
        <div
          className="p-2.5 rounded-lg"
          style={{
            background: doc.validationStatus === 'INVALID' ? '#ef444415' : '#f59e0b15',
            border: `1px solid ${doc.validationStatus === 'INVALID' ? '#ef444460' : '#f59e0b60'}`,
          }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={12} style={{ color: doc.validationStatus === 'INVALID' ? '#ef4444' : '#fbbf24' }} />
            <span className="text-[11.5px] font-semibold" style={{ color: doc.validationStatus === 'INVALID' ? '#ef4444' : '#fbbf24' }}>
              {doc.validationStatus === 'INVALID' ? 'BELGE HATALI' : 'BELGE EKSİK'} — düzeltmeden onaylanamaz
            </span>
          </div>
          <ul className="space-y-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {doc.validationIssues.map((issue: any, idx: number) => (
              <li key={idx} className="leading-tight">· {issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Approve mutation error */}
      {approveError && (
        <div className="p-2.5 rounded-lg text-[11.5px]" style={{ background: '#ef444415', border: '1px solid #ef444460', color: '#fca5a5' }}>
          {(approveError as any)?.response?.data?.message || 'Onaylama hatası'}
        </div>
      )}

      {/* Yevmiye editor */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] tracking-wider font-semibold" style={{ color: 'var(--text-light)' }}>
            YEVMİYE KAYDI ({lines.length})
          </div>
          <button
            type="button"
            onClick={addLine}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-medium"
            style={{ background: 'var(--accent-50)', color: 'var(--accent)', border: '1px solid var(--accent-50)' }}
          >
            <Plus size={11} /> Satır ekle
          </button>
        </div>

        {/* datalist — hesap kodu autocomplete (HTML5) */}
        <datalist id={`accounts-${taxpayerId}`}>
          {accounts.map((a: any) => (
            <option key={a.accountCode} value={a.accountCode}>{a.accountName || a.name || ''}</option>
          ))}
        </datalist>

        <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div className="grid grid-cols-[90px_1fr_88px_88px_24px] gap-1 px-2 py-1.5 text-[9.5px] tracking-wider font-semibold" style={{ background: 'var(--surface)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            <span>HESAP</span>
            <span>AÇIKLAMA</span>
            <span className="text-right">BORÇ</span>
            <span className="text-right">ALACAK</span>
            <span></span>
          </div>
          {lines.length === 0 && (
            <div className="px-3 py-4 text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Henüz satır yok. + Satır ekle ile başla.
            </div>
          )}
          {lines.map((line, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[90px_1fr_88px_88px_24px] gap-1 px-2 py-1.5"
              style={{ borderBottom: idx === lines.length - 1 ? 'none' : '1px solid var(--border-soft)' }}
            >
              <input
                type="text"
                value={line.accountCode}
                onChange={(e) => updateLine(idx, { accountCode: e.target.value })}
                list={`accounts-${taxpayerId}`}
                placeholder="191.01.020"
                className="px-1.5 py-1 rounded text-[11px] font-mono outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)', color: 'var(--accent)' }}
              />
              <input
                type="text"
                value={line.description}
                onChange={(e) => updateLine(idx, { description: e.target.value })}
                placeholder="Açıklama"
                className="px-1.5 py-1 rounded text-[11.5px] outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)', color: 'var(--text)' }}
              />
              <input
                type="number"
                step="0.01"
                value={line.debit}
                onChange={(e) => updateLine(idx, { debit: e.target.value, credit: e.target.value ? '' : line.credit })}
                placeholder="0,00"
                className="px-1.5 py-1 rounded text-[11.5px] text-right font-mono tabular-nums outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)', color: 'var(--text)' }}
              />
              <input
                type="number"
                step="0.01"
                value={line.credit}
                onChange={(e) => updateLine(idx, { credit: e.target.value, debit: e.target.value ? '' : line.debit })}
                placeholder="0,00"
                className="px-1.5 py-1 rounded text-[11.5px] text-right font-mono tabular-nums outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)', color: 'var(--text)' }}
              />
              <button
                type="button"
                onClick={() => removeLine(idx)}
                className="p-1 rounded text-[11px]"
                style={{ color: 'var(--text-muted)' }}
                title="Satırı sil"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {/* Toplam */}
          <div className="grid grid-cols-[90px_1fr_88px_88px_24px] gap-1 px-2 py-1.5 text-[11px] font-semibold" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Toplam</span>
            <span style={{ color: isBalanced ? '#10b981' : '#ef4444' }}>
              {isBalanced ? '✓ Dengeli' : `Fark ${(sumDebit - sumCredit).toFixed(2)}`}
            </span>
            <span className="text-right font-mono tabular-nums" style={{ color: 'var(--text)' }}>{sumDebit.toFixed(2)}</span>
            <span className="text-right font-mono tabular-nums" style={{ color: 'var(--text)' }}>{sumCredit.toFixed(2)}</span>
            <span></span>
          </div>
          {/* Belge tutarıyla karşılaştırma */}
          {total > 0 && (
            <div className="px-2 py-1.5 text-[10.5px]" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border-soft)', color: matchesTotal ? '#10b981' : '#ef4444' }}>
              Belge tutarı: <span className="font-mono">{fmtTl(total)}</span>
              {!matchesTotal && (
                <span> · Yevmiye toplamı uyumsuz ({fmtTl(Math.max(sumDebit, sumCredit))})</span>
              )}
            </div>
          )}
        </div>
        <div className="mt-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Hesap kutusuna yazmaya başla → mukellefin hesap planından öneri gelir. Satır eklemek için + butonu.
        </div>
      </div>

      {/* Aksiyon butonları */}
      <div className="grid grid-cols-3 gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="flex items-center justify-center gap-1 py-2 text-[12px] font-medium rounded-lg disabled:opacity-50"
          style={{ background: 'transparent', border: '1px solid #ef444460', color: '#ef4444' }}
        >
          {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          Sil
        </button>
        <button
          onClick={() => saveMut.mutate()}
          disabled={!dirty || saveMut.isPending}
          className="flex items-center justify-center gap-1 py-2 text-[12px] font-medium rounded-lg disabled:opacity-50"
          style={{ background: dirty ? 'var(--accent-light)' : 'transparent', border: `1px solid ${dirty ? 'var(--accent)' : 'var(--border)'}`, color: dirty ? 'var(--accent)' : 'var(--text-muted)' }}
        >
          {saveMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {dirty ? 'Kaydet' : 'Kaydedildi'}
        </button>
        <button
          onClick={handleApprove}
          disabled={approving || blocked}
          title={blocked ? 'Yevmiye dengesiz veya hata var — düzelt' : 'Onayla (F9)'}
          className="flex items-center justify-center gap-1 py-2 text-[12px] font-semibold rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ background: blocked ? '#6b7280' : '#10b981', color: 'white' }}
        >
          {approving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          {blocked ? 'Hata' : 'Onayla F9'}
        </button>
      </div>
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
