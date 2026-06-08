'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Users,
  FileText,
  AlertTriangle,
  ArrowRight,
  Receipt,
  FileCheck,
  Plus,
  Bot,
  FileInput,
  CheckCircle2,
  X as IconX,
  Download,
  FileCheck2,
  Search as SearchIcon,
  Settings,
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
import type { OzetRow, BeyanTipi, DonemTuru } from '@/lib/beyanname-takip';
import Link from 'next/link';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMe } from '@/hooks/useAuth';
import { KritikUyariStatCard } from '@/components/dashboard/KritikUyariStatCard';
import { BrifingKart } from '@/components/dashboard/BrifingKart';
import { BuHaftaTakvim } from '@/components/dashboard/BuHaftaTakvim';

const GOLD = '#d4b876';
const TRACK_BLUE = '#7dd3fc';
const TRACK_BLUE_SOFT = '#93c5fd';
const BEYAN_TONE = {
  accent: '#d8bd86',
  accentSoft: '#f2d8a1',
  title: '#f8f4ec',
  muted: 'rgba(244,239,229,0.58)',
  header: 'rgba(244,239,229,0.52)',
  approved: '#3ddc84',
  waiting: '#f2c46d',
  error: '#ff7a8c',
  remaining: '#f0a6b6',
  status: '#8cc8ff',
  border: 'rgba(216,189,134,0.20)',
  borderSoft: 'rgba(244,239,229,0.08)',
  bg: 'rgba(216,189,134,0.08)',
  bgSoft: 'rgba(244,239,229,0.035)',
  rowAlt: 'rgba(255,255,255,0.018)',
  tableBg: 'rgba(8,8,7,0.36)',
  headBg: 'rgba(244,239,229,0.035)',
};

function displayUserName(user: any): string | undefined {
  const first = String(user?.firstName || '').trim();
  if (first && !/^admin$/i.test(first)) return first.replace(/\b(Bey|Hanım|Hanim|Bay|Bayan)\b/gi, '').trim().split(/\s+/)[0] || undefined;

  const full = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  const candidate = full || user?.fullName || user?.name || user?.displayName;
  if (!candidate || /^admin$/i.test(String(candidate).trim())) return undefined;
  return String(candidate).replace(/\b(Bey|Hanım|Hanim|Bay|Bayan)\b/gi, '').trim().split(/\s+/)[0] || undefined;
}

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
type StatAccent = 'gold' | 'champagne' | 'bronze' | 'copper' | 'burgundy' | 'sage' | 'sky' | 'amber';
const ACCENT_TONES: Record<StatAccent, { color: string; bg: string; border: string; hoverBg: string; hoverBorder: string }> = {
  gold:      { color: '#d4b876', bg: 'rgba(212,184,118,0.12)', border: 'rgba(212,184,118,0.28)', hoverBg: 'rgba(212,184,118,0.06)', hoverBorder: 'rgba(212,184,118,0.32)' },
  champagne: { color: '#e8d6a0', bg: 'rgba(232,214,160,0.14)', border: 'rgba(232,214,160,0.32)', hoverBg: 'rgba(232,214,160,0.06)', hoverBorder: 'rgba(232,214,160,0.36)' },
  bronze:    { color: '#c0a079', bg: 'rgba(192,160,121,0.14)', border: 'rgba(192,160,121,0.32)', hoverBg: 'rgba(192,160,121,0.06)', hoverBorder: 'rgba(192,160,121,0.36)' },
  copper:    { color: '#c98896', bg: 'rgba(201,136,150,0.12)', border: 'rgba(201,136,150,0.30)', hoverBg: 'rgba(201,136,150,0.07)', hoverBorder: 'rgba(201,136,150,0.36)' },
  burgundy:  { color: '#c98896', bg: 'rgba(201,136,150,0.14)', border: 'rgba(201,136,150,0.34)', hoverBg: 'rgba(201,136,150,0.08)', hoverBorder: 'rgba(201,136,150,0.38)' },
  sage:      { color: '#9cc8a6', bg: 'rgba(92,150,112,0.12)', border: 'rgba(156,200,166,0.25)', hoverBg: 'rgba(92,150,112,0.06)', hoverBorder: 'rgba(156,200,166,0.32)' },
  sky:       { color: '#9ec5e8', bg: 'rgba(96,165,250,0.11)', border: 'rgba(158,197,232,0.24)', hoverBg: 'rgba(96,165,250,0.06)', hoverBorder: 'rgba(158,197,232,0.30)' },
  amber:     { color: '#8bd3dd', bg: 'rgba(125,211,252,0.10)', border: 'rgba(125,211,252,0.23)', hoverBg: 'rgba(125,211,252,0.06)', hoverBorder: 'rgba(125,211,252,0.30)' },
};

function StatCard({ title, value, icon: Icon, href, sub, trend, trendKind, accent = 'gold' }: { title: string; value: number | string; icon: any; href?: string; sub?: string; trend?: string; trendKind?: 'up'|'down'|'flat'; accent?: StatAccent }) {
  const t = ACCENT_TONES[accent];
  const c = (
    <div className="group relative overflow-hidden rounded-xl p-3 transition-all duration-300" style={{ background: `linear-gradient(135deg, ${t.bg}, rgba(255,255,255,0.012))`, border: `1px solid ${t.border}`, cursor: href ? 'pointer' : 'default' }}
      onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = t.hoverBg; el.style.borderColor = t.hoverBorder; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.24)'; }}
      onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = `linear-gradient(135deg, ${t.bg}, rgba(255,255,255,0.012))`; el.style.borderColor = t.border; el.style.transform = 'translateY(0)'; el.style.boxShadow = 'none'; }}>
      {/* Üstten ince altın hairline (kendi tonunda, hover'da belirginleşir) */}
      <span className="absolute top-0 left-4 right-4 h-px transition-opacity duration-300 group-hover:opacity-100" style={{ background: `linear-gradient(90deg, transparent, ${t.color}, transparent)`, opacity: 0.35 }} />
      <div className="mb-2 flex items-center justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'rgba(15,13,11,0.28)', border: `1px solid ${t.border}`, color: t.color }}><Icon size={15} /></div>
        {trend && <span className="text-[10px] font-bold px-2.5 py-[3px] rounded-md" style={{ background: trendKind === 'up' ? 'rgba(34,197,94,0.1)' : trendKind === 'down' ? 'rgba(244,63,94,0.1)' : 'rgba(255,255,255,0.04)', color: trendKind === 'up' ? '#22c55e' : trendKind === 'down' ? '#f43f5e' : 'rgba(250,250,249,0.35)' }}>{trend}</span>}
      </div>
      <p className="text-[10.5px] uppercase font-bold tracking-[.11em]" style={{ color: 'rgba(250,250,249,0.44)' }}>{title}</p>
      <p className="mt-1 leading-none tabular-nums" style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 26, fontWeight: 900, letterSpacing: 0, color: t.color }}>{value ?? 0}</p>
      {sub && <p className="text-[10.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.36)' }}>{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{c}</Link> : c;
}

type WorkflowCounts = { evrak: number; islenme: number; kontrol: number; beyanname: number; tamam: number };

const EMPTY_WORKFLOW_COUNTS: WorkflowCounts = { evrak: 0, islenme: 0, kontrol: 0, beyanname: 0, tamam: 0 };

const WORKFLOW_STEPS: Array<{
  key: keyof WorkflowCounts;
  label: string;
  sub: string;
  href: string;
  icon: any;
  color: string;
  bg: string;
  border: string;
}> = [
  { key: 'evrak', label: 'Evrak Bekliyor', sub: 'Mükelleften gelecek', href: '/panel/is-yuku', icon: FileInput, color: '#d8caa9', bg: 'rgba(255,255,255,0.022)', border: 'rgba(216,189,134,0.15)' },
  { key: 'islenme', label: 'Fatura İşleme', sub: 'Belge merkezi', href: '/panel/fatura-isleme', icon: Receipt, color: '#d2b06f', bg: 'rgba(255,255,255,0.020)', border: 'rgba(210,176,111,0.16)' },
  { key: 'kontrol', label: 'KDV Kontrol', sub: 'Kontrol bekliyor', href: '/panel/kdv-kontrol', icon: FileCheck, color: '#8db6c6', bg: 'rgba(255,255,255,0.020)', border: 'rgba(141,182,198,0.16)' },
  { key: 'beyanname', label: 'Beyanname', sub: 'Hazırlanacak', href: '/panel/beyannameler', icon: FileText, color: '#cda2ad', bg: 'rgba(255,255,255,0.020)', border: 'rgba(205,162,173,0.15)' },
  { key: 'tamam', label: 'Tamamlandı', sub: 'Bu ay kapandı', href: '/panel/is-yuku', icon: CheckCircle2, color: '#86c7a0', bg: 'rgba(255,255,255,0.020)', border: 'rgba(134,199,160,0.16)' },
];

