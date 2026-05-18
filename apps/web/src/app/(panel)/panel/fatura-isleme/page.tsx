'use client';

/* =====================================================================
   FATURA İŞLEME — v3 (Sıcak teal · Tek workspace)
   ---------------------------------------------------------------------
   Akış:  KAYNAKLAR → HAVUZ → EŞLEŞTİR → FİŞLER → LUCA
   ===================================================================== */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import TaxpayerSelect, { TaxpayerLite } from '@/components/ui/TaxpayerSelect';

/* ────────────────────────────────────────────────────────────────────
   TİPLER
   ──────────────────────────────────────────────────────────────────── */

type Direction = 'ALIS' | 'SATIS';
type DocStatus = 'NEEDS_REVIEW' | 'READY' | 'APPROVED' | 'REJECTED';
type StageId = 'sources' | 'pool' | 'match' | 'vouchers' | 'luca';
type SourceId = 'integrator' | 'ocr' | 'earsiv';

interface ApiLine {
  id?: string;
  group?: string | null;
  accountCode?: string | null;
  description?: string | null;
  rate?: string | null;
  debit?: string | number | null;
  credit?: string | number | null;
  orderNo?: number | null;
}

interface ApiDocument {
  id: string;
  source?: string | null;
  documentType?: string | null;
  invoiceKind?: string | null;
  status?: string | null;
  duplicateOfId?: string | null;
  duplicateReason?: string | null;
  duplicateSeverity?: 'WARNING' | 'BLOCKING' | string | null;
  originalName?: string | null;
  belgeNo?: string | null;
  faturaTarihi?: string | null;
  vendorName?: string | null;
  customerName?: string | null;
  totalAmount?: string | number | null;
  ocrStatus?: string | null;
  ocrEngine?: string | null;
  ocrConfidence?: number | null;
  ocrData?: unknown;
  lines?: ApiLine[];
  createdAt?: string;
  taxpayerId?: string | null;
  approvedAt?: string | null;
}

interface DashboardRow {
  taxpayerId: string;
  name: string;
  ledgerType: string;
  pendingPurchase: number;
  pendingSale: number;
  pendingBank: number;
  approvedInvoice: number;
  approvedBank: number;
  totalPending: number;
}

interface DashboardResponse {
  rows: DashboardRow[];
  totals: {
    pendingPurchase: number;
    pendingSale: number;
    pendingBank: number;
    approvedInvoice: number;
    approvedBank: number;
  };
}

interface AccountPlanNode {
  code: string;
  name: string;
  parentCode?: string | null;
  isLeaf?: boolean;
}

interface IntegrationRow {
  provider: string;
  label?: string;
  kind?: string;
  isActive?: boolean;
  hasCredentials?: boolean;
  lastSyncAt?: string | null;
  config?: unknown;
}

/* ────────────────────────────────────────────────────────────────────
   SABİTLER (palet renkleri inline kullanılıyor)
   ──────────────────────────────────────────────────────────────────── */

const PROVIDERS: Array<{ id: string; label: string }> = [
  { id: 'ELOGO', label: 'e-Logo' },
  { id: 'UYUMSOFT', label: 'Uyumsoft' },
  { id: 'PARASUT', label: 'Paraşüt' },
  { id: 'KOLAYSOFT', label: 'Kolaysoft' },
  { id: 'GIB_PORTAL', label: 'GİB Portal' },
  { id: 'LUCA', label: 'Luca' },
  { id: 'IZIBIZ', label: 'Izibiz' },
  { id: 'FORIBA', label: 'Foriba' },
  { id: 'MIKRO', label: 'Mikro' },
  { id: 'LOGO_ISBASI', label: 'Logo İşbaşı' },
  { id: 'TURMOB_EFATURA', label: 'TÜRMOB' },
];

const STAGES: Array<{ id: StageId; label: string }> = [
  { id: 'sources', label: 'Kaynaklar' },
  { id: 'pool', label: 'Havuz' },
  { id: 'match', label: 'Eşleştirme' },
  { id: 'vouchers', label: 'Fişler' },
  { id: 'luca', label: 'Luca' },
];

const DOC_TYPE_LABEL: Record<string, string> = {
  E_FATURA: 'e-Fatura',
  E_ARSIV: 'e-Arşiv',
  OKC_FIS: 'ÖKC Fişi',
  FIS: 'Fiş',
  Z_RAPORU: 'Z Raporu',
  DIGER: 'Diğer',
};

/* ────────────────────────────────────────────────────────────────────
   YARDIMCILAR
   ──────────────────────────────────────────────────────────────────── */

