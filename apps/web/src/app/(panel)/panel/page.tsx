'use client';
import { portalStyle } from '@/lib/portal-theme';
import '@/components/dashboard/dashboard-white.css';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Users,
  FileText,
  AlertTriangle,
  ArrowRight,
  Receipt,
  Plus,
  Bot,
  X as IconX,
  Download,
  FileCheck2,
  Mailbox,
  BellRing,
  BrainCircuit,
  Building2,
  ClipboardCheck,
  DatabaseZap,
  FileScan,
  Gauge,
  MessageSquareText,
  ReceiptText,
  Settings2,
  UserRoundSearch,
  Workflow,
} from 'lucide-react';
import { beyannameTakipApi, BEYAN_ETIKETLER } from '@/lib/beyanname-takip';
import type { BeyanTipi, DonemTuru } from '@/lib/beyanname-takip';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { KritikUyariStatCard } from '@/components/dashboard/KritikUyariStatCard';
import { MaliTakvim } from '@/components/dashboard/MaliTakvim';
import { IsAkisiHatti } from '@/components/dashboard/IsAkisiHatti';
import { BeyanDurumTakibi, donemEtiket, type BeyanFilter } from '@/components/dashboard/BeyanDurumTakibi';
import { OfisPanoramasi, type PanoramaPeriodProps } from '@/components/dashboard/OfisPanoramasi';

const GOLD = '#d4b876';
const TRACK_BLUE = '#7dd3fc';
const TRACK_BLUE_SOFT = '#93c5fd';

type Task = {
  id: string;
  title: string;
  dueDate: string;
  note?: string;
  done: boolean;
  createdAt: string;
  // İleride aktif edilecek hatırlatma kanalları
  whatsappPhone?: string; // "05xx xxx xx xx" — WhatsApp hatırlatma için
  emailAddr?: string;     // E-posta hatırlatma için
  // Bildirim kontrolü
  lastReminderAt?: string; // Son uyarının zamanı (sürekli bildirim tekrarı için)
  reminderDismissed?: boolean; // Kullanıcı "Anladım" derse bu oturumda bir daha uyarma
};
// Elit Boutique altın ailesi — dashboard'a renk dokunuşları için
type StatAccent = 'gold' | 'champagne' | 'bronze' | 'copper' | 'burgundy' | 'sage' | 'sky' | 'amber' | 'teal';
const ACCENT_TONES: Record<StatAccent, { color: string; bg: string; border: string; hoverBg: string; hoverBorder: string }> = {
  gold:      { color: '#d4b876', bg: 'rgba(212,184,118,0.12)', border: 'rgba(212,184,118,0.28)', hoverBg: 'rgba(212,184,118,0.06)', hoverBorder: 'rgba(212,184,118,0.32)' },
  champagne: { color: '#e8d6a0', bg: 'rgba(232,214,160,0.14)', border: 'rgba(232,214,160,0.32)', hoverBg: 'rgba(232,214,160,0.06)', hoverBorder: 'rgba(232,214,160,0.36)' },
  bronze:    { color: '#c0a079', bg: 'rgba(192,160,121,0.14)', border: 'rgba(192,160,121,0.32)', hoverBg: 'rgba(192,160,121,0.06)', hoverBorder: 'rgba(192,160,121,0.36)' },
  copper:    { color: '#c98896', bg: 'rgba(201,136,150,0.12)', border: 'rgba(201,136,150,0.30)', hoverBg: 'rgba(201,136,150,0.07)', hoverBorder: 'rgba(201,136,150,0.36)' },
  burgundy:  { color: '#c98896', bg: 'rgba(201,136,150,0.14)', border: 'rgba(201,136,150,0.34)', hoverBg: 'rgba(201,136,150,0.08)', hoverBorder: 'rgba(201,136,150,0.38)' },
  sage:      { color: '#9cc8a6', bg: 'rgba(92,150,112,0.12)', border: 'rgba(156,200,166,0.25)', hoverBg: 'rgba(92,150,112,0.06)', hoverBorder: 'rgba(156,200,166,0.32)' },
  sky:       { color: '#9ec5e8', bg: 'rgba(96,165,250,0.11)', border: 'rgba(158,197,232,0.24)', hoverBg: 'rgba(96,165,250,0.06)', hoverBorder: 'rgba(158,197,232,0.30)' },
  amber:     { color: '#8bd3dd', bg: 'rgba(125,211,252,0.10)', border: 'rgba(125,211,252,0.23)', hoverBg: 'rgba(125,211,252,0.06)', hoverBorder: 'rgba(125,211,252,0.30)' },
  teal:      { color: '#5fd3c0', bg: 'rgba(45,212,191,0.10)', border: 'rgba(45,212,191,0.24)', hoverBg: 'rgba(45,212,191,0.06)', hoverBorder: 'rgba(45,212,191,0.30)' },
};

