'use client';

import { useState, useMemo, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Check, Loader2, ListChecks,
  ChevronRight, ArrowDownLeft, ArrowUpRight, Pencil, Inbox, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';
import FaturaDetayDrawer from '../_dialogs/FaturaDetayDrawer';

type Props = {
  taxpayerId?: string;
  period: string;
  taxpayers: Array<any>;
};

type Direction = 'ALIS' | 'SATIS';

function docDirection(d: any): Direction {
  const k = String(d?.invoiceKind ?? d?.direction ?? '').toUpperCase();
  return k.startsWith('ALI') ? 'ALIS' : 'SATIS';
}

const DIR_STYLE: Record<Direction, { color: string; bg: string; label: string; Icon: any }> = {
  ALIS: { color: '#60a5fa', bg: 'rgba(96,165,250,0.14)', label: 'Alış',  Icon: ArrowDownLeft },
  SATIS:{ color: '#fbbf24', bg: 'rgba(251,191,36,0.14)', label: 'Satış', Icon: ArrowUpRight },
};

export default function EslestirmePanel({ taxpayerId, period, taxpayers }: Props) {
  const qc = useQueryClient();
  const [direction, setDirection] = useState<Direction>('ALIS');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [drawerDir, setDrawerDir] = useState<Direction | null>(null);

  const docsQ = useQuery({
    queryKey: ['fatura-merkezi', 'approval-queue', taxpayerId, period],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/documents', { params: { taxpayerId, period, status: 'PENDING', limit: 300 } })
        .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.documents || r.data?.data || [])))
        .catch(() => []),
    refetchInterval: (q) => {
      const data = (q.state.data as any[]) || [];
      return data.some((d) => d.status === 'PROCESSING') ? 4000 : false;
    },
  });

  const allDocs: any[] = docsQ.data || [];
  const alisDocs = useMemo(() => allDocs.filter((d) => docDirection(d) === 'ALIS'), [allDocs]);
  const satisDocs = useMemo(() => allDocs.filter((d) => docDirection(d) === 'SATIS'), [allDocs]);
  const docs = direction === 'ALIS' ? alisDocs : satisDocs;

  const selectedDoc = docs.find((d) => d.id === selectedDocId) || docs[0] || null;
  const selectedTaxpayer = taxpayers.find((t) => t.id === (selectedDoc?.taxpayerId || taxpayerId));
  const defterIsIsletme = /ISLETME|İŞLETME|DEFTER_BEYAN/i.test(
    selectedTaxpayer?.defterTuru || selectedTaxpayer?.mihsapDefterTuru || selectedDoc?.defterTuru || '',
  );

  const approveMut = useMutation({
    mutationFn: async (id: string) => api.post(`/fatura-muhasebelestirme/documents/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi'] });
    },
  });

  const dirHighConfidence = docs.filter((d) => (d.confidence ?? d.matchConfidence ?? 0) >= 0.85 && d.status !== 'PROCESSING');
  const bulkApproveMut = useMutation({
    mutationFn: async () => {
      let ok = 0;
      const failed: string[] = [];
      for (const d of dirHighConfidence) {
        try {
          await api.post(`/fatura-muhasebelestirme/documents/${d.id}/approve`);
          ok++;
        } catch {
          failed.push(d.vendorName || d.customerName || d.belgeNo || d.id);
        }
      }
      return { ok, failed };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi'] });
      if (res.failed.length === 0) {
        toast.success(`${res.ok} belge onaylandı`);
      } else {
        const ornek = res.failed.slice(0, 3).join(', ') + (res.failed.length > 3 ? '…' : '');
        toast.error(`${res.ok} onaylandı · ${res.failed.length} başarısız: ${ornek}`);
      }
    },
    onError: () => toast.error('Toplu onay başarısız oldu'),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* Üst bar: Alış/Satış sekmeleri + toplu onay */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#fafaf9', letterSpacing: -0.3, marginRight: 4 }}>Eşleştirme &amp; Onay</span>

        {/* Alış / Satış segment */}
        <div style={{ display: 'flex', gap: 6 }}>
          {(['ALIS', 'SATIS'] as Direction[]).map((d) => {
            const st = DIR_STYLE[d];
            const count = d === 'ALIS' ? alisDocs.length : satisDocs.length;
            const active = direction === d;
            return (
              <button key={d} type="button" onClick={() => { setDirection(d); setSelectedDocId(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: 9,
                  fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer',
                  background: active ? st.bg : 'transparent',
                  color: active ? st.color : 'rgba(250,250,249,0.5)',
                  border: `1px solid ${active ? st.color + '55' : 'rgba(255,255,255,0.08)'}`,
                  transition: 'all 0.12s',
                }}>
                <st.Icon size={14} />
                {st.label}
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 18, padding: '0 6px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: active ? st.color : 'rgba(255,255,255,0.1)', color: active ? '#0f0d0b' : 'rgba(250,250,249,0.6)' }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        {dirHighConfidence.length > 0 && (
          <button type="button" onClick={() => bulkApproveMut.mutate()} disabled={bulkApproveMut.isPending}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            {bulkApproveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <ListChecks size={13} />}
            Yüksek güveni toplu onayla ({dirHighConfidence.length})
          </button>
        )}
        <button type="button" onClick={() => docsQ.refetch()} disabled={docsQ.isFetching}
          style={{ display: 'flex', alignItems: 'center', padding: '7px 10px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.5)', cursor: 'pointer' }}>
          <RefreshCw size={13} className={docsQ.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Gövde: kuyruk + çalışma alanı */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* Sol kuyruk */}
        <div style={{ width: 268, flexShrink: 0, background: '#15110d', borderRight: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {docsQ.isLoading && (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'rgba(250,250,249,0.4)' }}>Yükleniyor...</div>
          )}
          {!docsQ.isLoading && docs.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Inbox size={26} style={{ margin: '0 auto 8px', color: 'rgba(250,250,249,0.25)' }} />
              <div style={{ fontSize: 12, color: 'rgba(250,250,249,0.45)' }}>
                {direction === 'ALIS' ? 'Bekleyen alış belgesi yok' : 'Bekleyen satış belgesi yok'}
              </div>
            </div>
          )}
          {docs.map((doc) => {
            const isSelected = doc.id === selectedDoc?.id;
            const conf = doc.confidence ?? doc.matchConfidence ?? 0;
            const isProcessing = doc.status === 'PROCESSING';
            const hasIssue = doc.validationStatus === 'INVALID' || doc.validationStatus === 'INCOMPLETE' || (doc.validationIssues?.length > 0);
            const total = Number(doc.totalAmount ?? doc.toplamTutar ?? 0);
            const name = doc.vendorName || doc.customerName || doc.belgeNo || '—';
            const confColor = conf >= 0.85 ? '#4ade80' : conf >= 0.5 ? '#f59e0b' : '#f87171';
            const st = DIR_STYLE[direction];

            return (
              <button key={doc.id} type="button" onClick={() => setSelectedDocId(doc.id)}
                style={{
                  width: '100%', display: 'block', textAlign: 'left', padding: '10px 13px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)', border: 'none',
                  borderLeft: isSelected ? `3px solid ${st.color}` : '3px solid transparent',
                  background: isSelected ? st.bg : 'transparent', cursor: 'pointer',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: isSelected ? st.color : '#fafaf9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                  </span>
                  {hasIssue && <AlertTriangle size={11} color="#f59e0b" />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'rgba(250,250,249,0.45)', fontVariantNumeric: 'tabular-nums' }}>
                    {total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                  </span>
                  <span style={{ marginLeft: 'auto' }} />
                  {isProcessing ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '1px 6px', borderRadius: 20, background: 'rgba(56,189,248,0.14)', color: '#38bdf8' }}>
                      <Loader2 size={9} className="animate-spin" /> OCR
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, background: `${confColor}18`, color: confColor }}>
                      {Math.round(conf * 100)}%
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Sağ çalışma alanı */}
        {selectedDoc ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
            {/* Belge başlık + defter rozeti */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#fafaf9', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedDoc.vendorName || selectedDoc.customerName || '—'}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(250,250,249,0.45)' }}>
                  {selectedDoc.belgeNo || '—'} · {selectedDoc.faturaTarihi ? new Date(selectedDoc.faturaTarihi).toLocaleDateString('tr-TR') : '—'}
                </div>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, background: DIR_STYLE[direction].bg, color: DIR_STYLE[direction].color, flexShrink: 0 }}>
                {(() => { const I = DIR_STYLE[direction].Icon; return <I size={12} />; })()}
                {DIR_STYLE[direction].label}
              </span>
              <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, background: defterIsIsletme ? 'rgba(56,189,248,0.12)' : 'rgba(167,139,250,0.12)', color: defterIsIsletme ? '#7dd3fc' : '#c4b5fd', flexShrink: 0 }}>
                {defterIsIsletme ? 'İşletme defteri' : 'Bilanço esası'}
              </span>
            </div>

            {selectedDoc.status === 'PROCESSING' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '60px 0', color: 'rgba(250,250,249,0.4)' }}>
                <Loader2 size={30} className="animate-spin" style={{ color: '#38bdf8' }} />
                <span style={{ fontSize: 13 }}>OCR işleniyor — matrah/KDV ve yevmiye birazdan hazır</span>
              </div>
            ) : defterIsIsletme ? (
              <IsletmeOzet doc={selectedDoc} onEdit={() => setDrawerDir(direction)} onApprove={() => approveMut.mutate(selectedDoc.id)} approving={approveMut.isPending} approveError={approveMut.error} />
            ) : (
              <BilancoOzet doc={selectedDoc} onEdit={() => setDrawerDir(direction)} onApprove={() => approveMut.mutate(selectedDoc.id)} approving={approveMut.isPending} approveError={approveMut.error} />
            )}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', color: 'rgba(250,250,249,0.35)' }}>
              <ChevronRight size={30} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
              <div style={{ fontSize: 13 }}>Soldan belge seç</div>
            </div>
          </div>
        )}
      </div>

      {drawerDir && (
        <FaturaDetayDrawer
          taxpayerId={selectedDoc?.taxpayerId || taxpayerId || ''}
          direction={drawerDir}
          period={period}
          defterTuru={selectedTaxpayer?.defterTuru}
          onClose={() => { setDrawerDir(null); docsQ.refetch(); }}
        />
      )}
    </div>
  );
}

/* ─── Bilanço özeti (yevmiye fişi) ─── */
function BilancoOzet({ doc, onEdit, onApprove, approving, approveError }: {
  doc: any; onEdit: () => void; onApprove: () => void; approving: boolean; approveError?: any;
}) {
  const lines: any[] = Array.isArray(doc.lines) ? doc.lines : [];
  const sumDebit = lines.reduce((s, l) => s + parseFloat(l.debit || 0), 0);
  const sumCredit = lines.reduce((s, l) => s + parseFloat(l.credit || 0), 0);
  const isBalanced = Math.abs(sumDebit - sumCredit) < 0.02;
  const total = Number(doc.totalAmount ?? doc.toplamTutar ?? 0);
  const matchesTotal = total > 0 ? Math.abs(Math.max(sumDebit, sumCredit) - total) < 0.02 : true;
  const blocked = doc.validationStatus === 'INVALID' || doc.validationStatus === 'INCOMPLETE' || !isBalanced || !matchesTotal || lines.length === 0;
  const issues = Array.isArray(doc.validationIssues) ? doc.validationIssues : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {issues.length > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <AlertTriangle size={13} color="#f59e0b" />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b' }}>Düzeltilmeli</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: 'rgba(250,250,249,0.65)' }}>
            {issues.map((i: any, idx: number) => <li key={idx}>{i.message}</li>)}
          </ul>
        </div>
      )}

      {/* Belge bilgi kartı */}
      <div style={{ background: '#1b1510', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Info label="Matrah" value={fmtTl((doc.taxableAmount ?? doc.matrah) || (total - (doc.taxAmount ?? doc.kdv ?? 0)))} />
          <Info label="KDV" value={fmtTl(doc.taxAmount ?? doc.kdv)} />
          <Info label="Toplam" value={fmtTl(total)} accent />
        </div>
      </div>

      {/* Yevmiye fişi */}
      <div style={{ background: '#1b1510', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '9px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 11, fontWeight: 600, letterSpacing: 1, color: 'rgba(250,250,249,0.4)' }}>
          YEVMİYE FİŞİ
        </div>
        {lines.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'rgba(250,250,249,0.35)' }}>Yevmiye satırı yok — Düzelt ile ekle</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                <th style={thStyle}>HESAP</th>
                <th style={thStyle}>AÇIKLAMA</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>BORÇ</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>ALACAK</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '7px 12px', fontFamily: 'monospace', color: '#2dd4bf' }}>{l.accountCode || '—'}</td>
                  <td style={{ padding: '7px 12px', color: 'rgba(250,250,249,0.7)' }}>{l.description}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: '#fafaf9', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(l.debit)}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: '#fafaf9', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(l.credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
                <td colSpan={2} style={{ padding: '7px 12px', fontSize: 11.5, fontWeight: 600, color: isBalanced ? '#4ade80' : '#f87171' }}>
                  {isBalanced ? '✓ Denge tamam' : `Fark: ${fmtAmount(sumDebit - sumCredit)}`}
                </td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 700, color: '#fafaf9', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(sumDebit)}</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 700, color: '#fafaf9', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(sumCredit)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {approveError && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 12, color: '#fca5a5' }}>
          {(approveError as any)?.response?.data?.message || 'Onaylama hatası'}
        </div>
      )}

      <ActionButtons blocked={blocked} approving={approving} onEdit={onEdit} onApprove={onApprove} />
    </div>
  );
}

/* ─── İşletme defteri özeti ─── */
function IsletmeOzet({ doc, onEdit, onApprove, approving, approveError }: {
  doc: any; onEdit: () => void; onApprove: () => void; approving: boolean; approveError?: any;
}) {
  const total = Number(doc.totalAmount ?? doc.toplamTutar ?? 0);
  const taxable = Number(doc.taxableAmount ?? doc.matrah ?? 0);
  const taxAmount = Number(doc.taxAmount ?? doc.kdv ?? 0);
  const lines: any[] = Array.isArray(doc.lines) ? doc.lines : [];
  const blocked = doc.validationStatus === 'INVALID' || lines.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: '#1b1510', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Info label="Matrah (bilgi)" value={fmtTl(taxable || (total - taxAmount))} />
          <Info label="KDV" value={fmtTl(taxAmount)} />
          <Info label="Toplam" value={fmtTl(total)} accent />
        </div>
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'rgba(250,250,249,0.5)' }}>
          İşletme defterinde hesap kodu kullanılmaz; yön (gider/gelir) ve gider türü esas alınır. Detaylı düzenleme için <strong style={{ color: '#7dd3fc' }}>Düzelt</strong>.
        </div>
      </div>

      {lines.length > 0 && (
        <div style={{ background: '#1b1510', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '9px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 11, fontWeight: 600, letterSpacing: 1, color: 'rgba(250,250,249,0.4)' }}>
            İŞLETME KAYDI
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} style={{ borderTop: i ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <td style={{ padding: '7px 12px', color: 'rgba(250,250,249,0.7)' }}>{l.description || l.group}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: '#fafaf9', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(l.debit || l.credit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approveError && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 12, color: '#fca5a5' }}>
          {(approveError as any)?.response?.data?.message || 'Onaylama hatası'}
        </div>
      )}

      <ActionButtons blocked={blocked} approving={approving} onEdit={onEdit} onApprove={onApprove} />
    </div>
  );
}

function ActionButtons({ blocked, approving, onEdit, onApprove }: { blocked: boolean; approving: boolean; onEdit: () => void; onApprove: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <button type="button" onClick={onEdit}
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 500, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fafaf9', cursor: 'pointer' }}>
        <Pencil size={14} /> Düzelt
      </button>
      <button type="button" onClick={onApprove} disabled={approving || blocked}
        title={blocked ? 'Yevmiye eksik/dengesiz — önce Düzelt' : 'Onayla'}
        style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, background: blocked ? 'rgba(107,114,128,0.4)' : 'linear-gradient(135deg,#2dd4bf,#22d3ee)', border: 'none', color: blocked ? 'rgba(250,250,249,0.5)' : '#0f0d0b', cursor: approving || blocked ? 'not-allowed' : 'pointer' }}>
        {approving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        {blocked ? 'Önce düzelt' : 'Onayla'}
      </button>
    </div>
  );
}

const thStyle: CSSProperties = { padding: '7px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', color: 'rgba(250,250,249,0.4)' };

function Info({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'rgba(250,250,249,0.4)', marginBottom: 3, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: accent ? 700 : 500, color: accent ? '#2dd4bf' : '#fafaf9', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function fmtAmount(value: any): string {
  const n = parseFloat(String(value || 0));
  if (!n) return '';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTl(value: any): string {
  const n = parseFloat(String(value || 0));
  if (!n) return '—';
  return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`;
}
