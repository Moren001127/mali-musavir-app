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
  tone?: string;
  isActive?: boolean;
  /** Bu mükellef için credential set edilmiş mi (backend her zaman döner) */
  configured?: boolean;
  /** Bu mükellefe özel config var mı (global'den fallback değil) */
  taxpayerScoped?: boolean;
  hasCredentials?: boolean;
  hasApiKey?: boolean;
  hasApiSecret?: boolean;
  hasPassword?: boolean;
  baseUrl?: string;
  username?: string;
  senderVkn?: string;
  accountId?: string;
  note?: string;
  lastSyncAt?: string | null;
  updatedAt?: string | null;
  config?: unknown;
}

/* Provider'a göre form alanı haritası — modal dinamik field seçimi için */
type IntegrationFieldKey =
  | 'username'
  | 'password'
  | 'apiKey'
  | 'apiSecret'
  | 'baseUrl'
  | 'senderVkn'
  | 'accountId';

interface IntegrationFieldDef {
  key: IntegrationFieldKey;
  label: string;
  type?: 'text' | 'password' | 'url';
  placeholder?: string;
  required?: boolean;
}

const PROVIDER_FIELDS: Record<string, IntegrationFieldDef[]> = {
  ELOGO: [
    { key: 'username', label: 'Kullanıcı adı', required: true },
    { key: 'password', label: 'Şifre', type: 'password', required: true },
    { key: 'baseUrl', label: 'Servis URL', type: 'url', placeholder: 'https://...' },
    { key: 'senderVkn', label: 'Gönderici VKN' },
  ],
  UYUMSOFT: [
    { key: 'username', label: 'Kullanıcı adı', required: true },
    { key: 'password', label: 'Şifre', type: 'password', required: true },
    { key: 'baseUrl', label: 'Servis URL', type: 'url', placeholder: 'http://efatura.uyumsoft.com.tr/Services/BasicIntegration' },
  ],
  PARASUT: [
    { key: 'apiKey', label: 'API Key (Client ID)', required: true },
    { key: 'apiSecret', label: 'API Secret', type: 'password', required: true },
    { key: 'accountId', label: 'Firma ID', required: true },
    { key: 'username', label: 'Kullanıcı adı (e-posta)' },
    { key: 'password', label: 'Şifre', type: 'password' },
  ],
  KOLAYSOFT: [
    { key: 'apiKey', label: 'API Key', required: true },
    { key: 'apiSecret', label: 'API Secret', type: 'password' },
  ],
  IZIBIZ: [
    { key: 'username', label: 'Kullanıcı adı', required: true },
    { key: 'password', label: 'Şifre', type: 'password', required: true },
    { key: 'baseUrl', label: 'Servis URL', type: 'url', placeholder: 'https://efaturaws.izibiz.com.tr/EInvoiceWS' },
  ],
  FORIBA: [
    { key: 'username', label: 'Kullanıcı adı', required: true },
    { key: 'password', label: 'Şifre', type: 'password', required: true },
    { key: 'baseUrl', label: 'Servis URL', type: 'url' },
  ],
  MIKRO: [
    { key: 'username', label: 'Kullanıcı adı', required: true },
    { key: 'password', label: 'Şifre', type: 'password', required: true },
    { key: 'accountId', label: 'Hesap / Firma ID' },
  ],
  LUCA: [
    { key: 'username', label: 'Kullanıcı adı', required: true },
    { key: 'password', label: 'Şifre', type: 'password', required: true },
    { key: 'baseUrl', label: 'Luca URL', type: 'url' },
  ],
  LOGO_ISBASI: [
    { key: 'username', label: 'Kullanıcı adı', required: true },
    { key: 'password', label: 'Şifre', type: 'password', required: true },
    { key: 'baseUrl', label: 'Servis URL', type: 'url' },
  ],
  TURMOB_EFATURA: [
    { key: 'username', label: 'Kullanıcı adı', required: true },
    { key: 'password', label: 'Şifre', type: 'password', required: true },
  ],
  GIB_PORTAL: [
    { key: 'username', label: 'Kullanıcı adı (VKN/TC)', required: true },
    { key: 'password', label: 'Şifre', type: 'password', required: true },
  ],
};

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
              taxpayers={taxpayers}
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
  taxpayers,
  period,
  onCompleted,
  dashboardTotalPending,
  dashboardTotalTransferred,
}: {
  taxpayerId: string;
  taxpayer?: TaxpayerLite;
  taxpayers: TaxpayerLite[];
  period: string;
  onCompleted: () => void;
  dashboardTotalPending: number;
  dashboardTotalTransferred: number;
}) {
  const qc = useQueryClient();
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
  // Mükellef bazlı: configured olanlar (backend dönüyor)
  const activeProvidersCount = integrations.filter((i) => i.configured).length;

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
            taxpayers={taxpayers}
            period={period}
            onCompleted={onCompleted}
            onIntegrationsChanged={() => {
              qc.invalidateQueries({ queryKey: ['fim', 'integrations'] });
              qc.invalidateQueries({ queryKey: ['fim', 'integrations-overview'] });
            }}
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
  taxpayers,
  period,
  onCompleted,
  onIntegrationsChanged,
}: {
  integrations: IntegrationRow[];
  integrationsLoading: boolean;
  taxpayerId: string;
  taxpayer?: TaxpayerLite;
  taxpayers: TaxpayerLite[];
  period: string;
  onCompleted: () => void;
  onIntegrationsChanged: () => void;
}) {
  const [direction, setDirection] = useState<Direction>('ALIS');
  const [selected, setSelected] = useState<string[]>([]);
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    provider?: string;
    existing?: IntegrationRow;
  }>({ open: false });

  // Bu mükellef için tanımlı sağlayıcılar (configured = credential var)
  const configuredProviders = useMemo(
    () => integrations.filter((i) => i.configured),
    [integrations],
  );

  // Çekim için varsayılan: tüm tanımlı sağlayıcılar seçili
  useEffect(() => {
    setSelected(configuredProviders.map((i) => i.provider));
  }, [configuredProviders.map((i) => i.provider).join(',')]);

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
      if (total > 0) toast.success(`${total} belge alındı`);
      failed.forEach((r) => toast.error(`${r.provider}: ${r.error || 'hata'}`));
      if (total === 0 && failed.length === 0) toast.info('Sonuç dönmedi · dönem boş olabilir');
      onCompleted();
    },
    onError: (err: Error) => toast.error(err.message || 'Çekim başarısız'),
  });

  /* ─── "Tüm mükellefler" seçili: özet göster ─── */
  if (!taxpayerId) {
    return (
      <div>
        <div className="mb-4">
          <div className="text-[15px] font-semibold text-[#2a2723]">Entegratör Çekimi</div>
          <div className="mt-0.5 text-[13px] text-[#8a8270]">
            Çekim işlemi mükellef bazında yapılır. Sağ üstten bir mükellef seçin.
          </div>
        </div>
        <GlobalIntegrationSummary taxpayers={taxpayers} />
      </div>
    );
  }

  /* ─── Mükellef seçili: tanımlı entegratörler veya empty state ─── */
  const hasIntegrations = configuredProviders.length > 0;

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-[#2a2723]">Entegratör Çekimi</div>
          <div className="mt-0.5 text-[13px] text-[#8a8270]">
            {hasIntegrations
              ? `${taxpayerLabel(taxpayer)} için ${configuredProviders.length} sağlayıcı tanımlı.`
              : `${taxpayerLabel(taxpayer)} için henüz entegratör tanımlanmamış.`}
          </div>
        </div>
        <button
          onClick={() => setDialogState({ open: true })}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#e6e1d6] bg-white px-3 text-[13.5px] font-medium text-[#5b5447] transition hover:border-[#d4cfbf] hover:text-[#2a2723]"
        >
          + Yeni entegratör
        </button>
      </div>

      {integrationsLoading ? (
        <div className="py-10 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#8a8270]" />
        </div>
      ) : !hasIntegrations ? (
        <EmptyIntegrationState onAdd={() => setDialogState({ open: true })} />
      ) : (
        <>
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

          {/* Tanımlı sağlayıcılar - chip + düzenle */}
          <div className="mb-[18px] flex flex-wrap gap-1.5">
            {configuredProviders.map((info) => {
              const catalog = PROVIDERS.find((p) => p.id === info.provider);
              const label = info.label || catalog?.label || info.provider;
              const on = selected.includes(info.provider);
              return (
                <div key={info.provider} className="inline-flex items-center">
                  <button
                    onClick={() =>
                      setSelected((s) =>
                        s.includes(info.provider) ? s.filter((x) => x !== info.provider) : [...s, info.provider],
                      )
                    }
                    className={`inline-flex items-center gap-1.5 rounded-l-[18px] border border-r-0 px-3 py-1.5 text-[12.5px] transition ${
                      on
                        ? 'border-[#2a2723] bg-[#2a2723] text-white'
                        : 'border-[#e6e1d6] bg-white text-[#5b5447] hover:border-[#d4cfbf]'
                    }`}
                  >
                    <span
                      className="h-[5px] w-[5px] rounded-full"
                      style={{
                        background: info.isActive
                          ? on
                            ? 'rgba(255,255,255,0.7)'
                            : '#5d8763'
                          : '#b8b09b',
                      }}
                    />
                    {label}
                    {info.taxpayerScoped === false && (
                      <span className="opacity-60 ml-1 text-[10px]">(genel)</span>
                    )}
                  </button>
                  <button
                    onClick={() => setDialogState({ open: true, provider: info.provider, existing: info })}
                    title="Düzenle"
                    className={`inline-flex h-[28px] items-center rounded-r-[18px] border px-2 text-[11px] transition ${
                      on
                        ? 'border-[#2a2723] bg-[#2a2723] text-white hover:bg-[#1c1a17]'
                        : 'border-[#e6e1d6] bg-white text-[#8a8270] hover:border-[#d4cfbf] hover:text-[#2a2723]'
                    }`}
                  >
                    ⚙
                  </button>
                </div>
              );
            })}
          </div>

          {/* Çekim aksiyonu */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => fetchMut.mutate()}
              disabled={selected.length === 0 || fetchMut.isPending}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#4a8580] px-4 text-[13.5px] font-medium text-white transition hover:bg-[#2f6863] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {fetchMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {selected.length > 0 ? `Çekimi başlat (${selected.length})` : 'Çekimi başlat'}
            </button>
            {selected.length === 0 && (
              <span className="text-[12.5px] text-[#a87a3d]">En az bir sağlayıcı seç</span>
            )}
          </div>
        </>
      )}

      {/* Dialog */}
      {dialogState.open && (
        <IntegrationDialog
          taxpayerId={taxpayerId}
          taxpayer={taxpayer}
          existing={dialogState.existing}
          fixedProvider={dialogState.provider}
          allIntegrations={integrations}
          onClose={() => setDialogState({ open: false })}
          onSaved={() => {
            setDialogState({ open: false });
            onIntegrationsChanged();
          }}
        />
      )}
    </div>
  );
}

