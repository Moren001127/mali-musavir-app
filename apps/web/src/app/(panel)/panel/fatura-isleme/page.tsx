'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import TaxpayerSelect from '@/components/ui/TaxpayerSelect';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  CircleDashed,
  Download,
  FileCheck2,
  FileText,
  Filter,
  Gauge,
  Layers3,
  ListChecks,
  LockKeyhole,
  PlugZap,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Table2,
  Upload,
  WalletCards,
  Workflow,
  Zap,
} from 'lucide-react';

type Tone = 'gold' | 'green' | 'blue' | 'amber' | 'red' | 'slate' | 'purple';
type TabKey = 'pool' | 'accounts' | 'match' | 'transfer' | 'sources' | 'templates';
type DocumentStatus = 'ready' | 'review' | 'blocked' | 'draft';
type SourceView = 'incoming' | 'outgoing';
type ProcessDirection = 'ALIS' | 'SATIS';

type Taxpayer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
  defterTuru?: string | null;
  mihsapDefterTuru?: string | null;
  lucaSlug?: string | null;
};

type ApiLine = {
  id?: string;
  group?: string | null;
  accountCode?: string | null;
  description?: string | null;
  rate?: string | null;
  debit?: unknown;
  credit?: unknown;
};

type ApiDocument = {
  id: string;
  taxpayerId?: string | null;
  source?: string | null;
  documentType?: string | null;
  invoiceKind?: string | null;
  status?: string | null;
  duplicateReason?: string | null;
  originalName?: string | null;
  belgeNo?: string | null;
  faturaTarihi?: string | null;
  vendorName?: string | null;
  customerName?: string | null;
  sellerVkn?: string | null;
  buyerVkn?: string | null;
  totalAmount?: unknown;
  ocrStatus?: string | null;
  ocrEngine?: string | null;
  ocrConfidence?: number | null;
  ocrData?: any;
  lines?: ApiLine[];
};

type AccountPlan = {
  source: { id: string; accountCount: number; createdAt: string; sourceJobId?: string | null } | null;
  accounts: Array<{ id: string; code: string; name: string; level: number; debitBalance: number; creditBalance: number }>;
};

type IntegrationRow = {
  provider: string;
  label: string;
  kind: string;
  tone: Tone;
  isActive: boolean;
  configured: boolean;
  taxpayerScoped: boolean;
  baseUrl?: string;
  username?: string;
  senderVkn?: string;
  accountId?: string;
  note?: string;
  hasApiKey?: boolean;
  hasApiSecret?: boolean;
  hasPassword?: boolean;
  updatedAt?: string | null;
};

type UploadJob = {
  id: string;
  type: 'receipt' | 'zreport';
  fileName: string;
  status: 'Yukleniyor' | 'OCR okunuyor' | 'Tamamlandi' | 'Hata';
  progress: number;
};

type DocumentRow = {
  id: string;
  title: string;
  documentNo: string;
  source: string;
  provider: string;
  direction: ProcessDirection;
  defter: 'Bilanco' | 'Isletme';
  date: string;
  amount: number;
  account: string;
  kdv: string;
  confidence: number;
  status: DocumentStatus;
  missing: string[];
  rule: string;
  engine: string;
};

const toneClasses: Record<Tone, { text: string; bg: string; border: string; dot: string; glow: string }> = {
  gold: {
    text: 'text-[#d4b876]',
    bg: 'bg-[#d4b876]/10',
    border: 'border-[#d4b876]/30',
    dot: 'bg-[#d4b876]',
    glow: 'shadow-[0_0_0_1px_rgba(212,184,118,0.12)]',
  },
  green: {
    text: 'text-emerald-300',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-400/25',
    dot: 'bg-emerald-400',
    glow: 'shadow-[0_0_0_1px_rgba(52,211,153,0.10)]',
  },
  blue: {
    text: 'text-sky-300',
    bg: 'bg-sky-500/10',
    border: 'border-sky-400/25',
    dot: 'bg-sky-400',
    glow: 'shadow-[0_0_0_1px_rgba(56,189,248,0.10)]',
  },
  amber: {
    text: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-400/25',
    dot: 'bg-amber-400',
    glow: 'shadow-[0_0_0_1px_rgba(251,191,36,0.10)]',
  },
  red: {
    text: 'text-rose-300',
    bg: 'bg-rose-500/10',
    border: 'border-rose-400/25',
    dot: 'bg-rose-400',
    glow: 'shadow-[0_0_0_1px_rgba(251,113,133,0.10)]',
  },
  slate: {
    text: 'text-stone-300',
    bg: 'bg-stone-500/10',
    border: 'border-stone-400/20',
    dot: 'bg-stone-400',
    glow: 'shadow-[0_0_0_1px_rgba(168,162,158,0.08)]',
  },
  purple: {
    text: 'text-violet-300',
    bg: 'bg-violet-500/10',
    border: 'border-violet-400/25',
    dot: 'bg-violet-400',
    glow: 'shadow-[0_0_0_1px_rgba(167,139,250,0.10)]',
  },
};

const tabs: Array<{ key: TabKey; label: string; icon: LucideIcon }> = [
  { key: 'pool', label: 'Belge Havuzu', icon: ReceiptText },
  { key: 'accounts', label: 'Hesap Plani', icon: Layers3 },
  { key: 'match', label: 'Eslestirme', icon: Workflow },
  { key: 'transfer', label: 'Luca Aktarim', icon: Send },
  { key: 'sources', label: 'Baglantilar', icon: PlugZap },
  { key: 'templates', label: 'Isletme Sablonu', icon: ListChecks },
];

const integratorDefaults: IntegrationRow[] = [
  { provider: 'LUCA', label: 'Luca', kind: 'luca', tone: 'green', configured: false, isActive: true, taxpayerScoped: false },
  { provider: 'GIB_PORTAL', label: 'GIB Portal', kind: 'portal', tone: 'amber', configured: false, isActive: true, taxpayerScoped: false },
  { provider: 'ELOGO', label: 'e-Logo', kind: 'efatura', tone: 'blue', configured: false, isActive: true, taxpayerScoped: false },
  { provider: 'UYUMSOFT', label: 'Uyumsoft', kind: 'efatura', tone: 'blue', configured: false, isActive: true, taxpayerScoped: false },
  { provider: 'MIKRO', label: 'Mikro', kind: 'efatura', tone: 'purple', configured: false, isActive: true, taxpayerScoped: false },
  { provider: 'IZIBIZ', label: 'Izibiz', kind: 'efatura', tone: 'blue', configured: false, isActive: true, taxpayerScoped: false },
  { provider: 'KOLAYSOFT', label: 'Kolaysoft', kind: 'efatura', tone: 'green', configured: false, isActive: true, taxpayerScoped: false },
  { provider: 'FORIBA', label: 'Foriba', kind: 'efatura', tone: 'amber', configured: false, isActive: true, taxpayerScoped: false },
  { provider: 'PARASUT', label: 'Parasut', kind: 'efatura', tone: 'purple', configured: false, isActive: true, taxpayerScoped: false },
  { provider: 'LOGO_ISBASI', label: 'Logo Isbasi', kind: 'efatura', tone: 'gold', configured: false, isActive: true, taxpayerScoped: false },
  { provider: 'TURMOB_EFATURA', label: 'TURMOB e-Fatura', kind: 'efatura', tone: 'red', configured: false, isActive: true, taxpayerScoped: false },
];

