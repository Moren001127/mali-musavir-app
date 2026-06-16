'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, ChevronLeft, ChevronRight, Check, Trash2, Save,
  Loader2, FileText, AlertTriangle, ListChecks, Plus,
  Maximize2, Minimize2,
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
  defterTuru?: string | null;
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

export default function FaturaDetayDrawer({ taxpayerId, direction, period, defterTuru, onClose }: Props) {
  const qc = useQueryClient();
  const [cursor, setCursor] = useState(0);
  const [fitToScreen, setFitToScreen] = useState(true);
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const [fitScale, setFitScale] = useState(1);

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
      mimeType: (r.data?.mimeType as string) || null,
      source: (r.data?.source as string) || null,
    })),
    enabled: !!current?.id,
  });
  const hasPreview = !!(fileQ.data?.url || fileQ.data?.inlineHtml);
  const previewSource = fileQ.data?.source;
  const previewMimeType = fileQ.data?.mimeType || current?.mimeType || '';
  const previewIsImage = /^image\//i.test(previewMimeType);
  const fitUrl = useMemo(() => {
    const url = fileQ.data?.url;
    if (!url || !fitToScreen) return url;
    const glue = url.includes('#') ? '&' : '#';
    return `${url}${glue}zoom=page-width&view=FitH&toolbar=0&navpanes=0`;
  }, [fileQ.data?.url, fitToScreen]);

  useEffect(() => {
    const box = previewBoxRef.current;
    if (!box || !fitToScreen) {
      setFitScale(1);
      return;
    }

    const update = () => {
      const width = Math.max(1, box.clientWidth - 24);
      const scale = Math.min(width / 794, 1.8);
      setFitScale(Math.max(0.35, Number(scale.toFixed(3))));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(box);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [fitToScreen, current?.id, hasPreview]);

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
              {previewSource === 'original-xslt' && '✓ UBL/XSLT orijinal fatura görünümü'}
              {previewSource === 'stored-html' && '✓ Kayıtlı HTML'}
              {previewSource === 'stored-file' && '✓ Kayıtlı dosya'}
              {previewSource === 'rendered-from-xml' && '⚠ Sistem render\'ı — Luca\'da bu fatura için PDF/HTML inmemiş, sadece XML var. Görüntü basit.'}
              {previewSource === 'placeholder' && '⚠ Orijinal belge dosyası yok'}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setFitToScreen((v) => !v)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold transition"
                style={{
                  background: fitToScreen ? '#ffffff20' : '#00000018',
                  border: '1px solid #ffffff28',
                  color: 'inherit',
                }}
                title={fitToScreen ? 'Faturayi normal boyutta goster' : 'Faturayi ekrana sigdir'}
              >
                {fitToScreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                {fitToScreen ? `Sığdır (${Math.round(fitScale * 100)}%)` : 'Ekrana sığdır'}
              </button>
            </div>
          )}
          <div
            ref={previewBoxRef}
            className={`flex-1 min-h-0 ${fitToScreen ? 'overflow-auto flex items-start justify-center p-3' : 'overflow-auto flex items-start justify-center'}`}
          >
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
            {current && fileQ.data?.url && previewIsImage && (
              <img
                src={fileQ.data.url}
                alt={current.originalName || current.belgeNo || 'Belge'}
                className={fitToScreen ? 'max-w-full max-h-full object-contain rounded-sm shadow-2xl' : 'max-w-none rounded-sm shadow-2xl'}
                style={{ background: 'white' }}
              />
            )}
            {current && fileQ.data?.url && !previewIsImage && (
              fitToScreen ? (
                <div
                  className="shrink-0 rounded-sm shadow-2xl overflow-hidden"
                  style={{ width: 794 * fitScale, height: 1123 * fitScale, background: 'white' }}
                >
                  <iframe
                    src={fitUrl || fileQ.data.url}
                    className="border-0"
                    style={{
                      width: 794,
                      height: 1123,
                      background: 'white',
                      transform: `scale(${fitScale})`,
                      transformOrigin: 'top left',
                    }}
                    title={current.belgeNo || current.id}
                  />
                </div>
              ) : (
                <iframe
                  src={fileQ.data.url}
                  className="w-full h-full border-0"
                  style={{ background: 'white' }}
                  title={current.belgeNo || current.id}
                />
              )
            )}
            {current && !fileQ.data?.url && fileQ.data?.inlineHtml && (
              fitToScreen ? (
                <div
                  className="shrink-0 rounded-sm shadow-2xl overflow-hidden"
                  style={{ width: 794 * fitScale, height: 1123 * fitScale, background: 'white' }}
                >
                  <iframe
                    srcDoc={fileQ.data.inlineHtml}
                    className="border-0"
                    style={{
                      width: 794,
                      height: 1123,
                      background: 'white',
                      transform: `scale(${fitScale})`,
                      transformOrigin: 'top left',
                    }}
                    title={current.belgeNo || current.id}
                    sandbox="allow-same-origin allow-scripts allow-modals allow-popups allow-forms"
                  />
                </div>
              ) : (
                <iframe
                  srcDoc={fileQ.data.inlineHtml}
                  className="w-full h-full border-0"
                  style={{ background: 'white' }}
                  title={current.belgeNo || current.id}
                  sandbox="allow-same-origin allow-scripts allow-modals allow-popups allow-forms"
                />
              )
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
        <div
          className="w-[640px] max-w-[52vw] min-w-[600px] flex flex-col"
          style={{
            background: 'linear-gradient(180deg, rgba(24,20,16,0.98), rgba(10,10,9,0.99))',
            borderLeft: '1px solid rgba(212,184,118,0.22)',
          }}
        >
          {current ? (
            <FaturaForm
              key={current.id}
              doc={current}
              taxpayerId={taxpayerId}
              defterTuru={defterTuru}
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
function FaturaForm({ doc, taxpayerId, defterTuru, onApprove, onDelete, approving, deleting, approveError }: {
  doc: any;
  taxpayerId: string;
  defterTuru?: string | null;
  onApprove: () => void;
  onDelete: () => void;
  approving: boolean;
  deleting: boolean;
  approveError?: any;
}) {
  const qc = useQueryClient();
  const isSale = String(doc.invoiceKind || '').toUpperCase() === 'SATIS';
  const isIsletme = /ISLETME|DEFTER_BEYAN|İŞLETME/.test(String(defterTuru || doc.defterTuru || doc.mihsapDefterTuru || '').toLocaleUpperCase('tr-TR'));
  const supplierName = (isSale ? doc.customerName : doc.vendorName) || '—';
  const supplierVkn = (isSale ? doc.buyerVkn : doc.sellerVkn) || '—';
  const total = Number(doc.totalAmount ?? doc.toplamTutar ?? 0);
  const ownerVkn = isSale ? doc.sellerVkn : doc.buyerVkn;
  const validationIssues = Array.isArray(doc.validationIssues)
    ? doc.validationIssues
    : (Array.isArray(doc.ocrData?.validationIssues) ? doc.ocrData.validationIssues : []);
  const ownershipIssue = validationIssues.find((issue: any) => issue?.code === 'OWNERSHIP_MISMATCH');
  const entryGridColumns = isIsletme
    ? '98px minmax(0,1fr) 58px 94px 24px'
    : '100px minmax(0,1fr) 96px 96px 24px';

  /* Hesap planı (taxpayer-bazlı) — autocomplete önerileri */
  const accountsQ = useQuery({
    queryKey: ['fatura-merkezi', 'account-plan', taxpayerId],
    queryFn: () => api
      .get('/fatura-muhasebelestirme/account-plan', { params: { taxpayerId, limit: 500 } })
      .then((r) => Array.isArray(r.data) ? r.data : (r.data?.accounts || r.data?.lines || r.data?.data || [])),
    enabled: !!taxpayerId && !isIsletme,
  });
  const accounts: any[] = useMemo(
    () => (accountsQ.data || []).map((account: any) => ({
      id: account.id,
      code: String(account.accountCode || account.code || '').trim(),
      name: String(account.accountName || account.name || '').trim(),
    })).filter((account: any) => account.code),
    [accountsQ.data],
  );

  /* İçerik tabanlı hesap kodu / gider türü önerisi */
  const icerikQ = useQuery({
    queryKey: ['fatura-merkezi', 'icerik-eslestir', doc.id],
    queryFn: () =>
      api
        .post('/fatura-muhasebelestirme/icerik-eslestir', {
          taxpayerId,
          senderVkn: doc.sellerVkn || doc.senderVkn || null,
          kalemler: doc.ocrData?.kalemler || doc.kalemler || [],
          defterTuru: defterTuru || 'BILANCO',
        })
        .then((r) => r.data as {
          hesapKodu: string | null;
          hesapAdi: string | null;
          guven: number;
          seviye: 'YUKSEK' | 'ORTA' | 'DUSUK';
          celisiki: boolean;
          isletmeGiderTuru: string | null;
          amortismanaTabi: boolean;
          neden: string;
        })
        .catch(() => null),
    enabled: !!taxpayerId && !isSale,
    staleTime: 300_000,
  });
  const oneri = icerikQ.data;
  const oneriRenkBg  = oneri?.seviye === 'YUKSEK' ? 'rgba(74,222,128,0.1)' : oneri?.seviye === 'ORTA' ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.05)';
  const oneriRenkBdr = oneri?.seviye === 'YUKSEK' ? 'rgba(74,222,128,0.3)' : oneri?.seviye === 'ORTA' ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.1)';
  const oneriRenkTxt = oneri?.seviye === 'YUKSEK' ? '#4ade80' : oneri?.seviye === 'ORTA' ? '#fbbf24' : 'rgba(250,250,249,0.5)';

  /* Editable line state */
  const [lines, setLines] = useState<EditableLine[]>(() =>
    (Array.isArray(doc.lines) ? doc.lines : []).map((l: any) => ({
      id: l.id,
      group: l.group || 'matrah',
      accountCode: l.accountCode || '',
      description: l.description || '',
      rate: l.rate || '',
      debit: parseMoneyInput(l.debit) > 0 ? formatMoneyInput(l.debit) : '',
      credit: parseMoneyInput(l.credit) > 0 ? formatMoneyInput(l.credit) : '',
    })),
  );
  const [dirty, setDirty] = useState(false);

  const updateLine = (idx: number, patch: Partial<EditableLine>) => {
    setLines((arr) => arr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const updateBusinessAmount = (idx: number, value: string) => {
    setLines((arr) => arr.map((line, i) => {
      if (i !== idx) return line;
      const isCounterLine = line.group === 'cari';
      const debitSide = isSale ? isCounterLine : !isCounterLine;
      return {
        ...line,
        debit: debitSide ? value : '',
        credit: debitSide ? '' : value,
      };
    }));
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

  const sumDebit = lines.reduce((s, l) => s + parseMoneyInput(l.debit), 0);
  const sumCredit = lines.reduce((s, l) => s + parseMoneyInput(l.credit), 0);
  const isBalanced = Math.abs(sumDebit - sumCredit) < 0.02;
  const matchesTotal = total > 0 ? Math.abs(Math.max(sumDebit, sumCredit) - total) < 0.02 : true;

  const saveMut = useMutation({
    mutationFn: async () => api.patch(`/fatura-muhasebelestirme/documents/${doc.id}`, {
      lines: lines.map((l) => ({
        group: l.group,
        accountCode: l.accountCode,
        description: l.description,
        rate: l.rate || null,
        debit: moneyForApi(l.debit),
        credit: moneyForApi(l.credit),
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
    <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
      {/* Kompakt başlık paneli */}
      <div className="rounded-lg p-2.5 space-y-2" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        <div>
          <div className="text-[11px] tracking-wider font-semibold mb-0.5" style={{ color: 'var(--text-light)' }}>FİRMA</div>
          <div className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--text)' }}>{supplierName}</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <div>
            <div className="text-[11px] tracking-wider mb-0.5" style={{ color: 'var(--text-light)' }}>VKN/TC</div>
            <div className="font-mono" style={{ color: 'var(--text)' }}>{supplierVkn}</div>
          </div>
          <div>
            <div className="text-[11px] tracking-wider mb-0.5" style={{ color: 'var(--text-light)' }}>BELGE NO</div>
            <div className="font-mono truncate" style={{ color: 'var(--text)' }}>{doc.belgeNo || '-'}</div>
          </div>
          <div>
            <div className="text-[11px] tracking-wider mb-0.5" style={{ color: 'var(--text-light)' }}>TARİH</div>
            <div style={{ color: 'var(--text)' }}>{fmtDate(doc.faturaTarihi)}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1.5 mt-0.5" style={{ borderTop: '1px solid var(--border-soft)' }}>
          <span className="text-[11px] tracking-wider" style={{ color: 'var(--text-light)' }}>TOPLAM</span>
          <span className="text-[16px] font-bold tabular-nums" style={{ color: 'var(--accent)' }}>{fmtTl(total)}</span>
          <div className="flex-1" />
          <span className="text-[11px] tracking-wider" style={{ color: 'var(--text-light)' }}>{doc.documentType || 'E_FATURA'} · {isSale ? 'SATIŞ' : 'ALIŞ'}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div
          className="rounded-lg px-2.5 py-2"
          style={{
            background: ownershipIssue ? '#ef444414' : ownerVkn ? '#10b98112' : '#f59e0b12',
            border: `1px solid ${ownershipIssue ? '#ef444455' : ownerVkn ? '#10b98140' : '#f59e0b40'}`,
          }}
        >
          <div className="text-[11px] tracking-wider font-semibold" style={{ color: 'var(--text-light)' }}>VKN/TC KONTROL</div>
          <div className="text-[11.5px] font-semibold mt-0.5" style={{ color: ownershipIssue ? '#f87171' : ownerVkn ? '#34d399' : '#fbbf24' }}>
            {ownershipIssue ? 'Mükellefle uyuşmuyor' : ownerVkn ? 'Mükellef tarafı eşleşti' : 'VKN/TC okunamadı'}
          </div>
        </div>
        <div
          className="rounded-lg px-2.5 py-2"
          style={{
            background: isIsletme ? '#38bdf815' : '#a78bfa14',
            border: `1px solid ${isIsletme ? '#38bdf850' : '#a78bfa45'}`,
          }}
        >
          <div className="text-[11px] tracking-wider font-semibold" style={{ color: 'var(--text-light)' }}>DEFTER AKIŞI</div>
          <div className="text-[11.5px] font-semibold mt-0.5" style={{ color: isIsletme ? '#7dd3fc' : '#c4b5fd' }}>
            {isIsletme ? 'İşletme kaydı' : 'Bilanço yevmiye'}
          </div>
        </div>
      </div>

      {/* İçerik tabanlı hesap / gider türü önerisi (yalnız alış) */}
      {!isSale && oneri && (oneri.hesapKodu || oneri.isletmeGiderTuru) && (
        <div style={{ padding: '8px 12px', borderRadius: 9, background: oneriRenkBg, border: `1px solid ${oneriRenkBdr}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: oneriRenkTxt, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            AI Öneri · %{oneri.guven}
          </div>
          {oneri.hesapKodu && (
            <div style={{ fontSize: 12, color: '#fafaf9', fontWeight: 600 }}>
              {oneri.hesapKodu} — {oneri.hesapAdi}
            </div>
          )}
          {oneri.isletmeGiderTuru && (
            <div style={{ fontSize: 12, color: '#fafaf9' }}>
              Gider türü: <strong>{oneri.isletmeGiderTuru}</strong>
              {oneri.amortismanaTabi && <span style={{ marginLeft: 6, color: '#fbbf24', fontSize: 11 }}>⚠ Amortisman</span>}
            </div>
          )}
          {oneri.celisiki && <div style={{ fontSize: 11, color: '#fb923c' }}>⚡ Geçmişle çelişki</div>}
          <div style={{ fontSize: 11, color: 'rgba(250,250,249,0.4)', flex: 1, textAlign: 'right' }}>{oneri.neden}</div>
        </div>
      )}

      {/* Validation hata paneli */}
      {(doc.validationStatus === 'INVALID' || doc.validationStatus === 'INCOMPLETE') && validationIssues.length > 0 && (
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
            {validationIssues.map((issue: any, idx: number) => (
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

      {/* Kayit editor */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] tracking-wider font-semibold" style={{ color: 'var(--text-light)' }}>
            {isIsletme ? 'ISLETME KAYDI' : 'YEVMİYE KAYDI'} ({lines.length})
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
            <option key={a.id || a.code} value={a.code}>{a.name}</option>
          ))}
        </datalist>

        <div className="rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(212,184,118,0.30)' }}>
          <div className="grid gap-1.5 px-2.5 py-2 text-[11px] tracking-wider font-bold" style={{ gridTemplateColumns: entryGridColumns, background: 'rgba(212,184,118,0.11)', color: 'var(--text-secondary)', borderBottom: '1px solid rgba(212,184,118,0.24)' }}>
            <span className="min-w-0 truncate">{isIsletme ? 'KAYIT' : 'HESAP'}</span>
            <span className="min-w-0 truncate">AÇIKLAMA</span>
            <span className={`min-w-0 truncate ${isIsletme ? '' : 'text-right'}`}>{isIsletme ? 'KDV' : 'BORÇ'}</span>
            <span className="min-w-0 truncate text-right">{isIsletme ? 'TUTAR' : 'ALACAK'}</span>
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
              className="grid gap-1.5 px-2.5 py-2 min-w-0"
              style={{ gridTemplateColumns: entryGridColumns, borderBottom: idx === lines.length - 1 ? 'none' : '1px solid rgba(212,184,118,0.16)' }}
            >
              {isIsletme ? (
                <select
                  value={line.group}
                  onChange={(e) => updateLine(idx, { group: e.target.value })}
                  className="w-full min-w-0 px-2 py-2 rounded text-[12.5px] outline-none"
                  style={{ background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.28)', color: '#7dd3fc' }}
                >
                  <option value="matrah">{isSale ? 'Gelir kalemi' : 'Gider kalemi'}</option>
                  <option value="vergi">KDV</option>
                  <option value="cari">Belge toplamı</option>
                </select>
              ) : (
                <input
                  type="text"
                  value={line.accountCode}
                  onChange={(e) => updateLine(idx, { accountCode: e.target.value })}
                  list={`accounts-${taxpayerId}`}
                  title={line.accountCode}
                  placeholder="191.01.020"
                  className="w-full min-w-0 px-2 py-2 rounded text-[13px] font-mono tabular-nums outline-none"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)', color: 'var(--accent)' }}
                />
              )}
              <input
                type="text"
                value={line.description}
                onChange={(e) => updateLine(idx, { description: e.target.value })}
                title={line.description}
                placeholder="Açıklama"
                className="w-full min-w-0 px-2 py-2 rounded text-[13px] outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)', color: 'var(--text)' }}
              />
              {isIsletme ? (
                <>
                  <input
                    type="text"
                    value={line.rate || ''}
                    onChange={(e) => updateLine(idx, { rate: e.target.value })}
                    placeholder="%20"
                    className="w-full min-w-0 px-2 py-2 rounded text-[13px] font-mono outline-none"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)', color: 'var(--text)' }}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.debit || line.credit || ''}
                    onChange={(e) => updateBusinessAmount(idx, e.target.value)}
                    onBlur={() => updateBusinessAmount(idx, formatMoneyInput(line.debit || line.credit))}
                    placeholder="0,00"
                    className="w-full min-w-0 px-2 py-2 rounded text-[13px] text-right font-mono tabular-nums outline-none"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)', color: 'var(--text)' }}
                  />
                </>
              ) : (
                <>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.debit}
                    onChange={(e) => updateLine(idx, { debit: e.target.value, credit: e.target.value ? '' : line.credit })}
                    onBlur={() => updateLine(idx, { debit: formatMoneyInput(line.debit) })}
                    placeholder="0,00"
                    className="w-full min-w-0 px-2 py-2 rounded text-[13px] text-right font-mono tabular-nums outline-none"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)', color: 'var(--text)' }}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.credit}
                    onChange={(e) => updateLine(idx, { credit: e.target.value, debit: e.target.value ? '' : line.debit })}
                    onBlur={() => updateLine(idx, { credit: formatMoneyInput(line.credit) })}
                    placeholder="0,00"
                    className="w-full min-w-0 px-2 py-2 rounded text-[13px] text-right font-mono tabular-nums outline-none"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)', color: 'var(--text)' }}
                  />
                </>
              )}
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
          <div className="grid gap-1.5 px-2.5 py-2 text-[12px] font-semibold" style={{ gridTemplateColumns: entryGridColumns, background: 'rgba(212,184,118,0.10)', borderTop: '1px solid rgba(212,184,118,0.24)' }}>
            <span className="min-w-0 truncate" style={{ color: 'var(--text-muted)' }}>Toplam</span>
            <span className="min-w-0 truncate" style={{ color: isBalanced ? '#10b981' : '#ef4444' }}>
              {isBalanced ? '✓ Dengeli' : `Fark ${fmtAmount(sumDebit - sumCredit)}`}
            </span>
            <span className="min-w-0 text-right font-mono tabular-nums" style={{ color: 'var(--text)' }}>{fmtAmount(sumDebit)}</span>
            <span className="min-w-0 text-right font-mono tabular-nums" style={{ color: 'var(--text)' }}>{fmtAmount(sumCredit)}</span>
            <span></span>
          </div>
          {/* Belge tutarıyla karşılaştırma */}
          {total > 0 && (
            <div className="px-2.5 py-2 text-[12px]" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border-soft)', color: matchesTotal ? '#10b981' : '#ef4444' }}>
              Belge tutarı: <span className="font-mono">{fmtTl(total)}</span>
              {!matchesTotal && (
                <span> · Yevmiye toplamı uyumsuz ({fmtTl(Math.max(sumDebit, sumCredit))})</span>
              )}
            </div>
          )}
        </div>
        <div className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {isIsletme ? 'İşletme defterinde hesap kodu kullanılmaz; kayıt/gider-gelir kalemi ve KDV satırlarını kontrol et.' : 'Hesap kutusuna yazmaya başla → mükellefin hesap planından öneri gelir. Satır eklemek için + butonu.'}
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

function parseMoneyInput(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/[^\d.-]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function fmtAmount(value: number | string): string {
  const n = parseMoneyInput(value);
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMoneyInput(value: any): string {
  const n = parseMoneyInput(value);
  return Math.abs(n) > 0.000001 ? fmtAmount(n) : '';
}

function moneyForApi(value: any): string {
  return parseMoneyInput(value).toFixed(2);
}

function fmtTl(value: number | string): string {
  return `${fmtAmount(value)} ₺`;
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
