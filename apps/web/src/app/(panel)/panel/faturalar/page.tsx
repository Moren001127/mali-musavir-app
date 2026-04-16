'use client';

import { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { agentsApi } from '@/lib/agents';
import {
  Download, RefreshCw, FileText, Calendar, Users, CheckCircle2, XCircle,
  Loader2, AlertCircle, Receipt, Search,
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
  orjDosyaTuru?: string | null;
  mihsapFileLink?: string | null;
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
  const [tab, setTab] = useState<'all' | 'ALIS' | 'SATIS'>('all');
  const [previewInvoice, setPreviewInvoice] = useState<MihsapInvoice | null>(null);
  // Toplu (tüm mükellefler) çekim durumu
  const [bulkProgress, setBulkProgress] = useState<{
    running: boolean;
    current: number;
    total: number;
    currentName: string;
    errors: string[];
  } | null>(null);

  const ALL_SENTINEL = '__ALL__';

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
        // "__ALL__" seçiliyse mukellef filtresini gönderme → tüm mükelleflerin faturaları
        mukellefId:
          selectedMukellef && selectedMukellef !== ALL_SENTINEL
            ? selectedMukellef
            : undefined,
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
      faturaTuru?: 'ALIS' | 'SATIS';
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

  // Tüm mükellefler için sıralı toplu çekim
  const handleFetchAll = async (
    faturaTuru?: 'ALIS' | 'SATIS',
    forceRefresh = false,
  ) => {
    const eligible = taxpayers.filter((t) => !!t.mihsapId);
    if (eligible.length === 0) {
      alert('MIHSAP ID tanımlı mükellef bulunamadı.');
      return;
    }
    const label =
      faturaTuru === 'ALIS' ? 'alış' : faturaTuru === 'SATIS' ? 'satış' : 'alış + satış';
    const confirmMsg = forceRefresh
      ? `${eligible.length} mükellef için ${donem} dönemindeki ${label} faturaları SİLİNİP yeniden indirilecek. Emin misiniz?`
      : `${eligible.length} mükellef için ${donem} dönemindeki ${label} faturaları çekilecek. Başlansın mı?`;
    if (!confirm(confirmMsg)) return;

    const errors: string[] = [];
    setBulkProgress({ running: true, current: 0, total: eligible.length, currentName: '', errors: [] });
    for (let i = 0; i < eligible.length; i++) {
      const t = eligible[i];
      const name = taxpayerName(t);
      setBulkProgress((prev) => prev && { ...prev, current: i + 1, currentName: name });
      try {
        await agentsApi.mihsapFetch({
          mukellefId: t.id,
          mukellefMihsapId: t.mihsapId!,
          donem,
          faturaTuru,
          forceRefresh,
        });
      } catch (e: any) {
        errors.push(`${name}: ${e?.message || 'bilinmeyen hata'}`);
        setBulkProgress((prev) => prev && { ...prev, errors: [...prev.errors, `${name}: ${e?.message || 'hata'}`] });
      }
      // Peş peşe istek MIHSAP'ı yormasın diye küçük gecikme
      await new Promise((r) => setTimeout(r, 400));
    }
    setBulkProgress((prev) => prev && { ...prev, running: false });
    qc.invalidateQueries({ queryKey: ['mihsap-invoices'] });
    qc.invalidateQueries({ queryKey: ['mihsap-jobs'] });
    if (errors.length > 0) {
      alert(`Toplu çekim bitti · ${errors.length} hata:\n\n${errors.slice(0, 10).join('\n')}`);
    }
  };

  const handleFetch = (faturaTuru?: 'ALIS' | 'SATIS', forceRefresh = false) => {
    // "Tümü" modu → toplu çekime yönlendir
    if (selectedMukellef === ALL_SENTINEL) {
      handleFetchAll(faturaTuru, forceRefresh);
      return;
    }
    if (!selectedTaxpayer) return;
    if (!selectedTaxpayer.mihsapId) {
      alert(
        'Bu mükellef için MIHSAP ID kayıtlı değil. Mükellef düzenleme sayfasından ekleyin.',
      );
      return;
    }
    const label = faturaTuru === 'ALIS' ? 'alış' : faturaTuru === 'SATIS' ? 'satış' : 'tüm';
    if (forceRefresh) {
      if (!confirm(`${donem} dönemindeki ${label} faturaları silinip yeniden indirilecek. Emin misiniz?`)) return;
    }
    fetchMut.mutate({
      mukellefId: selectedTaxpayer.id,
      mukellefMihsapId: selectedTaxpayer.mihsapId,
      donem,
      faturaTuru,
      forceRefresh,
    });
  };

  const activeJob = jobs.find((j) => j.status === 'running' || j.status === 'pending');

  const alisInvoices = invoices.filter((i) => i.faturaTuru.includes('ALIS'));
  const satisInvoices = invoices.filter((i) => i.faturaTuru.includes('SATIS'));
  const totalAlis = alisInvoices.reduce((s, i) => s + (i.toplamTutar || 0), 0);
  const totalSatis = satisInvoices.reduce((s, i) => s + (i.toplamTutar || 0), 0);

  // Tab filtresi
  const filteredInvoices = invoices.filter((i) => {
    if (tab === 'all') return true;
    return i.faturaTuru.includes(tab);
  });

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
              <option value={ALL_SENTINEL}>
                ✓ TÜMÜNÜ SEÇ ({taxpayers.filter((t) => t.mihsapId).length} mükellef)
              </option>
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
          <div className="md:col-span-2 flex flex-col gap-1.5 justify-end">
            <div className="flex gap-1.5">
              <button
                disabled={!selectedMukellef || fetchMut.isPending || !!activeJob || bulkProgress?.running}
                onClick={() => handleFetch('ALIS', false)}
                className="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
                style={{ background: 'rgba(59,130,246,.15)', color: '#2563eb', border: '1px solid rgba(59,130,246,.3)' }}
                title="Alış faturalarını çek"
              >
                <Download size={12} /> Alış Çek
              </button>
              <button
                disabled={!selectedMukellef || fetchMut.isPending || !!activeJob || bulkProgress?.running}
                onClick={() => handleFetch('SATIS', false)}
                className="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
                style={{ background: 'rgba(34,197,94,.15)', color: '#16a34a', border: '1px solid rgba(34,197,94,.3)' }}
                title="Satış faturalarını çek"
              >
                <Download size={12} /> Satış Çek
              </button>
            </div>
            <div className="flex gap-1.5">
              <button
                disabled={!selectedMukellef || fetchMut.isPending || !!activeJob || bulkProgress?.running}
                onClick={() => handleFetch(undefined, false)}
                className="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #b8a06f, #8b7649)', color: '#0f0d0b' }}
                title="Alış + Satış hepsini çek"
              >
                <Download size={12} />
                {bulkProgress?.running
                  ? `${bulkProgress.current}/${bulkProgress.total}…`
                  : fetchMut.isPending
                  ? 'Çekiliyor…'
                  : 'Hepsini Çek'}
              </button>
              <button
                disabled={!selectedMukellef || fetchMut.isPending || !!activeJob || bulkProgress?.running}
                onClick={() => handleFetch(tab === 'all' ? undefined : tab, true)}
                className="px-2 py-1.5 rounded-lg text-xs border disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                title={tab === 'all' ? 'Dönemi sıfırla (tümü)' : `${tab === 'ALIS' ? 'Alış' : 'Satış'} yeniden indir`}
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Toplu (tüm mükellefler) çekim progress */}
      {bulkProgress && (
        <div
          className="rounded-xl p-4 border"
          style={{
            background: bulkProgress.running ? 'rgba(184,160,111,.08)' : 'rgba(34,197,94,.08)',
            borderColor: bulkProgress.running ? '#b8a06f' : '#22c55e',
          }}
        >
          <div className="flex items-center gap-3">
            {bulkProgress.running ? (
              <Loader2 size={18} className="animate-spin" style={{ color: '#b8a06f' }} />
            ) : (
              <CheckCircle2 size={18} style={{ color: '#22c55e' }} />
            )}
            <div className="flex-1">
              <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                Toplu fatura çekimi · {bulkProgress.current} / {bulkProgress.total}
                {!bulkProgress.running && ' · TAMAMLANDI'}
              </div>
              {bulkProgress.running && bulkProgress.currentName && (
                <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  → {bulkProgress.currentName}
                </div>
              )}
              {bulkProgress.errors.length > 0 && (
                <div className="text-xs mt-1" style={{ color: '#ef4444' }}>
                  {bulkProgress.errors.length} hata
                </div>
              )}
            </div>
            {!bulkProgress.running && (
              <button
                onClick={() => setBulkProgress(null)}
                className="text-xs px-2 py-1 rounded"
                style={{ color: 'var(--text-muted)' }}
              >
                Kapat
              </button>
            )}
          </div>
          {/* Progress bar */}
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,.08)' }}>
            <div
              className="h-full transition-all"
              style={{
                width: `${(bulkProgress.current / bulkProgress.total) * 100}%`,
                background: bulkProgress.running
                  ? 'linear-gradient(90deg, #b8a06f, #8b7649)'
                  : '#22c55e',
              }}
            />
          </div>
        </div>
      )}

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
            className="px-4 py-2 border-b flex items-center justify-between flex-wrap gap-2"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              {selectedTaxpayer && taxpayerName(selectedTaxpayer)} · {MONTH_NAMES[Number(month) - 1]} {year}
            </div>
            {/* Tab filtreleri */}
            <div className="flex gap-1">
              {(['all', 'ALIS', 'SATIS'] as const).map((t) => {
                const count = t === 'all' ? invoices.length : invoices.filter(i => i.faturaTuru.includes(t)).length;
                const active = tab === t;
                return (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className="px-3 py-1 rounded-lg text-xs font-semibold transition"
                    style={{
                      background: active ? (t === 'ALIS' ? '#3b82f6' : t === 'SATIS' ? '#22c55e' : '#b8a06f') : 'transparent',
                      color: active ? '#fff' : 'var(--text-muted)',
                      border: active ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    {t === 'all' ? 'Tümü' : t === 'ALIS' ? 'Alış' : 'Satış'} ({count})
                  </button>
                );
              })}
            </div>
          </div>
          {invLoading ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Yükleniyor…
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="p-10 text-center">
              <AlertCircle
                size={32}
                className="mx-auto mb-2"
                style={{ color: 'var(--text-muted)' }}
              />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Bu dönem için {tab === 'all' ? 'kayıtlı fatura' : tab === 'ALIS' ? 'alış faturası' : 'satış faturası'} yok.
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
                    <th className="px-4 py-2 text-center">Görüntüle</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((inv) => (
                    <InvoiceRow key={inv.id} invoice={inv} onPreview={setPreviewInvoice} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Fatura görüntü önizleme modal (lightbox) */}
      {previewInvoice && (
        <InvoicePreviewModal
          invoice={previewInvoice}
          onClose={() => setPreviewInvoice(null)}
        />
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

function InvoiceRow({
  invoice,
  onPreview,
}: {
  invoice: MihsapInvoice;
  onPreview: (inv: MihsapInvoice) => void;
}) {
  const isAlis = invoice.faturaTuru.includes('ALIS');
  const date = new Date(invoice.faturaTarihi);
  // S3'e arşivlenmiş veya MIHSAP'ın CDN linki varsa önizle
  const canPreview = !!invoice.storageKey || !!invoice.mihsapFileLink;
  return (
    <tr
      className="border-t hover:bg-black/[.02] cursor-pointer"
      style={{ borderColor: 'var(--border)' }}
      onClick={() => canPreview && onPreview(invoice)}
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
        {canPreview ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPreview(invoice);
            }}
            className="p-1.5 rounded hover:bg-black/10 inline-flex items-center gap-1 text-xs"
            style={{ color: '#3b82f6' }}
            title="Görüntüle"
          >
            <FileText size={14} /> Aç
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

/** Fatura görüntü önizleme modalı — sayfayı kaplayan lightbox */
function InvoicePreviewModal({
  invoice,
  onClose,
}: {
  invoice: MihsapInvoice;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ESC ile kapat + body scroll kilitle (listenin altından açıldığında
  // modal viewport'a sabitlensin, scroll konumu nerede olursa olsun)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Body scroll'u kilitle — mevcut scroll pozisyonunu koru
    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevWidth = document.body.style.width;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      // Modal kapandıktan sonra scroll pozisyonunu geri yükle
      window.scrollTo(0, scrollY);
    };
  }, [onClose]);

  useEffect(() => {
    // Öncelik 1: MIHSAP CDN URL'i (auth gerektirmez, direkt açılır)
    // Öncelik 2: Backend presigned URL (S3 arşivlenmiş dosyalar için)
    if (invoice.mihsapFileLink) {
      setUrl(invoice.mihsapFileLink);
      setLoading(false);
      return;
    }
    // Fallback: S3 presigned URL (backend'e sor)
    (async () => {
      try {
        setLoading(true);
        const r = await agentsApi.mihsapDownloadUrl(invoice.id);
        if (r?.url) setUrl(r.url);
        else setError(r?.error || 'Dosya bulunamadı');
      } catch (e: any) {
        setError(e?.message || 'Görüntü alınamadı');
      } finally {
        setLoading(false);
      }
    })();
  }, [invoice.id, invoice.mihsapFileLink]);

  const isAlis = invoice.faturaTuru.includes('ALIS');
  const date = new Date(invoice.faturaTarihi);

  // Portal için mount kontrolü (SSR uyumluluğu)
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{
        background: 'rgba(0,0,0,.85)',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
      onClick={onClose}
    >
      <div
        className="relative max-w-[95vw] max-h-[95vh] w-full h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Üst bar */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-t-xl"
          style={{ background: 'rgba(15,13,11,.95)', color: '#fff' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold"
              style={{
                background: isAlis ? 'rgba(59,130,246,.2)' : 'rgba(34,197,94,.2)',
                color: isAlis ? '#60a5fa' : '#4ade80',
              }}
            >
              {isAlis ? 'ALIŞ' : 'SATIŞ'} · {invoice.belgeTuru}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {invoice.firmaUnvan || '—'}
              </div>
              <div className="text-xs opacity-70">
                #{invoice.faturaNo} · {date.toLocaleDateString('tr-TR')} · ₺
                {invoice.toplamTutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {url && (
              <>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                  style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}
                >
                  <FileText size={12} /> Yeni Sekmede Aç
                </a>
                <button
                  onClick={() => {
                    // Cross-origin blob indirme: fetch → blob → download link
                    fetch(url)
                      .then(r => r.blob())
                      .then(blob => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `${invoice.faturaNo || 'fatura'}.jpg`;
                        document.body.appendChild(a);
                        a.click();
                        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
                      })
                      .catch(() => window.open(url, '_blank'));
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                  style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}
                >
                  <Download size={12} /> İndir
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}
              title="Kapat (ESC)"
            >
              <XCircle size={18} />
            </button>
          </div>
        </div>
        {/* İçerik */}
        <div
          className="flex-1 rounded-b-xl overflow-auto flex items-center justify-center"
          style={{ background: 'rgba(15,13,11,.85)' }}
        >
          {loading && (
            <Loader2 size={32} className="animate-spin" style={{ color: '#fff' }} />
          )}
          {error && (
            <div className="text-center p-8" style={{ color: '#fca5a5' }}>
              <AlertCircle size={32} className="mx-auto mb-2" />
              <p className="text-sm">{error}</p>
            </div>
          )}
          {url && !loading && !error && (() => {
            // Presigned URL query string içerebilir; uzantıyı gerçek path'ten al.
            // MIHSAP her faturayı (XML e-fatura dahil) JPEG'e render ettiği için
            // çoğu durumda dosya tipi "jpg" olur.
            const cleanPath = url.split('?')[0].toLowerCase();
            const urlExt = cleanPath.split('.').pop() || '';
            if (urlExt === 'pdf') {
              return (
                <iframe
                  src={url}
                  className="w-full h-full bg-white"
                  title={invoice.faturaNo}
                />
              );
            }
            if (urlExt === 'xml') {
              return (
                <iframe
                  src={url}
                  className="w-full h-full bg-white"
                  title={invoice.faturaNo}
                />
              );
            }
            // Default: JPEG/PNG
            return (
              <img
                src={url}
                alt={invoice.faturaNo}
                className="max-w-full max-h-full object-contain"
                onError={() => setError('Görüntü yüklenemedi (dosya bozuk olabilir — yeniden çekin)')}
              />
            );
          })()}
        </div>
      </div>
    </div>
  );

  // Modal'ı document.body'ye render et — parent transform'lar fixed positioning'i
  // bozmasın ve scroll pozisyonundan bağımsız olarak viewport'ta göründüğü gibi açılsın.
  return createPortal(modalContent, document.body);
}
