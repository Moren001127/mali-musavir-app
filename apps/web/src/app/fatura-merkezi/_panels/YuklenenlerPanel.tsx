'use client';

import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';

type Doc = {
  id: string;
  taxpayer?: any;
  taxpayerName?: string | null;
  originalName?: string | null;
  fileName?: string | null;
  documentNumber?: string | null;
  belgeNo?: string | null;
  faturaTarihi?: string | null;
  createdAt?: string | null;
  vendorName?: string | null;
  customerName?: string | null;
  documentType?: string | null;
  invoiceKind?: string | null;
  direction?: string | null;
  totalAmount?: string | number | null;
  status?: string | null;
  ocrStatus?: string | null;
};

export default function YuklenenlerPanel({ taxpayerId, period }: { taxpayerId?: string; period: string }) {
  const docsQ = useQuery({
    queryKey: ['fatura-merkezi', 'yuklenenler', taxpayerId, period],
    queryFn: () => api
      .get('/fatura-muhasebelestirme/documents', {
        params: { taxpayerId, period, limit: 500 },
      })
      .then((r) => Array.isArray(r.data) ? r.data : (r.data?.documents || r.data?.data || [])),
  });

  const docs: Doc[] = docsQ.data || [];

  const stats = useMemo(() => {
    let pending = 0, success = 0, error = 0, review = 0;
    for (const d of docs) {
      const ocr = String(d.ocrStatus || '').toUpperCase();
      const status = String(d.status || '').toUpperCase();
      if (ocr === 'FAILED' || ocr === 'ERROR') error++;
      else if (ocr === 'PENDING' || ocr === 'IN_PROGRESS' || status === 'PROCESSING') pending++;
      else if (status === 'NEEDS_REVIEW' || ocr === 'NEEDS_REVIEW') review++;
      else success++;
    }
    return { pending, success, error, review };
  }, [docs]);

  const rows = useMemo(() =>
    [...docs].sort((a, b) => {
      const aDate = new Date(a.faturaTarihi || a.createdAt || 0).getTime();
      const bDate = new Date(b.faturaTarihi || b.createdAt || 0).getTime();
      return bDate - aDate;
    }),
    [docs],
  );

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-end gap-3 mb-5">
        <div>
          <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
            Yüklenen Faturalar
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Dönem {period} · Toplu belge listesi · {docs.length} kayıt
          </div>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => docsQ.refetch()}
          className="flex items-center gap-1.5 px-3 py-2 text-[12.5px] rounded-lg"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={13} className={docsQ.isFetching ? 'animate-spin' : ''} />
          Yenile
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        <PipelineStat label="Taranmayı Bekleyen" value={stats.pending} tone="#f59e0b" icon={Clock} />
        <PipelineStat label="Kontrol Gereken" value={stats.review} tone="#ef4444" icon={AlertTriangle} />
        <PipelineStat label="Başarıyla Taranan" value={stats.success} tone="#10b981" icon={CheckCircle2} />
        <PipelineStat label="Hata Alan" value={stats.error} tone="#ef4444" icon={AlertTriangle} />
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <FileText size={15} />
          <span className="text-[12.5px] font-semibold">
            {taxpayerId ? 'Seçili mükellefin' : 'Tüm mükelleflerin'} yüklenen belgeleri
          </span>
          <span className="ml-auto text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            Dönem filtresi belge tarihine göre çalışır; OCR tarih bulamazsa yükleme dönemi esas alınır.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px]">
            <thead style={{ background: 'var(--surface-2)' }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <HeaderCell>Belge / Dosya</HeaderCell>
                <HeaderCell>Belge Tarihi</HeaderCell>
                <HeaderCell>Yüklenme</HeaderCell>
                <HeaderCell>Cari / Satıcı</HeaderCell>
                <HeaderCell>Tür</HeaderCell>
                <HeaderCell align="right">Tutar</HeaderCell>
                <HeaderCell align="right">Durum</HeaderCell>
                <HeaderCell align="right">OCR</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {docsQ.isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                    Yükleniyor...
                  </td>
                </tr>
              )}
              {!docsQ.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                    Bu dönemde yüklenmiş dosya yok.
                  </td>
                </tr>
              )}
              {rows.map((d, idx) => {
                const title = d.originalName || d.fileName || d.documentNumber || d.belgeNo || d.id?.slice(0, 8) || '-';
                const counterparty = d.vendorName || d.customerName || d.taxpayerName || (d.taxpayer ? taxpayerName(d.taxpayer) : '-');
                return (
                  <tr
                    key={d.id}
                    style={{ borderBottom: idx === rows.length - 1 ? 'none' : '1px solid var(--border-soft)' }}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="max-w-[340px] truncate text-[12.5px] font-medium" style={{ color: 'var(--text)' }}>
                        {title}
                      </div>
                      <div className="mt-0.5 text-[11.5px] font-mono" style={{ color: 'var(--text-muted)' }}>
                        {d.belgeNo || d.documentNumber || 'Belge no okunmadı'}
                      </div>
                    </td>
                    <BodyCell>{formatDate(d.faturaTarihi)}</BodyCell>
                    <BodyCell>{formatDateTime(d.createdAt)}</BodyCell>
                    <td className="px-3 py-3 align-top text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
                      <div className="max-w-[260px] truncate">{counterparty}</div>
                    </td>
                    <BodyCell>{formatType(d)}</BodyCell>
                    <BodyCell align="right" strong>{formatMoney(d.totalAmount)}</BodyCell>
                    <td className="px-3 py-3 text-right align-top">
                      <StatusPill value={d.status} />
                    </td>
                    <td className="px-3 py-3 text-right align-top">
                      <OcrPill value={d.ocrStatus} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HeaderCell({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-3 py-2.5 text-[10.5px] font-semibold tracking-wide ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </th>
  );
}

function BodyCell({ children, align = 'left', strong = false }: { children: ReactNode; align?: 'left' | 'right'; strong?: boolean }) {
  return (
    <td
      className={`px-3 py-3 align-top text-[12.5px] tabular-nums ${align === 'right' ? 'text-right' : 'text-left'} ${strong ? 'font-semibold' : ''}`}
      style={{ color: 'var(--text-secondary)' }}
    >
      {children}
    </td>
  );
}

function PipelineStat({ label, value, tone, icon: Icon }: { label: string; value: number; tone: string; icon: LucideIcon }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="p-2 rounded-lg" style={{ background: `${tone}18`, color: tone }}><Icon size={15} /></div>
        <div className="text-[10px] tracking-wider font-semibold" style={{ color: 'var(--text-light)' }}>{label.toUpperCase()}</div>
      </div>
      <div className="text-[28px] font-semibold tabular-nums" style={{ color: tone, fontFamily: 'var(--font-heading)' }}>{value}</div>
    </div>
  );
}

function StatusPill({ value }: { value?: string | null }) {
  const status = String(value || '').toUpperCase();
  if (status === 'APPROVED') return <Pill tone="#10b981">Onaylandı</Pill>;
  if (status === 'PROCESSING') return <Pill tone="#f59e0b">İşleniyor</Pill>;
  if (status === 'NEEDS_REVIEW') return <Pill tone="#ef4444">Kontrol</Pill>;
  if (status === 'READY') return <Pill tone="#10b981">Hazır</Pill>;
  return <Pill tone="#9ca3af">{value || '-'}</Pill>;
}

function OcrPill({ value }: { value?: string | null }) {
  const status = String(value || '').toUpperCase();
  if (status === 'SUCCESS') return <Pill tone="#10b981">Tarandı</Pill>;
  if (status === 'PENDING' || status === 'IN_PROGRESS') return <Pill tone="#f59e0b">Bekliyor</Pill>;
  if (status === 'NEEDS_REVIEW') return <Pill tone="#ef4444">Kontrol</Pill>;
  if (status === 'FAILED' || status === 'ERROR') return <Pill tone="#ef4444">Hata</Pill>;
  return <Pill tone="#9ca3af">{value || '-'}</Pill>;
}

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10.5px] font-semibold"
      style={{ background: `${tone}18`, color: tone }}
    >
      {children}
    </span>
  );
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMoney(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return '-';
  const raw = String(value ?? '').trim();
  const n = typeof value === 'number'
    ? value
    : Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
}

function formatType(d: Doc) {
  const kind = d.invoiceKind || d.direction || '-';
  const type = d.documentType || '-';
  return `${type} · ${kind}`;
}