function StatCard({ title, value, icon: Icon, href, sub, trend, trendKind, accent = 'gold' }: { title: string; value: number | string; icon: any; href?: string; sub?: string; trend?: string; trendKind?: 'up'|'down'|'flat'; accent?: StatAccent }) {
  const t = ACCENT_TONES[accent];
  const c = (
    <div data-dashboard-kpi={accent} className="group relative overflow-hidden rounded-xl p-3 transition-all duration-300" style={portalStyle({ background: `linear-gradient(135deg, ${t.bg}, rgba(255,255,255,0.012))`, border: `1px solid ${t.border}`, cursor: href ? 'pointer' : 'default' })}
      onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = t.hoverBg; el.style.borderColor = t.hoverBorder; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.24)'; }}
      onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = `linear-gradient(135deg, ${t.bg}, rgba(255,255,255,0.012))`; el.style.borderColor = t.border; el.style.transform = 'translateY(0)'; el.style.boxShadow = 'none'; }}>
      {/* Üstten ince altın hairline (kendi tonunda, hover'da belirginleşir) */}
      <span className="absolute top-0 left-4 right-4 h-px transition-opacity duration-300 group-hover:opacity-100" style={{ background: `linear-gradient(90deg, transparent, ${t.color}, transparent)`, opacity: 0.35 }} />
      <div className="mb-2 flex items-center justify-between">
        <div data-dashboard-kpi-icon className="flex h-8 w-8 items-center justify-center rounded-lg" style={portalStyle({ background: 'rgba(15,13,11,0.28)', border: `1px solid ${t.border}`, color: t.color })}><Icon size={15} /></div>
        {trend && <span data-dashboard-kpi-badge className="text-[10px] font-bold px-2.5 py-[3px] rounded-md" style={portalStyle({ background: trendKind === 'up' ? 'rgba(34,197,94,0.1)' : trendKind === 'down' ? 'rgba(244,63,94,0.1)' : 'rgba(255,255,255,0.04)', color: trendKind === 'up' ? '#22c55e' : trendKind === 'down' ? '#f43f5e' : 'rgba(250,250,249,0.35)' })}>{trend}</span>}
      </div>
      <p className="text-[10.5px] uppercase font-bold tracking-[.11em]" style={portalStyle({ color: 'rgba(250,250,249,0.44)' })}>{title}</p>
      <p className="mt-1 leading-none tabular-nums" style={portalStyle({ fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 26, fontWeight: 900, letterSpacing: 0, color: t.color })}>{value ?? 0}</p>
      {sub && <p className="text-[10.5px] mt-0.5" style={portalStyle({ color: 'rgba(250,250,249,0.36)' })}>{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{c}</Link> : c;
}

type WorkflowCounts = { evrak: number; yukleme: number; islenme: number; kontrol: number; beyanname: number; tamam: number };

const EMPTY_WORKFLOW_COUNTS: WorkflowCounts = { evrak: 0, yukleme: 0, islenme: 0, kontrol: 0, beyanname: 0, tamam: 0 };

function AgentMini({ href, icon: Icon, name, stat, running }: { href: string; icon: any; name: string; stat: string; running: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-3 p-3 rounded-xl transition-all duration-300" style={portalStyle({ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' })}
      onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(184,160,111,0.05)'; el.style.borderColor = 'rgba(184,160,111,0.22)'; el.style.transform = 'translateY(-3px)'; }}
      onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.02)'; el.style.borderColor = 'rgba(255,255,255,0.05)'; el.style.transform = 'translateY(0)'; }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={portalStyle({ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD })}><Icon size={16} /></div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold truncate" style={portalStyle({ color: '#fafaf9' })}>{name}</div>
        <div className="text-[10.5px] mt-0.5" style={portalStyle({ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.4)' })}>{stat}</div>
      </div>
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: running ? '#22c55e' : 'rgba(255,255,255,0.18)', boxShadow: running ? '0 0 8px rgba(34,197,94,0.6)' : 'none', animation: running ? 'moren-pulse 2s infinite' : 'none' }} />
    </Link>
  );
}

// ══════════════════════════════════════════════════════════
// TOPLU BEYANNAME — SGK VE E-DEFTER KONTROL (Hattat-stili)
// Dönem seçici + beyanname/SGK/E-defter tabloları progress bar ile
// ══════════════════════════════════════════════════════════
type ModalState = { beyanTipi: BeyanTipi; filter: BeyanFilter; donem: string; donemTuru: DonemTuru } | null;

function ToplubeyannameTable(props: PanoramaPeriodProps) {
  return <ToplubeyannamePanel {...props} />;
}

/** Beyanname Durum Takibi: veri + dönem seçenekleri + mükellef listesi penceresi burada; görünüm BeyanDurumTakibi bileşeninde. */
function ToplubeyannamePanel({ donem, setDonem, donemTuru, setDonemTuru }: PanoramaPeriodProps) {
  const [modal, setModal] = useState<ModalState>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['beyanname-ozet', donem, donemTuru],
    queryFn: () => beyannameTakipApi.listOzet(donem, donemTuru),
    staleTime: 5 * 60 * 1000,
  });

  const rows = data?.rows || [];
  const selectedDonem = data?.donem || donem;
  const openModal = (beyanTipi: BeyanTipi, filter: BeyanFilter) =>
    setModal({ beyanTipi, filter, donem: selectedDonem, donemTuru });

  const donemOptions = useMemo(() => {
    const now = new Date();
    const arr: { value: string; label: string }[] = [];
    const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    // İLERİ + GERİ: gelecek 15 ay + geçmiş 24 ay. Kurumlar (ertesi yıl Nisan) / gelir
    // (ertesi yıl Mart) gibi GELECEK dönem beyannameleri seçilip görülebilsin.
    for (let offset = 15; offset >= -24; offset--) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      arr.push({ value: v, label: `${d.getFullYear()}/${aylar[d.getMonth()]}` });
    }
    return arr;
  }, []);

  return (
    <>
      <BeyanDurumTakibi
        donem={donem}
        setDonem={setDonem}
        donemTuru={donemTuru}
        setDonemTuru={setDonemTuru}
        donemOptions={donemOptions}
        selectedDonem={selectedDonem}
        rows={rows}
        isLoading={isLoading}
        onRefetch={() => refetch()}
        onNumberClick={openModal}
      />
      {modal && <BeyanDetayModal state={modal} onClose={() => setModal(null)} />}
    </>
  );
}

