'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Inbox, RefreshCw, ArrowDownToLine, ArrowUpFromLine, Search, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Props = {
  taxpayerId?: string;
  period: string;
};

type InboxItem = {
  id: string;
  entegrator: string;
  uuid: string;
  faturaNo: string | null;
  faturaDate: string | null;
  senderVkn: string | null;
  senderTitle: string | null;
  receiverVkn: string | null;
  matrah: string | null;
  kdv: string | null;
  toplam: string | null;
  paraBirimi: string;
  direction: string;
  invoiceProfile: string | null;
  markedAt: string | null;
  createdAt: string;
};

const DIR_LABEL: Record<string, string> = { IN: 'Alış', OUT: 'Satış' };
const DIR_COLOR: Record<string, string> = { IN: 'rgba(45,212,191,0.15)', OUT: 'rgba(251,146,60,0.15)' };
const DIR_TEXT: Record<string, string>  = { IN: '#2dd4bf', OUT: '#fb923c' };

function fmt(v: string | null | undefined): string {
  if (!v) return '—';
  const n = parseFloat(v);
  if (!isFinite(n)) return v;
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('tr-TR'); } catch { return s; }
}

export default function EFaturaInboxPanel({ taxpayerId, period }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [dirFilter, setDirFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');

  const inboxQ = useQuery<InboxItem[]>({
    queryKey: ['efatura-inbox', taxpayerId, period],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/efatura-inbox', {
          params: { taxpayerId, period, limit: 500 },
        })
        .then((r) => (Array.isArray(r.data) ? r.data : [])),
    staleTime: 30_000,
  });

  const syncMut = useMutation({
    mutationFn: async (direction: 'IN' | 'OUT') =>
      api.post('/fatura-muhasebelestirme/efatura-sync', { direction }),
    onSuccess: (_, dir) => {
      toast.success(`${DIR_LABEL[dir]} faturaları entegratörden çekildi`);
      qc.invalidateQueries({ queryKey: ['efatura-inbox'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Sync hatası'),
  });

  const items: InboxItem[] = inboxQ.data || [];

  const filtered = items.filter((it) => {
    if (dirFilter !== 'ALL' && it.direction !== dirFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (it.senderTitle || '').toLowerCase().includes(q) ||
        (it.faturaNo || '').toLowerCase().includes(q) ||
        (it.senderVkn || '').includes(q) ||
        (it.entegrator || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const inCount  = items.filter((i) => i.direction === 'IN').length;
  const outCount = items.filter((i) => i.direction === 'OUT').length;
  const syncing  = syncMut.isPending;

  return (
    <div style={{ padding: '20px 24px', minHeight: 400 }}>

      {/* Başlık + eylem */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Inbox size={18} color="#2dd4bf" />
          <span style={{ fontSize: 15, fontWeight: 700, color: '#fafaf9' }}>E-Fatura Gelen Kutusu</span>
          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'rgba(45,212,191,0.12)', color: '#2dd4bf' }}>
            {items.length} kayıt
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => syncMut.mutate('IN')}
            disabled={syncing}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.25)', color: '#2dd4bf', fontSize: 12, fontWeight: 600, cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.6 : 1 }}
          >
            {syncing ? <Loader2 size={13} className="animate-spin" /> : <ArrowDownToLine size={13} />}
            Alış Çek
          </button>
          <button
            type="button"
            onClick={() => syncMut.mutate('OUT')}
            disabled={syncing}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.25)', color: '#fb923c', fontSize: 12, fontWeight: 600, cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.6 : 1 }}
          >
            {syncing ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpFromLine size={13} />}
            Satış Çek
          </button>
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: ['efatura-inbox'] })}
            disabled={inboxQ.isFetching}
            style={{ display: 'flex', alignItems: 'center', padding: '7px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.5)', cursor: 'pointer' }}
          >
            <RefreshCw size={13} className={inboxQ.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Özet kartları */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Alış', count: inCount, color: '#2dd4bf', bg: 'rgba(45,212,191,0.08)', dir: 'IN' as const },
          { label: 'Satış', count: outCount, color: '#fb923c', bg: 'rgba(251,146,60,0.08)', dir: 'OUT' as const },
        ].map((c) => (
          <button
            key={c.dir}
            type="button"
            onClick={() => setDirFilter((prev) => (prev === c.dir ? 'ALL' : c.dir))}
            style={{ flex: 1, padding: '12px 16px', borderRadius: 10, background: dirFilter === c.dir ? c.bg : 'rgba(255,255,255,0.04)', border: `1px solid ${dirFilter === c.dir ? c.color + '55' : 'rgba(255,255,255,0.08)'}`, cursor: 'pointer', textAlign: 'left' }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color: c.color, lineHeight: 1.1 }}>{c.count}</div>
            <div style={{ fontSize: 12, color: 'rgba(250,250,249,0.5)', marginTop: 2 }}>{c.label} e-Fatura</div>
          </button>
        ))}
      </div>

      {/* Arama */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 9, background: '#15110d', border: '1px solid rgba(255,255,255,0.08)', marginBottom: 12 }}>
        <Search size={13} style={{ color: 'rgba(250,250,249,0.35)', flexShrink: 0 }} />
        <input
          placeholder="Firma, fatura no, VKN ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: '#fafaf9' }}
        />
      </div>

      {/* Tablo */}
      {inboxQ.isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 32, justifyContent: 'center', color: 'rgba(250,250,249,0.4)' }}>
          <Loader2 size={16} className="animate-spin" /> Yükleniyor...
        </div>
      ) : inboxQ.isError ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 24, color: '#f87171' }}>
          <AlertCircle size={15} /> Yüklenirken hata oluştu
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'rgba(250,250,249,0.35)', fontSize: 13 }}>
          {items.length === 0
            ? 'Henüz inbox kaydı yok. "Alış Çek" / "Satış Çek" ile entegratörden fatura çekin.'
            : 'Filtre sonucu bulunamadı.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Yön', 'Entegratör', 'Fatura No', 'Tarih', 'Gönderen', 'Matrah', 'KDV', 'Toplam', 'Aktarıldı'].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'rgba(250,250,249,0.45)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: DIR_COLOR[it.direction] || 'rgba(255,255,255,0.06)', color: DIR_TEXT[it.direction] || '#fafaf9' }}>
                      {DIR_LABEL[it.direction] || it.direction}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', color: 'rgba(250,250,249,0.7)', fontWeight: 500 }}>{it.entegrator}</td>
                  <td style={{ padding: '8px 10px', color: '#fafaf9', fontFamily: 'monospace', fontSize: 12 }}>{it.faturaNo || '—'}</td>
                  <td style={{ padding: '8px 10px', color: 'rgba(250,250,249,0.6)', whiteSpace: 'nowrap' }}>{fmtDate(it.faturaDate)}</td>
                  <td style={{ padding: '8px 10px', color: '#fafaf9', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <div>{it.senderTitle || it.senderVkn || '—'}</div>
                    {it.senderVkn && it.senderTitle && <div style={{ fontSize: 10.5, color: 'rgba(250,250,249,0.4)', marginTop: 1 }}>{it.senderVkn}</div>}
                  </td>
                  <td style={{ padding: '8px 10px', color: 'rgba(250,250,249,0.75)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(it.matrah)}</td>
                  <td style={{ padding: '8px 10px', color: 'rgba(250,250,249,0.75)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(it.kdv)}</td>
                  <td style={{ padding: '8px 10px', color: '#fafaf9', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(it.toplam)} <span style={{ fontSize: 10, color: 'rgba(250,250,249,0.4)' }}>{it.paraBirimi}</span></td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    {it.markedAt
                      ? <CheckCircle2 size={14} color="#4ade80" />
                      : <span style={{ color: 'rgba(250,250,249,0.25)', fontSize: 11 }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
