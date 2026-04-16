'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { agentsApi } from '@/lib/agents';
import {
  Download, RefreshCw, FileText, Calendar, Users, CheckCircle2, XCircle,
  Loader2, AlertCircle, Receipt, Building2, Search, Trash2,
} from 'lucide-react';

type Taxpayer = {
  id: string;
  type: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  taxNumber: string;
  mihsapId?: string | null;
};

type MihsapInvoice = {
  id: string;
  mukellefId: string;
  donem: string;
  faturaTuru: string;
  belgeTuru: string;
  faturaNo: string;
  firmaUnvan?: string;
  firmaKimlikNo?: string;
  faturaTarihi: string;
  toplamTutar: number;
  storageKey?: string | null;
  downloadedAt?: string | null;
};

const MONTHS = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
];
const MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

export default function FaturalarPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [selectedMukellef, setSelectedMukellef] = useState<string>('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [search, setSearch] = useState('');

  const donem = `${year}-${month}`;

  // Mükellef listesi
  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers-for-faturalar'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });

  // MIHSAP bağlantı durumu
  const { data: mihsapSession } = useQuery({
    queryKey: ['mihsap-session'],
    queryFn: () => agentsApi.mihsapSession(),
    refetchInterval: 10000,
  });

  // Faturalar
  const { data: invoices = [], isLoading: invLoading } = useQuery<MihsapInvoice[]>({
    queryKey: ['mihsap-invoices', selectedMukellef, donem],
    queryFn: () =>
      agentsApi.mihsapInvoices({
        mukellefId: selectedMukellef || undefined,
        donem,
        limit: 500,
      }),
    enabled: !!selectedMukellef,
  });

  // Son çekme job'ları (progress gösterimi için)
  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ['mihsap-jobs'],
    queryFn: () => agentsApi.mihsapJobs(5),
    refetchInterval: 3000,
  });

  // MIHSAP'tan çek mutation
  const fetchMut = useMutation({
    mutationFn: (body: {
      mukellefId: string;
      mukellefMihsapId: string;
      donem: string;
      forceRefresh?: boolean;
    }) => agentsApi.mihsapFetch(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mihsap-invoices'] });
      qc.invalidateQueries({ queryKey: ['mihsap-jobs'] });
    },
  });

  const taxpayerName = (t: Taxpayer) =>
    t.companyName ||
    `${t.firstName || ''} ${t.lastName || ''}`.trim() ||
    t.taxNumber;

  const selectedTaxpayer = taxpayers.find((t) => t.id === selectedMukellef);

  const filteredTaxpayers = useMemo(() => {
    if (!search) return taxpayers;
    const s = search.toLowerCase();
    return taxpayers.filter(
      (t) =>
        taxpayerName(t).toLowerCase().includes(s) || t.taxNumber.includes(s),
    );
  }, [taxpayers, search]);

  const handleFetch = (forceRefresh = false) => {
    if (!selectedTaxpayer) return;
    if (!selectedTaxpayer.mihsapId) {
      alert(
        'Bu mükellef için MIHSAP ID kayıtlı değil. Mükellef düzenleme sayfasından ekleyin.',
      );
      return;
    }
    if (forceRefresh) {
      if (!confirm(`${donem} dönemindeki mevcut tüm kayıtlar silinip yeniden indirilecek. Emin misiniz?`)) return;
    }
    fetchMut.mutate({
      mukellefId: selectedTaxpayer.id,
      mukellefMihsapId: selectedTaxpayer.mihsapId,
      donem,
      forceRefresh,
    });
  };

  const activeJob = jobs.find((j) => j.status === 'running' || j.status === 'pending');

  const alisInvoices = invoices.filter((i) => i.faturaTuru.includes('ALIS'));
  const satisInvoices = invoices.filter((i) => i.faturaTuru.includes('SATIS'));
  const totalAlis = alisInvoices.reduce((s, i) => s + (i.toplamTutar || 0), 0);
  const totalSatis = satisInvoices.reduce((s, i) => s + (i.toplamTutar || 0), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
            <Receipt className="inline mr-2" size={22} />
            Fatura Yönetimi
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            MIHSAP'tan fatura çekme ve arşiv yönetimi
          </p>
        </div>
        <MihsapConnectionBadge session={mihsapSession} />
      </div>

      {/* Mükellef & Dönem seçici */}
      <div
        className="rounded-xl p-4 border"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Mükellef arama + seç */}
          <div className="md:col-span-6">
            <label
              className="text-xs font-semibold block mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              <Users size={12} className="inline mr-1" /> Mükellef
            </label>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }}
              />
              <input
                type="text"
                placeholder="Mükellef ara…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm"
                style={{
                  background: 'var(--bg)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                }}
              />
            </div>
            <select
              value={selectedMukellef}
              onChange={(e) => setSelectedMukellef(e.target.value)}
              className="w-full mt-2 px-3 py-2 rounded-lg border text-sm"
              style={{
                background: 'var(--bg)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            >
              <option value="">-- Mükellef seçin --</option>
              {filteredTaxpayers.map((t) => (
                <option key={t.id} value={t.id}>
                  {taxpayerName(t)} {t.mihsapId ? '' : '(MIHSAP ID yok!)'}
                </option>
              ))}
            </select>
          </div>

          {/* Yıl */}
          <div className="md:col-span-2">
            <label
              className="text-xs font-semibold block mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              <Calendar size={12} className="inline mr-1" /> Yıl
            </label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                background: 'var(--bg)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            >
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Ay */}
          <div className="md:col-span-2">
            <label
              className="text-xs font-semibold block mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Ay
            </label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                background: 'var(--bg)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={m}>
                  {MONTH_NAMES[i]}
                </option>
              ))}
            </select>
          </div>

          {/* Butonlar */}
          <div className="md:col-span-2 flex items-end gap-2">
            <button
              disabled={!selectedMukellef || fetchMut.isPending || !!activeJob}
              onClick={() => handleFetch(false)}
              className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #b8a06f, #8b7649)',
                color: '#0f0d0b',
              }}
              title="Yeni faturaları indirir, mevcutları atlar"
            >
              <Download size={14} />
              {fetchMut.isPending ? 'Çekiliyor…' : "MIHSAP'tan Çek"}
            </button>
            <button
              disabled={!selectedMukellef || fetchMut.isPending || !!activeJob}
              onClick={() => handleFetch(true)}
              className="px-2 py-2 rounded-lg text-sm border disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              title="Dönemi sıfırla ve baştan indir"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Aktif Job progress */}
      {activeJob && (
        <div
          className="rounded-xl p-4 border flex items-center gap-3"
          style={{
            background: 'rgba(59,130,246,.08)',
            borderColor: '#3b82f6',
          }}
        >
          <Loader2 size={18} className="animate-spin" style={{ color: '#3b82f6' }} />
          <div className="flex-1">
            <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Fatura çekiliyor ({activeJob.donem})
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {activeJob.fetchedCount} / {activeJob.totalCount} fatura
            </div>
          </div>
        </div>
      )}

      {/* İstatistikler */}
      {selectedMukellef && invoices.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox
            label="Alış Faturası"
            value={alisInvoices.length}
            sub={`₺${totalAlis.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`}
            color="#3b82f6"
            icon={FileText}
          />
          <StatBox
            label="Satış Faturası"
            value={satisInvoices.length}
            sub={`₺${totalSatis.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`}
            color="#22c55e"
            icon={FileText}
          />
          <StatBox
            label="Toplam"
            value={invoices.length}
            sub={`₺${(totalAlis + totalSatis).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`}
            color="#b8a06f"
            icon={Receipt}
          />
          <StatBox
            label="İndirilmiş Dosya"
            value={invoices.filter((i) => i.storageKey).length}
            sub={`/ ${invoices.length}`}
            color="#8b5cf6"
            icon={Download}
          />
        </div>
      )}

      {/* Fatura listesi */}
      {selectedMukellef && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <div
            className="px-4 py-3 border-b text-sm font-semibold"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            {selectedTaxpayer && taxpayerName(selectedTaxpayer)} · {MONTH_NAMES[Number(month) - 1]} {year}
          </div>
          {invLoading ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Yükleniyor…
            </div>
          ) : invoices.length === 0 ? (
            <div className="p-10 text-center">
              <AlertCircle
                size={32}
                className="mx-auto mb-2"
                style={{ color: 'var(--text-muted)' }}
              />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Bu dönem için kayıtlı fatura yok. "MIHSAP'tan Çek" butonuna basın.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-xs font-semibold"
                    style={{
                      background: 'rgba(0,0,0,.03)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <th className="px-4 py-2">Tür</th>
                    <th className="px-4 py-2">Belge No</th>
                    <th className="px-4 py-2">Karşı Firma</th>
                    <th className="px-4 py-2">Tarih</th>
                    <th className="px-4 py-2 text-right">Tutar</th>
                    <th className="px-4 py-2 text-center">Dosya</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <InvoiceRow key={inv.id} invoice={inv} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MihsapConnectionBadge({ session }: { session: any }) {
  const connected = session?.connected;
  return (
    <div
      className="px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2"
      style={{
        background: connected ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
        color: connected ? '#16a34a' : '#dc2626',
      }}
    >
      {connected ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
      {connected ? 'MIHSAP bağlı' : 'MIHSAP bağlı değil'}
      {connected && session?.email && (
        <span className="opacity-75 font-normal">· {session.email}</span>
      )}
    </div>
  );
}

function StatBox({ label, value, sub, color, icon: Icon }: any) {
  return (
    <div
      className="rounded-xl p-4 border flex items-center gap-3"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}15`, color }}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
          {label}
        </div>
        <div className="text-xl font-bold tabular-nums" style={{ color }}>
          {typeof value === 'number' ? value.toLocaleString('tr-TR') : value}
        </div>
        {sub && (
          <div className="text-xs tabular-nums truncate" style={{ color: 'var(--text-muted)' }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function InvoiceRow({ invoice }: { invoice: MihsapInvoice }) {
  const [loading, setLoading] = useState(false);
  const handleDownload = async () => {
    if (!invoice.storageKey) return;
    try {
      setLoading(true);
      const { url } = await agentsApi.mihsapDownloadUrl(invoice.id);
      if (url) window.open(url, '_blank');
    } finally {
      setLoading(false);
    }
  };
  const isAlis = invoice.faturaTuru.includes('ALIS');
  const date = new Date(invoice.faturaTarihi);
  return (
    <tr
      className="border-t hover:bg-black/[.02]"
      style={{ borderColor: 'var(--border)' }}
    >
      <td className="px-4 py-2">
        <span
          className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold"
          style={{
            background: isAlis ? 'rgba(59,130,246,.1)' : 'rgba(34,197,94,.1)',
            color: isAlis ? '#3b82f6' : '#22c55e',
          }}
        >
          {isAlis ? 'ALIŞ' : 'SATIŞ'}
        </span>
        <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {invoice.belgeTuru}
        </div>
      </td>
      <td className="px-4 py-2 font-mono text-xs">{invoice.faturaNo}</td>
      <td className="px-4 py-2">
        <div className="truncate max-w-[240px]" style={{ color: 'var(--text)' }}>
          {invoice.firmaUnvan || '—'}
        </div>
        {invoice.firmaKimlikNo && (
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {invoice.firmaKimlikNo}
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-xs tabular-nums">
        {date.toLocaleDateString('tr-TR')}
      </td>
      <td className="px-4 py-2 text-right tabular-nums font-semibold">
        ₺{invoice.toplamTutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
      </td>
      <td className="px-4 py-2 text-center">
        {invoice.storageKey ? (
          <button
            onClick={handleDownload}
            disabled={loading}
            className="p-1.5 rounded hover:bg-black/10"
            title="İndir"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} style={{ color: '#3b82f6' }} />
            )}
          </button>
        ) : (
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            —
          </span>
        )}
      </td>
    </tr>
  );
}