function BeyanDetayModal({ state, onClose }: { state: { beyanTipi: BeyanTipi; filter: BeyanFilter; donem: string; donemTuru: DonemTuru }; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const { data: detay, isLoading } = useQuery({
    queryKey: ['beyanname-detay', state.donem, state.donemTuru, state.beyanTipi, state.filter],
    queryFn: () => beyannameTakipApi.listDetay(state.donem, state.donemTuru),
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const filterLabels: Record<BeyanFilter, string> = {
    toplam: 'Takipteki Mükellefler',
    onaylanan: 'Beyannamesi Verilmiş Mükellefler',
    bekleyen: 'Onay Bekleyen Mükellefler',
    hatali: 'Hatalı Beyanname Mükellefleri',
    kalan: 'Beyannamesi Verilmemiş Mükellefler',
  };

  const filteredItems = useMemo(() => {
    if (!detay) return [];
    const collator = new Intl.Collator('tr', { sensitivity: 'base' });
    return detay
      .map((row) => {
        const b = row.beyanlar.find((x) => x.beyanTipi === state.beyanTipi);
        if (!b) return null;
        switch (state.filter) {
          case 'toplam':    return { taxpayer: row, beyan: b };
          case 'onaylanan': return b.durum === 'onaylandi' ? { taxpayer: row, beyan: b } : null;
          case 'bekleyen':  return b.durum === 'beklemede' ? { taxpayer: row, beyan: b } : null;
          case 'hatali':    return b.durum === 'hatali' ? { taxpayer: row, beyan: b } : null;
          case 'kalan':     return b.durum === 'kalan' ? { taxpayer: row, beyan: b } : null;
          default: return null;
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => collator.compare(a.taxpayer.ad || '', b.taxpayer.ad || ''));
  }, [detay, state.beyanTipi, state.filter]);

  const filterColor: Record<BeyanFilter, string> = {
    toplam: '#d4b876',
    onaylanan: '#22c55e',
    bekleyen: 'rgba(250,250,249,0.6)',
    hatali: '#ef4444',
    kalan: TRACK_BLUE,
  };

  const durumRenk: Record<string, string> = {
    onaylandi: '#22c55e',
    beklemede: TRACK_BLUE_SOFT,
    hatali: '#f472b6',
    muaf: GOLD,
    kalan: TRACK_BLUE,
  };
  const durumEtiket: Record<string, string> = {
    onaylandi: 'Verildi',
    beklemede: 'Onay Bekliyor',
    hatali: 'Hatalı',
    muaf: 'Muaf',
    kalan: 'Verilmedi',
  };
  const formatDate = (value: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('tr-TR');
  };
  const formatMoney = (value: number | null) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(value);
  };
  const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const downloadList = () => {
    const header = ['Sıra', 'Mükellef', 'Beyanname', 'Verilme Dönemi', 'Vergi Dönemi', 'Durum', 'Onay/Tarih', 'Tahakkuk'];
    const body = filteredItems.map(({ taxpayer, beyan }, index) => [
      index + 1,
      taxpayer.ad,
      BEYAN_ETIKETLER[state.beyanTipi],
      donemEtiket(state.donem),
      donemEtiket(beyan.vergiDonem),
      durumEtiket[beyan.durum] || beyan.durum,
      formatDate(beyan.onayTarihi),
      formatMoney(beyan.tahakkukTutari),
    ]);
    const csv = [header, ...body].map((row) => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `beyanname-${state.beyanTipi.toLowerCase()}-${state.filter}-${state.donem}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const periodModeText = state.donemTuru === 'VERILME' ? 'Verilme dönemi' : 'Vergi dönemi';
  const vergiDonemKey = filteredItems[0]?.beyan?.vergiDonem || '';
  const emptyText = state.filter === 'onaylanan'
    ? 'Bu grupta verilmiş beyanname yok.'
    : state.filter === 'kalan'
      ? 'Bu grupta verilmemiş beyanname yok.'
      : 'Bu kategoride mükellef yok.';

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-dashboard-surface data-dashboard-root className="flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl"
        style={portalStyle({ background: '#101412', border: `1px solid ${filterColor[state.filter]}55`, maxHeight: '86vh', boxShadow: '0 28px 90px rgba(0,0,0,0.48)' })}
      >
        <div data-dashboard-band="neutral" className="flex items-start justify-between gap-4 px-4 py-3" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01))' })}>
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.16em]" style={portalStyle({ color: filterColor[state.filter] })}>
              {BEYAN_ETIKETLER[state.beyanTipi]} · {periodModeText}: {donemEtiket(state.donem)}{vergiDonemKey ? ` · Vergi dönemi: ${donemEtiket(vergiDonemKey)}` : ''}
            </div>
            <h3 className="mt-1 text-[24px] font-black leading-tight" style={portalStyle({ color: '#fafaf9' })}>
              {filterLabels[state.filter]}
            </h3>
            <p className="mt-1 text-[12.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.48)' })}>
              Sayaçtaki rakama dahil olan mükelleflerin dönem bazlı listesi.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadList}
              disabled={filteredItems.length === 0}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-lg px-3 text-[12.5px] font-bold transition disabled:cursor-not-allowed disabled:opacity-45"
              style={portalStyle({ background: 'rgba(125,211,252,0.12)', border: '1px solid rgba(125,211,252,0.28)', color: TRACK_BLUE })}
            >
              <Download size={15} /> Listeyi İndir
            </button>
            <button onClick={onClose} className="rounded-lg p-2 transition hover:bg-white/5" style={portalStyle({ color: 'rgba(250,250,249,0.55)' })}>
              <IconX size={19} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading && (
            <div className="px-4 py-14 text-center text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}>
              Yükleniyor...
            </div>
          )}
          {!isLoading && filteredItems.length === 0 && (
            <div className="rounded-xl px-4 py-14 text-center text-[13px]" style={portalStyle({ color: 'rgba(250,250,249,0.48)', border: '1px dashed rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.018)' })}>
              {emptyText}
            </div>
          )}
          {!isLoading && filteredItems.length > 0 && (
            <div className="overflow-hidden rounded-xl" style={portalStyle({ border: '1px solid rgba(255,255,255,0.08)' })}>
              <div className="grid grid-cols-[64px_minmax(260px,1.6fr)_160px_130px_150px] gap-0 px-4 py-3 text-[11px] font-black uppercase tracking-[0.11em]" style={portalStyle({ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.52)' })}>
                <div>No</div>
                <div>Mükellef</div>
                <div>Durum</div>
                <div>Tarih</div>
                <div className="text-right">Tahakkuk</div>
              </div>
              <div className="divide-y" style={portalStyle({ borderColor: 'rgba(255,255,255,0.055)' })}>
                {filteredItems.map(({ taxpayer, beyan }, i) => {
                  const tone = durumRenk[beyan.durum] || 'rgba(250,250,249,0.6)';
                  return (
                    <div
                      key={`${taxpayer.taxpayerId}-${state.beyanTipi}`}
                      className="grid grid-cols-[64px_minmax(260px,1.6fr)_160px_130px_150px] items-center gap-0 px-4 py-3 text-[13px]"
                      style={portalStyle({ background: i % 2 === 0 ? `${tone}10` : 'rgba(255,255,255,0.012)' })}
                    >
                      <div className="font-black tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.42)', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' })}>{i + 1}</div>
                      <div className="min-w-0 pr-4">
                        <div className="truncate text-[14px] font-black" style={portalStyle({ color: '#fafaf9' })}>{taxpayer.ad}</div>
                        <div className="mt-0.5 text-[11px]" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>
                          {BEYAN_ETIKETLER[state.beyanTipi]} · {donemEtiket(beyan.vergiDonem)}
                        </div>
                      </div>
                      <div>
                        <span
                          className="inline-flex rounded-md px-2.5 py-1 text-[10.5px] font-black uppercase tracking-[0.08em]"
                          style={portalStyle({ background: `${tone}1f`, border: `1px solid ${tone}55`, color: tone })}
                        >
                          {durumEtiket[beyan.durum] || beyan.durum}
                        </span>
                      </div>
                      <div className="text-[12px] font-semibold tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.66)' })}>
                        {formatDate(beyan.onayTarihi)}
                      </div>
                      <div className="text-right text-[12px] font-black tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.78)', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' })}>
                        {formatMoney(beyan.tahakkukTutari)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-3 text-[11.5px]" style={portalStyle({ borderTop: '1px solid rgba(255,255,255,0.07)', color: 'rgba(250,250,249,0.48)' })}>
          <span><strong style={portalStyle({ color: filterColor[state.filter] })}>{filteredItems.length}</strong> mükellef listeleniyor</span>
          <button onClick={onClose} className="font-bold transition hover:text-cyan-300">Kapat</button>
        </div>
      </div>
    </div>
  );

  return mounted ? createPortal(modal, document.body) : null;
}

// ── Aylık İşlem Trendi — Bar Chart
function TrendChart({ events }: { events: any[] }) {
  const [mode, setMode] = useState<'weekly' | 'monthly'>('monthly');

  const bars = useMemo(() => {
    const now = new Date();
    if (mode === 'monthly') {
      const months = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
      const arr: { label: string; count: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        arr.push({ label: months[d.getMonth()], count: 0 });
      }
      for (const ev of events) {
        const d = (ev.ts || ev.createdAt || ev.timestamp || ev.date) ? new Date(ev.ts || ev.createdAt || ev.timestamp || ev.date) : null;
        if (!d || isNaN(d.getTime())) continue;
        const diff = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
        if (diff >= 0 && diff < 6) arr[5 - diff].count++;
      }
      return arr;
    } else {
      const days = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];
      const arr: { label: string; count: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        arr.push({ label: days[(d.getDay() + 6) % 7], count: 0 });
      }
      for (const ev of events) {
        const d = (ev.ts || ev.createdAt || ev.timestamp || ev.date) ? new Date(ev.ts || ev.createdAt || ev.timestamp || ev.date) : null;
        if (!d || isNaN(d.getTime())) continue;
        const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
        if (diff >= 0 && diff < 7) arr[6 - diff].count++;
      }
      return arr;
    }
  }, [events, mode]);

  const max = Math.max(1, ...bars.map((b) => b.count));
  const hasAny = bars.some((b) => b.count > 0);

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-4" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.04)' })}>
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          <h3 className="text-[13.5px] font-semibold" style={portalStyle({ color: '#fafaf9' })}>Aylık İşlem Trendi</h3>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setMode('weekly')} className="px-3 py-1.5 text-[11px] font-medium rounded-md transition-all" style={portalStyle({ background: mode === 'weekly' ? 'rgba(184,160,111,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${mode === 'weekly' ? 'rgba(184,160,111,0.3)' : 'rgba(255,255,255,0.08)'}`, color: mode === 'weekly' ? GOLD : 'rgba(250,250,249,0.6)' })}>Haftalık</button>
          <button onClick={() => setMode('monthly')} className="px-3 py-1.5 text-[11px] font-medium rounded-md transition-all" style={portalStyle({ background: mode === 'monthly' ? 'rgba(184,160,111,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${mode === 'monthly' ? 'rgba(184,160,111,0.3)' : 'rgba(255,255,255,0.08)'}`, color: mode === 'monthly' ? GOLD : 'rgba(250,250,249,0.6)' })}>Aylık</button>
        </div>
      </div>
      {hasAny ? (
        <div className="flex items-end gap-2 h-[160px] px-[22px] pt-5 pb-2">
          {bars.map((b, i) => {
            const h = Math.max(4, (b.count / max) * 120);
            return (
              <div key={i} className="flex-1 flex flex-col items-center h-full group/bar" title={`${b.label}: ${b.count} işlem`}>
                <div className="flex-1 w-full flex items-end">
                  <div className="w-full rounded-t-[4px] transition-all group-hover/bar:opacity-100" style={portalStyle({ height: h, background: `linear-gradient(180deg, ${GOLD}, rgba(184,160,111,0.35))`, opacity: 0.85 })} />
                </div>
                <span className="text-[10px] font-semibold mt-1.5" style={portalStyle({ color: 'rgba(250,250,249,0.32)' })}>{b.label}</span>
                <span className="text-[9.5px] tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.5)', fontFamily: 'JetBrains Mono, monospace' })}>{b.count || ''}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center h-[130px] px-5">
          <p className="text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.35)' })}>Henüz işlem verisi yok</p>
        </div>
      )}
      <div className="flex gap-4 px-[22px] py-2.5 pt-2" style={portalStyle({ borderTop: '1px solid rgba(255,255,255,0.04)' })}>
        <div className="flex items-center gap-1.5 text-[10.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
          <div className="w-2 h-2 rounded-[3px]" style={{ background: GOLD }} />Toplam İşlem Hacmi
        </div>
      </div>
    </div>
  );
}

// ── Mükellef Durumu — Donut
function MukellefDonut({ total, segments }: { total: number; segments: { label: string; value: number; color: string }[] }) {
  const sum = segments.reduce((s, x) => s + x.value, 0);
  const grad = useMemo(() => {
    if (sum === 0) return 'rgba(255,255,255,0.06)';
    let acc = 0;
    const parts = segments.map((s) => {
      const start = (acc / sum) * 100;
      acc += s.value;
      const end = (acc / sum) * 100;
      return `${s.color} ${start}% ${end}%`;
    });
    return `conic-gradient(${parts.join(',')})`;
  }, [segments, sum]);

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-4" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.04)' })}>
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          <h3 className="text-[13.5px] font-semibold" style={portalStyle({ color: '#fafaf9' })}>Mükellef Durumu</h3>
        </div>
      </div>
      <div className="flex items-center justify-center gap-5 px-5 py-6">
        <div className="w-[120px] h-[120px] rounded-full flex items-center justify-center flex-shrink-0" style={portalStyle({ background: grad })}>
          <div className="w-[76px] h-[76px] rounded-full flex flex-col items-center justify-center" style={portalStyle({ background: '#0c0a08' })}>
            <div style={portalStyle({ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 700, color: GOLD })}>{total}</div>
            <div className="text-[8.5px] font-semibold uppercase mt-0.5" style={portalStyle({ color: 'rgba(250,250,249,0.35)', letterSpacing: '.14em' })}>Toplam</div>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 flex-1">
          {segments.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5 text-[11.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.65)' })}>
              <div className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={portalStyle({ background: s.color })} />
              {s.label}
              <span className="ml-auto font-bold tabular-nums" style={portalStyle({ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#fafaf9' })}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const MOBILE_COLORS = {
  ai: '#f09aa8',
  general: '#d4b876',
  invoice: '#8fd7bd',
  tax: '#d8ad70',
  finance: '#8cbde8',
  office: '#d9a06c',
  system: '#9da8b7',
};

const MOBILE_PRIORITY_MODULES = [
  { label: 'MOREN AI', sub: 'Moren AI', href: '/panel/moren-ai', icon: BrainCircuit, color: MOBILE_COLORS.ai },
  { label: 'Gösterge Paneli', sub: 'Genel', href: '/panel', icon: Gauge, color: MOBILE_COLORS.general },
  { label: 'Mükellef Listesi', sub: 'Genel', href: '/panel/mukellef-listesi', icon: UserRoundSearch, color: MOBILE_COLORS.general },
  { label: 'Aylık Takip Listesi', sub: 'Genel', href: '/panel/mukellefler', icon: ClipboardCheck, color: MOBILE_COLORS.general },
  { label: 'İş Akışı', sub: 'Genel', href: '/panel/is-yuku', icon: Workflow, color: MOBILE_COLORS.general },
  { label: 'Görevler & Notlar', sub: 'Genel', href: '/panel/gorevler', icon: ClipboardCheck, color: MOBILE_COLORS.general },
  { label: 'Bildirimler', sub: 'Genel', href: '/panel/bildirimler', icon: BellRing, color: MOBILE_COLORS.general },
  { label: 'Fatura Merkezi', sub: 'Fatura & Muhasebe', href: '/fatura-merkezi', icon: ReceiptText, color: MOBILE_COLORS.invoice },
  { label: 'E-Fatura / E-Arşiv', sub: 'Fatura & Muhasebe', href: '/panel/e-arsiv', icon: FileScan, color: MOBILE_COLORS.invoice },
  { label: 'Fatura İşleme', sub: 'Fatura & Muhasebe', href: '/panel/ajanlar/mihsap', icon: Bot, color: MOBILE_COLORS.invoice },
  { label: 'İşlenen Faturalar', sub: 'Fatura & Muhasebe', href: '/panel/faturalar', icon: Receipt, color: MOBILE_COLORS.invoice },
  { label: 'KDV Kontrol', sub: 'Vergi & Beyanname', href: '/panel/kdv-kontrol', icon: FileCheck2, color: MOBILE_COLORS.tax },
  { label: 'KDV Beyanname', sub: 'Vergi & Beyanname', href: '/panel/kdv-beyanname', icon: FileCheck2, color: MOBILE_COLORS.tax },
  { label: 'Beyannameler', sub: 'Vergi & Beyanname', href: '/panel/beyannameler', icon: FileText, color: MOBILE_COLORS.tax },
];

const MOBILE_GROUPS = [
  { label: 'Moren AI', count: '2 aktif', icon: BrainCircuit, color: MOBILE_COLORS.ai },
  { label: 'Genel', count: '5 aktif', icon: Gauge, color: MOBILE_COLORS.general },
  { label: 'Fatura & Muhasebe', count: '7 aktif', icon: ReceiptText, color: MOBILE_COLORS.invoice },
  { label: 'Vergi & Beyanname', count: '3 aktif, 2 planlı', icon: FileCheck2, color: MOBILE_COLORS.tax },
  { label: 'Mali Veriler', count: '5 aktif', icon: DatabaseZap, color: MOBILE_COLORS.finance },
  { label: 'Ofis', count: '3 aktif', icon: Building2, color: MOBILE_COLORS.office },
  { label: 'Teknik & Sistem', count: '9 aktif', icon: Settings2, color: MOBILE_COLORS.system },
];

function MobilePortalHome({
  activeCount,
  totalTx,
  pendingTasks,
  todayTaskCount,
  activeWorkload,
  unread,
  workflowCounts,
  workflowTotal,
  nextDueStr,
}: {
  activeCount: number;
  totalTx: number;
  pendingTasks: number;
  todayTaskCount: number;
  activeWorkload: number;
  unread: number;
  workflowCounts: WorkflowCounts;
  workflowTotal: number;
  nextDueStr: string | null;
}) {
  const quickActions = [
    { label: 'Mükellefler', sub: `${activeCount || totalTx || 0} aktif`, href: '/panel/mukellef-listesi', icon: UserRoundSearch, color: MOBILE_COLORS.general },
    { label: 'İş Akışı', sub: `${activeWorkload} aktif iş`, href: '/panel/is-yuku', icon: Workflow, color: MOBILE_COLORS.office },
    { label: 'Fatura', sub: 'İşleme merkezi', href: '/panel/ajanlar/mihsap', icon: ReceiptText, color: MOBILE_COLORS.invoice },
    { label: 'KDV', sub: `${workflowCounts.kontrol || 0} kontrol`, href: '/panel/kdv-kontrol', icon: FileCheck2, color: MOBILE_COLORS.tax },
  ];

  const stats = [
    { label: 'Mükellef', value: activeCount || totalTx || 0, sub: workflowTotal > 0 ? `${workflowTotal} akışta` : 'liste', color: MOBILE_COLORS.general, icon: Users },
    { label: 'İş yükü', value: activeWorkload, sub: 'aktif', color: MOBILE_COLORS.invoice, icon: Workflow },
    { label: 'Görev', value: pendingTasks, sub: todayTaskCount > 0 ? `bugün ${todayTaskCount}` : nextDueStr || 'sakin', color: MOBILE_COLORS.ai, icon: ClipboardCheck },
    { label: 'Bildirim', value: unread, sub: 'okunmamış', color: MOBILE_COLORS.system, icon: BellRing },
  ];

  return (
    <div className="mobile-dashboard-home mx-auto max-w-[460px] space-y-4 overflow-x-hidden pb-2">
      <section
        className="rounded-lg p-4"
        style={portalStyle({
          background: 'linear-gradient(135deg, rgba(212,184,118,0.11), rgba(15,13,11,0.98))',
          border: '1px solid rgba(212,184,118,0.22)',
        })}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
            style={portalStyle({ background: 'linear-gradient(135deg, #d4b876, #8b7649)', color: '#0f0d0b', fontFamily: 'Fraunces, serif', fontWeight: 800 })}
          >
            M
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase" style={portalStyle({ color: GOLD, letterSpacing: 0 })}>
              Kurulu Mobil Portal
            </p>
            <h1 className="mt-1 text-[22px] leading-[1.1]" style={portalStyle({ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 })}>
              Moren Portal
            </h1>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-6" style={portalStyle({ color: 'rgba(250,250,249,0.62)' })}>
          Telefonda ilk ekran artık gerçek modüllere giden mobil ana menüdür. Masaüstü panel düzeni bu ekranda zorlanmaz.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-2.5">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              data-dashboard-kpi={stat.label === 'Mükellef' ? 'sage' : stat.label === 'İş yükü' ? 'champagne' : stat.label === 'Görev' ? 'sky' : 'amber'} className="min-h-[88px] rounded-lg p-3"
              style={portalStyle({ background: `${stat.color}10`, border: `1px solid ${stat.color}28` })}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase" style={portalStyle({ color: 'rgba(250,250,249,0.52)', letterSpacing: 0 })}>
                  {stat.label}
                </span>
                <Icon size={14} style={portalStyle({ color: stat.color })} />
              </div>
              <div className="tabular-nums text-[25px] leading-none" style={portalStyle({ color: stat.color, fontFamily: 'Fraunces, serif', fontWeight: 700 })}>
                {stat.value}
              </div>
              <div className="mt-1 truncate text-[11px]" style={portalStyle({ color: 'rgba(250,250,249,0.46)' })}>
                {stat.sub}
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[18px] leading-tight" style={portalStyle({ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 })}>
              Hızlı işlemler
            </h2>
            <p className="mt-1 text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.46)' })}>
              Telefonda en sık açılacak ekranlar
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {quickActions.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="block min-h-[104px] rounded-lg p-3"
                style={portalStyle({ background: `${item.color}0f`, border: `1px solid ${item.color}26` })}
              >
                <div className="flex items-center justify-between gap-2">
                  <Icon size={18} style={portalStyle({ color: item.color })} />
                  <ArrowRight size={15} style={portalStyle({ color: 'rgba(250,250,249,0.42)' })} />
                </div>
                <div className="mt-4 truncate text-[14px] font-bold" style={portalStyle({ color: '#fafaf9' })}>
                  {item.label}
                </div>
                <div className="mt-1 truncate text-[11px]" style={portalStyle({ color: 'rgba(250,250,249,0.46)' })}>
                  {item.sub}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[18px] leading-tight" style={portalStyle({ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 })}>
              İlk PWA modülleri
            </h2>
            <p className="mt-1 text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.46)' })}>
              Kurulu uygulamada doğrudan erişim
            </p>
          </div>
          <span className="rounded-lg px-2 py-1 text-[12px] font-bold" style={portalStyle({ background: 'rgba(212,184,118,0.14)', color: GOLD })}>
            {MOBILE_PRIORITY_MODULES.length}
          </span>
        </div>
        <div className="space-y-2">
          {MOBILE_PRIORITY_MODULES.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-[58px] items-center gap-3 rounded-lg px-3 py-2"
                style={portalStyle({ background: `${item.color}0d`, border: `1px solid ${item.color}22` })}
              >
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                  style={portalStyle({ background: `${item.color}14`, border: `1px solid ${item.color}30`, color: item.color })}
                >
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold" style={portalStyle({ color: '#fafaf9' })}>
                    {item.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px]" style={portalStyle({ color: 'rgba(250,250,249,0.46)' })}>
                    {item.sub}
                  </span>
                </span>
                <ArrowRight size={15} style={portalStyle({ color: item.color })} />
              </Link>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div>
          <h2 className="text-[18px] leading-tight" style={portalStyle({ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 })}>
            Modül grupları
          </h2>
          <p className="mt-1 text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.46)' })}>
            Portal yapısı mobil menüde bu gruplarla açılır
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {MOBILE_GROUPS.map((group) => {
            const Icon = group.icon;
            return (
              <div
                key={group.label}
                className="flex min-h-[58px] items-center gap-3 rounded-lg px-3 py-2"
                style={portalStyle({ background: `${group.color}0d`, border: `1px solid ${group.color}22` })}
              >
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                  style={portalStyle({ background: `${group.color}14`, border: `1px solid ${group.color}30`, color: group.color })}
                >
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold" style={portalStyle({ color: '#fafaf9' })}>
                    {group.label}
                  </span>
                  <span className="mt-0.5 block text-[11px]" style={portalStyle({ color: 'rgba(250,250,249,0.46)' })}>
                    {group.count}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default function DashboardPage() {
  const [panoramaDonem, setPanoramaDonem] = useState(() => {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  });
  const [panoramaDonemTuru, setPanoramaDonemTuru] = useState<DonemTuru>('VERILME');
  const panoramaPeriod = { donem: panoramaDonem, setDonem: setPanoramaDonem, donemTuru: panoramaDonemTuru, setDonemTuru: setPanoramaDonemTuru };

  const { data: taxpayers } = useQuery({ queryKey: ['taxpayers'], queryFn: () => api.get('/taxpayers').then((r) => r.data).catch(() => []) });
  const { data: unreadRaw } = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get('/notifications/unread-count').then((r) => r.data).catch(() => 0) });
  const { data: agentEvents = [] } = useQuery<any[]>({ queryKey: ['agent-events', 'dashboard'], queryFn: () => api.get('/agent/events?limit=100').then((r) => r.data).catch(() => []), refetchInterval: 15_000 });
  const { data: agentStats } = useQuery<any>({ queryKey: ['agent-stats'], queryFn: () => api.get('/agent/stats').then((r) => r.data).catch(() => null) });
  const { data: agentStatuses = [] } = useQuery<any[]>({ queryKey: ['agent-statuses'], queryFn: () => api.get('/agent/status').then((r) => r.data).catch(() => []), refetchInterval: 30_000 });
  const agentEventList = useMemo(() => {
    const raw = agentEvents as any;
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.items)) return raw.items;
    if (Array.isArray(raw?.data)) return raw.data;
    return [];
  }, [agentEvents]);
  const agentStatusList = useMemo(() => {
    const raw = agentStatuses as any;
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.items)) return raw.items;
    if (Array.isArray(raw?.data)) return raw.data;
    return [];
  }, [agentStatuses]);

  // v1.36.80: Aktif İş Yükü — gerçek workflow queue count'u (KONTROL/İŞLEME/BEYAN bekleyenler toplamı)
  const { data: workflowData } = useQuery<{ queueUnavailable?: boolean; donem?: string; counts?: { evrak: number; yukleme: number; islenme: number; kontrol: number; beyanname: number; tamam: number }; total?: number }>({
    queryKey: ['dashboard-workflow-queue'],
    queryFn: () => api.get('/taxpayers/workflow/queue').then((r) => r.data).catch(() => ({ queueUnavailable: true, counts: { evrak: 0, yukleme: 0, islenme: 0, kontrol: 0, beyanname: 0, tamam: 0 }, total: 0 })),
    refetchInterval: 60_000,
  });
  const aktifIsYuku =
    (workflowData?.counts?.islenme ?? 0) +
    (workflowData?.counts?.kontrol ?? 0) +
    (workflowData?.counts?.beyanname ?? 0);

  // e-Tebligat sayacı (2026-09-21): gece sorgusuyla gelen ve henüz okunmamış tebligatlar.
  // Kaynak = /bugun konusu 'tb' (BugunMasasi ile aynı sorgu anahtarı → tek istek, 3 dk önbellek).
  const { data: bugunData } = useQuery<{ konular?: Array<{ id: string; sayac?: { okunmamis: number; yeni: number; mukellef: number; suresiIcinde?: number } }> }>({
    queryKey: ['bugun'],
    queryFn: () => api.get('/bugun').then((r) => r.data),
    staleTime: 3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const tebligat = bugunData?.konular?.find((k) => k.id === 'tb')?.sayac ?? { okunmamis: 0, yeni: 0, mukellef: 0, suresiIcinde: 0 };

  // v1.36.74: Görevler artık backend'den geliyor (Görevler & Notlar modülüyle ortak veri).
  // Eskiden localStorage tabanlıydı — yeni `/panel/gorevler` sayfasıyla senkron olsun diye API'ye geçildi.
  const { data: backendTasksData } = useQuery({
    queryKey: ['dashboard-tasks'],
    queryFn: () => api.get('/tasks', { params: { isTemplate: 'false', limit: 200 } }).then((r) => r.data).catch(() => ({ items: [] })),
    refetchInterval: 30_000,
  });
  // Reminder banner dismiss durumu — session-bazlı, sadece tarayıcıda
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = sessionStorage.getItem('moren-dismissed-task-ids');
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  // Backend Task'ı dashboard'da kullanılan eski Task tipine map et — JSX'i bozmamak için
  const tasks: Task[] = useMemo(() => {
    const items = (backendTasksData as any)?.items || [];
    return items.map((t: any) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate ? String(t.dueDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
      note: t.description || undefined,
      done: t.status === 'DONE',
      createdAt: t.createdAt,
      reminderDismissed: dismissedIds.has(t.id),
    } as Task));
  }, [backendTasksData, dismissedIds]);

  // Bu oturumda hangi görevler için uyarı gösterildi
  const [dueShown, setDueShown] = useState<Record<string, number>>({});

  // ══════════ Sürekli Hatırlatma Sistemi ══════════
  // Bugün veya geçmiş tarihli, tamamlanmamış görevler için:
  //   1) Tarayıcı bildirimi (permission verdiyse)
  //   2) Sayfada kırmızı pulse banner (dismiss edilene kadar)
  //   3) Her 10 dakikada bir tekrar tetikleme
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Tamamlanmamış, bugün/geçmiş dueDate'li, bu oturumda dismiss edilmemiş görevler
  const dueTasks = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return tasks.filter((t) => {
      if (t.done) return false;
      const d = new Date(t.dueDate); d.setHours(0,0,0,0);
      if (d > today) return false; // gelecek
      if (t.reminderDismissed) return false;
      return true;
    });
  }, [tasks]);

  // Her 10 dakikada tarayıcı bildirimini yenile
  useEffect(() => {
    if (dueTasks.length === 0) return;
    const tick = () => {
      const now = Date.now();
      const TEN_MIN = 10 * 60 * 1000;
      for (const t of dueTasks) {
        const last = dueShown[t.id] || 0;
        if (now - last >= TEN_MIN) {
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification('⚠ Hatırlatma — ' + t.title, {
                body: t.note ? `${t.note} · Vade: ${new Date(t.dueDate).toLocaleDateString('tr-TR')}` : `Vade: ${new Date(t.dueDate).toLocaleDateString('tr-TR')}`,
                tag: `moren-task-${t.id}`,
                requireInteraction: true,
              });
            } catch {}
          }
          setDueShown((prev) => ({ ...prev, [t.id]: now }));
        }
      }
    };
    tick(); // hemen tetikle
    const iv = setInterval(tick, 60 * 1000); // her dakika kontrol
    return () => clearInterval(iv);
  }, [dueTasks, dueShown]);

  const dismissReminder = (id: string) => {
    // v1.36.74: Backend'e dokunmadan oturum-içi dismiss — sessionStorage'da sakla
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try { sessionStorage.setItem('moren-dismissed-task-ids', JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const sorted = [...tasks].sort((a, b) => a.done !== b.done ? (a.done ? 1 : -1) : new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const statMap: Record<string, boolean> = {};
  for (const s of agentStatusList) if (s?.agent) statMap[String(s.agent).toUpperCase()] = !!s.running;
  const running = (k: string) => statMap[k.toUpperCase()] ?? false;
  const stFor = (k: string) => agentStatusList.find((s: any) => String(s.agent || '').toUpperCase().includes(k)) || {};
  const mEv = agentEventList.filter((e: any) => String(e.agent || '').toUpperCase().includes('MIHSAP'));
  const mOK = mEv.filter((e: any) => ['OK','KAYDET','BASARILI','ONAYLANDI','ONAY','DONE'].includes(String(e.status || '').toUpperCase())).length;
  const mRate = mEv.length ? Math.round((mOK / mEv.length) * 100) : null;
  const todayCount: number = agentStats?.todayCount ?? agentEventList.length ?? 0;
  const successRate: number | null = agentStats?.successRate ?? null;
  const unread: number = typeof unreadRaw === 'number' ? unreadRaw : (unreadRaw?.count ?? 0);
  const todayTaskCount = sorted.filter((t) => !t.done && new Date(t.dueDate).toDateString() === new Date().toDateString()).length;

  // Stat card hesaplamaları
  const tx = Array.isArray(taxpayers) ? taxpayers : Array.isArray((taxpayers as any)?.items) ? (taxpayers as any).items : [];
  const activeCount = tx.filter((t: any) => (t?.isActive ?? t?.aktif ?? t?.active ?? true) !== false && !t?.deletedAt && !t?.pasif).length;
  const passiveCount = tx.length - activeCount;
  const totalTx = tx.length;
  const workflowCounts = workflowData?.counts || EMPTY_WORKFLOW_COUNTS;
  const workflowTotal = workflowData?.total ?? 0;

  // Bugünün ajan olay kırılımı
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayEvents = agentEventList.filter((e: any) => {
    const r = e.ts || e.createdAt || e.timestamp || e.date;
    return r && new Date(r) >= todayStart;
  });
  const tKayit = todayEvents.filter((e: any) => ['OK','KAYDET','SUCCESS','BASARILI','ONAYLANDI','ONAY','DONE','TAMAMLANDI'].includes(String(e.status || '').toUpperCase())).length;
  const tAtla = todayEvents.filter((e: any) => ['ATLA','SKIP','ATLANDI'].includes(String(e.status || '').toUpperCase())).length;
  const tHata = todayEvents.filter((e: any) => ['HATA','ERROR','FAIL','FAILED','HATALI'].includes(String(e.status || '').toUpperCase())).length;

  // Bekleyen görev trendi
  const pendingTasks = sorted.filter((t) => !t.done);
  const nextDueTask = pendingTasks[0];
  const nextDueStr = nextDueTask ? new Date(nextDueTask.dueDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) : null;

  // Kritik uyarı: hatalar + okunmamış bildirim
  const criticalCount = tHata + (unread > 0 ? unread : 0);

  // Mükellef durumu donut segmentleri — Elit Boutique altın tonları (4 segment × 4 ton)
  const donutSegments = useMemo(() => {
    if (tx.length === 0) return [
      { label: 'Tamamlanan', value: 0, color: ACCENT_TONES.gold.color },
      { label: 'Devam Eden', value: 0, color: ACCENT_TONES.champagne.color },
      { label: 'Bekleyen', value: 0, color: ACCENT_TONES.bronze.color },
      { label: 'Başlanmadı', value: 0, color: 'rgba(255,255,255,0.08)' },
    ];
    const byStatus: Record<string, number> = {};
    for (const t of tx) {
      const s = String(t?.durum || t?.status || '').toLowerCase();
      if (s) byStatus[s] = (byStatus[s] || 0) + 1;
    }
    if (Object.keys(byStatus).length > 0) {
      return [
        { label: 'Tamamlanan', value: (byStatus['tamamlanan'] || byStatus['tamamlandi'] || byStatus['completed'] || 0), color: ACCENT_TONES.gold.color },
        { label: 'Devam Eden', value: (byStatus['devam_eden'] || byStatus['devam'] || byStatus['in_progress'] || byStatus['aktif'] || activeCount), color: ACCENT_TONES.champagne.color },
        { label: 'Bekleyen', value: (byStatus['bekleyen'] || byStatus['pending'] || 0), color: ACCENT_TONES.bronze.color },
        { label: 'Başlanmadı', value: (byStatus['baslanmadi'] || byStatus['yeni'] || byStatus['new'] || passiveCount), color: ACCENT_TONES.copper.color },
      ];
    }
    return [
      { label: 'Aktif', value: activeCount, color: ACCENT_TONES.gold.color },
      { label: 'Pasif', value: passiveCount, color: ACCENT_TONES.bronze.color },
    ];
  }, [tx, activeCount, passiveCount]);

  return (
    <div data-dashboard-root className="max-w-full overflow-x-hidden">
      <section className="lg:hidden">
        <MobilePortalHome
          activeCount={activeCount}
          totalTx={totalTx}
          pendingTasks={pendingTasks.length}
          todayTaskCount={todayTaskCount}
          activeWorkload={aktifIsYuku}
          unread={unread}
          workflowCounts={workflowCounts}
          workflowTotal={workflowTotal}
          nextDueStr={nextDueStr}
        />
      </section>

      <div className="hidden space-y-4 max-w-none pr-3 lg:block xl:pr-5">
      {/* Hatırlatma bannerı — bugün veya geçmiş tarihli tamamlanmamış görevler için sürekli uyarı.
          v1.36.74: scale-siz pulse — banner ekrandan taşmıyor, sadece glow nefes alıyor. */}
      {dueTasks.length > 0 && (
        <div
          data-dashboard-reminder className="rounded-2xl px-5 py-4 flex items-center gap-4 flex-wrap"
          style={portalStyle({
            background: 'linear-gradient(135deg, rgba(244,63,94,0.12), rgba(239,68,68,0.08))',
            border: '1px solid rgba(244,63,94,0.4)',
            animation: 'moren-banner-pulse 2.8s ease-in-out infinite',
          })}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={portalStyle({ background: 'rgba(244,63,94,0.2)', border: '1px solid rgba(244,63,94,0.5)' })}>
            <AlertTriangle size={18} style={portalStyle({ color: '#f43f5e' })} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-bold mb-0.5" style={portalStyle({ color: '#fafaf9' })}>
              {dueTasks.length} hatırlatma zamanı geldi
            </div>
            <div className="text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.7)' })}>
              {dueTasks.slice(0, 3).map((t) => t.title).join(' · ')}
              {dueTasks.length > 3 && ` · +${dueTasks.length - 3} daha`}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {dueTasks.length === 1 && (
              <button
                onClick={() => dismissReminder(dueTasks[0].id)}
                className="text-[11.5px] font-medium px-3 py-1.5 rounded-md transition"
                style={portalStyle({ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(250,250,249,0.85)' })}
              >
                Anladım
              </button>
            )}
            {dueTasks.length > 1 && (
              <button
                onClick={() => dueTasks.forEach((t) => dismissReminder(t.id))}
                className="text-[11.5px] font-medium px-3 py-1.5 rounded-md transition"
                style={portalStyle({ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(250,250,249,0.85)' })}
              >
                Hepsini anladım
              </button>
            )}
          </div>
        </div>
      )}

      <h1 className="sr-only">Ofis Paneli</h1>

      {/* Sayaç kartları */}
      <div data-dashboard-counters className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          title="Aktif Mükellef"
          value={activeCount || totalTx}
          icon={Users}
          href="/panel/mukellef-listesi"
          sub={workflowTotal > 0 ? `${workflowTotal} bu ay iş akışında` : (passiveCount > 0 ? `${passiveCount} pasif` : 'Liste güncel')}
          accent="sage"
        />
        <StatCard
          title="Bekleyen Görev"
          value={pendingTasks.length}
          icon={FileText}
          href="/panel/gorevler"
          sub={todayTaskCount > 0 ? `Bugün: ${todayTaskCount}` : nextDueStr ? `Son tarih: ${nextDueStr}` : 'Bugün yok'}
          trend={pendingTasks.length > 0 ? `${pendingTasks.length} kaldı` : undefined}
          trendKind={pendingTasks.length > 0 ? 'down' : 'flat'}
          accent="sky"
        />
        {/* v1.36.80: "Aktif İş Yükü" — gerçek workflow queue count'u
            (İŞLENECEK + KONTROL + BEYAN aşamalarındaki mükellef sayısı toplamı) */}
        <StatCard
          title="Aktif İş Yükü"
          value={aktifIsYuku}
          icon={Bot}
          href="/panel/is-yuku"
          sub={
            workflowData?.counts
              ? `${workflowData.counts.kontrol} kontrol · ${workflowData.counts.beyanname} beyan`
              : 'Sıradaki yapılacak işleri gör'
          }
          accent="champagne"
        />
        {/* e-Tebligat — gece sorgusuyla gelen, portalda GÖRÜNTÜLENMEMİŞ tebligatlar (viewedAt boş; e-Tebligat Kontrol'deki süzgeçle aynı) */}
        <StatCard
          title="E-Tebligat"
          value={tebligat.okunmamis}
          icon={Mailbox}
          href="/panel/ajanlar/tebligat?durum=goruntulenmemis"
          sub={
            tebligat.okunmamis === 0
              ? 'Görüntülenmemiş tebligat yok'
              : tebligat.yeni > 0
                ? `Bu gece ${tebligat.yeni} yeni · ${tebligat.mukellef} mükellef`
                : (tebligat.suresiIcinde ?? 0) > 0
                  ? `${tebligat.suresiIcinde} tebliğ süresi içinde · ${tebligat.mukellef} mükellef`
                  : `${tebligat.mukellef} mükellefte görüntülenmemiş`
          }
          trend={tebligat.yeni > 0 ? `${tebligat.yeni} yeni` : undefined}
          trendKind={tebligat.yeni > 0 ? 'down' : 'flat'}
          accent="teal"
        />
        {/* Kritik Uyarı — tıklanabilir kart, detayı altta açılır panel */}
        <KritikUyariStatCard />
      </div>

      <OfisPanoramasi {...panoramaPeriod} />

      <ToplubeyannameTable {...panoramaPeriod} />

      <IsAkisiHatti counts={workflowCounts} total={workflowTotal} activeCount={activeCount || totalTx} />

      <MaliTakvim />
      </div>
    </div>
  );
}
