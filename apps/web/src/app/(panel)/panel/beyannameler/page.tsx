'use client';

import { useState, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  beyanKayitlariApi,
  BeyanKaydi,
  BeyanTipi,
  BEYAN_TIPI_LABEL,
  ImportResult,
  beyanKaydiMukellefAdi,
} from '@/lib/beyan-kayitlari';
import { PORTAL_JOB_LABEL, PortalJob, portalAutomationApi } from '@/lib/portal-automation';
import { api } from '@/lib/api';
import PortalAutomationPanel from '@/components/portal-automation/PortalAutomationPanel';
import Link from 'next/link';
import {
  Search, Upload, Download, FileText, Trash2, Printer,
  CheckCircle2, AlertCircle, FileQuestion, Loader2, X as IconX,
  FolderUp, FileX2, Archive, Sparkles, Eye, Mail, MessageCircle,
  MessageSquareText, Filter, CalendarDays, UserRound, RotateCcw,
  KeyRound, Play,
} from 'lucide-react';
import { toast } from 'sonner';

const GOLD = '#d4b876';

type FilterKey = 'all' | BeyanTipi;
type BelgeFilter = 'all' | 'beyanname' | 'tahakkuk';
type DurumFilter = 'all' | 'gonderilen' | 'gonderilmeyen' | 'okunan' | 'okunmayan' | 'sms_gonderilen' | 'sms_gonderilmeyen';
type BeyanDocKind = 'beyanname' | 'tahakkuk';
type BeyanTableRow = {
  key: string;
  row: BeyanKaydi;
  kind: BeyanDocKind;
  tur: 'EBeyanname' | 'Tahakkuk';
  hasFile: boolean;
};
type PdfPreview = {
  url: string;
  title: string;
  subtitle: string;
  docKey: string;
};

const FILTER_KEYS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'KDV1', label: 'KDV1' },
  { key: 'KDV2', label: 'KDV2' },
  { key: 'MUHSGK', label: 'MUHSGK' },
  { key: 'DAMGA', label: 'Damga' },
  { key: 'POSET', label: 'Poşet' },
  { key: 'KURUMLAR', label: 'Kurumlar' },
  { key: 'GELIR', label: 'Gelir' },
  { key: 'GGECICI', label: 'Gelir Geçici' },
  { key: 'KGECICI', label: 'Kurum Geçici' },
  { key: 'EDEFTER', label: 'E-Defter' },
];

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(n) + ' ₺';
}

function fmtDonem(d: string): string {
  // "2026-03" → "Mart 2026"; "2025-YIL" → "2025 Yıllık"
  const m = d.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const aylar = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
    return `${aylar[Number(m[2]) - 1]} ${m[1]}`;
  }
  if (/^\d{4}-YIL$/.test(d)) return d.replace('-YIL', ' Yıllık');
  return d;
}

function fmtCurrency(n: number | null): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' TL';
}

function periodSortValue(donem: string): number {
  const monthly = donem.match(/^(\d{4})-(\d{2})$/);
  if (monthly) return Number(monthly[1]) * 100 + Number(monthly[2]);
  const quarter = donem.match(/^(\d{4})-Q([1-4])$/i);
  if (quarter) return Number(quarter[1]) * 100 + Number(quarter[2]) * 3;
  const yearly = donem.match(/^(\d{4})-YIL$/);
  if (yearly) return Number(yearly[1]) * 100 + 12;
  return 0;
}

function fmtDonemHattat(donem: string): string {
  const quarter = donem.match(/^(\d{4})-Q([1-4])$/i);
  if (quarter) {
    const start = (Number(quarter[2]) - 1) * 3 + 1;
    return `${quarter[1]}/${start} - ${quarter[1]}/${start + 2}`;
  }
  const monthly = donem.match(/^(\d{4})-(\d{2})$/);
  if (monthly) {
    const month = Number(monthly[2]);
    return `${monthly[1]}/${month} - ${monthly[1]}/${month}`;
  }
  const yearly = donem.match(/^(\d{4})-YIL$/);
  if (yearly) return yearly[1];
  return donem;
}

function periodInRange(donem: string, start: string, end: string): boolean {
  const value = periodSortValue(donem);
  if (!value) return true;
  const min = start ? periodSortValue(start) : 0;
  const max = end ? periodSortValue(end) : 999999;
  return value >= min && value <= max;
}

function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR');
}

function fmtDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

