'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Download, EyeOff, FileSpreadsheet, History, LayoutGrid,
  ListChecks, Loader2, Play, RotateCcw, Search, Sparkles, UploadCloud, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { EDefterDonemTipi, edefterControlApi } from '@/lib/edefter-control';

const GOLD = '#d4b876';
const GOLD_SOFT = 'rgba(212,184,118,.14)';
const PANEL = 'rgba(255,255,255,0.025)';
const PANEL_HOVER = 'rgba(255,255,255,0.045)';
const BORDER = 'rgba(255,255,255,0.07)';
const BORDER_STRONG = 'rgba(255,255,255,0.12)';

type Taxpayer = { id: string; firstName?: string | null; lastName?: string | null; companyName?: string | null; taxNumber?: string | null };
type PeriodMode = 'GECICI' | 'AYLIK' | 'YILLIK';
type SeverityFilter = 'ALL' | 'ERROR' | 'WARN' | 'INFO';
type StatusFilter = 'OPEN' | 'ALL' | 'RESOLVED' | 'IGNORED';
type Tab = 'BULGULAR' | 'SATIRLAR' | 'GECMIS';

const MONTH_LABELS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

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
  const r: Record<number, string> = { 1: 'Ocak-Mart', 2: 'Nisan-Haziran', 3: 'Temmuz-Eylül', 4: 'Ekim-Aralık' };
  return `${year} ${quarter}. Dönem (${r[quarter] || 'Çeyrek'})`;
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
  const mm = String(donem || '').match(/^(20\d{2})-(\d{1,2})$/);
  if (mm) { const m = Number(mm[2]); if (m >= 1 && m <= 12) return `${MONTH_LABELS[m - 1]} ${mm[1]}`; }
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
function fmtDate(value?: string | Date | null) { if (!value) return '-'; return new Date(value).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }); }
function fmtDateTime(value?: string | Date | null) { if (!value) return '-'; return new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' }); }
function fmtTRY(value: any) { const n = Number(value || 0); return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
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
    HESAP_KODU_EKSIK: 'Hesap kodu eksik', FIS_TARIHI_EKSIK: 'Fiş tarihi eksik',
    DONEM_DISI_TARIH: 'Dönem dışı tarih', FIS_DENGESIZ: 'Fiş dengesiz',
    KASA_GUNLUK_30000_TEVSIK_RISKI: 'Kasa günlük 30.000 TL tevsik',
    KASA_TEVSIK_PARCALAMA: 'Tevsik parçalama riski',
    YEVMIYE_NO_MUKERRER: 'Yevmiye no mükerrer', YEVMIYE_NO_ATLAMA: 'Yevmiye no atlama',
    YEVMIYE_TARIH_SIRASI: 'Yevmiye tarih sırası',
    BELGE_TARIHI_FIS_TARIHINDEN_SONRA: 'Belge tarihi > fiş tarihi',
    BELGE_TARIHI_DONEM_DISI: 'Belge tarihi dönem dışı',
    BOS_FIS: 'Boş fiş', TEK_SATIRLI_FIS: 'Tek satırlı fiş',
    VKN_FORMAT_HATALI: 'VKN/TCKN format hatalı',
    VKN_ALGORITMA_HATALI: 'VKN/TCKN algoritması tutmuyor',
    GERCEK_MUKERRER_FATURA: 'Mükerrer fatura (VKN+No+Tutar)',
    AYNI_GUN_AYNI_TUTAR_AYNI_TARAF: 'Aynı gün/tutar/taraf mükerrer',
    DEFTER_GENELI_DENGESIZ: 'Defter geneli dengesiz',
    CARI_TERS_BAKIYE_120: '120 ters bakiye (alacaklı)',
    CARI_TERS_BAKIYE_320: '320 ters bakiye (borçlu)',
    HAVADA_KDV_KAYDI: 'Havada KDV kaydı',
    YUKSEK_TUTAR_ACIKLAMA_EKSIK: 'Yüksek tutar açıklama eksik',
    ORTAK_ALACAK_FAIZ_RISKI: '131 ortak alacağı faiz riski',
  };
  return dict[code] || code.replace(/_/g, ' ').toLocaleLowerCase('tr-TR');
}

