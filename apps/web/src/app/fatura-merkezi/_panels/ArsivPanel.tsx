'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Download,
  RefreshCw,
  Search,
  Send,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { taxpayerName } from '../_lib/taxpayer';

/* ════════════════════════════════════════════════════════════════════
   ARŞİV — Onaylanmış ve Luca'ya gönderilmiş belgelerin geçmişi.
   Yıl bazlı filtre + ay grupları + arama. Geçmişe dönük raporlar için.
   ════════════════════════════════════════════════════════════════════ */

type Doc = {
  id: string;
  taxpayer?: any;
  taxpayerName?: string | null;
  belgeNo?: string | null;
  faturaTarihi?: string | null;
  createdAt?: string | null;
  vendorName?: string | null;
  customerName?: string | null;
  documentType?: string | null;
  invoiceKind?: string | null;
  totalAmount?: string | number | null;
  status?: string | null;
  postedToLucaAt?: string | null;
};

const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function moneyFormat(value: any): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateFormat(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ArsivPanel({ taxpayerId }: { taxpayerId?: string }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [search, setSearch] = useState('');

  const docsQ = useQuery({
    queryKey: ['fatura-merkezi', 'arsiv', taxpayerId, year],
    queryFn: () => api
      .get('/fatura-muhasebelestirme/documents', {
        params: {
          taxpayerId,
          status: 'APPROVED',
          year,
          limit: 2000,
        },
      })
      .then((r) => Array.isArray(r.data) ? r.data : (r.data?.documents || r.data?.data || [])),
  });

  const allDocs: Doc[] = docsQ.data || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allDocs;
    return allDocs.filter((d) => {
      const fields = [
        d.belgeNo,
        d.vendorName,
        d.customerName,
        d.taxpayerName,
        taxpayerName(d.taxpayer),
      ].filter(Boolean).map((s) => String(s).toLowerCase());
      return fields.some((f) => f.includes(q));
    });
  }, [allDocs, search]);

  const grouped = useMemo(() => {
    const buckets = new Map<string, Doc[]>();
    for (const d of filtered) {
      const date = d.faturaTarihi ? new Date(d.faturaTarihi) : (d.createdAt ? new Date(d.createdAt) : null);
      const key = date && !Number.isNaN(date.getTime())
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : 'tarihsiz';
      const list = buckets.get(key) || [];
      list.push(d);
      buckets.set(key, list);
    }
    const entries = Array.from(buckets.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    return entries.map(([key, items]) => ({
      key,
      label: key === 'tarihsiz' ? 'Tarihi olmayan' : `${MONTHS[Number(key.split('-')[1]) - 1]} ${key.split('-')[0]}`,
      items: items.sort((a, b) => {
        const aDate = new Date(a.faturaTarihi || a.createdAt || 0).getTime();
        const bDate = new Date(b.faturaTarihi || b.createdAt || 0).getTime();
        return bDate - aDate;
      }),
    }));
  }, [filtered]);

  const totals = useMemo(() => {
    let totalAmount = 0;
    let sentToLuca = 0;
    let alis = 0;
    let satis = 0;
    for (const d of filtered) {
      const amt = Number(d.totalAmount || 0);
      if (Number.isFinite(amt)) totalAmount += amt;
      if (d.postedToLucaAt) sentToLuca++;
      if (String(d.invoiceKind).toUpperCase() === 'ALIS') alis++;
      else if (String(d.invoiceKind).toUpperCase() === 'SATIS') satis++;
    }
    return { totalAmount, sentToLuca, alis, satis };
  }, [filtered]);

  const yearOptions = useMemo(() => {
    const arr: number[] = [];
    for (let y = currentYear; y >= currentYear - 5; y--) arr.push(y);
    return arr;
  }, [currentYear]);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-end gap-3 mb-5">
        <div>
          <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
            Arşiv
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Onaylanmış belgeler · {filtered.length} kayıt · {year}
          </div>
        </div>

        <div className="flex-1" />

        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px]"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
        >
          <CalendarDays size={14} style={{ color: 'var(--text-muted)' }} />
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="bg-transparent outline-none font-medium"
            style={{ color: 'var(--text)' }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y} style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px]"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', minWidth: 240 }}
        >
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Belge no, satıcı, müşteri..."
            className="flex-1 bg-transparent outline-none text-[13px]"
            style={{ color: 'var(--text)' }}
          />
        </div>

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
        <ArsivStat label="Toplam Belge" value={String(filtered.length)} tone="var(--accent)" icon={Archive} />
        <ArsivStat label="Alış" value={String(totals.alis)} tone="#0ea5e9" icon={Archive} />
        <ArsivStat label="Satış" value={String(totals.satis)} tone="#10b981" icon={Archive} />
        <ArsivStat label="Luca'ya Gönderilen" value={String(totals.sentToLuca)} tone="#22c55e" icon={Send} />
      </div>

      <div className="rounded-xl p-4 mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="text-[12px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
          Toplam Tutar
        </div>
        <div className="text-[24px] font-semibold" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
          {moneyFormat(totals.totalAmount)} TL
        </div>
      </div>

      {docsQ.isLoading && (
        <div className="text-center py-10 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Arşiv yükleniyor...
        </div>
      )}

      {!docsQ.isLoading && grouped.length === 0 && (
        <div className="text-center py-10 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Archive size={36} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <div className="text-[14px] font-semibold mb-1" style={{ color: 'var(--text)' }}>
            {search ? 'Arama sonucu yok' : `${year} için arşivlenmiş belge yok`}
          </div>
          <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
            Onaylanan belgeler buraya düşer.
          </div>
        </div>
      )}

      <div className="space-y-4">
        {grouped.map((group) => (
          <details key={group.key} open className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <summary className="cursor-pointer px-4 py-3 flex items-center gap-3 hover:bg-[var(--surface-2)]">
              <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
              <span className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{group.label}</span>
              <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                {group.items.length} belge
              </span>
            </summary>
            <div className="overflow-x-auto" style={{ borderTop: '1px solid var(--border)' }}>
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Tarih</th>
                    <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Belge No</th>
                    <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Mükellef</th>
                    <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Tip</th>
                    <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Karşı Taraf</th>
                    <th className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Tutar</th>
                    <th className="px-3 py-2 text-center font-semibold" style={{ color: 'var(--text-muted)' }}>Luca</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((d) => {
                    const kind = String(d.invoiceKind || '').toUpperCase();
                    const counterparty = kind === 'ALIS' ? d.vendorName : d.customerName;
                    return (
                      <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-3 py-2" style={{ color: 'var(--text)' }}>{dateFormat(d.faturaTarihi)}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--text)' }}>{d.belgeNo || '—'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--text)' }}>
                          {d.taxpayerName || taxpayerName(d.taxpayer) || '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium"
                            style={{
                              background: kind === 'ALIS' ? 'rgba(14, 165, 233, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                              color: kind === 'ALIS' ? '#0ea5e9' : '#10b981',
                            }}
                          >
                            {kind === 'ALIS' ? 'Alış' : kind === 'SATIS' ? 'Satış' : '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--text)' }}>{counterparty || '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--text)' }}>
                          {moneyFormat(d.totalAmount)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {d.postedToLucaAt ? (
                            <CheckCircle2 size={15} style={{ color: '#22c55e', display: 'inline' }} />
                          ) : (
                            <span className="text-[11px]" style={{ color: 'var(--text-light)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function ArsivStat({ label, value, tone, icon: Icon }: { label: string; value: string; tone: string; icon: LucideIcon }) {
  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div
        className="flex items-center justify-center"
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: `${tone}1a`,
          color: tone,
        }}
      >
        <Icon size={16} />
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {label}
        </div>
        <div className="text-[18px] font-semibold" style={{ color: 'var(--text)' }}>
          {value}
        </div>
      </div>
    </div>
  );
}