function WorkflowOverview({ counts, total, activeCount }: { counts?: WorkflowCounts; total: number; activeCount: number }) {
  const c = counts || EMPTY_WORKFLOW_COUNTS;
  const scopedTotal = total || Object.values(c).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const activeWork = c.islenme + c.kontrol + c.beyanname;
  const completed = c.tamam;
  const outside = Math.max(activeCount - scopedTotal, 0);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'radial-gradient(circle at 8% 0%, rgba(125,211,252,0.10), transparent 30%), radial-gradient(circle at 92% 14%, rgba(143,215,189,0.07), transparent 28%), linear-gradient(180deg, rgba(8,15,16,0.96), rgba(5,9,10,0.92))',
        border: '1px solid rgba(125,211,252,0.14)',
        boxShadow: '0 14px 34px rgba(0,0,0,0.20), inset 0 1px 0 rgba(180,230,240,0.035)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid rgba(125,211,252,0.10)' }}>
        <div className="flex items-center gap-3">
          <span className="w-[3px] h-8 rounded-sm" style={{ background: '#8bd3dd' }} />
          <div>
            <h3 className="text-[17px] font-semibold leading-tight" style={{ color: '#eefafa' }}>Bu Ay İş Akışı</h3>
            <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.50)' }}>
              {scopedTotal} mükellef akışta · {activeCount} aktif mükellef
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11.5px] font-semibold px-3 py-1 rounded-md" style={{ background: 'rgba(125,211,252,0.075)', border: '1px solid rgba(125,211,252,0.18)', color: '#8bd3dd' }}>
            {activeWork} aktif
          </span>
          <span className="text-[11.5px] font-semibold px-3 py-1 rounded-md" style={{ background: 'rgba(134,199,160,0.075)', border: '1px solid rgba(134,199,160,0.16)', color: '#86c7a0' }}>
            {completed} tamam
          </span>
          {outside > 0 && (
            <span className="text-[11.5px] font-semibold px-3 py-1 rounded-md" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(250,250,249,0.56)' }}>
              {outside} dışında
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {WORKFLOW_STEPS.map((step) => {
            const value = c[step.key] || 0;
            const pct = scopedTotal > 0 ? Math.round((value / scopedTotal) * 100) : 0;
            const Icon = step.icon;
            return (
              <Link
                key={step.key}
                href={step.href}
                className="group min-h-[96px] rounded-lg px-3.5 py-3 transition-all"
                style={{
                  background: `linear-gradient(180deg, ${step.bg}, rgba(255,255,255,0.012))`,
                  border: `1px solid ${step.border}`,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.025)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.background = 'rgba(255,255,255,0.032)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.background = `linear-gradient(180deg, ${step.bg}, rgba(255,255,255,0.012))`; }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(5,7,7,0.24)', border: `1px solid ${step.border}`, color: step.color }}>
                    <Icon size={16} />
                  </div>
                  <span className="rounded-md px-2 py-0.5 text-[10.5px] font-bold tabular-nums" style={{ color: step.color, background: 'rgba(0,0,0,0.14)', border: `1px solid ${step.border}` }}>
                    %{pct}
                  </span>
                </div>
                <div className="mt-3">
                  <div className="text-[25px] leading-none tabular-nums font-bold" style={{ color: step.color, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', letterSpacing: 0 }}>{value}</div>
                  <div className="mt-1 text-[12.5px] font-semibold truncate" style={{ color: '#fafaf9' }}>{step.label}</div>
                  <div className="mt-0.5 text-[10.5px] truncate" style={{ color: 'rgba(250,250,249,0.46)' }}>{step.sub}</div>
                </div>
                <div className="mt-3 h-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: step.color }} />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DashboardSectionBridge({
  from = 'İş Akışı',
  to = 'Son Tarihler',
  tone = 'gold',
}: {
  from?: string;
  to?: string;
  tone?: 'mint' | 'gold' | 'rose';
}) {
  const tones = {
    mint: {
      accent: '#8fd7bd',
      accent2: '#d8bd86',
      bg: 'rgba(143,215,189,0.040)',
      border: 'rgba(143,215,189,0.15)',
      text: '#bfe9dc',
    },
    gold: {
      accent: '#d8bd86',
      accent2: '#8cc8ff',
      bg: 'rgba(216,189,134,0.038)',
      border: 'rgba(216,189,134,0.15)',
      text: '#d8c38f',
    },
    rose: {
      accent: '#f0a6b6',
      accent2: '#d8bd86',
      bg: 'rgba(240,166,182,0.038)',
      border: 'rgba(240,166,182,0.15)',
      text: '#e8b8c1',
    },
  }[tone];
  return (
    <div className="relative my-12 flex items-center gap-4 px-2 sm:px-6">
      <div className="h-[2px] flex-1 rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${tones.accent}88, ${tones.accent2}55)` }} />
        <div
          className="flex min-w-0 flex-wrap items-center justify-center gap-2 rounded-2xl px-3 py-2 sm:flex-nowrap"
          style={{
            background: 'rgba(3,3,3,0.92)',
            border: `1px solid ${tones.border}`,
            boxShadow: `0 10px 24px rgba(0,0,0,0.26), 0 0 0 4px rgba(0,0,0,0.18)`,
          }}
        >
          <span className="rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-[.14em]" style={{ background: `${tones.bg}`, color: tones.text, border: `1px solid ${tones.border}` }}>
            {from}
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.035)', color: tones.accent, border: `1px solid ${tones.border}` }}>
            <ArrowRight size={14} />
          </span>
          <span className="rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-[.14em]" style={{ background: `${tones.bg}`, color: tones.text, border: `1px solid ${tones.border}` }}>
            {to}
          </span>
        </div>
      <div className="h-[2px] flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${tones.accent2}55, ${tones.accent}88, transparent)` }} />
    </div>
  );
}

function AgentMini({ href, icon: Icon, name, stat, running }: { href: string; icon: any; name: string; stat: string; running: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-3 p-3 rounded-xl transition-all duration-300" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
      onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(184,160,111,0.05)'; el.style.borderColor = 'rgba(184,160,111,0.22)'; el.style.transform = 'translateY(-3px)'; }}
      onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.02)'; el.style.borderColor = 'rgba(255,255,255,0.05)'; el.style.transform = 'translateY(0)'; }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD }}><Icon size={16} /></div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>{name}</div>
        <div className="text-[10.5px] mt-0.5" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.4)' }}>{stat}</div>
      </div>
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: running ? '#22c55e' : 'rgba(255,255,255,0.18)', boxShadow: running ? '0 0 8px rgba(34,197,94,0.6)' : 'none', animation: running ? 'moren-pulse 2s infinite' : 'none' }} />
    </Link>
  );
}

// ══════════════════════════════════════════════════════════
// TOPLU BEYANNAME — SGK VE E-DEFTER KONTROL (Hattat-stili)
// Dönem seçici + beyanname/SGK/E-defter tabloları progress bar ile
// ══════════════════════════════════════════════════════════
type BeyanFilter = 'toplam' | 'onaylanan' | 'bekleyen' | 'hatali' | 'kalan';
type ModalState = { beyanTipi: BeyanTipi; filter: BeyanFilter; donem: string; donemTuru: DonemTuru } | null;