const fmtMoney = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (v: unknown) => {
  if (!v) return '—';
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const fmtDateLong = (v: unknown) => {
  if (!v) return '';
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
};

const fmtTime = (v: unknown) => {
  if (!v) return '—';
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
};

const taxpayerLabel = (t?: TaxpayerLite | null) => {
  if (!t) return '—';
  return (
    t.companyName ||
    `${t.firstName || ''} ${t.lastName || ''}`.trim() ||
    t.taxNumber ||
    'Adsız'
  );
};

const currentPeriod = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const periodOptions = () => {
  const out: Array<{ value: string; label: string }> = [];
  const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const d = new Date();
  for (let i = 0; i < 12; i += 1) {
    const dd = new Date(d.getUTCFullYear(), d.getUTCMonth() - i, 1);
    const year = dd.getUTCFullYear();
    const month = dd.getUTCMonth();
    out.push({
      value: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: `${months[month]} ${year}`,
    });
  }
  return out;
};

const parseNum = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/* ════════════════════════════════════════════════════════════════════
   ANA SAYFA
   ════════════════════════════════════════════════════════════════════ */

export default function FaturaIslemePage() {
  const qc = useQueryClient();

  const [stage, setStage] = useState<StageId>('sources');
  const [period, setPeriod] = useState<string>(currentPeriod());
  const [selectedTaxpayer, setSelectedTaxpayer] = useState<string>('');
  const [activeDocId, setActiveDocId] = useState<string | null>(null);

  /* ─── Veri çekme ─── */

  const taxpayersQ = useQuery<TaxpayerLite[]>({
    queryKey: ['fim', 'taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });

  const dashboardQ = useQuery<DashboardResponse>({
    queryKey: ['fim', 'dashboard', period],
    queryFn: () =>
      api.get('/fatura-muhasebelestirme/dashboard', { params: { period } }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const documentsQ = useQuery<ApiDocument[]>({
    queryKey: ['fim', 'documents', selectedTaxpayer, period],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/documents', {
          params: { taxpayerId: selectedTaxpayer || undefined, period, limit: 500 },
        })
        .then((r) => r.data),
    refetchInterval: 20_000,
  });

  const taxpayers = taxpayersQ.data || [];
  const dashboard = dashboardQ.data;
  const documents = documentsQ.data || [];

  /* ─── Türetilmiş veri ─── */

  const taxpayerMap = useMemo(() => {
    const m = new Map<string, TaxpayerLite>();
    taxpayers.forEach((t) => m.set(t.id, t));
    return m;
  }, [taxpayers]);

  const documentsByStage = useMemo(() => {
    const pool: ApiDocument[] = [];
    const match: ApiDocument[] = [];
    const vouchers: ApiDocument[] = [];
    const luca: ApiDocument[] = [];
    documents.forEach((d) => {
      const s = (d.status || 'NEEDS_REVIEW') as DocStatus;
      if (s === 'APPROVED') luca.push(d);
      else if (s === 'READY') vouchers.push(d);
      else if (s === 'NEEDS_REVIEW' && (d.lines || []).length > 0) match.push(d);
      else pool.push(d);
    });
    return { pool, match, vouchers, luca };
  }, [documents]);

  const totals = dashboard?.totals || {
    pendingPurchase: 0,
    pendingSale: 0,
    pendingBank: 0,
    approvedInvoice: 0,
    approvedBank: 0,
  };

  const grandPending = totals.pendingPurchase + totals.pendingSale + totals.pendingBank;
  const grandTransferred = totals.approvedInvoice + totals.approvedBank;

  /* ─── Yenileme ─── */

  const handleRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['fim'] });
    toast.success('Veriler yenilendi');
  }, [qc]);

  /* ─── Sahne değişince aktif belgeyi temizle (etkili olduğunda match sahnesinden gelmiyorsa) ─── */
  useEffect(() => {
    if (stage !== 'match') return;
    // ilk uygun belgeyi seç
    const list = [...documentsByStage.match, ...documentsByStage.pool];
    if (!activeDocId && list.length > 0) {
      setActiveDocId(list[0].id);
    } else if (activeDocId && !list.find((d) => d.id === activeDocId)) {
      setActiveDocId(list[0]?.id || null);
    }
  }, [stage, activeDocId, documentsByStage]);

  return (
    <div className="min-h-screen bg-[#f3f1ec] text-[#2a2723]">
      <div className="mx-auto max-w-[1280px] px-8 pt-7 pb-16">
        {/* SAYFA BAŞLIĞI */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[22px] font-semibold tracking-tight text-[#2a2723]">
              Fatura İşleme
            </h1>
            <span className="text-[13px] text-[#8a8270]">Moren Mali Müşavirlik</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TaxpayerPicker
              taxpayers={taxpayers}
              value={selectedTaxpayer}
              onChange={setSelectedTaxpayer}
            />
            <PeriodPicker value={period} onChange={setPeriod} />
            <button
              onClick={handleRefresh}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#e6e1d6] bg-white px-3 text-[13.5px] font-medium text-[#5b5447] transition hover:border-[#d4cfbf] hover:text-[#2a2723]"
              title="Verileri yenile"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Yenile
            </button>
          </div>
        </div>

        {/* WORKSPACE */}
        <div className="overflow-hidden rounded-[14px] border border-[#e6e1d6] bg-white shadow-[0_1px_2px_rgba(40,35,25,0.04)]">
          {/* TABS */}
          <nav className="flex overflow-x-auto border-b border-[#e6e1d6] px-[22px]">
            {STAGES.map((s) => {
              const active = stage === s.id;
              const count =
                s.id === 'sources'
                  ? 3
                  : s.id === 'pool'
                  ? documentsByStage.pool.length
                  : s.id === 'match'
                  ? documentsByStage.match.length + documentsByStage.pool.length
                  : s.id === 'vouchers'
                  ? documentsByStage.vouchers.length
                  : documentsByStage.luca.length;
              return (
                <button
                  key={s.id}
                  onClick={() => setStage(s.id)}
                  className={`-mb-[1px] inline-flex items-center gap-2 border-b-2 px-[18px] py-4 text-[14px] font-medium transition ${
                    active
                      ? 'border-[#4a8580] text-[#2f6863]'
                      : 'border-transparent text-[#8a8270] hover:text-[#2a2723]'
                  }`}
                >
                  {s.label}
                  <span
                    className={`rounded-[10px] px-2 py-[1px] text-[12px] font-medium ${
                      active ? 'bg-[#e2eceb] text-[#2f6863]' : 'bg-[#f8f6f1] text-[#8a8270]'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* SAHNE İÇERİĞİ */}
          {stage === 'sources' && (
            <SourcesStage
              taxpayerId={selectedTaxpayer}
              taxpayer={taxpayerMap.get(selectedTaxpayer)}
              period={period}
              onCompleted={handleRefresh}
              dashboardTotalPending={grandPending}
              dashboardTotalTransferred={grandTransferred}
            />
          )}
          {stage === 'pool' && (
            <PoolStage
              documents={documentsByStage.pool}
              taxpayerMap={taxpayerMap}
              onOpenForMatch={(id) => {
                setActiveDocId(id);
                setStage('match');
              }}
              isLoading={documentsQ.isLoading}
            />
          )}
          {stage === 'match' && (
            <MatchStage
              documents={[...documentsByStage.match, ...documentsByStage.pool]}
              taxpayerMap={taxpayerMap}
              activeId={activeDocId}
              onSelectDoc={setActiveDocId}
              onCompleted={handleRefresh}
            />
          )}
          {stage === 'vouchers' && (
            <VouchersStage
              documents={documentsByStage.vouchers}
              taxpayerMap={taxpayerMap}
              onEdit={(id) => {
                setActiveDocId(id);
                setStage('match');
              }}
              onCompleted={handleRefresh}
            />
          )}
          {stage === 'luca' && (
            <LucaStage documents={documentsByStage.luca} taxpayerMap={taxpayerMap} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ÜST SEÇİCİLER
   ════════════════════════════════════════════════════════════════════ */

function TaxpayerPicker({
  taxpayers,
  value,
  onChange,
}: {
  taxpayers: TaxpayerLite[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="min-w-[240px]">
      <TaxpayerSelect
        taxpayers={taxpayers}
        value={value}
        onChange={onChange}
        allLabel={`Tüm mükellefler · ${taxpayers.length}`}
        allValue=""
        placeholder="Mükellef seçin"
        style={{
          height: 36,
          borderRadius: 8,
          borderColor: '#e6e1d6',
          background: 'white',
          color: '#2a2723',
          fontSize: 13.5,
        }}
      />
    </div>
  );
}

function PeriodPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-[150px] appearance-none rounded-lg border border-[#e6e1d6] bg-white pl-[14px] pr-9 text-[13.5px] text-[#2a2723] transition hover:border-[#d4cfbf] focus:border-[#4a8580] focus:outline-none"
      >
        {periodOptions().map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8270]" />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   YENİDEN KULLANILANLAR
   ════════════════════════════════════════════════════════════════════ */

function WsBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e6e1d6] bg-[#f8f6f1] px-[22px] py-4">
      {children}
    </div>
  );
}

function Summary({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-1.5 text-[14px] text-[#5b5447]">{children}</div>;
}

function Sep() {
  return <span className="mx-1.5 text-[#b8b09b]">·</span>;
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-[#2a2723]">{children}</strong>;
}

function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
  children: React.ReactNode;
}) {
  const styles: Record<string, { bg: string; color: string; dot: string }> = {
    neutral: { bg: '#f8f6f1', color: '#5b5447', dot: '#8a8270' },
    success: { bg: '#e5eee0', color: '#466a4b', dot: '#5d8763' },
    warning: { bg: '#f1e4c8', color: '#7a572b', dot: '#a87a3d' },
    danger: { bg: '#eed5cf', color: '#6e3e38', dot: '#9a5851' },
    accent: { bg: '#e2eceb', color: '#2f6863', dot: '#4a8580' },
  };
  const s = styles[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[14px] px-2.5 py-[3px] text-[12px] font-medium leading-[1.4]"
      style={{ background: s.bg, color: s.color }}
    >
      <span className="h-[5px] w-[5px] rounded-full" style={{ background: s.dot }} />
      {children}
    </span>
  );
}

function ocrTone(confidence?: number | null) {
  if (confidence == null) return null;
  const pct = Math.round(confidence * 100);
  if (pct >= 85) return { tone: 'success' as const, label: `OCR %${pct}` };
  if (pct >= 60) return { tone: 'warning' as const, label: `OCR %${pct}` };
  return { tone: 'danger' as const, label: `OCR %${pct}` };
}

/* ════════════════════════════════════════════════════════════════════
   SAHNE 1 — KAYNAKLAR
   ════════════════════════════════════════════════════════════════════ */

function SourcesStage({
  taxpayerId,
  taxpayer,
  period,
  onCompleted,
  dashboardTotalPending,
  dashboardTotalTransferred,
}: {
  taxpayerId: string;
  taxpayer?: TaxpayerLite;
  period: string;
  onCompleted: () => void;
  dashboardTotalPending: number;
  dashboardTotalTransferred: number;
}) {
  const [activeSource, setActiveSource] = useState<SourceId>('integrator');

  const integrationsQ = useQuery<IntegrationRow[]>({
    queryKey: ['fim', 'integrations', taxpayerId || 'all'],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/integrations', {
          params: { taxpayerId: taxpayerId || undefined },
        })
        .then((r) => r.data),
  });

  const integrations = integrationsQ.data || [];
  const activeProvidersCount = integrations.filter(
    (i) => i.hasCredentials || i.isActive,
  ).length;

  return (
    <>
      <WsBar>
        <Summary>
          <Strong>{activeProvidersCount}</Strong> aktif sağlayıcı
          <Sep />
          Bu ay <Strong>{dashboardTotalPending}</Strong> bekleyen, <Strong>{dashboardTotalTransferred}</Strong> aktarıldı
        </Summary>
      </WsBar>

      {/* 3 kaynak kartı */}
      <div className="grid grid-cols-3 border-b border-[#e6e1d6]">
        <SourceCard
          number={1}
          name="Entegratör Çekimi"
          desc="e-Logo, Uyumsoft, Paraşüt vb. sağlayıcılardan gelen/giden e-Faturalar."
          stat={
            <>
              <Strong>{activeProvidersCount}</Strong> aktif sağlayıcı
            </>
          }
          active={activeSource === 'integrator'}
          onClick={() => setActiveSource('integrator')}
          isLast={false}
        />
        <SourceCard
          number={2}
          name="OCR Yükleme"
          desc="Fiş, Z raporu, makbuz, banka dekontu — yükle, otomatik tanıt."
          stat={<span>Azure Vision + Claude</span>}
          active={activeSource === 'ocr'}
          onClick={() => setActiveSource('ocr')}
          isLast={false}
        />
        <SourceCard
          number={3}
          name="e-Arşiv Köprü"
          desc="e-Arşiv modülünde mevcut belgeleri bu havuza taşı."
          stat={<span>Mükerrer kontrolü açık</span>}
          active={activeSource === 'earsiv'}
          onClick={() => setActiveSource('earsiv')}
          isLast
        />
      </div>

      {/* Aktif kaynağın detayı */}
      <div className="px-[22px] py-6">
        {activeSource === 'integrator' && (
          <IntegratorPanel
            integrations={integrations}
            integrationsLoading={integrationsQ.isLoading}
            taxpayerId={taxpayerId}
            taxpayer={taxpayer}
            period={period}
            onCompleted={onCompleted}
          />
        )}
        {activeSource === 'ocr' && (
          <OcrPanel
            taxpayerId={taxpayerId}
            taxpayer={taxpayer}
            onCompleted={onCompleted}
          />
        )}
        {activeSource === 'earsiv' && (
          <EarsivBridgePanel
            taxpayerId={taxpayerId}
            taxpayer={taxpayer}
            period={period}
            onCompleted={onCompleted}
          />
        )}
      </div>
    </>
  );
}

function SourceCard({
  number,
  name,
  desc,
  stat,
  active,
  onClick,
  isLast,
}: {
  number: number;
  name: string;
  desc: string;
  stat: React.ReactNode;
  active: boolean;
  onClick: () => void;
  isLast: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-6 text-left transition ${active ? 'bg-[#e2eceb]' : 'hover:bg-[#f8f6f1]'} ${
        isLast ? '' : 'border-r border-[#e6e1d6]'
      }`}
    >
      <div className="mb-2.5 flex items-center gap-2.5">
        <span
          className={`flex h-[26px] w-[26px] items-center justify-center rounded-md text-[13px] font-semibold ${
            active ? 'bg-[#4a8580] text-white' : 'bg-[#f8f6f1] text-[#5b5447]'
          }`}
        >
          {number}
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-[#2a2723]">{name}</span>
      </div>
      <p className="mb-3.5 text-[13px] leading-[1.6] text-[#5b5447]">{desc}</p>
      <div className="text-[12px] text-[#8a8270]">{stat}</div>
    </button>
  );
}

/* ─── Entegratör paneli ─── */

function IntegratorPanel({
  integrations,
  integrationsLoading,
  taxpayerId,
  taxpayer,
  period,
  onCompleted,
}: {
  integrations: IntegrationRow[];
  integrationsLoading: boolean;
  taxpayerId: string;
  taxpayer?: TaxpayerLite;
  period: string;
  onCompleted: () => void;
}) {
  const [direction, setDirection] = useState<Direction>('ALIS');
  const [selected, setSelected] = useState<string[]>([]);

  const activeProviders = useMemo(
    () => integrations.filter((i) => i.hasCredentials || i.isActive).map((i) => i.provider),
    [integrations],
  );

  useEffect(() => {
    setSelected(activeProviders);
  }, [activeProviders.join(',')]);

  const fetchMut = useMutation({
    mutationFn: async () => {
      if (!taxpayerId) throw new Error('Önce mükellef seçin');
      if (selected.length === 0) throw new Error('En az bir sağlayıcı seçin');
      return api
        .post('/fatura-muhasebelestirme/integrations/fetch', {
          taxpayerId,
          donem: period,
          direction,
          providers: selected,
          limit: 500,
        })
        .then((r) => r.data);
    },
    onSuccess: (data: { results?: Array<{ provider: string; imported?: number; count?: number; ok?: boolean; error?: string }> }) => {
      const results = data?.results || [];
      const total = results.reduce((acc, r) => acc + (r.imported ?? r.count ?? 0), 0);
      const failed = results.filter((r) => r.ok === false || r.error);
      if (total > 0) {
        toast.success(`${total} belge alındı`);
      }
      failed.forEach((r) => toast.error(`${r.provider}: ${r.error || 'hata'}`));
      if (total === 0 && failed.length === 0) {
        toast.info('Sonuç dönmedi · dönem boş olabilir');
      }
      onCompleted();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Çekim başarısız');
    },
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-[#2a2723]">Entegratör Çekimi</div>
          <div className="mt-0.5 text-[13px] text-[#8a8270]">
            Sağlayıcıları seç, yön belirle, çekimi başlat.
          </div>
        </div>
      </div>

      {/* Yön toggle */}
      <div className="mb-4 inline-flex rounded-lg border border-[#e6e1d6] bg-[#f8f6f1] p-[3px]">
        {(['ALIS', 'SATIS'] as Direction[]).map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium transition ${
              direction === d
                ? 'bg-white text-[#2a2723] shadow-[0_1px_2px_rgba(40,35,25,0.04)]'
                : 'text-[#8a8270] hover:text-[#2a2723]'
            }`}
          >
            {d === 'ALIS' ? 'Gelen faturalar' : 'Giden faturalar'}
          </button>
        ))}
      </div>

      {/* Sağlayıcı çipleri */}
      <div className="mb-[18px] flex flex-wrap gap-1.5">
        {PROVIDERS.map((p) => {
          const info = integrations.find((i) => i.provider === p.id);
          const has = !!info?.hasCredentials || !!info?.isActive;
          const on = selected.includes(p.id);
          return (
            <button
              key={p.id}
              onClick={() =>
                setSelected((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))
              }
              disabled={!taxpayerId}
              className={`inline-flex items-center gap-1.5 rounded-[18px] border px-3 py-1.5 text-[12.5px] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                on
                  ? 'border-[#2a2723] bg-[#2a2723] text-white'
                  : 'border-[#e6e1d6] bg-white text-[#5b5447] hover:border-[#d4cfbf]'
              }`}
            >
              <span
                className="h-[5px] w-[5px] rounded-full"
                style={{
                  background: has ? '#5d8763' : on ? 'rgba(255,255,255,0.5)' : '#b8b09b',
                }}
              />
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={() => fetchMut.mutate()}
          disabled={!taxpayerId || selected.length === 0 || fetchMut.isPending}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#4a8580] px-4 text-[13.5px] font-medium text-white transition hover:bg-[#2f6863] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {fetchMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Çekimi başlat
        </button>
        {!taxpayer && (
          <span className="text-[12.5px] text-[#a87a3d]">↖ Önce mükellef seç</span>
        )}
        {integrationsLoading && (
          <span className="inline-flex items-center gap-1 text-[12.5px] text-[#8a8270]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Sağlayıcılar yükleniyor...
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── OCR yükleme paneli ─── */

function OcrPanel({
  taxpayerId,
  taxpayer,
  onCompleted,
}: {
  taxpayerId: string;
  taxpayer?: TaxpayerLite;
  onCompleted: () => void;
}) {
  const [docType, setDocType] = useState<string>('OKC_FIS');
  const [invoiceKind, setInvoiceKind] = useState<Direction>('ALIS');
  const [forceClaude, setForceClaude] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadMut = useMutation({
    mutationFn: async (files: File[]) => {
      if (!taxpayerId) throw new Error('Önce mükellef seçin');
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      form.append('taxpayerId', taxpayerId);
      form.append('source', 'manual-web');
      form.append('documentType', docType);
      form.append('invoiceKind', invoiceKind);
      if (forceClaude) form.append('forceClaude', 'true');
      return api
        .post('/fatura-muhasebelestirme/documents/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120_000,
        })
        .then((r) => r.data);
    },
    onSuccess: (data: unknown) => {
      const count = Array.isArray(data) ? data.length : 1;
      toast.success(`${count} belge işlendi`);
      onCompleted();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'OCR başarısız');
    },
  });

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    uploadMut.mutate(Array.from(files));
  };

  return (
    <div>
      <div className="mb-4">
        <div className="text-[15px] font-semibold text-[#2a2723]">OCR Yükleme</div>
        <div className="mt-0.5 text-[13px] text-[#8a8270]">
          Belgeyi bırak, sistem otomatik tanıt ve havuza ekle.
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 max-w-[640px]">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-[#5b5447]">Belge Tipi</label>
          <div className="relative">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="h-9 w-full appearance-none rounded-lg border border-[#e6e1d6] bg-white px-3 pr-9 text-[13.5px] text-[#2a2723] focus:border-[#4a8580] focus:outline-none"
            >
              <option value="OKC_FIS">ÖKC Fişi</option>
              <option value="Z_RAPORU">Z Raporu</option>
              <option value="FIS">Fiş / Makbuz</option>
              <option value="E_FATURA">e-Fatura (XML)</option>
              <option value="E_ARSIV">e-Arşiv (PDF)</option>
              <option value="DIGER">Diğer</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a8270]" />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-[#5b5447]">Yön</label>
          <div className="relative">
            <select
              value={invoiceKind}
              onChange={(e) => setInvoiceKind(e.target.value as Direction)}
              className="h-9 w-full appearance-none rounded-lg border border-[#e6e1d6] bg-white px-3 pr-9 text-[13.5px] text-[#2a2723] focus:border-[#4a8580] focus:outline-none"
            >
              <option value="ALIS">Alış</option>
              <option value="SATIS">Satış</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a8270]" />
          </div>
        </div>
      </div>

      <label className="mb-4 inline-flex cursor-pointer items-center gap-2 text-[13px] text-[#5b5447]">
        <input
          type="checkbox"
          checked={forceClaude}
          onChange={(e) => setForceClaude(e.target.checked)}
          className="h-[14px] w-[14px] accent-[#4a8580]"
        />
        Sadece Claude OCR (Azure'u atla)
      </label>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`relative cursor-pointer rounded-[10px] border-2 border-dashed py-12 text-center transition max-w-[640px] ${
          drag
            ? 'border-[#4a8580] bg-[#e2eceb]'
            : 'border-[#e6e1d6] bg-[#f8f6f1] hover:border-[#b8d0cc]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.xml"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploadMut.isPending ? (
          <>
            <Loader2 className="mx-auto mb-2 h-7 w-7 animate-spin text-[#4a8580]" />
            <div className="text-[14px] font-medium text-[#5b5447]">OCR çalışıyor...</div>
          </>
        ) : (
          <>
            <Upload className="mx-auto mb-3 h-7 w-7 text-[#8a8270]" />
            <div className="text-[14px] font-medium text-[#5b5447]">Bırak veya seç</div>
            <div className="mt-1 text-[12px] text-[#b8b09b]">
              .jpg .png .pdf .xml · max 25 MB
            </div>
          </>
        )}
      </div>

      {!taxpayer && (
        <p className="mt-3 text-[12.5px] text-[#a87a3d]">↖ Önce mükellef seç</p>
      )}
    </div>
  );
}

/* ─── e-Arşiv köprü paneli ─── */

function EarsivBridgePanel({
  taxpayerId,
  taxpayer,
  period,
  onCompleted,
}: {
  taxpayerId: string;
  taxpayer?: TaxpayerLite;
  period: string;
  onCompleted: () => void;
}) {
  const [tip, setTip] = useState<string>('all');

  const lucaFetchMut = useMutation({
    mutationFn: async () => {
      if (!taxpayerId) throw new Error('Mükellef seçin');
      return api
        .post('/earsiv/fetch-from-luca', { taxpayerId, donem: period })
        .then((r) => r.data);
    },
    onSuccess: (data: { jobId?: string }) => {
      toast.success(`Luca işi başlatıldı${data?.jobId ? ` · ${data.jobId.slice(0, 8)}` : ''}`);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Luca hatası');
    },
  });

  const backfillMut = useMutation({
    mutationFn: async () => {
      if (!taxpayerId) throw new Error('Mükellef seçin');
      return api
        .post('/fatura-muhasebelestirme/documents/backfill-earsiv', {
          taxpayerId,
          donem: period,
          tip: tip === 'all' ? undefined : tip,
          limit: 500,
        })
        .then((r) => r.data);
    },
    onSuccess: (data: { imported?: number; skipped?: number }) => {
      toast.success(`${data?.imported ?? 0} aktarıldı, ${data?.skipped ?? 0} atlandı`);
      onCompleted();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Köprü hatası');
    },
  });

  return (
    <div className="max-w-[640px]">
      <div className="mb-4">
        <div className="text-[15px] font-semibold text-[#2a2723]">e-Arşiv Köprü</div>
        <div className="mt-0.5 text-[13px] text-[#8a8270]">
          İki adım: önce Luca'dan listele, ardından havuza aktar.
        </div>
      </div>

      <div className="mb-4">
        <label className="mb-1.5 block text-[12px] font-medium text-[#5b5447]">Tip</label>
        <div className="relative max-w-[220px]">
          <select
            value={tip}
            onChange={(e) => setTip(e.target.value)}
            className="h-9 w-full appearance-none rounded-lg border border-[#e6e1d6] bg-white px-3 pr-9 text-[13.5px] text-[#2a2723] focus:border-[#4a8580] focus:outline-none"
          >
            <option value="all">Tümü</option>
            <option value="GELEN">Gelen</option>
            <option value="GIDEN">Giden</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a8270]" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <button
          onClick={() => lucaFetchMut.mutate()}
          disabled={!taxpayerId || lucaFetchMut.isPending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#e6e1d6] bg-white text-[13.5px] font-medium text-[#5b5447] transition hover:border-[#d4cfbf] hover:text-[#2a2723] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {lucaFetchMut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className="text-[#4a8580]">1.</span>
          )}
          Luca'dan çek
        </button>
        <button
          onClick={() => backfillMut.mutate()}
          disabled={!taxpayerId || backfillMut.isPending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#4a8580] text-[13.5px] font-medium text-white transition hover:bg-[#2f6863] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {backfillMut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className="opacity-70">2.</span>
          )}
          Havuza aktar
        </button>
      </div>

      {!taxpayer && (
        <p className="mt-3 text-[12.5px] text-[#a87a3d]">↖ Önce mükellef seç</p>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   SAHNE 2 — HAVUZ
   ════════════════════════════════════════════════════════════════════ */

function PoolStage({
  documents,
  taxpayerMap,
  onOpenForMatch,
  isLoading,
}: {
  documents: ApiDocument[];
  taxpayerMap: Map<string, TaxpayerLite>;
  onOpenForMatch: (id: string) => void;
  isLoading: boolean;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return documents;
    const q = query.toLocaleLowerCase('tr');
    return documents.filter((d) => {
      const haystack = [
        d.vendorName,
        d.customerName,
        d.originalName,
        d.belgeNo,
        d.taxpayerId ? taxpayerLabel(taxpayerMap.get(d.taxpayerId)) : null,
      ]
        .filter(Boolean)
        .join(' · ')
        .toLocaleLowerCase('tr');
      return haystack.includes(q);
    });
  }, [documents, query, taxpayerMap]);

  const total = documents.length;
  const newToday = documents.filter((d) => {
    if (!d.createdAt) return false;
    const c = new Date(d.createdAt);
    const t = new Date();
    return (
      c.getDate() === t.getDate() &&
      c.getMonth() === t.getMonth() &&
      c.getFullYear() === t.getFullYear()
    );
  }).length;
  const duplicates = documents.filter((d) => !!d.duplicateOfId).length;
  const totalAmount = documents.reduce((acc, d) => acc + parseNum(d.totalAmount), 0);

  return (
    <>
      <WsBar>
        <Summary>
          <Strong>{total}</Strong> belge
          <Sep />
          <Strong>{newToday}</Strong> bugün geldi
          <Sep />
          <Strong>{duplicates}</Strong> mükerrer uyarısı
          <Sep />
          <Strong>{fmtMoney(totalAmount)} ₺</Strong> toplam
        </Summary>
        <div className="flex items-center gap-2">
          <div className="flex h-9 items-center gap-2 rounded-lg border border-[#e6e1d6] bg-white px-3 w-[280px] focus-within:border-[#4a8580]">
            <Search className="h-3.5 w-3.5 text-[#8a8270]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Satıcı, müşteri, belge no..."
              className="w-full bg-transparent text-[13.5px] text-[#2a2723] placeholder:text-[#b8b09b] focus:outline-none"
            />
          </div>
        </div>
      </WsBar>

      {isLoading ? (
        <div className="px-[22px] py-16 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#8a8270]" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Havuz boş"
          desc={query ? 'Arama kriterine uyan belge yok.' : 'Stage 1\'den belge ekleyebilirsin.'}
        />
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Belge</Th>
              <Th>Mükellef</Th>
              <Th>Tarih</Th>
              <Th right>Tutar</Th>
              <Th right>Durum</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const tp = d.taxpayerId ? taxpayerMap.get(d.taxpayerId) : undefined;
              const ocr = ocrTone(d.ocrConfidence);
              const isDuplicate = !!d.duplicateOfId;
              const docType = DOC_TYPE_LABEL[d.documentType || ''] || d.documentType || '';
              return (
                <Tr key={d.id}>
                  <Td>
                    <div className="flex flex-col gap-0.5">
                      <strong className="text-[14px] font-medium text-[#2a2723]">
                        {d.vendorName || d.customerName || d.originalName || '—'}
                      </strong>
                      <small className="text-[12px] text-[#8a8270]">
                        {docType}
                        {d.belgeNo ? ` · ${d.belgeNo}` : ''}
                      </small>
                    </div>
                  </Td>
                  <Td>{tp ? taxpayerLabel(tp) : '—'}</Td>
                  <Td>{fmtDate(d.faturaTarihi || d.createdAt)}</Td>
                  <Td right>
                    <span className="font-medium tabular-nums">{fmtMoney(d.totalAmount)} ₺</span>
                  </Td>
                  <Td right>
                    {isDuplicate ? (
                      <Badge tone="warning">Mükerrer?</Badge>
                    ) : ocr ? (
                      <Badge tone={ocr.tone}>{ocr.label}</Badge>
                    ) : (
                      <Badge tone="neutral">Yeni</Badge>
                    )}
                  </Td>
                  <Td right>
                    <button
                      onClick={() => onOpenForMatch(d.id)}
                      className="inline-flex items-center gap-1 text-[13px] font-medium text-[#2f6863] transition hover:text-[#4a8580] hover:underline"
                    >
                      Eşleştir
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

function Th({
  children,
  right,
}: {
  children?: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`border-b border-[#e6e1d6] bg-[#f8f6f1] px-[22px] py-3 text-[12px] font-medium text-[#8a8270] ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Tr({ children }: { children: React.ReactNode }) {
  return <tr className="group transition hover:bg-[#f8f6f1]">{children}</tr>;
}

function Td({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <td
      className={`border-b border-[#e6e1d6] px-[22px] py-3.5 text-[14px] align-middle ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </td>
  );
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="px-[22px] py-16 text-center">
      <div className="mb-1 text-[15px] font-medium text-[#5b5447]">{title}</div>
      <div className="text-[13px] text-[#8a8270]">{desc}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   SAHNE 3 — EŞLEŞTİRME
   ════════════════════════════════════════════════════════════════════ */

function MatchStage({
  documents,
  taxpayerMap,
  activeId,
  onSelectDoc,
  onCompleted,
}: {
  documents: ApiDocument[];
  taxpayerMap: Map<string, TaxpayerLite>;
  activeId: string | null;
  onSelectDoc: (id: string | null) => void;
  onCompleted: () => void;
}) {
  const active = documents.find((d) => d.id === activeId) || documents[0] || null;

  return (
    <>
      <WsBar>
        <Summary>
          <Strong>{documents.length}</Strong> belge eşleştirme sırasında
        </Summary>
      </WsBar>

      <div className="grid grid-cols-[280px_1fr] min-h-[600px]">
        {/* Sol: sırada listesi */}
        <div className="border-r border-[#e6e1d6] bg-[#f8f6f1]">
          <div className="flex items-center justify-between border-b border-[#e6e1d6] px-[18px] py-3.5">
            <span className="text-[13px] font-medium text-[#8a8270]">Sırada</span>
            <span className="text-[13px] font-medium text-[#8a8270]">{documents.length}</span>
          </div>
          <div className="max-h-[calc(100vh-360px)] overflow-y-auto">
            {documents.length === 0 ? (
              <div className="py-10 text-center text-[12.5px] text-[#8a8270]">
                Eşleştirme sırasında belge yok
              </div>
            ) : (
              documents.map((d) => {
                const isActive = d.id === (active?.id || null);
                return (
                  <button
                    key={d.id}
                    onClick={() => onSelectDoc(d.id)}
                    className={`block w-full border-b border-[#e6e1d6] px-[18px] py-3.5 text-left transition ${
                      isActive
                        ? 'bg-white shadow-[inset_3px_0_0_#4a8580]'
                        : 'hover:bg-white'
                    }`}
                  >
                    <div className="truncate text-[14px] font-medium text-[#2a2723]">
                      {d.vendorName || d.customerName || d.originalName || 'Adsız'}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-[#8a8270]">
                      {fmtMoney(d.totalAmount)} ₺ · {fmtDate(d.faturaTarihi)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Sağ: editör */}
        <div>
          {active ? (
            <DocumentEditor
              key={active.id}
              doc={active}
              taxpayer={active.taxpayerId ? taxpayerMap.get(active.taxpayerId) : undefined}
              onCompleted={onCompleted}
              onSkip={() => {
                const idx = documents.findIndex((d) => d.id === active.id);
                const next = documents[idx + 1] || documents[0];
                onSelectDoc(next?.id || null);
              }}
            />
          ) : (
            <EmptyState
              title="Eşleştirme sırasında belge yok"
              desc="Havuza yeni belge ekledikçe burada görünür."
            />
          )}
        </div>
      </div>
    </>
  );
}

/* ─── Belge editörü ─── */

function DocumentEditor({
  doc,
  taxpayer,
  onCompleted,
  onSkip,
}: {
  doc: ApiDocument;
  taxpayer?: TaxpayerLite;
  onCompleted: () => void;
  onSkip: () => void;
}) {
  const qc = useQueryClient();

  const [lines, setLines] = useState<ApiLine[]>(() => doc.lines || []);
  const [accountSearch, setAccountSearch] = useState('');

  useEffect(() => {
    setLines(doc.lines || []);
  }, [doc.id]);

  const accountPlanQ = useQuery<AccountPlanNode[]>({
    queryKey: ['fim', 'account-plan', doc.taxpayerId, accountSearch],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/account-plan', {
          params: { taxpayerId: doc.taxpayerId, q: accountSearch || undefined, limit: 60 },
        })
        .then((r) => r.data),
    enabled: !!doc.taxpayerId,
    staleTime: 60_000,
  });

  const refreshPlanMut = useMutation({
    mutationFn: () =>
      api
        .post('/fatura-muhasebelestirme/account-plan/refresh', { taxpayerId: doc.taxpayerId })
        .then((r) => r.data),
    onSuccess: () => {
      toast.success('Hesap planı Luca\'dan yenilendi');
      qc.invalidateQueries({ queryKey: ['fim', 'account-plan'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Hesap planı yenileme başarısız');
    },
  });

  const saveMut = useMutation({
    mutationFn: () =>
      api
        .patch(`/fatura-muhasebelestirme/documents/${doc.id}`, { lines })
        .then((r) => r.data),
    onSuccess: () => {
      toast.success('Kaydedildi');
      qc.invalidateQueries({ queryKey: ['fim', 'documents'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Kayıt başarısız');
    },
  });

  const readyMut = useMutation({
    mutationFn: () =>
      api
        .patch(`/fatura-muhasebelestirme/documents/${doc.id}`, { status: 'READY', lines })
        .then((r) => r.data),
    onSuccess: () => {
      toast.success('Fiş hazır olarak işaretlendi');
      onCompleted();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'İşaretleme başarısız');
    },
  });

  const approveMut = useMutation({
    mutationFn: () =>
      api.post(`/fatura-muhasebelestirme/documents/${doc.id}/approve`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Luca\'ya aktarıldı');
      onCompleted();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Aktarım başarısız');
    },
  });

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    lines.forEach((l) => {
      debit += parseNum(l.debit);
      credit += parseNum(l.credit);
    });
    return { debit, credit, diff: debit - credit };
  }, [lines]);

  const balanced = Math.abs(totals.diff) < 0.01;

  const addLine = () => {
    setLines((arr) => [
      ...arr,
      { group: 'Yevmiye', accountCode: '', description: '', debit: '0', credit: '0' },
    ]);
  };

  const updateLine = (idx: number, patch: Partial<ApiLine>) => {
    setLines((arr) => arr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const removeLine = (idx: number) => {
    setLines((arr) => arr.filter((_, i) => i !== idx));
  };

  const pickAccount = (node: AccountPlanNode) => {
    const idx = lines.findIndex((l) => !l.accountCode);
    if (idx >= 0) {
      updateLine(idx, { accountCode: node.code, description: node.name });
    } else {
      setLines((arr) => [
        ...arr,
        {
          group: 'Yevmiye',
          accountCode: node.code,
          description: node.name,
          debit: '0',
          credit: '0',
        },
      ]);
    }
  };

  const docType = DOC_TYPE_LABEL[doc.documentType || ''] || doc.documentType || '';

  return (
    <div className="p-6">
      {/* Başlık */}
      <div className="mb-5">
        <h2 className="text-[20px] font-semibold tracking-tight text-[#2a2723]">
          {doc.vendorName || doc.customerName || doc.originalName || 'Adsız belge'}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-[#8a8270]">
          {docType && <span>{docType}</span>}
          {doc.belgeNo && (
            <>
              <span className="text-[#b8b09b]">·</span>
              <span>{doc.belgeNo}</span>
            </>
          )}
          {doc.faturaTarihi && (
            <>
              <span className="text-[#b8b09b]">·</span>
              <span>{fmtDate(doc.faturaTarihi)}</span>
            </>
          )}
          {taxpayer && (
            <>
              <span className="text-[#b8b09b]">·</span>
              <span>{taxpayerLabel(taxpayer)}</span>
            </>
          )}
        </div>
        <div className="mt-3 text-[24px] font-semibold tracking-tight text-[#2a2723] tabular-nums">
          {fmtMoney(doc.totalAmount)} ₺
        </div>
      </div>

      {/* Uyarılar */}
      {doc.duplicateReason && (
        <div
          className={`mb-5 rounded-lg border-l-[3px] px-4 py-3 text-[13px] leading-[1.55] ${
            doc.duplicateSeverity === 'BLOCKING'
              ? 'border-[#9a5851] bg-[#eed5cf] text-[#6e3e38]'
              : 'border-[#a87a3d] bg-[#f1e4c8] text-[#6f5022]'
          }`}
        >
          <strong>{doc.duplicateSeverity === 'BLOCKING' ? 'Mükerrer engelliyor.' : 'Mükerrer uyarısı.'}</strong>{' '}
          {doc.duplicateReason}
        </div>
      )}

      {/* Satırlar */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-[#5b5447]">
            Muhasebe fişi · {lines.length} satır
          </span>
          <span
            className={`text-[13px] font-medium ${
              balanced ? 'text-[#5d8763]' : 'text-[#9a5851]'
            }`}
          >
            {balanced ? '✓ Dengeli' : `Fark: ${fmtMoney(Math.abs(totals.diff))} ₺`}
          </span>
        </div>

        <div className="overflow-hidden rounded-[10px] border border-[#e6e1d6]">
          <div className="grid grid-cols-[110px_1fr_130px_130px_40px] bg-[#f8f6f1] text-[12px] font-medium text-[#8a8270]">
            <div className="px-3.5 py-[11px]">Grup</div>
            <div className="px-3.5 py-[11px]">Hesap</div>
            <div className="px-3.5 py-[11px] text-right">Borç</div>
            <div className="px-3.5 py-[11px] text-right">Alacak</div>
            <div></div>
          </div>
          {lines.length === 0 && (
            <div className="border-t border-[#e6e1d6] px-3.5 py-5 text-center text-[12.5px] text-[#8a8270]">
              Satır yok · ↘ Hesap planından sürükle ya da + ekle
            </div>
          )}
          {lines.map((l, i) => (
            <div
              key={i}
              className="grid grid-cols-[110px_1fr_130px_130px_40px] border-t border-[#e6e1d6]"
            >
              <input
                value={l.group || ''}
                onChange={(e) => updateLine(i, { group: e.target.value })}
                className="bg-transparent px-3.5 py-3 text-[14px] text-[#2a2723] placeholder:text-[#b8b09b] focus:bg-[#e2eceb] focus:outline-none"
                placeholder="—"
              />
              <input
                value={
                  l.accountCode
                    ? l.description
                      ? `${l.accountCode} · ${l.description}`
                      : String(l.accountCode)
                    : ''
                }
                onChange={(e) => {
                  const v = e.target.value;
                  const m = v.match(/^([^\s·]+)\s*[·\-]?\s*(.*)$/);
                  if (m) {
                    updateLine(i, { accountCode: m[1] || '', description: m[2] || '' });
                  } else {
                    updateLine(i, { accountCode: v, description: '' });
                  }
                }}
                className="bg-transparent px-3.5 py-3 text-[14px] text-[#2a2723] placeholder:text-[#b8b09b] focus:bg-[#e2eceb] focus:outline-none"
                placeholder="Hesap kodu · ad"
              />
              <input
                value={l.debit?.toString() ?? ''}
                onChange={(e) => updateLine(i, { debit: e.target.value })}
                className="bg-transparent px-3.5 py-3 text-right text-[14px] font-medium tabular-nums text-[#2a2723] placeholder:text-[#b8b09b] focus:bg-[#e2eceb] focus:outline-none"
                placeholder="—"
              />
              <input
                value={l.credit?.toString() ?? ''}
                onChange={(e) => updateLine(i, { credit: e.target.value })}
                className="bg-transparent px-3.5 py-3 text-right text-[14px] font-medium tabular-nums text-[#2a2723] placeholder:text-[#b8b09b] focus:bg-[#e2eceb] focus:outline-none"
                placeholder="—"
              />
              <button
                onClick={() => removeLine(i)}
                className="text-[#b8b09b] transition hover:text-[#9a5851]"
                title="Satırı sil"
              >
                <X className="mx-auto h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {lines.length > 0 && (
            <div className="grid grid-cols-[110px_1fr_130px_130px_40px] border-t border-[#e6e1d6] bg-[#f8f6f1] font-semibold">
              <div className="col-span-2 px-3.5 py-3 text-right text-[14px] font-medium text-[#5b5447]">
                Toplam
              </div>
              <div className="px-3.5 py-3 text-right text-[14px] tabular-nums">
                {fmtMoney(totals.debit)}
              </div>
              <div className="px-3.5 py-3 text-right text-[14px] tabular-nums">
                {fmtMoney(totals.credit)}
              </div>
              <div></div>
            </div>
          )}
        </div>

        <button
          onClick={addLine}
          className="mt-2 inline-flex h-7 items-center gap-1 rounded-md text-[13px] font-medium text-[#5b5447] transition hover:bg-[#f8f6f1] hover:text-[#2a2723] px-2"
        >
          + Satır ekle
        </button>
      </div>

      {/* Hesap planı */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-[#5b5447]">
            Hesap planından ekle
          </span>
          <button
            onClick={() => refreshPlanMut.mutate()}
            disabled={refreshPlanMut.isPending || !doc.taxpayerId}
            className="inline-flex h-7 items-center gap-1.5 rounded-md text-[13px] font-medium text-[#5b5447] transition hover:bg-[#f8f6f1] hover:text-[#2a2723] px-2.5 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refreshPlanMut.isPending ? 'animate-spin' : ''}`} />
            Luca'dan yenile
          </button>
        </div>
        <div className="mb-3.5 flex h-9 items-center gap-2 rounded-lg border border-[#e6e1d6] bg-[#f8f6f1] px-3.5">
          <Search className="h-3.5 w-3.5 text-[#8a8270]" />
          <input
            value={accountSearch}
            onChange={(e) => setAccountSearch(e.target.value)}
            placeholder="Hesap kodu veya adı..."
            className="w-full bg-transparent text-[14px] text-[#2a2723] placeholder:text-[#b8b09b] focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-4 gap-0.5 max-h-[280px] overflow-y-auto">
          {accountPlanQ.isLoading && (
            <div className="col-span-4 py-6 text-center">
              <Loader2 className="mx-auto h-4 w-4 animate-spin text-[#8a8270]" />
            </div>
          )}
          {!accountPlanQ.isLoading && (accountPlanQ.data || []).length === 0 && (
            <div className="col-span-4 py-6 text-center text-[12.5px] text-[#8a8270]">
              {doc.taxpayerId
                ? 'Hesap planı boş · Luca\'dan yenile butonuna tıkla'
                : 'Belgeye mükellef ata'}
            </div>
          )}
          {(accountPlanQ.data || []).map((node) => (
            <button
              key={node.code}
              onClick={() => pickAccount(node)}
              className="flex items-baseline gap-2 rounded-md px-3 py-2 text-left transition hover:bg-[#e2eceb]"
            >
              <span className="shrink-0 text-[13px] font-semibold text-[#2f6863]">
                {node.code}
              </span>
              <span className="truncate text-[13px] text-[#5b5447]">{node.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Footer aksiyonlar */}
      <div className="mt-6 flex items-center gap-2.5 border-t border-[#e6e1d6] pt-5">
        <button
          onClick={onSkip}
          className="inline-flex h-9 items-center justify-center rounded-lg px-3.5 text-[13.5px] font-medium text-[#5b5447] transition hover:bg-[#f8f6f1] hover:text-[#2a2723]"
        >
          Atla
        </button>
        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#e6e1d6] bg-white px-3.5 text-[13.5px] font-medium text-[#5b5447] transition hover:border-[#d4cfbf] hover:text-[#2a2723] disabled:opacity-50"
        >
          {saveMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Kaydet
        </button>

        <div className="ml-auto flex items-center gap-2">
          {doc.status === 'READY' && (
            <button
              onClick={() => approveMut.mutate()}
              disabled={approveMut.isPending}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#4a8580] px-4 text-[13.5px] font-medium text-white transition hover:bg-[#2f6863] disabled:opacity-50"
            >
              {approveMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <Check className="h-3.5 w-3.5" />
              Luca'ya aktar
            </button>
          )}
          {doc.status !== 'READY' && (
            <button
              onClick={() => readyMut.mutate()}
              disabled={!balanced || lines.length === 0 || readyMut.isPending}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#4a8580] px-4 text-[13.5px] font-medium text-white transition hover:bg-[#2f6863] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {readyMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <Check className="h-3.5 w-3.5" />
              Fiş tamamlandı
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   SAHNE 4 — FİŞLER
   ════════════════════════════════════════════════════════════════════ */

function VouchersStage({
  documents,
  taxpayerMap,
  onEdit,
  onCompleted,
}: {
  documents: ApiDocument[];
  taxpayerMap: Map<string, TaxpayerLite>;
  onEdit: (id: string) => void;
  onCompleted: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const totalAmount = documents.reduce((acc, d) => acc + parseNum(d.totalAmount), 0);

  const toggleAll = () => {
    if (selected.size === documents.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(documents.map((d) => d.id)));
    }
  };

  const bulkApproveMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const id of ids) {
        try {
          await api.post(`/fatura-muhasebelestirme/documents/${id}/approve`);
          results.push({ id, ok: true });
        } catch (e) {
          const err = e as { message?: string };
          results.push({ id, ok: false, error: err.message || 'hata' });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok).length;
      if (ok > 0) toast.success(`${ok} fiş Luca'ya aktarıldı`);
      if (failed > 0) toast.error(`${failed} fiş başarısız`);
      setSelected(new Set());
      onCompleted();
    },
  });

  const handleBulkApprove = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    bulkApproveMut.mutate(ids);
  };

  const handleSingleApprove = (id: string) => {
    bulkApproveMut.mutate([id]);
  };

  return (
    <>
      <WsBar>
        <Summary>
          <Strong>{documents.length}</Strong> fiş hazır
          <Sep />
          <Strong>{fmtMoney(totalAmount)} ₺</Strong> toplam
          {selected.size > 0 && (
            <>
              <Sep />
              <Strong>{selected.size}</Strong> seçili
            </>
          )}
        </Summary>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAll}
            disabled={documents.length === 0}
            className="inline-flex h-[30px] items-center rounded-md border border-[#e6e1d6] bg-white px-2.5 text-[13px] font-medium text-[#5b5447] transition hover:border-[#d4cfbf] hover:text-[#2a2723] disabled:opacity-50"
          >
            {selected.size === documents.length && documents.length > 0 ? 'Seçimi temizle' : 'Tümünü seç'}
          </button>
          <button
            onClick={handleBulkApprove}
            disabled={selected.size === 0 || bulkApproveMut.isPending}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-md bg-[#4a8580] px-2.5 text-[13px] font-medium text-white transition hover:bg-[#2f6863] disabled:opacity-50"
          >
            {bulkApproveMut.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            Luca'ya aktar{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
      </WsBar>

      {documents.length === 0 ? (
        <EmptyState
          title="Hazır fiş yok"
          desc="Eşleştirme aşamasında fiş tamamlandığında burada görünür."
        />
      ) : (
        <div>
          {documents.map((d) => {
            const tp = d.taxpayerId ? taxpayerMap.get(d.taxpayerId) : undefined;
            const isSel = selected.has(d.id);
            const lineCount = (d.lines || []).length;
            const docType = DOC_TYPE_LABEL[d.documentType || ''] || d.documentType || '';
            return (
              <div
                key={d.id}
                className="grid grid-cols-[24px_1fr_160px_100px_80px_180px] items-center gap-4 border-b border-[#e6e1d6] px-[22px] py-4 transition last:border-b-0 hover:bg-[#f8f6f1]"
              >
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={() =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (n.has(d.id)) n.delete(d.id);
                      else n.add(d.id);
                      return n;
                    })
                  }
                  className="h-4 w-4 accent-[#4a8580]"
                />
                <div>
                  <div className="text-[14px] font-medium text-[#2a2723]">
                    {d.vendorName || d.customerName || d.originalName || 'Adsız'}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-[#8a8270]">
                    {tp ? `${taxpayerLabel(tp)} · ` : ''}
                    {docType}
                    {d.faturaTarihi ? ` · ${fmtDate(d.faturaTarihi)}` : ''}
                  </div>
                </div>
                <div className="text-right text-[15px] font-semibold tabular-nums text-[#2a2723]">
                  {fmtMoney(d.totalAmount)} ₺
                </div>
                <div className="text-right text-[13px] text-[#8a8270]">
                  {lineCount} satır
                </div>
                <Badge tone="success">Hazır</Badge>
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => onEdit(d.id)}
                    className="inline-flex h-[30px] items-center rounded-md border border-[#e6e1d6] bg-white px-2.5 text-[13px] font-medium text-[#5b5447] transition hover:border-[#d4cfbf] hover:text-[#2a2723]"
                  >
                    Düzenle
                  </button>
                  <button
                    onClick={() => handleSingleApprove(d.id)}
                    disabled={bulkApproveMut.isPending}
                    className="inline-flex h-[30px] items-center rounded-md bg-[#4a8580] px-2.5 text-[13px] font-medium text-white transition hover:bg-[#2f6863] disabled:opacity-50"
                  >
                    Aktar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════
   SAHNE 5 — LUCA JURNAL
   ════════════════════════════════════════════════════════════════════ */

function LucaStage({
  documents,
  taxpayerMap,
}: {
  documents: ApiDocument[];
  taxpayerMap: Map<string, TaxpayerLite>;
}) {
  const grouped = useMemo(() => {
    const m = new Map<string, ApiDocument[]>();
    documents.forEach((d) => {
      const key = d.approvedAt || d.createdAt || '';
      const day = key ? new Date(key).toISOString().slice(0, 10) : '—';
      if (!m.has(day)) m.set(day, []);
      m.get(day)!.push(d);
    });
    return Array.from(m.entries()).sort((a, b) => (a[0] > b[0] ? -1 : 1));
  }, [documents]);

  const totalAmount = documents.reduce((acc, d) => acc + parseNum(d.totalAmount), 0);
  const success = documents.length; // hepsi APPROVED bu listede
  const successRate = success > 0 ? 100 : 0;

  return (
    <>
      <WsBar>
        <Summary>
          <Strong>{documents.length}</Strong> fiş bu ay aktarıldı
          <Sep />
          <Strong>{fmtMoney(totalAmount)} ₺</Strong> toplam
          <Sep />
          Başarı oranı <Strong>%{successRate}</Strong>
        </Summary>
      </WsBar>

      {grouped.length === 0 ? (
        <EmptyState
          title="Henüz transfer yok"
          desc="Fişler aktarıldıkça burada gün bazlı jurnal halinde listelenir."
        />
      ) : (
        <div>
          {grouped.map(([day, items]) => {
            const dayTotal = items.reduce((acc, d) => acc + parseNum(d.totalAmount), 0);
            return (
              <div key={day} className="border-b border-[#e6e1d6] last:border-b-0">
                <div className="flex items-center gap-3.5 border-b border-[#e6e1d6] bg-[#f8f6f1] px-[22px] py-3.5">
                  <span className="text-[13px] font-medium text-[#5b5447]">
                    {fmtDateLong(day) || day}
                  </span>
                  <span className="flex-1 h-px bg-[#e6e1d6]" />
                  <span className="text-[13px] text-[#8a8270]">
                    {items.length} kayıt · {fmtMoney(dayTotal)} ₺
                  </span>
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <Th>Belge</Th>
                      <Th>Mükellef</Th>
                      <Th>Saat</Th>
                      <Th right>Tutar</Th>
                      <Th right>Durum</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((d) => {
                      const tp = d.taxpayerId ? taxpayerMap.get(d.taxpayerId) : undefined;
                      return (
                        <Tr key={d.id}>
                          <Td>
                            <div className="flex flex-col gap-0.5">
                              <strong className="text-[14px] font-medium text-[#2a2723]">
                                {d.vendorName || d.customerName || d.originalName || '—'}
                              </strong>
                              {d.belgeNo && (
                                <small className="text-[12px] text-[#8a8270]">{d.belgeNo}</small>
                              )}
                            </div>
                          </Td>
                          <Td>{tp ? taxpayerLabel(tp) : '—'}</Td>
                          <Td>{fmtTime(d.approvedAt || d.createdAt)}</Td>
                          <Td right>
                            <span className="font-medium tabular-nums">
                              {fmtMoney(d.totalAmount)} ₺
                            </span>
                          </Td>
                          <Td right>
                            <Badge tone="success">Aktarıldı</Badge>
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
