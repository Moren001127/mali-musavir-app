'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
} from 'lucide-react';
import { api } from '@/lib/api';
import { currentAgentDeviceId } from '@/lib/agent-device';

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
  group: 'matrah' | 'vergi' | 'cari';
  accountCode: string;
  description: string;
  rate?: string;
  debit: string;
  credit: string;
};

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

export default function FaturaMuhasebelestirmePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const documentStageRef = useRef<HTMLDivElement>(null);
  const [drafts, setDrafts] = useState<DraftInvoice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
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
    const rows = [...dashboardRows].sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'));
    if (!q) return rows;
    return rows.filter((row) => row.name.toLocaleLowerCase('tr-TR').includes(q));
  }, [dashboardRows, dashboardSearch]);

  const totals = useMemo(() => {
    const debit = selected?.lines.reduce((sum, line) => sum + parseAmount(line.debit), 0) || 0;
    const credit = selected?.lines.reduce((sum, line) => sum + parseAmount(line.credit), 0) || 0;
    return { debit, credit, diff: Math.abs(debit - credit) };
  }, [selected]);

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

  const addFiles = (files: FileList | File[]) => {
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
      if (!selectedId && additions[0]) setSelectedId(additions[0].id);
      return [...prev, ...additions];
    });
  };

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
        targetDeviceId: currentAgentDeviceId(),
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
        targetDeviceId: currentAgentDeviceId(),
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
      toast.success(approve ? 'Belge onaylandı' : 'Taslak kaydedildi');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Kaydetme tamamlanamadı');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="invoice-accounting-dark min-h-0 bg-[#0f0d0a] text-[#f7eedb]">
      <div className="flex h-[calc(100vh-76px)] min-h-[620px] flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Receipt size={20} />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-normal">Fatura Muhasebeleştirme</h1>
              <p className="text-xs text-slate-500">Fatura, ÖKC fişi ve ileride mobil belgeler için tek onay ekranı</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {!showDashboard ? (
              <button
                onClick={() => {
                  setShowDashboard(true);
                  loadDashboard();
                }}
                className="inline-flex items-center gap-2 rounded-md border border-amber-300/30 px-3 py-2 text-sm font-medium text-[#f4d68a]"
              >
                <ArrowLeft size={16} /> Listeye Dön
              </button>
            ) : null}
            <span className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-600">Onaylanacak: <b className="text-red-500">{drafts.length - readyCount}</b></span>
            <button
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              <Upload size={16} /> Yükle
            </button>
            <button
              onClick={runOcr}
              disabled={scanning || !drafts.length}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {scanning ? <Loader2 className="animate-spin" size={16} /> : <ScanLine size={16} />} OCR Oku
            </button>
            <button
              onClick={refreshAccountPlan}
              disabled={!selected?.taxpayerId || accountPlanRefreshing}
              className="inline-flex items-center gap-2 rounded-md border border-amber-300/40 bg-[#2a2114] px-3 py-2 text-sm font-medium text-[#f4d68a] disabled:opacity-45"
              title="Seçili mükellefin hesap planını Luca'dan yeniden çek"
            >
              {accountPlanRefreshing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
              Hesap Planı Güncelle
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
          <section className="flex-1 overflow-hidden bg-[#0f0d0a] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[#6d145d] text-white" title="Ayarlar">
                  <SlidersHorizontal size={18} />
                </button>
                <button onClick={loadDashboard} className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[#1664c8] text-white" title="Yenile">
                  {dashboardLoading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                </button>
                <button
                  onClick={backfillExistingEarsiv}
                  disabled={backfillLoading}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-[#d4b876] px-3 text-sm font-semibold text-[#0f0d0a] disabled:opacity-60"
                  title="E-Fatura / E-Arşiv sorgulama alanındaki mevcut faturaları muhasebeleştirme kuyruğuna aktar"
                >
                  {backfillLoading ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
                  Mevcut Faturaları Aktar
                </button>
              </div>
              <input
                className="h-10 w-80 rounded-md border border-[#3b321f] bg-[#15110d] px-3 text-sm text-[#f7eedb] outline-none"
                value={dashboardSearch}
                onChange={(e) => setDashboardSearch(e.target.value)}
                placeholder="Mükellef ara"
              />
            </div>
            <div className="overflow-hidden rounded-md border border-[#332a1c] bg-[#15110d]">
              <div className="max-h-[calc(100vh-190px)] overflow-auto">
                <table className="min-w-full border-collapse text-[13px]">
                  <thead className="sticky top-0 z-10 bg-[#211a11] text-left text-[#f4d68a]">
                    <tr>
                      <th className="w-[32%] border-b border-[#3b321f] px-4 py-2.5 font-semibold">Firma Bilgisi</th>
                      <th className="border-b border-[#3b321f] px-3 py-2.5 font-semibold">Defter</th>
                      <th className="border-b border-[#3b321f] px-3 py-2.5 font-semibold">Bekleyen Alış</th>
                      <th className="border-b border-[#3b321f] px-3 py-2.5 font-semibold">Bekleyen Satış</th>
                      <th className="border-b border-[#3b321f] px-3 py-2.5 font-semibold">Bekleyen Banka</th>
                      <th className="border-b border-[#3b321f] px-3 py-2.5 font-semibold">Onaylanan</th>
                      <th className="border-b border-[#3b321f] px-3 py-2.5 font-semibold">Onaylanan Banka</th>
                      <th className="border-b border-[#3b321f] px-3 py-2.5 text-center font-semibold">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardFiltered.map((row, idx) => (
                      <tr key={row.taxpayerId} className={idx % 2 ? 'bg-[#18130f]' : 'bg-[#100d0a]'}>
                        <td className="border-b border-[#2a2419] px-4 py-2.5 font-semibold text-[#f7eedb]">{row.name}</td>
                        <td className="border-b border-[#2a2419] px-3 py-2.5 text-[#d8cda5]">{row.ledgerType}</td>
                        <td className="border-b border-[#2a2419] px-3 py-2.5">
                          <button onClick={() => openTaxpayerQueue(row, 'ALIS')} className="min-w-10 rounded-md bg-[#1f7ad9] px-2.5 py-1 text-center font-bold text-white hover:bg-[#2f8ef0]">
                            {row.pendingPurchase}
                          </button>
                        </td>
                        <td className="border-b border-[#2a2419] px-3 py-2.5">
                          <button onClick={() => openTaxpayerQueue(row, 'SATIS')} className="min-w-10 rounded-md bg-[#1f7ad9] px-2.5 py-1 text-center font-bold text-white hover:bg-[#2f8ef0]">
                            {row.pendingSale}
                          </button>
                        </td>
                        <td className="border-b border-[#2a2419] px-3 py-2.5 font-bold text-[#d8cda5]">{row.pendingBank}</td>
                        <td className="border-b border-[#2a2419] px-3 py-2.5 font-bold text-[#d8cda5]">{row.approvedInvoice}</td>
                        <td className="border-b border-[#2a2419] px-3 py-2.5 font-bold text-[#d8cda5]">{row.approvedBank}</td>
                        <td className="border-b border-[#2a2419] px-3 py-2 text-center">
                          <button
                            onClick={() => refreshAccountPlanForTaxpayer(row.taxpayerId, row.name)}
                            disabled={dashboardAccountPlanJob === row.taxpayerId}
                            className="mr-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#4a3d25] bg-[#241b10] text-[#f4d68a] hover:bg-[#302314] disabled:opacity-50"
                            title="Bu mükellefin hesap planını Luca'dan güncelle"
                          >
                            {dashboardAccountPlanJob === row.taxpayerId ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                          </button>
                          <button onClick={() => openTaxpayerQueue(row)} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#1f7ad9] text-white hover:bg-[#2f8ef0]" title="Fatura işleme ekranını aç">
                            <Pencil size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!dashboardFiltered.length ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-[#d8cda5]">
                          {dashboardLoading ? 'Gelen evrak özeti yükleniyor' : 'Mükellef kaydı bulunamadı'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : (
        <section className="invoice-workbench grid flex-1 overflow-hidden">
          <div className="invoice-document-area flex min-w-0 flex-col">
            <div className="invoice-document-toolbar flex h-12 items-center justify-between border-b border-[#c6d0dc] px-4">
              <div className="flex items-center gap-2">
                <button className="tool-icon" onClick={() => setManualZoom(Math.max(0.45, zoom - 0.1))} title="Uzaklaştır">
                  <ZoomOut size={16} />
                </button>
                <button
                  className={zoomMode === 'fit' ? 'tool-pill active' : 'tool-pill'}
                  onClick={fitDocument}
                  title="Ekrana sığdır"
                >
                  <Maximize2 size={15} /> Sığdır
                </button>
                <button
                  className={zoomMode === 'fit-width' ? 'tool-pill active' : 'tool-pill'}
                  onClick={fitDocumentWidth}
                  title="Genişliğe sığdır"
                >
                  Genişlik
                </button>
                <input
                  className="zoom-slider"
                  type="range"
                  min="0.45"
                  max="1.9"
                  step="0.05"
                  value={zoom}
                  onChange={(e) => setManualZoom(Number(e.target.value))}
                />
                <span className="w-12 text-right text-xs font-semibold text-[#50657c]">%{Math.round(viewerScale * 100)}</span>
                <button className="tool-icon" onClick={() => setManualZoom(Math.min(1.9, zoom + 0.1))} title="Yakınlaştır">
                  <ZoomIn size={16} />
                </button>
                <button className="tool-icon" onClick={() => setRotation((r) => (r + 90) % 360)} title="Döndür">
                  <RotateCw size={16} />
                </button>
              </div>
              <div className="document-counter">
                <button onClick={() => drafts[selectedIndex - 1] && setSelectedId(drafts[selectedIndex - 1].id)} title="Önceki">
                  <ChevronLeft size={16} />
                </button>
                <span>{selected ? String(selectedIndex + 1) : '0'} / {drafts.length}</span>
                <button onClick={() => drafts[selectedIndex + 1] && setSelectedId(drafts[selectedIndex + 1].id)} title="Sonraki">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {!selected ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
                className={dragging ? 'empty-dropzone dragging' : 'empty-dropzone'}
              >
                <Upload size={36} className="mb-3 text-[#1d77d3]" />
                <div className="text-base font-bold text-[#172033]">ÖKC fişi veya fatura belgesi yükleyin</div>
                <div className="mt-1 text-sm text-[#607083]">JPG, PNG, PDF ve XML kabul edilir. Belgeler kuyrukta kontrol/onaya düşer.</div>
                <button onClick={() => inputRef.current?.click()} className="mt-5 rounded-md bg-[#1d77d3] px-4 py-2 text-sm font-semibold text-white">Dosya Seç</button>
              </div>
            ) : (
              <div className="document-stage" ref={documentStageRef}>
                <div
                  className="document-scale-wrap"
                  style={{
                    transform: 'scale(' + viewerScale + ') rotate(' + rotation + 'deg)',
                    transformOrigin: 'top left',
                    width: Math.ceil(DOCUMENT_BASE_WIDTH * viewerScale),
                    minHeight: Math.ceil(DOCUMENT_BASE_HEIGHT * viewerScale),
                  }}
                >
                  {selected.previewType === 'image' ? (
                    <img src={selected.previewUrl} alt={selected.file.name} className="document-preview document-image" />
                  ) : selected.previewUrl ? (
                    <iframe src={selected.previewUrl} className="document-preview document-frame" title={selected.file.name} />
                  ) : (
                    <div className="document-preview flex min-h-[520px] items-center justify-center rounded-md bg-white p-8 text-center text-slate-500">Bu dosya için önizleme yok.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <aside className="review-panel flex min-w-0 flex-col">
            <datalist id="luca-account-plan-options">
              {accountOptions.map((account) => (
                <option key={account.id} value={account.code}>
                  {account.code} - {account.name}
                </option>
              ))}
            </datalist>

            <div className="review-header">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#6a7d94]">Kontrol ve Onay Paneli</div>
                <div className="mt-0.5 text-base font-bold text-[#132033]">{selectedBusinessLedger ? 'İşletme Defteri Kaydı' : 'Muhasebe Fişi Önerisi'}</div>
              </div>
              <div className={totals.diff < 0.01 ? 'balance-badge ok' : 'balance-badge warn'}>
                {totals.diff < 0.01 ? 'Dengede' : money(String(totals.diff))}
              </div>
            </div>

            {selected ? (
              <>
                <div className="review-scroll">
                  {selected.duplicateOfId || selected.duplicateReason ? (
                    <div className="duplicate-band">
                      <AlertTriangle size={18} className="shrink-0" />
                      <div>
                        <div className="font-bold">Mükerrer belge uyarısı</div>
                        <div className="mt-0.5 text-xs">{selected.duplicateReason || 'Bu belge daha önce işlenmiş bir kayıtla eşleşiyor. Onaylamadan önce kontrol edin.'}</div>
                      </div>
                    </div>
                  ) : null}

                  <div className="plan-strip">
                    <span>{selectedBusinessLedger ? 'İşletme defteri: hesap kodu yerine kayıt türü kullanılır.' : accountPlanLoading ? 'Hesap planı yükleniyor' : accountOptions.length ? accountOptions.length + ' kod hazır' : 'Hesap planı henüz çekilmedi'}</span>
                    <span>{accountPlanSource?.createdAt ? new Date(accountPlanSource.createdAt).toLocaleString('tr-TR') : 'Luca güncellemesi bekleniyor'}</span>
                  </div>

                  <div className="meta-grid">
                    <label>Para Birimi<input value={selected.currency} onChange={(e) => updateSelected({ currency: e.target.value })} /></label>
                    <label>Kur<input className="text-right" value={selected.exchangeRate} onChange={(e) => updateSelected({ exchangeRate: e.target.value })} /></label>
                    <label>Fatura Türü<select value={selected.invoiceKind} onChange={(e) => updateSelected({ invoiceKind: e.target.value as DraftInvoice['invoiceKind'] })}><option>Alış</option><option>Satış</option></select></label>
                    <label>Belge Türü<select value={selected.documentType} onChange={(e) => updateSelected({ documentType: e.target.value as DraftInvoice['documentType'] })}><option value="OKC_FIS">ÖKC Fişi</option><option value="E_FATURA">E-Fatura</option><option value="E_ARSIV">E-Arşiv</option><option value="FIS">Fiş</option><option value="DIGER">Diğer</option></select></label>
                  </div>

                  {!selectedBusinessLedger ? (
                    <div className="space-y-3">
                      {(['matrah', 'vergi', 'cari'] as const).map((group) => {
                        const title = group === 'matrah' ? 'Matrah' : group === 'vergi' ? 'KDV / Vergi' : 'Cari / Ödeme';
                        const groupLines = selected.lines.filter((line) => line.group === group);
                        const groupDebit = groupLines.reduce((sum, line) => sum + parseAmount(line.debit), 0);
                        const groupCredit = groupLines.reduce((sum, line) => sum + parseAmount(line.credit), 0);
                        return (
                          <section key={group} className="ledger-section">
                            <div className="ledger-section-head">
                              <div><span>{title}</span> <b>(B)</b></div>
                              <button onClick={() => updateSelected({ lines: [...selected.lines, makeLine(group, '', '', '0,00', '0,00')] })}><Plus size={14} /> Satır</button>
                            </div>
                            <div className="ledger-table">
                              {groupLines.map((line) => (
                                <div key={line.id} className="ledger-row">
                                  <input list="luca-account-plan-options" value={line.accountCode} onChange={(e) => updateLine(line.id, { accountCode: e.target.value })} placeholder="Hesap" />
                                  <input value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} placeholder="Açıklama" />
                                  <input value={line.rate || ''} onChange={(e) => updateLine(line.id, { rate: e.target.value })} placeholder="Oran" />
                                  <input className="text-right" value={line.debit} onChange={(e) => updateLine(line.id, { debit: e.target.value })} placeholder="Borç" />
                                  <input className="text-right" value={line.credit} onChange={(e) => updateLine(line.id, { credit: e.target.value })} placeholder="Alacak" />
                                  <button className="delete-row" onClick={() => updateSelected({ lines: selected.lines.filter((l) => l.id !== line.id) })} title="Satırı sil"><Trash2 size={15} /></button>
                                </div>
                              ))}
                              {!groupLines.length ? <div className="empty-ledger-row">Bu bölümde satır yok.</div> : null}
                            </div>
                            <div className="section-total"><span>Toplam</span><b>Borç {money(String(groupDebit))}</b><b>Alacak {money(String(groupCredit))}</b></div>
                          </section>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selected.lines.map((line, index) => (
                        <section key={line.id} className="business-card">
                          <div className="business-card-head">
                            <span>{index + 1}</span>
                            <button onClick={() => updateSelected({ lines: selected.lines.filter((l) => l.id !== line.id) })} title="Kaydı sil"><Trash2 size={15} /></button>
                          </div>
                          <div className="business-grid top">
                            <label>Kayıt Türü<select value={line.description || businessCategories[0]} onChange={(e) => updateLine(line.id, { description: e.target.value })}>{businessCategories.map((cat) => <option key={cat}>{cat}</option>)}</select></label>
                            <label>Alt Tür<select value={line.accountCode || businessSubCategories[0]} onChange={(e) => updateLine(line.id, { accountCode: e.target.value })}>{businessSubCategories.map((cat) => <option key={cat}>{cat}</option>)}</select></label>
                          </div>
                          <div className="business-grid amounts">
                            <label>Matrah<input className="text-right" value={line.debit} onChange={(e) => updateLine(line.id, { debit: e.target.value })} /></label>
                            <label>KDV Oranı<select value={line.rate || '%20 Kdv'} onChange={(e) => updateLine(line.id, { rate: e.target.value })}><option>%20 Kdv</option><option>%10 Kdv</option><option>%1 Kdv</option><option>%0 Kdv</option></select></label>
                            <label>KDV Tutarı<input className="text-right" value={line.credit} onChange={(e) => updateLine(line.id, { credit: e.target.value })} /></label>
                          </div>
                          <div className="fold-lines"><button>Hesap Kodu <ChevronRight size={14} /></button><button>Tevkifat İşlemleri <ChevronRight size={14} /></button><button>Stopaj İşlemleri <ChevronRight size={14} /></button></div>
                          <div className="business-total"><span>Toplam Tutar (KDV Dahil)</span><b>{money(String(parseAmount(line.debit) + parseAmount(line.credit)))}</b></div>
                        </section>
                      ))}
                      <button onClick={() => updateSelected({ lines: [...selected.lines, makeLine('matrah', businessSubCategories[0], businessCategories[0], '0,00', '0,00', '%20 Kdv')] })} className="add-business"><Plus size={16} /> Kayıt Ekle</button>
                    </div>
                  )}

                  <div className="info-grid">
                    <label>Tarih<input type="date" value={selected.date} onChange={(e) => updateSelected({ date: e.target.value })} /></label>
                    <label>Belge No<input value={selected.number} onChange={(e) => updateSelected({ number: e.target.value })} /></label>
                    <label>Satıcı VKN<input value={selected.sellerVkn} onChange={(e) => updateSelected({ sellerVkn: e.target.value })} /></label>
                    <label>Toplam Tutar<input className="text-right font-bold" value={selected.total} onChange={(e) => updateSelected({ total: e.target.value })} /></label>
                    <label className="col-span-2">Satıcı Bilgisi<input value={selected.vendorName} onChange={(e) => updateSelected({ vendorName: e.target.value })} /></label>
                  </div>
                </div>

                <div className="uploaded-strip">
                  <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.08em] text-[#6a7d94]"><span>Yüklenen Belgeler</span><span>{drafts.length} belge</span></div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {drafts.map((draft) => (
                      <button key={draft.id} onClick={() => setSelectedId(draft.id)} className={selected?.id === draft.id ? 'doc-chip active' : 'doc-chip'}>
                        {draft.previewType === 'image' ? <ImageIcon size={15} /> : <FileText size={15} />}
                        <span>{draft.file.name}</span>
                        {draft.status === 'hazir' ? <CheckCircle2 size={15} /> : null}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="action-bar">
                  <button onClick={() => { setShowDashboard(true); loadDashboard(); }} className="secondary"><ArrowLeft size={15} /> Listeye Dön</button>
                  <button onClick={() => drafts[selectedIndex - 1] && setSelectedId(drafts[selectedIndex - 1].id)} className="ghost"><ChevronLeft size={15} /> Geri</button>
                  <button onClick={() => drafts[selectedIndex + 1] && setSelectedId(drafts[selectedIndex + 1].id)} className="ghost">İleri <ChevronRight size={15} /></button>
                  <button onClick={removeSelected} disabled={!selected} className="danger"><Trash2 size={15} /> Sil</button>
                  <button onClick={() => saveSelected(false)} disabled={!selected || saving} className="save">{saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Kaydet</button>
                  <button onClick={() => saveSelected(true)} disabled={!selected || saving} className="approve"><CheckCircle2 size={15} /> Kaydet ve Onayla</button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-[#64748b]">
                <div>
                  <FileText size={34} className="mx-auto mb-3 text-[#94a3b8]" />
                  <div className="font-semibold text-[#334155]">{loadingExisting ? 'Kayıtlar yükleniyor' : 'Henüz belge seçilmedi'}</div>
                  <p className="mt-1 text-sm">Sol alana ÖKC fişi veya fatura görseli yükleyin.</p>
                </div>
              </div>
            )}
          </aside>
        </section>
        )}
      </div>
      <style jsx global>{`
        .invoice-accounting-dark {
          background: #0d0b08;
          color: #f7eedb;
        }
        .invoice-accounting-dark > div > header {
          background: linear-gradient(90deg, #12100c 0%, #17130e 56%, #21170d 100%) !important;
          border-color: #2f2618 !important;
          color: #f7eedb !important;
        }
        .invoice-accounting-dark > div > header h1 { color: #fff7df !important; }
        .invoice-accounting-dark > div > header p { color: #d8cda5 !important; }
        .invoice-workbench { grid-template-columns: minmax(760px, 1fr) minmax(420px, 520px); background: #17130e; border-top: 1px solid #302615; }
        .invoice-document-area { min-height: 0; background: #dfe5eb; border-right: 2px solid #b9c3ce; }
        .invoice-document-toolbar { background: #f6f8fb; color: #1e293b; box-shadow: 0 1px 0 rgba(15,23,42,.06); }
        .tool-icon { display: inline-flex; height: 34px; width: 34px; align-items: center; justify-content: center; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; color: #29425f; }
        .tool-pill { display: inline-flex; height: 34px; align-items: center; gap: 6px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; padding: 0 10px; color: #29425f; font-size: 12px; font-weight: 700; }
        .tool-pill.active { border-color: #7aa7dc; background: #e8f2ff; color: #155fae; }
        .zoom-slider { width: 170px; accent-color: #236fd0; }
        .document-counter { display: inline-flex; align-items: center; gap: 7px; color: #203047; font-weight: 700; }
        .document-counter button { display: inline-flex; height: 34px; width: 34px; align-items: center; justify-content: center; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; }
        .document-stage { flex: 1; min-height: 0; overflow: auto; padding: 14px; background: linear-gradient(90deg, rgba(148,163,184,.12) 1px, transparent 1px), linear-gradient(0deg, rgba(148,163,184,.10) 1px, transparent 1px), #e8edf2; background-size: 28px 28px; }
        .document-scale-wrap { margin: 0 auto; transition: transform .14s ease; overflow: visible; }
        .document-preview { display: block; margin: 0 auto; border: 1px solid #cbd5e1; background: #fff; box-shadow: 0 16px 36px rgba(15,23,42,.18); }
        .document-image { width: 980px; max-width: none; height: auto; }
        .document-frame { width: 980px; height: 1380px; border-radius: 6px; }
        .empty-dropzone { margin: 24px; display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; border: 2px dashed #b6c3d1; border-radius: 8px; background: #f8fafc; }
        .empty-dropzone.dragging { border-color: #2474d3; background: #eef6ff; }
        .review-panel { min-height: 0; background: #f3f6fa; color: #172033; border-left: 1px solid #d6dee8; }
        .review-header { display: flex; min-height: 50px; align-items: center; justify-content: space-between; border-bottom: 1px solid #d7e0eb; background: linear-gradient(90deg, #fff, #f3f7fb); padding: 8px 14px; }
        .balance-badge { border-radius: 999px; padding: 6px 11px; font-size: 12px; font-weight: 800; }
        .balance-badge.ok { background: #dff7ea; color: #057047; }
        .balance-badge.warn { background: #fff3cf; color: #9a5a00; }
        .review-scroll { flex: 1; min-height: 0; overflow: auto; padding: 10px 12px 8px; }
        .duplicate-band { display: flex; gap: 10px; border: 1px solid #fecaca; border-radius: 6px; background: #fff1f2; color: #9f1239; padding: 10px 12px; }
        .plan-strip { display: flex; justify-content: space-between; gap: 10px; border: 1px solid #cfe1f8; border-radius: 5px; background: #eaf4ff; color: #335b80; padding: 6px 9px; font-size: 11px; font-weight: 700; }
        .meta-grid, .info-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; margin-top: 8px; margin-bottom: 8px; border: 1px solid #d6e4f3; border-radius: 5px; background: #edf6ff; padding: 8px; }
        .info-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); background: transparent; border: 0; padding: 0; }
        .meta-grid label, .info-grid label, .business-grid label { min-width: 0; color: #52657d; font-size: 11px; font-weight: 800; }
        .meta-grid input, .meta-grid select, .info-grid input, .business-grid input, .business-grid select, .ledger-row input { margin-top: 3px; height: 28px; width: 100%; min-width: 0; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; padding: 0 7px; color: #0f172a; outline: none; }
        .ledger-section { overflow: hidden; border: 1px solid #8bc3ee; border-radius: 6px; background: #fff; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
        .ledger-section-head { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #8bc3ee; background: #f4fbff; padding: 6px 8px; color: #172033; font-weight: 900; }
        .ledger-section-head b { color: #ef4444; }
        .ledger-section-head button, .add-business { display: inline-flex; height: 26px; align-items: center; gap: 5px; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; padding: 0 8px; color: #334155; font-size: 11px; font-weight: 800; }
        .ledger-row { display: grid; grid-template-columns: 105px minmax(0, 1fr) 54px 84px 84px 24px; gap: 5px; align-items: center; border-bottom: 1px solid #e5edf6; padding: 5px 8px; }
        .ledger-row input { margin-top: 0; height: 27px; font-size: 11px; }
        .delete-row, .business-card-head button { display: inline-flex; height: 30px; align-items: center; justify-content: center; border-radius: 6px; color: #ef4444; }
        .empty-ledger-row { padding: 12px; color: #64748b; font-size: 12px; }
        .section-total { display: flex; justify-content: flex-end; gap: 12px; background: #f8fafc; padding: 5px 9px; color: #334155; font-size: 11px; }
        .business-card { overflow: hidden; border: 1px solid #8bc3ee; border-radius: 6px; background: #b9dcf5; box-shadow: 0 1px 2px rgba(15,23,42,.08); }
        .business-card-head { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #99c8ed; padding: 8px 10px; }
        .business-card-head span { display: inline-flex; min-width: 28px; height: 28px; align-items: center; justify-content: center; border-radius: 6px; background: #9be071; color: #10200d; font-weight: 900; }
        .business-grid { display: grid; gap: 10px; padding: 10px; }
        .business-grid.top { grid-template-columns: 1fr 1fr; }
        .business-grid.amounts { grid-template-columns: 1fr 1fr 1fr; padding-top: 0; }
        .fold-lines { display: grid; gap: 4px; padding: 0 10px 8px; }
        .fold-lines button { display: flex; align-items: center; justify-content: space-between; border: 0; background: transparent; color: #29445d; padding: 3px 0; font-size: 12px; }
        .business-total { display: flex; justify-content: space-between; background: #e8f5ff; padding: 10px 12px; color: #15324a; font-weight: 900; }
        .uploaded-strip { border-top: 1px solid #d7e0eb; background: #f8fafc; padding: 7px 10px; }
        .doc-chip { display: inline-flex; min-width: 180px; align-items: center; gap: 7px; border: 1px solid #d5dde8; border-radius: 6px; background: #fff; padding: 8px 10px; color: #334155; font-size: 12px; }
        .doc-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .doc-chip.active { border-color: #1d77d3; box-shadow: 0 0 0 2px #dbeafe; }
        .action-bar { display: grid; grid-template-columns: 1fr .72fr .72fr .6fr .78fr 1.18fr; gap: 6px; border-top: 1px solid #d7e0eb; background: #eef3f8; padding: 7px 9px; }
        .action-bar button { display: inline-flex; height: 31px; align-items: center; justify-content: center; gap: 5px; border-radius: 5px; font-size: 11px; font-weight: 900; }
        .action-bar .secondary { background: #fff4a8; color: #4b3a00; border: 1px solid #ead764; }
        .action-bar .ghost { background: #fff; color: #334155; border: 1px solid #cbd5e1; }
        .action-bar .danger { background: #fff; color: #dc2626; border: 1px solid #fecaca; }
        .action-bar .save { background: #f59e0b; color: #fff; }
        .action-bar .approve { background: #1877f2; color: #fff; }
        .action-bar button:disabled { opacity: .45; }
        @media (max-width: 1280px) {
          .invoice-workbench { grid-template-columns: minmax(620px, 1fr) minmax(390px, 480px); }
          .ledger-row { grid-template-columns: 96px minmax(0,1fr) 48px 76px 76px 24px; }
          .action-bar { grid-template-columns: repeat(3, 1fr); }
        }
      `}</style>
    </main>
  );
}
