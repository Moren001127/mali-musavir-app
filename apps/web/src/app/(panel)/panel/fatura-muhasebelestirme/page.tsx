'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Upload,
  ScanLine,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Plus,
  Save,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Loader2,
  Receipt,
  RefreshCw,
  AlertTriangle,
  ArrowLeft,
  SlidersHorizontal,
  Pencil,
  Maximize2,
  Search,
  X,
  Keyboard,
  Filter,
  MoreVertical,
} from 'lucide-react';
import { api } from '@/lib/api';

type OcrDetected = {
  filename: string;
  date: string;
  belge_no?: string;
  cari?: string;
  vergi_no?: string;
  kdv_1?: string;
  kdv_10?: string;
  kdv_20?: string;
  toplam?: string;
};

type AccountingLine = {
  id: string;
  group: 'matrah' | 'vergi' | 'cari' | 'iskonto' | 'stopaj' | 'tevkifat';
  accountCode: string;
  description: string;
  rate?: string;
  debit: string;
  credit: string;
};

const KDV_RATES = ['%20', '%10', '%1', '%0'] as const;
const TEVKIFAT_RATES = ['2/10', '3/10', '4/10', '5/10', '7/10', '9/10', '10/10'] as const;
const STOPAJ_RATES = ['%5', '%10', '%15', '%17', '%20'] as const;

type DraftInvoice = {
  id: string;
  backendId?: string;
  taxpayerId?: string | null;
  ledgerType?: string | null;
  file: Pick<File, 'name' | 'size' | 'type'>;
  originalFile?: File;
  previewUrl: string;
  previewType: 'image' | 'pdf' | 'other';
  source: 'manual-okc' | 'manual-invoice';
  documentType: 'OKC_FIS' | 'E_FATURA' | 'E_ARSIV' | 'FIS' | 'DIGER';
  invoiceKind: 'Alış' | 'Satış';
  currency: string;
  exchangeRate: string;
  date: string;
  serial: string;
  number: string;
  buyerVkn: string;
  sellerVkn: string;
  vendorName: string;
  customerName: string;
  total: string;
  lines: AccountingLine[];
  status: 'bekliyor' | 'ocr' | 'hazir' | 'kontrol' | 'onaylandi';
  duplicateOfId?: string | null;
  duplicateReason?: string | null;
  duplicateSeverity?: string | null;
  foreignInvoice?: boolean;
};

type AccountOption = {
  id: string;
  code: string;
  name: string;
  level?: number;
};

