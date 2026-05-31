'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowUpDown,
  Banknote,
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  Eye,
  FileSpreadsheet,
  FilterX,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Send,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ButcePlanView, GelirGiderTablosuView, KasaBankaView } from './ButceTakipView';

const GOLD = '#d4b876';
const TEXT = '#f8fafc';
const MUTED = '#cbd5e1';
const SOFT = '#94a3b8';
const DANGER = '#c35a72';
const SUCCESS = '#4ade80';
const BLUE = '#60a5fa';
const PANEL = 'rgba(12, 14, 17, 0.94)';
const PANEL_2 = 'rgba(18, 21, 25, 0.92)';
const LINE = 'rgba(255,255,255,0.11)';
const SANS = 'Manrope, Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MONEY = SANS;

type OzetSatir = {
  id: string;
  ad: string;
  taxNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  aylikMuhasebeUcreti: number;
  tahakkuk: number;
  tahsilat: number;
  bakiye: number;
};

type TahsilatAjandaRow = {
  id: string;
  ad: string;
  taxNumber?: string | null;
  phone?: string | null;
  bakiye: number;
  maxBucket: string;
  aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number };
  sonTahsilatTarihi?: string | null;
  sonHatirlatmaTarihi?: string | null;
  telefonVar: boolean;
  whatsappUygun: boolean;
};

type TahsilatAjandasi = {
  toplamBakiye: number;
  totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number };
  rows: TahsilatAjandaRow[];
};

type WorkspaceRow = OzetSatir & {
  aging: TahsilatAjandaRow['aging'];
  maxBucket: string;
  sonTahsilatTarihi?: string | null;
  sonHatirlatmaTarihi?: string | null;
  telefonVar: boolean;
  whatsappUygun: boolean;
};

type FinancialAccount = { id: string; name: string; type: string; color: string; isActive: boolean };
type FilterKey = 'debt' | 'over90' | 'over30' | 'whatsapp' | 'noPhone' | 'clean' | 'all';
type SortKey = 'risk' | 'balance' | 'name' | 'lastPayment';

const emptyAging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };

const fmt = (n: number | null | undefined) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const normalize = (value: string) =>
  value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

function bucketRank(bucket: string) {
  if (bucket === '90+') return 5;
  if (bucket === '61-90') return 4;
  if (bucket === '31-60') return 3;
  if (bucket === '1-30') return 2;
  if (bucket === 'Güncel' || bucket === 'Guncel') return 1;
  return 0;
}

function bucketStyle(bucket: string) {
  if (bucket === '90+') return { color: '#fecdd3', bg: 'rgba(239,68,68,0.16)', border: 'rgba(239,68,68,0.34)' };
  if (bucket === '61-90') return { color: '#fda4af', bg: 'rgba(244,63,94,0.13)', border: 'rgba(244,63,94,0.28)' };
  if (bucket === '31-60') return { color: '#fde68a', bg: 'rgba(245,158,11,0.13)', border: 'rgba(245,158,11,0.30)' };
  if (bucket === '1-30') return { color: '#bfdbfe', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.27)' };
  if (bucket === 'Güncel' || bucket === 'Guncel') return { color: '#bbf7d0', bg: 'rgba(34,197,94,0.11)', border: 'rgba(34,197,94,0.24)' };
  return { color: SOFT, bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.12)' };
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('tr-TR');
}