// Dönem anahtarını Türkçe etikete çevirir (iç anahtar korunur, yalnız gösterim):
//   "2026-05" → "Mayıs 2026" · "2026-Q1" → "2026 1. Dönem (Oca-Mar)" · "2026-YIL" → "2026 Yıllık"
const BEYAN_AYLAR_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const BEYAN_CEYREK_AYLAR = ['Oca-Mar', 'Nis-Haz', 'Tem-Eyl', 'Eki-Ara'];
function donemEtiket(key?: string | null): string {
  if (!key) return '-';
  const ay = key.match(/^(\d{4})-(\d{2})$/);
  if (ay) return `${BEYAN_AYLAR_TR[parseInt(ay[2], 10) - 1] || ay[2]} ${ay[1]}`;
  const q = key.match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${q[1]} ${q[2]}. Dönem (${BEYAN_CEYREK_AYLAR[parseInt(q[2], 10) - 1]})`;
  const yil = key.match(/^(\d{4})-YIL$/i);
  if (yil) return `${yil[1]} Yıllık`;
  return key;
}

function ToplubeyannameTable() {
  return <ToplubeyannamePanel />;
}

function ToplubeyannamePanel() {
  const [donem, setDonem] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [donemTuru, setDonemTuru] = useState<DonemTuru>('VERILME');
  const [modal, setModal] = useState<ModalState>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['beyanname-ozet', donem, donemTuru],
    queryFn: () => beyannameTakipApi.listOzet(donem, donemTuru),
    staleTime: 5 * 60 * 1000,
  });

  const rows = data?.rows || [];
  const openModal = (beyanTipi: BeyanTipi, filter: BeyanFilter) =>
    setModal({ beyanTipi, filter, donem: data?.donem || donem, donemTuru });

  const beyanTipleri: BeyanTipi[] = [
    'KURUMLAR', 'GELIR',
    'KDV1', 'KDV2', 'KDV4', 'KDV9015',
    'DAMGA', 'POSET',
    'MUHSGK', 'MUHSGK2',
    'GGECICI', 'KGECICI',
    'TURIZM', 'KONAKLAMA', 'OIV', 'GMSI',
    'OTV1', 'OTV3A', 'OTV3B', 'OTV4',
  ];
  const beyanRows = rows.filter((r) => beyanTipleri.includes(r.beyanTipi) && r.toplam > 0);
  const bildirgeRow = rows.find((r) => r.beyanTipi === 'BILDIRGE' && r.toplam > 0);
  const edefterRow = rows.find((r) => r.beyanTipi === 'EDEFTER' && r.toplam > 0);
  const yardimciRows = [bildirgeRow, edefterRow].filter((r): r is OzetRow => Boolean(r));
  const activeRows = rows.filter((r) => r.toplam > 0);
  const totals = activeRows.reduce(
    (acc, row) => ({
      toplam: acc.toplam + row.toplam,
      onaylanan: acc.onaylanan + row.onaylanan,
      bekleyen: acc.bekleyen + row.bekleyen,
      hatali: acc.hatali + row.hatali,
      kalan: acc.kalan + row.kalan,
    }),
    { toplam: 0, onaylanan: 0, bekleyen: 0, hatali: 0, kalan: 0 },
  );
  const totalYuzde = totals.toplam > 0 ? Math.round((totals.onaylanan / totals.toplam) * 100) : 0;
  const selectedDonem = data?.donem || donem;
  const modeLabel = donemTuru === 'VERILME' ? 'Verilme dönemi' : 'Vergi dönemi';
  const modeNote = donemTuru === 'VERILME'
    ? 'Seçilen ayda verilmesi gerekenler'
    : 'Seçilen vergi dönemine ait olanlar';

  const donemOptions = useMemo(() => {
    const now = new Date();
    const arr: { value: string; label: string }[] = [];
    const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      arr.push({ value: v, label: `${d.getFullYear()}/${aylar[d.getMonth()]}` });
    }
    return arr;
  }, []);

  return (
    <div>
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BEYAN_TONE.border}` }}>
        <div className="grid gap-3 xl:grid-cols-[minmax(300px,1fr)_auto] xl:items-center">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: BEYAN_TONE.bg, border: `1px solid ${BEYAN_TONE.border}`, color: BEYAN_TONE.accentSoft }}>
              <FileCheck2 size={15} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-[16px] font-semibold leading-tight" style={{ color: BEYAN_TONE.title }}>Beyanname Durum Takibi</h3>
              <p className="mt-0.5 truncate text-[11.5px]" style={{ color: BEYAN_TONE.muted }}>{modeLabel} - {donemEtiket(selectedDonem)} - {modeNote}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
            <div className="inline-flex rounded-lg p-0.5" style={{ background: 'rgba(244,239,229,0.03)', border: `1px solid ${BEYAN_TONE.borderSoft}` }}>
              {([
                ['VERILME', 'Verilme dönemi'],
                ['VERGI', 'Vergi dönemi'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDonemTuru(value)}
                  className="rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition"
                  style={{
                    background: donemTuru === value ? BEYAN_TONE.bg : 'transparent',
                    color: donemTuru === value ? BEYAN_TONE.accentSoft : BEYAN_TONE.muted,
                    border: donemTuru === value ? `1px solid ${BEYAN_TONE.border}` : '1px solid transparent',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              value={donem}
              onChange={(e) => setDonem(e.target.value)}
              className="h-9 w-[150px] cursor-pointer rounded-lg px-3 text-[12.5px] font-semibold outline-none"
              style={{ background: 'rgba(244,239,229,0.035)', border: `1px solid ${BEYAN_TONE.border}`, color: BEYAN_TONE.title }}
            >
              {donemOptions.map((o) => (
                <option key={o.value} value={o.value} style={{ background: '#1a1814' }}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => refetch()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-all"
              style={{ background: 'rgba(140,200,255,0.09)', border: '1px solid rgba(140,200,255,0.22)', color: BEYAN_TONE.status }}
            >
              <SearchIcon size={13} /> Sorgula
            </button>
            <Link
              href="/panel/ayarlar/beyanname-takip"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-all"
              style={{ background: 'rgba(244,239,229,0.025)', border: `1px solid ${BEYAN_TONE.borderSoft}`, color: BEYAN_TONE.muted }}
            >
              <Settings size={13} /> Ayarlar
            </Link>
          </div>
        </div>

        <div className="hidden">
          <BeyanMetric label="Toplam" value={totals.toplam} color="#fafaf9" sub={`${activeRows.length} takip kalemi`} />
          <BeyanMetric label="Onaylanan" value={totals.onaylanan} color={BEYAN_TONE.approved} />
          <BeyanMetric label="Bekleyen" value={totals.bekleyen} color={BEYAN_TONE.waiting} />
          <BeyanMetric label="Hatalı" value={totals.hatali} color={BEYAN_TONE.error} />
          <BeyanMetric label="Kalan" value={totals.kalan} color={totals.kalan > 0 ? BEYAN_TONE.remaining : BEYAN_TONE.approved} sub={`%${totalYuzde} tamam`} />
        </div>
      </div>

      {isLoading && (
        <div className="px-5 py-12 text-center text-[13px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
          Yükleniyor...
        </div>
      )}

      {!isLoading && beyanRows.length === 0 && !bildirgeRow && !edefterRow && (
        <div className="px-5 py-10 text-center">
          <p className="text-[12.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Bu dönem için takip edilecek beyanname bulunmadı.
          </p>
          <p className="text-[11px] mt-1.5" style={{ color: 'rgba(250,250,249,0.3)' }}>
            Mükellef kartlarındaki beyanname dönemleri ve türleri kontrol edilmeli.
          </p>
        </div>
      )}

      {beyanRows.length > 0 && (
        <BeyanCompactTable title="Beyannameler" rows={beyanRows} donem={selectedDonem} onNumberClick={openModal} />
      )}

      {yardimciRows.length > 0 && (
        <YardimciBeyanGrid rows={yardimciRows} donem={selectedDonem} onNumberClick={openModal} />
      )}

      {modal && <BeyanDetayModal state={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function BeyanCompactTable({
  title,
  rows,
  donem,
  onNumberClick,
  onayLabel = 'Onaylanan',
  compact,
}: {
  title: string;
  rows: OzetRow[];
  donem: string;
  onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void;
  onayLabel?: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'px-5 pb-4' : 'px-5 py-4'}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: BEYAN_TONE.accentSoft }}>
          {title}
        </div>
        <div className="text-[11px] font-semibold tabular-nums" style={{ color: BEYAN_TONE.muted, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
          {donemEtiket(donem)}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${BEYAN_TONE.borderSoft}`, background: BEYAN_TONE.tableBg }}>
        <table className="w-full min-w-[760px] border-collapse text-[12px]" style={{ color: BEYAN_TONE.title }}>
          <thead>
            <tr style={{ background: BEYAN_TONE.headBg, borderBottom: `1px solid ${BEYAN_TONE.borderSoft}` }}>
              <BeyanHeaderCell align="left">Beyanname</BeyanHeaderCell>
              <BeyanHeaderCell>Takip</BeyanHeaderCell>
              <BeyanHeaderCell>{onayLabel}</BeyanHeaderCell>
              <BeyanHeaderCell>Bekleyen</BeyanHeaderCell>
              <BeyanHeaderCell>Hatalı</BeyanHeaderCell>
              <BeyanHeaderCell>Kalan</BeyanHeaderCell>
              <BeyanHeaderCell align="left">Durum</BeyanHeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <BeyanCompactRow key={row.beyanTipi} row={row} onNumberClick={onNumberClick} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function YardimciBeyanGrid({
  rows,
  donem,
  onNumberClick,
}: {
  rows: OzetRow[];
  donem: string;
  onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void;
}) {
  return (
    <div className="px-5 pb-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: BEYAN_TONE.accentSoft }}>
          Bildirge ve E-Defter
        </div>
        <div className="text-[11px] font-semibold tabular-nums" style={{ color: BEYAN_TONE.muted, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
          {donemEtiket(donem)}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <YardimciBeyanCard key={row.beyanTipi} row={row} donem={donem} onNumberClick={onNumberClick} />
        ))}
      </div>
    </div>
  );
}

function YardimciBeyanCard({
  row,
  donem,
  onNumberClick,
}: {
  row: OzetRow;
  donem: string;
  onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void;
}) {
  const label = BEYAN_ETIKETLER[row.beyanTipi];
  const pct = Math.max(0, Math.min(100, row.yuzde));
  const done = row.kalan <= 0 && row.hatali <= 0;
  const barColor = row.hatali > 0 ? BEYAN_TONE.error : done ? BEYAN_TONE.approved : BEYAN_TONE.status;
  const statusLabel = row.hatali > 0 ? 'Hata var' : done ? 'Tamam' : 'Devam ediyor';
  const onayText = row.beyanTipi === 'EDEFTER' ? 'Verilen' : 'Onaylanan';

  return (
    <div className="overflow-hidden rounded-xl" style={{ background: BEYAN_TONE.rowAlt, border: `1px solid ${BEYAN_TONE.borderSoft}` }}>
      <div className="grid grid-cols-[minmax(140px,1fr)_82px_92px_82px_minmax(150px,1fr)] items-center gap-0 px-3 py-2">
        <button
          type="button"
          onClick={() => onNumberClick(row.beyanTipi, 'toplam')}
          className="truncate text-left text-[13px] font-bold transition hover:underline decoration-dotted underline-offset-4"
          style={{ color: BEYAN_TONE.title }}
          title="Mükellef listesini göster"
        >
          {label} <span className="font-semibold opacity-55">({donemEtiket(row.vergiDonem)})</span>
        </button>
        <YardimciBeyanNumber label="Toplam" value={row.toplam} color="#fafaf9" onClick={() => onNumberClick(row.beyanTipi, 'toplam')} />
        <YardimciBeyanNumber label={onayText} value={row.onaylanan} color={BEYAN_TONE.approved} onClick={() => onNumberClick(row.beyanTipi, 'onaylanan')} />
        <YardimciBeyanNumber label="Kalan" value={row.kalan} color={row.kalan > 0 ? BEYAN_TONE.remaining : BEYAN_TONE.approved} onClick={() => onNumberClick(row.beyanTipi, 'kalan')} />
        <div className="min-w-0 pl-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-bold" style={{ color: barColor }}>{statusLabel}</span>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: barColor, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>{pct}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(244,239,229,0.08)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${barColor}99, ${barColor})` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function YardimciBeyanNumber({ label, value, color, onClick }: { label: string; value: number; color: string; onClick: () => void }) {
  const clickable = value > 0;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={clickable ? onClick : undefined}
      className={`min-w-0 px-2 text-right transition ${clickable ? 'hover:bg-white/[0.055] hover:underline decoration-dotted underline-offset-4' : ''}`}
      title={clickable ? 'Mükellef listesini göster' : undefined}
    >
      <div className="truncate text-[9.5px] font-black uppercase tracking-[0.08em]" style={{ color: BEYAN_TONE.header }}>{label}</div>
      <div className="mt-0.5 text-[14px] font-bold leading-none tabular-nums" style={{ color, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', letterSpacing: 0 }}>
        {value}
      </div>
    </button>
  );
}

function BeyanHeaderCell({ children, align = 'right' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ color: BEYAN_TONE.header }}
    >
      {children}
    </th>
  );
}

function BeyanCompactRow({
  row,
  onNumberClick,
}: {
  row: OzetRow;
  onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void;
}) {
  const label = BEYAN_ETIKETLER[row.beyanTipi];
  const pct = Math.max(0, Math.min(100, row.yuzde));
  const done = row.kalan <= 0 && row.hatali <= 0;
  const barColor = row.hatali > 0 ? BEYAN_TONE.error : done ? BEYAN_TONE.approved : BEYAN_TONE.status;
  const statusLabel = row.hatali > 0 ? 'Hata var' : done ? 'Tamam' : 'Devam ediyor';

  return (
    <tr
      className="transition"
      style={{ borderTop: `1px solid ${BEYAN_TONE.borderSoft}`, background: BEYAN_TONE.rowAlt }}
      onMouseEnter={(e) => { e.currentTarget.style.background = BEYAN_TONE.bgSoft; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = BEYAN_TONE.rowAlt; }}
    >
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => onNumberClick(row.beyanTipi, 'toplam')}
          className="max-w-[250px] truncate text-left text-[13px] font-bold transition hover:underline decoration-dotted underline-offset-4"
          style={{ color: BEYAN_TONE.title }}
          title="Mükellef listesini göster"
        >
          {label}
        </button>
        <div className="mt-0.5 text-[10px]" style={{ color: BEYAN_TONE.muted }}>
          {donemEtiket(row.vergiDonem)}
        </div>
        <div className="hidden">
          {row.toplam} mükellef takipte
        </div>
      </td>
      <BeyanNumberCell value={row.toplam} color={BEYAN_TONE.title} onClick={() => onNumberClick(row.beyanTipi, 'toplam')} />
      <BeyanNumberCell value={row.onaylanan} color={BEYAN_TONE.approved} onClick={() => onNumberClick(row.beyanTipi, 'onaylanan')} />
      <BeyanNumberCell value={row.bekleyen} color={row.bekleyen > 0 ? BEYAN_TONE.waiting : 'rgba(244,239,229,0.34)'} onClick={() => onNumberClick(row.beyanTipi, 'bekleyen')} />
      <BeyanNumberCell value={row.hatali} color={row.hatali > 0 ? BEYAN_TONE.error : 'rgba(244,239,229,0.34)'} onClick={() => onNumberClick(row.beyanTipi, 'hatali')} />
      <BeyanNumberCell value={row.kalan} color={row.kalan > 0 ? BEYAN_TONE.remaining : BEYAN_TONE.approved} onClick={() => onNumberClick(row.beyanTipi, 'kalan')} />
      <td className="px-3 py-2">
        <div className="grid grid-cols-[82px,1fr,38px] items-center gap-2">
          <span className="text-[11px] font-bold" style={{ color: barColor }}>{statusLabel}</span>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(244,239,229,0.08)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${barColor}99, ${barColor})` }}
            />
          </div>
          <span
            className="text-right text-[11px] font-bold tabular-nums"
            style={{ color: barColor, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', letterSpacing: 0 }}
          >
            {pct}%
          </span>
        </div>
      </td>
    </tr>
  );
}

function BeyanNumberCell({ value, color, onClick }: { value: number; color: string; onClick: () => void }) {
  const clickable = value > 0;
  return (
    <td className="px-3 py-2 text-right">
      <button
        type="button"
        disabled={!clickable}
        onClick={clickable ? onClick : undefined}
        className={`min-w-8 rounded-md px-2 py-0.5 text-right text-[13px] font-bold tabular-nums transition ${clickable ? 'hover:bg-white/[0.055] hover:underline decoration-dotted underline-offset-4' : ''}`}
        style={{ color, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', letterSpacing: 0 }}
        title={clickable ? 'Mükellef listesini göster' : undefined}
      >
        {value}
      </button>
    </td>
  );
}

function BeyanMetric({ label, value, color, sub }: { label: string; value: number; color: string; sub?: string }) {
  return (
    <div
      className="min-h-[76px] rounded-xl px-4 py-3 text-left"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="text-[10.5px] font-black uppercase tracking-[0.1em]" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</div>
      <div className="mt-1 text-[28px] font-black leading-none tabular-nums" style={{ color, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', textShadow: '0 1px 14px rgba(0,0,0,0.28)' }}>{value}</div>
      {sub && <div className="mt-1 text-[11px]" style={{ color: 'rgba(250,250,249,0.42)' }}>{sub}</div>}
    </div>
  );
}

function BeyanStatusRow({
  row,
  onNumberClick,
}: {
  row: OzetRow;
  onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void;
}) {
  const label = BEYAN_ETIKETLER[row.beyanTipi];
  const barColor = row.hatali > 0 ? '#f472b6' : row.kalan > 0 ? TRACK_BLUE : '#22c55e';
  const statusLabel = row.hatali > 0 ? 'Hata var' : row.kalan > 0 ? 'Devam ediyor' : 'Tamam';

  return (
    <div
      className="grid gap-3 rounded-lg px-3.5 py-2.5 transition-all xl:grid-cols-[minmax(160px,.78fr)_minmax(410px,1.78fr)_minmax(180px,.66fr)]"
      style={{ background: row.hatali > 0 ? 'rgba(244,114,182,0.035)' : row.kalan > 0 ? 'rgba(125,211,252,0.035)' : 'rgba(34,197,94,0.026)', border: `1px solid ${row.hatali > 0 ? 'rgba(244,114,182,0.22)' : row.kalan > 0 ? 'rgba(125,211,252,0.22)' : 'rgba(34,197,94,0.18)'}` }}
    >
      <div className="min-w-0">
        <div className="text-[14px] font-bold leading-tight" style={{ color: GOLD }}>{label}</div>
        <div className="mt-0.5 text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>{row.toplam} mükellef takipte</div>
      </div>

      <div className="grid min-w-0 grid-cols-5 overflow-hidden rounded-lg" style={{ background: 'rgba(255,255,255,0.026)', border: '1px solid rgba(255,255,255,0.055)' }}>
        <BeyanCount label="Toplam" value={row.toplam} color="#fafaf9" onClick={() => onNumberClick(row.beyanTipi, 'toplam')} />
        <BeyanCount label="Onay" value={row.onaylanan} color="#22c55e" onClick={() => onNumberClick(row.beyanTipi, 'onaylanan')} />
        <BeyanCount label="Bekleyen" value={row.bekleyen} color="rgba(250,250,249,0.62)" onClick={() => onNumberClick(row.beyanTipi, 'bekleyen')} />
        <BeyanCount label="Hatalı" value={row.hatali} color={row.hatali > 0 ? '#f472b6' : 'rgba(250,250,249,0.35)'} onClick={() => onNumberClick(row.beyanTipi, 'hatali')} />
        <BeyanCount label="Kalan" value={row.kalan} color={row.kalan > 0 ? TRACK_BLUE : '#22c55e'} onClick={() => onNumberClick(row.beyanTipi, 'kalan')} />
      </div>

      <div className="flex flex-col justify-center gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold" style={{ color: barColor }}>{statusLabel}</span>
          <span className="text-[12px] font-bold tabular-nums" style={{ color: barColor, fontFamily: 'JetBrains Mono, monospace' }}>%{row.yuzde}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.max(0, Math.min(100, row.yuzde))}%`, background: `linear-gradient(90deg, ${barColor}88, ${barColor})` }}
          />
        </div>
      </div>
    </div>
  );
}

function BeyanCount({ label, value, color, onClick }: { label: string; value: number; color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group min-w-0 px-2.5 py-1.5 text-left transition hover:bg-white/[0.035]"
      style={{ background: 'transparent', borderRight: '1px solid rgba(255,255,255,0.052)' }}
      title="Mükellef listesini göster"
    >
      <div className="truncate text-[9.5px] font-black uppercase tracking-[0.08em]" style={{ color: 'rgba(250,250,249,0.48)' }}>{label}</div>
      <div
        className="mt-0.5 text-[18px] font-black leading-none tabular-nums group-hover:underline decoration-dotted underline-offset-4"
        style={{ color, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', textShadow: '0 1px 12px rgba(0,0,0,0.35)' }}
      >
        {value}
      </div>
    </button>
  );
}

function ToplubeyannameTableLegacy() {
  // Varsayılan: içinde bulunduğumuz ay
  const [donem, setDonem] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [modal, setModal] = useState<ModalState>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['beyanname-ozet', donem],
    queryFn: () => beyannameTakipApi.listOzet(donem),
    // Her beyanname döneminde otomatik yenilensin diye 5 dk cache
    staleTime: 5 * 60 * 1000,
  });

  const rows = data?.rows || [];
  const openModal = (beyanTipi: BeyanTipi, filter: BeyanFilter) =>
    setModal({ beyanTipi, filter, donem, donemTuru: 'VERILME' });

  // Tablo gruplamaları
  const beyanTipleri: BeyanTipi[] = [
    'KURUMLAR', 'GELIR',
    'KDV1', 'KDV2', 'KDV4', 'KDV9015',
    'DAMGA', 'POSET',
    'MUHSGK', 'MUHSGK2',
    'GGECICI', 'KGECICI',
    'TURIZM', 'KONAKLAMA', 'OIV', 'GMSI',
    'OTV1', 'OTV3A', 'OTV3B', 'OTV4',
  ];
  const beyanRows = rows.filter((r) => beyanTipleri.includes(r.beyanTipi) && r.toplam > 0);
  const bildirgeRow = rows.find((r) => r.beyanTipi === 'BILDIRGE' && r.toplam > 0);
  const edefterRow = rows.find((r) => r.beyanTipi === 'EDEFTER' && r.toplam > 0);

  // Dönem seçenekleri: son 12 ay
  const donemOptions = useMemo(() => {
    const now = new Date();
    const arr: { value: string; label: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const aylar = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
      arr.push({ value: v, label: `${d.getFullYear()}/${aylar[d.getMonth()]}` });
    }
    return arr;
  }, []);

  return (
    <div>
      {/* Başlık bandı */}
      <div className="flex items-center justify-between px-5 py-4 flex-wrap gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2.5">
          <FileCheck2 size={16} style={{ color: GOLD }} />
          <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>Toplu Beyanname — SGK ve E-Defter Kontrol</h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={donem}
            onChange={(e) => setDonem(e.target.value)}
            className="text-[12px] px-2.5 py-1.5 rounded-md outline-none cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(184,160,111,0.25)', color: '#fafaf9' }}
          >
            {donemOptions.map((o) => (
              <option key={o.value} value={o.value} style={{ background: '#1a1814' }}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => refetch()}
            className="text-[11px] font-medium px-3 py-1.5 rounded-md transition-all inline-flex items-center gap-1.5"
            style={{ background: 'rgba(184,160,111,0.12)', border: '1px solid rgba(184,160,111,0.3)', color: GOLD }}
          >
            <SearchIcon size={11} /> Sorgula
          </button>
          <Link
            href="/panel/ayarlar/beyanname-takip"
            className="text-[11px] font-medium px-3 py-1.5 rounded-md transition-all inline-flex items-center gap-1.5"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
          >
            <Settings size={11} /> Ayarlar
          </Link>
        </div>
      </div>

      {isLoading && (
        <div className="px-5 py-10 text-center text-[12px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
          Yükleniyor...
        </div>
      )}

      {!isLoading && beyanRows.length === 0 && !bildirgeRow && !edefterRow && (
        <div className="px-5 py-10 text-center">
          <p className="text-[12.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Bu dönem için hiçbir mükellefin beyan yükümlülüğü yok.
          </p>
          <p className="text-[11px] mt-1.5" style={{ color: 'rgba(250,250,249,0.3)' }}>
            Ayarlar → Mükellef Beyanname Takip sayfasından mükellef konfigürasyonlarını düzenle.
          </p>
        </div>
      )}

      {/* Beyannameler tablosu */}
      {beyanRows.length > 0 && (
        <div className="px-1.5 py-1.5">
          <table className="w-full text-[12px]" style={{ color: 'rgba(250,250,249,0.85)', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '120px' }} />
              <col style={{ width: '68px' }} />
              <col style={{ width: '82px' }} />
              <col style={{ width: '82px' }} />
              <col style={{ width: '68px' }} />
              <col style={{ width: '68px' }} />
              <col />
            </colgroup>
            <thead>
              <tr style={{ background: 'rgba(184,160,111,0.08)' }}>
                <Th>Beyannameler ({data?.donem})</Th>
                <Th right>Toplam</Th>
                <Th right>Onaylanan</Th>
                <Th right>Bekleyen</Th>
                <Th right>Hatalı</Th>
                <Th right>Kalan</Th>
                <Th>Durum</Th>
              </tr>
            </thead>
            <tbody>
              {beyanRows.map((r) => (
                <BeyanTr key={r.beyanTipi} row={r} onNumberClick={openModal} />
              ))}
              {bildirgeRow && (
                <BeyanTr key={bildirgeRow.beyanTipi} row={bildirgeRow} onNumberClick={openModal} />
              )}
              {edefterRow && (
                <BeyanTr key={edefterRow.beyanTipi} row={edefterRow} onNumberClick={openModal} />
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Mükellef listesi modal'ı */}
      {modal && <BeyanDetayModal state={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function Th({ children, right, className }: { children: ReactNode; right?: boolean; className?: string }) {
  return (
    <th
      className={`text-[10.5px] font-semibold uppercase tracking-wider px-2.5 py-2 ${right ? 'text-right' : 'text-left'} ${className || ''}`}
      style={{ color: 'rgba(250,250,249,0.6)' }}
    >
      {children}
    </th>
  );
}

/** Tıklanabilir rakam hücresi — rakam > 0 ise altın hover + tıklama. */
function Num({
  value,
  color,
  bold,
  onClick,
  disabled,
}: {
  value: number;
  color: string;
  bold?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const clickable = !disabled && !!onClick && value > 0;
  return (
    <td
      className={`px-2.5 py-2 text-right tabular-nums ${bold ? 'font-semibold' : ''} ${clickable ? 'cursor-pointer hover:bg-white/5 hover:underline decoration-dotted underline-offset-2' : ''} transition`}
      style={{ fontFamily: 'JetBrains Mono, monospace', color }}
      onClick={clickable ? onClick : undefined}
      title={clickable ? 'Mükellef listesini göster' : undefined}
    >
      {value}
    </td>
  );
}

function BeyanTr({ row, onNumberClick }: { row: OzetRow; onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void }) {
  const kind = row.yuzde >= 90 ? 'ok' : row.yuzde >= 50 ? 'warn' : 'danger';
  const barColor = kind === 'ok' ? '#22c55e' : kind === 'warn' ? TRACK_BLUE : '#ef4444';
  return (
    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      <td className="px-2.5 py-2 font-semibold" style={{ color: GOLD }}>{BEYAN_ETIKETLER[row.beyanTipi]}</td>
      <Num value={row.toplam}    color="rgba(250,250,249,0.85)"                                              onClick={() => onNumberClick(row.beyanTipi, 'toplam')} />
      <Num value={row.onaylanan} color="#22c55e"                                                             onClick={() => onNumberClick(row.beyanTipi, 'onaylanan')} />
      <Num value={row.bekleyen}  color="rgba(250,250,249,0.5)"                                               onClick={() => onNumberClick(row.beyanTipi, 'bekleyen')} />
      <Num value={row.hatali}    color={row.hatali > 0 ? '#ef4444' : 'rgba(250,250,249,0.3)'}                onClick={() => onNumberClick(row.beyanTipi, 'hatali')} />
      <Num value={row.kalan}     color={row.kalan > 0 ? TRACK_BLUE : '#22c55e'} bold                          onClick={() => onNumberClick(row.beyanTipi, 'kalan')} />
      <td className="px-2.5 py-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <div
              className="h-full transition-all duration-500 rounded-full"
              style={{ width: `${row.yuzde}%`, background: `linear-gradient(90deg, ${barColor}aa, ${barColor})` }}
            />
          </div>
          <span className="text-[10.5px] font-semibold tabular-nums w-[32px] text-right" style={{ color: barColor, fontFamily: 'JetBrains Mono, monospace' }}>%{row.yuzde}</span>
        </div>
      </td>
    </tr>
  );
}

function MiniTable({ title, row, donem, accent, onNumberClick }: { title: string; row: OzetRow; donem: string; accent: StatAccent; onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void }) {
  const tone = ACCENT_TONES[accent];
  const kind = row.yuzde >= 90 ? 'ok' : row.yuzde >= 50 ? 'warn' : 'danger';
  const barColor = kind === 'ok' ? '#22c55e' : kind === 'warn' ? TRACK_BLUE : '#ef4444';
  const miniCell = (label: string, value: number, color: string, filter: BeyanFilter) => {
    const clickable = value > 0;
    return (
      <div
        className={`group ${clickable ? 'cursor-pointer' : ''}`}
        onClick={clickable ? () => onNumberClick(row.beyanTipi, filter) : undefined}
        title={clickable ? 'Mükellef listesini göster' : undefined}
      >
        <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
        <div
          className={`text-[16px] font-semibold tabular-nums ${clickable ? 'group-hover:underline decoration-dotted underline-offset-2' : ''}`}
          style={{ color, fontFamily: 'JetBrains Mono, monospace' }}
        >
          {value}
        </div>
      </div>
    );
  };
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${tone.border}` }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background: tone.bg }}>
        <div className="flex items-center gap-2">
          <span className="w-[3px] h-3.5 rounded-sm" style={{ background: tone.color }} />
          <span className="text-[12px] font-semibold" style={{ color: tone.color }}>{title} ({donem})</span>
        </div>
      </div>
      <div className="px-4 py-3 grid grid-cols-3 gap-3 text-[11px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
        {miniCell('Toplam', row.toplam, '#fafaf9', 'toplam')}
        {miniCell(title === 'E-Defter' ? 'Verilen' : 'Onaylanan', row.onaylanan, '#22c55e', 'onaylanan')}
        {miniCell('Kalan', row.kalan, row.kalan > 0 ? TRACK_BLUE : '#22c55e', 'kalan')}
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <div
              className="h-full transition-all duration-500 rounded-full"
              style={{ width: `${row.yuzde}%`, background: `linear-gradient(90deg, ${barColor}aa, ${barColor})` }}
            />
          </div>
          <span className="text-[10.5px] font-semibold tabular-nums" style={{ color: barColor, fontFamily: 'JetBrains Mono, monospace' }}>%{row.yuzde}</span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// BEYAN DETAY MODAL — rakama tıklanınca açılır, filtreye göre mükellef listesi
// ══════════════════════════════════════════════════════════
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
      .filter((r): r is NonNullable<typeof r> => r !== null);
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
        className="flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl"
        style={{ background: '#101412', border: `1px solid ${filterColor[state.filter]}55`, maxHeight: '86vh', boxShadow: '0 28px 90px rgba(0,0,0,0.48)' }}
      >
        <div className="flex items-start justify-between gap-4 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01))' }}>
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.16em]" style={{ color: filterColor[state.filter] }}>
              {BEYAN_ETIKETLER[state.beyanTipi]} · {periodModeText}: {donemEtiket(state.donem)}{vergiDonemKey ? ` · Vergi dönemi: ${donemEtiket(vergiDonemKey)}` : ''}
            </div>
            <h3 className="mt-1 text-[24px] font-black leading-tight" style={{ color: '#fafaf9' }}>
              {filterLabels[state.filter]}
            </h3>
            <p className="mt-1 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.48)' }}>
              Sayaçtaki rakama dahil olan mükelleflerin dönem bazlı listesi.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadList}
              disabled={filteredItems.length === 0}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-lg px-3 text-[12.5px] font-bold transition disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: 'rgba(125,211,252,0.12)', border: '1px solid rgba(125,211,252,0.28)', color: TRACK_BLUE }}
            >
              <Download size={15} /> Listeyi İndir
            </button>
            <button onClick={onClose} className="rounded-lg p-2 transition hover:bg-white/5" style={{ color: 'rgba(250,250,249,0.55)' }}>
              <IconX size={19} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading && (
            <div className="px-4 py-14 text-center text-[12px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
              Yükleniyor...
            </div>
          )}
          {!isLoading && filteredItems.length === 0 && (
            <div className="rounded-xl px-4 py-14 text-center text-[13px]" style={{ color: 'rgba(250,250,249,0.48)', border: '1px dashed rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.018)' }}>
              {emptyText}
            </div>
          )}
          {!isLoading && filteredItems.length > 0 && (
            <div className="overflow-hidden rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="grid grid-cols-[64px_minmax(260px,1.6fr)_160px_130px_150px] gap-0 px-4 py-3 text-[11px] font-black uppercase tracking-[0.11em]" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.52)' }}>
                <div>No</div>
                <div>Mükellef</div>
                <div>Durum</div>
                <div>Tarih</div>
                <div className="text-right">Tahakkuk</div>
              </div>
              <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.055)' }}>
                {filteredItems.map(({ taxpayer, beyan }, i) => {
                  const tone = durumRenk[beyan.durum] || 'rgba(250,250,249,0.6)';
                  return (
                    <div
                      key={`${taxpayer.taxpayerId}-${state.beyanTipi}`}
                      className="grid grid-cols-[64px_minmax(260px,1.6fr)_160px_130px_150px] items-center gap-0 px-4 py-3 text-[13px]"
                      style={{ background: i % 2 === 0 ? `${tone}10` : 'rgba(255,255,255,0.012)' }}
                    >
                      <div className="font-black tabular-nums" style={{ color: 'rgba(250,250,249,0.42)', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>{i + 1}</div>
                      <div className="min-w-0 pr-4">
                        <div className="truncate text-[14px] font-black" style={{ color: '#fafaf9' }}>{taxpayer.ad}</div>
                        <div className="mt-0.5 text-[11px]" style={{ color: 'rgba(250,250,249,0.42)' }}>
                          {BEYAN_ETIKETLER[state.beyanTipi]} · {donemEtiket(beyan.vergiDonem)}
                        </div>
                      </div>
                      <div>
                        <span
                          className="inline-flex rounded-md px-2.5 py-1 text-[10.5px] font-black uppercase tracking-[0.08em]"
                          style={{ background: `${tone}1f`, border: `1px solid ${tone}55`, color: tone }}
                        >
                          {durumEtiket[beyan.durum] || beyan.durum}
                        </span>
                      </div>
                      <div className="text-[12px] font-semibold tabular-nums" style={{ color: 'rgba(250,250,249,0.66)' }}>
                        {formatDate(beyan.onayTarihi)}
                      </div>
                      <div className="text-right text-[12px] font-black tabular-nums" style={{ color: 'rgba(250,250,249,0.78)', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
                        {formatMoney(beyan.tahakkukTutari)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-3 text-[11.5px]" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', color: 'rgba(250,250,249,0.48)' }}>
          <span><strong style={{ color: filterColor[state.filter] }}>{filteredItems.length}</strong> mükellef listeleniyor</span>
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
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>Aylık İşlem Trendi</h3>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setMode('weekly')} className="px-3 py-1.5 text-[11px] font-medium rounded-md transition-all" style={{ background: mode === 'weekly' ? 'rgba(184,160,111,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${mode === 'weekly' ? 'rgba(184,160,111,0.3)' : 'rgba(255,255,255,0.08)'}`, color: mode === 'weekly' ? GOLD : 'rgba(250,250,249,0.6)' }}>Haftalık</button>
          <button onClick={() => setMode('monthly')} className="px-3 py-1.5 text-[11px] font-medium rounded-md transition-all" style={{ background: mode === 'monthly' ? 'rgba(184,160,111,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${mode === 'monthly' ? 'rgba(184,160,111,0.3)' : 'rgba(255,255,255,0.08)'}`, color: mode === 'monthly' ? GOLD : 'rgba(250,250,249,0.6)' }}>Aylık</button>
        </div>
      </div>
      {hasAny ? (
        <div className="flex items-end gap-2 h-[160px] px-[22px] pt-5 pb-2">
          {bars.map((b, i) => {
            const h = Math.max(4, (b.count / max) * 120);
            return (
              <div key={i} className="flex-1 flex flex-col items-center h-full group/bar" title={`${b.label}: ${b.count} işlem`}>
                <div className="flex-1 w-full flex items-end">
                  <div className="w-full rounded-t-[4px] transition-all group-hover/bar:opacity-100" style={{ height: h, background: `linear-gradient(180deg, ${GOLD}, rgba(184,160,111,0.35))`, opacity: 0.85 }} />
                </div>
                <span className="text-[10px] font-semibold mt-1.5" style={{ color: 'rgba(250,250,249,0.32)' }}>{b.label}</span>
                <span className="text-[9.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.5)', fontFamily: 'JetBrains Mono, monospace' }}>{b.count || ''}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center h-[130px] px-5">
          <p className="text-[12px]" style={{ color: 'rgba(250,250,249,0.35)' }}>Henüz işlem verisi yok</p>
        </div>
      )}
      <div className="flex gap-4 px-[22px] py-2.5 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
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
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>Mükellef Durumu</h3>
        </div>
      </div>
      <div className="flex items-center justify-center gap-5 px-5 py-6">
        <div className="w-[120px] h-[120px] rounded-full flex items-center justify-center flex-shrink-0" style={{ background: grad }}>
          <div className="w-[76px] h-[76px] rounded-full flex flex-col items-center justify-center" style={{ background: '#0c0a08' }}>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 700, color: GOLD }}>{total}</div>
            <div className="text-[8.5px] font-semibold uppercase mt-0.5" style={{ color: 'rgba(250,250,249,0.35)', letterSpacing: '.14em' }}>Toplam</div>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 flex-1">
          {segments.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5 text-[11.5px]" style={{ color: 'rgba(250,250,249,0.65)' }}>
              <div className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ background: s.color }} />
              {s.label}
              <span className="ml-auto font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#fafaf9' }}>{s.value}</span>
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
        style={{
          background: 'linear-gradient(135deg, rgba(212,184,118,0.11), rgba(15,13,11,0.98))',
          border: '1px solid rgba(212,184,118,0.22)',
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'linear-gradient(135deg, #d4b876, #8b7649)', color: '#0f0d0b', fontFamily: 'Fraunces, serif', fontWeight: 800 }}
          >
            M
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase" style={{ color: GOLD, letterSpacing: 0 }}>
              Kurulu Mobil Portal
            </p>
            <h1 className="mt-1 text-[22px] leading-[1.1]" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
              Moren Portal
            </h1>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-6" style={{ color: 'rgba(250,250,249,0.62)' }}>
          Telefonda ilk ekran artık gerçek modüllere giden mobil ana menüdür. Masaüstü panel düzeni bu ekranda zorlanmaz.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-2.5">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="min-h-[88px] rounded-lg p-3"
              style={{ background: `${stat.color}10`, border: `1px solid ${stat.color}28` }}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase" style={{ color: 'rgba(250,250,249,0.52)', letterSpacing: 0 }}>
                  {stat.label}
                </span>
                <Icon size={14} style={{ color: stat.color }} />
              </div>
              <div className="tabular-nums text-[25px] leading-none" style={{ color: stat.color, fontFamily: 'Fraunces, serif', fontWeight: 700 }}>
                {stat.value}
              </div>
              <div className="mt-1 truncate text-[11px]" style={{ color: 'rgba(250,250,249,0.46)' }}>
                {stat.sub}
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[18px] leading-tight" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
              Hızlı işlemler
            </h2>
            <p className="mt-1 text-[12px]" style={{ color: 'rgba(250,250,249,0.46)' }}>
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
                style={{ background: `${item.color}0f`, border: `1px solid ${item.color}26` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <Icon size={18} style={{ color: item.color }} />
                  <ArrowRight size={15} style={{ color: 'rgba(250,250,249,0.42)' }} />
                </div>
                <div className="mt-4 truncate text-[14px] font-bold" style={{ color: '#fafaf9' }}>
                  {item.label}
                </div>
                <div className="mt-1 truncate text-[11px]" style={{ color: 'rgba(250,250,249,0.46)' }}>
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
            <h2 className="text-[18px] leading-tight" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
              İlk PWA modülleri
            </h2>
            <p className="mt-1 text-[12px]" style={{ color: 'rgba(250,250,249,0.46)' }}>
              Kurulu uygulamada doğrudan erişim
            </p>
          </div>
          <span className="rounded-lg px-2 py-1 text-[12px] font-bold" style={{ background: 'rgba(212,184,118,0.14)', color: GOLD }}>
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
                style={{ background: `${item.color}0d`, border: `1px solid ${item.color}22` }}
              >
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                  style={{ background: `${item.color}14`, border: `1px solid ${item.color}30`, color: item.color }}
                >
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold" style={{ color: '#fafaf9' }}>
                    {item.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px]" style={{ color: 'rgba(250,250,249,0.46)' }}>
                    {item.sub}
                  </span>
                </span>
                <ArrowRight size={15} style={{ color: item.color }} />
              </Link>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div>
          <h2 className="text-[18px] leading-tight" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif', letterSpacing: 0 }}>
            Modül grupları
          </h2>
          <p className="mt-1 text-[12px]" style={{ color: 'rgba(250,250,249,0.46)' }}>
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
                style={{ background: `${group.color}0d`, border: `1px solid ${group.color}22` }}
              >
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                  style={{ background: `${group.color}14`, border: `1px solid ${group.color}30`, color: group.color }}
                >
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold" style={{ color: '#fafaf9' }}>
                    {group.label}
                  </span>
                  <span className="mt-0.5 block text-[11px]" style={{ color: 'rgba(250,250,249,0.46)' }}>
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
  const { data: taxpayers } = useQuery({ queryKey: ['taxpayers'], queryFn: () => api.get('/taxpayers').then((r) => r.data).catch(() => []) });
  const { data: unreadRaw } = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get('/notifications/unread-count').then((r) => r.data).catch(() => 0) });
  const { data: agentEvents = [] } = useQuery<any[]>({ queryKey: ['agent-events', 'dashboard'], queryFn: () => api.get('/agent/events?limit=100').then((r) => r.data).catch(() => []), refetchInterval: 15_000 });
  const { data: agentStats } = useQuery<any>({ queryKey: ['agent-stats'], queryFn: () => api.get('/agent/stats').then((r) => r.data).catch(() => null) });
  const { data: agentStatuses = [] } = useQuery<any[]>({ queryKey: ['agent-statuses'], queryFn: () => api.get('/agent/status').then((r) => r.data).catch(() => []), refetchInterval: 30_000 });
  const { data: meUser } = useMe();
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
  const { data: workflowData } = useQuery<{ counts?: { evrak: number; islenme: number; kontrol: number; beyanname: number; tamam: number }; total?: number }>({
    queryKey: ['dashboard-workflow-queue'],
    queryFn: () => api.get('/taxpayers/workflow/queue').then((r) => r.data).catch(() => ({ counts: { evrak: 0, islenme: 0, kontrol: 0, beyanname: 0, tamam: 0 }, total: 0 })),
    refetchInterval: 60_000,
  });
  const aktifIsYuku =
    (workflowData?.counts?.islenme ?? 0) +
    (workflowData?.counts?.kontrol ?? 0) +
    (workflowData?.counts?.beyanname ?? 0);

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
    <div className="max-w-full overflow-x-hidden">
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
          className="rounded-2xl px-5 py-4 flex items-center gap-4 flex-wrap"
          style={{
            background: 'linear-gradient(135deg, rgba(244,63,94,0.12), rgba(239,68,68,0.08))',
            border: '1px solid rgba(244,63,94,0.4)',
            animation: 'moren-banner-pulse 2.8s ease-in-out infinite',
          }}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(244,63,94,0.2)', border: '1px solid rgba(244,63,94,0.5)' }}>
            <AlertTriangle size={18} style={{ color: '#f43f5e' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-bold mb-0.5" style={{ color: '#fafaf9' }}>
              {dueTasks.length} hatırlatma zamanı geldi
            </div>
            <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.7)' }}>
              {dueTasks.slice(0, 3).map((t) => t.title).join(' · ')}
              {dueTasks.length > 3 && ` · +${dueTasks.length - 3} daha`}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {dueTasks.length === 1 && (
              <button
                onClick={() => dismissReminder(dueTasks[0].id)}
                className="text-[11.5px] font-medium px-3 py-1.5 rounded-md transition"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(250,250,249,0.85)' }}
              >
                Anladım
              </button>
            )}
            {dueTasks.length > 1 && (
              <button
                onClick={() => dueTasks.forEach((t) => dismissReminder(t.id))}
                className="text-[11.5px] font-medium px-3 py-1.5 rounded-md transition"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(250,250,249,0.85)' }}
              >
                Hepsini anladım
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 px-0 py-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2.5"><span className="w-[26px] h-px" style={{ background: GOLD }} /><span className="text-[9.5px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Gösterge</span></div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 650, color: '#fafaf9', letterSpacing: '-.02em' }}>Ofis Paneli</h1>
          <p className="text-[12.5px] mt-1" style={{ color: 'rgba(250,250,249,0.46)' }}>{new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })} · Mükellefler · Beyannameler · Ajanlar</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/panel/evraklar" className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[12.5px] font-semibold transition-all" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.08)'; e.currentTarget.style.borderColor = 'rgba(184,160,111,0.2)'; e.currentTarget.style.color = '#fafaf9'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(250,250,249,0.75)'; }}>
            <Download size={14} /> İçe Aktar
          </Link>
          <Link href="/panel/mukellefler/yeni" className="inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-[12.5px] font-bold transition-all" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}><Plus size={14} /> Yeni Mükellef</Link>
        </div>
      </div>

      {/* v1.36.81: AI sabah brifingi — günün özetini 2-3 cümlede anlatır */}
      <div className="grid grid-cols-1 gap-2.5 pb-4 sm:grid-cols-2 xl:grid-cols-4">
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
        {/* Kritik Uyarı — tıklanabilir kart, detayı altta açılır panel */}
        <KritikUyariStatCard />
      </div>

      <BrifingKart userName={displayUserName(meUser)} />

      <DashboardSectionBridge from="Brifing" to="Beyanname Takibi" tone="mint" />

      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'radial-gradient(circle at 6% 0%, rgba(216,189,134,0.12), transparent 34%), radial-gradient(circle at 92% 12%, rgba(140,200,255,0.07), transparent 30%), linear-gradient(180deg, rgba(19,19,17,0.94), rgba(12,11,10,0.91))',
          border: `1px solid ${BEYAN_TONE.border}`,
          boxShadow: '0 18px 44px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.035)',
        }}
      >
        <ToplubeyannameTable />
      </div>

      <DashboardSectionBridge from="Beyanname Takibi" to="Bu Ay İş Akışı" />

      <WorkflowOverview counts={workflowCounts} total={workflowTotal} activeCount={activeCount || totalTx} />

      <DashboardSectionBridge tone="rose" />

      <BuHaftaTakvim />
      </div>
    </div>
  );
}
