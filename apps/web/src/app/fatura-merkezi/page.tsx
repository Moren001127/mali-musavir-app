'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Inbox, Users, Workflow, Send, Upload, Archive,
  FileSpreadsheet, ArrowLeftRight, ArrowLeft, RefreshCw, Palette,
  CalendarDays, Search, ChevronDown, Sparkles, Settings, FileText,
  Cloud, Building, BookOpen, BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import MukelleflerPanel from './_panels/MukelleflerPanel';
import { taxpayerName, taxpayerTaxNumber, taxpayerSearchMatch } from './_lib/taxpayer';
import GelenBelgelerPanel from './_panels/GelenBelgelerPanel';
import EntegratorListesiPanel from './_panels/EntegratorListesiPanel';
import VeriAktarimiPanel from './_panels/VeriAktarimiPanel';
import SurecTakipPanel from './_panels/SurecTakipPanel';
import GenelBakisPanel from './_panels/GenelBakisPanel';
import HesapPlaniPanel from './_panels/HesapPlaniPanel';
import YuklenenlerPanel from './_panels/YuklenenlerPanel';

/* ════════════════════════════════════════════════════════════════════
   FATURA İŞLEME MERKEZİ — v2 (Tam Sayfa)
   Mihsap analizinden çıkan iş akışını + Moren'in görsel dilini
   harmanlayan tam-ekran çalışma alanı.
   ════════════════════════════════════════════════════════════════════ */

type SectionId =
  | 'genel'
  | 'gelen'
  | 'mukellefler'
  | 'entegrator-listesi'
  | 'surec'
  | 'veri-aktarimi'
  | 'yuklenenler'
  | 'hesap-plani'
  | 'arsiv';

const SECTIONS: Array<{
  id: SectionId;
  label: string;
  icon: LucideIcon;
  group: string;
  badge?: (counts: Counts) => string | null;
}> = [
  { id: 'genel',              label: 'Genel Bakış',         icon: LayoutDashboard,   group: 'OVERVIEW' },
  { id: 'gelen',              label: 'Gelen Belgeler',      icon: Inbox,              group: 'OVERVIEW', badge: (c) => c.pending > 0 ? String(c.pending) : null },
  { id: 'mukellefler',        label: 'Mükellefler',         icon: Users,              group: 'KAYIT' },
  { id: 'entegrator-listesi', label: 'Entegratör Listesi',  icon: Cloud,              group: 'KAYIT' },
  { id: 'hesap-plani',        label: 'Hesap Planı',         icon: BookOpen,           group: 'KAYIT' },
  { id: 'yuklenenler',        label: 'Yüklenen Faturalar',  icon: Upload,             group: 'PIPELINE' },
  { id: 'surec',              label: 'Süreç Takibi',        icon: Workflow,           group: 'PIPELINE', badge: (c) => c.openPeriods > 0 ? String(c.openPeriods) : null },
  { id: 'veri-aktarimi',      label: 'Luca\'ya Aktarım',    icon: Send,               group: 'AKTARIM' },
  { id: 'arsiv',              label: 'Arşiv',               icon: Archive,            group: 'AKTARIM' },
];

type Counts = { pending: number; openPeriods: number };

const PERIODS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