function categoryGroup(code: string): { id: string; label: string; order: number; icon: string } {
  if (code === 'DEFTER_GENELI_DENGESIZ') return { id: 'temel', label: 'Temel Bütünlük', order: 0, icon: '🔍' };
  if (code.startsWith('VKN_')) return { id: 'vkn', label: 'VKN / TCKN Doğrulama', order: 1, icon: '🆔' };
  if (code === 'GERCEK_MUKERRER_FATURA' || code === 'AYNI_GUN_AYNI_TUTAR_AYNI_TARAF') return { id: 'mukerrer', label: 'Mükerrer Kayıt Kontrolü', order: 2, icon: '⚠️' };
  if (code === 'HAVADA_KDV_KAYDI') return { id: 'kdv', label: 'KDV Kontrolleri', order: 3, icon: '🧾' };
  if (code.startsWith('CARI_TERS_BAKIYE')) return { id: 'cari', label: 'Cari Hesap Tutarlılığı', order: 4, icon: '👥' };
  if (code === 'ORTAK_ALACAK_FAIZ_RISKI') return { id: 'ortak', label: 'Ortak Alacakları / KKEG', order: 5, icon: '⚖️' };
  if (code.startsWith('KASA_')) return { id: 'tevsik', label: 'Tevsik / Kasa', order: 6, icon: '💰' };
  if (code.startsWith('YEVMIYE_') || code === 'FIS_DENGESIZ' || code === 'BOS_FIS' || code === 'TEK_SATIRLI_FIS')
    return { id: 'yevmiye', label: 'Yevmiye / Fiş Bütünlüğü', order: 7, icon: '📋' };
  if (code.includes('BELGE')) return { id: 'belge', label: 'Belge / Evrak', order: 8, icon: '📄' };
  if (code === 'HESAP_KODU_EKSIK' || code === 'FIS_TARIHI_EKSIK' || code === 'DONEM_DISI_TARIH')
    return { id: 'tem2', label: 'Temel Bütünlük', order: 0, icon: '🔍' };
  if (code === 'YUKSEK_TUTAR_ACIKLAMA_EKSIK') return { id: 'aciklama', label: 'Açıklama / Kalite', order: 10, icon: '📝' };
  return { id: 'diger', label: 'Diğer', order: 99, icon: '•' };
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
  const [activeTab, setActiveTab] = useState<Tab>('BULGULAR');
  const [lineSearch, setLineSearch] = useState('');
  const [findingSearch, setFindingSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [focusedFinding, setFocusedFinding] = useState<any | null>(null);
  const focusedLineRef = useRef<HTMLTableRowElement | null>(null);

  const donem = periodDonemString(periodMode, year, quarter, month);
  const donemTipi = periodDonemTipi(periodMode, quarter);
  const periodKey = normalizePeriodKey(donem, donemTipi);

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => apiArray<Taxpayer>(r.data)),
  });
  useEffect(() => { if (!taxpayerId && taxpayers[0]?.id) setTaxpayerId(taxpayers[0].id); }, [taxpayers, taxpayerId]);
  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);

  const { data: sessions = [] } = useQuery<any[]>({
    queryKey: ['edefter-control-list', taxpayerId],
    queryFn: () => edefterControlApi.list(taxpayerId || undefined).then((data) => apiArray<any>(data)),
    refetchInterval: 5000,
  });
  const periodSessions = useMemo(() => sessions.filter((s: any) => sessionMatchesPeriod(s, periodKey)), [sessions, periodKey]);

  useEffect(() => {
    const latest = periodSessions[0]?.id || null;
    if (!latest) { if (selectedSessionId) setSelectedSessionId(null); return; }
    if (!selectedSessionId || !periodSessions.some((s: any) => s.id === selectedSessionId)) setSelectedSessionId(latest);
  }, [periodSessions, selectedSessionId]);

  const activeSessionId = selectedSessionId && periodSessions.some((s: any) => s.id === selectedSessionId)
    ? selectedSessionId : periodSessions[0]?.id || null;

  const { data: session } = useQuery<any>({
    queryKey: ['edefter-control-session', activeSessionId],
    queryFn: () => edefterControlApi.get(activeSessionId!),
    enabled: !!activeSessionId,
  });

  const fetchMut = useMutation({
    mutationFn: () => edefterControlApi.fetchFromLucaAgent({ mukellefId: taxpayerId, donem, donemTipi }),
    onSuccess: (data) => {
      setLucaJobId(data.jobId); setSelectedSessionId(null);
      setLucaStatus(data.mizanJobId ? 'Luca ajanı Detay Fiş Listesi ve Mizan raporlarını hazırlıyor...' : 'Luca ajanı Detay Fiş Listesi raporunu hazırlıyor; bitince Mizan otomatik sıraya alınacak...');
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edefter-control-session', activeSessionId] }),
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
    enabled: !!lucaJobId, refetchInterval: 3000,
  });
  useEffect(() => {
    const data = jobQuery.data; if (!data?.job) return;
    const job = data.job;
    const lines = String(job.errorMsg || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const lastLine = cleanLucaStatus(lines[lines.length - 1]);
    const mizanJob = data.mizanJob;
    const mizanStatus = String(mizanJob?.status || '').toLowerCase();
    const mizanDone = !mizanJob || ['done', 'failed', 'cancelled'].includes(mizanStatus);
    if (job.status === 'running') setLucaStatus(lastLine || 'Luca Detay Fiş Listesi Excel hazırlanıyor...');
    if (job.status === 'done') {
      setLucaStatus(mizanDone ? 'Detay Fiş Listesi alındı, Mizan kontrolü de güncellendi' : 'Detay Fiş Listesi alındı; eşlik eden Mizan kontrolü sürüyor...');
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
      setLucaStatus(friendly); setLucaJobId(null); toast.error(friendly);
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
    const groups = new Map<string, { id: string; label: string; order: number; icon: string; items: any[] }>();
    for (const f of visibleFindings) {
      const g = categoryGroup(f.category);
      if (!groups.has(g.id)) groups.set(g.id, { ...g, items: [] });
      groups.get(g.id)!.items.push(f);
    }
    return [...groups.values()].sort((a, b) => a.order - b.order);
  }, [visibleFindings]);

  useEffect(() => {
    setExpandedGroups((prev) => { const next = { ...prev }; for (const g of groupedFindings) if (next[g.id] === undefined) next[g.id] = true; return next; });
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
    setFocusedFinding(finding); setLineSearch(''); setActiveTab('SATIRLAR');
    window.setTimeout(() => { focusedLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 200);
  };

  useEffect(() => {
    setFocusedFinding(null); setLineSearch(''); setFindingSearch('');
    setSeverityFilter('ALL'); setStatusFilter('OPEN'); setActiveTab('BULGULAR');
  }, [activeSessionId]);

  const statusColor = (s: string) => s === 'RESOLVED' ? '#22c55e' : s === 'IGNORED' ? '#94a3b8' : GOLD;
  const handleStatusChange = (f: any, status: 'OPEN' | 'RESOLVED' | 'IGNORED') => {
    if ((f.status || 'OPEN') === status) return;
    statusMut.mutate({ findingId: f.id, status });
    if (status !== 'OPEN') toast.success(status === 'RESOLVED' ? 'Bulgu çözüldü olarak işaretlendi' : 'Bulgu görmezden gelindi');
    else toast.info('Bulgu yeniden açıldı');
  };

  const sessionScoreColor = stats.error > 0 ? '#ef4444' : stats.warn > 0 ? '#f59e0b' : '#22c55e';
  const sessionScoreLabel = stats.total === 0 ? 'Temiz' : stats.error > 0 ? 'Kritik' : stats.warn > 0 ? 'Dikkat' : 'İyi';

  return (
    <div className="space-y-4">
      {/* HERO: tek satırda mukellef + donem + skor + butonlar */}
      <div className="rounded-2xl overflow-hidden border" style={{ borderColor: BORDER_STRONG, background: 'linear-gradient(135deg, rgba(212,184,118,.08), rgba(212,184,118,.02))' }}>
        <div className="px-5 py-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <div className="h-11 w-11 rounded-xl flex items-center justify-center" style={{ background: GOLD_SOFT, color: GOLD }}>
              <BookOpen size={20} />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold tracking-[.2em] mb-0.5" style={{ color: GOLD }}>e-Defter Ön Kontrol</div>
              <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, color: '#fafaf9', lineHeight: 1.15 }}>
                {taxpayerName(selectedTp)}
              </h1>
              <div className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,.55)' }}>
                {periodDescriptor(periodMode, year, quarter, month)} · {session?.totalVouchers ?? 0} fiş · {session?.totalLines ?? 0} satır
              </div>
            </div>
          </div>

          {/* Sağ: durum rozeti + aksiyonlar */}
          <div className="flex flex-wrap items-center gap-2">
            {session && (
              <div className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider" style={{ background: `${sessionScoreColor}22`, color: sessionScoreColor, border: `1px solid ${sessionScoreColor}55` }}>
                {sessionScoreLabel}
              </div>
            )}
            <button disabled={!activeSessionId || exportMut.isPending} onClick={() => exportMut.mutate()} className="h-9 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40" style={{ background: PANEL, color: 'rgba(250,250,249,.85)', border: `1px solid ${BORDER_STRONG}` }}>
              {exportMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Excel
            </button>
            <button disabled={!taxpayerId || fetchMut.isPending || !!lucaJobId} onClick={() => fetchMut.mutate()} className="h-9 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: 'rgba(212,184,118,.18)', color: GOLD, border: '1px solid rgba(212,184,118,.32)' }}>
              {fetchMut.isPending || lucaJobId ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Luca'dan Çek
            </button>
            <label className="h-9 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer" style={{ background: PANEL, color: 'rgba(250,250,249,.75)', border: `1px solid ${BORDER}` }}>
              <UploadCloud size={13} /> Yükle
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadMut.mutate(file); e.currentTarget.value = ''; }} />
            </label>
          </div>
        </div>

        {/* Selector bandı — hero altında compact tek satır */}
        <div className="px-5 py-2.5 flex flex-wrap items-center gap-2" style={{ background: 'rgba(0,0,0,.18)', borderTop: `1px solid ${BORDER}` }}>
          <select value={taxpayerId} onChange={(e) => { setTaxpayerId(e.target.value); setSelectedSessionId(null); }} className="h-8 rounded-md px-2 text-xs min-w-[220px]" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: '#fafaf9' }}>
            {taxpayers.map((t) => (<option key={t.id} value={t.id}>{taxpayerName(t)}</option>))}
          </select>
          <input type="number" value={year} onChange={(e) => { setYear(Number(e.target.value) || now.getFullYear()); setSelectedSessionId(null); }} className="h-8 rounded-md px-2 text-xs w-20 tabular-nums" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: '#fafaf9' }} />
          <div className="flex h-8 rounded-md overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            {(['GECICI', 'AYLIK', 'YILLIK'] as PeriodMode[]).map((mode) => (
              <button key={mode} onClick={() => { setPeriodMode(mode); setSelectedSessionId(null); }} className="px-2.5 text-[11px] font-semibold" style={{ background: periodMode === mode ? 'rgba(212,184,118,.18)' : PANEL, color: periodMode === mode ? GOLD : 'rgba(250,250,249,.6)', borderRight: mode !== 'YILLIK' ? `1px solid ${BORDER}` : undefined }}>
                {mode === 'GECICI' ? 'Geçici' : mode === 'AYLIK' ? 'Aylık' : 'Yıllık'}
              </button>
            ))}
          </div>
          {periodMode === 'GECICI' && (
            <div className="flex h-8 rounded-md overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
              {[1, 2, 3, 4].map((q) => (
                <button key={q} onClick={() => { setQuarter(q); setSelectedSessionId(null); }} className="px-2.5 text-[11px] font-semibold" style={{ background: quarter === q ? 'rgba(212,184,118,.18)' : PANEL, color: quarter === q ? GOLD : 'rgba(250,250,249,.65)', borderRight: q < 4 ? `1px solid ${BORDER}` : undefined }}>
                  {q}
                </button>
              ))}
            </div>
          )}
          {periodMode === 'AYLIK' && (
            <select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setSelectedSessionId(null); }} className="h-8 rounded-md px-2 text-xs" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: '#fafaf9' }}>
              {MONTH_LABELS.map((label, i) => (<option key={i + 1} value={i + 1}>{label}</option>))}
            </select>
          )}
          {periodSessions.length > 1 && (
            <select value={activeSessionId || ''} onChange={(e) => setSelectedSessionId(e.target.value)} className="h-8 rounded-md px-2 text-xs ml-auto" style={{ background: PANEL, border: `1px solid ${BORDER_STRONG}`, color: GOLD }}>
              {periodSessions.map((s: any, i: number) => (
                <option key={s.id} value={s.id}>{i === 0 ? '★ ' : ''}v{periodSessions.length - i} · {fmtDateTime(s.createdAt)} · {s.findingCount} bulgu</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {lucaStatus && (
        <div className="rounded-xl px-4 py-2.5 text-xs flex items-center gap-2" style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.18)', color: '#bfdbfe' }}>
          <Loader2 size={13} className="animate-spin shrink-0" /> {lucaStatus}
        </div>
      )}

      {/* KPI ŞERİDİ — yatay tek satır, kompakt */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2.5">
        <BigStat label="Toplam" value={stats.total} color="#fafaf9" />
        <BigStat label="Açık" value={stats.open} color={GOLD} />
        <BigStat label="Çözüldü" value={stats.resolved} color="#22c55e" />
        <KpiFilter label="Hata" value={stats.error} active={severityFilter === 'ERROR'} color="#ef4444" icon={XCircle} onClick={() => setSeverityFilter(severityFilter === 'ERROR' ? 'ALL' : 'ERROR')} />
        <KpiFilter label="Uyarı" value={stats.warn} active={severityFilter === 'WARN'} color="#f59e0b" icon={AlertTriangle} onClick={() => setSeverityFilter(severityFilter === 'WARN' ? 'ALL' : 'WARN')} />
        <KpiFilter label="Bilgi" value={stats.info} active={severityFilter === 'INFO'} color="#38bdf8" icon={CheckCircle2} onClick={() => setSeverityFilter(severityFilter === 'INFO' ? 'ALL' : 'INFO')} />
      </div>

      {/* TAB ŞERİDİ — sidebar yerine */}
      <div className="flex items-center gap-1 border-b" style={{ borderColor: BORDER_STRONG }}>
        <TabButton active={activeTab === 'BULGULAR'} onClick={() => setActiveTab('BULGULAR')} icon={LayoutGrid} label="Bulgular" badge={stats.open} />
        <TabButton active={activeTab === 'SATIRLAR'} onClick={() => setActiveTab('SATIRLAR')} icon={ListChecks} label="Fiş Satırları" badge={lines.length} />
        <TabButton active={activeTab === 'GECMIS'} onClick={() => setActiveTab('GECMIS')} icon={History} label="Geçmiş Kontroller" badge={periodSessions.length} />
        <div className="ml-auto flex items-center gap-2 pb-2">
          {activeTab === 'BULGULAR' && (
            <div className="flex h-8 rounded-md overflow-hidden text-[11px] font-semibold" style={{ border: `1px solid ${BORDER}` }}>
              {[
                { id: 'OPEN', label: `Açık (${stats.open})` },
                { id: 'RESOLVED', label: `Çözüldü (${stats.resolved})` },
                { id: 'IGNORED', label: `Görmezden (${stats.ignored})` },
                { id: 'ALL', label: `Tümü (${stats.total})` },
              ].map((opt) => (
                <button key={opt.id} onClick={() => setStatusFilter(opt.id as StatusFilter)} className="px-2.5" style={{ background: statusFilter === opt.id ? 'rgba(212,184,118,.18)' : PANEL, color: statusFilter === opt.id ? GOLD : 'rgba(250,250,249,.6)' }}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* TAB: BULGULAR — tam genişlik, kart tabanlı */}
      {activeTab === 'BULGULAR' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-10 rounded-lg px-3 flex items-center gap-2 flex-1 min-w-[300px]" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' }}>
              <Search size={14} />
              <input value={findingSearch} onChange={(e) => setFindingSearch(e.target.value)} placeholder="Bulgu, satır, fiş veya hesap ara..." className="bg-transparent outline-none text-sm w-full" style={{ color: '#fafaf9' }} />
            </div>
            <span className="text-xs tabular-nums" style={{ color: 'rgba(250,250,249,.5)' }}>{visibleFindings.length}/{stats.total} bulgu</span>
            {(severityFilter !== 'ALL' || statusFilter !== 'OPEN' || findingSearch) && (
              <button onClick={() => { setSeverityFilter('ALL'); setStatusFilter('OPEN'); setFindingSearch(''); }} className="h-10 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1" style={{ background: PANEL, color: 'rgba(250,250,249,.75)', border: `1px solid ${BORDER}` }}>
                <RotateCcw size={12} /> Sıfırla
              </button>
            )}
          </div>

          {groupedFindings.length === 0 && (
            <div className="rounded-2xl p-12 text-center" style={{ background: PANEL, border: `1px dashed ${BORDER_STRONG}` }}>
              <div className="inline-flex h-14 w-14 rounded-full items-center justify-center mb-3" style={{ background: stats.total === 0 ? 'rgba(34,197,94,.15)' : GOLD_SOFT, color: stats.total === 0 ? '#22c55e' : GOLD }}>
                {stats.total === 0 ? <CheckCircle2 size={26} /> : <Sparkles size={26} />}
              </div>
              <div className="text-base font-semibold mb-1" style={{ color: '#fafaf9' }}>
                {stats.total === 0 ? 'Bu dönem temiz görünüyor' : 'Filtrelerle eşleşen bulgu yok'}
              </div>
              <div className="text-xs" style={{ color: 'rgba(250,250,249,.5)' }}>
                {stats.total === 0 ? 'e-Defter ön kontrol bulgu üretmedi.' : 'Filtreleri sıfırlayarak tüm bulguları görebilirsiniz.'}
              </div>
            </div>
          )}

          {/* Bulgular: tam genişlik, kategori başlıklı kartlar grid yerine ardışık */}
          <div className="space-y-3">
            {groupedFindings.map((group) => {
              const expanded = expandedGroups[group.id] !== false;
              const errs = group.items.filter((f) => f.severity === 'ERROR').length;
              const warns = group.items.filter((f) => f.severity === 'WARN').length;
              const infos = group.items.filter((f) => f.severity === 'INFO').length;
              return (
                <div key={group.id} className="rounded-xl overflow-hidden" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
                  <button onClick={() => setExpandedGroups((p) => ({ ...p, [group.id]: !expanded }))} className="w-full flex items-center justify-between px-4 py-3 text-left" style={{ background: PANEL_HOVER }}>
                    <span className="inline-flex items-center gap-3">
                      <span className="text-lg">{group.icon}</span>
                      {expanded ? <ChevronDown size={15} style={{ color: GOLD }} /> : <ChevronRight size={15} style={{ color: GOLD }} />}
                      <span className="text-sm font-bold uppercase tracking-wide" style={{ color: '#fafaf9' }}>{group.label}</span>
                      <span className="text-xs tabular-nums px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,.05)', color: 'rgba(250,250,249,.7)' }}>{group.items.length}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {errs > 0 && <SeverityPill count={errs} color="#ef4444" label="hata" />}
                      {warns > 0 && <SeverityPill count={warns} color="#f59e0b" label="uyarı" />}
                      {infos > 0 && <SeverityPill count={infos} color="#38bdf8" label="bilgi" />}
                    </span>
                  </button>

                  {expanded && (
                    <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                      {group.items.slice(0, 300).map((f: any) => {
                        const fStatus = f.status || 'OPEN';
                        const sev = f.severity;
                        const sevColor = sev === 'ERROR' ? '#ef4444' : sev === 'WARN' ? '#f59e0b' : '#38bdf8';
                        return (
                          <div key={f.id} className="rounded-lg p-3 border flex flex-col gap-2" style={{ background: 'rgba(255,255,255,.018)', borderColor: BORDER, borderLeft: `3px solid ${sevColor}`, opacity: fStatus !== 'OPEN' ? 0.55 : 1 }}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Severity value={sev} />
                                {f.rowIndex && (<span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,.05)', color: 'rgba(250,250,249,.6)' }}>Satır {f.rowIndex}</span>)}
                                {f.hesapKodu && (<span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded" style={{ background: GOLD_SOFT, color: GOLD }}>{f.hesapKodu}</span>)}
                              </div>
                              <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: statusColor(fStatus) }}>
                                {fStatus === 'OPEN' ? '● Açık' : fStatus === 'RESOLVED' ? '✓ Çözüldü' : '∅ Görmezden'}
                              </span>
                            </div>
                            <div className="text-[12.5px] leading-snug" style={{ color: '#fafaf9' }}>{f.message}</div>
                            <div className="flex items-center justify-between gap-2 pt-1 mt-auto" style={{ borderTop: `1px solid ${BORDER}` }}>
                              <button onClick={() => focusFinding(f)} className="text-[10px] underline" style={{ color: 'rgba(250,250,249,.5)' }}>Satırı incele →</button>
                              <div className="flex items-center gap-1">
                                {fStatus !== 'RESOLVED' && (
                                  <button onClick={() => handleStatusChange(f, 'RESOLVED')} title="Çözüldü" className="h-6 px-2 rounded text-[10px] font-semibold inline-flex items-center gap-1" style={{ background: 'rgba(34,197,94,.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,.2)' }}>
                                    <CheckCircle2 size={11} /> Çöz
                                  </button>
                                )}
                                {fStatus !== 'IGNORED' && (
                                  <button onClick={() => handleStatusChange(f, 'IGNORED')} title="Görmezden gel" className="h-6 px-2 rounded text-[10px] font-semibold inline-flex items-center gap-1" style={{ background: 'rgba(148,163,184,.10)', color: '#94a3b8', border: '1px solid rgba(148,163,184,.2)' }}>
                                    <EyeOff size={11} /> Geç
                                  </button>
                                )}
                                {fStatus !== 'OPEN' && (
                                  <button onClick={() => handleStatusChange(f, 'OPEN')} title="Yeniden aç" className="h-6 px-2 rounded text-[10px] font-semibold inline-flex items-center gap-1" style={{ background: GOLD_SOFT, color: GOLD, border: `1px solid ${BORDER_STRONG}` }}>
                                    <RotateCcw size={11} /> Aç
                                  </button>
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

          {/* Mizan — bulgular altında ince bir bant */}
          {mizan && (
            <div className="rounded-xl p-3.5" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-2 mb-2">
                <FileSpreadsheet size={14} style={{ color: GOLD }} />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#fafaf9' }}>Mizan Kontrolü</span>
                <span className="text-xs tabular-nums ml-auto" style={{ color: mizan?.anomalyCount ? '#f59e0b' : 'rgba(250,250,249,.45)' }}>{mizan.hesapCount || 0} hesap · {mizan.anomalyCount || 0} bulgu</span>
              </div>
              {mizanAnomalies.length === 0 ? (
                <div className="text-xs px-2 py-1.5 rounded" style={{ background: 'rgba(34,197,94,.08)', color: '#86efac' }}>Mizan kontrolünde bulgu yok.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {mizanAnomalies.slice(0, 8).map((a: any) => (
                    <div key={a.id} className="flex items-start gap-2 text-xs p-2 rounded" style={{ background: 'rgba(255,255,255,.02)' }}>
                      <Severity value={a.seviye || 'WARN'} />
                      <span className="font-semibold" style={{ color: 'rgba(250,250,249,.9)' }}>{a.hesapKodu}</span>
                      <span style={{ color: 'rgba(250,250,249,.7)' }}>{a.mesaj}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB: SATIRLAR — tam ekran tablo */}
      {activeTab === 'SATIRLAR' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-10 rounded-lg px-3 flex items-center gap-2 flex-1 min-w-[300px]" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' }}>
              <Search size={14} />
              <input value={lineSearch} onChange={(e) => setLineSearch(e.target.value)} placeholder="Satır, fiş, evrak, hesap veya açıklama ara..." className="bg-transparent outline-none text-sm w-full" style={{ color: '#fafaf9' }} />
            </div>
            <span className="text-xs tabular-nums" style={{ color: 'rgba(250,250,249,.5)' }}>{visibleLines.length}/{lines.length}</span>
            {focusedFinding && (
              <button onClick={() => setFocusedFinding(null)} className="h-10 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1" style={{ background: GOLD_SOFT, color: GOLD, border: `1px solid ${BORDER_STRONG}` }}>
                <XCircle size={12} /> Bulgu filtresini temizle
              </button>
            )}
          </div>

          <div className="rounded-xl border overflow-hidden" style={{ background: PANEL, borderColor: BORDER }}>
            <div className="overflow-auto max-h-[640px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ background: 'rgb(20,20,18)' }}>
                  <tr style={{ color: 'rgba(250,250,249,.55)', borderBottom: `1px solid ${BORDER_STRONG}` }}>
                    <th className="text-left py-2.5 px-3 font-semibold">#</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Tarih</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Fiş</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Evrak</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Hesap</th>
                    <th className="text-left py-2.5 px-3 font-semibold">Açıklama</th>
                    <th className="text-right py-2.5 px-3 font-semibold">Borç</th>
                    <th className="text-right py-2.5 px-3 font-semibold">Alacak</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.slice(0, 1000).map((line: any, idx: number) => (
                    <tr key={line.id} ref={focusedFinding?.rowIndex && Number(focusedFinding.rowIndex) === Number(line.rowIndex) ? focusedLineRef : undefined} style={{ borderBottom: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.82)', background: focusedFinding?.rowIndex && Number(focusedFinding.rowIndex) === Number(line.rowIndex) ? GOLD_SOFT : idx % 2 ? 'rgba(255,255,255,.012)' : 'transparent' }}>
                      <td className="py-2 px-3 tabular-nums" style={{ color: 'rgba(250,250,249,.45)' }}>{line.rowIndex || '-'}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{fmtDate(line.fisTarihi)}</td>
                      <td className="py-2 px-3 font-semibold" style={{ color: GOLD }}>{line.yevmiyeNo || line.fisNo || '-'}</td>
                      <td className="py-2 px-3">{line.evrakNo || '-'}</td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className="font-semibold" style={{ color: '#fafaf9' }}>{line.hesapKodu || '-'}</span>
                        <span className="ml-1.5" style={{ color: 'rgba(250,250,249,.5)' }}>{line.hesapAdi || ''}</span>
                      </td>
                      <td className="py-2 px-3 min-w-[220px]">{line.aciklama || '-'}</td>
                      <td className="py-2 px-3 text-right tabular-nums font-mono">{Number(line.borc) > 0 ? fmtTRY(line.borc) : '-'}</td>
                      <td className="py-2 px-3 text-right tabular-nums font-mono">{Number(line.alacak) > 0 ? fmtTRY(line.alacak) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {session && visibleLines.length === 0 && (<div className="py-12 text-center text-sm" style={{ color: 'rgba(250,250,249,.45)' }}>Bu filtreyle satır bulunamadı.</div>)}
              {!session && (<div className="py-12 text-center text-sm" style={{ color: 'rgba(250,250,249,.45)' }}>Bir dönem seç veya Luca'dan Detay Fiş Listesi çek.</div>)}
            </div>
          </div>
        </div>
      )}

      {/* TAB: GEÇMİŞ KONTROLLER */}
      {activeTab === 'GECMIS' && (
        <div className="space-y-3">
          {periodSessions.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: PANEL, border: `1px dashed ${BORDER_STRONG}` }}>
              <div className="inline-flex h-14 w-14 rounded-full items-center justify-center mb-3" style={{ background: GOLD_SOFT, color: GOLD }}>
                <Clock size={26} />
              </div>
              <div className="text-base font-semibold mb-1" style={{ color: '#fafaf9' }}>Henüz Detay Fiş Listesi çekilmedi</div>
              <div className="text-xs" style={{ color: 'rgba(250,250,249,.5)' }}>"Luca'dan Çek" butonu ile başlat veya manuel Excel yükle.</div>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden" style={{ background: PANEL, borderColor: BORDER }}>
              <table className="w-full text-sm">
                <thead style={{ background: 'rgba(0,0,0,.18)' }}>
                  <tr style={{ color: 'rgba(250,250,249,.55)', borderBottom: `1px solid ${BORDER}` }}>
                    <th className="text-left py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Versiyon</th>
                    <th className="text-left py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Tarih</th>
                    <th className="text-right py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Fiş</th>
                    <th className="text-right py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Satır</th>
                    <th className="text-right py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Bulgu</th>
                    <th className="text-right py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {periodSessions.map((s: any, i: number) => {
                    const isActive = activeSessionId === s.id;
                    return (
                      <tr key={s.id} onClick={() => { setSelectedSessionId(s.id); setActiveTab('BULGULAR'); }} className="cursor-pointer" style={{ borderBottom: `1px solid ${BORDER}`, background: isActive ? GOLD_SOFT : 'transparent', color: '#fafaf9' }}>
                        <td className="py-3 px-4 font-bold" style={{ color: isActive ? GOLD : '#fafaf9' }}>
                          {i === 0 ? '★ ' : ''}v{periodSessions.length - i}
                        </td>
                        <td className="py-3 px-4" style={{ color: 'rgba(250,250,249,.7)' }}>{fmtDateTime(s.createdAt)}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{s.totalVouchers}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{s.totalLines}</td>
                        <td className="py-3 px-4 text-right tabular-nums">
                          <span className="font-semibold" style={{ color: s.findingCount ? '#f59e0b' : '#22c55e' }}>{s.findingCount || 0}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-wider" style={{ background: s.findingCount ? 'rgba(245,158,11,.14)' : 'rgba(34,197,94,.14)', color: s.findingCount ? '#fbbf24' : '#22c55e' }}>
                            {s.findingCount ? `${s.findingCount} bulgu` : 'temiz'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BigStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
      <div className="text-[9px] uppercase tracking-[.18em] mb-1" style={{ color: 'rgba(250,250,249,.45)' }}>{label}</div>
      <div className="text-2xl font-bold tabular-nums leading-none" style={{ color }}>{value}</div>
    </div>
  );
}

function KpiFilter({ label, value, active, color, icon: Icon, onClick }: { label: string; value: number; active: boolean; color: string; icon: any; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-xl p-3 text-left transition-all hover:scale-[1.02]" style={{ background: active ? `${color}1c` : PANEL, border: `1px solid ${active ? `${color}55` : BORDER}` }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] uppercase tracking-[.18em]" style={{ color: active ? color : 'rgba(250,250,249,.45)' }}>{label}</span>
        <Icon size={11} style={{ color }} />
      </div>
      <div className="text-2xl font-bold tabular-nums leading-none" style={{ color }}>{value}</div>
    </button>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: any; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className="h-10 px-4 inline-flex items-center gap-2 text-sm font-semibold border-b-2 transition-colors" style={{ borderColor: active ? GOLD : 'transparent', color: active ? GOLD : 'rgba(250,250,249,.55)' }}>
      <Icon size={15} />
      {label}
      {badge != null && badge > 0 && (
        <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full" style={{ background: active ? GOLD_SOFT : 'rgba(255,255,255,.05)', color: active ? GOLD : 'rgba(250,250,249,.55)' }}>{badge}</span>
      )}
    </button>
  );
}

function SeverityPill({ count, color, label }: { count: number; color: string; label?: string }) {
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded tabular-nums inline-flex items-center gap-1" style={{ background: `${color}1c`, color }}>
      {count}{label ? ` ${label}` : ''}
    </span>
  );
}

function Severity({ value }: { value: string }) {
  const color = value === 'ERROR' ? '#ef4444' : value === 'WARN' ? '#f59e0b' : '#38bdf8';
  const label = value === 'ERROR' ? 'HATA' : value === 'WARN' ? 'UYARI' : 'BİLGİ';
  return (<span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${color}1c`, color }}>{label}</span>);
}
