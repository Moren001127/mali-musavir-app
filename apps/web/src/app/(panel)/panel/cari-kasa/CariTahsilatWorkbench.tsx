'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Check,
  Coins,
  Download,
  Eye,
  FileText,
  HandCoins,
  Loader2,
  MessageCircle,
  Minus,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ButcePlanView, GelirGiderTablosuView, IstatistikView, KasaBankaView } from './ButceTakipView';
import TahsilatOtomasyonView from './TahsilatOtomasyonView';

// ===== SADE KOYU PALET (referans HTML'lere göre) =====
const GOLD = '#e6c878';
const DEBT = '#e0697a';
const OK = '#5ad18a';
const BG = '#0a0a0c';
const PANEL = '#0c0c0e';
const CARD_BORDER = 'rgba(255,255,255,0.06)';
const CARD_BG = 'rgba(255,255,255,0.018)';
const ROW_LINE = 'rgba(255,255,255,0.05)';
const TEXT = '#e7e7ea';
const SOFT = '#71717a';
const SANS = 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

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
  buAyTahsilat?: number;
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
type FilterKey = 'all' | 'debt' | 'over90';
type ViewKey = 'tahsilat' | 'otomasyon' | 'kasa' | 'gelirGider' | 'butcePlan' | 'istatistik';

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

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const ayBaslik = () => {
  const d = new Date();
  return `${AYLAR[d.getMonth()]} ${d.getFullYear()}`;
};

const normalize = (value: string) =>
  value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

// Vade rozeti — yumuşak renkler (referans tabloya göre)
function bucketStyle(bucket: string) {
  if (bucket === '90+')
    return { color: '#eaa3ad', bg: 'rgba(224,105,122,0.13)', border: 'rgba(224,105,122,0.22)' };
  if (bucket === '61-90')
    return { color: '#eaa3ad', bg: 'rgba(224,105,122,0.12)', border: 'rgba(224,105,122,0.20)' };
  if (bucket === '31-60')
    return { color: GOLD, bg: 'rgba(230,200,120,0.12)', border: 'rgba(230,200,120,0.20)' };
  if (bucket === '1-30')
    return { color: '#b6b6bd', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.10)' };
  if (bucket === 'Güncel' || bucket === 'Guncel')
    return { color: '#6ee29c', bg: 'rgba(90,209,138,0.12)', border: 'rgba(90,209,138,0.22)' };
  return { color: SOFT, bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)' };
}

function bucketLabel(bucket: string) {
  if (bucket === '90+') return '90+ gün';
  if (bucket === '61-90') return '61-90 gün';
  if (bucket === '31-60') return '31-60 gün';
  if (bucket === '1-30') return '1-30 gün';
  if (bucket === 'Güncel' || bucket === 'Guncel') return 'Güncel';
  return bucket;
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('tr-TR');
}