export default function FaturaMerkeziPage() {
  const [section, setSection] = useState<SectionId>('genel');
  const [taxpayerId, setTaxpayerId] = useState<string | undefined>(undefined);
  const [period, setPeriod] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [showTaxpayerPicker, setShowTaxpayerPicker] = useState(false);
  const [taxpayerSearch, setTaxpayerSearch] = useState('');

  /* ─── Mükellef listesi ─── */
  const taxpayersQ = useQuery({
    queryKey: ['fatura-merkezi', 'taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });

  const taxpayers: Array<any> = Array.isArray(taxpayersQ.data) ? taxpayersQ.data : (taxpayersQ.data?.items || []);
  const filteredTaxpayers = useMemo(() => {
    if (!taxpayerSearch) return taxpayers;
    return taxpayers.filter((t) => taxpayerSearchMatch(t, taxpayerSearch));
  }, [taxpayers, taxpayerSearch]);

  const selectedTaxpayer = taxpayers.find((t) => t.id === taxpayerId);

  /* ─── Özet sayılar (badge'ler için) ─── */
  const summaryQ = useQuery({
    queryKey: ['fatura-merkezi', 'summary', period],
    queryFn: () => api.get('/fatura-muhasebelestirme/summary', { params: { period } }).then((r) => r.data).catch(() => ({})),
  });

  const counts: Counts = {
    pending: summaryQ.data?.pending ?? 0,
    openPeriods: summaryQ.data?.openPeriods ?? 0,
  };

  const [year, month] = period.split('-');
  const periodLabel = `${PERIODS[Number(month) - 1] || ''} ${year}`;

  const refresh = () => {
    taxpayersQ.refetch();
    summaryQ.refetch();
  };

  /* ─── Sidebar grupları ─── */
  const grouped = useMemo(() => {
    const map = new Map<string, typeof SECTIONS>();
    SECTIONS.forEach((s) => {
      const list = map.get(s.group) || [];
      list.push(s);
      map.set(s.group, list);
    });
    return Array.from(map.entries());
  }, []);

  const groupLabels: Record<string, string> = {
    OVERVIEW:  'Özet',
    KAYIT:     'Kayıt',
    PIPELINE:  'İş Akışı',
    AKTARIM:   'Aktarım',
  };

  return (
    <div className="flex h-full w-full">
      {/* ═══════════ SOL SIDEBAR ═══════════ */}
      <aside
        className="flex flex-col"
        style={{
          width: 248,
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
        }}
      >
        {/* Logo + geri */}
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <Link
            href="/panel"
            className="flex items-center gap-2 text-xs mb-3 hover:opacity-80 transition-opacity"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft size={14} />
            <span>Ana panele dön</span>
          </Link>
          <div className="flex items-center gap-2">
            <Sparkles size={18} style={{ color: 'var(--accent)' }} />
            <h1
              className="text-[15px] tracking-tight"
              style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)', fontWeight: 600 }}
            >
              Fatura İşleme Merkezi
            </h1>
          </div>
          <div className="text-[11px] mt-1.5" style={{ color: 'var(--text-light)' }}>
            Moren Mali Müşavirlik
          </div>
        </div>

        {/* Menü grupları */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-3">
              <div
                className="px-3 pt-2 pb-1.5 text-[10px] tracking-wider font-semibold"
                style={{ color: 'var(--text-light)' }}
              >
                {groupLabels[group] || group}
              </div>
              {items.map((s) => {
                const Icon = s.icon;
                const active = section === s.id;
                const badge = s.badge?.(counts) || null;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSection(s.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] rounded-md transition-all duration-150 mb-0.5"
                    style={{
                      background: active ? 'var(--accent-light)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--text-secondary)',
                      fontWeight: active ? 600 : 500,
                    }}
                    onMouseEnter={(e) => {
                      if (!active) e.currentTarget.style.background = 'var(--surface-2)';
                    }}
                    onMouseLeave={(e) => {
                      if (!active) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <Icon size={16} strokeWidth={active ? 2.2 : 1.6} />
                    <span className="flex-1 text-left">{s.label}</span>
                    {badge && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                        style={{
                          background: 'var(--accent)',
                          color: 'var(--bg)',
                          minWidth: 18,
                          textAlign: 'center',
                        }}
                      >
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Alt bilgi */}
        <div
          className="px-4 py-3 text-[10px]"
          style={{ borderTop: '1px solid var(--border)', color: 'var(--text-light)' }}
        >
          v2.0 · Mihsap referansı
        </div>
      </aside>

      {/* ═══════════ İÇERIK ALANI ═══════════ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Üst Toolbar */}
        <header
          className="flex items-center gap-3 px-6 py-3"
          style={{
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            minHeight: 60,
          }}
        >
          {/* Mukellef seçici */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTaxpayerPicker((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 text-[13px] rounded-lg transition-colors"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                minWidth: 320,
              }}
            >
              <Users size={15} style={{ color: 'var(--text-muted)' }} />
              <span className="flex-1 text-left truncate">
                {selectedTaxpayer
                  ? taxpayerName(selectedTaxpayer)
                  : `Tüm Mükellefler · ${taxpayers.length}`}
              </span>
              <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
            </button>

            {showTaxpayerPicker && (
              <div
                className="absolute top-full left-0 mt-1 z-50 rounded-lg shadow-xl overflow-hidden"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  width: 380,
                  maxHeight: 460,
                }}
              >
                <div className="p-2" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <Search size={14} style={{ color: 'var(--text-muted)' }} />
                    <input
                      autoFocus
                      placeholder="Ara — ad veya VKN..."
                      value={taxpayerSearch}
                      onChange={(e) => setTaxpayerSearch(e.target.value)}
                      className="flex-1 bg-transparent outline-none text-[13px]"
                      style={{ color: 'var(--text)' }}
                    />
                  </div>
                </div>
                <div className="max-h-[380px] overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => { setTaxpayerId(undefined); setShowTaxpayerPicker(false); }}
                    className="w-full px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-[var(--surface-2)] flex items-center justify-between"
                    style={{
                      color: !taxpayerId ? 'var(--accent)' : 'var(--text)',
                      background: !taxpayerId ? 'var(--accent-light)' : 'transparent',
                      fontWeight: !taxpayerId ? 600 : 500,
                    }}
                  >
                    <span>Tüm mükellefler · {taxpayers.length}</span>
                    {!taxpayerId && <span style={{ color: 'var(--accent)' }}>✓</span>}
                  </button>
                  {filteredTaxpayers.length === 0 && (
                    <div className="px-3 py-6 text-center text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                      {taxpayerSearch ? 'Eşleşen mükellef yok' : 'Henüz mükellef yok'}
                    </div>
                  )}
                  {filteredTaxpayers.map((t) => {
                    const sel = t.id === taxpayerId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => { setTaxpayerId(t.id); setShowTaxpayerPicker(false); }}
                        className="w-full px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--surface-2)]"
                        style={{
                          background: sel ? 'var(--accent-light)' : 'transparent',
                          color: sel ? 'var(--accent)' : 'var(--text)',
                        }}
                      >
                        <div className="font-medium truncate">{taxpayerName(t)}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {taxpayerTaxNumber(t)}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div
                  className="px-3 py-2 text-[10.5px] text-right"
                  style={{ borderTop: '1px solid var(--border)', color: 'var(--text-light)' }}
                >
                  {filteredTaxpayers.length} / {taxpayers.length} mükellef
                </div>
              </div>
            )}
          </div>

          {/* Dönem seçici */}
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <CalendarDays size={15} style={{ color: 'var(--text-muted)' }} />
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-transparent outline-none text-[13px] font-medium"
              style={{ color: 'var(--text)' }}
            >
              {Array.from({ length: 12 }, (_, i) => i).map((monthIdx) => {
                const m = String(monthIdx + 1).padStart(2, '0');
                const v = `${year}-${m}`;
                return (
                  <option key={v} value={v} style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                    {PERIODS[monthIdx]} {year}
                  </option>
                );
              })}
            </select>
            <span style={{ color: 'var(--text-light)' }}>·</span>
            <select
              value={year}
              onChange={(e) => setPeriod(`${e.target.value}-${month}`)}
              className="bg-transparent outline-none text-[13px] font-medium"
              style={{ color: 'var(--text)' }}
            >
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y} style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1" />

          {/* Yenile */}
          <button
            type="button"
            onClick={refresh}
            disabled={taxpayersQ.isFetching || summaryQ.isFetching}
            className="flex items-center gap-2 px-3 py-2 text-[13px] rounded-lg transition-colors"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            <RefreshCw
              size={14}
              className={taxpayersQ.isFetching || summaryQ.isFetching ? 'animate-spin' : ''}
            />
            Yenile
          </button>
        </header>

        {/* İçerik */}
        <main className="flex-1 overflow-auto" style={{ background: 'var(--bg)' }}>
          {section === 'genel' && (
            <GenelBakisPanel
              taxpayerId={taxpayerId}
              period={period}
              taxpayers={taxpayers}
            />
          )}
          {section === 'gelen' && (
            <GelenBelgelerPanel taxpayerId={taxpayerId} period={period} />
          )}
          {section === 'mukellefler' && (
            <MukelleflerPanel
              taxpayers={taxpayers}
              loading={taxpayersQ.isLoading}
              onRefresh={refresh}
              onSelectTaxpayer={(id) => { setTaxpayerId(id); setSection('gelen'); }}
            />
          )}
          {section === 'entegrator-listesi' && (
            <EntegratorListesiPanel taxpayers={taxpayers} />
          )}
          {section === 'hesap-plani' && (
            <HesapPlaniPanel taxpayerId={taxpayerId} />
          )}
          {section === 'yuklenenler' && (
            <YuklenenlerPanel taxpayerId={taxpayerId} period={period} />
          )}
          {section === 'surec' && (
            <SurecTakipPanel period={period} taxpayers={taxpayers} />
          )}
          {section === 'veri-aktarimi' && (
            <VeriAktarimiPanel period={period} />
          )}
          {section === 'arsiv' && (
            <ArsivPlaceholder />
          )}
        </main>
      </div>
    </div>
  );
}

/* ─── Geçici placeholder ─── */
function ArsivPlaceholder() {
  return (
    <div className="p-8">
      <div
        className="rounded-xl p-8 text-center"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <Archive size={36} className="mx-auto mb-3" style={{ color: 'var(--accent)' }} />
        <h3 className="text-[16px] font-semibold mb-1" style={{ color: 'var(--text)' }}>
          Arşiv modülü hazırlanıyor
        </h3>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Onaylanmış faturalar, dönem kapanışları ve Luca'ya iletilen fişler buradan listelenecek.
        </p>
      </div>
    </div>
  );
}