export function CariTahsilatWorkspace({ onSelect }: { onSelect: (id: string) => void }) {
  const qc = useQueryClient();
  const [view, setView] = useState<'tahsilat' | 'kasa' | 'gelirGider' | 'butcePlan'>('tahsilat');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('debt');
  const [sortKey, setSortKey] = useState<SortKey>('risk');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<any | null>(null);
  const [sending, setSending] = useState(false);
  const [quickTahsilat, setQuickTahsilat] = useState<WorkspaceRow | null>(null);
  const yil = new Date().getFullYear();
  const [baslangic, setBaslangic] = useState(`${yil}-01-01`);
  const [bitis, setBitis] = useState(today());
  const [dateMode, setDateMode] = useState<'all' | 'period'>('all');

  const { data: ozet = [], isLoading, isFetching } = useQuery<OzetSatir[]>({
    queryKey: ['cari-ozet', dateMode === 'period' ? baslangic : '', dateMode === 'period' ? bitis : ''],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (dateMode === 'period') {
        params.baslangic = baslangic;
        params.bitis = bitis;
      }
      return api.get('/cari-kasa/ozet', { params }).then((r) => r.data);
    },
    refetchInterval: 30000,
  });

  const { data: ajanda, isLoading: ajandaLoading } = useQuery<TahsilatAjandasi>({
    queryKey: ['cari-tahsilat-ajandasi'],
    queryFn: () => api.get('/cari-kasa/tahsilat-ajandasi').then((r) => r.data),
    refetchInterval: 30000,
  });

  const rows = useMemo<WorkspaceRow[]>(() => {
    const ajandaById = new Map((ajanda?.rows || []).map((row) => [row.id, row]));
    return ozet.map((row) => {
      const agenda = ajandaById.get(row.id);
      const rowBakiye = Number(row.bakiye);
      const bakiye = Number.isFinite(rowBakiye) ? rowBakiye : Number(agenda?.bakiye || 0);
      return {
        ...row,
        phone: agenda?.phone || row.phone || null,
        bakiye,
        aging: agenda?.aging || emptyAging,
        maxBucket: agenda?.maxBucket || (bakiye > 0 ? 'Güncel' : 'Yok'),
        sonTahsilatTarihi: agenda?.sonTahsilatTarihi || null,
        sonHatirlatmaTarihi: agenda?.sonHatirlatmaTarihi || null,
        telefonVar: Boolean(agenda?.telefonVar || row.phone),
        whatsappUygun: Boolean(agenda?.whatsappUygun),
      };
    });
  }, [ajanda?.rows, ozet]);

  const stats = useMemo(() => {
    const result = rows.reduce(
      (acc, row) => {
        const positive = Math.max(Number(row.bakiye || 0), 0);
        acc.tahakkuk += Number(row.tahakkuk || 0);
        acc.tahsilat += Number(row.tahsilat || 0);
        acc.bakiye += positive;
        acc.monthlyTarget += Number(row.aylikMuhasebeUcreti || 0);
        if (positive > 0.004) acc.borclu += 1;
        if (row.whatsappUygun && positive > 0.004) acc.whatsapp += 1;
        if (positive > 0.004 && !row.telefonVar) acc.noPhone += 1;
        if (row.maxBucket === '90+' && positive > 0.004) acc.over90 += 1;
        if (bucketRank(row.maxBucket) >= 3 && positive > 0.004) acc.over30 += 1;
        return acc;
      },
      { tahakkuk: 0, tahsilat: 0, bakiye: 0, monthlyTarget: 0, borclu: 0, whatsapp: 0, noPhone: 0, over90: 0, over30: 0 },
    );
    return {
      ...result,
      tahsilatOrani: result.tahakkuk > 0 ? (result.tahsilat / result.tahakkuk) * 100 : 0,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const needle = normalize(search.trim());
    const filtered = rows.filter((row) => {
      const debt = row.bakiye > 0.004;
      if (filter === 'debt' && !debt) return false;
      if (filter === 'over30' && !(debt && bucketRank(row.maxBucket) >= 3)) return false;
      if (filter === 'over90' && !(debt && row.maxBucket === '90+')) return false;
      if (filter === 'whatsapp' && !(debt && row.whatsappUygun)) return false;
      if (filter === 'noPhone' && !(debt && !row.telefonVar)) return false;
      if (filter === 'clean' && Math.abs(row.bakiye) > 0.004) return false;
      if (!needle) return true;
      return normalize([row.ad, row.taxNumber || '', row.phone || '', row.email || ''].join(' ')).includes(needle);
    });
    return filtered.sort((a, b) => {
      if (sortKey === 'name') return a.ad.localeCompare(b.ad, 'tr');
      if (sortKey === 'balance') return b.bakiye - a.bakiye;
      if (sortKey === 'lastPayment') {
        const av = a.sonTahsilatTarihi ? new Date(a.sonTahsilatTarihi).getTime() : 0;
        const bv = b.sonTahsilatTarihi ? new Date(b.sonTahsilatTarihi).getTime() : 0;
        return av - bv;
      }
      const rankDiff = bucketRank(b.maxBucket) - bucketRank(a.maxBucket);
      return rankDiff || b.bakiye - a.bakiye || a.ad.localeCompare(b.ad, 'tr');
    });
  }, [filter, rows, search, sortKey]);

  const targetIds = selectedIds.length
    ? selectedIds
    : filteredRows.filter((row) => row.whatsappUygun && row.bakiye > 0).map((row) => row.id);

  const targetTotal = rows
    .filter((row) => targetIds.includes(row.id))
    .reduce((sum, row) => sum + Math.max(row.bakiye, 0), 0);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['cari-ozet'] });
    qc.invalidateQueries({ queryKey: ['cari-tahsilat-ajandasi'] });
    qc.invalidateQueries({ queryKey: ['cari-cashflow-summary'] });
    qc.invalidateQueries({ queryKey: ['cari-budget-summary'] });
  };

  const toggleSelected = (id: string) => {
    setPreview(null);
    setSelectedIds((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  };

  const selectVisible = () => {
    setPreview(null);
    setSelectedIds(filteredRows.filter((row) => row.whatsappUygun && row.bakiye > 0).map((row) => row.id));
  };

  const clearFilters = () => {
    setSearch('');
    setFilter('debt');
    setSortKey('risk');
    setSelectedIds([]);
    setPreview(null);
  };

  const previewReminder = async () => {
    if (!targetIds.length) {
      toast.warning('WhatsApp gönderilecek uygun kayıt yok');
      return;
    }
    try {
      const resp = await api.post('/cari-kasa/tahsilat-hatirlatma/preview', { taxpayerIds: targetIds });
      setPreview(resp.data);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Önizleme alınamadı');
    }
  };

  const sendReminder = async () => {
    if (!targetIds.length) {
      toast.warning('WhatsApp gönderilecek uygun kayıt yok');
      return;
    }
    if (!confirm(`${targetIds.length} mükellefe tahsilat WhatsApp mesajı gönderilsin mi?`)) return;
    setSending(true);
    try {
      const resp = await api.post('/cari-kasa/tahsilat-hatirlatma/send', { taxpayerIds: targetIds });
      setPreview(resp.data);
      toast.success(`${resp.data.basarili || 0} WhatsApp gönderildi`);
      refreshAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'WhatsApp gönderilemedi');
    } finally {
      setSending(false);
    }
  };

  const indirExcelToplu = async () => {
    try {
      const params: Record<string, string> = {};
      if (dateMode === 'period') {
        params.baslangic = baslangic;
        params.bitis = bitis;
      }
      const resp = await api.get('/cari-kasa/ozet/xlsx', { params, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Cari_Kasa_Ozet_${today()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Excel indirilemedi');
    }
  };

  const tabs = [
    { key: 'tahsilat', label: 'Tahsilat', icon: Wallet },
    { key: 'kasa', label: 'Kasa/Banka', icon: Banknote },
    { key: 'gelirGider', label: 'Gelir-Gider', icon: TrendingUp },
    { key: 'butcePlan', label: 'Bütçe', icon: CircleDollarSign },
  ] as const;

  return (
    <div className="p-4 lg:p-5 max-w-none space-y-3" style={{ fontFamily: SANS }}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[.16em]" style={{ color: GOLD }}>
            Cari Kasa
          </div>
          <h1 className="mt-1 text-[24px] lg:text-[28px] font-semibold leading-tight" style={{ color: TEXT, letterSpacing: 0 }}>
            Tahsilat Merkezi
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map(({ key, label, icon: Icon }) => {
            const active = view === key;
            return (
              <button
                key={key}
                onClick={() => setView(key)}
                className="h-9 px-3 rounded-[8px] text-[12.5px] font-bold inline-flex items-center gap-2"
                style={{
                  background: active ? 'rgba(212,184,118,0.16)' : 'rgba(255,255,255,0.045)',
                  color: active ? '#f5d992' : MUTED,
                  border: `1px solid ${active ? 'rgba(212,184,118,0.42)' : LINE}`,
                }}
              >
                <Icon size={15} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {view === 'kasa' && <KasaBankaView />}
      {view === 'gelirGider' && <GelirGiderTablosuView />}
      {view === 'butcePlan' && <ButcePlanView />}

      {view === 'tahsilat' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-2">
            <MetricButton label="Toplam Bakiye" value={`${fmt(stats.bakiye)} TL`} icon={Wallet} color={DANGER} active={filter === 'debt'} onClick={() => setFilter('debt')} />
            <MetricButton label="Tahsilat Oranı" value={`%${stats.tahsilatOrani.toFixed(1)}`} icon={TrendingDown} color={stats.tahsilatOrani >= 80 ? SUCCESS : '#fbbf24'} />
            <MetricButton label="Aylık Hedef" value={`${fmt(stats.monthlyTarget)} TL`} icon={Receipt} color={GOLD} />
            <MetricButton label="90+ Risk" value={String(stats.over90)} icon={AlertTriangle} color="#f87171" active={filter === 'over90'} onClick={() => setFilter('over90')} />
            <MetricButton label="WhatsApp" value={String(stats.whatsapp)} icon={MessageCircle} color={SUCCESS} active={filter === 'whatsapp'} onClick={() => setFilter('whatsapp')} />
            <MetricButton label="Telefonsuz" value={String(stats.noPhone)} icon={Phone} color={BLUE} active={filter === 'noPhone'} onClick={() => setFilter('noPhone')} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3">
            <section className="rounded-[8px] border overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
              <div className="px-3 py-3 flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between" style={{ borderBottom: `1px solid ${LINE}` }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[.12em]" style={{ color: SOFT }}>
                    <ArrowUpDown size={14} />
                    Çalışma Kuyruğu
                    {isFetching && <Loader2 size={13} className="animate-spin" style={{ color: GOLD }} />}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[12.5px] font-semibold" style={{ color: MUTED }}>
                    <span>{filteredRows.length} kayıt</span>
                    <span style={{ color: 'rgba(255,255,255,0.28)' }}>•</span>
                    <span>hedef {targetIds.length}</span>
                    <span style={{ color: 'rgba(255,255,255,0.28)' }}>•</span>
                    <span style={{ color: targetTotal > 0 ? '#f5d992' : MUTED }}>{fmt(targetTotal)} TL</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <IconButton title="Yenile" onClick={refreshAll} icon={RefreshCw} />
                  <ActionButton label="Excel" icon={FileSpreadsheet} onClick={indirExcelToplu} tone="blue" />
                  <ActionButton label="Önizle" icon={Eye} onClick={previewReminder} tone="amber" />
                  <ActionButton label="Gönder" icon={sending ? Loader2 : Send} onClick={sendReminder} tone="green" disabled={sending} spin={sending} />
                </div>
              </div>

              <div className="px-3 py-2.5 grid grid-cols-1 2xl:grid-cols-[minmax(280px,1fr)_auto_auto] gap-2.5" style={{ borderBottom: `1px solid ${LINE}` }}>
                <div className="relative">
                  <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: SOFT }} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Mükellef, VKN, telefon veya e-posta ara"
                    aria-label="Cari kayıt ara"
                    className="w-full h-10 pl-10 pr-3 rounded-[8px] text-[13px] font-semibold outline-none"
                    style={inputStyle}
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <FilterButton label="Borçlu" count={stats.borclu} active={filter === 'debt'} onClick={() => setFilter('debt')} />
                  <FilterButton label="30+" count={stats.over30} active={filter === 'over30'} onClick={() => setFilter('over30')} />
                  <FilterButton label="90+" count={stats.over90} active={filter === 'over90'} onClick={() => setFilter('over90')} />
                  <FilterButton label="WhatsApp" count={stats.whatsapp} active={filter === 'whatsapp'} onClick={() => setFilter('whatsapp')} />
                  <FilterButton label="Telefonsuz" count={stats.noPhone} active={filter === 'noPhone'} onClick={() => setFilter('noPhone')} />
                  <FilterButton label="Sıfır" count={rows.length - stats.borclu} active={filter === 'clean'} onClick={() => setFilter('clean')} />
                  <FilterButton label="Tümü" count={rows.length} active={filter === 'all'} onClick={() => setFilter('all')} />
                </div>

                <div className="flex gap-2">
                  <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sıralama" className="h-10 rounded-[8px] px-3 text-[12.5px] font-bold outline-none" style={inputStyle}>
                    <option value="risk">Risk sırası</option>
                    <option value="balance">Bakiye yüksek</option>
                    <option value="name">Ada göre</option>
                    <option value="lastPayment">Son tahsilat eski</option>
                  </select>
                  <IconButton title="Filtreleri temizle" onClick={clearFilters} icon={FilterX} />
                </div>
              </div>

              <div className="px-3 py-2.5 flex flex-wrap items-center gap-2" style={{ borderBottom: `1px solid ${LINE}` }}>
                <ActionButton label="Görünen uygunları seç" icon={CheckSquare} onClick={selectVisible} />
                <button onClick={() => { setSelectedIds([]); setPreview(null); }} className="h-9 px-3 rounded-[8px] text-[12.5px] font-bold" style={ghostButtonStyle}>
                  Seçimi temizle
                </button>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <button onClick={() => setDateMode(dateMode === 'all' ? 'period' : 'all')} className="h-9 px-3 rounded-[8px] text-[12.5px] font-bold inline-flex items-center gap-2" style={dateMode === 'period' ? amberButtonStyle : ghostButtonStyle}>
                    <CalendarDays size={15} />
                    {dateMode === 'period' ? 'Tarih filtresi açık' : 'Tüm zamanlar'}
                  </button>
                  {dateMode === 'period' && (
                    <>
                      <input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} aria-label="Başlangıç tarihi" className="h-9 px-3 rounded-[8px] text-[12.5px] font-bold outline-none" style={inputStyle} />
                      <input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} aria-label="Bitiş tarihi" className="h-9 px-3 rounded-[8px] text-[12.5px] font-bold outline-none" style={inputStyle} />
                    </>
                  )}
                </div>
              </div>

              {preview && (
                <div className="mx-3 mt-3 rounded-[8px] px-3 py-2.5 text-[12.5px] font-semibold" style={{ background: 'rgba(56,189,248,0.09)', border: '1px solid rgba(56,189,248,0.24)', color: '#bae6fd' }}>
                  WhatsApp önizleme: {preview.gonderilecek || 0} gönderilecek, {preview.atlanacak || 0} atlanacak.
                  {!preview.whatsapp?.ready && <span style={{ color: '#fde68a' }}> WhatsApp ayarı: {preview.whatsapp?.error}</span>}
                </div>
              )}

              <TahsilatTable
                rows={filteredRows}
                selectedIds={selectedIds}
                isLoading={isLoading || ajandaLoading}
                onToggle={toggleSelected}
                onOpen={onSelect}
                onQuickTahsilat={setQuickTahsilat}
              />
            </section>

            <aside className="space-y-3">
              <NextActionPanel rows={filteredRows} onOpen={onSelect} onQuickTahsilat={setQuickTahsilat} />
              <AgingPanel totals={ajanda?.totals} />
            </aside>
          </div>
        </>
      )}

      {quickTahsilat && (
        <QuickTahsilatModal
          row={quickTahsilat}
          onClose={() => setQuickTahsilat(null)}
          onSaved={() => {
            setQuickTahsilat(null);
            setSelectedIds((ids) => ids.filter((id) => id !== quickTahsilat.id));
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

function MetricButton({
  label,
  value,
  icon: Icon,
  color,
  active,
  onClick,
}: {
  label: string;
  value: string;
  icon: any;
  color: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const Component = onClick ? 'button' : 'div';
  return (
    <Component
      onClick={onClick as any}
      className="rounded-[8px] border p-3 min-h-[88px] text-left"
      style={{
        background: active ? 'rgba(212,184,118,0.10)' : PANEL_2,
        borderColor: active ? 'rgba(212,184,118,0.40)' : LINE,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10.5px] font-bold uppercase tracking-[.12em] truncate" style={{ color: SOFT }}>{label}</div>
        <Icon size={16} style={{ color }} />
      </div>
      <div className="mt-3 text-[18px] lg:text-[20px] font-bold tabular-nums leading-tight" style={{ color, fontFamily: MONEY }}>
        {value}
      </div>
    </Component>
  );
}

function FilterButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-10 px-3 rounded-[8px] text-[12.5px] font-bold inline-flex items-center gap-2"
      style={{
        background: active ? 'rgba(212,184,118,0.18)' : 'rgba(255,255,255,0.04)',
        color: active ? '#f5d992' : MUTED,
        border: `1px solid ${active ? 'rgba(212,184,118,0.42)' : LINE}`,
      }}
    >
      <span>{label}</span>
      <span className="tabular-nums text-[11px]" style={{ color: active ? '#fff0bd' : SOFT }}>{count}</span>
    </button>
  );
}

function ActionButton({
  label,
  icon: Icon,
  onClick,
  tone,
  disabled,
  spin,
}: {
  label: string;
  icon: any;
  onClick: () => void;
  tone?: 'green' | 'amber' | 'blue';
  disabled?: boolean;
  spin?: boolean;
}) {
  const style = tone === 'green' ? greenButtonStyle : tone === 'amber' ? amberButtonStyle : tone === 'blue' ? blueButtonStyle : ghostButtonStyle;
  return (
    <button onClick={onClick} disabled={disabled} className="h-9 px-3 rounded-[8px] text-[12.5px] font-bold inline-flex items-center gap-2 disabled:opacity-50" style={style}>
      <Icon size={15} className={spin ? 'animate-spin' : ''} />
      {label}
    </button>
  );
}

function IconButton({ title, icon: Icon, onClick }: { title: string; icon: any; onClick: () => void }) {
  return (
    <button onClick={onClick} className="h-10 w-10 rounded-[8px] inline-flex items-center justify-center" style={ghostButtonStyle} title={title} aria-label={title}>
      <Icon size={16} />
    </button>
  );
}

function TahsilatTable({
  rows,
  selectedIds,
  isLoading,
  onToggle,
  onOpen,
  onQuickTahsilat,
}: {
  rows: WorkspaceRow[];
  selectedIds: string[];
  isLoading: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onQuickTahsilat: (row: WorkspaceRow) => void;
}) {
  if (isLoading) {
    return (
      <div className="py-12 text-center text-[14px] font-semibold" style={{ color: MUTED }}>
        <Loader2 className="animate-spin inline mr-2" size={17} /> Cari kayıtlar yükleniyor
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="py-14 text-center text-[14px] font-semibold" style={{ color: MUTED }}>
        Filtreye uygun cari kayıt bulunamadı.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-[12.5px]">
        <colgroup>
          <col style={{ width: 44 }} />
          <col style={{ width: '34%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: 96 }} />
        </colgroup>
        <thead>
          <tr style={{ color: SOFT, background: 'rgba(255,255,255,0.035)', borderBottom: `1px solid ${LINE}` }}>
            <th className="px-2 py-2.5 text-left"></th>
            <th className="px-2 py-2.5 text-left font-bold">Mükellef</th>
            <th className="px-2 py-2.5 text-right font-bold">Toplam Bakiye</th>
            <th className="px-2 py-2.5 text-right font-bold">Aylık Ücret</th>
            <th className="px-2 py-2.5 text-left font-bold">Vade</th>
            <th className="px-2 py-2.5 text-left font-bold">Son durum</th>
            <th className="px-2 py-2.5 text-center font-bold"></th>
          </tr>
        </thead>
        <tbody style={{ color: TEXT }}>
          {rows.map((row) => {
            const style = bucketStyle(row.maxBucket);
            const lastPayment = formatDate(row.sonTahsilatTarihi);
            const lastReminder = formatDate(row.sonHatirlatmaTarihi);
            return (
              <tr key={row.id} className="group" style={{ borderTop: '1px solid rgba(255,255,255,0.065)' }}>
                <td className="px-2 py-2.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id)}
                    disabled={!row.whatsappUygun}
                    onChange={() => onToggle(row.id)}
                    aria-label={`${row.ad} WhatsApp hedefi`}
                    title={row.whatsappUygun ? 'WhatsApp hedefi' : 'Telefon yok'}
                  />
                </td>
                <td className="px-2 py-2.5 min-w-0">
                  <button onClick={() => onOpen(row.id)} className="block w-full text-left min-w-0">
                    <div className="font-bold truncate" style={{ color: TEXT }}>{row.ad}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11.5px] font-semibold min-w-0" style={{ color: SOFT }}>
                      <span className="tabular-nums shrink-0">{row.taxNumber || '-'}</span>
                      <span className="shrink-0" style={{ color: 'rgba(255,255,255,0.18)' }}>|</span>
                      <span className="inline-flex items-center gap-1 truncate min-w-0">
                        <Phone size={12} /> {row.phone || 'telefon yok'}
                      </span>
                    </div>
                  </button>
                </td>
                <td className="px-2 py-2.5 text-right">
                  <div className="text-[14px] font-bold tabular-nums whitespace-nowrap" style={{ color: row.bakiye > 0 ? DANGER : row.bakiye < 0 ? SUCCESS : SOFT, fontFamily: MONEY }}>
                    {fmt(row.bakiye)} TL
                  </div>
                </td>
                <td className="px-2 py-2.5 text-right">
                  <div className="text-[14px] font-bold tabular-nums whitespace-nowrap" style={{ color: row.aylikMuhasebeUcreti > 0 ? GOLD : SOFT, fontFamily: MONEY }}>
                    {row.aylikMuhasebeUcreti > 0 ? `${fmt(row.aylikMuhasebeUcreti)} TL` : '-'}
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <div className="inline-flex items-center rounded-[7px] px-2 py-1 text-[11px] font-bold whitespace-nowrap" style={{ color: style.color, background: style.bg, border: `1px solid ${style.border}` }}>
                    {row.maxBucket}
                  </div>
                  {row.bakiye > 0 && <AgingStack aging={row.aging} />}
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex flex-col gap-1 text-[11.5px] font-bold leading-none">
                    <span className="inline-flex w-fit max-w-full rounded-[6px] px-2 py-1 truncate" style={{ color: MUTED, background: 'rgba(255,255,255,0.045)', border: `1px solid ${LINE}` }}>
                      {lastPayment ? `Tahsilat ${lastPayment}` : 'Tahsilat yok'}
                    </span>
                    <span className="inline-flex w-fit max-w-full rounded-[6px] px-2 py-1 truncate" style={{ color: row.whatsappUygun ? '#86efac' : SOFT, background: row.whatsappUygun ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.035)', border: `1px solid ${row.whatsappUygun ? 'rgba(34,197,94,0.20)' : LINE}` }}>
                      {lastReminder ? `Hatırlatma ${lastReminder}` : row.whatsappUygun ? 'Hatırlatma hazır' : 'WhatsApp yok'}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => onQuickTahsilat(row)}
                      disabled={row.bakiye <= 0}
                      aria-label={`${row.ad} tahsilat gir`}
                      title="Tahsilat gir"
                      className="h-9 w-9 rounded-[8px] inline-flex items-center justify-center disabled:opacity-35"
                      style={greenButtonStyle}
                    >
                      <Plus size={15} />
                    </button>
                    <button onClick={() => onOpen(row.id)} aria-label={`${row.ad} detay`} className="h-9 w-9 rounded-[8px] inline-flex items-center justify-center" style={ghostButtonStyle} title="Detay">
                      <Receipt size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AgingStack({ aging }: { aging: TahsilatAjandaRow['aging'] }) {
  const parts = [
    { key: 'current', value: aging.current, color: '#22c55e' },
    { key: 'd1_30', value: aging.d1_30, color: '#3b82f6' },
    { key: 'd31_60', value: aging.d31_60, color: '#f59e0b' },
    { key: 'd61_90', value: aging.d61_90, color: '#f43f5e' },
    { key: 'd90plus', value: aging.d90plus, color: '#ef4444' },
  ];
  const total = parts.reduce((sum, item) => sum + Number(item.value || 0), 0);
  return (
    <div className="mt-2 h-2 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.08)' }}>
      {total <= 0 ? (
        <div style={{ width: '100%', background: 'rgba(255,255,255,0.10)' }} />
      ) : (
        parts.map((part) => (
          <div key={part.key} style={{ width: `${Math.max(2, (part.value / total) * 100)}%`, background: part.color }} />
        ))
      )}
    </div>
  );
}

function NextActionPanel({ rows, onOpen, onQuickTahsilat }: { rows: WorkspaceRow[]; onOpen: (id: string) => void; onQuickTahsilat: (row: WorkspaceRow) => void }) {
  const riskRows = rows.filter((row) => row.bakiye > 0).slice(0, 7);
  return (
    <section className="rounded-[8px] border overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
      <div className="px-3 py-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[.12em]" style={{ color: SOFT }}>
          <AlertTriangle size={14} /> Bugünün Sırası
        </div>
      </div>
      <div className="p-2.5 space-y-2">
        {riskRows.length === 0 ? (
          <div className="py-8 text-center text-[13px] font-semibold" style={{ color: MUTED }}>
            Açık takip kaydı yok.
          </div>
        ) : (
          riskRows.map((row) => {
            const style = bucketStyle(row.maxBucket);
            return (
              <div key={row.id} className="rounded-[8px] p-3" style={{ background: 'rgba(255,255,255,0.045)', border: `1px solid ${LINE}` }}>
                <button onClick={() => onOpen(row.id)} className="block w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold" style={{ color: TEXT }}>{row.ad}</div>
                      <div className="mt-1 text-[11.5px] font-semibold" style={{ color: row.phone ? SOFT : '#fda4af' }}>{row.phone || 'telefon yok'}</div>
                    </div>
                    <span className="shrink-0 rounded-[7px] px-2 py-1 text-[11px] font-bold" style={{ color: style.color, background: style.bg, border: `1px solid ${style.border}` }}>
                      {row.maxBucket}
                    </span>
                  </div>
                  <div className="mt-3 text-[15px] font-bold tabular-nums" style={{ color: DANGER, fontFamily: MONEY }}>
                    {fmt(row.bakiye)} TL
                  </div>
                </button>
                <button onClick={() => onQuickTahsilat(row)} className="mt-3 h-9 w-full rounded-[8px] text-[12px] font-bold inline-flex items-center justify-center gap-2" style={greenButtonStyle}>
                  <Plus size={14} /> Tahsilat gir
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function AgingPanel({ totals }: { totals?: TahsilatAjandasi['totals'] }) {
  const items = [
    ['Güncel', totals?.current || 0, '#22c55e'],
    ['1-30', totals?.d1_30 || 0, '#3b82f6'],
    ['31-60', totals?.d31_60 || 0, '#f59e0b'],
    ['61-90', totals?.d61_90 || 0, '#f43f5e'],
    ['90+', totals?.d90plus || 0, '#ef4444'],
  ] as const;
  const total = items.reduce((sum, [, value]) => sum + value, 0);

  return (
    <section className="rounded-[8px] border p-3" style={{ background: PANEL, borderColor: LINE }}>
      <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[.12em]" style={{ color: SOFT }}>
        <ArrowUpDown size={14} /> Yaşlandırma
      </div>
      <div className="mt-4 space-y-3">
        {items.map(([label, value, color]) => {
          const pct = total > 0 ? (value / total) * 100 : 0;
          return (
            <div key={label}>
              <div className="flex items-center justify-between text-[12px] font-bold">
                <span style={{ color: MUTED }}>{label}</span>
                <span className="tabular-nums" style={{ color, fontFamily: MONEY }}>{fmt(value)} TL</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function QuickTahsilatModal({ row, onClose, onSaved }: { row: WorkspaceRow; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    tarih: today(),
    tutar: Math.max(row.bakiye, 0),
    odemeYontemi: 'HAVALE',
    belgeNo: '',
    donem: thisMonth(),
    aciklama: `${row.ad} tahsilatı`,
    accountId: '',
  });
  const [saving, setSaving] = useState(false);

  const { data: accounts = [] } = useQuery<FinancialAccount[]>({
    queryKey: ['cari-accounts'],
    queryFn: () => api.get('/cari-kasa/accounts').then((r) => r.data),
  });

  useEffect(() => {
    if (!accounts.length || form.accountId) return;
    const preferred = accounts.find((a) => a.type === 'BANKA' && a.isActive !== false) || accounts.find((a) => a.isActive !== false) || accounts[0];
    setForm((old) => ({ ...old, accountId: preferred.id }));
  }, [accounts, form.accountId]);

  const save = async () => {
    if (form.tutar <= 0) {
      toast.error('Tutar pozitif olmalı');
      return;
    }
    if (!form.accountId) {
      toast.error('Tahsilat hesabı seçin');
      return;
    }
    setSaving(true);
    try {
      await api.post('/cari-kasa/tahsilat', {
        ...form,
        taxpayerId: row.id,
        belgeNo: form.belgeNo || undefined,
        aciklama: form.aciklama || undefined,
        donem: form.donem || undefined,
      });
      toast.success('Tahsilat kaydedildi');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Tahsilat kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.72)' }} onClick={onClose}>
      <div className="w-full max-w-[520px] rounded-[8px] border p-5" style={{ background: '#101214', borderColor: 'rgba(74,222,128,0.28)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: '#86efac' }}>Tahsilat Kaydı</div>
            <h3 className="mt-1 text-[20px] font-bold truncate" style={{ color: TEXT }}>{row.ad}</h3>
            <div className="mt-1 text-[12.5px] font-semibold" style={{ color: SOFT }}>Açık bakiye {fmt(row.bakiye)} TL</div>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-[8px] inline-flex items-center justify-center shrink-0" style={ghostButtonStyle}>
            <X size={17} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Tarih">
            <input type="date" value={form.tarih} onChange={(e) => setForm({ ...form, tarih: e.target.value })} className="w-full h-11 px-3 rounded-[8px] outline-none" style={inputStyle} />
          </Field>
          <Field label="Tutar">
            <input type="number" step="0.01" value={form.tutar} onChange={(e) => setForm({ ...form, tutar: Number(e.target.value) })} autoFocus className="w-full h-11 px-3 rounded-[8px] outline-none tabular-nums" style={inputStyle} />
          </Field>
          <Field label="Ödeme yöntemi">
            <select value={form.odemeYontemi} onChange={(e) => setForm({ ...form, odemeYontemi: e.target.value })} className="w-full h-11 px-3 rounded-[8px] outline-none" style={inputStyle}>
              <option value="HAVALE">Havale/EFT</option>
              <option value="NAKIT">Nakit</option>
              <option value="POS">POS/Kart</option>
              <option value="CEK">Çek</option>
              <option value="SENET">Senet</option>
            </select>
          </Field>
          <Field label="Hesap">
            <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} className="w-full h-11 px-3 rounded-[8px] outline-none" style={inputStyle}>
              <option value="">Hesap seçin</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Belge no">
            <input value={form.belgeNo} onChange={(e) => setForm({ ...form, belgeNo: e.target.value })} placeholder="Dekont veya makbuz no" className="w-full h-11 px-3 rounded-[8px] outline-none" style={inputStyle} />
          </Field>
          <Field label="Dönem">
            <input value={form.donem} onChange={(e) => setForm({ ...form, donem: e.target.value })} placeholder="2026-05" className="w-full h-11 px-3 rounded-[8px] outline-none" style={inputStyle} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Açıklama">
              <input value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} className="w-full h-11 px-3 rounded-[8px] outline-none" style={inputStyle} />
            </Field>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="h-11 flex-1 rounded-[8px] text-[13px] font-bold" style={ghostButtonStyle}>
            İptal
          </button>
          <button onClick={save} disabled={saving} className="h-11 flex-1 rounded-[8px] text-[13px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50" style={greenButtonStyle}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />} Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block mb-1.5 text-[12px] font-bold" style={{ color: MUTED }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.065)',
  border: `1px solid ${LINE}`,
  color: TEXT,
  fontWeight: 650,
};

const ghostButtonStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.055)',
  border: `1px solid ${LINE}`,
  color: MUTED,
};

const greenButtonStyle: React.CSSProperties = {
  background: 'rgba(34,197,94,0.14)',
  border: '1px solid rgba(34,197,94,0.32)',
  color: '#86efac',
};

const amberButtonStyle: React.CSSProperties = {
  background: 'rgba(212,184,118,0.14)',
  border: '1px solid rgba(212,184,118,0.34)',
  color: '#f5d992',
};

const blueButtonStyle: React.CSSProperties = {
  background: 'rgba(56,189,248,0.12)',
  border: '1px solid rgba(56,189,248,0.30)',
  color: '#bae6fd',
};
