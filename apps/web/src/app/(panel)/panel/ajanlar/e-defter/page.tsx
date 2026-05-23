'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  EyeOff,
  FileSpreadsheet,
  Filter,
  Loader2,
  Play,
  RotateCcw,
  Search,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { EDefterDonemTipi, edefterControlApi } from '@/lib/edefter-control';

const GOLD = '#d4b876';
const PANEL = 'rgba(255,255,255,0.025)';
const PANEL_HOVER = 'rgba(255,255,255,0.045)';
const BORDER = 'rgba(255,255,255,0.07)';
const BORDER_STRONG = 'rgba(255,255,255,0.12)';

type Taxpayer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
};

type PeriodMode = 'GECICI' | 'AYLIK' | 'YILLIK';
type SeverityFilter = 'ALL' | 'ERROR' | 'WARN' | 'INFO';
type StatusFilter = 'OPEN' | 'ALL' | 'RESOLVED' | 'IGNORED';

const MONTH_LABELS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function taxpayerName(t?: Taxpayer | null) {
  if (!t) return '-';
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || t.taxNumber || '-';
}

function apiArray<T>(value: any): T[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function quarterLabel(year: number, quarter: number) {
  const ranges: Record<number, string> = {
    1: 'Ocak-Mart',
    2: 'Nisan-Haziran',
    3: 'Temmuz-Eylül',
    4: 'Ekim-Aralık',
  };
  return `${year} ${quarter}. Dönem (${ranges[quarter] || 'Çeyrek'})`;
}

function periodDescriptor(mode: PeriodMode, year: number, quarter: number, month: number) {
  if (mode === 'GECICI') return quarterLabel(year, quarter);
  if (mode === 'AYLIK') return `${MONTH_LABELS[month - 1]} ${year}`;
  return `${year} Yıllık`;
}

function periodDonemString(mode: PeriodMode, year: number, quarter: number, month: number) {
  if (mode === 'GECICI') return `${year}-Q${quarter}`;
  if (mode === 'AYLIK') return `${year}-${String(month).padStart(2, '0')}`;
  return `${year}`;
}

function periodDonemTipi(mode: PeriodMode, quarter: number): EDefterDonemTipi {
  if (mode === 'GECICI') return `GECICI_Q${quarter}` as EDefterDonemTipi;
  if (mode === 'AYLIK') return 'AYLIK';
  return 'YILLIK';
}

function formatDonem(donem?: string | null, donemTipi?: string | null) {
  const source = `${donem || ''} ${donemTipi || ''}`;
  const yearMatch = source.match(/\b(20\d{2})\b/);
  const qMatch = source.match(/Q([1-4])/i);
  if (yearMatch && qMatch) return quarterLabel(Number(yearMatch[1]), Number(qMatch[1]));
  const monthMatch = String(donem || '').match(/^(20\d{2})-(\d{1,2})$/);
  if (monthMatch) {
    const m = Number(monthMatch[2]);
    if (m >= 1 && m <= 12) return `${MONTH_LABELS[m - 1]} ${monthMatch[1]}`;
  }
  if (/^20\d{2}$/.test(String(donem || ''))) return `${donem} Yıllık`;
  return donem || '-';
}

function cleanLucaStatus(value?: string | null) {
  const msg = String(value || '').trim();
  if (!msg) return '';
  if (/%PDF|application\/pdf|Detay Fis Listesi baslik satiri|Luca raporu PDF/i.test(msg)) {
    return 'LUCA rapor türünü PDF verdi. Ajan Rapor Türü alanını Excel (xlsx) yapacak; tekrar Luca’dan Çek deneyin.';
  }
  return msg.length > 320 ? `${msg.slice(0, 320)}...` : msg;
}

function fmtDate(value?: string | Date | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
}

function fmtTRY(value: any) {
  const n = Number(value || 0);
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizePeriodKey(donem?: string | null, donemTipi?: string | null) {
  const source = `${donem || ''} ${donemTipi || ''}`.trim();
  const yearMatch = source.match(/\b(20\d{2})\b/);
  const qMatch = source.match(/Q([1-4])/i);
  if (yearMatch && qMatch) return `${yearMatch[1]}-Q${qMatch[1]}`;
  return String(donem || '').trim().toUpperCase();
}

function sessionMatchesPeriod(session: any, key: string) {
  return normalizePeriodKey(session?.donem, session?.donemTipi) === key.toUpperCase();
}

function categoryLabel(code: string) {
  const dict: Record<string, string> = {
    HESAP_KODU_EKSIK: 'Hesap kodu eksik',
    FIS_TARIHI_EKSIK: 'Fiş tarihi eksik',
    DONEM_DISI_TARIH: 'Dönem dışı tarih',
    SATIRDA_BORC_ALACAK_BIRLIKTE: 'Satırda borç+alacak',
    SIFIR_TUTARLI_SATIR: 'Sıfır tutarlı satır',
    FIS_DENGESIZ: 'Fiş dengesiz',
    '191_TERS_CALISMA': '191 ters çalışma',
    '391_TERS_CALISMA': '391 ters çalışma',
    KASA_30000_TEVSIK_RISKI: 'Kasa 30.000 TL tevsik',
    KASA_GUNLUK_30000_TEVSIK_RISKI: 'Kasa günlük 30.000 TL',
    KASA_TEVSIK_PARCALAMA: 'Tevsik parçalama riski',
    ORTAK_CARI_KASA_KULLANIMI: 'Ortak cari + kasa',
    AVANS_KASA_ORTAK_CARI_KAPAMA: 'Avans kapatma',
    GELIR_HESABI_BORC_CALISMA: 'Gelir hesabı borç',
    GIDER_HESABI_ALACAK_CALISMA: 'Gider hesabı alacak',
    TEK_FISTE_BIRDEN_COK_BELGE: 'Tek fişte çoklu belge',
    AYNI_FISTE_BELGE_ALANLARI_FARKLI: 'Belge alanları farklı',
    FATURA_KARSILIK_HESAP_EKSIK: 'Fatura karşılık eksik',
    BELGE_TURU_DIGER_ACIKLAMA_EKSIK: 'Belge türü "Diğer"',
    KDV_MATRAH_KARSILIK_YOK: 'KDV matrah karşılık yok',
    KDV_ORANI_OLAGAN_DISI: 'KDV oranı olağan dışı',
    KDV_TAHAKKUK_EKSIK: 'KDV tahakkuk eksik',
    KDV_TAHAKKUK_MUKERRER: 'KDV tahakkuk mükerrer',
    KDV_TAHAKKUK_AY_SONU_DEGIL: 'KDV tahakkuk ay sonu değil',
    KDV_TAHAKKUK_191_TUTAR_UYUMSUZ: 'KDV 191 tutar uyumsuz',
    KDV_TAHAKKUK_391_TUTAR_UYUMSUZ: 'KDV 391 tutar uyumsuz',
    KDV_ODENECEK_360_UYUMSUZ: 'Ödenecek KDV 360 uyumsuz',
    KDV_DEVREDEN_190_UYUMSUZ: 'Devreden KDV 190 uyumsuz',
    MUKERRER_EVRAK_NO: 'Mükerrer evrak no',
    BELGE_TARIHI_FIS_TARIHINDEN_SONRA: 'Belge tarihi > fiş tarihi',
    BELGE_TARIHI_DONEM_DISI: 'Belge tarihi dönem dışı',
    YEVMIYE_NO_FORMAT_SUPHELI: 'Yevmiye no format',
    YEVMIYE_NO_MUKERRER: 'Yevmiye no mükerrer',
    YEVMIYE_NO_ATLAMA: 'Yevmiye no atlama',
    YEVMIYE_TARIH_SIRASI: 'Yevmiye tarih sırası',
    ANA_HESAPTA_KAYIT: 'Ana hesapta kayıt',
    MALIYET_YANSITMA_EKSIK_KONTROL: 'Maliyet yansıtma eksik',
    AMORTISMAN_KAYDI_KONTROL: 'Amortisman kaydı',
    REESKONT_SIMETRI_KONTROL: 'Reeskont simetri',
    CARI_KAPAMA_KARSILIK_KONTROL: 'Cari kapama karşılık',
    ACILIS_FISI_TARIH_KONTROL: 'Açılış fişi tarihi',
    KAPANIS_FISI_TARIH_KONTROL: 'Kapanış fişi tarihi',
    DONEMSELLIK_GIDER_KONTROL: 'Dönemsellik gideri',
    BORDRO_TAHAKKUK_HESAP_KONTROL: 'Bordro tahakkuk hesap',
    UCRET_SGK_TAHAKKUK_KONTROL: 'Ücret/SGK tahakkuk',
    BOS_FIS: 'Boş fiş',
    TEK_SATIRLI_FIS: 'Tek satırlı fiş',
  };
  return dict[code] || code.replace(/_/g, ' ').toLocaleLowerCase('tr-TR');
}

function categoryGroup(code: string): { id: string; label: string; order: number } {
  if (code.startsWith('KDV_') || code === '191_TERS_CALISMA' || code === '391_TERS_CALISMA')
    return { id: 'kdv', label: 'KDV Kontrolleri', order: 2 };
  if (code.startsWith('KASA_') || code.includes('CARI_KAPAMA'))
    return { id: 'tevsik', label: 'Tevsik / Kasa / Cari', order: 3 };
  if (code.startsWith('YEVMIYE_') || code === 'FIS_DENGESIZ' || code === 'BOS_FIS' || code === 'TEK_SATIRLI_FIS')
    return { id: 'yevmiye', label: 'Yevmiye / Fiş Bütünlüğü', order: 1 };
  if (code.includes('BELGE') || code === 'MUKERRER_EVRAK_NO' || code === 'TEK_FISTE_BIRDEN_COK_BELGE' || code === 'AYNI_FISTE_BELGE_ALANLARI_FARKLI' || code === 'FATURA_KARSILIK_HESAP_EKSIK')
    return { id: 'belge', label: 'Belge / Evrak', order: 4 };
  if (code === 'ACILIS_FISI_TARIH_KONTROL' || code === 'KAPANIS_FISI_TARIH_KONTROL' || code === 'DONEMSELLIK_GIDER_KONTROL' || code === 'MALIYET_YANSITMA_EKSIK_KONTROL' || code === 'AMORTISMAN_KAYDI_KONTROL' || code === 'REESKONT_SIMETRI_KONTROL')
    return { id: 'donem', label: 'Dönem Sonu / Periyodik', order: 6 };
  if (code === 'BORDRO_TAHAKKUK_HESAP_KONTROL' || code === 'UCRET_SGK_TAHAKKUK_KONTROL')
    return { id: 'bordro', label: 'Bordro / SGK', order: 7 };
  if (code === 'HESAP_KODU_EKSIK' || code === 'ANA_HESAPTA_KAYIT' || code === 'GELIR_HESABI_BORC_CALISMA' || code === 'GIDER_HESABI_ALACAK_CALISMA' || code === 'AVANS_KASA_ORTAK_CARI_KAPAMA' || code === 'ORTAK_CARI_KASA_KULLANIMI')
    return { id: 'hesap', label: 'Hesap Kullanımı', order: 5 };
  return { id: 'diger', label: 'Diğer', order: 9 };
}

export default function EDefterAgentPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [taxpayerId, setTaxpayerId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [periodMode, setPeriodMode] = useState<PeriodMode>('GECICI');
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3));
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [lucaJobId, setLucaJobId] = useState<string | null>(null);
  const [lucaStatus, setLucaStatus] = useState('');
  const [lineSearch, setLineSearch] = useState('');
  const [findingSearch, setFindingSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [focusedFinding, setFocusedFinding] = useState<any | null>(null);
  const linesSectionRef = useRef<HTMLDivElement | null>(null);
  const focusedLineRef = useRef<HTMLTableRowElement | null>(null);

  const donem = periodDonemString(periodMode, year, quarter, month);
  const donemTipi = periodDonemTipi(periodMode, quarter);
  const periodKey = normalizePeriodKey(donem, donemTipi);

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => apiArray<Taxpayer>(r.data)),
  });

  useEffect(() => {
    if (!taxpayerId && taxpayers[0]?.id) setTaxpayerId(taxpayers[0].id);
  }, [taxpayers, taxpayerId]);

  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);

  const { data: sessions = [] } = useQuery<any[]>({
    queryKey: ['edefter-control-list', taxpayerId],
    queryFn: () => edefterControlApi.list(taxpayerId || undefined).then((data) => apiArray<any>(data)),
    refetchInterval: 5000,
  });

  const periodSessions = useMemo(
    () => sessions.filter((s: any) => sessionMatchesPeriod(s, periodKey)),
    [sessions, periodKey],
  );

  useEffect(() => {
    const latest = periodSessions[0]?.id || null;
    if (!latest) {
      if (selectedSessionId) setSelectedSessionId(null);
      return;
    }
    if (!selectedSessionId || !periodSessions.some((s: any) => s.id === selectedSessionId)) {
      setSelectedSessionId(latest);
    }
  }, [periodSessions, selectedSessionId]);

  const selectedSessionInPeriod = !!selectedSessionId && periodSessions.some((s: any) => s.id === selectedSessionId);
  const activeSessionId = selectedSessionInPeriod ? selectedSessionId : periodSessions[0]?.id || null;
  const { data: session } = useQuery<any>({
    queryKey: ['edefter-control-session', activeSessionId],
    queryFn: () => edefterControlApi.get(activeSessionId!),
    enabled: !!activeSessionId,
  });

  const fetchMut = useMutation({
    mutationFn: () =>
      edefterControlApi.fetchFromLucaAgent({
        mukellefId: taxpayerId,
        donem,
        donemTipi,
      }),
    onSuccess: (data) => {
      setLucaJobId(data.jobId);
      setSelectedSessionId(null);
      setLucaStatus(data.mizanJobId
        ? 'Luca ajanı Detay Fiş Listesi ve Mizan raporlarını hazırlıyor...'
        : 'Luca ajanı Detay Fiş Listesi raporunu hazırlıyor; bitince Mizan otomatik sıraya alınacak...');
      toast.info('e-Defter Detay Fiş Listesi işi oluşturuldu');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Luca işi oluşturulamadı'),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => edefterControlApi.uploadExcel({ taxpayerId, donem, donemTipi }, file),
    onSuccess: (data: any) => {
      toast.success(`Detay Fiş Listesi yüklendi: ${data.rows} satır`);
      setSelectedSessionId(data.sessionId);
      qc.invalidateQueries({ queryKey: ['edefter-control-list', taxpayerId] });
      qc.invalidateQueries({ queryKey: ['edefter-control-session', data.sessionId] });
      qc.refetchQueries({ queryKey: ['edefter-control-list', taxpayerId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Excel yüklenemedi'),
  });

  const statusMut = useMutation({
    mutationFn: ({ findingId, status, note }: { findingId: string; status: 'OPEN' | 'RESOLVED' | 'IGNORED'; note?: string | null }) =>
      edefterControlApi.updateFindingStatus(activeSessionId!, findingId, { status, note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['edefter-control-session', activeSessionId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Bulgu güncellenemedi'),
  });

  const exportMut = useMutation({
    mutationFn: () => edefterControlApi.downloadExcel(activeSessionId!),
    onSuccess: () => toast.success('Excel raporu indirildi'),
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Excel indirilemedi'),
  });

  const jobQuery = useQuery({
    queryKey: ['edefter-luca-job', lucaJobId],
    queryFn: () => edefterControlApi.getLucaJob(lucaJobId!),
    enabled: !!lucaJobId,
    refetchInterval: 3000,
  });

  useEffect(() => {
    const data = jobQuery.data;
    if (!data?.job) return;
    const job = data.job;
    const lines = String(job.errorMsg || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const lastLine = cleanLucaStatus(lines[lines.length - 1]);
    const mizanJob = data.mizanJob;
    const mizanStatus = String(mizanJob?.status || '').toLowerCase();
    const mizanDone = !mizanJob || ['done', 'failed', 'cancelled'].includes(mizanStatus);
    if (job.status === 'running') setLucaStatus(lastLine || 'Luca Detay Fiş Listesi Excel hazırlanıyor...');
    if (job.status === 'done') {
      setLucaStatus(mizanDone
        ? 'Detay Fiş Listesi alındı, Mizan kontrolü de güncellendi'
        : 'Detay Fiş Listesi alındı; eşlik eden Mizan kontrolü sürüyor...');
      if (data.session?.id) setSelectedSessionId(data.session.id);
      qc.invalidateQueries({ queryKey: ['edefter-control-list', taxpayerId] });
      qc.invalidateQueries({ queryKey: ['edefter-control-session'] });
      qc.refetchQueries({ queryKey: ['edefter-control-list', taxpayerId] });
      if (data.session?.id) qc.refetchQueries({ queryKey: ['edefter-control-session', data.session.id] });
      if (mizanDone) setLucaJobId(null);
      if (!mizanDone) return;
      if (mizanStatus === 'failed') { toast.warning('Detay Fiş Listesi hazır; Mizan işi hata verdi'); return; }
      toast.success('e-Defter ön kontrol verisi hazır');
    }
    if (job.status === 'failed') {
      const friendly = lastLine || cleanLucaStatus(job.errorMsg) || 'Luca işi hata verdi';
      setLucaStatus(friendly);
      setLucaJobId(null);
      toast.error(friendly);
    }
  }, [jobQuery.data, qc, taxpayerId]);

  const allFindings = (session?.findings || []) as any[];

  const stats = useMemo(() => {
    const open = allFindings.filter((f) => (f.status || 'OPEN') === 'OPEN');
    return {
      total: allFindings.length,
      open: open.length,
      resolved: allFindings.filter((f) => f.status === 'RESOLVED').length,
      ignored: allFindings.filter((f) => f.status === 'IGNORED').length,
      error: open.filter((f) => f.severity === 'ERROR').length,
      warn: open.filter((f) => f.severity === 'WARN').length,
      info: open.filter((f) => f.severity === 'INFO').length,
    };
  }, [allFindings]);

  const mizan = session?.companionMizan || jobQuery.data?.mizan || null;
  const mizanAnomalies = mizan?.anomaliler || [];

  const visibleFindings = useMemo(() => {
    const query = findingSearch.trim().toLocaleLowerCase('tr-TR');
    return allFindings.filter((f: any) => {
      const fStatus = f.status || 'OPEN';
      if (statusFilter !== 'ALL' && fStatus !== statusFilter) return false;
      if (severityFilter !== 'ALL' && f.severity !== severityFilter) return false;
      if (!query) return true;
      const haystack = [f.severity, f.category, f.message, f.voucherKey, f.rowIndex, f.hesapKodu, categoryLabel(f.category)].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
      return haystack.includes(query);
    });
  }, [allFindings, findingSearch, severityFilter, statusFilter]);

  const groupedFindings = useMemo(() => {
    const groups = new Map<string, { id: string; label: string; order: number; items: any[] }>();
    for (const f of visibleFindings) {
      const g = categoryGroup(f.category);
      if (!groups.has(g.id)) groups.set(g.id, { ...g, items: [] });
      groups.get(g.id)!.items.push(f);
    }
    return [...groups.values()].sort((a, b) => a.order - b.order);
  }, [visibleFindings]);

  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      for (const g of groupedFindings) if (next[g.id] === undefined) next[g.id] = true;
      return next;
    });
  }, [groupedFindings]);

  const lines = useMemo(() => session?.lines || [], [session]);
  const visibleLines = useMemo(() => {
    const focusedVoucherKey = focusedFinding?.voucherKey || null;
    const focusedRowIndex = focusedFinding?.rowIndex ? Number(focusedFinding.rowIndex) : null;
    const query = lineSearch.trim().toLocaleLowerCase('tr-TR');
    return lines.filter((line: any) => {
      const matchesFocus = !focusedFinding || (focusedVoucherKey && line.voucherKey === focusedVoucherKey) || (focusedRowIndex && Number(line.rowIndex) === focusedRowIndex);
      if (!matchesFocus) return false;
      if (!query) return true;
      const haystack = [line.rowIndex, line.voucherKey, line.fisNo, line.yevmiyeNo, line.evrakNo, line.hesapKodu, line.hesapAdi, line.aciklama, fmtDate(line.fisTarihi)].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
      return haystack.includes(query);
    });
  }, [focusedFinding, lineSearch, lines]);

  const focusFinding = (finding: any) => {
    setFocusedFinding(finding);
    setLineSearch('');
    window.setTimeout(() => { linesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 0);
  };

  useEffect(() => {
    if (!focusedFinding) return;
    const timer = window.setTimeout(() => { focusedLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 80);
    return () => window.clearTimeout(timer);
  }, [focusedFinding, visibleLines.length]);

  useEffect(() => {
    setFocusedFinding(null);
    setLineSearch('');
    setFindingSearch('');
    setSeverityFilter('ALL');
    setStatusFilter('OPEN');
  }, [activeSessionId]);

  const statusColor = (s: string) => s === 'RESOLVED' ? '#22c55e' : s === 'IGNORED' ? '#94a3b8' : GOLD;

  const handleStatusChange = (f: any, status: 'OPEN' | 'RESOLVED' | 'IGNORED') => {
    if ((f.status || 'OPEN') === status) return;
    statusMut.mutate({ findingId: f.id, status });
    if (status !== 'OPEN') toast.success(status === 'RESOLVED' ? 'Bulgu çözüldü olarak işaretlendi' : 'Bulgu görmezden gelindi');
    else toast.info('Bulgu yeniden açıldı');
  };

  return (
    <div className="space-y-5 max-w-[1400px]">
      <div className="flex flex-col gap-4 pb-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <BookOpen size={18} style={{ color: GOLD }} />
              <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD }}>e-Defter Ön Kontrol</span>
            </div>
            <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 32, fontWeight: 600, color: '#fafaf9' }}>Detay Fiş Listesi Analizi</h1>
            <p className="text-[13px] mt-1" style={{ color: 'rgba(250,250,249,.5)' }}>Luca Detay Fiş Listesi üzerinden e-defter öncesi muhasebe kayıt hatalarını yakalar.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={!activeSessionId || exportMut.isPending} onClick={() => exportMut.mutate()} className="h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40" style={{ background: PANEL, color: 'rgba(250,250,249,.85)', border: `1px solid ${BORDER_STRONG}` }}>
              {exportMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Excel İndir
            </button>
            <button disabled={!taxpayerId || fetchMut.isPending || !!lucaJobId} onClick={() => fetchMut.mutate()} className="h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50" style={{ background: 'rgba(212,184,118,.16)', color: GOLD, border: '1px solid rgba(212,184,118,.28)' }}>
              {fetchMut.isPending || lucaJobId ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Luca'dan Çek
            </button>
            <label className="h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-2 cursor-pointer" style={{ background: PANEL, color: 'rgba(250,250,249,.75)', border: `1px solid ${BORDER}` }}>
              <UploadCloud size={15} /> Excel Yükle
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadMut.mutate(file); e.currentTarget.value = ''; }} />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select value={taxpayerId} onChange={(e) => { setTaxpayerId(e.target.value); setSelectedSessionId(null); }} className="h-10 rounded-lg px-3 text-sm min-w-[260px]" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: '#fafaf9' }}>
            {taxpayers.map((t) => (<option key={t.id} value={t.id}>{taxpayerName(t)}</option>))}
          </select>
          <input type="number" value={year} onChange={(e) => { setYear(Number(e.target.value) || now.getFullYear()); setSelectedSessionId(null); }} className="h-10 rounded-lg px-3 text-sm w-24 tabular-nums" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: '#fafaf9' }} />
          <div className="flex h-10 rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            {(['GECICI', 'AYLIK', 'YILLIK'] as PeriodMode[]).map((mode) => (
              <button key={mode} onClick={() => { setPeriodMode(mode); setSelectedSessionId(null); }} className="px-3 text-xs font-semibold" style={{ background: periodMode === mode ? 'rgba(212,184,118,.18)' : PANEL, color: periodMode === mode ? GOLD : 'rgba(250,250,249,.6)', borderRight: mode !== 'YILLIK' ? `1px solid ${BORDER}` : undefined }}>
                {mode === 'GECICI' ? 'Geçici Vergi' : mode === 'AYLIK' ? 'Aylık' : 'Yıllık'}
              </button>
            ))}
          </div>
          {periodMode === 'GECICI' && (
            <div className="flex h-10 rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
              {[1, 2, 3, 4].map((q) => (
                <button key={q} onClick={() => { setQuarter(q); setSelectedSessionId(null); }} className="px-3 text-sm font-semibold" style={{ background: quarter === q ? 'rgba(212,184,118,.18)' : PANEL, color: quarter === q ? GOLD : 'rgba(250,250,249,.65)', borderRight: q < 4 ? `1px solid ${BORDER}` : undefined }}>
                  {q}. Dönem
                </button>
              ))}
            </div>
          )}
          {periodMode === 'AYLIK' && (
            <select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setSelectedSessionId(null); }} className="h-10 rounded-lg px-3 text-sm" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: '#fafaf9' }}>
              {MONTH_LABELS.map((label, i) => (<option key={i + 1} value={i + 1}>{label}</option>))}
            </select>
          )}
          <span className="text-xs ml-2" style={{ color: 'rgba(250,250,249,.45)' }}>Aktif: <span style={{ color: GOLD }}>{periodDescriptor(periodMode, year, quarter, month)}</span></span>
        </div>
      </div>

      {lucaStatus && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.18)', color: '#bfdbfe' }}>{lucaStatus}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Kpi label="Mükellef" value={taxpayerName(selectedTp)} small />
        <Kpi label="Fiş" value={session?.totalVouchers ?? 0} />
        <Kpi label="Satır" value={session?.totalLines ?? 0} />
        <KpiFilter label="Hata" value={stats.error} active={severityFilter === 'ERROR'} color="#ef4444" icon={XCircle} onClick={() => setSeverityFilter(severityFilter === 'ERROR' ? 'ALL' : 'ERROR')} />
        <KpiFilter label="Uyarı" value={stats.warn} active={severityFilter === 'WARN'} color="#f59e0b" icon={AlertTriangle} onClick={() => setSeverityFilter(severityFilter === 'WARN' ? 'ALL' : 'WARN')} />
        <KpiFilter label="Bilgi" value={stats.info} active={severityFilter === 'INFO'} color="#38bdf8" icon={CheckCircle2} onClick={() => setSeverityFilter(severityFilter === 'INFO' ? 'ALL' : 'INFO')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-4">
        <div className="rounded-xl border p-4" style={{ background: PANEL, borderColor: BORDER }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: '#fafaf9' }}>Geçmiş Kontroller</h2>
            <span className="text-xs tabular-nums" style={{ color: 'rgba(250,250,249,.45)' }}>{periodSessions.length}</span>
          </div>
          <div className="space-y-2 max-h-[520px] overflow-auto">
            {periodSessions.map((s: any) => (
              <button key={s.id} onClick={() => setSelectedSessionId(s.id)} className="w-full text-left rounded-lg p-3 border transition-colors" style={{ background: activeSessionId === s.id ? 'rgba(212,184,118,.12)' : 'rgba(255,255,255,.02)', borderColor: activeSessionId === s.id ? 'rgba(212,184,118,.28)' : BORDER }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold" style={{ color: '#fafaf9' }}>{formatDonem(s.donem, s.donemTipi)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: s.findingCount ? 'rgba(245,158,11,.14)' : 'rgba(34,197,94,.12)', color: s.findingCount ? '#fbbf24' : '#22c55e' }}>
                    {s.findingCount ? `${s.findingCount} bulgu` : 'temiz'}
                  </span>
                </div>
                <div className="text-xs mt-1" style={{ color: 'rgba(250,250,249,.45)' }}>{fmtDate(s.createdAt)} · {s.totalVouchers} fiş · {s.totalLines} satır</div>
              </button>
            ))}
            {periodSessions.length === 0 && (<div className="text-sm p-4 rounded-lg" style={{ background: 'rgba(255,255,255,.02)', color: 'rgba(250,250,249,.45)' }}>Henüz Detay Fiş Listesi çekilmedi.</div>)}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border p-4" style={{ background: PANEL, borderColor: BORDER }}>
            <div className="flex flex-col gap-3 mb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Filter size={14} style={{ color: GOLD }} />
                  <h2 className="text-sm font-semibold" style={{ color: '#fafaf9' }}>Bulgular</h2>
                  <span className="text-xs tabular-nums" style={{ color: 'rgba(250,250,249,.45)' }}>{visibleFindings.length}/{stats.total}</span>
                </div>
                <div className="flex h-8 rounded-md overflow-hidden text-xs font-semibold" style={{ border: `1px solid ${BORDER}` }}>
                  {[{ id: 'OPEN', label: `Açık (${stats.open})` }, { id: 'RESOLVED', label: `Çözüldü (${stats.resolved})` }, { id: 'IGNORED', label: `Görmezden (${stats.ignored})` }, { id: 'ALL', label: `Tümü (${stats.total})` }].map((opt) => (
                    <button key={opt.id} onClick={() => setStatusFilter(opt.id as StatusFilter)} className="px-2.5" style={{ background: statusFilter === opt.id ? 'rgba(212,184,118,.18)' : PANEL, color: statusFilter === opt.id ? GOLD : 'rgba(250,250,249,.6)' }}>{opt.label}</button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="h-9 rounded-lg px-3 flex items-center gap-2 flex-1 min-w-[280px]" style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' }}>
                  <Search size={14} />
                  <input value={findingSearch} onChange={(e) => setFindingSearch(e.target.value)} placeholder="Bulgu, satır, fiş veya hesap ara" className="bg-transparent outline-none text-xs w-full" style={{ color: '#fafaf9' }} />
                </div>
                {(severityFilter !== 'ALL' || statusFilter !== 'OPEN' || findingSearch) && (
                  <button onClick={() => { setSeverityFilter('ALL'); setStatusFilter('OPEN'); setFindingSearch(''); }} className="h-9 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1" style={{ background: PANEL, color: 'rgba(250,250,249,.75)', border: `1px solid ${BORDER}` }}>
                    <RotateCcw size={12} /> Filtreleri sıfırla
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2 max-h-[600px] overflow-auto">
              {groupedFindings.length === 0 && (
                <div className="py-8 text-center text-sm" style={{ color: 'rgba(250,250,249,.45)' }}>{stats.total === 0 ? 'Bulgu yok. Bu dönem ön kontrol açısından temiz görünüyor.' : 'Bu filtreyle bulgu bulunamadı.'}</div>
              )}
              {groupedFindings.map((group) => {
                const expanded = expandedGroups[group.id] !== false;
                const errs = group.items.filter((f) => f.severity === 'ERROR').length;
                const warns = group.items.filter((f) => f.severity === 'WARN').length;
                const infos = group.items.filter((f) => f.severity === 'INFO').length;
                return (
                  <div key={group.id} className="rounded-lg border overflow-hidden" style={{ borderColor: BORDER }}>
                    <button onClick={() => setExpandedGroups((p) => ({ ...p, [group.id]: !expanded }))} className="w-full flex items-center justify-between px-3 py-2 text-left" style={{ background: PANEL_HOVER, color: '#fafaf9' }}>
                      <span className="inline-flex items-center gap-2">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: GOLD }}>{group.label}</span>
                        <span className="text-xs tabular-nums" style={{ color: 'rgba(250,250,249,.5)' }}>{group.items.length}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        {errs > 0 && <SeverityPill count={errs} color="#ef4444" />}
                        {warns > 0 && <SeverityPill count={warns} color="#f59e0b" />}
                        {infos > 0 && <SeverityPill count={infos} color="#38bdf8" />}
                      </span>
                    </button>
                    {expanded && (
                      <div className="divide-y" style={{ borderColor: BORDER }}>
                        {group.items.slice(0, 500).map((f: any) => {
                          const fStatus = f.status || 'OPEN';
                          const isFocused = focusedFinding?.id === f.id;
                          return (
                            <div key={f.id} className="px-3 py-2.5 text-sm" style={{ background: isFocused ? 'rgba(212,184,118,.10)' : 'transparent', borderColor: BORDER, opacity: fStatus !== 'OPEN' ? 0.55 : 1 }}>
                              <div className="flex items-start justify-between gap-3">
                                <div onClick={() => focusFinding(f)} className="flex-1 min-w-0 cursor-pointer">
                                  <div className="flex flex-wrap items-center gap-2 mb-1">
                                    <Severity value={f.severity} />
                                    <span className="text-[11px] font-semibold" style={{ color: 'rgba(250,250,249,.75)' }}>{categoryLabel(f.category)}</span>
                                    {f.rowIndex && (<span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,.05)', color: 'rgba(250,250,249,.6)' }}>Satır {f.rowIndex}</span>)}
                                    {f.hesapKodu && (<span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded" style={{ background: 'rgba(212,184,118,.12)', color: GOLD }}>{f.hesapKodu}</span>)}
                                    <span className="text-[10px] px-1.5 py-0.5 rounded ml-auto" style={{ background: `${statusColor(fStatus)}1f`, color: statusColor(fStatus) }}>
                                      {fStatus === 'OPEN' ? 'Açık' : fStatus === 'RESOLVED' ? 'Çözüldü' : 'Görmezden'}
                                    </span>
                                  </div>
                                  <div className="text-[12.5px]" style={{ color: '#fafaf9' }}>{f.message}</div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {fStatus !== 'RESOLVED' && (
                                    <button onClick={() => handleStatusChange(f, 'RESOLVED')} title="Çözüldü olarak işaretle" className="h-7 w-7 rounded-md inline-flex items-center justify-center" style={{ background: 'rgba(34,197,94,.10)', color: '#22c55e', border: '1px solid rgba(34,197,94,.18)' }}><CheckCircle2 size={13} /></button>
                                  )}
                                  {fStatus !== 'IGNORED' && (
                                    <button onClick={() => handleStatusChange(f, 'IGNORED')} title="Görmezden gel" className="h-7 w-7 rounded-md inline-flex items-center justify-center" style={{ background: 'rgba(148,163,184,.10)', color: '#94a3b8', border: '1px solid rgba(148,163,184,.18)' }}><EyeOff size={13} /></button>
                                  )}
                                  {fStatus !== 'OPEN' && (
                                    <button onClick={() => handleStatusChange(f, 'OPEN')} title="Yeniden aç" className="h-7 w-7 rounded-md inline-flex items-center justify-center" style={{ background: 'rgba(212,184,118,.10)', color: GOLD, border: '1px solid rgba(212,184,118,.18)' }}><RotateCcw size={13} /></button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border p-4" style={{ background: PANEL, borderColor: BORDER }}>
            <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={16} style={{ color: GOLD }} />
                <h2 className="text-sm font-semibold" style={{ color: '#fafaf9' }}>Mizan Kontrolü</h2>
              </div>
              <span className="text-xs tabular-nums" style={{ color: mizan?.anomalyCount ? '#f59e0b' : 'rgba(250,250,249,.45)' }}>
                {mizan ? `${mizan.hesapCount || 0} hesap, ${mizan.anomalyCount || 0} bulgu` : 'Mizan bekleniyor'}
              </span>
            </div>
            {mizan ? (
              <div className="space-y-2">
                {mizanAnomalies.slice(0, 8).map((a: any) => (
                  <div key={a.id} className="grid grid-cols-1 gap-2 rounded-lg px-3 py-2 text-xs sm:grid-cols-[88px_120px_minmax(0,1fr)]" style={{ background: 'rgba(255,255,255,.025)', color: 'rgba(250,250,249,.78)' }}>
                    <Severity value={a.seviye || 'WARN'} />
                    <span className="font-semibold truncate">{a.tip || '-'}</span>
                    <span className="min-w-0 break-words">{a.hesapKodu ? `${a.hesapKodu} - ` : ''}{a.mesaj || '-'}</span>
                  </div>
                ))}
                {mizanAnomalies.length === 0 && (<div className="rounded-lg px-3 py-3 text-sm" style={{ background: 'rgba(34,197,94,.08)', color: '#86efac' }}>Mizan kontrolünde bulgu yok.</div>)}
              </div>
            ) : (
              <div className="rounded-lg px-3 py-3 text-sm" style={{ background: 'rgba(255,255,255,.02)', color: 'rgba(250,250,249,.45)' }}>Luca'dan çekim tamamlandığında aynı dönemin mizanı burada ayrı kontrol olarak görünecek.</div>
            )}
          </div>

          <div ref={linesSectionRef} className="rounded-xl border p-4" style={{ background: PANEL, borderColor: BORDER }}>
            <div className="flex flex-col gap-3 mb-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={16} style={{ color: GOLD }} />
                <h2 className="text-sm font-semibold" style={{ color: '#fafaf9' }}>Fiş Satırları</h2>
                <span className="text-xs tabular-nums" style={{ color: 'rgba(250,250,249,.45)' }}>{visibleLines.length}/{lines.length}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {focusedFinding && (
                  <button onClick={() => setFocusedFinding(null)} className="h-9 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1" style={{ background: 'rgba(212,184,118,.12)', color: GOLD, border: '1px solid rgba(212,184,118,.24)' }}>
                    <XCircle size={13} /> Bulgu filtresini temizle
                  </button>
                )}
                <div className="h-9 rounded-lg px-3 flex items-center gap-2 min-w-[260px]" style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' }}>
                  <Search size={14} />
                  <input value={lineSearch} onChange={(e) => setLineSearch(e.target.value)} placeholder="Satır, fiş, evrak, hesap veya açıklama ara" className="bg-transparent outline-none text-xs w-full" style={{ color: '#fafaf9' }} />
                </div>
              </div>
            </div>
            <div className="overflow-auto max-h-[520px]">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: 'rgba(250,250,249,.48)', borderBottom: `1px solid ${BORDER}` }}>
                    <th className="text-left py-2 font-medium">Satır</th>
                    <th className="text-left py-2 font-medium">Tarih</th>
                    <th className="text-left py-2 font-medium">Fiş</th>
                    <th className="text-left py-2 font-medium">Evrak</th>
                    <th className="text-left py-2 font-medium">Hesap</th>
                    <th className="text-left py-2 font-medium">Açıklama</th>
                    <th className="text-right py-2 font-medium">Borç</th>
                    <th className="text-right py-2 font-medium">Alacak</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.slice(0, 1000).map((line: any) => (
                    <tr key={line.id} ref={focusedFinding?.rowIndex && Number(focusedFinding.rowIndex) === Number(line.rowIndex) ? focusedLineRef : undefined} style={{ borderBottom: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.82)', background: focusedFinding?.rowIndex && Number(focusedFinding.rowIndex) === Number(line.rowIndex) ? 'rgba(212,184,118,.10)' : 'transparent' }}>
                      <td className="py-2 tabular-nums">{line.rowIndex || '-'}</td>
                      <td className="py-2 whitespace-nowrap">{fmtDate(line.fisTarihi)}</td>
                      <td className="py-2">{line.yevmiyeNo || line.fisNo || '-'}</td>
                      <td className="py-2">{line.evrakNo || '-'}</td>
                      <td className="py-2 whitespace-nowrap">{line.hesapKodu || '-'} · {line.hesapAdi || ''}</td>
                      <td className="py-2 min-w-[220px]">{line.aciklama || '-'}</td>
                      <td className="py-2 text-right tabular-nums">{fmtTRY(line.borc)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtTRY(line.alacak)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {session && visibleLines.length === 0 && (<div className="py-8 text-center text-sm" style={{ color: 'rgba(250,250,249,.45)' }}>Bu filtreyle satır bulunamadı.</div>)}
              {!session && (<div className="py-8 text-center text-sm" style={{ color: 'rgba(250,250,249,.45)' }}>Bir dönem seç veya Luca'dan Detay Fiş Listesi çek.</div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, small }: { label: string; value: any; small?: boolean }) {
  return (
    <div className="rounded-xl border p-3" style={{ background: PANEL, borderColor: BORDER }}>
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'rgba(250,250,249,.45)' }}>{label}</div>
      <div className={`font-semibold truncate ${small ? 'text-sm' : 'text-lg tabular-nums'}`} style={{ color: '#fafaf9' }}>{String(value ?? '-')}</div>
    </div>
  );
}

function KpiFilter({ label, value, active, color, icon: Icon, onClick }: { label: string; value: number; active: boolean; color: string; icon: any; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-xl border p-3 text-left transition-transform hover:scale-[1.02]" style={{ background: active ? `${color}1c` : PANEL, borderColor: active ? `${color}55` : BORDER }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: active ? color : 'rgba(250,250,249,.45)' }}>{label}</span>
        <Icon size={12} style={{ color }} />
      </div>
      <div className="text-lg font-semibold tabular-nums" style={{ color }}>{value}</div>
    </button>
  );
}

function SeverityPill({ count, color }: { count: number; color: string }) {
  return (<span className="text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums" style={{ background: `${color}18`, color }}>{count}</span>);
}

function Severity({ value }: { value: string }) {
  const color = value === 'ERROR' ? '#ef4444' : value === 'WARN' ? '#f59e0b' : '#38bdf8';
  const label = value === 'ERROR' ? 'HATA' : value === 'WARN' ? 'UYARI' : 'BİLGİ';
  return (<span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${color}18`, color }}>{label}</span>);
}
