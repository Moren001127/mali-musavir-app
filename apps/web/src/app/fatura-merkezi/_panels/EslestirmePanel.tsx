'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Check, Loader2, Save, Trash2,
  ChevronRight, ListChecks, Plus,
} from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';
import FaturaDetayDrawer from '../_dialogs/FaturaDetayDrawer';

type Props = {
  taxpayerId?: string;
  period: string;
  taxpayers: Array<any>;
};

/* Isletme defteri modu icin gider turleri */
const GIDER_TURLERI = [
  'Mal alisi', 'Hizmet alisi', 'Akaryakit', 'Kira',
  'Demirbase (amort. tabi)', 'Tasit (amort. tabi)', 'Diger gider',
];

export default function EslestirmePanel({ taxpayerId, period, taxpayers }: Props) {
  const qc = useQueryClient();
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [drawerDoc, setDrawerDoc] = useState<{ taxpayerId: string; direction: 'ALIS' | 'SATIS'; defterTuru?: string | null } | null>(null);
  const [modeSeg, setModeSeg] = useState<'BILANCO' | 'ISLETME'>('BILANCO');

  /* Onay kuyrugu belgeleri */
  const docsQ = useQuery({
    queryKey: ['fatura-merkezi', 'approval-queue', taxpayerId, period],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme', { params: { taxpayerId, period, status: 'PENDING', limit: 100 } })
        .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.documents || r.data?.data || [])))
        .catch(() => []),
  });

  const docs: any[] = docsQ.data || [];
  const selectedDoc = docs.find((d) => d.id === selectedDocId) || docs[0] || null;

  /* Secili belgede isletme mi bilanco mi? */
  const selectedTaxpayer = taxpayers.find((t) => t.id === (selectedDoc?.taxpayerId || taxpayerId));
  const defterIsIsletme = /ISLETME/i.test(selectedTaxpayer?.defterTuru || selectedDoc?.defterTuru || '');

  const approveMut = useMutation({
    mutationFn: async (id: string) => api.post(`/fatura-muhasebelestirme/documents/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'approval-queue'] });
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'per-taxpayer-summary'] });
    },
  });

  const highConfidenceDocs = docs.filter((d) => (d.confidence ?? d.matchConfidence ?? 0) >= 0.85);

  const bulkApproveMut = useMutation({
    mutationFn: async () => {
      for (const d of highConfidenceDocs) {
        await api.post(`/fatura-muhasebelestirme/documents/${d.id}/approve`).catch(() => null);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'approval-queue'] });
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'per-taxpayer-summary'] });
    },
  });

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>

      {/* Sol: Onay kuyrugu sidebar */}
      <div
        style={{
          width: 236, flexShrink: 0,
          background: '#15110d',
          borderRight: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* Toplu onayla butonu */}
        {highConfidenceDocs.length > 0 && (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              type="button"
              onClick={() => bulkApproveMut.mutate()}
              disabled={bulkApproveMut.isPending}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 12px', borderRadius: 9,
                background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)',
                color: '#4ade80', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {bulkApproveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <ListChecks size={13} />}
              Yuksek guvenliyi toplu onayla ({highConfidenceDocs.length})
            </button>
          </div>
        )}

        {/* Liste */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {docsQ.isLoading && (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'rgba(250,250,249,0.4)' }}>Yukleniyor...</div>
          )}
          {!docsQ.isLoading && docs.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center' }}>
              <CheckCircle2 size={28} color="#4ade80" style={{ margin: '0 auto 8px' }} />
              <div style={{ fontSize: 12, color: 'rgba(250,250,249,0.5)' }}>Bekleyen belge yok</div>
            </div>
          )}
          {docs.map((doc) => {
            const isSelected = doc.id === (selectedDoc?.id);
            const conf = doc.confidence ?? doc.matchConfidence ?? 0;
            const hasConflict = doc.hasConflict || (doc.validationIssues?.length > 0);
            const total = Number(doc.totalAmount ?? doc.toplamTutar ?? 0);
            const supplierName = doc.vendorName || doc.customerName || '—';
            const confColor = conf >= 0.85 ? '#4ade80' : conf >= 0.5 ? '#f59e0b' : '#f87171';

            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => setSelectedDocId(doc.id)}
                style={{
                  width: '100%', display: 'block', textAlign: 'left',
                  padding: '10px 12px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: isSelected ? 'rgba(45,212,191,0.1)' : 'transparent',
                  border: 'none',
                  borderLeft: isSelected ? '3px solid #2dd4bf' : '3px solid transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: isSelected ? '#2dd4bf' : '#fafaf9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {supplierName}
                  </span>
                  {hasConflict && <AlertTriangle size={11} color="#f59e0b" />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'rgba(250,250,249,0.4)' }}>
                    {total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL
                  </span>
                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 20, background: `${confColor}18`, color: confColor, marginLeft: 'auto' }}>
                    {Math.round(conf * 100)}%
                  </span>
                  {hasConflict && (
                    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 20, background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                      celisik
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sag: Calisma alani */}
      {selectedDoc ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* Belge baslik */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#fafaf9', marginBottom: 2 }}>
              {selectedDoc.vendorName || selectedDoc.customerName || '—'}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(250,250,249,0.45)' }}>
              {selectedDoc.belgeNo || selectedDoc.documentNumber || '—'} &middot; {selectedDoc.faturaTarihi ? new Date(selectedDoc.faturaTarihi).toLocaleDateString('tr-TR') : '—'}
            </div>
          </div>

          {/* Mod secici */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
            {(['BILANCO', 'ISLETME'] as const).map((mod) => {
              const active = modeSeg === mod || (defterIsIsletme && mod === 'ISLETME') || (!defterIsIsletme && mod === 'BILANCO');
              const forcedActive = defterIsIsletme ? mod === 'ISLETME' : mod === 'BILANCO';
              const isActive = forcedActive;
              return (
                <button
                  key={mod}
                  type="button"
                  onClick={() => setModeSeg(mod)}
                  style={{
                    padding: '6px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: isActive ? 600 : 400,
                    background: isActive ? '#1b1510' : 'transparent',
                    color: isActive ? '#2dd4bf' : 'rgba(250,250,249,0.45)',
                    border: isActive ? '1px solid rgba(45,212,191,0.25)' : '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer',
                  }}
                >
                  {mod === 'BILANCO' ? 'Bilanco esasi' : 'Isletme defteri'}
                </button>
              );
            })}
          </div>

          {defterIsIsletme ? (
            <IsletmeModu doc={selectedDoc} onApprove={() => approveMut.mutate(selectedDoc.id)} approving={approveMut.isPending} />
          ) : (
            <BilancoBelge
              doc={selectedDoc}
              taxpayerId={selectedDoc.taxpayerId || taxpayerId || ''}
              onApprove={() => approveMut.mutate(selectedDoc.id)}
              onOpenDrawer={() => setDrawerDoc({ taxpayerId: selectedDoc.taxpayerId || taxpayerId || '', direction: 'ALIS', defterTuru: selectedTaxpayer?.defterTuru })}
              approving={approveMut.isPending}
            />
          )}

        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: 'rgba(250,250,249,0.35)' }}>
            <ChevronRight size={32} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
            <div style={{ fontSize: 14 }}>Soldan belge sec</div>
          </div>
        </div>
      )}

      {/* Detay drawer */}
      {drawerDoc && (
        <FaturaDetayDrawer
          taxpayerId={drawerDoc.taxpayerId}
          direction={drawerDoc.direction}
          period={period}
          defterTuru={drawerDoc.defterTuru}
          onClose={() => setDrawerDoc(null)}
        />
      )}
    </div>
  );
}

/* ─── Bilanco modu gorunumu ─── */
function BilancoBelge({ doc, taxpayerId, onApprove, onOpenDrawer, approving }: {
  doc: any;
  taxpayerId: string;
  onApprove: () => void;
  onOpenDrawer: () => void;
  approving: boolean;
}) {
  const lines: any[] = Array.isArray(doc.lines) ? doc.lines : [];
  const sumDebit = lines.reduce((s: number, l: any) => s + parseFloat(l.debit || 0), 0);
  const sumCredit = lines.reduce((s: number, l: any) => s + parseFloat(l.credit || 0), 0);
  const isBalanced = Math.abs(sumDebit - sumCredit) < 0.02;
  const total = Number(doc.totalAmount ?? doc.toplamTutar ?? 0);
  const hasConflict = doc.hasConflict || (doc.contentConflict);

  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>

      {/* Icerik catisma banneri */}
      {hasConflict && (
        <div
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 10,
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}
        >
          <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#f59e0b', marginBottom: 2 }}>
              Icerik catismasi
            </div>
            <div style={{ fontSize: 11.5, color: 'rgba(250,250,249,0.6)' }}>
              {doc.conflictMessage || 'Bu satici icin beklenmedik kalem tespit edildi. Hesap kodu onerisi degistirilmis olabilir.'}
            </div>
          </div>
        </div>
      )}

      {/* Sol: Belge & OCR bilgisi */}
      <div style={{ flex: 1, minWidth: 280 }}>
        <div
          style={{
            background: '#1b1510', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, overflow: 'hidden',
          }}
        >
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 11, fontWeight: 600, color: 'rgba(250,250,249,0.4)', letterSpacing: 1 }}>
            BELGE & OCR
          </div>
          <div style={{ padding: '12px 14px' }}>
            <InfoRow label="Satici/Alici" value={doc.vendorName || doc.customerName || '—'} />
            <InfoRow label="Tarih" value={doc.faturaTarihi ? new Date(doc.faturaTarihi).toLocaleDateString('tr-TR') : '—'} />
            <InfoRow label="Belge No" value={doc.belgeNo || '—'} mono />
            <InfoRow label="Matrah" value={fmtTl(doc.taxableAmount ?? doc.matrah)} />
            <InfoRow label="KDV" value={fmtTl(doc.taxAmount ?? doc.kdv)} />
            <InfoRow label="Toplam" value={fmtTl(total)} accent />
          </div>

          {/* Kalemler tablosu */}
          {Array.isArray(doc.ocrData?.lineItems) && doc.ocrData.lineItems.length > 0 && (
            <>
              <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 10.5, color: 'rgba(250,250,249,0.35)', fontWeight: 600 }}>
                KALEMLER
              </div>
              <div style={{ padding: '0 14px 12px' }}>
                {doc.ocrData.lineItems.map((item: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', color: item.flagged ? '#f59e0b' : 'rgba(250,250,249,0.7)' }}>
                    <span>{item.description}</span>
                    <span>{fmtTl(item.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sag: Muhasebe fisi + aksiyon */}
      <div style={{ flex: 1, minWidth: 280 }}>
        <div
          style={{
            background: '#1b1510', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, overflow: 'hidden', marginBottom: 10,
          }}
        >
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 11, fontWeight: 600, color: 'rgba(250,250,249,0.4)', letterSpacing: 1 }}>
            MUHASEBE FIS
          </div>
          {lines.length === 0 ? (
            <div style={{ padding: '14px', fontSize: 12, color: 'rgba(250,250,249,0.3)', textAlign: 'center' }}>
              Yevmiye satiri yok — Detayi ac
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', color: 'rgba(250,250,249,0.4)', fontWeight: 600, fontSize: 10.5 }}>HESAP</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', color: 'rgba(250,250,249,0.4)', fontWeight: 600, fontSize: 10.5 }}>ACIKLAMA</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', color: 'rgba(250,250,249,0.4)', fontWeight: 600, fontSize: 10.5 }}>BORC</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', color: 'rgba(250,250,249,0.4)', fontWeight: 600, fontSize: 10.5 }}>ALACAK</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#2dd4bf', fontSize: 12 }}>{line.accountCode}</td>
                    <td style={{ padding: '6px 10px', color: 'rgba(250,250,249,0.7)', fontSize: 12 }}>{line.description}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', color: '#fafaf9', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(line.debit)}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', color: '#fafaf9', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(line.credit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
                  <td colSpan={2} style={{ padding: '6px 10px', fontSize: 11.5, fontWeight: 600, color: isBalanced ? '#4ade80' : '#f87171' }}>
                    {isBalanced ? '✓ Denge tamam' : `Fark: ${fmtAmount(sumDebit - sumCredit)}`}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#fafaf9', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(sumDebit)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#fafaf9', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(sumCredit)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Aksiyon butonlari */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onOpenDrawer}
            style={{ flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 12.5, fontWeight: 500, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fafaf9', cursor: 'pointer' }}
          >
            Duzenle
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={approving}
            style={{ flex: 2, padding: '9px 0', borderRadius: 9, fontSize: 12.5, fontWeight: 700, background: 'linear-gradient(135deg, #2dd4bf, #22d3ee)', border: 'none', color: '#0f0d0b', cursor: approving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            {approving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Onayla & Luca
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: 10.5, color: 'rgba(250,250,249,0.3)', textAlign: 'center' }}>
          Ctrl+Enter onayla · Tab hucre gec
        </div>
      </div>
    </div>
  );
}

/* ─── Isletme defteri modu ─── */
function IsletmeModu({ doc, onApprove, approving }: { doc: any; onApprove: () => void; approving: boolean }) {
  const [yon, setYon] = useState<'GIDER' | 'GELIR'>('GIDER');
  const [giderTuru, setGiderTuru] = useState(GIDER_TURLERI[0]);
  const [kdvOrani, setKdvOrani] = useState('20');
  const [aciklama, setAciklama] = useState('');

  const total = Number(doc.totalAmount ?? doc.toplamTutar ?? 0);
  const taxable = Number(doc.taxableAmount ?? doc.matrah ?? 0);
  const taxAmount = Number(doc.taxAmount ?? doc.kdv ?? 0);
  const isTasitDemirbase = /demirba|ta[sş][ıi]t/i.test(giderTuru);
  const deftereGiren = isTasitDemirbase ? taxAmount : total;

  return (
    <div
      style={{
        background: '#1b1510', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14, padding: '16px 18px',
      }}
    >
      {/* VUK uyari banneri */}
      {isTasitDemirbase && (
        <div
          style={{
            marginBottom: 14, padding: '10px 14px', borderRadius: 10,
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}
        >
          <AlertTriangle size={14} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11.5, color: '#f59e0b' }}>
            VUK 313/315: Bu turun bedeli deftere yazilamaz; yalnizca KDV gider kaydedilir.
          </div>
        </div>
      )}

      {/* Yon secici */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['GIDER', 'GELIR'] as const).map((y) => (
          <button key={y} type="button" onClick={() => setYon(y)}
            style={{ flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12, fontWeight: yon === y ? 600 : 400, background: yon === y ? 'rgba(45,212,191,0.12)' : 'transparent', color: yon === y ? '#2dd4bf' : 'rgba(250,250,249,0.45)', border: yon === y ? '1px solid rgba(45,212,191,0.3)' : '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
            {y === 'GIDER' ? 'Gider' : 'Gelir'}
          </button>
        ))}
      </div>

      {/* Gider/Gelir turu */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: 'rgba(250,250,249,0.45)', display: 'block', marginBottom: 4 }}>
          {yon === 'GIDER' ? 'Gider Turu' : 'Gelir Turu'}
        </label>
        <select
          value={giderTuru}
          onChange={(e) => setGiderTuru(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: '#0f0d0b', border: '1px solid rgba(255,255,255,0.1)', color: '#fafaf9', fontSize: 13, outline: 'none' }}
        >
          {GIDER_TURLERI.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Matrah bilgi satiri */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ fontSize: 10, color: 'rgba(250,250,249,0.35)', marginBottom: 2 }}>MATRAH (bilgi)</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(250,250,249,0.6)' }}>{fmtTl(taxable)}</div>
        </div>
        <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ fontSize: 10, color: 'rgba(250,250,249,0.35)', marginBottom: 2 }}>KDV</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(250,250,249,0.6)' }}>{fmtTl(taxAmount)}</div>
        </div>
        <div style={{ padding: '8px 10px', borderRadius: 8, background: isTasitDemirbase ? 'rgba(245,158,11,0.1)' : 'rgba(45,212,191,0.08)', border: `1px solid ${isTasitDemirbase ? 'rgba(245,158,11,0.3)' : 'rgba(45,212,191,0.2)'}` }}>
          <div style={{ fontSize: 10, color: 'rgba(250,250,249,0.35)', marginBottom: 2 }}>DEFTERE GIREN</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: isTasitDemirbase ? '#f59e0b' : '#2dd4bf' }}>{fmtTl(deftereGiren)}</div>
        </div>
      </div>

      {/* Aciklama */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: 'rgba(250,250,249,0.45)', display: 'block', marginBottom: 4 }}>Aciklama</label>
        <input
          value={aciklama}
          onChange={(e) => setAciklama(e.target.value)}
          placeholder="Gider/gelir aciklamasi..."
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: '#0f0d0b', border: '1px solid rgba(255,255,255,0.1)', color: '#fafaf9', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {/* Onayla butonu */}
      <button
        type="button"
        onClick={onApprove}
        disabled={approving}
        style={{ width: '100%', padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, background: 'linear-gradient(135deg, #2dd4bf, #22d3ee)', border: 'none', color: '#0f0d0b', cursor: approving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        {approving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        Onayla & Gelir-Gider Girisi
      </button>
    </div>
  );
}

/* ─── Yardimci bilesenler ─── */
function InfoRow({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: 'rgba(250,250,249,0.45)' }}>{label}</span>
      <span style={{ color: accent ? '#2dd4bf' : '#fafaf9', fontFamily: mono ? 'monospace' : undefined, fontWeight: accent ? 600 : 400 }}>{value}</span>
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
  return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`;
}
