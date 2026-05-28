'use client';

import { useState, useMemo, useRef, useEffect, type ReactNode } from 'react';
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
  Search, Upload, Download, FileText, Trash2,
  CheckCircle2, AlertCircle, FileQuestion, Loader2, X as IconX,
  FolderUp, FileX2, Archive, Sparkles, Eye, Mail, MessageCircle,
  MessageSquareText, Filter, CalendarDays, UserRound, RotateCcw,
  Clock, ServerCog, KeyRound, Play,
} from 'lucide-react';
import { toast } from 'sonner';

const GOLD = '#d4b876';

type FilterKey = 'all' | BeyanTipi;
type BelgeFilter = 'all' | 'beyanname' | 'tahakkuk';
type DurumFilter = 'all' | 'gonderilen' | 'gonderilmeyen' | 'okunan' | 'okunmayan' | 'sms_gonderilen' | 'sms_gonderilmeyen';

const FILTER_KEYS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'KDV1', label: 'KDV1' },
  { key: 'KDV2', label: 'KDV2' },
  { key: 'MUHSGK', label: 'MUHSGK' },
  { key: 'DAMGA', label: 'Damga' },
  { key: 'POSET', label: 'Poşet' },
  { key: 'KURUMLAR', label: 'Kurumlar' },
  { key: 'GELIR', label: 'Gelir' },
  { key: 'GECICI_VERGI', label: 'Geçici V.' },
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
  const yearly = donem.match(/^(\d{4})-YIL$/);
  if (yearly) return Number(yearly[1]) * 100 + 12;
  return 0;
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

function whatsappPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `90${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `9${digits}`;
  return digits;
}

function declarationSubject(k: BeyanKaydi): string {
  return `${beyanKaydiMukellefAdi(k)} - ${BEYAN_TIPI_LABEL[k.beyanTipi]} - ${fmtDonem(k.donem)}`;
}

function declarationMessage(k: BeyanKaydi): string {
  const tutar = k.tahakkukTutari != null ? ` Tahakkuk: ${fmtCurrency(k.tahakkukTutari)}.` : '';
  return `${fmtDonem(k.donem)} dönemi ${BEYAN_TIPI_LABEL[k.beyanTipi]} kaydınız hazır.${tutar}`;
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

  const { data: portalSummary } = useQuery({
    queryKey: ['portal-automation-summary', 'beyanname-page'],
    queryFn: () => portalAutomationApi.summary(),
    refetchInterval: 8000,
  });

  const { data: kayitlar = [], isLoading } = useQuery<BeyanKaydi[]>({
    queryKey: ['beyan-kayitlari', 'redesign'],
    queryFn: () => beyanKayitlariApi.list({ limit: 1500 }),
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

  const pullMut = useMutation({
    mutationFn: () => portalAutomationApi.manualRun({
      scope: 'beyanname',
      jobTypes: ['EBEYANNAME_DAILY_DOWNLOAD'],
      dateFrom: pullFrom,
      dateTo: pullTo,
      force: true,
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
        if (typeFilter !== 'all' && k.beyanTipi !== typeFilter) return false;
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
          BEYAN_TIPI_LABEL[k.beyanTipi],
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

  const sendEmail = (row: BeyanKaydi) => {
    const email = taxpayerEmail(row);
    if (!email) {
      toast.warning('Mükellef kartında e-posta yok');
      return;
    }
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(declarationSubject(row))}&body=${encodeURIComponent(declarationMessage(row))}`;
  };

  const sendWhatsapp = (row: BeyanKaydi) => {
    const phone = whatsappPhone(taxpayerPhone(row));
    if (!phone) {
      toast.warning('Mükellef kartında telefon yok');
      return;
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(declarationMessage(row))}`, '_blank', 'noopener,noreferrer');
  };

  const sendSms = (row: BeyanKaydi) => {
    const phone = taxpayerPhone(row).replace(/\s+/g, '');
    if (!phone) {
      toast.warning('Mükellef kartında telefon yok');
      return;
    }
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
        BEYAN_TIPI_LABEL[k.beyanTipi],
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
      <section
        className="rounded-2xl px-5 py-4"
        style={{
          background: 'linear-gradient(135deg, rgba(14,23,22,0.92), rgba(16,14,11,0.96))',
          border: '1px solid rgba(125,211,252,0.13)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-7 h-px" style={{ background: GOLD }} />
              <span className="text-[10.5px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>e-Beyanname</span>
            </div>
            <h1 className="text-[30px] font-semibold tracking-[-.03em]" style={{ color: '#fafaf9' }}>Beyanname Indirme</h1>
            <p className="text-[13px] mt-1" style={{ color: 'rgba(250,250,249,0.52)' }}>
              Mali musavir e-Beyanname sifresiyle portala girer, beyannameleri ve tahakkuklari sunucu kuyruguna indirir.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="hidden"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.82)' }}
            >
              <FileText size={15} /> Listeyi İndir
            </button>
            <button
              type="button"
              onClick={() => setImportModal(true)}
              className="hidden"
              style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
            >
              <FolderUp size={15} /> PDF / ZIP Aktar
            </button>
          </div>
        </div>
      </section>

      <section
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(17,24,22,0.94), rgba(12,11,10,0.98))',
          border: '1px solid rgba(125,211,252,0.16)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.15fr),minmax(360px,0.85fr)]">
          <div className="p-4 sm:p-5" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <ServerCog size={16} style={{ color: '#7dd3fc' }} />
                  <h2 className="text-[15px] font-semibold" style={{ color: '#fafaf9' }}>Sunucu İndirme Akışı</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <AutomationPill label="Runner" value={portalSummary?.runner?.enabled ? 'Aktif' : 'Pasif'} tone={portalSummary?.runner?.enabled ? 'blue' : 'rose'} />
                  <AutomationPill label="Şifre" value={portalSummary?.credentials.eBeyannameReady ? 'Hazır' : 'Eksik'} tone={portalSummary?.credentials.eBeyannameReady ? 'green' : 'rose'} />
                </div>
              </div>
              <Link
                href="/panel/ayarlar"
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[12.5px] font-semibold"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.78)' }}
              >
                <KeyRound size={14} /> Şifre Ayarları
              </Link>
            </div>

            <div className="grid gap-3 lg:grid-cols-[1fr,1fr,minmax(180px,220px)]">
              <DateField label="Başlangıç Tarihi" value={pullFrom} onChange={setPullFrom} />
              <DateField label="Bitiş Tarihi" value={pullTo} onChange={setPullTo} />
              <button
                type="button"
                onClick={() => pullMut.mutate()}
                disabled={pullMut.isPending}
                className="h-12 self-end rounded-[10px] px-5 text-[13px] font-bold inline-flex items-center justify-center gap-2"
                style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b', opacity: pullMut.isPending ? 0.65 : 1 }}
              >
                {pullMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                Beyannameleri Çek
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => nightlyMut.mutate()}
                disabled={nightlyMut.isPending}
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[12.5px] font-semibold disabled:opacity-50"
                style={{ background: 'rgba(125,211,252,0.08)', border: '1px solid rgba(125,211,252,0.18)', color: '#bae6fd' }}
              >
                {nightlyMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Gece Akışını Çalıştır
              </button>
              <span className="inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[12px]" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.52)' }}>
                <Clock size={13} /> {portalSummary?.nightly?.time || '02:15'} Europe/Istanbul
              </span>
            </div>
          </div>

          <AutomationJobList jobs={portalSummary?.latestJobs || []} />
        </div>
      </section>

      <section
        className="rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', overflow: 'visible' }}
      >
        <div className="px-4 py-3 text-[12.5px] font-semibold flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.035)', color: 'rgba(250,250,249,0.78)', borderBottom: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px 16px 0 0' }}>
          <Search size={13} style={{ color: 'rgba(250,250,249,0.5)' }} /> Filtrele
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.3fr),repeat(5,minmax(160px,1fr)),52px] gap-2 p-4">
          <SelectBox icon={UserRound} value={selectedTaxpayer} onChange={setSelectedTaxpayer}>
            <option value="all">Tüm mükellefler</option>
            {taxpayerOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </SelectBox>
          <SelectBox icon={Filter} value={typeFilter} onChange={(v) => setTypeFilter(v as FilterKey)}>
            {FILTER_KEYS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </SelectBox>
          <SelectBox icon={FileText} value={docFilter} onChange={(v) => setDocFilter(v as BelgeFilter)}>
            <option value="all">Tür Seçiniz</option>
            <option value="beyanname">Beyanname</option>
            <option value="tahakkuk">Tahakkuk</option>
          </SelectBox>
          <SelectBox icon={CheckCircle2} value={durumFilter} onChange={(v) => setDurumFilter(v as DurumFilter)}>
            <option value="all">Durum Seçiniz</option>
            <option value="gonderilen">GÖNDERİLENLER</option>
            <option value="gonderilmeyen">GÖNDERİLMEYENLER</option>
            <option value="okunan">OKUNANLAR</option>
            <option value="okunmayan">OKUNMAYANLAR</option>
            <option value="sms_gonderilen">SMS GÖNDERİLENLER</option>
            <option value="sms_gonderilmeyen">SMS GÖNDERİLMEYENLER</option>
          </SelectBox>
          <SelectBox icon={CalendarDays} value={periodStart} onChange={setPeriodStart}>
            <option value="">Tüm dönemler (başlangıç)</option>
            {periodOptions.map((p) => <option key={p} value={p}>{fmtDonem(p)}</option>)}
          </SelectBox>
          <SelectBox icon={CalendarDays} value={periodEnd} onChange={setPeriodEnd}>
            <option value="">Tüm dönemler (bitiş)</option>
            {periodOptions.map((p) => <option key={p} value={p}>{fmtDonem(p)}</option>)}
          </SelectBox>
          <button
            type="button"
            onClick={clearFilters}
            className="h-11 px-3 rounded-[10px] inline-flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.68)' }}
            title="Filtreleri temizle"
          >
            <RotateCcw size={16} />
          </button>
        </div>
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
            <table className="w-full min-w-[1120px] text-[13px]">
              <thead style={{ background: 'rgba(255,255,255,0.025)' }}>
                <tr className="text-left uppercase tracking-[.12em] text-[10.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  <th className="px-4 py-3">Mükellef</th>
                  <th className="px-4 py-3">Beyan</th>
                  <th className="px-4 py-3">Dönem / Tarih</th>
                  <th className="px-4 py-3">Tahakkuk</th>
                  <th className="px-4 py-3">Belgeler</th>
                  <th className="px-4 py-3 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} style={{ borderTop: '1px solid rgba(255,255,255,0.055)' }}>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelectedTaxpayer(row.taxpayerId)}
                        className="text-left max-w-[360px]"
                        title="Bu mükellefe filtrele"
                      >
                        <div className="font-semibold truncate" style={{ color: '#fafaf9' }}>{beyanKaydiMukellefAdi(row)}</div>
                        <div className="text-[11.5px] font-mono mt-0.5" style={{ color: 'rgba(250,250,249,0.38)' }}>{row.taxpayer?.taxNumber || '-'}</div>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: 'rgba(212,184,118,0.12)', border: '1px solid rgba(212,184,118,0.22)', color: GOLD }}>
                        {BEYAN_TIPI_LABEL[row.beyanTipi]}
                      </div>
                      <div className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.42)' }}>{row.kaynak || 'kayıt'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold" style={{ color: '#fafaf9' }}>{fmtDonem(row.donem)}</div>
                      <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.42)' }}>{fmtDate(row.beyanTarihi || row.createdAt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold tabular-nums" style={{ color: row.tahakkukTutari ? '#fafaf9' : 'rgba(250,250,249,0.35)' }}>{fmtCurrency(row.tahakkukTutari)}</div>
                      <div className="text-[11px] mt-0.5 font-mono" style={{ color: 'rgba(250,250,249,0.36)' }}>{row.onayNo || 'onay no yok'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <DocButton active={!!row.beyannameUrl} label="Beyanname" onClick={() => openDocument(row, 'beyanname')} />
                        <DocButton active={!!row.pdfUrl} label="Tahakkuk" onClick={() => openDocument(row, 'tahakkuk')} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <IconButton label="Görüntüle" icon={Eye} onClick={() => openDocument(row)} />
                        <IconButton label="E-posta" icon={Mail} onClick={() => sendEmail(row)} />
                        <IconButton label="WhatsApp" icon={MessageCircle} onClick={() => sendWhatsapp(row)} />
                        <IconButton label="SMS" icon={MessageSquareText} onClick={() => sendSms(row)} />
                        <IconButton
                          label="Sil"
                          icon={Trash2}
                          danger
                          onClick={() => {
                            if (confirm(`${beyanKaydiMukellefAdi(row)} kaydı silinsin mi?`)) deleteMut.mutate(row.id);
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {false && importModal && (
        <ImportModal
          onClose={() => setImportModal(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['beyan-kayitlari'] });
            qc.invalidateQueries({ queryKey: ['beyan-kayitlari-ozet'] });
          }}
        />
      )}
    </div>
  );
}

function AutomationPill({ label, value, tone }: { label: string; value: string | number; tone: 'green' | 'blue' | 'rose' | 'muted' }) {
  const colors = {
    green: { color: '#86efac', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.20)' },
    blue: { color: '#7dd3fc', bg: 'rgba(56,189,248,0.10)', border: 'rgba(56,189,248,0.20)' },
    rose: { color: '#fda4af', bg: 'rgba(244,63,94,0.10)', border: 'rgba(244,63,94,0.22)' },
    muted: { color: 'rgba(250,250,249,0.62)', bg: 'rgba(255,255,255,0.035)', border: 'rgba(255,255,255,0.07)' },
  } as const;
  const c = colors[tone];
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-[9px] px-3 text-[11.5px] font-semibold" style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.color }}>
      <span style={{ color: 'rgba(250,250,249,0.46)' }}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

function AutomationJobList({ jobs }: { jobs: PortalJob[] }) {
  const visibleJobs = jobs.slice(0, 4);
  return (
    <div className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Son İşler</h3>
      </div>
      <div className="grid gap-2">
        {visibleJobs.length === 0 && (
          <div className="rounded-xl px-4 py-5 text-center text-[12.5px]" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.48)' }}>
            Henüz indirme işi yok.
          </div>
        )}
        {visibleJobs.map((job) => {
          const status = portalJobStatus(job.status);
          return (
            <div key={job.id} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${status.border}` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
                    {PORTAL_JOB_LABEL[job.jobType] || job.jobType}
                  </div>
                  <div className="mt-1 truncate text-[11.5px]" style={{ color: 'rgba(250,250,249,0.44)' }}>
                    {portalTaxpayerName(job)} · {job.source === 'nightly' ? 'gece' : 'manuel'} · {fmtDateTime(job.createdAt)}
                  </div>
                </div>
                <span className="shrink-0 rounded-md px-2 py-1 text-[10.5px] font-bold" style={{ background: status.bg, color: status.color }}>
                  {status.label}
                </span>
              </div>
              {job.errorMessage && (
                <div className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-5" style={{ color: '#fca5a5' }}>
                  <AlertCircle size={13} className="mt-[3px] shrink-0" />
                  <span>{job.errorMessage.slice(0, 180)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10.5px] font-black uppercase tracking-[0.13em]" style={{ color: 'rgba(250,250,249,0.46)' }}>
        {label}
      </span>
      <span className="relative block">
        <CalendarDays size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(250,250,249,0.38)' }} />
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full rounded-[10px] pl-9 pr-3 text-[13px] font-semibold outline-none"
          style={{ background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
        />
      </span>
    </label>
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

function IconButton({ label, icon: Icon, onClick, danger }: { label: string; icon: any; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="w-9 h-9 rounded-[9px] inline-flex items-center justify-center"
      style={{
        background: danger ? 'rgba(244,63,94,0.08)' : 'rgba(255,255,255,0.035)',
        border: `1px solid ${danger ? 'rgba(244,63,94,0.22)' : 'rgba(255,255,255,0.08)'}`,
        color: danger ? '#fb7185' : 'rgba(250,250,249,0.72)',
      }}
    >
      <Icon size={15} />
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
          <OzetCard label="Geçici Vergi" value={ozet.byTip.GECICI_VERGI || 0} icon={FileText} />
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
                      {BEYAN_TIPI_LABEL[k.beyanTipi]}
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
                          if (confirm(`Bu kaydı silmek istediğine emin misin?\n\n${beyanKaydiMukellefAdi(k)} · ${BEYAN_TIPI_LABEL[k.beyanTipi]} · ${fmtDonem(k.donem)}`)) {
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
      const existing = new Set(prev.map((x) => `${x.name}-${x.size}`));
      const fresh = onlyPdf.filter((f) => !existing.has(`${f.name}-${f.size}`));
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
                  <Sparkles size={15} /> Tek Tek PDF (AI parse)
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
                        <span className="truncate flex-1">{f.name}</span>
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