type DashboardRow = {
  taxpayerId: string;
  name: string;
  ledgerType: string;
  pendingPurchase: number;
  pendingSale: number;
  pendingBank: number;
  approvedInvoice: number;
  approvedBank: number;
  totalPending: number;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const money = (value?: string) => {
  if (!value) return '0,00';
  const n = Number(String(value).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const parseAmount = (value?: string) => {
  if (!value) return 0;
  const normalized = String(value).replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};

const previewTypeFromMime = (mimeType?: string): DraftInvoice['previewType'] => {
  const type = String(mimeType || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf' || type.includes('html') || type.includes('xml')) return 'pdf';
  return 'other';
};

const isBusinessLedger = (ledgerType?: string | null) =>
  /isletme|işletme|defter beyan|serbest/i.test(String(ledgerType || '').toLocaleLowerCase('tr-TR'));

const businessCategories = [
  'İndirilecek Giderler',
  'Gider Yazılmayacak Ödemeler',
  'Mal Alışı',
  'Satış',
  'Diğer Hasılat',
];

const businessSubCategories = [
  'Gıda Harcamaları',
  'Araç Yakıt Giderleri',
  'Kira Giderleri',
  'Telefon ve İnternet',
  'Ofis Giderleri',
  'Temizlik Giderleri',
  'Diğer',
];

const DOCUMENT_BASE_WIDTH = 980;
const DOCUMENT_BASE_HEIGHT = 1380;

const makeLine = (
  group: AccountingLine['group'],
  accountCode: string,
  description: string,
  debit: string,
  credit = '0,00',
  rate?: string,
): AccountingLine => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  group,
  accountCode,
  description,
  rate,
  debit,
  credit,
});

const defaultLinesFromOcr = (detected?: OcrDetected): AccountingLine[] => {
  const kdv20 = parseAmount(detected?.kdv_20);
  const kdv10 = parseAmount(detected?.kdv_10);
  const kdv1 = parseAmount(detected?.kdv_1);
  const total = parseAmount(detected?.toplam);
  const taxTotal = kdv20 + kdv10 + kdv1;
  const matrah = Math.max(total - taxTotal, 0);
  const lines: AccountingLine[] = [
    makeLine('matrah', '770.01.010', 'Gider / matrah', money(String(matrah)), '0,00'),
  ];
  if (kdv20 > 0) lines.push(makeLine('vergi', '191.01.020', 'İndirilecek KDV', money(String(kdv20)), '0,00', '%20'));
  if (kdv10 > 0) lines.push(makeLine('vergi', '191.01.010', 'İndirilecek KDV', money(String(kdv10)), '0,00', '%10'));
  if (kdv1 > 0) lines.push(makeLine('vergi', '191.01.001', 'İndirilecek KDV', money(String(kdv1)), '0,00', '%1'));
  lines.push(makeLine('cari', '320.01.001', 'Cari hesap', '0,00', money(String(total))));
  return lines;
};

const fromApiLine = (line: any): AccountingLine => ({
  id: line.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  group: line.group || 'matrah',
  accountCode: line.accountCode || '',
  description: line.description || '',
  rate: line.rate || '',
  debit: money(line.debit),
  credit: money(line.credit),
});

const applyApiDocument = (draft: DraftInvoice, doc: any): DraftInvoice => ({
  ...draft,
  backendId: doc.id,
  taxpayerId: doc.taxpayerId || draft.taxpayerId || null,
  source: doc.source === 'mobile' ? 'manual-okc' : draft.source,
  documentType: doc.documentType || draft.documentType,
  invoiceKind: doc.invoiceKind === 'SATIS' ? 'Satış' : 'Alış',
  currency: doc.currency || draft.currency,
  exchangeRate: doc.exchangeRate ? String(doc.exchangeRate).replace('.', ',') : draft.exchangeRate,
  date: doc.faturaTarihi ? String(doc.faturaTarihi).slice(0, 10) : draft.date,
  serial: doc.seriNo || draft.serial,
  number: doc.belgeNo || draft.number,
  buyerVkn: doc.buyerVkn || draft.buyerVkn,
  sellerVkn: doc.sellerVkn || draft.sellerVkn,
  vendorName: doc.vendorName || draft.vendorName,
  customerName: doc.customerName || draft.customerName,
  total: money(doc.totalAmount),
  lines: Array.isArray(doc.lines) && doc.lines.length ? doc.lines.map(fromApiLine) : draft.lines,
  status: doc.status === 'APPROVED' ? 'onaylandi' : doc.status === 'READY' ? 'hazir' : 'kontrol',
  duplicateOfId: doc.duplicateOfId || null,
  duplicateReason: doc.duplicateReason || null,
  duplicateSeverity: doc.duplicateSeverity || null,
});

const draftFromApiDocument = (doc: any, fileUrl: string): DraftInvoice => {
  const mimeType = doc.mimeType || 'application/octet-stream';
  return applyApiDocument(
    {
      id: `remote-${doc.id}`,
      backendId: doc.id,
      taxpayerId: doc.taxpayerId || null,
      ledgerType: doc.ledgerType || doc.taxpayerLedgerType || null,
      file: { name: doc.originalName, size: doc.sizeBytes || 0, type: mimeType },
      previewUrl: fileUrl,
      previewType: previewTypeFromMime(mimeType),
      source: doc.source === 'mobile' ? 'manual-okc' : 'manual-invoice',
      documentType: doc.documentType || 'OKC_FIS',
      invoiceKind: doc.invoiceKind === 'SATIS' ? 'Satış' : 'Alış',
      currency: doc.currency || 'TL',
      exchangeRate: doc.exchangeRate ? String(doc.exchangeRate) : '1',
      date: doc.faturaTarihi ? String(doc.faturaTarihi).slice(0, 10) : todayIso(),
      serial: doc.seriNo || '',
      number: doc.belgeNo || '',
      buyerVkn: doc.buyerVkn || '',
      sellerVkn: doc.sellerVkn || '',
      vendorName: doc.vendorName || '',
      customerName: doc.customerName || '',
      total: money(doc.totalAmount),
      lines: Array.isArray(doc.lines) && doc.lines.length ? doc.lines.map(fromApiLine) : defaultLinesFromOcr(),
      status: 'kontrol',
    },
    doc,
  );
};

const previewUrlFromFileResponse = (resData: any) => {
  if (resData?.inlineHtml) {
    return URL.createObjectURL(new Blob([resData.inlineHtml], { type: 'text/html;charset=utf-8' }));
  }
  return resData?.url || '';
};

function blankDraft(file: File, previewUrl: string): DraftInvoice {
  const isPdf = file.type === 'application/pdf';
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    taxpayerId: null,
    file,
    previewUrl,
    previewType: file.type.startsWith('image/') ? 'image' : isPdf ? 'pdf' : 'other',
    source: 'manual-okc',
    documentType: 'OKC_FIS',
    invoiceKind: 'Alış',
    currency: 'TL',
    exchangeRate: '1',
    date: todayIso(),
    serial: '',
    number: '',
    buyerVkn: '',
    sellerVkn: '',
    vendorName: '',
    customerName: '',
    total: '0,00',
    lines: defaultLinesFromOcr(),
    status: 'bekliyor',
    duplicateOfId: null,
    duplicateReason: null,
    duplicateSeverity: null,
  };
}

type LedgerFilter = 'all' | 'bilanco' | 'isletme';
type PendingFilter = 'all' | 'pending' | 'clear';

export default function FaturaMuhasebelestirmePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const documentStageRef = useRef<HTMLDivElement>(null);
  const [drafts, setDrafts] = useState<DraftInvoice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [globalDragging, setGlobalDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState<'fit' | 'fit-width' | 'manual'>('fit');
  const [rotation, setRotation] = useState(0);
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [accountPlanSource, setAccountPlanSource] = useState<any>(null);
  const [accountPlanLoading, setAccountPlanLoading] = useState(false);
  const [accountPlanRefreshing, setAccountPlanRefreshing] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true);
  const [dashboardRows, setDashboardRows] = useState<DashboardRow[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [dashboardAccountPlanJob, setDashboardAccountPlanJob] = useState<string | null>(null);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('all');
  const [pendingFilter, setPendingFilter] = useState<PendingFilter>('pending');
  const [accountPicker, setAccountPicker] = useState<{ lineId: string; query: string } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [openSections, setOpenSections] = useState<{ iskonto: boolean; stopaj: boolean; tevkifat: boolean }>({
    iskonto: false,
    stopaj: false,
    tevkifat: false,
  });

  const selected = drafts.find((d) => d.id === selectedId) || drafts[0] || null;
  const selectedIndex = selected ? drafts.findIndex((d) => d.id === selected.id) : -1;
  const selectedBusinessLedger = isBusinessLedger(selected?.ledgerType);
  const readyCount = drafts.filter((d) => d.status === 'hazir').length;
  const fitScale = useMemo(() => {
    if (!stageSize.width || !stageSize.height) return 0.68;
    const byWidth = (stageSize.width - 28) / DOCUMENT_BASE_WIDTH;
    const byHeight = (stageSize.height - 28) / DOCUMENT_BASE_HEIGHT;
    return Math.max(0.42, Math.min(byWidth, byHeight, 1));
  }, [stageSize.height, stageSize.width]);
  const fitWidthScale = useMemo(() => {
    if (!stageSize.width) return 0.86;
    return Math.max(0.48, Math.min((stageSize.width - 28) / DOCUMENT_BASE_WIDTH, 1.18));
  }, [stageSize.width]);
  const viewerScale = zoomMode === 'fit' ? fitScale : zoomMode === 'fit-width' ? fitWidthScale : zoom;
  const setManualZoom = (value: number) => {
    setZoomMode('manual');
    setZoom(value);
  };
  const fitDocument = () => {
    setZoomMode('fit');
    setZoom(fitScale);
  };
  const fitDocumentWidth = () => {
    setZoomMode('fit-width');
    setZoom(fitWidthScale);
  };

  const dashboardFiltered = useMemo(() => {
    const q = dashboardSearch.trim().toLocaleLowerCase('tr-TR');
    let rows = [...dashboardRows].sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'));
    if (q) rows = rows.filter((row) => row.name.toLocaleLowerCase('tr-TR').includes(q));
    if (ledgerFilter !== 'all') {
      rows = rows.filter((row) => {
        const isBus = isBusinessLedger(row.ledgerType);
        return ledgerFilter === 'isletme' ? isBus : !isBus;
      });
    }
    if (pendingFilter !== 'all') {
      rows = rows.filter((row) => {
        const pending = (row.pendingPurchase || 0) + (row.pendingSale || 0) + (row.pendingBank || 0);
        return pendingFilter === 'pending' ? pending > 0 : pending === 0;
      });
    }
    return rows;
  }, [dashboardRows, dashboardSearch, ledgerFilter, pendingFilter]);

  const dashboardTotals = useMemo(() => {
    const tp = dashboardRows.length;
    const pendingPurchase = dashboardRows.reduce((s, r) => s + (r.pendingPurchase || 0), 0);
    const pendingSale = dashboardRows.reduce((s, r) => s + (r.pendingSale || 0), 0);
    const pendingBank = dashboardRows.reduce((s, r) => s + (r.pendingBank || 0), 0);
    return { tp, pendingPurchase, pendingSale, pendingBank };
  }, [dashboardRows]);

  const totals = useMemo(() => {
    const debit = selected?.lines.reduce((sum, line) => sum + parseAmount(line.debit), 0) || 0;
    const credit = selected?.lines.reduce((sum, line) => sum + parseAmount(line.credit), 0) || 0;
    return { debit, credit, diff: Math.abs(debit - credit) };
  }, [selected]);

  const balanceOk = totals.diff < 0.01;

  useEffect(() => {
    let alive = true;
    const taxpayerId = selected?.taxpayerId;
    if (!taxpayerId) {
      setAccountOptions([]);
      setAccountPlanSource(null);
      return;
    }
    (async () => {
      setAccountPlanLoading(true);
      try {
        const { data } = await api.get('/fatura-muhasebelestirme/account-plan', {
          params: { taxpayerId, limit: 700 },
        });
        if (!alive) return;
        setAccountOptions(Array.isArray(data?.accounts) ? data.accounts : []);
        setAccountPlanSource(data?.source || null);
      } catch {
        if (alive) {
          setAccountOptions([]);
          setAccountPlanSource(null);
        }
      } finally {
        if (alive) setAccountPlanLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected?.taxpayerId]);

  const loadDashboard = async () => {
    setDashboardLoading(true);
    try {
      const { data } = await api.get('/fatura-muhasebelestirme/dashboard');
      setDashboardRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Gelen evrak özeti alınamadı');
    } finally {
      setDashboardLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    const node = documentStageRef.current;
    if (!node) return;
    const update = () => setStageSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(node);
    window.addEventListener('resize', update);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [showDashboard]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingExisting(true);
      try {
        const { data } = await api.get('/fatura-muhasebelestirme/documents', {
          params: { limit: 50 },
        });
        const list = Array.isArray(data) ? data : [];
        const hydrated = await Promise.all(
          list.map(async (doc: any) => {
            try {
              const res = await api.get(`/fatura-muhasebelestirme/documents/${doc.id}/file-url`);
              return draftFromApiDocument(doc, previewUrlFromFileResponse(res.data));
            } catch {
              return draftFromApiDocument(doc, '');
            }
          }),
        );
        if (!alive) return;
        setDrafts((prev) => {
          const localKeys = new Set(prev.map((d) => d.backendId || d.id));
          const additions = hydrated.filter((d) => !localKeys.has(d.backendId || d.id));
          if (!selectedId && additions[0]) setSelectedId(additions[0].id);
          return [...prev, ...additions];
        });
      } catch {
        /* Auth redirect veya backend hazir degilse sessiz kal. */
      } finally {
        if (alive) setLoadingExisting(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const openTaxpayerQueue = async (row: DashboardRow, kind?: 'ALIS' | 'SATIS') => {
    setLoadingExisting(true);
    try {
      const { data } = await api.get('/fatura-muhasebelestirme/documents', {
        params: { taxpayerId: row.taxpayerId, limit: 200 },
      });
      const list = (Array.isArray(data) ? data : []).filter((doc: any) => {
        if (!kind) return true;
        return doc.invoiceKind === kind && doc.status !== 'APPROVED';
      });
      const hydrated = await Promise.all(
        list.map(async (doc: any) => {
          try {
            const res = await api.get(`/fatura-muhasebelestirme/documents/${doc.id}/file-url`);
            return { ...draftFromApiDocument(doc, previewUrlFromFileResponse(res.data)), ledgerType: row.ledgerType };
          } catch {
            return { ...draftFromApiDocument(doc, ''), ledgerType: row.ledgerType };
          }
        }),
      );
      setDrafts(hydrated);
      setSelectedId(hydrated[0]?.id || null);
      setShowDashboard(false);
      if (!hydrated.length) toast.info(`${row.name} için seçili türde bekleyen fatura yok`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Mükellef kuyruğu açılamadı');
    } finally {
      setLoadingExisting(false);
    }
  };

  const addFiles = useCallback((files: FileList | File[]) => {
    const next = Array.from(files).filter((file) =>
      file.type.startsWith('image/') ||
      file.type === 'application/pdf' ||
      file.type.includes('xml') ||
      /\.xml$/i.test(file.name),
    );
    if (!next.length) return;
    setDrafts((prev) => {
      const existing = new Set(prev.map((d) => `${d.file.name}-${d.file.size}`));
      const additions = next
        .filter((file) => !existing.has(`${file.name}-${file.size}`))
        .map((file) => ({ ...blankDraft(file, URL.createObjectURL(file)), originalFile: file }));
      if (additions.length) {
        if (showDashboard) setShowDashboard(false);
        setSelectedId((curr) => curr || additions[0]?.id || null);
      }
      return [...prev, ...additions];
    });
  }, [showDashboard]);

  const updateSelected = (patch: Partial<DraftInvoice>) => {
    if (!selected) return;
    setDrafts((prev) => prev.map((d) => (d.id === selected.id ? { ...d, ...patch } : d)));
  };

  const updateLine = (lineId: string, patch: Partial<AccountingLine>) => {
    if (!selected) return;
    updateSelected({
      lines: selected.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    });
  };

  const removeSelected = () => {
    if (!selected) return;
    URL.revokeObjectURL(selected.previewUrl);
    setDrafts((prev) => prev.filter((d) => d.id !== selected.id));
    const next = drafts[selectedIndex + 1] || drafts[selectedIndex - 1] || null;
    setSelectedId(next?.id || null);
  };

  const runOcr = async () => {
    const uploadableDrafts = drafts.filter((d) => !d.backendId && d.originalFile);
    if (!uploadableDrafts.length) {
      toast.info('Tüm belgeler zaten kalıcı kuyruğa alındı');
      return;
    }
    setScanning(true);
    setDrafts((prev) => prev.map((d) => (!d.backendId ? { ...d, status: 'ocr' } : d)));
    try {
      const fd = new FormData();
      uploadableDrafts.forEach((d) => d.originalFile && fd.append('files', d.originalFile));
      fd.append('source', 'manual-web');
      fd.append('documentType', 'OKC_FIS');
      fd.append('invoiceKind', 'ALIS');
      const { data } = await api.post('/fatura-muhasebelestirme/documents/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const documents: any[] = data?.documents || [];
      const byName = new Map(documents.map((doc) => [doc.originalName, doc]));
      setDrafts((prev) =>
        prev.map((d) => {
          const hit = byName.get(d.file.name);
          if (!hit) return !d.backendId ? { ...d, status: 'kontrol' } : d;
          return applyApiDocument(d, hit);
        }),
      );
      toast.success(`${documents.length} belge kalıcı kuyruğa alındı`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Belgeler kaydedilemedi');
      setDrafts((prev) => prev.map((d) => (d.status === 'ocr' ? { ...d, status: 'kontrol' } : d)));
    } finally {
      setScanning(false);
    }
  };

  const refreshAccountPlan = async () => {
    if (!selected?.taxpayerId) {
      toast.info('Hesap planı için önce Luca’dan gelen mükellefli bir belge seçilmeli');
      return;
    }
    setAccountPlanRefreshing(true);
    try {
      const { data } = await api.post('/fatura-muhasebelestirme/account-plan/refresh', {
        taxpayerId: selected.taxpayerId,
      });
      toast.success(`Hesap planı Luca kuyruğuna alındı${data?.job?.id ? ` · ${data.job.id.slice(0, 8)}` : ''}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Hesap planı güncelleme başlatılamadı');
    } finally {
      setAccountPlanRefreshing(false);
    }
  };

  const refreshAccountPlanForTaxpayer = async (taxpayerId: string, name: string) => {
    setDashboardAccountPlanJob(taxpayerId);
    try {
      const { data } = await api.post('/fatura-muhasebelestirme/account-plan/refresh', {
        taxpayerId,
      });
      toast.success(`${name} hesap planı Luca kuyruğuna alındı${data?.job?.id ? ` · ${data.job.id.slice(0, 8)}` : ''}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Hesap planı güncelleme başlatılamadı');
    } finally {
      setDashboardAccountPlanJob(null);
    }
  };

  const backfillExistingEarsiv = async () => {
    setBackfillLoading(true);
    try {
      const { data } = await api.post('/fatura-muhasebelestirme/documents/backfill-earsiv', { limit: 20000 });
      toast.success(`${data.created} mevcut fatura kuyruğa aktarıldı, ${data.alreadyQueued} zaten vardı`);
      await loadDashboard();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Mevcut faturalar aktarılamadı');
    } finally {
      setBackfillLoading(false);
    }
  };

  const saveSelected = async (approve = false) => {
    if (!selected) return;
    if (!selected.backendId) {
      toast.error('Önce OCR Oku ile belgeyi kuyruğa alın');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        documentType: selected.documentType,
        invoiceKind: selected.invoiceKind === 'Satış' ? 'SATIS' : 'ALIS',
        currency: selected.currency,
        exchangeRate: selected.exchangeRate,
        belgeNo: selected.number,
        seriNo: selected.serial,
        faturaTarihi: selected.date,
        sellerVkn: selected.sellerVkn,
        buyerVkn: selected.buyerVkn,
        vendorName: selected.vendorName,
        customerName: selected.customerName,
        totalAmount: selected.total,
        status: 'READY',
        lines: selected.lines.map(({ group, accountCode, description, rate, debit, credit }) => ({
          group,
          accountCode,
          description,
          rate,
          debit,
          credit,
        })),
      };
      const { data } = await api.patch(`/fatura-muhasebelestirme/documents/${selected.backendId}`, payload);
      let doc = data;
      if (approve) {
        const res = await api.post(`/fatura-muhasebelestirme/documents/${selected.backendId}/approve`);
        doc = res.data;
      }
      setDrafts((prev) => prev.map((d) => (d.id === selected.id ? applyApiDocument(d, doc) : d)));
      setSavedAt(new Date());
      toast.success(approve ? 'Belge onaylandı' : 'Taslak kaydedildi');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Kaydetme tamamlanamadı');
    } finally {
      setSaving(false);
    }
  };

  // Klavye kısayolları
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const cmdKey = e.ctrlKey || e.metaKey;

      // Cmd/Ctrl + S → Kaydet
      if (cmdKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (selected && !saving) saveSelected(false);
        return;
      }
      // Cmd/Ctrl + Enter → Kaydet ve Onayla
      if (cmdKey && e.key === 'Enter') {
        e.preventDefault();
        if (selected && !saving) saveSelected(true);
        return;
      }
      if (isTyping) return;
      // J / sağ ok → sonraki
      if (e.key === 'j' || e.key === 'ArrowRight') {
        if (drafts[selectedIndex + 1]) setSelectedId(drafts[selectedIndex + 1].id);
        return;
      }
      // K / sol ok → önceki
      if (e.key === 'k' || e.key === 'ArrowLeft') {
        if (drafts[selectedIndex - 1]) setSelectedId(drafts[selectedIndex - 1].id);
        return;
      }
      // Delete / Backspace → sil (showDashboard değilken)
      if ((e.key === 'Delete' || e.key === 'Backspace') && !showDashboard && selected) {
        e.preventDefault();
        removeSelected();
        return;
      }
      // ? → kısayol yardımı
      if (e.key === '?') {
        setShowShortcuts((s) => !s);
      }
      // Esc → autocomplete kapat
      if (e.key === 'Escape') {
        if (accountPicker) setAccountPicker(null);
        else if (showShortcuts) setShowShortcuts(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [drafts, selectedIndex, selected, saving, showDashboard, accountPicker, showShortcuts]);

  // Global drag & drop — tüm sayfada dosya bırakılabilir
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        setGlobalDragging(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setGlobalDragging(false);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setGlobalDragging(false);
      if (e.dataTransfer?.files?.length) {
        addFiles(e.dataTransfer.files);
      }
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [addFiles]);

  // Yüklenen taslakta hangi katlanır bölümlerde satır varsa onları aç
  useEffect(() => {
    if (!selected) return;
    const hasIskonto = selected.lines.some((l) => l.group === 'iskonto');
    const hasStopaj = selected.lines.some((l) => l.group === 'stopaj');
    const hasTevkifat = selected.lines.some((l) => l.group === 'tevkifat');
    setOpenSections({
      iskonto: hasIskonto,
      stopaj: hasStopaj,
      tevkifat: hasTevkifat,
    });
  }, [selected?.id]);

  // Kur değiştiğinde — TL haricinde, toplam TL eşdeğeri toast olarak göster (yardımcı)
  useEffect(() => {
    if (!selected) return;
    if (selected.currency === 'TL' || selected.currency === 'TRY') return;
    const rate = parseAmount(selected.exchangeRate);
    if (rate <= 0) return;
    // sessiz; UI'da ayrıca gösteriyoruz
  }, [selected?.currency, selected?.exchangeRate, selected?.total]);

  const tlEquivalent = useMemo(() => {
    if (!selected) return null;
    if (selected.currency === 'TL' || selected.currency === 'TRY') return null;
    const rate = parseAmount(selected.exchangeRate);
    const tot = parseAmount(selected.total);
    if (rate <= 0 || tot <= 0) return null;
    return tot * rate;
  }, [selected?.currency, selected?.exchangeRate, selected?.total]);

  const filteredAccountOptions = useMemo(() => {
    if (!accountPicker) return [] as AccountOption[];
    const q = accountPicker.query.trim().toLocaleLowerCase('tr-TR');
    if (!q) return accountOptions.slice(0, 100);
    return accountOptions
      .filter((a) => a.code.toLowerCase().includes(q) || a.name.toLocaleLowerCase('tr-TR').includes(q))
      .slice(0, 100);
  }, [accountOptions, accountPicker]);

  const openAccountPicker = (lineId: string) => {
    setAccountPicker({ lineId, query: '' });
  };

  const pickAccount = (account: AccountOption) => {
    if (!accountPicker) return;
    updateLine(accountPicker.lineId, { accountCode: account.code, description: account.name });
    setAccountPicker(null);
  };

  // Tevkifat satırı eklemek için yardımcı — KDV rate'i ile orantılı 360 Ödenecek KDV-2 önerir
  const addTevkifatLine = () => {
    if (!selected) return;
    // KDV satırlarının toplamını al; tevkifat oranı varsayılan 5/10 → KDV'nin %50'si
    const kdvTotal = selected.lines
      .filter((l) => l.group === 'vergi')
      .reduce((s, l) => s + parseAmount(l.debit) + parseAmount(l.credit), 0);
    const suggestion = kdvTotal > 0 ? kdvTotal * 0.5 : 0;
    updateSelected({
      lines: [
        ...selected.lines,
        makeLine('tevkifat', '360.02.001', 'Ödenecek KDV-2 (Sorumlu Sıfatıyla)', '0,00', money(String(suggestion)), '5/10'),
      ],
    });
    setOpenSections((s) => ({ ...s, tevkifat: true }));
  };

  const addStopajLine = () => {
    if (!selected) return;
    updateSelected({
      lines: [
        ...selected.lines,
        makeLine('stopaj', '360.01.001', 'Ödenecek Gelir Vergisi Stopajı', '0,00', '0,00', '%20'),
      ],
    });
    setOpenSections((s) => ({ ...s, stopaj: true }));
  };

  const addIskontoLine = () => {
    if (!selected) return;
    const isAlis = selected.invoiceKind === 'Alış';
    updateSelected({
      lines: [
        ...selected.lines,
        makeLine('iskonto', isAlis ? '153.99' : '611.01', isAlis ? 'Alınan İskonto' : 'Satış İskontosu', '0,00', '0,00'),
      ],
    });
    setOpenSections((s) => ({ ...s, iskonto: true }));
  };

  return (
    <main className="fm-root">
      {globalDragging ? (
        <div className="fm-global-drop">
          <div className="fm-global-drop-card">
            <Upload size={36} />
            <div className="fm-global-drop-title">Belgeyi bırak</div>
            <div className="fm-global-drop-sub">PDF, JPG, PNG ya da XML kabul edilir</div>
          </div>
        </div>
      ) : null}

      <div className="fm-frame">
        <header className="fm-header">
          <div className="fm-title-block">
            <div className="fm-title-icon"><Receipt size={20} /></div>
            <div>
              <h1 className="fm-title">Fatura Muhasebeleştirme</h1>
              <p className="fm-subtitle">Fatura, ÖKC fişi ve mobil belgeler için tek onay ekranı</p>
            </div>
          </div>
          <div className="fm-header-actions">
            {!showDashboard ? (
              <button onClick={() => { setShowDashboard(true); loadDashboard(); }} className="fm-btn ghost">
                <ArrowLeft size={15} /> Listeye Dön
              </button>
            ) : null}
            <span className="fm-pill-info">
              Onay bekleyen <b>{drafts.length - readyCount}</b>
            </span>
            {savedAt ? (
              <span className="fm-pill-saved">Kaydedildi · {savedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
            ) : null}
            <button onClick={() => setShowShortcuts(true)} className="fm-btn ghost icon-only" title="Klavye kısayolları (?)">
              <Keyboard size={15} />
            </button>
            <button onClick={() => inputRef.current?.click()} className="fm-btn ghost">
              <Upload size={15} /> Yükle
            </button>
            <button onClick={runOcr} disabled={scanning || !drafts.length} className="fm-btn primary">
              {scanning ? <Loader2 className="animate-spin" size={15} /> : <ScanLine size={15} />} OCR Oku
            </button>
            <button
              onClick={refreshAccountPlan}
              disabled={!selected?.taxpayerId || accountPlanRefreshing}
              className="fm-btn ghost"
              title="Seçili mükellefin hesap planını Luca'dan yeniden çek"
            >
              {accountPlanRefreshing ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
              Hesap Planı
            </button>
          </div>
        </header>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.xml,text/xml,application/xml"
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />

        {showDashboard ? (
          <section className="fm-dashboard">
            <div className="fm-dashboard-toolbar">
              <div className="fm-filter-group">
                <div className="fm-search">
                  <Search size={15} />
                  <input
                    value={dashboardSearch}
                    onChange={(e) => setDashboardSearch(e.target.value)}
                    placeholder="Mükellef ara"
                  />
                  {dashboardSearch ? (
                    <button onClick={() => setDashboardSearch('')} className="fm-search-clear"><X size={13} /></button>
                  ) : null}
                </div>
                <div className="fm-chip-group">
                  <span className="fm-chip-label"><Filter size={12} /> Defter</span>
                  {(['all', 'bilanco', 'isletme'] as const).map((v) => (
                    <button key={v} onClick={() => setLedgerFilter(v)} className={ledgerFilter === v ? 'fm-chip active' : 'fm-chip'}>
                      {v === 'all' ? 'Tümü' : v === 'bilanco' ? 'Bilanço' : 'İşletme'}
                    </button>
                  ))}
                </div>
                <div className="fm-chip-group">
                  <span className="fm-chip-label">Durum</span>
                  {(['all', 'pending', 'clear'] as const).map((v) => (
                    <button key={v} onClick={() => setPendingFilter(v)} className={pendingFilter === v ? 'fm-chip active' : 'fm-chip'}>
                      {v === 'all' ? 'Tümü' : v === 'pending' ? 'Bekleyen var' : 'Temiz'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fm-toolbar-right">
                <button onClick={loadDashboard} className="fm-btn ghost icon-only" title="Yenile">
                  {dashboardLoading ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
                </button>
                <button
                  onClick={backfillExistingEarsiv}
                  disabled={backfillLoading}
                  className="fm-btn primary"
                  title="E-Fatura / E-Arşiv sorgulama alanındaki mevcut faturaları muhasebeleştirme kuyruğuna aktar"
                >
                  {backfillLoading ? <Loader2 className="animate-spin" size={15} /> : <FileText size={15} />}
                  Mevcut Faturaları Aktar
                </button>
              </div>
            </div>

            <div className="fm-stat-strip">
              <div className="fm-stat"><span>Mükellef</span><b>{dashboardTotals.tp}</b></div>
              <div className="fm-stat"><span>Bekleyen Alış</span><b>{dashboardTotals.pendingPurchase}</b></div>
              <div className="fm-stat"><span>Bekleyen Satış</span><b>{dashboardTotals.pendingSale}</b></div>
              <div className="fm-stat"><span>Bekleyen Banka</span><b>{dashboardTotals.pendingBank}</b></div>
            </div>

            <div className="fm-table-wrap">
              <table className="fm-table">
                <thead>
                  <tr>
                    <th style={{ width: '32%' }}>Firma</th>
                    <th>Defter</th>
                    <th>Bekleyen Alış</th>
                    <th>Bekleyen Satış</th>
                    <th>Bekleyen Banka</th>
                    <th>Onaylanan</th>
                    <th>Onaylanan Banka</th>
                    <th style={{ textAlign: 'center' }}>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardFiltered.map((row) => {
                    const isBus = isBusinessLedger(row.ledgerType);
                    const total = (row.pendingPurchase || 0) + (row.pendingSale || 0) + (row.pendingBank || 0);
                    return (
                      <tr key={row.taxpayerId}>
                        <td>
                          <div className="fm-firm">
                            <span className="fm-firm-name">{row.name}</span>
                            {total > 0 ? <span className="fm-firm-dot" title={`${total} bekleyen`}></span> : null}
                          </div>
                        </td>
                        <td>
                          <span className={isBus ? 'fm-ledger-tag isletme' : 'fm-ledger-tag bilanco'}>
                            {row.ledgerType || (isBus ? 'İşletme' : 'Bilanço')}
                          </span>
                        </td>
                        <td><CountButton value={row.pendingPurchase} onClick={() => openTaxpayerQueue(row, 'ALIS')} /></td>
                        <td><CountButton value={row.pendingSale} onClick={() => openTaxpayerQueue(row, 'SATIS')} /></td>
                        <td className="num">{row.pendingBank}</td>
                        <td className="num">{row.approvedInvoice}</td>
                        <td className="num">{row.approvedBank}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => refreshAccountPlanForTaxpayer(row.taxpayerId, row.name)}
                            disabled={dashboardAccountPlanJob === row.taxpayerId}
                            className="fm-row-action"
                            title="Hesap planını Luca'dan güncelle"
                          >
                            {dashboardAccountPlanJob === row.taxpayerId ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                          </button>
                          <button onClick={() => openTaxpayerQueue(row)} className="fm-row-action primary" title="Fatura işleme">
                            <Pencil size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!dashboardFiltered.length ? (
                    <tr>
                      <td colSpan={8} className="fm-empty-row">
                        {dashboardLoading ? 'Gelen evrak özeti yükleniyor' : 'Filtreye uygun mükellef bulunamadı'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="fm-workbench">
            <div className="fm-doc-area">
              <div className="fm-doc-toolbar">
                <div className="fm-toolbar-cluster">
                  <button className="fm-tool" onClick={() => setManualZoom(Math.max(0.45, zoom - 0.1))} title="Uzaklaştır">
                    <ZoomOut size={15} />
                  </button>
                  <button
                    className={zoomMode === 'fit' ? 'fm-tool-pill active' : 'fm-tool-pill'}
                    onClick={fitDocument}
                    title="Ekrana sığdır"
                  >
                    <Maximize2 size={13} /> Sığdır
                  </button>
                  <button
                    className={zoomMode === 'fit-width' ? 'fm-tool-pill active' : 'fm-tool-pill'}
                    onClick={fitDocumentWidth}
                    title="Genişliğe sığdır"
                  >
                    Genişlik
                  </button>
                  <input
                    className="fm-zoom-slider"
                    type="range"
                    min="0.45"
                    max="1.9"
                    step="0.05"
                    value={zoom}
                    onChange={(e) => setManualZoom(Number(e.target.value))}
                  />
                  <span className="fm-zoom-pct">%{Math.round(viewerScale * 100)}</span>
                  <button className="fm-tool" onClick={() => setManualZoom(Math.min(1.9, zoom + 0.1))} title="Yakınlaştır">
                    <ZoomIn size={15} />
                  </button>
                  <button className="fm-tool" onClick={() => setRotation((r) => (r + 90) % 360)} title="Döndür">
                    <RotateCw size={15} />
                  </button>
                </div>
                <div className="fm-doc-counter">
                  <button onClick={() => drafts[selectedIndex - 1] && setSelectedId(drafts[selectedIndex - 1].id)} title="Önceki (K / ←)">
                    <ChevronLeft size={15} />
                  </button>
                  <span>{selected ? selectedIndex + 1 : 0} / {drafts.length}</span>
                  <button onClick={() => drafts[selectedIndex + 1] && setSelectedId(drafts[selectedIndex + 1].id)} title="Sonraki (J / →)">
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>

              {!selected ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
                  className={dragging ? 'fm-dropzone dragging' : 'fm-dropzone'}
                >
                  <Upload size={36} />
                  <div className="fm-dropzone-title">ÖKC fişi veya fatura belgesi yükleyin</div>
                  <div className="fm-dropzone-sub">JPG, PNG, PDF ve XML kabul edilir. Belgeler kuyrukta onaya düşer.</div>
                  <button onClick={() => inputRef.current?.click()} className="fm-btn primary mt-4">Dosya Seç</button>
                </div>
              ) : (
                <div className="fm-doc-stage" ref={documentStageRef}>
                  <div
                    className="fm-doc-scale"
                    style={{
                      transform: `scale(${viewerScale}) rotate(${rotation}deg)`,
                      transformOrigin: 'top left',
                      width: Math.ceil(DOCUMENT_BASE_WIDTH * viewerScale),
                      minHeight: Math.ceil(DOCUMENT_BASE_HEIGHT * viewerScale),
                    }}
                  >
                    {selected.previewType === 'image' ? (
                      <img src={selected.previewUrl} alt={selected.file.name} className="fm-doc-image" />
                    ) : selected.previewUrl ? (
                      <iframe src={selected.previewUrl} className="fm-doc-frame" title={selected.file.name} />
                    ) : (
                      <div className="fm-doc-empty">Bu dosya için önizleme yok.</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <aside className="fm-review">
              {/* Mihsap-style header: counter + 3 actions */}
              <div className="fm-mihsap-header">
                <div className="fm-mihsap-counter">
                  Onaylanacak Fatura Sayısı: <span>{drafts.filter((d) => d.status !== 'onaylandi').length}</span>
                </div>
                <div className="fm-mihsap-row">
                  <button onClick={removeSelected} disabled={!selected} className="fm-mh-btn delete" type="button">
                    <Trash2 size={14} /> Faturayı Sil
                  </button>
                  <button
                    onClick={refreshAccountPlan}
                    disabled={!selected?.taxpayerId || accountPlanRefreshing}
                    className="fm-mh-btn ghost"
                    type="button"
                  >
                    {accountPlanRefreshing ? <Loader2 className="animate-spin" size={14} /> : null}
                    Hesap Planları
                  </button>
                  <button className="fm-mh-btn more" type="button" onClick={() => setShowShortcuts(true)} title="Daha fazla">
                    <MoreVertical size={16} />
                  </button>
                </div>
              </div>

              {tlEquivalent !== null ? (
                <div className="fm-tl-note">
                  TL karşılığı: <b>{money(String(tlEquivalent))} TL</b>
                </div>
              ) : null}

              {selected ? (
                <>
                  <div className="fm-review-scroll">
                    {selected.duplicateOfId || selected.duplicateReason ? (
                      <div className="fm-duplicate-band">
                        <AlertTriangle size={17} className="shrink-0" />
                        <div>
                          <div className="font-bold">Mükerrer belge uyarısı</div>
                          <div className="mt-0.5 text-xs">{selected.duplicateReason || 'Bu belge daha önce işlenmiş bir kayıtla eşleşiyor. Onaylamadan önce kontrol edin.'}</div>
                        </div>
                      </div>
                    ) : null}

                    <div className="fm-plan-strip">
                      <span>{selectedBusinessLedger ? 'İşletme defteri: hesap kodu yerine kayıt türü kullanılır.' : accountPlanLoading ? 'Hesap planı yükleniyor' : accountOptions.length ? `${accountOptions.length} kod hazır` : 'Hesap planı henüz çekilmedi'}</span>
                      <span>{accountPlanSource?.createdAt ? new Date(accountPlanSource.createdAt).toLocaleString('tr-TR') : 'Luca güncellemesi bekleniyor'}</span>
                    </div>

                    <div className="fm-meta-grid">
                      <label>Para Birimi<input value={selected.currency} onChange={(e) => updateSelected({ currency: e.target.value })} /></label>
                      <label>Kur<input className="text-right" value={selected.exchangeRate} onChange={(e) => updateSelected({ exchangeRate: e.target.value })} /></label>
                      <label>Fatura Türü<select value={selected.invoiceKind} onChange={(e) => updateSelected({ invoiceKind: e.target.value as DraftInvoice['invoiceKind'] })}><option>Alış</option><option>Satış</option></select></label>
                      <label>Belge Türü<select value={selected.documentType} onChange={(e) => updateSelected({ documentType: e.target.value as DraftInvoice['documentType'] })}><option value="OKC_FIS">ÖKC Fişi</option><option value="E_FATURA">E-Fatura</option><option value="E_ARSIV">E-Arşiv</option><option value="FIS">Fiş</option><option value="DIGER">Diğer</option></select></label>
                    </div>

                    {!selectedBusinessLedger ? (
                      <label className="fm-foreign-toggle">
                        <input
                          type="checkbox"
                          checked={!!selected.foreignInvoice}
                          onChange={(e) => updateSelected({ foreignInvoice: e.target.checked })}
                        />
                        <span>Yabancı fatura</span>
                        <span className="fm-foreign-hint">{selected.foreignInvoice ? 'KDV gümrükte ödenmiş kabul edilir' : 'Yurt dışı satıcı için işaretleyin'}</span>
                      </label>
                    ) : null}

                    {!selectedBusinessLedger ? (
                      <div className="space-y-3">
                        {(['matrah', 'vergi', 'cari'] as const).map((group) => {
                          const title = group === 'matrah' ? 'Matrah' : group === 'vergi' ? 'KDV / Vergi' : 'Cari / Ödeme';
                          const groupLines = selected.lines.filter((line) => line.group === group);
                          const groupDebit = groupLines.reduce((sum, line) => sum + parseAmount(line.debit), 0);
                          const groupCredit = groupLines.reduce((sum, line) => sum + parseAmount(line.credit), 0);
                          const isVergi = group === 'vergi';
                          return (
                            <section key={group} className="fm-ledger-section">
                              <div className="fm-ledger-head">
                                <span>{title}</span>
                                <button onClick={() => updateSelected({ lines: [...selected.lines, makeLine(group, '', '', '0,00', '0,00')] })}><Plus size={13} /> Satır ekle</button>
                              </div>
                              <div className="fm-ledger-table">
                                {groupLines.map((line) => (
                                  <div key={line.id} className="fm-ledger-row">
                                    <button
                                      type="button"
                                      className="fm-account-trigger"
                                      onClick={() => openAccountPicker(line.id)}
                                      title="Hesap kodu seç"
                                    >
                                      {line.accountCode || <span className="fm-placeholder">Hesap seç</span>}
                                    </button>
                                    <input value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} placeholder="Açıklama" />
                                    {isVergi ? (
                                      <select value={line.rate || ''} onChange={(e) => updateLine(line.id, { rate: e.target.value })}>
                                        <option value="">Oran</option>
                                        <optgroup label="Normal KDV">
                                          {KDV_RATES.map((r) => <option key={r} value={r}>{r}</option>)}
                                        </optgroup>
                                        <optgroup label="Sorumlu Sıfatıyla">
                                          {KDV_RATES.map((r) => <option key={`s-${r}`} value={`${r} Sorumlu Sıf.`}>{r} Sorumlu Sıf.</option>)}
                                        </optgroup>
                                      </select>
                                    ) : (
                                      <input value={line.rate || ''} onChange={(e) => updateLine(line.id, { rate: e.target.value })} placeholder="Oran" />
                                    )}
                                    <input className="text-right" value={line.debit} onChange={(e) => updateLine(line.id, { debit: e.target.value })} placeholder="Borç" />
                                    <input className="text-right" value={line.credit} onChange={(e) => updateLine(line.id, { credit: e.target.value })} placeholder="Alacak" />
                                    <button className="fm-row-delete" onClick={() => updateSelected({ lines: selected.lines.filter((l) => l.id !== line.id) })} title="Satırı sil"><Trash2 size={14} /></button>
                                  </div>
                                ))}
                                {!groupLines.length ? <div className="fm-empty-ledger">Bu bölümde satır yok.</div> : null}
                              </div>
                              <div className="fm-section-total"><span>Toplam</span><b>B {money(String(groupDebit))}</b><b>A {money(String(groupCredit))}</b></div>
                            </section>
                          );
                        })}

                        {/* Katlanır kesinti bölümleri — İskonto / Stopaj / Tevkifat */}
                        <CollapsibleSection
                          title="İskonto"
                          open={openSections.iskonto}
                          onToggle={() => setOpenSections((s) => ({ ...s, iskonto: !s.iskonto }))}
                          onAdd={addIskontoLine}
                          lines={selected.lines.filter((l) => l.group === 'iskonto')}
                          onUpdateLine={updateLine}
                          onDeleteLine={(lineId) => updateSelected({ lines: selected.lines.filter((l) => l.id !== lineId) })}
                          onOpenAccount={openAccountPicker}
                          rateOptions={[]}
                        />
                        <CollapsibleSection
                          title="Kesintiler (Stopaj)"
                          open={openSections.stopaj}
                          onToggle={() => setOpenSections((s) => ({ ...s, stopaj: !s.stopaj }))}
                          onAdd={addStopajLine}
                          lines={selected.lines.filter((l) => l.group === 'stopaj')}
                          onUpdateLine={updateLine}
                          onDeleteLine={(lineId) => updateSelected({ lines: selected.lines.filter((l) => l.id !== lineId) })}
                          onOpenAccount={openAccountPicker}
                          rateOptions={[...STOPAJ_RATES]}
                        />
                        <CollapsibleSection
                          title="Kesintiler (Tevkifat) — 360 Ödenecek KDV-2"
                          open={openSections.tevkifat}
                          onToggle={() => setOpenSections((s) => ({ ...s, tevkifat: !s.tevkifat }))}
                          onAdd={addTevkifatLine}
                          lines={selected.lines.filter((l) => l.group === 'tevkifat')}
                          onUpdateLine={updateLine}
                          onDeleteLine={(lineId) => updateSelected({ lines: selected.lines.filter((l) => l.id !== lineId) })}
                          onOpenAccount={openAccountPicker}
                          rateOptions={[...TEVKIFAT_RATES]}
                          hint="Sorumlu sıfatıyla KDV — alıcı vergi dairesine ödeyecek"
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {selected.lines.map((line, index) => (
                          <section key={line.id} className="fm-business-card">
                            <div className="fm-business-head">
                              <span>{index + 1}</span>
                              <button onClick={() => updateSelected({ lines: selected.lines.filter((l) => l.id !== line.id) })} title="Kaydı sil"><Trash2 size={14} /></button>
                            </div>
                            <div className="fm-business-grid top">
                              <label>Kayıt Türü<select value={line.description || businessCategories[0]} onChange={(e) => updateLine(line.id, { description: e.target.value })}>{businessCategories.map((cat) => <option key={cat}>{cat}</option>)}</select></label>
                              <label>Alt Tür<select value={line.accountCode || businessSubCategories[0]} onChange={(e) => updateLine(line.id, { accountCode: e.target.value })}>{businessSubCategories.map((cat) => <option key={cat}>{cat}</option>)}</select></label>
                            </div>
                            <div className="fm-business-grid amounts">
                              <label>Matrah<input className="text-right" value={line.debit} onChange={(e) => updateLine(line.id, { debit: e.target.value })} /></label>
                              <label>KDV Oranı<select value={line.rate || '%20 Kdv'} onChange={(e) => updateLine(line.id, { rate: e.target.value })}><option>%20 Kdv</option><option>%10 Kdv</option><option>%1 Kdv</option><option>%0 Kdv</option></select></label>
                              <label>KDV Tutarı<input className="text-right" value={line.credit} onChange={(e) => updateLine(line.id, { credit: e.target.value })} /></label>
                            </div>
                            <div className="fm-business-total"><span>Toplam (KDV Dahil)</span><b>{money(String(parseAmount(line.debit) + parseAmount(line.credit)))}</b></div>
                          </section>
                        ))}
                        <button onClick={() => updateSelected({ lines: [...selected.lines, makeLine('matrah', businessSubCategories[0], businessCategories[0], '0,00', '0,00', '%20 Kdv')] })} className="fm-add-business"><Plus size={15} /> Kayıt ekle</button>
                      </div>
                    )}

                    <div className="fm-info-grid">
                      <label>Tarih<input type="date" value={selected.date} onChange={(e) => updateSelected({ date: e.target.value })} /></label>
                      <label>Belge No<input value={selected.number} onChange={(e) => updateSelected({ number: e.target.value })} /></label>
                      <label>Satıcı VKN<input value={selected.sellerVkn} onChange={(e) => updateSelected({ sellerVkn: e.target.value })} /></label>
                      <label>Toplam Tutar<input className="text-right font-bold" value={selected.total} onChange={(e) => updateSelected({ total: e.target.value })} /></label>
                      <label className="col-span-2">Satıcı Bilgisi<input value={selected.vendorName} onChange={(e) => updateSelected({ vendorName: e.target.value })} /></label>
                    </div>
                  </div>

                  <div className="fm-uploaded-strip">
                    <div className="fm-strip-head"><span>Yüklenen belgeler</span><span>{drafts.length} belge</span></div>
                    <div className="fm-strip-row">
                      {drafts.map((draft) => (
                        <button key={draft.id} onClick={() => setSelectedId(draft.id)} className={selected?.id === draft.id ? 'fm-doc-chip active' : 'fm-doc-chip'}>
                          {draft.previewType === 'image' ? <ImageIcon size={14} /> : <FileText size={14} />}
                          <span>{draft.file.name}</span>
                          {draft.status === 'hazir' || draft.status === 'onaylandi' ? <CheckCircle2 size={14} className="ok-tick" /> : null}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="fm-action-bar">
                    <button onClick={() => { setShowDashboard(true); loadDashboard(); }} className="fm-action ghost">
                      <ArrowLeft size={14} /> Listeye
                    </button>
                    <button onClick={() => drafts[selectedIndex - 1] && setSelectedId(drafts[selectedIndex - 1].id)} className="fm-action ghost" title="Önceki (K)">
                      <ChevronLeft size={14} /> Geri
                    </button>
                    <button onClick={() => drafts[selectedIndex + 1] && setSelectedId(drafts[selectedIndex + 1].id)} className="fm-action ghost" title="Sonraki (J)">
                      İleri <ChevronRight size={14} />
                    </button>
                    <button onClick={removeSelected} disabled={!selected} className="fm-action danger" title="Sil (Del)">
                      <Trash2 size={14} /> Sil
                    </button>
                    <button onClick={() => saveSelected(false)} disabled={!selected || saving} className="fm-action save" title="Kaydet (⌘S)">
                      {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Kaydet
                    </button>
                    <button onClick={() => saveSelected(true)} disabled={!selected || saving} className="fm-action approve" title="Onayla (⌘↵)">
                      <CheckCircle2 size={14} /> Onayla
                    </button>
                  </div>
                </>
              ) : (
                <div className="fm-no-selection">
                  <FileText size={34} />
                  <div className="fm-no-selection-title">{loadingExisting ? 'Kayıtlar yükleniyor' : 'Henüz belge seçilmedi'}</div>
                  <p>Sol alana ÖKC fişi veya fatura görseli sürükleyin.</p>
                </div>
              )}
            </aside>
          </section>
        )}
      </div>

      {/* Hesap kodu seçici popup */}
      {accountPicker ? (
        <div className="fm-modal-bg" onClick={() => setAccountPicker(null)}>
          <div className="fm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fm-modal-head">
              <Search size={15} />
              <input
                autoFocus
                value={accountPicker.query}
                onChange={(e) => setAccountPicker({ ...accountPicker, query: e.target.value })}
                placeholder="Hesap kodu veya adı"
              />
              <button onClick={() => setAccountPicker(null)} className="fm-modal-close"><X size={16} /></button>
            </div>
            <div className="fm-modal-body">
              {accountPlanLoading ? (
                <div className="fm-modal-empty">Hesap planı yükleniyor...</div>
              ) : !filteredAccountOptions.length ? (
                <div className="fm-modal-empty">{accountOptions.length ? 'Eşleşme yok' : 'Hesap planı çekilmemiş'}</div>
              ) : (
                filteredAccountOptions.map((a) => (
                  <button key={a.id} onClick={() => pickAccount(a)} className="fm-modal-row">
                    <b className="fm-modal-code">{a.code}</b>
                    <span className="fm-modal-name">{a.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Klavye kısayolları */}
      {showShortcuts ? (
        <div className="fm-modal-bg" onClick={() => setShowShortcuts(false)}>
          <div className="fm-modal narrow" onClick={(e) => e.stopPropagation()}>
            <div className="fm-modal-head">
              <Keyboard size={15} />
              <span className="fm-modal-title">Klavye kısayolları</span>
              <button onClick={() => setShowShortcuts(false)} className="fm-modal-close"><X size={16} /></button>
            </div>
            <div className="fm-shortcut-list">
              <div className="fm-shortcut"><kbd>J</kbd> <span className="sep">/</span> <kbd>→</kbd><span>Sonraki belge</span></div>
              <div className="fm-shortcut"><kbd>K</kbd> <span className="sep">/</span> <kbd>←</kbd><span>Önceki belge</span></div>
              <div className="fm-shortcut"><kbd>Del</kbd><span>Seçili belgeyi sil</span></div>
              <div className="fm-shortcut"><kbd>⌘</kbd>+<kbd>S</kbd><span>Taslak kaydet</span></div>
              <div className="fm-shortcut"><kbd>⌘</kbd>+<kbd>↵</kbd><span>Kaydet ve Onayla</span></div>
              <div className="fm-shortcut"><kbd>?</kbd><span>Bu pencereyi aç/kapat</span></div>
              <div className="fm-shortcut"><kbd>Esc</kbd><span>Açık pencereyi kapat</span></div>
            </div>
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        :root {
          --fm-bg: #f3f6fa;
          --fm-surface: #ffffff;
          --fm-surface-2: #eaf2ff;
          --fm-border: #d5e0ee;
          --fm-border-strong: #b6c5d8;
          --fm-text: #1c2430;
          --fm-text-soft: #44556a;
          --fm-text-muted: #7a8a9e;
          --fm-blue: #1664c8;
          --fm-blue-deep: #0d4d99;
          --fm-blue-soft: #84b5e8;
          --fm-blue-bg: #e6f0fc;
          --fm-blue-pale: #eef6ff;
          --fm-green: #2ecc71;
          --fm-green-deep: #21a256;
          --fm-green-bg: #e3f7eb;
          --fm-green-soft: #b9e6c9;
          --fm-red: #e74c3c;
          --fm-red-deep: #c0392b;
          --fm-red-soft: #f5b7b1;
          --fm-red-bg: #fdecea;
          --fm-yellow: #f4d83a;
          --fm-yellow-deep: #d4ac0d;
          --fm-yellow-bg: #fff8d6;
          --fm-amber: #f39c12;
          --fm-amber-bg: #fdf3e0;
          --fm-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06);
          --fm-shadow-md: 0 4px 10px rgba(15, 23, 42, 0.08);
          --fm-shadow-lg: 0 10px 30px rgba(15, 23, 42, 0.14);
          --fm-radius: 8px;
          --fm-radius-sm: 6px;
        }
        .fm-root {
          min-height: 0;
          background: var(--fm-bg);
          color: var(--fm-text);
          font-feature-settings: 'tnum' 1;
        }
        .fm-frame {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 76px);
          min-height: 620px;
          overflow: hidden;
        }
        /* === HEADER === */
        .fm-header {
          flex-shrink: 0;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 20px;
          background: var(--fm-surface);
          border-bottom: 1px solid var(--fm-border);
        }
        .fm-title-block { display: flex; align-items: center; gap: 12px; }
        .fm-title-icon {
          width: 38px; height: 38px;
          border-radius: var(--fm-radius);
          background: linear-gradient(135deg, var(--fm-blue), var(--fm-blue-deep));
          color: #fff;
          display: flex; align-items: center; justify-content: center;
          box-shadow: var(--fm-shadow-sm);
        }
        .fm-title { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; color: var(--fm-text); margin: 0; }
        .fm-subtitle { font-size: 11.5px; color: var(--fm-text-muted); margin: 1px 0 0; }
        .fm-header-actions { display: flex; align-items: center; gap: 7px; }
        .fm-pill-info {
          height: 32px; display: inline-flex; align-items: center; gap: 6px;
          padding: 0 12px; border-radius: 999px;
          border: 1px solid var(--fm-border); background: var(--fm-surface);
          color: var(--fm-text-soft); font-size: 12px;
        }
        .fm-pill-info b { color: var(--fm-red); font-weight: 700; }
        .fm-pill-saved {
          height: 32px; display: inline-flex; align-items: center; gap: 4px;
          padding: 0 11px; border-radius: 999px;
          background: var(--fm-green-bg); color: var(--fm-green);
          font-size: 11.5px; font-weight: 600;
        }

        /* === BUTTONS === */
        .fm-btn {
          display: inline-flex; align-items: center; gap: 6px;
          height: 34px; padding: 0 12px;
          border-radius: var(--fm-radius-sm);
          font-size: 12.5px; font-weight: 600;
          border: 1px solid transparent;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .fm-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .fm-btn.primary {
          background: var(--fm-blue);
          border-color: var(--fm-blue-deep);
          color: #fff;
        }
        .fm-btn.primary:hover:not(:disabled) { background: var(--fm-blue-deep); }
        .fm-btn.ghost {
          background: var(--fm-surface);
          border-color: var(--fm-border);
          color: var(--fm-text-soft);
        }
        .fm-btn.ghost:hover:not(:disabled) {
          background: var(--fm-blue-bg);
          border-color: var(--fm-blue-soft);
          color: var(--fm-blue-deep);
        }
        .fm-btn.icon-only { padding: 0; width: 34px; justify-content: center; }
        .mt-4 { margin-top: 16px; }

        /* === DASHBOARD === */
        .fm-dashboard {
          flex: 1; min-height: 0;
          display: flex; flex-direction: column;
          padding: 16px 18px;
          overflow: hidden;
          background: var(--fm-bg);
        }
        .fm-dashboard-toolbar {
          display: flex; justify-content: space-between; align-items: center;
          gap: 12px; margin-bottom: 12px; flex-wrap: wrap;
        }
        .fm-filter-group {
          display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
        }
        .fm-search {
          position: relative;
          display: inline-flex; align-items: center;
          height: 36px; padding: 0 10px 0 32px;
          width: 260px;
          border: 1px solid var(--fm-border);
          border-radius: var(--fm-radius-sm);
          background: var(--fm-surface);
        }
        .fm-search:focus-within { border-color: var(--fm-blue-soft); }
        .fm-search > svg { position: absolute; left: 10px; color: var(--fm-text-muted); }
        .fm-search input {
          flex: 1; height: 100%; min-width: 0;
          border: 0; background: transparent; outline: none;
          font-size: 13px; color: var(--fm-text);
        }
        .fm-search-clear {
          width: 22px; height: 22px;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 50%; background: var(--fm-surface-2);
          color: var(--fm-text-muted); border: 0; cursor: pointer;
        }
        .fm-chip-group { display: inline-flex; align-items: center; gap: 4px; }
        .fm-chip-label {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 11px; font-weight: 600;
          color: var(--fm-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-right: 4px;
        }
        .fm-chip {
          height: 28px; padding: 0 11px;
          border-radius: 999px;
          border: 1px solid var(--fm-border);
          background: var(--fm-surface);
          color: var(--fm-text-soft);
          font-size: 11.5px; font-weight: 600;
          cursor: pointer;
        }
        .fm-chip:hover { background: var(--fm-blue-bg); border-color: var(--fm-blue-soft); }
        .fm-chip.active {
          background: var(--fm-blue-bg);
          border-color: var(--fm-blue);
          color: var(--fm-blue-deep);
        }
        .fm-toolbar-right { display: flex; align-items: center; gap: 7px; }

        .fm-stat-strip {
          display: grid; grid-template-columns: repeat(4, 1fr);
          gap: 10px; margin-bottom: 14px;
        }
        .fm-stat {
          background: var(--fm-surface);
          border: 1px solid var(--fm-border);
          border-radius: var(--fm-radius);
          padding: 10px 14px;
        }
        .fm-stat span {
          display: block;
          font-size: 11px; font-weight: 600;
          color: var(--fm-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-bottom: 4px;
        }
        .fm-stat b {
          font-size: 22px; font-weight: 700;
          color: var(--fm-text);
        }

        .fm-table-wrap {
          flex: 1; min-height: 0;
          background: var(--fm-surface);
          border: 1px solid var(--fm-border);
          border-radius: var(--fm-radius);
          overflow: auto;
        }
        .fm-table {
          width: 100%; border-collapse: collapse;
          font-size: 13px;
        }
        .fm-table thead { position: sticky; top: 0; z-index: 5; background: var(--fm-surface-2); }
        .fm-table th {
          text-align: left;
          padding: 11px 14px;
          font-weight: 700;
          font-size: 11.5px;
          letter-spacing: 0.03em;
          color: var(--fm-text-soft);
          border-bottom: 1px solid var(--fm-border);
          text-transform: uppercase;
        }
        .fm-table tbody tr { transition: background 0.1s; }
        .fm-table tbody tr:hover { background: var(--fm-blue-bg); }
        .fm-table td {
          padding: 10px 14px;
          border-bottom: 1px solid var(--fm-border);
          vertical-align: middle;
        }
        .fm-table td.num { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--fm-text-soft); }
        .fm-firm { display: flex; align-items: center; gap: 8px; }
        .fm-firm-name { font-weight: 600; color: var(--fm-text); }
        .fm-firm-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--fm-amber);
          box-shadow: 0 0 0 3px var(--fm-amber-bg);
        }
        .fm-ledger-tag {
          display: inline-flex; align-items: center;
          height: 22px; padding: 0 9px;
          border-radius: 4px;
          font-size: 11px; font-weight: 600;
        }
        .fm-ledger-tag.bilanco { background: var(--fm-blue-bg); color: var(--fm-blue); }
        .fm-ledger-tag.isletme { background: var(--fm-blue-bg); color: var(--fm-blue-deep); }
        .fm-row-action {
          display: inline-flex; align-items: center; justify-content: center;
          width: 28px; height: 28px;
          border-radius: 6px;
          border: 1px solid var(--fm-border);
          background: var(--fm-surface);
          color: var(--fm-text-soft);
          cursor: pointer;
          margin-left: 4px;
        }
        .fm-row-action:hover:not(:disabled) {
          background: var(--fm-blue-bg);
          border-color: var(--fm-blue-soft);
          color: var(--fm-blue-deep);
        }
        .fm-row-action.primary {
          background: var(--fm-blue);
          border-color: var(--fm-blue-deep);
          color: #fff;
        }
        .fm-row-action.primary:hover { background: var(--fm-blue-deep); }
        .fm-row-action:disabled { opacity: 0.45; cursor: not-allowed; }
        .fm-count-btn {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 30px; height: 26px; padding: 0 8px;
          border-radius: 6px;
          background: var(--fm-surface-2);
          color: var(--fm-text-soft);
          font-weight: 700; font-variant-numeric: tabular-nums;
          border: 1px solid var(--fm-border);
          cursor: pointer;
        }
        .fm-count-btn.has-pending {
          background: var(--fm-blue-bg);
          border-color: var(--fm-blue-soft);
          color: var(--fm-blue-deep);
        }
        .fm-count-btn:hover { border-color: var(--fm-blue); }
        .fm-empty-row {
          padding: 60px 20px !important;
          text-align: center;
          color: var(--fm-text-muted);
          font-size: 13px;
        }

        /* === WORKBENCH === */
        .fm-workbench {
          flex: 1; min-height: 0;
          display: grid;
          grid-template-columns: minmax(720px, 1fr) minmax(420px, 520px);
          overflow: hidden;
          background: var(--fm-bg);
        }
        .fm-doc-area {
          min-width: 0; min-height: 0;
          display: flex; flex-direction: column;
          background: var(--fm-surface-2);
          border-right: 1px solid var(--fm-border);
        }
        .fm-doc-toolbar {
          flex-shrink: 0;
          height: 48px;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 14px;
          background: var(--fm-surface);
          border-bottom: 1px solid var(--fm-border);
        }
        .fm-toolbar-cluster { display: flex; align-items: center; gap: 6px; }
        .fm-tool {
          display: inline-flex; align-items: center; justify-content: center;
          width: 30px; height: 30px;
          border-radius: 6px;
          border: 1px solid var(--fm-border);
          background: var(--fm-surface);
          color: var(--fm-text-soft);
          cursor: pointer;
        }
        .fm-tool:hover { background: var(--fm-blue-bg); border-color: var(--fm-blue-soft); color: var(--fm-blue-deep); }
        .fm-tool-pill {
          display: inline-flex; align-items: center; gap: 5px;
          height: 30px; padding: 0 11px;
          border-radius: 6px;
          border: 1px solid var(--fm-border);
          background: var(--fm-surface);
          color: var(--fm-text-soft);
          font-size: 11.5px; font-weight: 600;
          cursor: pointer;
        }
        .fm-tool-pill.active {
          background: var(--fm-blue-bg);
          border-color: var(--fm-blue);
          color: var(--fm-blue-deep);
        }
        .fm-zoom-slider { width: 160px; accent-color: var(--fm-blue); }
        .fm-zoom-pct {
          min-width: 44px; text-align: right;
          font-size: 11.5px; font-weight: 700;
          color: var(--fm-text-soft);
          font-variant-numeric: tabular-nums;
        }
        .fm-doc-counter { display: inline-flex; align-items: center; gap: 6px; color: var(--fm-text-soft); font-weight: 700; font-size: 12px; }
        .fm-doc-counter button {
          display: inline-flex; align-items: center; justify-content: center;
          width: 30px; height: 30px;
          border-radius: 6px;
          border: 1px solid var(--fm-border);
          background: var(--fm-surface);
          color: var(--fm-text-soft);
          cursor: pointer;
        }
        .fm-doc-counter button:hover { background: var(--fm-blue-bg); }

        .fm-doc-stage {
          flex: 1; min-height: 0;
          overflow: auto;
          padding: 16px;
          background: var(--fm-surface-2);
        }
        .fm-doc-scale { margin: 0 auto; transition: transform 0.14s ease; }
        .fm-doc-image, .fm-doc-frame {
          display: block; margin: 0 auto;
          width: 980px; max-width: none;
          background: #fff;
          border: 1px solid var(--fm-border);
          box-shadow: var(--fm-shadow-md);
        }
        .fm-doc-frame { height: 1380px; }
        .fm-doc-empty {
          width: 980px; min-height: 520px;
          display: flex; align-items: center; justify-content: center;
          background: #fff; border: 1px solid var(--fm-border);
          color: var(--fm-text-muted);
          padding: 40px;
        }
        .fm-dropzone {
          margin: 28px; flex: 1;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          border: 2px dashed var(--fm-border-strong);
          border-radius: 12px;
          background: var(--fm-surface);
          color: var(--fm-blue);
        }
        .fm-dropzone.dragging { border-color: var(--fm-blue); background: var(--fm-blue-bg); }
        .fm-dropzone-title { font-size: 15px; font-weight: 700; color: var(--fm-text); margin-top: 12px; }
        .fm-dropzone-sub { margin-top: 4px; font-size: 12.5px; color: var(--fm-text-muted); }

        /* === REVIEW PANEL === */
        .fm-review {
          min-width: 0; min-height: 0;
          display: flex; flex-direction: column;
          background: var(--fm-surface);
        }
        .fm-review-header {
          flex-shrink: 0;
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid var(--fm-border);
          background: var(--fm-surface);
        }
        .fm-review-eyebrow {
          font-size: 10.5px; font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--fm-text-muted);
          text-transform: uppercase;
        }
        .fm-review-title { font-size: 14px; font-weight: 700; color: var(--fm-text); margin-top: 2px; }
        .fm-balance-pill {
          display: inline-flex; align-items: center; gap: 5px;
          height: 28px; padding: 0 12px;
          border-radius: 999px;
          font-size: 11.5px; font-weight: 700;
        }
        .fm-balance-pill.ok { background: var(--fm-green-bg); color: var(--fm-green); }
        .fm-balance-pill.warn { background: var(--fm-amber-bg); color: var(--fm-amber); }

        /* Canlı denge çubuğu */
        .fm-balance-bar {
          flex-shrink: 0;
          display: flex; gap: 18px;
          padding: 10px 16px;
          background: var(--fm-surface-2);
          border-bottom: 1px solid var(--fm-border);
        }
        .fm-balance-row {
          display: flex; flex-direction: column; gap: 1px;
        }
        .fm-balance-row span {
          font-size: 10.5px; font-weight: 600;
          color: var(--fm-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .fm-balance-row b {
          font-size: 14px; font-weight: 700;
          color: var(--fm-text);
          font-variant-numeric: tabular-nums;
        }
        .fm-balance-row.tl b { color: var(--fm-blue-deep); }

        .fm-review-scroll {
          flex: 1; min-height: 0;
          overflow: auto;
          padding: 12px 14px;
        }
        .fm-duplicate-band {
          display: flex; gap: 10px;
          padding: 10px 12px;
          border: 1px solid #f1c2bc;
          border-radius: 6px;
          background: var(--fm-red-bg);
          color: var(--fm-red);
          margin-bottom: 10px;
        }
        .fm-plan-strip {
          display: flex; justify-content: space-between; gap: 10px;
          padding: 8px 10px;
          background: var(--fm-blue-bg);
          border: 1px solid var(--fm-blue-soft);
          border-radius: 5px;
          color: var(--fm-blue-deep);
          font-size: 11px; font-weight: 600;
          margin-bottom: 10px;
        }
        .fm-meta-grid {
          display: grid; grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          padding: 10px;
          margin-bottom: 10px;
          background: var(--fm-surface-2);
          border: 1px solid var(--fm-border);
          border-radius: 6px;
        }
        .fm-meta-grid label,
        .fm-info-grid label,
        .fm-business-grid label {
          display: block;
          font-size: 10.5px; font-weight: 700;
          color: var(--fm-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .fm-meta-grid input,
        .fm-meta-grid select,
        .fm-info-grid input,
        .fm-business-grid input,
        .fm-business-grid select,
        .fm-ledger-row input {
          margin-top: 3px;
          height: 30px;
          width: 100%;
          min-width: 0;
          padding: 0 9px;
          border: 1px solid var(--fm-border);
          border-radius: 5px;
          background: var(--fm-surface);
          color: var(--fm-text);
          font-size: 12.5px;
          outline: none;
        }
        .fm-meta-grid input:focus,
        .fm-meta-grid select:focus,
        .fm-info-grid input:focus,
        .fm-business-grid input:focus,
        .fm-business-grid select:focus,
        .fm-ledger-row input:focus {
          border-color: var(--fm-blue);
          box-shadow: 0 0 0 3px var(--fm-blue-bg);
        }

        .fm-ledger-section {
          background: var(--fm-surface);
          border: 1px solid var(--fm-border);
          border-radius: 6px;
          overflow: hidden;
          margin-bottom: 10px;
        }
        .fm-ledger-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 12px;
          background: var(--fm-surface-2);
          border-bottom: 1px solid var(--fm-border);
          font-size: 12px; font-weight: 700;
          color: var(--fm-text);
        }
        .fm-ledger-head button {
          display: inline-flex; align-items: center; gap: 4px;
          height: 26px; padding: 0 10px;
          border-radius: 5px;
          border: 1px solid var(--fm-border);
          background: var(--fm-surface);
          color: var(--fm-text-soft);
          font-size: 11.5px; font-weight: 600;
          cursor: pointer;
        }
        .fm-ledger-head button:hover { background: var(--fm-blue-bg); color: var(--fm-blue-deep); border-color: var(--fm-blue-soft); }
        .fm-ledger-table { padding: 4px 4px; }
        .fm-ledger-row {
          display: grid;
          grid-template-columns: 110px minmax(0, 1fr) 56px 88px 88px 28px;
          gap: 6px;
          align-items: center;
          padding: 4px 8px;
          border-radius: 4px;
        }
        .fm-ledger-row:hover { background: var(--fm-surface-2); }
        .fm-ledger-row input { height: 28px; font-size: 11.5px; margin-top: 0; }
        .fm-account-trigger {
          height: 28px; padding: 0 9px;
          text-align: left;
          background: var(--fm-surface);
          border: 1px solid var(--fm-border);
          border-radius: 5px;
          color: var(--fm-text);
          font-size: 11.5px; font-weight: 600;
          cursor: pointer;
          font-variant-numeric: tabular-nums;
        }
        .fm-account-trigger:hover { border-color: var(--fm-blue); background: var(--fm-blue-bg); }
        .fm-placeholder { color: var(--fm-text-muted); font-weight: 400; }
        .fm-row-delete {
          display: inline-flex; align-items: center; justify-content: center;
          width: 28px; height: 28px;
          border-radius: 5px;
          background: transparent;
          color: var(--fm-red);
          border: 0;
          cursor: pointer;
        }
        .fm-row-delete:hover { background: var(--fm-red-bg); }
        .fm-empty-ledger { padding: 14px; text-align: center; color: var(--fm-text-muted); font-size: 12px; }
        .fm-section-total {
          display: flex; justify-content: flex-end; gap: 14px;
          padding: 6px 10px;
          background: var(--fm-surface-2);
          color: var(--fm-text-soft);
          font-size: 11.5px;
          border-top: 1px solid var(--fm-border);
        }
        .fm-section-total b { color: var(--fm-text); font-weight: 700; font-variant-numeric: tabular-nums; }

        .fm-business-card {
          background: var(--fm-surface);
          border: 1px solid var(--fm-blue-soft);
          border-radius: 6px;
          overflow: hidden;
          margin-bottom: 10px;
        }
        .fm-business-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 12px;
          background: var(--fm-blue-bg);
          border-bottom: 1px solid var(--fm-blue-soft);
        }
        .fm-business-head span {
          display: inline-flex; align-items: center; justify-content: center;
          width: 24px; height: 24px;
          border-radius: 6px;
          background: var(--fm-blue);
          color: #fff;
          font-weight: 700;
          font-size: 12px;
        }
        .fm-business-head button {
          display: inline-flex; align-items: center; justify-content: center;
          width: 26px; height: 26px;
          border-radius: 5px;
          background: transparent;
          color: var(--fm-red);
          border: 0;
          cursor: pointer;
        }
        .fm-business-head button:hover { background: var(--fm-red-bg); }
        .fm-business-grid { display: grid; gap: 10px; padding: 10px 12px; }
        .fm-business-grid.top { grid-template-columns: 1fr 1fr; }
        .fm-business-grid.amounts { grid-template-columns: 1fr 1fr 1fr; padding-top: 0; }
        .fm-business-total {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 14px;
          background: var(--fm-surface-2);
          border-top: 1px solid var(--fm-border);
          color: var(--fm-text);
          font-size: 12.5px; font-weight: 700;
        }
        .fm-business-total b { font-variant-numeric: tabular-nums; }
        .fm-add-business {
          display: inline-flex; align-items: center; gap: 6px;
          height: 34px; padding: 0 14px;
          border-radius: 6px;
          border: 1px dashed var(--fm-blue-soft);
          background: transparent;
          color: var(--fm-blue-deep);
          font-size: 12px; font-weight: 600;
          cursor: pointer;
        }
        .fm-add-business:hover { background: var(--fm-blue-bg); }

        .fm-info-grid {
          display: grid; grid-template-columns: repeat(2, 1fr);
          gap: 8px; margin-top: 10px;
        }
        .col-span-2 { grid-column: span 2; }

        .fm-uploaded-strip {
          flex-shrink: 0;
          padding: 9px 14px;
          background: var(--fm-surface-2);
          border-top: 1px solid var(--fm-border);
        }
        .fm-strip-head {
          display: flex; justify-content: space-between;
          margin-bottom: 6px;
          font-size: 10.5px; font-weight: 700;
          color: var(--fm-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .fm-strip-row {
          display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px;
        }
        .fm-doc-chip {
          display: inline-flex; align-items: center; gap: 6px;
          min-width: 180px;
          height: 32px;
          padding: 0 10px;
          border-radius: 6px;
          background: var(--fm-surface);
          border: 1px solid var(--fm-border);
          color: var(--fm-text-soft);
          font-size: 12px;
          cursor: pointer;
        }
        .fm-doc-chip span {
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .fm-doc-chip:hover { border-color: var(--fm-blue-soft); }
        .fm-doc-chip.active {
          border-color: var(--fm-blue);
          background: var(--fm-blue-bg);
          color: var(--fm-blue-deep);
          font-weight: 600;
        }
        .ok-tick { color: var(--fm-green); }

        .fm-action-bar {
          flex-shrink: 0;
          display: grid; grid-template-columns: 1fr 1fr 1fr 1fr 1.2fr 1.4fr;
          gap: 6px;
          padding: 10px 12px;
          background: var(--fm-surface);
          border-top: 1px solid var(--fm-border);
        }
        .fm-action {
          display: inline-flex; align-items: center; justify-content: center; gap: 5px;
          height: 36px;
          border-radius: 6px;
          font-size: 12px; font-weight: 700;
          border: 1px solid transparent;
          cursor: pointer;
          transition: all 0.15s;
        }
        .fm-action.ghost {
          background: var(--fm-surface);
          border-color: var(--fm-border);
          color: var(--fm-text-soft);
        }
        .fm-action.ghost:hover:not(:disabled) { background: var(--fm-surface-2); }
        .fm-action.danger {
          background: var(--fm-surface);
          border-color: #f0c4be;
          color: var(--fm-red);
        }
        .fm-action.danger:hover:not(:disabled) { background: var(--fm-red-bg); }
        .fm-action.save {
          background: var(--fm-blue);
          border-color: var(--fm-blue-deep);
          color: #fff;
        }
        .fm-action.save:hover:not(:disabled) { background: var(--fm-blue-deep); }
        .fm-action.approve {
          background: var(--fm-green);
          border-color: #066d3e;
          color: #fff;
        }
        .fm-action.approve:hover:not(:disabled) { background: #066d3e; }
        .fm-action:disabled { opacity: 0.45; cursor: not-allowed; }

        .fm-no-selection {
          flex: 1;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          color: var(--fm-text-muted);
          padding: 30px;
          text-align: center;
        }
        .fm-no-selection-title {
          margin-top: 12px;
          font-size: 14px; font-weight: 600;
          color: var(--fm-text-soft);
        }
        .fm-no-selection p { margin-top: 4px; font-size: 12.5px; }

        .fm-global-drop {
          position: fixed; inset: 0;
          z-index: 100;
          background: rgba(28, 24, 18, 0.55);
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(4px);
          pointer-events: none;
        }
        .fm-global-drop-card {
          background: var(--fm-surface);
          border: 2px dashed var(--fm-blue);
          border-radius: 16px;
          padding: 36px 56px;
          box-shadow: var(--fm-shadow-lg);
          color: var(--fm-blue-deep);
          display: flex; flex-direction: column; align-items: center; gap: 6px;
        }
        .fm-global-drop-title { font-size: 18px; font-weight: 700; color: var(--fm-text); }
        .fm-global-drop-sub { font-size: 13px; color: var(--fm-text-muted); }

        .fm-modal-bg {
          position: fixed; inset: 0; z-index: 200;
          background: rgba(28, 24, 18, 0.45);
          backdrop-filter: blur(2px);
          display: flex; align-items: center; justify-content: center;
        }
        .fm-modal {
          width: 540px; max-width: 92vw;
          max-height: 78vh;
          background: var(--fm-surface);
          border-radius: 12px;
          box-shadow: var(--fm-shadow-lg);
          display: flex; flex-direction: column;
          overflow: hidden;
        }
        .fm-modal.narrow { width: 420px; }
        .fm-modal-head {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--fm-border);
          background: var(--fm-surface-2);
        }
        .fm-modal-head > svg { color: var(--fm-text-muted); }
        .fm-modal-head input {
          flex: 1; height: 32px;
          padding: 0 8px;
          border: 0; background: transparent; outline: none;
          font-size: 13.5px; color: var(--fm-text);
        }
        .fm-modal-title { flex: 1; font-weight: 700; font-size: 13.5px; color: var(--fm-text); }
        .fm-modal-close {
          width: 28px; height: 28px;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 6px; border: 0; background: transparent;
          color: var(--fm-text-muted); cursor: pointer;
        }
        .fm-modal-close:hover { background: var(--fm-surface-2); color: var(--fm-text); }
        .fm-modal-body { flex: 1; overflow: auto; }
        .fm-modal-row {
          display: flex; align-items: center; gap: 12px;
          width: 100%; padding: 9px 14px;
          background: transparent; border: 0; text-align: left;
          border-bottom: 1px solid var(--fm-border);
          cursor: pointer;
        }
        .fm-modal-row:hover { background: var(--fm-blue-bg); }
        .fm-modal-code {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
          font-size: 12.5px;
          font-weight: 700;
          color: var(--fm-blue-deep);
          min-width: 90px;
        }
        .fm-modal-name { font-size: 12.5px; color: var(--fm-text-soft); flex: 1; }
        .fm-modal-empty { padding: 30px; text-align: center; color: var(--fm-text-muted); font-size: 13px; }

        .fm-shortcut-list { padding: 14px; display: flex; flex-direction: column; gap: 8px; }
        .fm-shortcut {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 10px;
          background: var(--fm-surface-2);
          border-radius: 6px;
          font-size: 12.5px;
        }
        .fm-shortcut span:last-child { margin-left: auto; color: var(--fm-text-soft); }
        .fm-shortcut .sep { color: var(--fm-text-muted); }
        .fm-shortcut kbd {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
          font-size: 11px;
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid var(--fm-border-strong);
          background: var(--fm-surface);
          color: var(--fm-text);
          box-shadow: 0 1px 0 var(--fm-border);
        }

        /* === Yabancı fatura toggle === */
        .fm-foreign-toggle {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 12px;
          margin-bottom: 10px;
          background: var(--fm-surface);
          border: 1px solid var(--fm-border);
          border-radius: 6px;
          cursor: pointer;
        }
        .fm-foreign-toggle input[type="checkbox"] {
          width: 16px; height: 16px;
          accent-color: var(--fm-blue);
          cursor: pointer;
        }
        .fm-foreign-toggle > span:first-of-type {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--fm-text);
        }
        .fm-foreign-hint {
          margin-left: auto;
          font-size: 11px;
          color: var(--fm-text-muted);
        }

        /* === Katlanır kesinti bölümleri === */
        .fm-collapse-section {
          background: var(--fm-surface);
          border: 1px solid var(--fm-border);
          border-radius: 6px;
          overflow: hidden;
          margin-bottom: 8px;
        }
        .fm-collapse-section.open { border-color: var(--fm-blue-soft); }
        .fm-collapse-head {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 9px 12px;
          background: var(--fm-surface-2);
          border: 0; border-bottom: 1px solid transparent;
          cursor: pointer;
          text-align: left;
        }
        .fm-collapse-section.open .fm-collapse-head {
          background: var(--fm-blue-bg);
          border-bottom-color: var(--fm-blue-soft);
        }
        .fm-collapse-title {
          flex: 1;
          font-size: 12px;
          font-weight: 700;
          color: var(--fm-text-soft);
        }
        .fm-collapse-section.open .fm-collapse-title { color: var(--fm-blue-deep); }
        .fm-collapse-badge {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 20px; height: 20px;
          padding: 0 6px;
          border-radius: 999px;
          background: var(--fm-blue);
          color: #fff;
          font-size: 10.5px;
          font-weight: 700;
        }
        .fm-collapse-chev {
          color: var(--fm-text-muted);
          font-size: 12px;
        }
        .fm-collapse-body { padding: 4px 4px 8px; }
        .fm-collapse-hint {
          padding: 6px 10px;
          margin: 4px 4px 6px;
          background: var(--fm-amber-bg);
          color: var(--fm-amber);
          border-radius: 5px;
          font-size: 11px;
          font-weight: 600;
        }
        .fm-collapse-empty {
          padding: 14px;
          text-align: center;
          color: var(--fm-text-muted);
          font-size: 12px;
        }
        .fm-collapse-foot {
          display: flex; align-items: center; justify-content: space-between;
          padding: 6px 10px 4px;
        }
        .fm-collapse-add {
          display: inline-flex; align-items: center; gap: 5px;
          height: 28px; padding: 0 12px;
          border-radius: 5px;
          border: 1px dashed var(--fm-blue-soft);
          background: transparent;
          color: var(--fm-blue-deep);
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
        }
        .fm-collapse-add:hover { background: var(--fm-blue-bg); }
        .fm-collapse-total {
          display: flex; gap: 12px;
          font-size: 11.5px;
          font-weight: 700;
          color: var(--fm-text-soft);
          font-variant-numeric: tabular-nums;
        }
        .fm-ledger-row select {
          height: 28px;
          padding: 0 6px;
          border: 1px solid var(--fm-border);
          border-radius: 5px;
          background: var(--fm-surface);
          color: var(--fm-text);
          font-size: 11.5px;
          outline: none;
        }
        .fm-ledger-row select:focus {
          border-color: var(--fm-blue);
          box-shadow: 0 0 0 3px var(--fm-blue-bg);
        }

        .hidden { display: none; }
        .space-y-3 > * + * { margin-top: 12px; }
        .shrink-0 { flex-shrink: 0; }
        .text-right { text-align: right; }
        .font-bold { font-weight: 700; }
        .text-xs { font-size: 11.5px; }

        @media (max-width: 1280px) {
          .fm-workbench { grid-template-columns: minmax(620px, 1fr) minmax(390px, 480px); }
          .fm-ledger-row { grid-template-columns: 96px minmax(0,1fr) 50px 80px 80px 26px; }
          .fm-action-bar { grid-template-columns: repeat(3, 1fr); }
          .fm-stat-strip { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </main>
  );
}

function CountButton({ value, onClick }: { value: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className={value > 0 ? 'fm-count-btn has-pending' : 'fm-count-btn'}>
      {value || 0}
    </button>
  );
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  onAdd,
  lines,
  onUpdateLine,
  onDeleteLine,
  onOpenAccount,
  rateOptions,
  hint,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  lines: AccountingLine[];
  onUpdateLine: (lineId: string, patch: Partial<AccountingLine>) => void;
  onDeleteLine: (lineId: string) => void;
  onOpenAccount: (lineId: string) => void;
  rateOptions: string[];
  hint?: string;
}) {
  const debit = lines.reduce((s, l) => s + parseAmount(l.debit), 0);
  const credit = lines.reduce((s, l) => s + parseAmount(l.credit), 0);
  return (
    <section className={open ? 'fm-collapse-section open' : 'fm-collapse-section'}>
      <button type="button" className="fm-collapse-head" onClick={onToggle}>
        <span className="fm-collapse-title">{title}</span>
        {lines.length > 0 ? <span className="fm-collapse-badge">{lines.length}</span> : null}
        <span className="fm-collapse-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className="fm-collapse-body">
          {hint ? <div className="fm-collapse-hint">{hint}</div> : null}
          {lines.length ? (
            <div className="fm-ledger-table">
              {lines.map((line) => (
                <div key={line.id} className="fm-ledger-row">
                  <button
                    type="button"
                    className="fm-account-trigger"
                    onClick={() => onOpenAccount(line.id)}
                    title="Hesap kodu seç"
                  >
                    {line.accountCode || <span className="fm-placeholder">Hesap seç</span>}
                  </button>
                  <input value={line.description} onChange={(e) => onUpdateLine(line.id, { description: e.target.value })} placeholder="Açıklama" />
                  {rateOptions.length ? (
                    <select value={line.rate || ''} onChange={(e) => onUpdateLine(line.id, { rate: e.target.value })}>
                      <option value="">Oran</option>
                      {rateOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <input value={line.rate || ''} onChange={(e) => onUpdateLine(line.id, { rate: e.target.value })} placeholder="Oran" />
                  )}
                  <input className="text-right" value={line.debit} onChange={(e) => onUpdateLine(line.id, { debit: e.target.value })} placeholder="Borç" />
                  <input className="text-right" value={line.credit} onChange={(e) => onUpdateLine(line.id, { credit: e.target.value })} placeholder="Alacak" />
                  <button className="fm-row-delete" onClick={() => onDeleteLine(line.id)} title="Satırı sil"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          ) : (
            <div className="fm-collapse-empty">Henüz satır yok</div>
          )}
          <div className="fm-collapse-foot">
            <button type="button" className="fm-collapse-add" onClick={onAdd}>
              <Plus size={13} /> Satır ekle
            </button>
            {lines.length ? (
              <div className="fm-collapse-total">
                <span>B {money(String(debit))}</span>
                <span>A {money(String(credit))}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