/* ─── Genel özet (Tüm mükellefler seçili durumda) ─── */

function GlobalIntegrationSummary({ taxpayers }: { taxpayers: TaxpayerLite[] }) {
  // Her mükellef için entegrasyon listesi paralel çek
  const queries = useQuery({
    queryKey: ['fim', 'integrations-overview', taxpayers.map((t) => t.id).join(',')],
    queryFn: async () => {
      // Birden fazla istekle yorma — sadece 50 mükellefe kadar overview
      const subset = taxpayers.slice(0, 80);
      const results = await Promise.all(
        subset.map((t) =>
          api
            .get('/fatura-muhasebelestirme/integrations', { params: { taxpayerId: t.id } })
            .then((r) => ({ taxpayer: t, integrations: r.data as IntegrationRow[] }))
            .catch(() => ({ taxpayer: t, integrations: [] as IntegrationRow[] })),
        ),
      );
      return results;
    },
    enabled: taxpayers.length > 0,
    staleTime: 60_000,
  });

  if (queries.isLoading) {
    return (
      <div className="py-10 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#8a8270]" />
        <div className="mt-2 text-[12.5px] text-[#8a8270]">
          Mükellef başına entegrasyonlar hesaplanıyor...
        </div>
      </div>
    );
  }

  const rows = queries.data || [];
  const taxpayersWithIntegration = rows.filter((r) => r.integrations.some((i) => i.configured));
  const totalConfigured = rows.reduce(
    (acc, r) => acc + r.integrations.filter((i) => i.configured).length,
    0,
  );

  // Provider başına dağılım
  const providerStats = new Map<string, number>();
  rows.forEach((r) =>
    r.integrations.forEach((i) => {
      if (i.configured) {
        providerStats.set(i.provider, (providerStats.get(i.provider) || 0) + 1);
      }
    }),
  );

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-6">
        <SummaryStat
          label="Tanımlı mükellef"
          value={`${taxpayersWithIntegration.length}/${taxpayers.length}`}
        />
        <SummaryStat label="Toplam tanımlama" value={totalConfigured} />
        <SummaryStat label="Aktif sağlayıcı türü" value={providerStats.size} />
      </div>

      {providerStats.size > 0 ? (
        <div>
          <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[#5b5447]">
            Sağlayıcı dağılımı
          </div>
          <div className="overflow-hidden rounded-[10px] border border-[#e6e1d6]">
            {Array.from(providerStats.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([provider, count], idx, arr) => {
                const catalog = PROVIDERS.find((p) => p.id === provider);
                const max = arr[0][1];
                return (
                  <div
                    key={provider}
                    className="flex items-center justify-between gap-3 border-t border-[#e6e1d6] px-4 py-2.5 first:border-t-0"
                  >
                    <span className="text-[13.5px] font-medium text-[#2a2723] min-w-[120px]">
                      {catalog?.label || provider}
                    </span>
                    <div className="flex-1 h-[6px] rounded-full bg-[#f1ebde] overflow-hidden">
                      <div
                        className="h-full bg-[#4a8580]"
                        style={{ width: `${(count / max) * 100}%` }}
                      />
                    </div>
                    <span className="text-[13px] tabular-nums text-[#5b5447] min-w-[60px] text-right">
                      {count} mükellef
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-[#e6e1d6] bg-[#f8f6f1] px-4 py-6 text-center text-[13px] text-[#8a8270]">
          Hiçbir mükellef için entegratör tanımlanmamış. Bir mükellef seçip "+ Yeni entegratör" ile başlayın.
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-[#e6e1d6] bg-white p-4">
      <div className="text-[12px] text-[#8a8270] mb-1">{label}</div>
      <div className="text-[22px] font-semibold tracking-tight text-[#2a2723] tabular-nums">
        {value}
      </div>
    </div>
  );
}

/* ─── Empty state (tanımlama yok) ─── */

function EmptyIntegrationState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-[10px] border border-dashed border-[#d4cfbf] bg-[#f8f6f1] px-6 py-10 text-center">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#4a8580]">
        <ArrowRight className="h-5 w-5" />
      </div>
      <div className="mb-1 text-[15px] font-semibold text-[#2a2723]">
        Bu mükellef için entegratör tanımlanmamış
      </div>
      <p className="mx-auto mb-5 max-w-[420px] text-[13px] text-[#8a8270]">
        e-Fatura sağlayıcısı veya Luca/GİB kimlik bilgilerini ekleyerek bu mükellefin belgelerini
        otomatik çekmeye başlayabilirsiniz.
      </p>
      <button
        onClick={onAdd}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#4a8580] px-5 text-[13.5px] font-medium text-white transition hover:bg-[#2f6863]"
      >
        + Yeni entegratör tanımla
      </button>
    </div>
  );
}

/* ─── IntegrationDialog (yeni / düzenle modal) ─── */

function IntegrationDialog({
  taxpayerId,
  taxpayer,
  existing,
  fixedProvider,
  allIntegrations,
  onClose,
  onSaved,
}: {
  taxpayerId: string;
  taxpayer?: TaxpayerLite;
  existing?: IntegrationRow;
  fixedProvider?: string;
  allIntegrations: IntegrationRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!existing;
  const [provider, setProvider] = useState<string>(
    fixedProvider || existing?.provider || '',
  );
  const [values, setValues] = useState<Record<IntegrationFieldKey, string>>({
    username: existing?.username || '',
    password: '',
    apiKey: '',
    apiSecret: '',
    baseUrl: existing?.baseUrl || '',
    senderVkn: existing?.senderVkn || '',
    accountId: existing?.accountId || '',
  });
  const [isActive, setIsActive] = useState<boolean>(existing?.isActive !== false);
  const [note, setNote] = useState<string>(existing?.note || '');

  // Provider seçimi değişince form alanları/preset güncellensin
  useEffect(() => {
    if (!provider || isEdit) return;
    // Yeni provider seçildi, sadece o provider'ın alanlarını sıfırla
    const fields = PROVIDER_FIELDS[provider] || [];
    setValues((v) => {
      const next = { ...v };
      // İlgili olmayanları temizleme — sadece yeni provider için sıfır gibi davran
      fields.forEach((f) => {
        if (!next[f.key]) next[f.key] = '';
      });
      return next;
    });
  }, [provider, isEdit]);

  const fields = provider ? PROVIDER_FIELDS[provider] || [] : [];

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!provider) throw new Error('Sağlayıcı seçin');
      // Zorunlu alan kontrolü
      const missing = fields.filter((f) => f.required && !values[f.key]?.trim()).map((f) => f.label);
      // Düzenleme modunda: önceden kayıtlı password/apiKey var ise (hasPassword/hasApiKey true) boş bırakmaya izin ver
      const skipIfStored: IntegrationFieldKey[] = isEdit
        ? ([
            existing?.hasPassword ? 'password' : null,
            existing?.hasApiKey ? 'apiKey' : null,
            existing?.hasApiSecret ? 'apiSecret' : null,
          ].filter(Boolean) as IntegrationFieldKey[])
        : [];
      const realMissing = missing.filter(
        (label) =>
          !skipIfStored.includes(
            (fields.find((f) => f.label === label)?.key || '') as IntegrationFieldKey,
          ),
      );
      if (realMissing.length > 0) {
        throw new Error('Zorunlu alanlar eksik: ' + realMissing.join(', '));
      }

      const payload: Record<string, unknown> = {
        provider,
        taxpayerId: taxpayerId || null,
        isActive,
        note,
      };
      fields.forEach((f) => {
        const v = values[f.key]?.trim();
        if (v) payload[f.key] = v;
      });
      if (values.baseUrl?.trim()) payload.baseUrl = values.baseUrl.trim();

      return api
        .post('/fatura-muhasebelestirme/integrations', payload)
        .then((r) => r.data);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Entegratör güncellendi' : 'Entegratör eklendi');
      onSaved();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Kayıt başarısız');
    },
  });

  // Henüz tanımlı olmayan provider'lar — yeni eklemede gösterilir
  const availableProviders = useMemo(() => {
    if (isEdit) return PROVIDERS;
    const configuredIds = new Set(
      allIntegrations.filter((i) => i.configured).map((i) => i.provider),
    );
    return PROVIDERS.filter((p) => !configuredIds.has(p.id));
  }, [isEdit, allIntegrations]);

  const providerLabel = useMemo(() => {
    if (!provider) return '';
    return PROVIDERS.find((p) => p.id === provider)?.label || provider;
  }, [provider]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] rounded-[14px] bg-[#fbf9f4] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#e6e1d6] px-6 py-4">
          <div>
            <div className="text-[17px] font-semibold text-[#2a2723]">
              {isEdit ? `${providerLabel} — düzenle` : 'Yeni entegratör tanımla'}
            </div>
            <div className="mt-1 text-[13px] text-[#8a8270]">
              {taxpayer ? taxpayerLabel(taxpayer) : 'Mükellef yok'}
              {taxpayer?.taxNumber ? ` · ${taxpayer.taxNumber}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8a8270] transition hover:text-[#2a2723]"
            title="Kapat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Provider seçimi */}
          {!isEdit && (
            <div className="mb-4">
              <label className="mb-1.5 block text-[12px] font-medium text-[#5b5447]">
                Sağlayıcı
              </label>
              <div className="relative">
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="h-10 w-full appearance-none rounded-lg border border-[#e6e1d6] bg-white px-3 pr-9 text-[14px] text-[#2a2723] focus:border-[#4a8580] focus:outline-none"
                >
                  <option value="">Sağlayıcı seçin...</option>
                  {availableProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8270]" />
              </div>
              {availableProviders.length === 0 && (
                <p className="mt-1.5 text-[12px] text-[#a87a3d]">
                  Bu mükellef için tüm sağlayıcılar zaten tanımlı. Mevcut olanı düzenleyin.
                </p>
              )}
            </div>
          )}

          {/* Dinamik alanlar */}
          {provider && fields.length > 0 && (
            <div className="space-y-3">
              {fields.map((f) => {
                const isPasswordField = f.type === 'password';
                const hasStored =
                  isEdit &&
                  ((f.key === 'password' && existing?.hasPassword) ||
                    (f.key === 'apiKey' && existing?.hasApiKey) ||
                    (f.key === 'apiSecret' && existing?.hasApiSecret));
                return (
                  <div key={f.key}>
                    <label className="mb-1.5 block text-[12px] font-medium text-[#5b5447]">
                      {f.label}
                      {f.required && !hasStored && (
                        <span className="ml-1 text-[#a8645e]">*</span>
                      )}
                    </label>
                    <input
                      type={isPasswordField ? 'password' : f.type === 'url' ? 'url' : 'text'}
                      value={values[f.key]}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [f.key]: e.target.value }))
                      }
                      placeholder={
                        hasStored ? '••••• (değiştirmek için yeni değer girin)' : f.placeholder || ''
                      }
                      autoComplete={isPasswordField ? 'new-password' : 'off'}
                      className="h-10 w-full rounded-lg border border-[#e6e1d6] bg-white px-3 text-[14px] text-[#2a2723] placeholder:text-[#b8b09b] focus:border-[#4a8580] focus:outline-none"
                    />
                  </div>
                );
              })}

              {/* Not */}
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[#5b5447]">
                  Not (opsiyonel)
                </label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ekip notu, geçerlilik tarihi vs."
                  className="h-10 w-full rounded-lg border border-[#e6e1d6] bg-white px-3 text-[14px] text-[#2a2723] placeholder:text-[#b8b09b] focus:border-[#4a8580] focus:outline-none"
                />
              </div>

              {/* Aktif toggle */}
              <label className="flex cursor-pointer items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 accent-[#4a8580]"
                />
                <span className="text-[13.5px] text-[#2a2723]">
                  Aktif (devre dışı bırakırsanız çekim listesinde görünmez)
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[#e6e1d6] bg-[#f8f6f1] px-6 py-4">
          <button
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg px-3.5 text-[13.5px] font-medium text-[#5b5447] transition hover:bg-white hover:text-[#2a2723]"
          >
            İptal
          </button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={!provider || saveMut.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#4a8580] px-4 text-[13.5px] font-medium text-white transition hover:bg-[#2f6863] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isEdit ? 'Güncelle' : 'Kaydet'}
          </button>
        </div>
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
      { group: 'Yevmiye', accountCod