export function CariTahsilatWorkspace({ onSelect }: { onSelect: (id: string) => void }) {
  const qc = useQueryClient();
  const [view, setView] = useState<ViewKey>('tahsilat');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [preview, setPreview] = useState<any | null>(null);
  const [sending, setSending] = useState(false);
  const [quickTahsilat, setQuickTahsilat] = useState<WorkspaceRow | null>(null);
  const yil = new Date().getFullYear();
  const [baslangic] = useState(`${yil}-01-01`);
  const [bitis] = useState(today());
  const [dateMode] = useState<'all' | 'period'>('all');

  // ===== API: cari özet (KORUNDU — aynı queryKey, aynı params, 30sn) =====
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

  // ===== API: tahsilat ajandası (KORUNDU) =====
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
        buAyTahsilat: Number(row.buAyTahsilat || 0),
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
        return acc;
      },
      { tahakkuk: 0, tahsilat: 0, bakiye: 0, monthlyTarget: 0, borclu: 0, whatsapp: 0, noPhone: 0, over90: 0 },
    );
    return {
      ...result,
      tahsilatOrani: result.tahakkuk > 0 ? (result.tahsilat / result.tahakkuk) * 100 : 0,
    };
  }, [rows]);

  // 90+ gün risk tutarı (ajanda totals'tan)
  const risk90Tutar = Number(ajanda?.totals?.d90plus || 0);

  const filteredRows = useMemo(() => {
    const needle = normalize(search.trim());
    const filtered = rows.filter((row) => {
      const debt = row.bakiye > 0.004;
      if (filter === 'debt' && !debt) return false;
      if (filter === 'over90' && !(debt && row.maxBucket === '90+')) return false;
      if (!needle) return true;
      return normalize([row.ad, row.taxNumber || '', row.phone || '', row.email || ''].join(' ')).includes(needle);
    });
    // Sıralama: ada göre Türkçe alfabetik (sade — tek sabit sıralama)
    return filtered.sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
  }, [filter, rows, search]);

  // WhatsApp hedefi: görünen, uygun ve bakiyesi olan kayıtlar (KORUNDU)
  const targetIds = filteredRows.filter((row) => row.whatsappUygun && row.bakiye > 0).map((row) => row.id);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['cari-ozet'] });
    qc.invalidateQueries({ queryKey: ['cari-tahsilat-ajandasi'] });
    qc.invalidateQueries({ queryKey: ['cari-cashflow-summary'] });
    qc.invalidateQueries({ queryKey: ['cari-budget-summary'] });
  };

  // ===== WhatsApp önizle (KORUNDU) =====
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

  // Tek mükellefe WhatsApp: Hesap Dökümü PDF EKLİ mesaj (kullanıcı isteği 2026-08-06).
  // Metin sabittir; belge link değil PDF eki olarak gider. Otomatik gönderim yok.
  const sendReminderSingle = async (row: WorkspaceRow) => {
    if (!row.whatsappUygun) {
      toast.warning('Bu mükellef için WhatsApp uygun değil (telefon/izin yok)');
      return;
    }
    if (!confirm(`${row.ad} mükellefine hesap dökümü (ekstre PDF) WhatsApp ile gönderilsin mi?`)) return;
    try {
      const resp = await api.post(`/cari-kasa/ekstre-whatsapp/${row.id}`);
      toast.success(
        `Hesap dökümü gönderildi${resp.data?.testMode ? ' (TEST MODU — test telefonuna gitti)' : ''}`,
      );
      refreshAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'WhatsApp gönderilemedi');
    }
  };

  // ===== WhatsApp gönder (KORUNDU) =====
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

  // ===== Excel indir (KORUNDU) =====
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

  const tabs: { key: ViewKey; label: string }[] = [
    { key: 'tahsilat', label: 'Tahsilat' },
    { key: 'otomasyon', label: 'Otomasyon' },
    { key: 'kasa', label: 'Kasa & Banka' },
    { key: 'gelirGider', label: 'Gelir-Gider' },
    { key: 'butcePlan', label: 'Bütçe' },
    { key: 'istatistik', label: 'İstatistik' },
  ];

  return (
    <div className="min-h-screen" style={{ background: BG, fontFamily: SANS, color: TEXT }}>
      <div className="mx-auto max-w-[1240px] px-6 sm:px-10 py-8">
        {/* ===== HEADER ===== */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: 'linear-gradient(135deg,#ecd589,#d4b876)', color: '#000' }}>
              <Coins size={20} strokeWidth={1.7} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[26px] font-bold tracking-tight leading-none" style={{ color: '#fff' }}>
                Tahsilat Merkezi
              </h1>
              <p className="mt-1.5 text-[13.5px]" style={{ color: SOFT }}>
                {ayBaslik()} · {rows.length} mükellef
                {isFetching && <Loader2 size={12} className="inline ml-2 animate-spin" style={{ color: GOLD }} />}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={previewReminder}
              className="hidden sm:inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium transition"
              style={{ border: `1px solid rgba(255,255,255,0.10)`, background: 'rgba(255,255,255,0.02)', color: TEXT }}
              title="WhatsApp önizle"
            >
              <Eye size={16} strokeWidth={1.7} /> Önizle
            </button>
            <button
              onClick={sendReminder}
              disabled={sending}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold transition disabled:opacity-50"
              style={{ border: `1px solid rgba(90,209,138,0.28)`, background: 'rgba(90,209,138,0.10)', color: OK }}
              title="WhatsApp gönder"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} strokeWidth={1.7} />} Gönder
            </button>
            <button
              onClick={indirExcelToplu}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium transition"
              style={{ border: `1px solid rgba(255,255,255,0.10)`, background: 'rgba(255,255,255,0.02)', color: TEXT }}
            >
              <Download size={16} strokeWidth={1.7} /> Excel
            </button>
            <button
              onClick={refreshAll}
              className="grid h-10 w-10 place-items-center rounded-xl transition"
              style={{ border: `1px solid rgba(255,255,255,0.10)`, background: 'rgba(255,255,255,0.02)', color: SOFT }}
              title="Yenile"
            >
              <MoreHorizontal size={16} strokeWidth={1.7} />
            </button>
          </div>
        </div>

        {/* ===== TABS ===== */}
        <nav className="mt-8 flex items-center gap-8 text-[14.5px]" style={{ borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
          {tabs.map(({ key, label }) => {
            const active = view === key;
            return (
              <button
                key={key}
                onClick={() => setView(key)}
                className="relative -mb-px pb-3 transition"
                style={{
                  borderBottom: `2px solid ${active ? GOLD : 'transparent'}`,
                  fontWeight: active ? 600 : 500,
                  color: active ? '#fff' : SOFT,
                }}
              >
                {label}
              </button>
            );
          })}
        </nav>

        {view === 'kasa' && <div className="mt-6"><KasaBankaView /></div>}
        {view === 'gelirGider' && <div className="mt-6"><GelirGiderTablosuView /></div>}
        {view === 'butcePlan' && <div className="mt-6"><ButcePlanView /></div>}
        {view === 'istatistik' && <div className="mt-6"><IstatistikView /></div>}

        {view === 'otomasyon' && <TahsilatOtomasyonView />}

        {view === 'tahsilat' && (
          <>
            {/* ===== METRİKLER (4) — kutulu kartlar; alacak/risk kartları tıklanınca filtreler ===== */}
            <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard index={0} label="Toplam Alacak" value={`${fmt(stats.bakiye)} ₺`} color={DEBT} active={filter === 'debt'} onClick={() => setFilter(filter === 'debt' ? 'all' : 'debt')} />
              <MetricCard index={1} label="Aylık Ücret (Top.)" value={`${fmt(stats.monthlyTarget)} ₺`} color={GOLD} />
              <MetricCard index={2} label="Tahsilat Oranı" value={`%${stats.tahsilatOrani.toFixed(0)}`} color={OK} />
              <MetricCard index={3} label="90+ Gün Risk" value={`${fmt(risk90Tutar)} ₺`} color={DEBT} active={filter === 'over90'} onClick={() => setFilter(filter === 'over90' ? 'all' : 'over90')} />
            </div>

            {/* ===== ARAMA + FİLTRE ÇİPLERİ ===== */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-md">
                <Search size={16} strokeWidth={1.7} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: SOFT }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Mükellef ara…"
                  aria-label="Mükellef ara"
                  className="w-full rounded-xl py-2.5 pl-10 pr-3 text-[14px] outline-none"
                  style={{ border: `1px solid ${CARD_BORDER}`, background: 'rgba(255,255,255,0.02)', color: TEXT }}
                />
              </div>
              <div className="flex items-center gap-2">
                <Chip label="Tümü" active={filter === 'all'} onClick={() => setFilter('all')} />
                <Chip label="Borçlu" active={filter === 'debt'} onClick={() => setFilter('debt')} />
                <Chip label="90+ gün" active={filter === 'over90'} onClick={() => setFilter('over90')} />
              </div>
            </div>

            {/* ===== WhatsApp önizleme bandı (varsa) ===== */}
            {preview && (
              <div className="mt-4 rounded-xl px-4 py-2.5 text-[13px] font-medium" style={{ background: 'rgba(230,200,120,0.06)', border: `1px solid rgba(230,200,120,0.15)`, color: '#d9d9de' }}>
                WhatsApp önizleme: {preview.gonderilecek || 0} gönderilecek, {preview.atlanacak || 0} atlanacak.
                {!preview.whatsapp?.ready && <span style={{ color: GOLD }}> WhatsApp ayarı: {preview.whatsapp?.error}</span>}
              </div>
            )}

            {/* ===== TABLO ===== */}
            <TahsilatTable
              rows={filteredRows}
              isLoading={isLoading || ajandaLoading}
              onOpen={onSelect}
              onQuickTahsilat={setQuickTahsilat}
              onWhatsAppRow={sendReminderSingle}
            />

            <p className="mt-5 text-center text-[12px]" style={{ color: '#52525b' }}>
              Aylık ücret = aktif aylık hizmetlerin toplamı · <span style={{ color: OK }}>Bu Ay = ödendi</span> / <span style={{ color: DEBT }}>ödenmedi</span> · Borç yaşı çubuğu = bakiyenin vade dağılımı
            </p>
          </>
        )}
      </div>

      {quickTahsilat && (
        <QuickTahsilatModal
          row={quickTahsilat}
          onClose={() => setQuickTahsilat(null)}
          onSaved={() => {
            setQuickTahsilat(null);
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

function MetricCard({
  index: _index,
  label,
  value,
  color,
  active,
  onClick,
}: {
  index: number;
  label: string;
  value: string;
  color: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const Component = onClick ? 'button' : 'div';
  return (
    <Component
      onClick={onClick as any}
      title={onClick ? (active ? 'Filtreyi kaldır' : 'Bu kalemi filtrele') : undefined}
      className="rounded-2xl px-5 py-4 text-left transition"
      style={{
        background: active ? `${color}14` : CARD_BG,
        border: `1px solid ${active ? `${color}55` : CARD_BORDER}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: active ? color : SOFT }}>{label}</div>
      <div className="mt-2 text-[26px] font-bold" style={{ color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </Component>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-4 py-2 text-[13px] transition"
      style={
        active
          ? { background: 'linear-gradient(135deg,#ecd589,#d4b876)', color: '#000', fontWeight: 600 }
          : { border: `1px solid rgba(255,255,255,0.10)`, background: 'rgba(255,255,255,0.02)', color: TEXT, fontWeight: 500 }
      }
    >
      {label}
    </button>
  );
}

function TahsilatTable({
  rows,
  isLoading,
  onOpen,
  onQuickTahsilat,
  onWhatsAppRow,
}: {
  rows: WorkspaceRow[];
  isLoading: boolean;
  onOpen: (id: string) => void;
  onQuickTahsilat: (row: WorkspaceRow) => void;
  onWhatsAppRow: (row: WorkspaceRow) => void;
}) {
  if (isLoading) {
    return (
      <div className="mt-5 py-12 text-center text-[14px]" style={{ color: SOFT }}>
        <Loader2 className="animate-spin inline mr-2" size={17} /> Cari kayıtlar yükleniyor
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="mt-5 py-14 text-center text-[14px]" style={{ color: SOFT }}>
        Filtreye uygun cari kayıt bulunamadı.
      </div>
    );
  }

  return (
    <div className="mt-6 overflow-hidden rounded-2xl" style={{ border: `1px solid ${CARD_BORDER}`, background: 'rgba(255,255,255,0.012)' }}>
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider" style={{ color: SOFT, background: 'rgba(255,255,255,0.03)' }}>
              <th className="px-5 py-3.5 text-left font-medium">Mükellef</th>
              <th className="px-3 py-3.5 text-right font-medium">Aylık Ücret</th>
              <th className="px-3 py-3.5 text-center font-medium">Bu Ay</th>
              <th className="px-3 py-3.5 text-right font-medium">Bakiye</th>
              <th className="px-4 py-3.5 text-left font-medium">Borç Yaşı</th>
              <th className="px-5 py-3.5 text-right font-medium">İşlem</th>
            </tr>
          </thead>
          <tbody style={{ color: TEXT }}>
            {rows.map((row) => {
              const style = bucketStyle(row.maxBucket);
              const lastPayment = formatDate(row.sonTahsilatTarihi);
              const borclu = row.bakiye > 0.004;
              const odendi = Number(row.buAyTahsilat || 0) > 0.004;
              return (
                <tr
                  key={row.id}
                  className="group transition-colors"
                  style={{ borderTop: `1px solid ${ROW_LINE}` }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.015)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Mükellef (bu-ay durumu yalnız "Bu Ay" sütununda — çift bilgi kalktı) */}
                  <td className="px-5 py-4">
                    <button onClick={() => onOpen(row.id)} className="block w-full text-left">
                      <div className="font-semibold" style={{ color: '#fff' }}>{row.ad}</div>
                      <div className="mt-1 text-[12px]" style={{ color: SOFT }}>
                        {lastPayment ? `son tahsilat ${lastPayment}` : 'son tahsilat yok'}
                      </div>
                    </button>
                  </td>
                  {/* Aylık ücret */}
                  <td className="px-3 py-4 text-right font-semibold" style={{ color: row.aylikMuhasebeUcreti > 0 ? GOLD : SOFT, fontVariantNumeric: 'tabular-nums' }}>
                    {row.aylikMuhasebeUcreti > 0 ? `${fmt(row.aylikMuhasebeUcreti)} ₺` : '—'}
                  </td>
                  {/* Bu Ay rozeti */}
                  <td className="px-3 py-4 text-center">
                    {odendi ? (
                      <span className="inline-grid h-7 w-7 place-items-center rounded-full" style={{ background: 'rgba(90,209,138,0.14)', color: OK }} title="Bu ay tahsilat alındı">
                        <Check size={16} strokeWidth={2} />
                      </span>
                    ) : (
                      <span className="inline-grid h-7 w-7 place-items-center rounded-full" style={{ background: 'rgba(224,105,122,0.10)', color: '#9a6b73' }} title="Bu ay tahsilat yok">
                        <Minus size={16} strokeWidth={2} />
                      </span>
                    )}
                  </td>
                  {/* Bakiye */}
                  <td className="px-3 py-4 text-right font-bold" style={{ color: borclu ? DEBT : TEXT, fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(row.bakiye)} ₺
                  </td>
                  {/* Borç yaşı: rozet + segment çubuk */}
                  <td className="px-4 py-4">
                    <span className="inline-flex rounded-lg px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap" style={{ color: style.color, background: style.bg, border: `1px solid ${style.border}` }}>
                      {bucketLabel(row.maxBucket)}
                    </span>
                    {borclu && <AgingBar aging={row.aging} />}
                  </td>
                  {/* Aksiyonlar: detay · WhatsApp hatırlat (tekli gerçek gönderim) · tahsilat gir */}
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => onOpen(row.id)}
                        title="Ekstre / detay"
                        className="grid h-[34px] w-[34px] place-items-center rounded-[10px] transition hover:-translate-y-px"
                        style={{ background: 'rgba(255,255,255,0.04)', color: SOFT }}
                      >
                        <FileText size={17} strokeWidth={1.7} />
                      </button>
                      <button
                        onClick={() => onWhatsAppRow(row)}
                        disabled={!borclu || !row.whatsappUygun}
                        title={row.whatsappUygun ? 'WhatsApp tahsilat hatırlatması gönder' : 'WhatsApp uygun değil (telefon/izin yok)'}
                        className="grid h-[34px] w-[34px] place-items-center rounded-[10px] transition hover:-translate-y-px disabled:opacity-30 disabled:hover:translate-y-0"
                        style={{ background: 'rgba(63,206,111,0.12)', color: '#3fce6f' }}
                      >
                        <MessageCircle size={17} strokeWidth={1.7} />
                      </button>
                      <button
                        onClick={() => onQuickTahsilat(row)}
                        disabled={!borclu}
                        title="Tahsilat gir"
                        className="grid h-[34px] w-[34px] place-items-center rounded-[10px] transition hover:-translate-y-px disabled:opacity-30 disabled:hover:translate-y-0"
                        style={{ background: 'rgba(230,200,120,0.14)', color: GOLD }}
                      >
                        <Plus size={17} strokeWidth={1.7} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Borç yaşı segment çubuğu: bakiyenin vade dağılımı (current, 1-30, 31-60, 61-90, 90+)
function AgingBar({ aging }: { aging: TahsilatAjandaRow['aging'] }) {
  const segments = [
    { value: aging.current, color: OK },        // güncel
    { value: aging.d1_30, color: '#8a8a93' },   // 1-30
    { value: aging.d31_60, color: GOLD },       // 31-60
    { value: aging.d61_90, color: DEBT },       // 61-90
    { value: aging.d90plus, color: DEBT },      // 90+
  ];
  const total = segments.reduce((sum, s) => sum + Math.max(s.value, 0), 0);
  if (total <= 0) return null;
  return (
    <div className="mt-1.5 flex h-1.5 w-[120px] overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
      {segments.map((s, i) =>
        s.value > 0 ? <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} /> : null,
      )}
    </div>
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

  // ===== API: hesaplar (KORUNDU — aynı queryKey) =====
  const { data: accounts = [] } = useQuery<FinancialAccount[]>({
    queryKey: ['cari-accounts'],
    queryFn: () => api.get('/cari-kasa/accounts').then((r) => r.data),
  });

  useEffect(() => {
    if (!accounts.length || form.accountId) return;
    const preferred = accounts.find((a) => a.type === 'BANKA' && a.isActive !== false) || accounts.find((a) => a.isActive !== false) || accounts[0];
    setForm((old) => ({ ...old, accountId: preferred.id }));
  }, [accounts, form.accountId]);

  // Bu tahsilat sonrası kalan bakiye göstergesi
  const kalanBakiye = Math.max(row.bakiye - (Number.isFinite(form.tutar) ? form.tutar : 0), 0);

  // ===== API: tahsilat kaydet (KORUNDU — aynı endpoint, aynı payload) =====
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
    <div className="fixed inset-0 z-50 grid place-items-center px-4 py-8" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="w-full max-w-[520px] rounded-[20px]"
        style={{ background: PANEL, border: `1px solid rgba(230,200,120,0.18)`, boxShadow: '0 24px 60px -12px rgba(0,0,0,0.7)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Başlık */}
        <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-5">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: GOLD }}>Tahsilat</div>
            <h1 className="mt-1 text-[24px] font-bold tracking-tight leading-none" style={{ color: '#fff' }}>Tahsilat Al</h1>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl transition" style={{ border: `1px solid rgba(255,255,255,0.10)`, background: 'rgba(255,255,255,0.02)', color: SOFT }}>
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>

        {/* Mükellef satırı */}
        <div className="mx-7 rounded-xl px-4 py-3" style={{ border: `1px solid ${CARD_BORDER}`, background: CARD_BG }}>
          <div className="flex items-center gap-2 flex-wrap text-[13px]">
            <span className="font-semibold" style={{ color: '#fff' }}>{row.ad}</span>
            <span style={{ color: '#52525b' }}>·</span>
            <span style={{ color: SOFT, fontVariantNumeric: 'tabular-nums' }}>VKN {row.taxNumber || '—'}</span>
            <span style={{ color: '#52525b' }}>·</span>
            <span style={{ color: SOFT }}>açık bakiye</span>
            <span className="font-semibold" style={{ color: DEBT, fontVariantNumeric: 'tabular-nums' }}>{fmt(row.bakiye)} ₺</span>
          </div>
        </div>

        {/* Form */}
        <div className="px-7 pt-5 pb-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Tarih">
              <input type="date" value={form.tarih} onChange={(e) => setForm({ ...form, tarih: e.target.value })} style={inpStyle} />
            </Field>
            <Field label="Tutar">
              <input type="number" step="0.01" value={form.tutar} onChange={(e) => setForm({ ...form, tutar: Number(e.target.value) })} autoFocus style={{ ...inpStyle, fontSize: 18, fontWeight: 700, color: GOLD }} />
            </Field>
            <Field label="Ödeme Yöntemi">
              <select value={form.odemeYontemi} onChange={(e) => setForm({ ...form, odemeYontemi: e.target.value })} style={selStyle}>
                <option value="HAVALE">Havale / EFT</option>
                <option value="NAKIT">Nakit</option>
                <option value="POS">Kredi Kartı</option>
                <option value="CEK">Çek</option>
                <option value="SENET">Senet</option>
              </select>
            </Field>
            <Field label="Hesap">
              <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} style={selStyle}>
                <option value="">Hesap seçin</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Belge No">
              <input value={form.belgeNo} onChange={(e) => setForm({ ...form, belgeNo: e.target.value })} placeholder="Dekont veya makbuz no" style={inpStyle} />
            </Field>
            <Field label="Dönem">
              <input value={form.donem} onChange={(e) => setForm({ ...form, donem: e.target.value })} placeholder="2026-05" style={inpStyle} />
            </Field>
            <div className="col-span-2">
              <Field label="Açıklama">
                <input value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} style={inpStyle} />
              </Field>
            </div>
          </div>

          {/* Bilgi şeridi: kalan bakiye */}
          <div className="mt-5 flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'rgba(230,200,120,0.06)', border: `1px solid rgba(230,200,120,0.15)` }}>
            <span className="text-[13px]" style={{ color: '#a1a1aa' }}>Bu tahsilat sonrası kalan bakiye</span>
            <span className="text-[16px] font-bold" style={{ color: GOLD, fontVariantNumeric: 'tabular-nums' }}>{fmt(kalanBakiye)} ₺</span>
          </div>
        </div>

        {/* Alt butonlar */}
        <div className="flex items-center justify-end gap-3 px-7 pt-4 pb-6">
          <button onClick={onClose} className="rounded-xl px-5 py-2.5 text-[13.5px] font-medium transition" style={{ border: `1px solid rgba(255,255,255,0.10)`, background: 'rgba(255,255,255,0.02)', color: TEXT }}>
            Vazgeç
          </button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13.5px] font-semibold transition disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#ecd589,#d4b876)', color: '#000' }}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <HandCoins size={16} strokeWidth={1.7} />} Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase" style={{ letterSpacing: '.04em', color: '#7c7c84' }}>{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

const inpStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 12,
  border: `1px solid rgba(255,255,255,0.07)`,
  background: 'rgba(255,255,255,0.02)',
  color: TEXT,
  outline: 'none',
  padding: '11px 13px',
  fontSize: 14,
  fontVariantNumeric: 'tabular-nums',
};

const selStyle: React.CSSProperties = {
  ...inpStyle,
  appearance: 'none',
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%237c7c84' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 13px center',
  paddingRight: 34,
};