function textKey(value?: string | null): string {
  return String(value || '')
    .toLocaleUpperCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function beyanMahiyeti(row: BeyanKaydi): 'ASIL' | 'DUZELTME' {
  const raw = (() => {
    if (!row.notlar) return '';
    try {
      return JSON.stringify(JSON.parse(row.notlar));
    } catch {
      return row.notlar;
    }
  })();
  return /\bDUZELTME\b/.test(textKey(raw)) ? 'DUZELTME' : 'ASIL';
}

function portalJobProgress(job: PortalJob) {
  const progress = job.payload?.progress && typeof job.payload.progress === 'object' ? job.payload.progress : {};
  const current = Number(progress.current);
  const total = Number(progress.total);
  const records = Number(progress.records);
  const pct = Number.isFinite(current) && Number.isFinite(total) && total > 0
    ? Math.max(0, Math.min(100, Math.round((current / total) * 100)))
    : null;
  return {
    message: typeof progress.message === 'string' ? progress.message : '',
    detail: typeof progress.detail === 'string' ? progress.detail : '',
    current: Number.isFinite(current) ? current : null,
    total: Number.isFinite(total) ? total : null,
    records: Number.isFinite(records) ? records : null,
    pct,
  };
}

function portalTaxpayerName(job: PortalJob): string {
  const taxpayer = job.taxpayer;
  if (!taxpayer) return 'Tüm ofis';
  return taxpayer.companyName || [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ') || taxpayer.taxNumber || 'Mükellef';
}

function portalJobStatus(status: PortalJob['status']) {
  switch (status) {
    case 'done': return { label: 'Tamam', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.22)' };
    case 'running': return { label: 'Çalışıyor', color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.22)' };
    case 'failed': return { label: 'Hata', color: '#fb7185', bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.24)' };
    case 'cancelled': return { label: 'İptal', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.22)' };
    default: return { label: 'Kuyrukta', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.22)' };
  }
}

function dateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayRange(): { from: string; to: string } {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const v = dateInputValue(d);
  return { from: v, to: v };
}

function firstContact(values?: Array<string | null | undefined>): string {
  return (values || []).map((v) => String(v || '').trim()).find(Boolean) || '';
}

function taxpayerEmail(k: BeyanKaydi): string {
  return firstContact([k.taxpayer?.email, ...(k.taxpayer?.emails || [])]);
}

function taxpayerPhone(k: BeyanKaydi): string {
  return firstContact([k.taxpayer?.phone, ...(k.taxpayer?.phones || [])]);
}

function taxpayerLooksCorporate(k: BeyanKaydi): boolean {
  const taxNumber = String(k.taxpayer?.taxNumber || '').replace(/\D/g, '');
  const nameKey = textKey([
    k.taxpayer?.companyName,
    k.taxpayer?.firstName,
    k.taxpayer?.lastName,
  ].filter(Boolean).join(' '));
  if (/\b(LIMITED|LTD|ANONIM|A S|AS|SIRKET|SIRKETI|STI|KOOPERATIF)\b/.test(nameKey)) return true;
  return taxNumber.length === 10;
}

function taxpayerLooksPersonal(k: BeyanKaydi): boolean {
  const taxNumber = String(k.taxpayer?.taxNumber || '').replace(/\D/g, '');
  return taxNumber.length === 11 && !taxpayerLooksCorporate(k);
}

function declarationRawText(k: BeyanKaydi): string {
  try {
    const parsed = JSON.parse(k.notlar || '{}');
    const raw = parsed?.raw || parsed;
    return [
      raw?.beyanTipiRaw,
      raw?.mahiyet,
      raw?.rowText,
      Array.isArray(raw?.cells) ? raw.cells.join(' ') : '',
    ].filter(Boolean).join(' ');
  } catch {
    return k.notlar || '';
  }
}

function declarationTypeCode(k: BeyanKaydi): string {
  if (['GECICI_VERGI', 'GGECICI', 'KGECICI'].includes(k.beyanTipi)) {
    if (taxpayerLooksCorporate(k)) return 'KGECICI';
    if (taxpayerLooksPersonal(k)) return 'GGECICI';
  }
  if (k.beyanTipi === 'GGECICI' || k.beyanTipi === 'KGECICI') return k.beyanTipi;
  if (k.beyanTipi !== 'GECICI_VERGI') return k.beyanTipi;
  const key = declarationRawText(k)
    .toLocaleUpperCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
  if (/GGECICI|GELIRGECICI|GELIRVERGISIGECICI/.test(key)) return 'GGECICI';
  if (/KGECICI|KURUMGECICI|KURUMLARGECICI|KURUMLARVERGISIGECICI/.test(key)) return 'KGECICI';
  return 'GECICI_VERGI';
}

function declarationTypeLabel(k: BeyanKaydi): string {
  const code = declarationTypeCode(k) as BeyanTipi;
  return BEYAN_TIPI_LABEL[code] || BEYAN_TIPI_LABEL[k.beyanTipi] || code;
}

function declarationTypeMatches(k: BeyanKaydi, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'GECICI_VERGI') return ['GECICI_VERGI', 'GGECICI', 'KGECICI'].includes(declarationTypeCode(k));
  return k.beyanTipi === filter || declarationTypeCode(k) === filter;
}

function whatsappPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `90${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `9${digits}`;
  return digits;
}

function declarationSubject(k: BeyanKaydi): string {
  return `${beyanKaydiMukellefAdi(k)} - ${declarationTypeLabel(k)} - ${fmtDonem(k.donem)}`;
}

function declarationMessage(k: BeyanKaydi): string {
  const tutar = k.tahakkukTutari != null ? ` Tahakkuk: ${fmtCurrency(k.tahakkukTutari)}.` : '';
  return `${fmtDonem(k.donem)} dönemi ${declarationTypeLabel(k)} kaydınız hazır.${tutar}`;
}

export default function BeyannamelerPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<FilterKey>('all');
  const [docFilter, setDocFilter] = useState<BelgeFilter>('all');
  const [durumFilter, setDurumFilter] = useState<DurumFilter>('all');
  const [selectedTaxpayer, setSelectedTaxpayer] = useState('all');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [importModal, setImportModal] = useState(false);
  const defaultPullRange = useMemo(() => yesterdayRange(), []);
  const [pullFrom, setPullFrom] = useState(defaultPullRange.from);
  const [pullTo, setPullTo] = useState(defaultPullRange.to);
  const [selectedDocKeys, setSelectedDocKeys] = useState<Set<string>>(() => new Set());
  const [viewedDocKeys, setViewedDocKeys] = useState<Set<string>>(() => new Set());
  const [sentEmailRows, setSentEmailRows] = useState<Set<string>>(() => new Set());
  const [sentWhatsappRows, setSentWhatsappRows] = useState<Set<string>>(() => new Set());
  const [sentSmsRows, setSentSmsRows] = useState<Set<string>>(() => new Set());
  const [pdfPreview, setPdfPreview] = useState<PdfPreview | null>(null);
  const [previewPortalReady, setPreviewPortalReady] = useState(false);
  const pdfPreviewUrlRef = useRef<string | null>(null);

  const { data: portalSummary } = useQuery({
    queryKey: ['portal-automation-summary', 'beyanname-page'],
    queryFn: () => portalAutomationApi.summary(),
    refetchInterval: 3000,
  });

  const latestBeyanJob = portalSummary?.latestJobs?.find((job) => job.jobType === 'EBEYANNAME_DAILY_DOWNLOAD');
  const isBeyanJobRunning = latestBeyanJob?.status === 'running';
  const isBeyanJobActive = latestBeyanJob?.status === 'running' || latestBeyanJob?.status === 'pending';

  const { data: kayitlar = [], isLoading } = useQuery<BeyanKaydi[]>({
    queryKey: ['beyan-kayitlari', 'redesign'],
    queryFn: () => beyanKayitlariApi.list({ limit: 1500 }),
    refetchInterval: isBeyanJobRunning ? 5000 : false,
  });

  useEffect(() => {
    if (!latestBeyanJob || latestBeyanJob.status === 'pending') return;
    qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
    qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
  }, [qc, latestBeyanJob?.id, latestBeyanJob?.status, latestBeyanJob?.finishedAt, latestBeyanJob?.recordCount]);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    setPreviewPortalReady(true);
  }, []);

  useEffect(() => {
    if (!pdfPreview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [pdfPreview]);

  const deleteMut = useMutation({
    mutationFn: (id: string) => beyanKayitlariApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
      toast.success('Kayıt silindi');
    },
    onError: (e: any) => toast.error(e?.message || 'Silinemedi'),
  });

  const pullMut = useMutation({
    mutationFn: (force?: boolean) => portalAutomationApi.manualRun({
      scope: 'beyanname',
      jobTypes: ['EBEYANNAME_DAILY_DOWNLOAD'],
      dateFrom: pullFrom,
      dateTo: pullTo,
      force: force === true,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['portal-automation-summary'] });
      const created = res.created?.length || 0;
      if (created > 0) {
        toast.success(`${created} e-Beyanname işi kuyruğa alındı${res.runnerWake ? ' ve sunucu uyandırıldı' : ''}.`);
      } else {
        toast.info(res.message || 'Yeni e-Beyanname işi oluşmadı.');
      }
    },
    onError: (e: any) => toast.error(e?.message || 'e-Beyanname çekme işi başlatılamadı'),
  });

  const cancelJobMut = useMutation({
    mutationFn: (id: string) => portalAutomationApi.cancelJob(id, 'Kullanici Beyannameler ekranindan iptal etti'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-automation-summary'] });
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
      toast.info('e-Beyanname isi iptal edildi');
    },
    onError: (e: any) => toast.error(e?.message || 'Is iptal edilemedi'),
  });

  const nightlyMut = useMutation({
    mutationFn: () => portalAutomationApi.nightlyRunNow(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['portal-automation-summary'] });
      toast.success(`${res.created?.length || 0} gece işi kuyruğa alındı`);
      if (res.skipped?.length) toast.warning(`${res.skipped.length} iş atlandı`);
    },
    onError: (e: any) => toast.error(e?.message || 'Gece akışı başlatılamadı'),
  });

  // Mükellef dropdown'u: TÜM aktif mükellefleri /taxpayers'tan çek
  const { data: allTaxpayers = [] } = useQuery<any[]>({
    queryKey: ['taxpayers-for-beyanname-filter'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data || []),
  });

  const taxpayerOptions = useMemo(() => {
    const list = (allTaxpayers || []).map((t: any) => ({
      id: t.id,
      name: t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)',
      taxNumber: t.taxNumber || '',
    }));
    // Beyanname kayıtlarından da fallback ekle (filtreyle eşleşsin diye)
    for (const row of kayitlar) {
      if (!row.taxpayerId || list.some((x) => x.id === row.taxpayerId)) continue;
      list.push({
        id: row.taxpayerId,
        name: beyanKaydiMukellefAdi(row),
        taxNumber: row.taxpayer?.taxNumber || '',
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [allTaxpayers, kayitlar]);

  const periodOptions = useMemo(() => {
    const fromRecords = new Set(kayitlar.map((k) => k.donem).filter(Boolean));
    // İleri 12 ay + bu ay + geçmiş 36 ay (vergi planlaması için ileri dönem seçilebilsin)
    const now = new Date();
    for (let i = -12; i <= 36; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      fromRecords.add(`${yyyy}-${mm}`);
    }
    // Yıllık dönemler de eklensin (Kurumlar/Gelir/Yıllık beyan için)
    for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 1; y++) {
      fromRecords.add(`${y}-YIL`);
    }
    return Array.from(fromRecords).sort((a, b) => periodSortValue(b) - periodSortValue(a));
  }, [kayitlar]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    return kayitlar
      .filter((k) => {
        if (selectedTaxpayer !== 'all' && k.taxpayerId !== selectedTaxpayer) return false;
        if (!declarationTypeMatches(k, typeFilter)) return false;
        if (!periodInRange(k.donem, periodStart, periodEnd)) return false;
        if (docFilter === 'beyanname' && !k.beyannameUrl) return false;
        if (docFilter === 'tahakkuk' && !k.pdfUrl) return false;
        // Durum filtresi — onayNo / beyannameUrl mevcudiyetine göre best-effort
        // (OKUNAN/OKUNMAYAN ve SMS alanları henüz veri modelinde yok; eklendiğinde buraya bağlanacak)
        if (durumFilter === 'gonderilen' && !(k.onayNo || k.beyannameUrl)) return false;
        if (durumFilter === 'gonderilmeyen' && (k.onayNo || k.beyannameUrl)) return false;
        if (durumFilter === 'okunan' && !(k.onayNo && k.beyannameUrl)) return false;
        if (durumFilter === 'okunmayan' && (k.onayNo && k.beyannameUrl)) return false;
        if (durumFilter === 'sms_gonderilen' && !(k.taxpayer?.phone || (k.taxpayer?.phones && k.taxpayer.phones.length))) return false;
        if (durumFilter === 'sms_gonderilmeyen' && (k.taxpayer?.phone || (k.taxpayer?.phones && k.taxpayer.phones.length))) return false;
        if (!q) return true;
        const haystack = [
          beyanKaydiMukellefAdi(k),
          k.taxpayer?.taxNumber,
          k.onayNo,
          k.donem,
          declarationTypeLabel(k),
          declarationTypeCode(k),
          k.beyanTipi,
        ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
        return haystack.includes(q);
      })
      .sort((a, b) => {
        const ad = new Date(a.beyanTarihi || a.createdAt || 0).getTime();
        const bd = new Date(b.beyanTarihi || b.createdAt || 0).getTime();
        if (bd !== ad) return bd - ad;
        return periodSortValue(b.donem) - periodSortValue(a.donem);
      });
  }, [kayitlar, search, selectedTaxpayer, typeFilter, docFilter, durumFilter, periodStart, periodEnd]);

  const tableRows = useMemo<BeyanTableRow[]>(() => {
    return filtered.flatMap((row) => {
      const rows: BeyanTableRow[] = [];
      if (docFilter !== 'tahakkuk') {
        rows.push({ key: `${row.id}:beyanname`, row, kind: 'beyanname', tur: 'EBeyanname', hasFile: !!row.beyannameUrl });
      }
      if (docFilter !== 'beyanname') {
        rows.push({ key: `${row.id}:tahakkuk`, row, kind: 'tahakkuk', tur: 'Tahakkuk', hasFile: !!row.pdfUrl });
      }
      return rows;
    });
  }, [filtered, docFilter]);

  const missingFileStats = useMemo(() => {
    const beyanname = filtered.filter((row) => !row.beyannameUrl).length;
    const tahakkuk = filtered.filter((row) => !row.pdfUrl).length;
    const both = filtered.filter((row) => !row.beyannameUrl && !row.pdfUrl).length;
    return { beyanname, tahakkuk, both };
  }, [filtered]);

  const selectedTableRows = useMemo(
    () => tableRows.filter((item) => selectedDocKeys.has(item.key)),
    [tableRows, selectedDocKeys],
  );

  const selectedUniqueRows = useMemo(() => {
    const seen = new Set<string>();
    return selectedTableRows
      .map((item) => item.row)
      .filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      });
  }, [selectedTableRows]);

  useEffect(() => {
    const visible = new Set(tableRows.map((item) => item.key));
    setSelectedDocKeys((prev) => {
      const next = new Set(Array.from(prev).filter((key) => visible.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [tableRows]);

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => beyanKayitlariApi.bulkDeleteIds(ids),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
      toast.success(`${res.deleted} kayıt temizlendi`);
    },
    onError: (e: any) => toast.error(e?.message || 'Kayıtlar temizlenemedi'),
  });

  const clearVisibleRecords = () => {
    const ids = filtered.map((row) => row.id).filter(Boolean);
    if (ids.length === 0) {
      toast.info('Temizlenecek görünür kayıt yok');
      return;
    }
    if (confirm(`Ekranda görünen ${ids.length} beyanname kaydı silinsin mi?`)) {
      bulkDeleteMut.mutate(ids);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setDocFilter('all');
    setDurumFilter('all');
    setSelectedTaxpayer('all');
    setPeriodStart('');
    setPeriodEnd('');
  };

  const previewTitle = (row: BeyanKaydi, kind: BeyanDocKind) =>
    `${beyanKaydiMukellefAdi(row)} - ${declarationTypeCode(row)} - ${fmtDonemHattat(row.donem)} - ${kind === 'beyanname' ? 'Beyanname' : 'Tahakkuk'}`;

  const closePdfPreview = () => {
    if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
    pdfPreviewUrlRef.current = null;
    setPdfPreview(null);
  };

  const showPdfPreview = (blob: Blob, row: BeyanKaydi, kind: BeyanDocKind) => {
    if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
    const url = URL.createObjectURL(blob);
    const docKey = `${row.id}:${kind}`;
    pdfPreviewUrlRef.current = url;
    setViewedDocKeys((prev) => new Set(prev).add(docKey));
    setPdfPreview({
      url,
      docKey,
      title: previewTitle(row, kind),
      subtitle: kind === 'tahakkuk'
        ? `${beyanMahiyeti(row)} · ${fmtDate(row.beyanTarihi || row.createdAt)} · ${fmtCurrency(row.tahakkukTutari)}`
        : `${beyanMahiyeti(row)} · ${fmtDate(row.beyanTarihi || row.createdAt)}`,
    });
  };

  const openDocument = (row: BeyanKaydi, kind: 'beyanname' | 'tahakkuk' = 'beyanname') => {
    const url = kind === 'beyanname'
      ? (row.beyannameUrl ? beyanKayitlariApi.beyannameUrl(row.id) : row.pdfUrl ? beyanKayitlariApi.pdfUrl(row.id) : '')
      : (row.pdfUrl ? beyanKayitlariApi.pdfUrl(row.id) : row.beyannameUrl ? beyanKayitlariApi.beyannameUrl(row.id) : '');
    if (!url) {
      toast.warning('Bu kayıt için görüntülenecek PDF yok');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const fetchDocumentBlob = async (row: BeyanKaydi, kind: BeyanDocKind) => {
    const hasFile = kind === 'beyanname' ? !!row.beyannameUrl : !!row.pdfUrl;
    if (!hasFile) return null;
    const endpoint = kind === 'beyanname'
      ? `/beyan-kayitlari/${row.id}/beyanname`
      : `/beyan-kayitlari/${row.id}/pdf`;
    const res = await api.get(endpoint, { responseType: 'blob' });
    return res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'application/pdf' });
  };

  const openDocumentBlob = async (row: BeyanKaydi, kind: BeyanDocKind = 'beyanname') => {
    const blob = await fetchDocumentBlob(row, kind).catch((err) => {
      toast.error(err?.message || 'PDF acilamadi');
      return null;
    });
    if (!blob) {
      toast.warning(`${kind === 'beyanname' ? 'Beyanname' : 'Tahakkuk'} PDF yok`);
      return;
    }
    showPdfPreview(blob, row, kind);
  };

  const downloadDocument = async (item: BeyanTableRow) => {
    const blob = await fetchDocumentBlob(item.row, item.kind).catch(() => null);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${beyanKaydiMukellefAdi(item.row)}-${declarationTypeCode(item.row)}-${fmtDonemHattat(item.row.donem)}-${item.tur}.pdf`.replace(/[\\/:*?"<>|]/g, '_');
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleDocSelection = (key: string, checked?: boolean) => {
    setSelectedDocKeys((prev) => {
      const next = new Set(prev);
      const shouldSelect = checked ?? !next.has(key);
      if (shouldSelect) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const sendEmail = (row: BeyanKaydi) => {
    const email = taxpayerEmail(row);
    if (!email) {
      toast.warning('Mükellef kartında e-posta yok');
      return;
    }
    setSentEmailRows((prev) => new Set(prev).add(row.id));
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(declarationSubject(row))}&body=${encodeURIComponent(declarationMessage(row))}`;
  };

  const sendWhatsapp = (row: BeyanKaydi) => {
    const phone = whatsappPhone(taxpayerPhone(row));
    if (!phone) {
      toast.warning('Mükellef kartında telefon yok');
      return;
    }
    setSentWhatsappRows((prev) => new Set(prev).add(row.id));
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(declarationMessage(row))}`, '_blank', 'noopener,noreferrer');
  };

  const sendSms = (row: BeyanKaydi) => {
    const phone = taxpayerPhone(row).replace(/\s+/g, '');
    if (!phone) {
      toast.warning('Mükellef kartında telefon yok');
      return;
    }
    setSentSmsRows((prev) => new Set(prev).add(row.id));
    window.location.href = `sms:${phone}?body=${encodeURIComponent(declarationMessage(row))}`;
  };

  const exportCsv = () => {
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Mükellef', 'VKN/TCKN', 'Tip', 'Dönem', 'Beyan Tarihi', 'Onay No', 'Tahakkuk', 'Beyanname PDF', 'Tahakkuk PDF']
        .map(cell).join(';'),
      ...filtered.map((k) => [
        beyanKaydiMukellefAdi(k),
        k.taxpayer?.taxNumber || '',
        declarationTypeLabel(k),
        k.donem,
        fmtDate(k.beyanTarihi),
        k.onayNo || '',
        k.tahakkukTutari ?? '',
        k.beyannameUrl ? 'var' : 'yok',
        k.pdfUrl ? 'var' : 'yok',
      ].map(cell).join(';')),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beyanname-listesi-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-[1500px] space-y-4">
      {/* ===================== KOMUT KONSOLU ===================== */}
      <section
        className="relative overflow-hidden rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(17,22,28,0.96), rgba(10,12,16,0.99))',
          border: '1px solid rgba(76,198,245,0.16)',
          boxShadow: '0 24px 60px -32px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, #4cc6f5, #f4c451, transparent)', opacity: 0.8 }} />
        <div className="pointer-events-none absolute" style={{ width: 420, height: 420, left: -60, top: -220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(76,198,245,0.16), transparent 62%)' }} />
        <div className="pointer-events-none absolute" style={{ width: 420, height: 420, right: -80, top: -260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(244,196,81,0.10), transparent 62%)' }} />

        <div className="relative px-4 pt-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid flex-none place-items-center" style={{ width: 46, height: 46, borderRadius: 13, background: 'linear-gradient(150deg, rgba(76,198,245,0.22), rgba(76,198,245,0.05))', border: '1px solid rgba(76,198,245,0.3)' }}>
                <FileText size={22} style={{ color: '#bfe9ff' }} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.2em]" style={{ color: '#7fcdee' }}>e-Beyanname · GİB</div>
                <h1 className="text-[20px] font-bold tracking-[-0.02em]" style={{ color: '#f3f5f7' }}>Beyanname İndirme</h1>
                <p className="text-[11.5px]" style={{ color: 'rgba(243,245,247,0.4)' }}>Ajan, mali müşavir şifresiyle GİB&apos;den beyanname + tahakkukları indirir.</p>
              </div>
            </div>

            <div className="flex-1" />

            <div className="flex flex-wrap items-stretch gap-2">
              <div className="flex items-center overflow-hidden rounded-[11px]" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)' }}>
                <label className="flex flex-col gap-px px-3 py-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: 'rgba(243,245,247,0.4)' }}>Başlangıç</span>
                  <input type="date" value={pullFrom} onChange={(e) => setPullFrom(e.target.value)} className="bg-transparent text-[13px] font-semibold outline-none" style={{ color: '#f3f5f7', colorScheme: 'dark' }} />
                </label>
                <div className="self-stretch" style={{ width: 1, background: 'rgba(255,255,255,0.07)' }} />
                <label className="flex flex-col gap-px px-3 py-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: 'rgba(243,245,247,0.4)' }}>Bitiş</span>
                  <input type="date" value={pullTo} onChange={(e) => setPullTo(e.target.value)} className="bg-transparent text-[13px] font-semibold outline-none" style={{ color: '#f3f5f7', colorScheme: 'dark' }} />
                </label>
              </div>
              <button
                type="button"
                onClick={() => pullMut.mutate(false)}
                disabled={pullMut.isPending}
                className="inline-flex h-[46px] items-center justify-center gap-2 rounded-[11px] px-[18px] text-[13.5px] font-bold"
                style={{ background: 'linear-gradient(135deg, #f4c451, #e0a93c)', color: '#1a1407', boxShadow: '0 12px 26px -12px rgba(244,196,81,0.6)', opacity: pullMut.isPending ? 0.65 : 1 }}
              >
                {pullMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                Beyannameleri Çek
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Bu tarih aralığındaki TÜM beyannameler (zaten inmiş olanlar dahil) yeniden indirilecek; PDF ve tahakkuk tutarı yenilenir. "Tutar okunamadı" / eksik PDF kayıtlarını düzeltir. Tarih aralığını dar tutman önerilir. Devam edilsin mi?')) {
                    pullMut.mutate(true);
                  }
                }}
                disabled={pullMut.isPending}
                title="Yenile (force) — var olanları da yeniden indir, Tutar okunamadı / eksik PDF kayıtlarını düzeltir"
                className="inline-flex h-[46px] w-[46px] items-center justify-center rounded-[11px]"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(243,245,247,0.62)' }}
              >
                {pullMut.isPending ? <Loader2 size={17} className="animate-spin" /> : <RotateCcw size={17} />}
              </button>
            </div>
          </div>

          {/* canlı durum: son iş + runner/şifre */}
          <div className="mt-3.5 flex flex-wrap items-center gap-3 py-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <ConsoleJob
              job={latestBeyanJob}
              onCancel={isBeyanJobActive && latestBeyanJob ? () => cancelJobMut.mutate(latestBeyanJob.id) : undefined}
              cancelPending={cancelJobMut.isPending}
            />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'rgba(243,245,247,0.62)' }}>
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: portalSummary?.runner?.enabled ? '#4ade80' : '#fb7185', boxShadow: `0 0 0 3px ${portalSummary?.runner?.enabled ? 'rgba(74,222,128,0.16)' : 'rgba(251,113,133,0.16)'}` }} /> Runner
              </span>
              <span className="inline-flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'rgba(243,245,247,0.62)' }}>
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: portalSummary?.credentials.eBeyannameReady ? '#4ade80' : '#fb7185', boxShadow: `0 0 0 3px ${portalSummary?.credentials.eBeyannameReady ? 'rgba(74,222,128,0.16)' : 'rgba(251,113,133,0.16)'}` }} /> Şifre
              </span>
              <Link href="/panel/ayarlar" className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] px-3 text-[12px] font-semibold" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(243,245,247,0.62)' }}>
                <KeyRound size={13} /> Şifre Ayarları
              </Link>
            </div>
          </div>
        </div>

        {isBeyanJobActive && (
          <div className="relative mt-1 h-[3px] overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <div className="absolute inset-y-0 left-0 transition-all" style={{ width: `${Math.max(6, Math.min(100, portalJobProgress(latestBeyanJob).pct ?? (isBeyanJobRunning ? 45 : 12)))}%`, background: 'linear-gradient(90deg, #4cc6f5, #f4c451)' }} />
          </div>
        )}
      </section>

      {/* ===================== FİLTRE ŞERİDİ ===================== */}
      <section className="flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', overflow: 'visible' }}>
        <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-[10px] px-3" style={{ height: 44, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <Search size={15} style={{ color: 'rgba(243,245,247,0.4)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mükellef, VKN, onay no ara…" className="w-full bg-transparent text-[13px] outline-none" style={{ color: '#f3f5f7' }} />
        </label>
        <div className="min-w-[170px] flex-1">
          <SelectBox icon={UserRound} value={selectedTaxpayer} onChange={setSelectedTaxpayer}>
            <option value="all">Tüm mükellefler</option>
            {taxpayerOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </SelectBox>
        </div>
        <div className="min-w-[140px]">
          <SelectBox icon={Filter} value={typeFilter} onChange={(v) => setTypeFilter(v as FilterKey)}>
            {FILTER_KEYS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </SelectBox>
        </div>
        <div className="min-w-[140px]">
          <SelectBox icon={FileText} value={docFilter} onChange={(v) => setDocFilter(v as BelgeFilter)}>
            <option value="all">Tür Seçiniz</option>
            <option value="beyanname">Beyanname</option>
            <option value="tahakkuk">Tahakkuk</option>
          </SelectBox>
        </div>
        <div className="min-w-[150px]">
          <SelectBox icon={CheckCircle2} value={durumFilter} onChange={(v) => setDurumFilter(v as DurumFilter)}>
            <option value="all">Durum Seçiniz</option>
            <option value="gonderilen">GÖNDERİLENLER</option>
            <option value="gonderilmeyen">GÖNDERİLMEYENLER</option>
            <option value="okunan">OKUNANLAR</option>
            <option value="okunmayan">OKUNMAYANLAR</option>
            <option value="sms_gonderilen">SMS GÖNDERİLENLER</option>
            <option value="sms_gonderilmeyen">SMS GÖNDERİLMEYENLER</option>
          </SelectBox>
        </div>
        <div className="flex items-center gap-1 overflow-hidden rounded-[10px] px-2.5" style={{ height: 44, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)' }} title="Beyanname dönem aralığı">
          <CalendarDays size={15} style={{ color: 'rgba(243,245,247,0.4)' }} className="shrink-0" />
          <input type="month" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} aria-label="Dönem başlangıç" className="bg-transparent text-[12.5px] font-semibold outline-none" style={{ color: '#f3f5f7', colorScheme: 'dark', width: 118 }} />
          <span className="shrink-0" style={{ color: 'rgba(243,245,247,0.3)' }}>–</span>
          <input type="month" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} aria-label="Dönem bitiş" className="bg-transparent text-[12.5px] font-semibold outline-none" style={{ color: '#f3f5f7', colorScheme: 'dark', width: 118 }} />
        </div>
        <button
          type="button"
          onClick={clearFilters}
          className="inline-flex items-center justify-center rounded-[10px] px-3"
          style={{ height: 44, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(243,245,247,0.68)' }}
          title="Filtreleri temizle"
        >
          <RotateCcw size={16} />
        </button>
      </section>

      <section className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: '#fafaf9' }}>Beyanname Listesi</h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Tarihe göre yeni kayıtlar üstte gösterilir. Satır aksiyonları doğrudan mükellef iletişim bilgilerini kullanır.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-[13px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Loader2 size={18} className="animate-spin mx-auto mb-3" /> Kayıtlar yükleniyor...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <FileQuestion size={34} className="mx-auto mb-3" style={{ color: 'rgba(250,250,249,0.24)' }} />
            <p className="text-[14px] font-semibold" style={{ color: 'rgba(250,250,249,0.78)' }}>Henüz indirilmiş beyanname yok</p>
            <p className="text-[12.5px] mt-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              Üstteki <b style={{ color: GOLD }}>Beyannameleri Çek</b> ile mali müşavir şifresiyle e-Beyanname sisteminden indirin.
            </p>
            <button type="button" onClick={clearFilters} className="mt-3 text-[12.5px] font-semibold" style={{ color: GOLD }}>
              Filtreleri temizle
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-[13px]">
              <thead style={{ background: 'rgba(255,255,255,0.025)' }}>
                <tr className="text-left uppercase tracking-[.12em] text-[10.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  <th className="px-3 py-3 w-[42px]">
                    <input
                      type="checkbox"
                      checked={tableRows.length > 0 && selectedDocKeys.size === tableRows.length}
                      onChange={(e) => setSelectedDocKeys(e.target.checked ? new Set(tableRows.map((item) => item.key)) : new Set())}
                    />
                  </th>
                  <th className="px-3 py-3">Mukellef</th>
                  <th className="px-3 py-3 w-[150px] whitespace-nowrap">Beyanname Donemi</th>
                  <th className="px-3 py-3">Beyanname Turu</th>
                  <th className="px-3 py-3">Belge Mahiyeti</th>
                  <th className="px-3 py-3">Tur</th>
                  <th className="px-3 py-3">Tutar</th>
                  <th className="px-3 py-3 w-[140px] text-right">Durum</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((item) => {
                  const row = item.row;
                  const mahiyet = beyanMahiyeti(row);
                  const viewed = viewedDocKeys.has(item.key);
                  const hasEmail = !!taxpayerEmail(row);
                  const hasPhone = !!taxpayerPhone(row);
                  const emailSent = sentEmailRows.has(row.id);
                  const whatsappSent = sentWhatsappRows.has(row.id);
                  const smsSent = sentSmsRows.has(row.id);
                  return (
                    <tr key={item.key} style={{ borderTop: '1px solid rgba(255,255,255,0.055)' }}>
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedDocKeys.has(item.key)}
                          onChange={(e) => toggleDocSelection(item.key, e.target.checked)}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedTaxpayer(row.taxpayerId)}
                          className="text-left max-w-[260px]"
                          title="Bu mukellefe filtrele"
                        >
                          <div className="font-semibold truncate" style={{ color: '#fafaf9' }}>{beyanKaydiMukellefAdi(row)}</div>
                          <div className="text-[11.5px] font-mono mt-0.5" style={{ color: 'rgba(250,250,249,0.38)' }}>{row.taxpayer?.taxNumber || '-'}</div>
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="whitespace-nowrap font-semibold tabular-nums" style={{ color: '#fafaf9' }}>{fmtDonemHattat(row.donem)}</div>
                        <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.42)' }}>{fmtDate(row.beyanTarihi || row.createdAt)}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-semibold" style={{ color: '#fafaf9' }}>{declarationTypeCode(row)}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.42)' }}>{declarationTypeLabel(row)}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-[12.5px] font-semibold">
                          {mahiyet === 'DUZELTME' ? 'DUZELTME' : 'ASIL'}
                        </span>
                      </td>
                      <td className="px-3 py-3" style={{ color: '#fafaf9' }}>{item.tur}</td>
                      <td className="px-3 py-3">
                        {item.kind === 'tahakkuk' ? (
                          <>
                            <div className="font-semibold tabular-nums" style={{ color: row.tahakkukTutari != null ? '#fafaf9' : '#fcd34d' }}>
                              {row.tahakkukTutari != null ? fmtCurrency(row.tahakkukTutari) : 'Tutar okunamadi'}
                            </div>
                            <div className="text-[10.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.36)' }}>
                              Tahakkuk tutari
                            </div>
                          </>
                        ) : null}
                      </td>
                      <td className="w-[140px] px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton
                            label={item.hasFile ? (viewed ? 'Goruntulendi' : `${item.tur} goruntule`) : `${item.tur} PDF yok`}
                            icon={Eye}
                            tone={!item.hasFile ? 'muted' : viewed ? 'green' : 'rose'}
                            disabled={!item.hasFile}
                            onClick={() => openDocumentBlob(row, item.kind)}
                          />
                          <IconButton
                            label={!hasEmail ? 'E-posta yok' : emailSent ? 'E-posta hazirlandi' : 'E-posta gonder'}
                            icon={Mail}
                            tone={emailSent ? 'green' : 'mail'}
                            disabled={!hasEmail}
                            onClick={() => sendEmail(row)}
                          />
                          <IconButton
                            label={!hasPhone ? 'Telefon yok' : whatsappSent ? 'WhatsApp hazirlandi' : 'WhatsApp gonder'}
                            icon={MessageCircle}
                            tone={whatsappSent ? 'green' : 'whatsapp'}
                            disabled={!hasPhone}
                            onClick={() => sendWhatsapp(row)}
                          />
                          <IconButton
                            label={!hasPhone ? 'Telefon yok' : smsSent ? 'SMS hazirlandi' : 'SMS gonder'}
                            icon={MessageSquareText}
                            tone={smsSent ? 'green' : 'sms'}
                            disabled={!hasPhone}
                            onClick={() => sendSms(row)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-3 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.55)', borderTop: '1px solid rgba(255,255,255,0.055)' }}>
              Toplam {tableRows.length.toLocaleString('tr-TR')} belge satiri gosteriliyor.
              {(missingFileStats.beyanname > 0 || missingFileStats.tahakkuk > 0) && (
                <span style={{ color: '#fcd34d' }}>
                  {' '}PDF eksik: {missingFileStats.beyanname.toLocaleString('tr-TR')} beyanname, {missingFileStats.tahakkuk.toLocaleString('tr-TR')} tahakkuk{missingFileStats.both ? `, ${missingFileStats.both.toLocaleString('tr-TR')} tamamen bos kayit` : ''}.
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 px-4 pb-4">
              <button type="button" onClick={() => selectedTableRows[0] ? sendEmail(selectedTableRows[0].row) : toast.warning('Secili kayit yok')} className="inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px] font-semibold" style={{ background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.26)', color: '#86efac' }}>
                <Mail size={15} /> Secili Beyann. / Tahakk. E-Posta Gonder
              </button>
              <button type="button" onClick={() => selectedUniqueRows[0] ? sendEmail(selectedUniqueRows[0]) : toast.warning('Secili kayit yok')} className="inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px] font-semibold" style={{ background: 'rgba(56,189,248,0.13)', border: '1px solid rgba(56,189,248,0.28)', color: '#bae6fd' }}>
                <Mail size={15} /> Secilenlere Gonder
              </button>
              <button type="button" onClick={() => {
                const target = selectedTableRows.find((item) => item.kind === 'tahakkuk')?.row || selectedUniqueRows[0];
                target ? sendSms(target) : toast.warning('Secili kayit yok');
              }} className="inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px] font-semibold" style={{ background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.28)', color: '#fde68a' }}>
                <MessageSquareText size={15} /> Secili Tahakk. SMS Gonder
              </button>
              <button type="button" onClick={() => selectedUniqueRows[0] ? sendWhatsapp(selectedUniqueRows[0]) : toast.warning('Secili kayit yok')} className="inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px] font-semibold" style={{ background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.26)', color: '#86efac' }}>
                <MessageCircle size={15} /> WhatsApp Gonder
              </button>
              <button type="button" onClick={() => selectedTableRows[0] ? openDocumentBlob(selectedTableRows[0].row, selectedTableRows[0].kind) : toast.warning('Secili kayit yok')} className="inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px] font-semibold" style={{ background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.24)', color: '#e2e8f0' }}>
                <Printer size={15} /> Secilenleri Yazdir
              </button>
              <button type="button" onClick={() => selectedTableRows.forEach((item) => downloadDocument(item))} className="inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px] font-semibold" style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.24)', color: '#bae6fd' }}>
                <Download size={15} /> Secilenleri Indir ({selectedTableRows.length})
              </button>
              <button type="button" onClick={() => {
                const ids = Array.from(new Set(selectedUniqueRows.map((row) => row.id)));
                if (!ids.length) return toast.warning('Secili kayit yok');
                if (confirm(`${ids.length} kayit silinsin mi?`)) bulkDeleteMut.mutate(ids);
              }} className="inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px] font-semibold" style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.24)', color: '#fda4af' }}>
                <Trash2 size={15} /> Secilenleri Sil
              </button>
              <button type="button" onClick={() => setSelectedDocKeys(new Set())} className="rounded-[8px] px-3 py-2 text-[12.5px] font-semibold" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(250,250,249,0.72)' }}>
                Secimi Temizle
              </button>
            </div>
          </div>
        )}
      </section>

      {importModal && (
        <ImportModal
          onClose={() => setImportModal(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
            qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
          }}
        />
      )}

      {previewPortalReady && pdfPreview && createPortal((
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4"
          style={{ background: 'rgba(0,0,0,0.72)' }}
          onClick={closePdfPreview}
        >
          <div
            className="flex h-[min(92vh,900px)] w-full max-w-[1180px] flex-col overflow-hidden rounded-[10px]"
            style={{ background: '#12100d', border: '1px solid rgba(255,255,255,0.12)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold" style={{ color: '#fafaf9' }}>{pdfPreview.title}</div>
                <div className="mt-0.5 truncate text-[11.5px]" style={{ color: 'rgba(250,250,249,0.48)' }}>{pdfPreview.subtitle}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={pdfPreview.url}
                  download={`${pdfPreview.title}.pdf`.replace(/[\\/:*?"<>|]/g, '_')}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
                  title="PDF indir"
                  style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.24)', color: '#bae6fd' }}
                >
                  <Download size={15} />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    const frame = document.getElementById('beyan-pdf-preview') as HTMLIFrameElement | null;
                    frame?.contentWindow?.print();
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
                  title="Yazdir"
                  style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(250,250,249,0.72)' }}
                >
                  <Printer size={15} />
                </button>
                <button
                  type="button"
                  onClick={closePdfPreview}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
                  title="Kapat"
                  style={{ background: 'rgba(244,63,94,0.10)', border: '1px solid rgba(244,63,94,0.24)', color: '#fda4af' }}
                >
                  <IconX size={16} />
                </button>
              </div>
            </div>
            <iframe key={pdfPreview.docKey} id="beyan-pdf-preview" title={pdfPreview.title} src={pdfPreview.url} className="min-h-0 flex-1 bg-white" />
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

// Komut konsolu içinde kompakt "Son iş" göstergesi (ilerleme halkası + durum + iptal)
function ConsoleJob({ job, onCancel, cancelPending }: { job?: PortalJob; onCancel?: () => void; cancelPending?: boolean }) {
  if (!job) return null;
  const noRecords = job.status === 'done' && Number(job.recordCount || 0) === 0;
  const status = noRecords
    ? { label: 'Kayit yok', color: '#fbbf24', bg: 'rgba(251,191,36,0.16)' }
    : portalJobStatus(job.status);
  const progress = portalJobProgress(job);
  const active = job.status === 'running' || job.status === 'pending';
  const pct = Math.max(0, Math.min(100, progress.pct ?? (job.status === 'running' ? 45 : job.status === 'pending' ? 12 : 100)));
  const sub = active
    ? (progress.message || (job.status === 'pending' ? 'Kuyrukta bekliyor' : 'Islem suruyor'))
    : job.errorMessage ? job.errorMessage.slice(0, 90)
    : noRecords ? 'Bu aralikta indirilecek kayit yok'
    : `${Number(job.recordCount || 0).toLocaleString('tr-TR')} islem · ${fmtDateTime(job.createdAt)}`;
  return (
    <div className="my-1 flex items-center gap-3 rounded-[13px] px-3 py-2" style={{ background: 'rgba(76,198,245,0.06)', border: '1px solid rgba(76,198,245,0.18)', minWidth: 230 }}>
      <div className="grid flex-none place-items-center" style={{ width: 34, height: 34, borderRadius: '50%', background: `conic-gradient(${active ? '#4cc6f5' : '#4ade80'} 0 ${pct}%, rgba(255,255,255,0.08) ${pct}% 100%)` }}>
        <span className="grid place-items-center" style={{ width: 26, height: 26, borderRadius: '50%', background: '#0c1117', fontSize: 9.5, fontWeight: 800, color: active ? '#bfe9ff' : '#86efac' }}>
          {active ? `%${Math.round(pct)}` : (noRecords ? '0' : '✓')}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <b className="text-[12.5px]" style={{ color: '#f3f5f7' }}>Son is</b>
          <span className="rounded-[6px] px-[7px] py-[2px] text-[9.5px] font-extrabold tracking-[0.06em]" style={{ background: status.bg, color: status.color }}>{status.label}</span>
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={cancelPending} className="inline-flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[10px] font-bold disabled:opacity-50" style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.28)', color: '#fca5a5' }}>
              {cancelPending ? <Loader2 size={10} className="animate-spin" /> : <IconX size={10} />} Iptal
            </button>
          )}
        </div>
        <div className="truncate text-[11px]" style={{ color: 'rgba(243,245,247,0.42)', maxWidth: 300 }}>
          {sub}{active && progress.current != null && progress.total != null ? ` · ${progress.current}/${progress.total}` : ''}
        </div>
      </div>
    </div>
  );
}

function SelectBox({ icon: Icon, value, onChange, children }: { icon: any; value: string; onChange: (value: string) => void; children: ReactNode }) {
  // React children'i flat string'e çevir (array, sayı, undefined hepsini düzgün)
  const childrenToText = (node: any): string => {
    if (node == null || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(childrenToText).join('');
    if (typeof node === 'object' && node.props?.children !== undefined) return childrenToText(node.props.children);
    return '';
  };

  // Children içindeki <option> elementlerini parse et — dark dropdown için
  const items = useMemo(() => {
    const list: { value: string; label: string }[] = [];
    const walk = (node: any) => {
      if (node == null || node === false) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node === 'object' && node?.type === 'option') {
        list.push({
          value: String(node.props?.value ?? ''),
          label: childrenToText(node.props?.children).trim(),
        });
      } else if (typeof node === 'object' && node?.props?.children) {
        walk(node.props.children);
      }
    };
    walk(children);
    return list;
  }, [children]);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentLabel = items.find((it) => it.value === value)?.label || items[0]?.label || '—';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-11 pl-9 pr-8 rounded-[10px] text-[13px] font-semibold outline-none text-left flex items-center"
        style={{ background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
      >
        <Icon size={15} className="absolute left-3 pointer-events-none" style={{ color: 'rgba(250,250,249,0.38)' }} />
        <span className="truncate">{currentLabel}</span>
        <svg className="absolute right-2.5 pointer-events-none" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="rgba(250,250,249,0.55)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute mt-1 max-h-[320px] overflow-y-auto rounded-[10px] py-1"
          style={{
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 9999,
            background: '#1c1813',
            border: '1px solid rgba(212,184,118,0.32)',
            boxShadow: '0 12px 36px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.4)',
          }}
        >
          {items.length === 0 ? (
            <div className="px-3 py-2 text-[12px]" style={{ color: 'rgba(250,250,249,0.45)' }}>Liste boş</div>
          ) : (
            items.map((it) => {
              const active = it.value === value;
              return (
                <button
                  key={it.value}
                  type="button"
                  onClick={() => { onChange(it.value); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-[12.5px] flex items-center justify-between transition"
                  style={{
                    background: active ? 'rgba(212,184,118,0.12)' : 'transparent',
                    color: active ? '#d4b876' : '#fafaf9',
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span className="truncate">{it.label}</span>
                  {active && <span style={{ color: '#d4b876' }}>✓</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function DocButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 rounded-md text-[11px] font-semibold"
      style={{
        background: active ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.035)',
        border: `1px solid ${active ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.08)'}`,
        color: active ? '#86efac' : 'rgba(250,250,249,0.38)',
      }}
    >
      {active ? '✓ ' : '– '}{label}
    </button>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
  danger,
  disabled,
  tone = 'default',
}: {
  label: string;
  icon: any;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'green' | 'rose' | 'muted' | 'mail' | 'whatsapp' | 'sms';
}) {
  const tones = {
    default: { background: 'rgba(255,255,255,0.035)', border: 'rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.72)' },
    green: { background: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.28)', color: '#86efac' },
    rose: { background: 'rgba(244,63,94,0.10)', border: 'rgba(244,63,94,0.25)', color: '#fda4af' },
    muted: { background: 'rgba(255,255,255,0.025)', border: 'rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.28)' },
    mail: { background: 'rgba(56,189,248,0.11)', border: 'rgba(56,189,248,0.28)', color: '#7dd3fc' },
    whatsapp: { background: 'rgba(34,197,94,0.11)', border: 'rgba(34,197,94,0.28)', color: '#86efac' },
    sms: { background: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.30)', color: '#fcd34d' },
  } as const;
  const c = danger ? { background: 'rgba(244,63,94,0.08)', border: 'rgba(244,63,94,0.22)', color: '#fb7185' } : tones[tone];
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]"
      style={{
        background: c.background,
        border: `1px solid ${c.border}`,
        color: c.color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.62 : 1,
      }}
    >
      <Icon size={14} strokeWidth={2.2} />
    </button>
  );
}

function LegacyBeyannamelerPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [importModal, setImportModal] = useState(false);

  const { data: kayitlar = [], isLoading } = useQuery<BeyanKaydi[]>({
    queryKey: ['beyan-kayitlari', filter],
    queryFn: () => beyanKayitlariApi.list({
      beyanTipi: filter === 'all' ? undefined : filter,
      limit: 1000,
    }),
  });

  const { data: ozet } = useQuery({
    queryKey: ['beyan-kayitlari-ozet'],
    queryFn: () => beyanKayitlariApi.ozet(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => beyanKayitlariApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
      qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
      toast.success('Kayıt silindi');
    },
    onError: (e: any) => toast.error(e?.message || 'Silinemedi'),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return kayitlar;
    return kayitlar.filter((k) => {
      const hay = `${beyanKaydiMukellefAdi(k)} ${k.taxpayer?.taxNumber || ''} ${k.onayNo || ''} ${k.donem} ${k.beyanTipi}`.toLowerCase();
      return hay.includes(q);
    });
  }, [kayitlar, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: kayitlar.length };
    for (const k of kayitlar) c[k.beyanTipi] = (c[k.beyanTipi] || 0) + 1;
    return c;
  }, [kayitlar]);

  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5 flex-wrap gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Belgeler</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>Beyannameler</h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Hattat'tan veya başka kaynaktan PDF klasörünü yükle, her beyanname otomatik parse edilip arşivlenir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setImportModal(true)}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
          >
            <FolderUp size={15} /> PDF Klasörü Aktar
          </button>
        </div>
      </div>

      {/* ÖZET KARTLARI — rakamsal tutar yok, sadece sayım */}
      {ozet && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <OzetCard label="Toplam Beyanname" value={ozet.toplam.toLocaleString('tr-TR')} icon={FileText} />
          <OzetCard label="KDV Kayıtları" value={(ozet.byTip.KDV1 || 0) + (ozet.byTip.KDV2 || 0)} icon={FileText} />
          <OzetCard label="MUHSGK Kayıtları" value={ozet.byTip.MUHSGK || 0} icon={FileText} />
          <OzetCard label="Geçici Vergi" value={(ozet.byTip.GECICI_VERGI || 0) + (ozet.byTip.GGECICI || 0) + (ozet.byTip.KGECICI || 0)} icon={FileText} />
        </div>
      )}

      <PortalAutomationPanel focus="beyanname" />

      {/* ARAMA + FİLTRELER */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mükellef, VKN, onay no, dönem ara..."
            className="w-full pl-10 pr-3 py-2.5 text-[13px] rounded-[10px] outline-none"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {FILTER_KEYS.map((f) => {
            const active = filter === f.key;
            const count = counts[f.key] || 0;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="text-[11.5px] font-medium px-3 py-1.5 rounded-md transition-all"
                style={{
                  background: active ? 'rgba(212,184,118,0.16)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${active ? 'rgba(212,184,118,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  color: active ? GOLD : 'rgba(250,250,249,0.65)',
                }}
              >
                {f.label} {count > 0 && <span className="opacity-60 ml-0.5">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* LİSTE */}
      {isLoading && <div className="text-stone-500 text-sm">Yükleniyor...</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="rounded-xl p-16 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <FileText className="w-12 h-12 mx-auto mb-4" style={{ color: 'rgba(250,250,249,0.2)' }} />
          <p className="text-[14px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
            {search || filter !== 'all' ? 'Filtreye uyan kayıt yok.' : 'Henüz beyanname kaydedilmemiş.'}
          </p>
          {kayitlar.length === 0 && (
            <button
              onClick={() => setImportModal(true)}
              className="mt-4 text-[13px] font-semibold"
              style={{ color: GOLD }}
            >
              + Hattat'tan PDF klasörü yükle
            </button>
          )}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <table className="w-full text-[13px]" style={{ color: 'rgba(250,250,249,0.85)' }}>
            <thead style={{ background: 'rgba(184,160,111,0.08)' }}>
              <tr className="text-left text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: 'rgba(250,250,249,0.55)' }}>
                <th className="px-4 py-3">Mükellef</th>
                <th className="px-4 py-3">Tip</th>
                <th className="px-4 py-3">Dönem</th>
                <th className="px-4 py-3">Onay No</th>
                <th className="px-4 py-3">Beyanname</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k) => (
                <tr key={k.id} className="group" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium truncate max-w-[260px]" style={{ color: '#fafaf9' }}>
                      {beyanKaydiMukellefAdi(k)}
                    </div>
                    <div className="text-[11px] font-mono" style={{ color: 'rgba(250,250,249,0.4)' }}>
                      {k.taxpayer?.taxNumber}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-[11px] font-semibold px-2 py-[3px] rounded-md" style={{ background: 'rgba(212,184,118,0.12)', color: GOLD, border: '1px solid rgba(212,184,118,0.25)' }}>
                      {declarationTypeLabel(k)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[12.5px]">{fmtDonem(k.donem)}</td>
                  <td className="px-4 py-2.5 text-[12px] font-mono" style={{ color: 'rgba(250,250,249,0.55)' }}>
                    {k.onayNo || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 text-[11px]">
                      {k.beyannameUrl ? (
                        <a
                          href={beyanKayitlariApi.beyannameUrl(k.id)}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-1 px-2 py-[3px] rounded-md"
                          style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}
                        >
                          <FileText size={11} /> Beyanname
                        </a>
                      ) : (
                        <span className="text-[10.5px] italic" style={{ color: 'rgba(250,250,249,0.35)' }}>—</span>
                      )}
                      {k.pdfUrl && (
                        <a
                          href={beyanKayitlariApi.pdfUrl(k.id)}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-1 px-2 py-[3px] rounded-md"
                          style={{ background: 'rgba(212,184,118,0.1)', color: GOLD, border: '1px solid rgba(212,184,118,0.25)' }}
                        >
                          <FileText size={11} /> Tahakkuk
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={() => {
                          if (confirm(`Bu kaydı silmek istediğine emin misin?\n\n${beyanKaydiMukellefAdi(k)} · ${declarationTypeLabel(k)} · ${fmtDonem(k.donem)}`)) {
                            deleteMut.mutate(k.id);
                          }
                        }}
                        className="p-1.5 rounded-md hover:bg-rose-500/10"
                        style={{ color: 'rgba(244,63,94,0.7)' }}
                        title="Sil"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* IMPORT MODAL */}
      {importModal && (
        <ImportModal onClose={() => setImportModal(false)} onDone={() => {
          qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
          qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
        }} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ÖZET KARTI
// ════════════════════════════════════════════════════════════
function OzetCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: any }) {
  return (
    <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(212,184,118,0.1)', border: '1px solid rgba(212,184,118,0.25)', color: GOLD }}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</div>
        <div className="text-[18px] font-semibold tabular-nums mt-0.5" style={{ color: '#fafaf9', fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// IMPORT MODAL — klasör/dosya yükleme + AI parse progress
// ════════════════════════════════════════════════════════════
function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  type Mod = 'zip' | 'pdf';
  const [mode, setMode] = useState<Mod>('zip');
  const [files, setFiles] = useState<File[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [zipOzet, setZipOzet] = useState<{ mukellefBulundu: number; mukellefYok: number; kayitEklendi: number; mevcut: number; parseHatasi: number } | null>(null);
  const [eslesmeyenler, setEslesmeyenler] = useState<Array<{ klasor: string; hattatId: string; ad: string; pdfSayisi: number }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  const addFiles = (fl: FileList | null) => {
    if (!fl) return;
    const onlyPdf = Array.from(fl).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    setFiles((prev) => {
      const fileKey = (f: File) => `${((f as any).webkitRelativePath || f.name)}-${f.size}`;
      const existing = new Set(prev.map(fileKey));
      const fresh = onlyPdf.filter((f) => !existing.has(fileKey(f)));
      return [...prev, ...fresh];
    });
  };

  const start = async () => {
    if (mode === 'pdf' && files.length === 0) return;
    if (mode === 'zip' && !zipFile) return;
    setUploading(true);
    setProgress(0);
    setResults(null);
    setZipOzet(null);
    setEslesmeyenler([]);
    try {
      if (mode === 'zip' && zipFile) {
        const resp = await beyanKayitlariApi.importZip(zipFile, (p) => setProgress(p));
        setResults(resp.sonuclar);
        setZipOzet(resp.ozet);
        setEslesmeyenler(resp.eslesmeyenler);
        if (resp.ozet.kayitEklendi > 0) toast.success(`${resp.ozet.kayitEklendi} beyanname kaydı eklendi`);
        if (resp.ozet.mukellefYok > 0) toast.warning(`${resp.ozet.mukellefYok} mükellef eşleşmedi — aşağıda listelendi`);
      } else {
        const resp = await beyanKayitlariApi.importPdfs(files, (p) => setProgress(p));
        setResults(resp.results);
        const okCount = resp.results.filter((r) => r.durum === 'ok').length;
        const errCount = resp.results.filter((r) => r.durum !== 'ok').length;
        if (okCount > 0) toast.success(`${okCount} beyanname başarıyla eklendi`);
        if (errCount > 0) toast.warning(`${errCount} dosya işlenemedi — detay aşağıda`);
      }
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Yükleme başarısız');
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setFiles([]);
    setZipFile(null);
    setResults(null);
    setZipOzet(null);
    setEslesmeyenler([]);
    setProgress(0);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={uploading ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl flex flex-col overflow-hidden"
        style={{ background: '#11100c', border: '1px solid rgba(184,160,111,0.3)', maxHeight: '85vh' }}
      >
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 600, color: '#fafaf9' }}>PDF Klasörü Aktar</h3>
            <p className="text-[12px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              Hattat'tan indirdiğin tahakkuk fişi PDF'lerini toplu yükle. AI her dosyayı okuyup arşive kaydeder.
            </p>
          </div>
          <button onClick={onClose} disabled={uploading} className="p-1.5 rounded-md hover:bg-white/5 disabled:opacity-40" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <IconX size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!results && (
            <>
              {/* Mod sekmeleri — ZIP vs PDF */}
              <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                <button
                  type="button"
                  onClick={() => setMode('zip')}
                  className="flex-1 py-3 text-[13px] font-semibold transition inline-flex items-center justify-center gap-2"
                  style={{
                    background: mode === 'zip' ? 'rgba(212,184,118,0.14)' : 'transparent',
                    color: mode === 'zip' ? GOLD : 'rgba(250,250,249,0.55)',
                  }}
                >
                  <Archive size={15} /> Hattat ZIP (Önerilen)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('pdf')}
                  className="flex-1 py-3 text-[13px] font-semibold transition inline-flex items-center justify-center gap-2"
                  style={{
                    background: mode === 'pdf' ? 'rgba(212,184,118,0.14)' : 'transparent',
                    color: mode === 'pdf' ? GOLD : 'rgba(250,250,249,0.55)',
                    borderLeft: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <Sparkles size={15} /> PDF/Klasor (Hizli)
                </button>
              </div>

              {/* Açıklama */}
              {mode === 'zip' && (
                <div className="text-[12px] rounded-lg px-3 py-2.5" style={{ background: 'rgba(212,184,118,0.06)', border: '1px solid rgba(212,184,118,0.2)', color: 'rgba(250,250,249,0.75)' }}>
                  <strong style={{ color: GOLD }}>Hattat ZIP modu</strong> — Hattat'tan dönem bazlı indirdiğin ZIP dosyasını olduğu gibi yükle. Klasör yapısı ve dosya adlarından otomatik parse edilir. AI'a gerek yok, hızlı + doğru.
                </div>
              )}
              {mode === 'pdf' && (
                <div className="text-[12px] rounded-lg px-3 py-2.5" style={{ background: 'rgba(212,184,118,0.06)', border: '1px solid rgba(212,184,118,0.2)', color: 'rgba(250,250,249,0.75)' }}>
                  <strong style={{ color: GOLD }}>PDF modu</strong> — Tek tek PDF seçersin, Claude AI her birini okuyup parse eder. ZIP modu varsa ONU kullan — çok daha hızlı.
                </div>
              )}

              {/* ZIP MODU — tek dosya */}
              {mode === 'zip' && (
                <>
                  <div
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      const f = e.dataTransfer.files[0];
                      if (f && (/\.zip$/i.test(f.name) || f.type === 'application/zip')) setZipFile(f);
                    }}
                    onClick={() => zipRef.current?.click()}
                    className="rounded-xl p-8 text-center cursor-pointer transition-all"
                    style={{
                      background: zipFile ? 'rgba(34,197,94,0.06)' : 'rgba(212,184,118,0.04)',
                      border: `2px dashed ${zipFile ? 'rgba(34,197,94,0.4)' : 'rgba(212,184,118,0.35)'}`,
                    }}
                  >
                    <Archive className="w-12 h-12 mx-auto mb-3" style={{ color: zipFile ? '#22c55e' : GOLD }} />
                    {zipFile ? (
                      <>
                        <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>{zipFile.name}</p>
                        <p className="text-[12px] mt-1 tabular-nums" style={{ color: 'rgba(250,250,249,0.6)' }}>
                          {(zipFile.size / 1024 / 1024).toFixed(1)} MB · Yüklemeye hazır
                        </p>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setZipFile(null); }}
                          className="text-[11px] mt-2"
                          style={{ color: '#f43f5e' }}
                        >
                          Kaldır
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Hattat ZIP dosyasını buraya bırak</p>
                        <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
                          Örn. "2025 1. DÖNEM.zip" · Max 500 MB
                        </p>
                      </>
                    )}
                    <input
                      ref={zipRef}
                      type="file"
                      accept=".zip,application/zip,application/x-zip-compressed"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setZipFile(f);
                      }}
                    />
                  </div>
                </>
              )}

              {/* PDF MODU — mevcut */}
              {mode === 'pdf' && (<>
              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); addFiles(e.dataTransfer.files); }}
                className="rounded-xl p-8 text-center cursor-pointer transition-all"
                style={{
                  background: 'rgba(212,184,118,0.04)',
                  border: '2px dashed rgba(212,184,118,0.35)',
                }}
                onClick={() => inputRef.current?.click()}
              >
                <FolderUp className="w-12 h-12 mx-auto mb-3" style={{ color: GOLD }} />
                <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>
                  PDF dosyaları buraya sürükle
                </p>
                <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  veya aşağıdaki butonlardan seç — tek dosya veya tüm klasör
                </p>
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-md"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.85)' }}
                  >
                    <Upload size={13} /> Dosya Seç
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); folderRef.current?.click(); }}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-md"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.85)' }}
                  >
                    <FolderUp size={13} /> Klasör Seç
                  </button>
                </div>
                <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
                {/* webkitdirectory tipik olarak TS'de bilinmez; any cast ile */}
                <input
                  ref={folderRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                  // @ts-expect-error - webkitdirectory is non-standard but supported in Chromium/WebKit
                  webkitdirectory=""
                  directory=""
                />
              </div>

              {/* Dosya listesi */}
              {files.length > 0 && (
                <div className="rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span className="text-[12.5px] font-semibold" style={{ color: '#fafaf9' }}>
                      {files.length} PDF dosyası hazır
                    </span>
                    <button onClick={() => setFiles([])} className="text-[11px]" style={{ color: '#f43f5e' }}>Temizle</button>
                  </div>
                  <ul className="max-h-[200px] overflow-y-auto divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                    {files.slice(0, 50).map((f, i) => (
                      <li key={i} className="px-4 py-1.5 flex items-center justify-between text-[12px]" style={{ color: 'rgba(250,250,249,0.7)' }}>
                        <span className="truncate flex-1">{((f as any).webkitRelativePath || f.name) as string}</span>
                        <span className="text-[10.5px] font-mono ml-3" style={{ color: 'rgba(250,250,249,0.4)' }}>{(f.size / 1024).toFixed(0)} KB</span>
                      </li>
                    ))}
                    {files.length > 50 && (
                      <li className="px-4 py-1.5 text-center text-[11px] italic" style={{ color: 'rgba(250,250,249,0.4)' }}>
                        ... ve {files.length - 50} dosya daha
                      </li>
                    )}
                  </ul>
                </div>
              )}
              </>)}{/* end mode === 'pdf' */}
            </>
          )}

          {/* Upload progress */}
          {uploading && (
            <div className="rounded-xl p-4" style={{ background: 'rgba(212,184,118,0.06)', border: '1px solid rgba(212,184,118,0.25)' }}>
              <div className="flex items-center gap-3 mb-3">
                <Loader2 className="animate-spin" size={16} style={{ color: GOLD }} />
                <span className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
                  {progress < 100 ? `Yükleniyor: %${progress}` : 'AI dosyaları parse ediyor...'}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="h-full transition-all" style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${GOLD}aa, ${GOLD})` }} />
              </div>
              <p className="text-[11px] mt-2" style={{ color: 'rgba(250,250,249,0.5)' }}>
                {progress < 100
                  ? 'Dosyalar sunucuya gönderiliyor...'
                  : 'Her PDF Claude AI ile okunuyor, VKN/tip/dönem/tutar çıkarılıyor. Dosya başına ~3-5 saniye sürer.'}
              </p>
            </div>
          )}

          {/* ZIP özet kartları (zip modunda) */}
          {zipOzet && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11.5px]">
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: '#22c55e' }}>Eklendi</div>
                <div className="text-[18px] font-bold tabular-nums" style={{ color: '#22c55e' }}>{zipOzet.kayitEklendi}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(250,250,249,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: 'rgba(250,250,249,0.7)' }}>Zaten Var</div>
                <div className="text-[18px] font-bold tabular-nums" style={{ color: 'rgba(250,250,249,0.7)' }}>{zipOzet.mevcut}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: '#22c55e' }}>Mükellef Eşleşti</div>
                <div className="text-[18px] font-bold tabular-nums" style={{ color: '#22c55e' }}>{zipOzet.mukellefBulundu}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: '#f59e0b' }}>Mükellef Yok</div>
                <div className="text-[18px] font-bold tabular-nums" style={{ color: '#f59e0b' }}>{zipOzet.mukellefYok}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <div className="text-[10px] uppercase tracking-wider opacity-70" style={{ color: '#ef4444' }}>Parse Hatası</div>
                <div className="text-[18px] font-bold tabular-nums" style={{ color: '#ef4444' }}>{zipOzet.parseHatasi}</div>
              </div>
            </div>
          )}

          {/* Eşleşmeyen mükellefler listesi */}
          {eslesmeyenler.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.3)' }}>
              <div className="px-4 py-2.5" style={{ borderBottom: '1px solid rgba(245,158,11,0.2)' }}>
                <h4 className="text-[13px] font-semibold" style={{ color: '#f59e0b' }}>
                  ⚠ {eslesmeyenler.length} mükellef portalınızda eşleşmedi
                </h4>
                <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.55)' }}>
                  Bu mükellefleri ya portal'a eklemeniz ya da isim/VKN'sini Hattat'taki ile eşitlemeniz gerek:
                </p>
              </div>
              <ul className="max-h-[200px] overflow-y-auto divide-y text-[12px]" style={{ borderColor: 'rgba(245,158,11,0.1)' }}>
                {eslesmeyenler.map((e, i) => (
                  <li key={i} className="px-4 py-1.5 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate" style={{ color: '#fafaf9' }}>{e.ad}</div>
                      <div className="text-[10.5px] font-mono" style={{ color: 'rgba(250,250,249,0.4)' }}>Hattat ID: {e.hattatId}</div>
                    </div>
                    <span className="text-[10.5px] opacity-60 whitespace-nowrap" style={{ color: 'rgba(250,250,249,0.6)' }}>{e.pdfSayisi} PDF</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sonuç listesi */}
          {results && (
            <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <h4 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>İşlem Sonucu</h4>
                <div className="flex items-center gap-4 mt-2 text-[11.5px]">
                  <span className="flex items-center gap-1.5" style={{ color: '#22c55e' }}>
                    <CheckCircle2 size={13} /> {results.filter((r) => r.durum === 'ok').length} eklendi
                  </span>
                  <span className="flex items-center gap-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                    <FileQuestion size={13} /> {results.filter((r) => r.durum === 'mevcut').length} zaten var
                  </span>
                  <span className="flex items-center gap-1.5" style={{ color: '#f59e0b' }}>
                    <AlertCircle size={13} /> {results.filter((r) => r.durum === 'mukellef_yok').length} mükellef yok
                  </span>
                  <span className="flex items-center gap-1.5" style={{ color: '#ef4444' }}>
                    <FileX2 size={13} /> {results.filter((r) => r.durum === 'parse_hatasi' || r.durum === 'hata').length} hata
                  </span>
                </div>
              </div>
              <ul className="max-h-[300px] overflow-y-auto divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                {results.map((r, i) => (
                  <li key={i} className="px-4 py-2 text-[12px]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate" style={{ color: '#fafaf9' }}>{r.dosyaAdi}</div>
                        {r.parsed?.mukellefAdi && (
                          <div className="text-[10.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                            {r.parsed.mukellefAdi} · {r.parsed.beyanTipi || '?'} · {r.parsed.donem || '?'}
                          </div>
                        )}
                        {r.sebep && (
                          <div className="text-[10.5px] mt-0.5 italic" style={{ color: '#f59e0b' }}>{r.sebep}</div>
                        )}
                      </div>
                      <ResultBadge durum={r.durum} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {!results ? (
            <>
              <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                {mode === 'zip'
                  ? 'ZIP içeriği sunucuda açılır, klasör/dosya adları parse edilir — AI yok, saniyeler içinde biter.'
                  : 'Her PDF için Claude AI ~3-5 saniye sürer. 100 PDF = ~6-8 dakika.'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  disabled={uploading}
                  className="px-4 py-2 text-[12.5px] font-medium rounded-md disabled:opacity-40"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
                >
                  İptal
                </button>
                <button
                  onClick={start}
                  disabled={uploading || (mode === 'pdf' ? files.length === 0 : !zipFile)}
                  className="px-5 py-2 text-[12.5px] font-bold rounded-md disabled:opacity-40"
                  style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
                >
                  {uploading
                    ? 'Yükleniyor...'
                    : mode === 'zip'
                      ? (zipFile ? 'ZIP\'i İşle' : 'ZIP seçin')
                      : `${files.length} dosyayı yükle`}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={reset}
                className="px-4 py-2 text-[12.5px] font-medium rounded-md"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
              >
                Yeni Yükleme
              </button>
              <button
                onClick={onClose}
                className="px-5 py-2 text-[12.5px] font-bold rounded-md"
                style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
              >
                Kapat
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultBadge({ durum }: { durum: ImportResult['durum'] }) {
  const cfg: Record<ImportResult['durum'], { label: string; bg: string; color: string }> = {
    ok:             { label: 'Eklendi',       bg: 'rgba(34,197,94,0.1)',  color: '#22c55e' },
    mevcut:         { label: 'Zaten var',     bg: 'rgba(250,250,249,0.05)', color: 'rgba(250,250,249,0.6)' },
    mukellef_yok:   { label: 'Mükellef yok',  bg: 'rgba(245,158,11,0.1)', color: '#f59e0b' },
    parse_hatasi:   { label: 'Parse hatası',  bg: 'rgba(239,68,68,0.1)',  color: '#ef4444' },
    hata:           { label: 'Hata',          bg: 'rgba(239,68,68,0.1)',  color: '#ef4444' },
  };
  const c = cfg[durum];
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md flex-shrink-0" style={{ background: c.bg, color: c.color }}>
      {c.label}
    </span>
  );
}