const isletmeFields = [
  'Alis gider turu',
  'Satis gelir turu',
  'Belge turu',
  'KDV orani',
  'Odeme sekli',
  'Kayit aciklamasi',
  'Stopaj / tevkifat',
  'Istisna kodu',
];

const formatMoney = (value: number) =>
  new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(Number.isFinite(value) ? value : 0);

const formatDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat('tr-TR').format(date);
};

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = typeof value === 'object' && value && 'toString' in value ? String(value) : String(value);
  const normalized = raw.replace(/\./g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
};

const taxpayerName = (taxpayer: Taxpayer) =>
  (
    taxpayer.companyName ||
    `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim() ||
    taxpayer.taxNumber ||
    ''
  ).trim();

const taxpayerLedgerLabel = (taxpayer?: Taxpayer | null): 'Bilanco' | 'Isletme' => {
  const raw = (taxpayer?.defterTuru || taxpayer?.mihsapDefterTuru || '').toLocaleUpperCase('tr-TR');
  return raw.includes('ISLETME') || raw.includes('İŞLETME') || raw.includes('DEFTER_BEYAN') ? 'Isletme' : 'Bilanco';
};

const visibleLedgerLabel = (value: 'Bilanco' | 'Isletme') => (value === 'Isletme' ? 'İşletme' : 'Bilanço');
const directionLabel = (value: ProcessDirection) => (value === 'SATIS' ? 'Satış' : 'Alış');

function mapDocument(doc: ApiDocument, taxpayer: Taxpayer | null): DocumentRow {
  const direction: ProcessDirection = String(doc.invoiceKind || '').toUpperCase() === 'SATIS' ? 'SATIS' : 'ALIS';
  const lines = doc.lines || [];
  const matrah = lines.find((line) => String(line.group || '').toLowerCase() === 'matrah') || lines[0];
  const tax = lines.find((line) => String(line.group || '').toLowerCase() === 'vergi');
  const amount = toNumber(doc.totalAmount);
  const title =
    (direction === 'SATIS' ? doc.customerName || doc.vendorName : doc.vendorName || doc.customerName) ||
    doc.originalName ||
    'Adsiz belge';
  const documentType = String(doc.documentType || '').toUpperCase();
  const source = String(doc.source || '').toLowerCase();
  const sourceLabel = documentType.includes('Z_RAPORU')
    ? 'Z raporu'
    : documentType.includes('OKC') || source.includes('receipt')
      ? 'Gider fisi'
      : documentType.includes('E_FATURA')
        ? 'e-Fatura'
        : documentType.includes('E_ARSIV')
          ? 'e-Arsiv'
          : source.includes('manual')
            ? 'Manuel OCR'
            : 'Belge';
  const provider = source.includes('manual')
    ? 'OCR'
    : source.includes('earsiv')
      ? 'Luca / GIB'
      : doc.ocrEngine || 'Entegrator';
  const confidenceRaw = Number(doc.ocrConfidence ?? doc.ocrData?.confidence ?? 0);
  const confidence = confidenceRaw > 1 ? Math.round(confidenceRaw) : Math.round(confidenceRaw * 100);
  const account = [matrah?.accountCode, matrah?.description].filter(Boolean).join(' - ') || '';
  const missing: string[] = [];
  if (!doc.faturaTarihi) missing.push('Tarih');
  if (!doc.belgeNo) missing.push('Belge no');
  if (!doc.vendorName && !doc.customerName) missing.push('Cari');
  if (!amount) missing.push('Tutar');
  if (!account) missing.push(taxpayerLedgerLabel(taxpayer) === 'Isletme' ? 'İşletme alanı' : 'Hesap kodu');
  if (doc.duplicateReason) missing.push('Mukerrer');

  const apiStatus = String(doc.status || '').toUpperCase();
  const ocrStatus = String(doc.ocrStatus || '').toUpperCase();
  const status: DocumentStatus =
    apiStatus === 'APPROVED' || (apiStatus === 'READY' && missing.length === 0)
      ? 'ready'
      : apiStatus === 'REJECTED' || ocrStatus === 'FAILED'
        ? 'blocked'
        : apiStatus === 'READY'
          ? 'review'
          : 'draft';

  return {
    id: doc.id,
    title,
    documentNo: doc.belgeNo || doc.originalName || doc.id.slice(-8),
    source: sourceLabel,
    provider,
    direction,
    defter: taxpayerLedgerLabel(taxpayer),
    date: formatDate(doc.faturaTarihi),
    amount,
    account,
    kdv: tax?.rate || doc.ocrData?.kdvOrani ? String(tax?.rate || `%${doc.ocrData?.kdvOrani}`) : '-',
    confidence,
    status,
    missing,
    rule: doc.duplicateReason || doc.ocrEngine || doc.ocrData?.kategori || 'Kaynak veriden olusturuldu',
    engine: doc.ocrEngine || doc.ocrStatus || 'direct',
  };
}

export default function FaturaIslemeMerkeziPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('pool');
  const [period, setPeriod] = useState('2026-05');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selectedTaxpayerId, setSelectedTaxpayerId] = useState('');
  const [sourceView, setSourceView] = useState<SourceView>('incoming');
  const [processDirection, setProcessDirection] = useState<ProcessDirection>('ALIS');
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('ELOGO');
  const [notice, setNotice] = useState('');
  const [integrationForm, setIntegrationForm] = useState({
    baseUrl: '',
    apiKey: '',
    apiSecret: '',
    username: '',
    password: '',
    senderVkn: '',
    accountId: '',
    note: '',
  });

  useEffect(() => {
    const storedTaxpayerId = localStorage.getItem('fatura-isleme-taxpayer-id');
    if (storedTaxpayerId) setSelectedTaxpayerId(storedTaxpayerId);
  }, []);

  const { data: taxpayers = [], isLoading: taxpayersLoading } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers-for-fatura-isleme'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });

  const selectedTaxpayer = useMemo(
    () => taxpayers.find((taxpayer) => taxpayer.id === selectedTaxpayerId) ?? null,
    [taxpayers, selectedTaxpayerId],
  );
  const selectedTaxpayerName = selectedTaxpayer ? taxpayerName(selectedTaxpayer) : '';
  const hasTaxpayerContext = Boolean(selectedTaxpayer);

  const documentsQuery = useQuery<ApiDocument[]>({
    queryKey: ['fatura-isleme-documents', selectedTaxpayerId],
    enabled: hasTaxpayerContext,
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/documents', {
          params: { taxpayerId: selectedTaxpayerId, limit: 500 },
        })
        .then((r) => r.data),
  });

  const accountPlanQuery = useQuery<AccountPlan>({
    queryKey: ['fatura-isleme-account-plan', selectedTaxpayerId],
    enabled: hasTaxpayerContext,
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/account-plan', {
          params: { taxpayerId: selectedTaxpayerId, limit: 300 },
        })
        .then((r) => r.data),
  });

  const integrationsQuery = useQuery<IntegrationRow[]>({
    queryKey: ['fatura-isleme-integrations', selectedTaxpayerId],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/integrations', {
          params: selectedTaxpayerId ? { taxpayerId: selectedTaxpayerId } : {},
        })
        .then((r) => r.data),
  });

  const integrations = integrationsQuery.data?.length ? integrationsQuery.data : integratorDefaults;

  useEffect(() => {
    const row = integrations.find((item) => item.provider === selectedProvider);
    if (!row) return;
    setIntegrationForm((prev) => ({
      ...prev,
      baseUrl: row.baseUrl || '',
      username: row.username || '',
      senderVkn: row.senderVkn || '',
      accountId: row.accountId || '',
      note: row.note || '',
      apiKey: '',
      apiSecret: '',
      password: '',
    }));
  }, [integrations, selectedProvider]);

  const documentRows = useMemo(
    () => (documentsQuery.data || []).map((document) => mapDocument(document, selectedTaxpayer)),
    [documentsQuery.data, selectedTaxpayer],
  );

  const filteredDocuments = useMemo(() => {
    const direction: ProcessDirection = sourceView === 'incoming' ? 'ALIS' : 'SATIS';
    const scoped = documentRows.filter((item) => item.direction === direction);
    const q = query.trim().toLocaleLowerCase('tr-TR');
    if (!q) return scoped;
    return scoped.filter((item) =>
      [item.title, item.documentNo, item.source, item.account, item.rule, item.provider]
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(q),
    );
  }, [documentRows, query, sourceView]);

  useEffect(() => {
    if (!selectedTaxpayerId || taxpayers.length === 0) return;
    if (!taxpayers.some((taxpayer) => taxpayer.id === selectedTaxpayerId)) {
      setSelectedTaxpayerId('');
      localStorage.removeItem('fatura-isleme-taxpayer-id');
    }
  }, [selectedTaxpayerId, taxpayers]);

  useEffect(() => {
    if (!filteredDocuments.length) {
      setSelectedId('');
      return;
    }
    if (!filteredDocuments.some((item) => item.id === selectedId)) {
      setSelectedId(filteredDocuments[0].id);
    }
  }, [filteredDocuments, selectedId]);

  const selected = filteredDocuments.find((item) => item.id === selectedId) ?? filteredDocuments[0] ?? null;
  const readyForTransfer = Boolean(selected && selected.missing.length === 0 && selected.status === 'ready');

  const metrics = useMemo(() => {
    const ready = documentRows.filter((item) => item.status === 'ready').length;
    const review = documentRows.filter((item) => item.status === 'review' || item.status === 'draft').length;
    const blocked = documentRows.filter((item) => item.status === 'blocked' || item.missing.length).length;
    const amount = documentRows.reduce((sum, item) => sum + item.amount, 0);
    return [
      { label: 'Belge', value: documentRows.length, hint: hasTaxpayerContext ? period : 'mukellef secin', icon: ReceiptText, tone: 'gold' as Tone },
      { label: 'Hazir', value: ready, hint: 'Luca aktarim', icon: CheckCircle2, tone: 'green' as Tone },
      { label: 'Onay', value: review, hint: 'insan kontrolu', icon: ShieldCheck, tone: 'amber' as Tone },
      { label: 'Kilitli', value: blocked, hint: 'eksik alan', icon: LockKeyhole, tone: 'red' as Tone },
      { label: 'Toplam', value: formatMoney(amount), hint: 'secili havuz', icon: WalletCards, tone: 'blue' as Tone },
    ];
  }, [documentRows, hasTaxpayerContext, period]);

  const uploadMutation = useMutation({
    mutationFn: async ({ files, type, jobIds }: { files: File[]; type: UploadJob['type']; jobIds: string[] }) => {
      const form = new FormData();
      files.forEach((file) => form.append('files', file));
      form.append('taxpayerId', selectedTaxpayerId);
      form.append('source', type === 'receipt' ? 'manual-receipt' : 'manual-z-report');
      form.append('documentType', type === 'receipt' ? 'OKC_FIS' : 'Z_RAPORU');
      form.append('invoiceKind', type === 'receipt' ? 'ALIS' : 'SATIS');
      setUploadJobs((prev) =>
        prev.map((job) =>
          jobIds.includes(job.id) ? { ...job, status: 'OCR okunuyor' as UploadJob['status'], progress: 62 } : job,
        ),
      );
      return api.post('/fatura-muhasebelestirme/documents/upload', form).then((r) => r.data);
    },
    onSuccess: (_data, variables) => {
      setUploadJobs((prev) =>
        prev
          .map((job) =>
            variables.jobIds.includes(job.id) ? { ...job, status: 'Tamamlandi' as UploadJob['status'], progress: 100 } : job,
          )
          .slice(0, 8),
      );
      setNotice('OCR tamamlandi, belge havuzu yenilendi.');
      queryClient.invalidateQueries({ queryKey: ['fatura-isleme-documents', selectedTaxpayerId] });
    },
    onError: (_error, variables) => {
      setUploadJobs((prev) =>
        prev.map((job) =>
          variables.jobIds.includes(job.id) ? { ...job, status: 'Hata' as UploadJob['status'], progress: 100 } : job,
        ),
      );
      setNotice('OCR sirasinda hata olustu. Dosya/kredi/anahtar kontrol edilmeli.');
    },
  });

  const accountPlanMutation = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/account-plan/refresh', { taxpayerId: selectedTaxpayerId }).then((r) => r.data),
    onSuccess: () => {
      setNotice('Luca hesap plani isi kuyruga alindi.');
      queryClient.invalidateQueries({ queryKey: ['fatura-isleme-account-plan', selectedTaxpayerId] });
    },
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const tip = sourceView === 'incoming' ? 'ALIS' : 'SATIS';
      await api.post('/earsiv/fetch-from-luca', {
        mukellefId: selectedTaxpayerId,
        donem: period,
        tip,
        belgeKaynak: sourceView === 'incoming' ? 'EARSIV' : 'EARSIV',
      });
      return api.post('/fatura-muhasebelestirme/documents/backfill-earsiv', {
        taxpayerId: selectedTaxpayerId,
        donem: period,
        tip,
        limit: 5000,
      });
    },
    onSuccess: () => {
      setNotice('Kaynak tarama kuyruga alindi; gelen kayitlar belge havuzuna aktarilacak.');
      queryClient.invalidateQueries({ queryKey: ['fatura-isleme-documents', selectedTaxpayerId] });
    },
    onError: () => setNotice('Kaynak tarama baslatilamadi. Luca/GIB baglantisini kontrol et.'),
  });

  const saveIntegrationMutation = useMutation({
    mutationFn: () =>
      api
        .post('/fatura-muhasebelestirme/integrations', {
          provider: selectedProvider,
          taxpayerId: selectedTaxpayerId || null,
          ...integrationForm,
        })
        .then((r) => r.data),
    onSuccess: () => {
      setNotice('Entegrator API kaydi saklandi.');
      setIntegrationForm((prev) => ({ ...prev, apiKey: '', apiSecret: '', password: '' }));
      queryClient.invalidateQueries({ queryKey: ['fatura-isleme-integrations', selectedTaxpayerId] });
    },
    onError: () => setNotice('API kaydi saklanamadi. Zorunlu alanlari ve sifreleme anahtarini kontrol et.'),
  });

  const selectTaxpayer = (id: string) => {
    setSelectedTaxpayerId(id);
    setSelectedId('');
    setQuery('');
    setUploadJobs([]);
    setNotice('');
    if (id) localStorage.setItem('fatura-isleme-taxpayer-id', id);
    else localStorage.removeItem('fatura-isleme-taxpayer-id');
  };

  const switchSourceView = (view: SourceView) => {
    setSourceView(view);
    setProcessDirection(view === 'incoming' ? 'ALIS' : 'SATIS');
    const next = documentRows.find((item) => (view === 'incoming' ? item.direction === 'ALIS' : item.direction === 'SATIS'));
    if (next) setSelectedId(next.id);
  };

  const addUploadJobs = (files: File[], type: UploadJob['type']) => {
    if (files.length === 0 || !hasTaxpayerContext) return;
    const now = Date.now();
    const jobs = files.map((file, index) => ({
      id: `${type}-${now}-${index}`,
      type,
      fileName: file.name,
      status: 'Yukleniyor' as const,
      progress: 28,
    }));
    setUploadJobs((prev) => [...jobs, ...prev].slice(0, 8));
    uploadMutation.mutate({ files, type, jobIds: jobs.map((job) => job.id) });
  };

  return (
    <main
      className="min-h-screen px-4 py-3 text-stone-100 lg:px-6"
      style={{ background: '#0f0f0f' }}
    >
      <div className="mx-auto flex max-w-[1720px] flex-col gap-3">
        <header
          className="overflow-hidden rounded-[8px] border"
          style={{
            borderColor: 'rgba(255,255,255,0.08)',
            background: '#151515',
          }}
        >
          <div className="flex flex-col gap-3 px-3 py-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="min-w-0">
              <h1 className="font-sans text-xl font-semibold tracking-normal text-[#f6edd4] md:text-2xl">Fatura İşleme Merkezi</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-stone-400 md:text-xs">
                <Calendar size={15} className="text-[#d4b876]" />
                <span>{period} çalışma dönemi</span>
                <span className="hidden h-1 w-1 rounded-full bg-stone-600 sm:block" />
                <span>e-Arşiv, e-Fatura, fiş ve Z raporu mükellef bazlı işlenir</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="min-w-[260px] sm:min-w-[380px]">
                <TaxpayerSelect
                  taxpayers={taxpayers}
                  value={selectedTaxpayerId}
                  onChange={selectTaxpayer}
                  placeholder={taxpayersLoading ? 'Mükellefler yükleniyor...' : 'Mükellef seçin'}
                  disabled={taxpayersLoading}
                  style={{
                    minHeight: 38,
                    borderRadius: 8,
                    borderColor: selectedTaxpayer ? 'rgba(212,184,118,0.45)' : 'rgba(248,113,113,0.35)',
                    background: 'rgba(16,13,10,0.86)',
                  }}
                />
              </div>
              <label className="flex h-9 items-center gap-2 rounded-[8px] border border-white/10 bg-[#101010] px-2.5 text-xs text-stone-300">
                <Calendar size={16} className="text-[#d4b876]" />
                <select
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                  className="bg-transparent text-xs font-semibold text-stone-100 outline-none"
                >
                  <option value="2026-05">Mayıs 2026</option>
                  <option value="2026-04">Nisan 2026</option>
                  <option value="2026-03">Mart 2026</option>
                </select>
              </label>
              <button
                disabled={!hasTaxpayerContext || scanMutation.isPending}
                onClick={() => scanMutation.mutate()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-[#101010] px-2.5 text-xs font-semibold text-stone-200 transition hover:border-[#d4b876]/45 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <RefreshCw size={16} className={scanMutation.isPending ? 'animate-spin' : ''} />
                Kaynakları Tara
              </button>
              <button
                disabled={!hasTaxpayerContext}
                onClick={() => setTab('transfer')}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] bg-[#d4b876] px-2.5 text-xs font-bold text-[#17120c] shadow-lg shadow-black/20 transition hover:bg-[#e4ca88] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Sparkles size={16} />
                Taslak Oluştur
              </button>
            </div>
          </div>

          <div className="border-t border-[#2a231a] bg-black/10 px-3 py-1.5">
            {selectedTaxpayer ? (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400 md:text-xs">
                <Badge tone="green" icon={Building2}>{selectedTaxpayerName}</Badge>
                <span>VKN/TCKN: {selectedTaxpayer.taxNumber || '-'}</span>
                <span className="hidden h-1 w-1 rounded-full bg-stone-600 sm:block" />
                <span>Defter: {visibleLedgerLabel(taxpayerLedgerLabel(selectedTaxpayer))}</span>
                <span className="hidden h-1 w-1 rounded-full bg-stone-600 sm:block" />
                <span className="hidden xl:inline">Kaynak, hesap planı, OCR ve Luca aktarımı sadece bu mükellef için çalışır.</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm text-amber-200">
                <AlertTriangle size={16} />
                <span>Önce mükellef seçin. Belge çekme, OCR ve Luca aktarımı mükellef olmadan başlamaz.</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-[#2a231a] bg-black/10 px-3 py-2">
            {metrics.map((metric) => <Metric key={metric.label} {...metric} />)}
          </div>
        </header>

        <section
          className="flex flex-col gap-2 rounded-[8px] border border-white/10 bg-[#151515] p-2 xl:flex-row xl:items-center xl:justify-between"
        >
          <div className="flex flex-wrap items-center gap-2">
            <DirectionButton active={sourceView === 'incoming'} tone="blue" icon={Download} label="Gelen belgeler" onClick={() => switchSourceView('incoming')} />
            <DirectionButton active={sourceView === 'outgoing'} tone="gold" icon={Send} label="Giden belgeler" onClick={() => switchSourceView('outgoing')} />
            <span className="hidden text-xs text-stone-500 lg:inline">{sourceView === 'incoming' ? 'Alış belgeleri' : 'Satış belgeleri'}</span>
            {notice && <Badge tone="amber">{notice}</Badge>}
          </div>
          <div className="grid gap-2 md:grid-cols-3 xl:min-w-[760px]">
            <UploadBox
              title="Gider fişi yükle"
              detail={hasTaxpayerContext ? 'Seçilince anlık OCR başlar' : 'Önce mükellef seçin'}
              icon={Upload}
              accept="image/*,.pdf"
              disabled={!hasTaxpayerContext || uploadMutation.isPending}
              tone="purple"
              onFiles={(files) => addUploadJobs(files, 'receipt')}
            />
            <UploadBox
              title="Z raporu yükle"
              detail={hasTaxpayerContext ? 'Satış yönüne OCR kaydı açar' : 'Önce mükellef seçin'}
              icon={FileText}
              accept="image/*,.pdf"
              disabled={!hasTaxpayerContext || uploadMutation.isPending}
              tone="gold"
              onFiles={(files) => addUploadJobs(files, 'zreport')}
            />
            <OcrQueue jobs={uploadJobs} />
          </div>
        </section>

        <section className="rounded-[8px] border border-white/10 bg-[#151515] p-1">
          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => (
              <TabButton key={item.key} active={tab === item.key} icon={item.icon} label={item.label} onClick={() => setTab(item.key)} />
            ))}
          </div>
        </section>

        {tab === 'pool' && (
          <BelgeHavuzu
            filteredDocuments={filteredDocuments}
            documentsLoading={documentsQuery.isFetching}
            query={query}
            selected={selected}
            selectedId={selectedId}
            sourceView={sourceView}
            processDirection={processDirection}
            hasTaxpayerContext={hasTaxpayerContext}
            selectedTaxpayerName={selectedTaxpayerName}
            readyForTransfer={readyForTransfer}
            onQueryChange={setQuery}
            onSelect={setSelectedId}
            onProcessDirectionChange={setProcessDirection}
          />
        )}

        {tab === 'accounts' && (
          <AccountPlanPanel
            selectedTaxpayer={selectedTaxpayer}
            accountPlan={accountPlanQuery.data}
            loading={accountPlanQuery.isFetching}
            refreshing={accountPlanMutation.isPending}
            onRefresh={() => accountPlanMutation.mutate()}
          />
        )}
        {tab === 'match' && <MatchPanel selected={selected} />}
        {tab === 'transfer' && <TransferPanel documents={documentRows} selected={selected} />}
        {tab === 'sources' && (
          <ConnectionsPanel
            selectedTaxpayer={selectedTaxpayer}
            integrations={integrations}
            selectedProvider={selectedProvider}
            form={integrationForm}
            saving={saveIntegrationMutation.isPending}
            onProviderChange={setSelectedProvider}
            onFormChange={setIntegrationForm}
            onSave={() => saveIntegrationMutation.mutate()}
          />
        )}
        {tab === 'templates' && <TemplatesPanel />}
      </div>
    </main>
  );
}

function BelgeHavuzu({
  filteredDocuments,
  documentsLoading,
  query,
  selected,
  selectedId,
  sourceView,
  processDirection,
  hasTaxpayerContext,
  selectedTaxpayerName,
  readyForTransfer,
  onQueryChange,
  onSelect,
  onProcessDirectionChange,
}: {
  filteredDocuments: DocumentRow[];
  documentsLoading: boolean;
  query: string;
  selected: DocumentRow | null;
  selectedId: string;
  sourceView: SourceView;
  processDirection: ProcessDirection;
  hasTaxpayerContext: boolean;
  selectedTaxpayerName: string;
  readyForTransfer: boolean;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
  onProcessDirectionChange: (value: ProcessDirection) => void;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="rounded-[8px] border border-white/10 bg-[#151515]">
        <div className="flex flex-col gap-2 border-b border-[#2a231a] p-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#f4e8c9]">{sourceView === 'incoming' ? 'Gelen belge havuzu' : 'Giden belge havuzu'}</h2>
            <p className="mt-0.5 text-xs text-stone-500">
              {hasTaxpayerContext ? `${selectedTaxpayerName} için ${sourceView === 'incoming' ? 'alış' : 'satış'} yönündeki belgeler` : 'Mükellef seçildikten sonra açılır'}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex h-9 min-w-[240px] items-center gap-2 rounded-[8px] border border-white/10 bg-[#101010] px-3 text-sm">
              <Search size={15} className="text-stone-500" />
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Firma, belge no, hesap ara"
                className="w-full bg-transparent text-stone-200 outline-none placeholder:text-stone-600"
              />
            </label>
            <button className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-[#101010] px-3 text-sm font-semibold text-stone-300 transition hover:border-white/20">
              <Filter size={15} />
              Filtre
            </button>
          </div>
        </div>

        <div className="grid gap-2 p-2">
          {!hasTaxpayerContext ? (
            <TaxpayerRequiredCard />
          ) : documentsLoading ? (
            <div className="rounded-[8px] border border-white/10 bg-[#101010] p-5 text-sm text-stone-400">Belgeler yükleniyor...</div>
          ) : filteredDocuments.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-white/10 bg-[#101010] p-5 text-sm text-stone-500">
              Bu mükellef ve filtre için belge bulunamadı. Kaynakları tara veya fiş/Z raporu yükle.
            </div>
          ) : (
            filteredDocuments.map((document) => (
              <DocumentItem key={document.id} document={document} selected={selectedId === document.id} onClick={() => onSelect(document.id)} />
            ))
          )}
        </div>
      </section>

      {hasTaxpayerContext ? (
        <DraftPanel
          selected={selected}
          readyForTransfer={readyForTransfer}
          processDirection={processDirection}
          onProcessDirectionChange={onProcessDirectionChange}
        />
      ) : (
        <TaxpayerRequiredCard compact />
      )}
    </div>
  );
}

function DocumentItem({ document, selected, onClick }: { document: DocumentRow; selected: boolean; onClick: () => void }) {
  const status = getStatusView(document.status, document.missing.length);
  const directionTone: Tone = document.direction === 'ALIS' ? 'blue' : 'gold';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid w-full gap-2 rounded-[8px] border px-2.5 py-2 text-left transition lg:grid-cols-[minmax(0,1fr)_132px_150px_96px] lg:items-center ${
        selected ? 'border-[#d4b876]/55 bg-[#1b1913]' : 'border-white/10 bg-[#101010] hover:border-white/20'
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-xs font-semibold text-[#f4e8c9] md:text-sm">{document.title}</span>
          <Badge tone={directionTone}>{directionLabel(document.direction)}</Badge>
          {document.missing.length > 0 && <Badge tone="red">{document.missing.length} eksik</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
          <span>{document.documentNo}</span>
          <span>·</span>
          <span>{document.source}</span>
          <span>·</span>
          <span>{visibleLedgerLabel(document.defter)}</span>
        </div>
      </div>
      <div className="text-xs text-stone-300 md:text-sm">
        <div className="font-semibold">{formatMoney(document.amount)}</div>
        <div className="mt-0.5 text-xs text-stone-500">{document.date || '-'}</div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-stone-200 md:text-sm">{document.account || 'Hesap/alan bekliyor'}</div>
        <div className="mt-0.5 truncate text-xs text-stone-500">{document.rule}</div>
      </div>
      <div className="flex items-center justify-start gap-2 lg:justify-end">
        <Badge tone={status.tone} icon={status.icon}>{status.label}</Badge>
      </div>
    </button>
  );
}

function DraftPanel({
  selected,
  readyForTransfer,
  processDirection,
  onProcessDirectionChange,
}: {
  selected: DocumentRow | null;
  readyForTransfer: boolean;
  processDirection: ProcessDirection;
  onProcessDirectionChange: (value: ProcessDirection) => void;
}) {
  if (!selected) {
    return (
      <aside className="rounded-[8px] border border-white/10 bg-[#151515] p-3">
        <div className="text-sm font-semibold text-[#f4e8c9]">Belge seçilmedi</div>
        <p className="mt-1 text-xs leading-5 text-stone-500">Havuzdan belge seçildiğinde kısa kayıt özeti burada görünür.</p>
      </aside>
    );
  }

  const status = getStatusView(selected.status, selected.missing.length);
  return (
    <aside className="self-start rounded-[8px] border border-white/10 bg-[#151515] xl:sticky xl:top-3">
      <div className="border-b border-[#2a231a] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[#f4e8c9]">{selected.title}</h2>
            <p className="mt-0.5 truncate text-xs text-stone-500">{selected.documentNo} · {selected.provider}</p>
          </div>
          <Badge tone={readyForTransfer ? 'green' : status.tone} icon={readyForTransfer ? CheckCircle2 : status.icon}>
            {readyForTransfer ? 'Hazır' : status.label}
          </Badge>
        </div>
      </div>

      <div className="grid gap-2 p-3">
        <div className="grid grid-cols-2 gap-2">
          <DirectionButton active={processDirection === 'ALIS'} tone="blue" icon={Download} label="Alış" onClick={() => onProcessDirectionChange('ALIS')} />
          <DirectionButton active={processDirection === 'SATIS'} tone="gold" icon={Send} label="Satış" onClick={() => onProcessDirectionChange('SATIS')} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <FieldChip tone="green" label="Kaynak" value={selected.source} ok />
          <FieldChip tone="blue" label="Defter" value={visibleLedgerLabel(selected.defter)} ok />
          <FieldChip tone={selected.date ? 'green' : 'red'} label="Tarih" value={selected.date || '-'} ok={!!selected.date} />
          <FieldChip tone="gold" label="Tutar" value={formatMoney(selected.amount)} ok={selected.amount > 0} />
          <FieldChip tone={selected.kdv !== '-' ? 'purple' : 'red'} label="KDV" value={selected.kdv} ok={selected.kdv !== '-'} />
          <FieldChip tone={selected.confidence >= 90 ? 'green' : 'amber'} label="Güven" value={`%${selected.confidence || 0}`} ok={selected.confidence >= 70} />
        </div>

        <div className="rounded-[8px] border border-white/10 bg-[#101010] p-2.5">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[#d4b876]">
            {selected.defter === 'Bilanco' ? <Layers3 size={15} /> : <ListChecks size={15} />}
            {selected.defter === 'Bilanco' ? 'Hesap planı eşleşmesi' : 'İşletme defteri alanı'}
          </div>
          <div className="truncate text-sm font-semibold text-stone-100">{selected.account || 'Öneri bekliyor'}</div>
          <div className="mt-0.5 truncate text-[11px] text-stone-500">{selected.rule}</div>
        </div>

        <div className="rounded-[8px] border border-white/10 bg-[#101010] p-2.5">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#d4b876]">
            <LockKeyhole size={15} />
            Zorunlu alan
          </div>
          {selected.missing.length ? (
            <div className="flex flex-wrap gap-1.5">{selected.missing.map((missing) => <Badge key={missing} tone="red">{missing}</Badge>)}</div>
          ) : (
            <Badge tone="green" icon={CheckCircle2}>Eksik yok</Badge>
          )}
        </div>

        <button
          className={`inline-flex h-9 items-center justify-center gap-2 rounded-[8px] text-xs font-bold transition ${
            readyForTransfer ? 'bg-[#d4b876] text-[#17120c] hover:bg-[#e4ca88]' : 'cursor-not-allowed border border-[#3a2b23] bg-[#211916] text-stone-500'
          }`}
        >
          {readyForTransfer ? <Send size={15} /> : <LockKeyhole size={15} />}
          Luca paketine al
        </button>
      </div>
    </aside>
  );
}

function AccountPlanPanel({
  selectedTaxpayer,
  accountPlan,
  loading,
  refreshing,
  onRefresh,
}: {
  selectedTaxpayer: Taxpayer | null;
  accountPlan?: AccountPlan;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const hasTaxpayer = Boolean(selectedTaxpayer);
  const accounts = accountPlan?.accounts || [];
  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <section className="rounded-[8px] border border-white/10 bg-[#151515] p-4">
        <div className="mb-4 flex items-center gap-2">
          <Layers3 size={18} className="text-[#d4b876]" />
          <h2 className="text-lg font-semibold text-[#f4e8c9]">Luca hesap planı</h2>
        </div>
        <div className="grid gap-2">
          <FieldLine label="Mükellef" value={selectedTaxpayer ? taxpayerName(selectedTaxpayer) : 'Mükellef seçin'} ok={hasTaxpayer} />
          <FieldLine label="Kapsam" value={hasTaxpayer ? visibleLedgerLabel(taxpayerLedgerLabel(selectedTaxpayer)) : 'Kapalı'} ok={hasTaxpayer} />
          <FieldLine label="Son çekim" value={accountPlan?.source ? formatDate(accountPlan.source.createdAt) : '-'} ok={Boolean(accountPlan?.source)} />
          <FieldLine label="Hesap adedi" value={accountPlan?.source ? `${accountPlan.source.accountCount} satır` : '-'} ok={Boolean(accountPlan?.source)} />
        </div>
        <button
          disabled={!hasTaxpayer || refreshing}
          onClick={onRefresh}
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[8px] bg-[#d4b876] px-4 text-sm font-bold text-[#17120c] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          Luca'dan Hesap Planı Çek
        </button>
        <div className="mt-3 rounded-[8px] border border-white/10 bg-[#101010] p-3 text-sm leading-6 text-stone-300">
          Bilanço firmalarında otomatik eşleştirme bu hesap planı geldikten sonra güvenli çalışır.
        </div>
      </section>

      <section className="rounded-[8px] border border-white/10 bg-[#151515]">
        <div className="flex items-center justify-between border-b border-[#2a231a] p-4">
          <div>
            <h3 className="font-semibold text-[#f4e8c9]">Hesap planı satırları</h3>
            <p className="mt-1 text-sm text-stone-500">{loading ? 'Yükleniyor...' : accounts.length ? 'Luca snapshot üzerinden' : 'Henüz veri yok'}</p>
          </div>
          <Badge tone={accounts.length ? 'green' : 'amber'} icon={accounts.length ? CheckCircle2 : CircleDashed}>{accounts.length ? 'Güncel' : 'Bekliyor'}</Badge>
        </div>
        <div className="max-h-[520px] divide-y divide-[#2a231a] overflow-auto">
          {accounts.length === 0 ? (
            <div className="p-5 text-sm text-stone-500">Hesap planı çekilmemiş. Soldaki buton Luca ajanına iş açar.</div>
          ) : (
            accounts.slice(0, 120).map((row) => (
              <div key={row.id} className="grid gap-3 px-4 py-3 md:grid-cols-[140px_minmax(0,1fr)_110px] md:items-center">
                <div className="font-mono text-sm font-semibold text-[#d4b876]">{row.code}</div>
                <div className="truncate text-sm font-medium text-stone-100">{row.name}</div>
                <Badge tone={row.code.startsWith('191') || row.code.startsWith('391') ? 'blue' : row.code.startsWith('600') ? 'green' : 'amber'}>
                  Seviye {row.level}
                </Badge>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ConnectionsPanel({
  selectedTaxpayer,
  integrations,
  selectedProvider,
  form,
  saving,
  onProviderChange,
  onFormChange,
  onSave,
}: {
  selectedTaxpayer: Taxpayer | null;
  integrations: IntegrationRow[];
  selectedProvider: string;
  form: Record<string, string>;
  saving: boolean;
  onProviderChange: (provider: string) => void;
  onFormChange: (form: any) => void;
  onSave: () => void;
}) {
  const selected = integrations.find((item) => item.provider === selectedProvider) || integrations[0];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="rounded-[8px] border border-white/10 bg-[#151515]">
        <div className="border-b border-[#2a231a] p-4">
          <h2 className="text-lg font-semibold text-[#f4e8c9]">Entegratör API kayıtları</h2>
          <p className="mt-1 text-sm text-stone-500">e-Logo, Uyumsoft, Mikro, İzibiz, Kolaysoft, Foriba, Paraşüt, Logo İşbaşı, TÜRMOB e-Fatura ve GİB Portal</p>
        </div>
        <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
          {integrations.map((row) => (
            <button
              key={row.provider}
              type="button"
              onClick={() => onProviderChange(row.provider)}
              className={`rounded-[8px] border bg-[#101010] p-3 text-left transition ${row.provider === selectedProvider ? 'border-[#d4b876]/55' : 'border-white/10 hover:border-white/20'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#f4e8c9]">{row.label}</div>
                  <div className="mt-1 text-xs text-stone-500">{row.kind}</div>
                </div>
                <Badge tone={row.configured ? 'green' : 'amber'}>{row.configured ? 'Kayıtlı' : 'Kurulum'}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {row.hasApiKey && <Badge tone="blue">API key</Badge>}
                {row.hasApiSecret && <Badge tone="purple">Secret</Badge>}
                {row.hasPassword && <Badge tone="gold">Şifre</Badge>}
                {row.taxpayerScoped && <Badge tone="green">Mükellef</Badge>}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-[8px] border border-white/10 bg-[#151515] p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-[#f4e8c9]">{selected?.label || 'Entegratör'} kaydı</h3>
            <p className="mt-1 text-xs text-stone-500">{selectedTaxpayer ? taxpayerName(selectedTaxpayer) : 'Global kayıt'}</p>
          </div>
          <Badge tone={selected?.configured ? 'green' : 'amber'}>{selected?.configured ? 'Aktif' : 'Eksik'}</Badge>
        </div>
        <div className="grid gap-2">
          <ApiInput label="API adresi" value={form.baseUrl} onChange={(value) => onFormChange({ ...form, baseUrl: value })} placeholder="https://api..." />
          <ApiInput label="Kullanıcı / hesap" value={form.username} onChange={(value) => onFormChange({ ...form, username: value })} placeholder="kullanıcı adı" />
          <ApiInput label="API key" value={form.apiKey} onChange={(value) => onFormChange({ ...form, apiKey: value })} placeholder={selected?.hasApiKey ? 'Kayıtlı - değiştirmek için yaz' : 'API key'} secret />
          <ApiInput label="API secret" value={form.apiSecret} onChange={(value) => onFormChange({ ...form, apiSecret: value })} placeholder={selected?.hasApiSecret ? 'Kayıtlı - değiştirmek için yaz' : 'API secret'} secret />
          <ApiInput label="Şifre / token" value={form.password} onChange={(value) => onFormChange({ ...form, password: value })} placeholder={selected?.hasPassword ? 'Kayıtlı - değiştirmek için yaz' : 'Şifre veya token'} secret />
          <ApiInput label="Gönderici VKN" value={form.senderVkn} onChange={(value) => onFormChange({ ...form, senderVkn: value })} placeholder="VKN/TCKN" />
          <ApiInput label="Hesap / firma kodu" value={form.accountId} onChange={(value) => onFormChange({ ...form, accountId: value })} placeholder="entegratör firma kodu" />
          <ApiInput label="Not" value={form.note} onChange={(value) => onFormChange({ ...form, note: value })} placeholder="opsiyonel" />
        </div>
        <button
          disabled={saving}
          onClick={onSave}
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[8px] bg-[#d4b876] text-sm font-bold text-[#17120c] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <PlugZap size={16} />
          {saving ? 'Kaydediliyor...' : 'API kaydını sakla'}
        </button>
      </section>
    </div>
  );
}

function MatchPanel({ selected }: { selected: DocumentRow | null }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-[8px] border border-white/10 bg-[#151515] p-4">
        <h2 className="text-lg font-semibold text-[#f4e8c9]">Eşleştirme kuralları</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <RuleCard tone="green" title="Telekom koruması" detail="Superonline/Turkcell gibi faturalar yemek giderine düşmez; haberleşme veya ilgili hizmet hesabı aranır." />
          <RuleCard tone="amber" title="Akaryakıt kilidi" detail="Fiş tarihi, cari ve belge no dolmadan otomatik Luca paketi oluşmaz." />
          <RuleCard tone="blue" title="Hesap planı tanığı" detail="Bilanço firmalarında 191/391, 120/320 ve gider hesapları Luca snapshot üstünden seçilir." />
          <RuleCard tone="purple" title="İşletme alanı" detail="İşletme defterlerinde hesap kodu yerine yüklenen seçilebilir alan şablonu kullanılır." />
        </div>
      </section>
      <section className="rounded-[8px] border border-white/10 bg-[#151515] p-4">
        <Gauge size={18} className="mb-3 text-[#d4b876]" />
        <div className="text-sm font-semibold text-[#f4e8c9]">{selected?.title || 'Belge seçilmedi'}</div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#2b241b]">
          <div className="h-full rounded-full bg-[#d4b876]" style={{ width: `${selected?.confidence || 0}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-stone-500">
          <span>Güven</span>
          <span className="font-semibold text-[#d4b876]">%{selected?.confidence || 0}</span>
        </div>
      </section>
    </div>
  );
}

function TransferPanel({ documents, selected }: { documents: DocumentRow[]; selected: DocumentRow | null }) {
  const transferRows = documents.map((document) => ({ ...document, ready: document.status === 'ready' && document.missing.length === 0 }));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-[8px] border border-white/10 bg-[#151515]">
        <div className="flex items-center justify-between border-b border-[#2a231a] p-4">
          <div>
            <h2 className="text-lg font-semibold text-[#f4e8c9]">Luca aktarım kuyruğu</h2>
            <p className="mt-1 text-sm text-stone-500">Eksik alan varsa kayıt paketi oluşmaz</p>
          </div>
          <button className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#d4b876] px-4 text-sm font-bold text-[#17120c]">
            <Send size={15} />
            Hazırları Aktar
          </button>
        </div>
        <div className="divide-y divide-[#2a231a]">
          {transferRows.length === 0 ? (
            <div className="p-5 text-sm text-stone-500">Aktarılacak belge yok.</div>
          ) : (
            transferRows.map((row) => (
              <div key={row.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[1.1fr_0.7fr_0.8fr_0.5fr] lg:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-stone-100">{row.title}</div>
                  <div className="mt-1 text-xs text-stone-500">{row.source} · {row.documentNo}</div>
                </div>
                <div className="truncate text-sm text-stone-300">{row.account || 'Hesap/alan yok'}</div>
                <div className="flex flex-wrap gap-1">
                  {row.missing.length ? row.missing.map((missing) => <Badge key={missing} tone="red">{missing}</Badge>) : <Badge tone="green" icon={CheckCircle2}>Tamam</Badge>}
                </div>
                <div className="flex justify-start lg:justify-end">
                  <Badge tone={row.ready ? 'green' : 'amber'} icon={row.ready ? CheckCircle2 : CircleDashed}>{row.ready ? 'Hazır' : 'Bekler'}</Badge>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="rounded-[8px] border border-white/10 bg-[#151515] p-4">
        <h3 className="mb-3 font-semibold text-[#f4e8c9]">Kayıt kapısı</h3>
        <div className="grid gap-2">
          <MiniCheck ok={Boolean(selected && selected.missing.length === 0)} title="Zorunlu alanlar" detail={selected?.missing.length ? selected.missing.join(', ') : 'Eksik yok'} />
          <MiniCheck ok={Boolean(selected && selected.confidence >= 70)} title="OCR/veri güveni" detail={`%${selected?.confidence || 0}`} />
          <MiniCheck ok={Boolean(selected?.account)} title="Hesap veya işletme alanı" detail={selected?.account || 'Yok'} />
        </div>
      </section>
    </div>
  );
}

function TemplatesPanel() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-[8px] border border-white/10 bg-[#151515]">
        <div className="flex items-center justify-between border-b border-[#2a231a] p-4">
          <div>
            <h2 className="text-lg font-semibold text-[#f4e8c9]">İşletme defteri seçilebilir alanları</h2>
            <p className="mt-1 text-sm text-stone-500">Hesap planı olmayan firmalar için şablon seti</p>
          </div>
          <button className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-white/10 bg-[#101010] px-3 text-sm font-semibold text-stone-300">
            <Upload size={15} />
            Liste Yükle
          </button>
        </div>
        <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-4">
          {isletmeFields.map((field, index) => (
            <div key={field} className="rounded-[8px] border border-white/10 bg-[#101010] p-4">
              <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-[8px] bg-white/[0.04] text-sm font-bold text-emerald-300">
                {String(index + 1).padStart(2, '0')}
              </div>
              <div className="text-sm font-semibold text-[#f4e8c9]">{field}</div>
              <div className="mt-2 text-xs text-stone-500">Firma bazlı seçim listesi</div>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-[8px] border border-white/10 bg-[#151515] p-4">
        <Table2 size={18} className="mb-3 text-[#d4b876]" />
        <div className="grid gap-2">
          <FieldLine label="Belge" value="Z Raporu" ok />
          <FieldLine label="Yön" value="Satış / Gelir" ok />
          <FieldLine label="Gelir türü" value="Perakende satış" ok />
          <FieldLine label="KDV" value="%20" ok />
        </div>
      </section>
    </div>
  );
}

function UploadBox({
  title,
  detail,
  icon: Icon,
  accept,
  disabled = false,
  tone,
  onFiles,
}: {
  title: string;
  detail: string;
  icon: LucideIcon;
  accept: string;
  disabled?: boolean;
  tone: Tone;
  onFiles: (files: File[]) => void;
}) {
  const classes = toneClasses[tone];
  return (
    <label className={`group flex min-h-[52px] items-center gap-3 rounded-[8px] border border-white/10 bg-[#101010] p-2.5 transition ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:border-[#d4b876]/45 hover:bg-[#181818]'}`}>
      <input
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(event) => {
          if (disabled) return;
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onFiles(files);
          event.currentTarget.value = '';
        }}
      />
      <div className={`flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/[0.04] ${classes.text}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[#f4e8c9]">{title}</div>
        <div className="mt-0.5 truncate text-xs text-stone-500">{detail}</div>
      </div>
      <ArrowRight size={16} className="ml-auto text-stone-600 transition group-hover:text-[#d4b876]" />
    </label>
  );
}

function OcrQueue({ jobs }: { jobs: UploadJob[] }) {
  const active = jobs.some((job) => job.status === 'Yukleniyor' || job.status === 'OCR okunuyor');
  return (
    <section className="flex min-h-[52px] items-center justify-between gap-3 rounded-[8px] border border-white/10 bg-[#101010] px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Zap size={16} className="shrink-0 text-[#d4b876]" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#f4e8c9]">OCR kuyruğu</div>
          <div className="truncate text-xs text-stone-500">{jobs.length ? `${jobs[0].fileName} · ${jobs[0].status}` : 'Boş'}</div>
        </div>
      </div>
      <Badge tone={active ? 'amber' : jobs.length ? 'green' : 'slate'}>{jobs.length ? `${jobs.length} dosya` : 'Boş'}</Badge>
    </section>
  );
}

function Metric({ label, value, hint, icon: Icon, tone }: { label: string; value: number | string; hint: string; icon: LucideIcon; tone: Tone }) {
  const classes = toneClasses[tone];
  return (
    <div className="flex h-10 min-w-[132px] items-center gap-2 rounded-[8px] border border-white/10 bg-[#101010] px-2.5">
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.04] ${classes.text}`}>
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-stone-500">{label}</div>
        <div className="truncate text-sm font-semibold text-[#f4e8c9]">{value}</div>
        <div className="hidden truncate text-[10px] text-stone-500 2xl:block">{hint}</div>
      </div>
    </div>
  );
}

function DirectionButton({ active, icon: Icon, label, tone = 'gold', onClick }: { active: boolean; icon: LucideIcon; label: string; tone?: Tone; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-[8px] px-3 text-xs font-semibold transition ${
        active ? 'border border-[#d4b876]/55 bg-[#d4b876] text-[#17120c]' : 'border border-white/10 bg-[#101010] text-stone-400 hover:border-white/20 hover:text-stone-100'
      }`}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

function TabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-[8px] px-3 text-xs font-semibold transition ${
        active ? 'bg-[#d4b876] text-[#17120c]' : 'border border-white/10 bg-[#101010] text-stone-400 hover:border-white/20 hover:text-stone-100'
      }`}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

function Badge({ tone, icon: Icon, children }: { tone: Tone; icon?: LucideIcon; children: React.ReactNode }) {
  const classes = toneClasses[tone];
  return (
    <span className={`inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold ${classes.bg} ${classes.border} ${classes.text}`}>
      {Icon ? <Icon size={12} /> : <span className={`h-1.5 w-1.5 rounded-full ${classes.dot}`} />}
      {children}
    </span>
  );
}

function FieldLine({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-[#101010] p-2.5">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-500">
        <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-rose-400'}`} />
        {label}
      </div>
      <div className="truncate text-sm font-semibold text-stone-100">{value}</div>
    </div>
  );
}

function FieldChip({ tone, label, value, ok }: { tone: Tone; label: string; value: string; ok: boolean }) {
  const classes = toneClasses[ok ? tone : 'red'];
  return (
    <div className="min-w-0 rounded-[8px] border border-white/10 bg-[#101010] px-2 py-2">
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${classes.text}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${classes.dot}`} />
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-semibold text-stone-100">{value}</div>
    </div>
  );
}

function ApiInput({ label, value, placeholder, secret, onChange }: { label: string; value: string; placeholder: string; secret?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-500">{label}</span>
      <input
        type={secret ? 'password' : 'text'}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-[8px] border border-white/10 bg-[#101010] px-3 text-sm text-stone-100 outline-none placeholder:text-stone-600 focus:border-[#d4b876]/45"
      />
    </label>
  );
}

function TaxpayerRequiredCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`rounded-[8px] border border-amber-400/25 bg-amber-500/10 ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-amber-500/12 text-amber-300">
          <AlertTriangle size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-amber-200">Mükellef seçimi gerekli</div>
          <div className="mt-1 text-sm leading-6 text-stone-400">Belge havuzu, OCR, hesap planı ve Luca aktarımı seçili mükellefe göre çalışır.</div>
        </div>
      </div>
    </div>
  );
}

function RuleCard({ tone, title, detail }: { tone: Tone; title: string; detail: string }) {
  const classes = toneClasses[tone];
  return (
    <div className={`rounded-[8px] border p-4 ${classes.bg} ${classes.border}`}>
      <div className={`text-sm font-semibold ${classes.text}`}>{title}</div>
      <div className="mt-2 text-sm leading-6 text-stone-400">{detail}</div>
    </div>
  );
}

function MiniCheck({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div className={`rounded-[8px] border p-3 ${ok ? 'border-emerald-400/20 bg-emerald-500/10' : 'border-amber-400/20 bg-amber-500/10'}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] ${ok ? 'bg-emerald-500/12 text-emerald-300' : 'bg-amber-500/12 text-amber-300'}`}>
          {ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-stone-100">{title}</div>
          <div className="mt-1 text-xs leading-5 text-stone-500">{detail}</div>
        </div>
      </div>
    </div>
  );
}

function getStatusView(status: DocumentStatus, missingCount: number): { label: string; tone: Tone; icon: LucideIcon } {
  if (status === 'ready') return { label: 'Hazır', tone: 'green', icon: CheckCircle2 };
  if (status === 'blocked') return { label: `${missingCount || 1} eksik`, tone: 'red', icon: LockKeyhole };
  if (status === 'draft') return { label: 'Taslak', tone: 'blue', icon: FileCheck2 };
  return { label: missingCount ? `${missingCount} eksik` : 'Onay', tone: 'amber', icon: AlertTriangle };
}
