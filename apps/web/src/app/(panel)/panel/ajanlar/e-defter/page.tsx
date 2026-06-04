'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, CheckCircle2, ChevronDown, ChevronRight, Clock, Download, EyeOff,
  FileSpreadsheet, FileText, History, LayoutGrid, ListChecks, Loader2, Play, RotateCcw,
  Search, Sparkles, UploadCloud, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { EDefterDonemTipi, edefterControlApi } from '@/lib/edefter-control';

// ── e-Defter modül kimliği: kurumsal lacivert/mavi (her modüle ayrı renk imzası) ──
// Palet "Sakin Uyumlu Lacivert": soğuk mavi vurgu + yumuşatılmış uyumlu semantik renkler.
const NAVY = '#5b8def';
const NAVY_SOFT = 'rgba(91,141,239,.14)';
const ERR = '#e2706f';   // hata (yumuşatılmış kırmızı)
const WARN = '#d4a85f';  // uyarı (mat altın)
const INFO = '#7fa6dd';  // bilgi (gök-mavisi)
const OK = '#5cbf8a';    // temiz/çözüldü (mat zümrüt)
const PANEL = 'rgba(255,255,255,0.025)';
const PANEL_HOVER = 'rgba(255,255,255,0.045)';
const BORDER = 'rgba(255,255,255,0.07)';
const BORDER_STRONG = 'rgba(255,255,255,0.12)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,.55)';
const MUTED2 = 'rgba(250,250,249,.42)';
const EMPTY_LIST: any[] = [];
const HERO_BG = 'radial-gradient(120% 150% at 0% 0%, rgba(59,130,246,.18), transparent 46%), radial-gradient(120% 150% at 100% 0%, rgba(99,102,241,.14), transparent 46%), #0f0d0b';
const LIGHTBAR = 'linear-gradient(90deg,#3b82f6,#5b8def,#6366f1,#38bdf8)';
const ICON_GRAD = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
const LEAD_GRAD = 'linear-gradient(135deg, rgba(91,141,239,0.20), rgba(37,99,235,0.07))';
const ARROW = (c: string) => `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23${c}' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>")`;

type Taxpayer = { id: string; firstName?: string | null; lastName?: string | null; companyName?: string | null; taxNumber?: string | null; defterTuru?: string | null; mihsapDefterTuru?: string | null };
type PeriodMode = 'GECICI' | 'AYLIK' | 'YILLIK';
type SeverityFilter = 'ALL' | 'ERROR' | 'WARN' | 'INFO';
type StatusFilter = 'OPEN' | 'ALL' | 'RESOLVED' | 'IGNORED';
type Tab = 'BULGULAR' | 'SATIRLAR' | 'MIZAN' | 'KURALLAR' | 'GECMIS';

const MONTH_LABELS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

function sevColor(s: string) { return s === 'ERROR' ? ERR : s === 'WARN' ? WARN : INFO; }
function sevLabel(s: string) { return s === 'ERROR' ? 'HATA' : s === 'WARN' ? 'UYARI' : 'BİLGİ'; }

function taxpayerName(t?: Taxpayer | null) {
  if (!t) return '-';
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || t.taxNumber || '-';
}
// Defter türü tespiti: defterTuru + mihsapDefterTuru BİRLİKTE, Türkçe varyantlar dahil.
// Uygulamanın geneliyle aynı mantık (luca.service.normalizeDefterTuru): Mihsap'tan
// senkron mükelleflerde defter türü çoğu zaman mihsapDefterTuru'da, defterTuru boş olur.
// İşletme şüphesi varsa hariç tut; aksi halde bilanço işaretlerini ara.
function isBilancoTaxpayer(t?: Taxpayer | null) {
  const raw = `${t?.defterTuru || ''} ${t?.mihsapDefterTuru || ''}`.toLocaleUpperCase('tr-TR');
  if (/İŞLETME|ISLETME|DEFTER[_\s-]*BEYAN/.test(raw)) return false;
  return /BİLANÇO|BILANÇO|BILANCO/.test(raw);
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
    FIS_TARIHI_PARSE_HATASI: 'Fiş tarihi parse hatası',
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
    KDV_TAHAKKUK_EKSIK: 'KDV tahakkuk eksik',
    KDV_ODENECEK_360_UYUMSUZ: 'Ödenecek KDV 360\'a aktarılmamış',
    KDV_DEVREDEN_190_UYUMSUZ: 'Devreden KDV 190\'a aktarılmamış',
    DONEM_SONU_191_BAKIYE: '191 dönem sonu bakiye var',
    DONEM_SONU_391_BAKIYE: '391 dönem sonu bakiye var',
    BORDRO_TAHAKKUK_EKSIK: 'Bordro tahakkuk eksik (aylık)',
    KIRA_STOPAJI_EKSIK: 'Kira stopajı kesilmemiş',
    KIRA_STOPAJI_ORAN: 'Kira stopaj oranı sapma',
    SMM_STOPAJI_KONTROL: 'Serbest meslek stopaj eksik',
    DAMGA_VERGISI_KONTROL: 'Damga vergisi eksik',
    ACILIS_FISI_YOK: 'Açılış fişi yok',
    ACILIS_FISINDE_GELIR_GIDER: 'Açılış fişinde gelir/gider hesabı',
    YILLIK_KAPANIS_690_EKSIK: 'Yıllık kapanış 690 eksik',
    AVANS_KAPANMAMIS_159: '159 Verilen avans açık',
    AVANS_KAPANMAMIS_340: '340 Alınan avans açık',
    CEK_SENET_BAKIYE_121: '121 Alınan çek bakiyesi',
    CEK_SENET_BAKIYE_122: '122 Alınan senet bakiyesi',
    CEK_SENET_BAKIYE_322: '322 Verilen çek bakiyesi',
    CEK_SENET_BAKIYE_323: '323 Verilen senet bakiyesi',
    BANKA_EKSI_BAKIYE_102: '102 Banka eksi bakiye (kredi?)',
    POS_VALOR_108_BAKIYE: '108 POS valör bakiyesi',
    KKEG_689_KONTROL: '689 KKEG kontrolü',
    YILSONU_AMORTISMAN_EKSIK: 'Yıl sonu amortisman eksik',
    VERGI_KARSILIGI_370_YOK: '370 Vergi karşılığı yok',
    BENFORD_SAPMA: 'Benford yasası sapması',
    YUVARLAK_TUTAR_YIGILMASI: 'Yuvarlak tutar yığılması',
    HAFTA_SONU_KAYDI: 'Hafta sonu kaydı',
    SUPHELI_ACIKLAMA: 'Şüpheli açıklama',
  };
  return dict[code] || code.replace(/_/g, ' ').toLocaleLowerCase('tr-TR');
}

function categoryGroup(code: string): { id: string; label: string; order: number; icon: string } {
  if (code === 'DEFTER_GENELI_DENGESIZ') return { id: 'temel', label: 'Temel Bütünlük', order: 0, icon: '🔍' };
  if (code.startsWith('VKN_')) return { id: 'vkn', label: 'VKN / TCKN Doğrulama', order: 1, icon: '🆔' };
  if (code === 'GERCEK_MUKERRER_FATURA' || code === 'AYNI_GUN_AYNI_TUTAR_AYNI_TARAF') return { id: 'mukerrer', label: 'Mükerrer Kayıt Kontrolü', order: 2, icon: '⚠️' };
  if (code === 'HAVADA_KDV_KAYDI' || code.startsWith('KDV_') || code === 'DONEM_SONU_191_BAKIYE' || code === 'DONEM_SONU_391_BAKIYE') return { id: 'kdv', label: 'KDV Kontrolleri', order: 3, icon: '🧾' };
  if (code.startsWith('CARI_TERS_BAKIYE')) return { id: 'cari', label: 'Cari Hesap Tutarlılığı', order: 4, icon: '👥' };
  if (code === 'ORTAK_ALACAK_FAIZ_RISKI') return { id: 'ortak', label: 'Ortak Alacakları / KKEG', order: 5, icon: '⚖️' };
  if (code.startsWith('KASA_')) return { id: 'tevsik', label: 'Tevsik / Kasa', order: 6, icon: '💰' };
  if (code.startsWith('YEVMIYE_') || code === 'FIS_DENGESIZ' || code === 'BOS_FIS' || code === 'TEK_SATIRLI_FIS')
    return { id: 'yevmiye', label: 'Yevmiye / Fiş Bütünlüğü', order: 7, icon: '📋' };
  if (code.includes('BELGE')) return { id: 'belge', label: 'Belge / Evrak', order: 8, icon: '📄' };
  if (code === 'HESAP_KODU_EKSIK' || code === 'FIS_TARIHI_EKSIK' || code === 'FIS_TARIHI_PARSE_HATASI' || code === 'DONEM_DISI_TARIH')
    return { id: 'tem2', label: 'Temel Bütünlük', order: 0, icon: '🔍' };
  if (code === 'YUKSEK_TUTAR_ACIKLAMA_EKSIK') return { id: 'aciklama', label: 'Açıklama / Kalite', order: 10, icon: '📝' };
  if (code === 'BORDRO_TAHAKKUK_EKSIK') return { id: 'bordro', label: 'Bordro / SGK', order: 5, icon: '👷' };
  if (code.startsWith('KIRA_STOPAJI') || code === 'SMM_STOPAJI_KONTROL' || code === 'DAMGA_VERGISI_KONTROL') return { id: 'stopaj', label: 'Stopaj / Vergi Kesintisi', order: 6, icon: '💸' };
  if (code === 'ACILIS_FISI_YOK' || code === 'ACILIS_FISINDE_GELIR_GIDER' || code === 'YILLIK_KAPANIS_690_EKSIK' || code === 'VERGI_KARSILIGI_370_YOK' || code === 'YILSONU_AMORTISMAN_EKSIK') return { id: 'donem-baslangic', label: 'Açılış / Kapanış / Yıl Sonu', order: 7, icon: '📅' };
  if (code.startsWith('AVANS_KAPANMAMIS')) return { id: 'avans', label: 'Avans Hesapları', order: 8, icon: '💳' };
  if (code.startsWith('CEK_SENET_BAKIYE')) return { id: 'cek-senet', label: 'Çek / Senet', order: 9, icon: '📜' };
  if (code === 'BANKA_EKSI_BAKIYE_102' || code === 'POS_VALOR_108_BAKIYE') return { id: 'banka', label: 'Banka / POS', order: 10, icon: '🏦' };
  if (code === 'KKEG_689_KONTROL') return { id: 'kkeg', label: 'KKEG / KVK', order: 11, icon: '⚖️' };
  if (code === 'BENFORD_SAPMA' || code === 'YUVARLAK_TUTAR_YIGILMASI' || code === 'HAFTA_SONU_KAYDI' || code === 'SUPHELI_ACIKLAMA') return { id: 'forensic', label: 'Forensic / Anomali', order: 12, icon: '🔬' };
  return { id: 'diger', label: 'Diğer', order: 99, icon: '•' };
}

// Bulgu kategorisi → mevzuat dayanağı (müşteri raporu güveni; salt görsel, kod ↔ referans haritası)
const MEVZUAT_REF: Record<string, string> = {
  KASA_GUNLUK_30000_TEVSIK_RISKI: 'VUK 459', KASA_TEVSIK_PARCALAMA: 'VUK 459',
  FIS_DENGESIZ: 'VUK 219', DEFTER_GENELI_DENGESIZ: 'VUK 219', DONEM_DISI_TARIH: 'VUK 219',
  YEVMIYE_NO_MUKERRER: 'VUK 219', YEVMIYE_NO_ATLAMA: 'VUK 219', YEVMIYE_TARIH_SIRASI: 'VUK 219',
  BELGE_TARIHI_FIS_TARIHINDEN_SONRA: 'VUK 219', BELGE_TARIHI_DONEM_DISI: 'VUK 219',
  HAVADA_KDV_KAYDI: 'KDVK 29', KDV_TAHAKKUK_EKSIK: 'KDVK 41', KDV_ODENECEK_360_UYUMSUZ: 'KDVK 41',
  KDV_DEVREDEN_190_UYUMSUZ: 'KDVK 29', DONEM_SONU_191_BAKIYE: 'KDVK 29', DONEM_SONU_391_BAKIYE: 'KDVK 41',
  KIRA_STOPAJI_EKSIK: 'GVK 94', KIRA_STOPAJI_ORAN: 'GVK 94', SMM_STOPAJI_KONTROL: 'GVK 94', DAMGA_VERGISI_KONTROL: 'Damga V.K.',
  VKN_FORMAT_HATALI: 'VUK 230', VKN_ALGORITMA_HATALI: 'VUK 230',
  GERCEK_MUKERRER_FATURA: 'KDVK 29', AYNI_GUN_AYNI_TUTAR_AYNI_TARAF: 'BDS 240',
  ORTAK_ALACAK_FAIZ_RISKI: 'KVK 13', KKEG_689_KONTROL: 'KVK 11',
  BANKA_EKSI_BAKIYE_102: 'TDHP', YILSONU_AMORTISMAN_EKSIK: 'VUK 313/333',
  ACILIS_FISINDE_GELIR_GIDER: 'TDHP', YILLIK_KAPANIS_690_EKSIK: 'TDHP', VERGI_KARSILIGI_370_YOK: 'KVK 32',
  BENFORD_SAPMA: 'Benford · VEDAS', YUVARLAK_TUTAR_YIGILMASI: 'Forensic', HAFTA_SONU_KAYDI: 'BDS 240', SUPHELI_ACIKLAMA: 'BDS 240',
};

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

  const { data: allTaxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => apiArray<Taxpayer>(r.data)),
  });
  // Sadece bilanço usulüne tabi mükellefler (e-Defter mükellefi olabilir).
  // Hem defterTuru hem mihsapDefterTuru'ya bakılır — Mihsap senkronunda tür mihsapDefterTuru'da olabilir.
  const taxpayers = useMemo(() => allTaxpayers.filter(isBilancoTaxpayer), [allTaxpayers]);
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

  const reanalyzeMut = useMutation({
    mutationFn: () => edefterControlApi.reanalyze(activeSessionId!),
    onSuccess: (data: any) => {
      qc.setQueryData(['edefter-control-session', activeSessionId], data);
      qc.invalidateQueries({ queryKey: ['edefter-control-list', taxpayerId] });
      toast.success('Mevcut Excel snapshot yeniden analiz edildi');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Yeniden analiz edilemedi'),
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

  const allFindings = useMemo<any[]>(() => (Array.isArray(session?.findings) ? session.findings : EMPTY_LIST), [session?.findings]);
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
  const mizanAnomalies = useMemo(() => {
    return (mizan?.anomaliler || []) as any[];
  }, [mizan]);

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
    if (groupedFindings.length === 0) return;
    setExpandedGroups((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const g of groupedFindings) {
        if (next[g.id] === undefined) {
          next[g.id] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [groupedFindings]);

  const lines = useMemo<any[]>(() => (Array.isArray(session?.lines) ? session.lines : EMPTY_LIST), [session?.lines]);
  const visibleLines = useMemo(() => {
    const query = lineSearch.trim().toLocaleLowerCase('tr-TR');

    // Focus aktifse, fis butununu kapsa
    let focusedRows: Set<number> | null = null;
    if (focusedFinding && lines.length > 0) {
      focusedRows = new Set<number>();
      const fVoucherKey = focusedFinding?.voucherKey || null;
      const fRowIndex = focusedFinding?.rowIndex ? Number(focusedFinding.rowIndex) : null;
      const focusedLine: any = fRowIndex != null ? lines.find((l: any) => Number(l.rowIndex) === fRowIndex) : null;
      const fFisNo = focusedLine?.fisNo || null;
      const fYevmiyeNo = focusedLine?.yevmiyeNo || null;

      // 1) Ayni voucherKey
      if (fVoucherKey) {
        for (const l of lines) if (l.voucherKey === fVoucherKey) focusedRows.add(Number(l.rowIndex));
      }
      // 2) Ayni yevmiye no (varsa)
      if (fYevmiyeNo) {
        for (const l of lines) if (l.yevmiyeNo === fYevmiyeNo) focusedRows.add(Number(l.rowIndex));
      }
      // 3) Ayni fis no (varsa)
      if (fFisNo) {
        for (const l of lines) if (l.fisNo === fFisNo) focusedRows.add(Number(l.rowIndex));
      }
      // 4) Tek satir kaldiysa +/-5 satir baglam ekle
      if (focusedRows.size <= 1 && fRowIndex != null) {
        for (const l of lines) {
          const ri = Number(l.rowIndex);
          if (Math.abs(ri - fRowIndex) <= 5) focusedRows.add(ri);
        }
      }
    }

    return lines.filter((line: any) => {
      if (focusedRows && !focusedRows.has(Number(line.rowIndex))) return false;
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

  const statusColor = (s: string) => s === 'RESOLVED' ? OK : s === 'IGNORED' ? '#94a3b8' : NAVY;
  const handleStatusChange = (f: any, status: 'OPEN' | 'RESOLVED' | 'IGNORED') => {
    if ((f.status || 'OPEN') === status) return;
    statusMut.mutate({ findingId: f.id, status });
    if (status !== 'OPEN') toast.success(status === 'RESOLVED' ? 'Bulgu çözüldü olarak işaretlendi' : 'Bulgu görmezden gelindi');
    else toast.info('Bulgu yeniden açıldı');
  };

  // ── Denetim skoru (0-100): açık bulgulardan türetilir, yalnızca görsel ──
  const hasData = !!session;
  const scoreColor = stats.error > 0 ? ERR : stats.warn > 0 ? WARN : OK;
  const score = !hasData ? null : (stats.total === 0 ? 100 : Math.max(0, Math.round(100 - (stats.error * 10 + stats.warn * 3 + stats.info * 0.5))));
  const scoreLabel = !hasData ? 'Veri yok' : stats.total === 0 ? 'Temiz' : stats.error > 0 ? 'Kritik' : stats.warn > 0 ? 'Dikkat' : 'İyi';
  const scoreHint = !hasData ? 'Bir dönem seç veya Luca’dan Detay Fiş Listesi çek.'
    : stats.total === 0 ? 'Defter ön kontrolden temiz geçti.'
    : stats.error > 0 ? `${stats.error} hata düzeltilmeden berat oluşturmayın.`
    : stats.warn > 0 ? `${stats.warn} uyarı incelenmeli; hata yok.`
    : 'Yalnızca bilgi düzeyinde not var.';

  const sevTotal = stats.error + stats.warn + stats.info;
  const pct = (n: number) => (sevTotal > 0 ? (n / sevTotal) * 100 : 0);

  const toggleSeverity = (s: SeverityFilter) => { setSeverityFilter(severityFilter === s ? 'ALL' : s); setActiveTab('BULGULAR'); };
  const pickStatus = (s: StatusFilter) => { setStatusFilter(s); setActiveTab('BULGULAR'); };

  // PDF müşteri raporu — bağımlılıksız: yazdırma penceresi açar, kullanıcı "PDF olarak kaydet" der.
  const printReport = () => {
    if (!session) { toast.error('Önce bir dönem verisi yükleyin'); return; }
    const w = window.open('', '_blank');
    if (!w) { toast.error('Açılır pencere engellendi; tarayıcı pop-up iznini açın'); return; }
    const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]));
    const sevTxt = (s: string) => s === 'ERROR' ? 'HATA' : s === 'WARN' ? 'UYARI' : 'BİLGİ';
    const sevC = (s: string) => s === 'ERROR' ? '#c0392b' : s === 'WARN' ? '#b8860b' : '#2e6da4';
    const scoreC = scoreColor === OK ? '#2e7d52' : scoreColor === WARN ? '#b8860b' : '#c0392b';
    const gmap = new Map<string, { label: string; order: number; items: any[] }>();
    for (const f of allFindings) {
      const g = categoryGroup(f.category);
      if (!gmap.has(g.id)) gmap.set(g.id, { label: g.label, order: g.order, items: [] });
      gmap.get(g.id)!.items.push(f);
    }
    const groups = [...gmap.values()].sort((a, b) => a.order - b.order);
    const body = groups.map((g) => `
      <h2>${esc(g.label)} <span class="cnt">${g.items.length}</span></h2>
      <table><thead><tr><th>Seviye</th><th>Bulgu</th><th>Yer</th><th>Dayanak</th><th>Durum</th></tr></thead><tbody>
      ${g.items.map((f: any) => `<tr>
        <td><span class="sev" style="color:${sevC(f.severity)};border-color:${sevC(f.severity)}">${sevTxt(f.severity)}</span></td>
        <td>${esc(f.message)}</td>
        <td class="nw">${f.rowIndex ? 'Satır ' + esc(f.rowIndex) : ''}${f.hesapKodu ? ' · ' + esc(f.hesapKodu) : ''}</td>
        <td class="nw">${MEVZUAT_REF[f.category] ? esc(MEVZUAT_REF[f.category]) : '-'}</td>
        <td class="nw">${(f.status || 'OPEN') === 'OPEN' ? 'Açık' : f.status === 'RESOLVED' ? 'Çözüldü' : 'Görmezden'}</td>
      </tr>`).join('')}
      </tbody></table>`).join('');
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>e-Defter Ön Kontrol Raporu</title><style>
      *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;margin:32px;font-size:12px;line-height:1.5}
      .top{border-bottom:3px solid #1d4ed8;padding-bottom:14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
      .eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#1d4ed8;font-weight:700}
      h1{font-size:19px;margin:4px 0 2px} .meta{color:#555;font-size:11px}
      .score{text-align:center;border:2px solid ${scoreC};border-radius:10px;padding:8px 14px;min-width:92px}
      .score .n{font-size:30px;font-weight:800;line-height:1;color:${scoreC}} .score .l{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#666;margin-top:3px}
      .sum{display:flex;gap:22px;margin:8px 0 18px;flex-wrap:wrap} .sum div{font-size:11px;color:#555} .sum b{font-size:17px;display:block;color:#1a1a1a}
      h2{font-size:13px;margin:18px 0 6px;border-left:4px solid #1d4ed8;padding-left:8px} .cnt{font-size:10px;color:#999;font-weight:400}
      table{width:100%;border-collapse:collapse;margin-bottom:6px} th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#777;border-bottom:1px solid #ccc;padding:5px 6px}
      td{border-bottom:1px solid #eee;padding:5px 6px;vertical-align:top} td.nw{white-space:nowrap;color:#555}
      .sev{font-size:9px;font-weight:700;border:1px solid;border-radius:4px;padding:1px 5px;white-space:nowrap}
      footer{margin-top:24px;border-top:1px solid #ddd;padding-top:10px;font-size:10px;color:#999;display:flex;justify-content:space-between;gap:16px}
      @media print{body{margin:14mm}}
      </style></head><body>
      <div class="top"><div>
        <div class="eyebrow">e-Defter Ön Kontrol Raporu</div>
        <h1>${esc(taxpayerName(selectedTp))}</h1>
        <div class="meta">${esc(periodDescriptor(periodMode, year, quarter, month))} · ${session.totalVouchers ?? 0} fiş · ${session.totalLines ?? 0} satır · Rapor: ${esc(new Date().toLocaleString('tr-TR'))}</div>
      </div><div class="score"><div class="n">${score ?? '—'}</div><div class="l">${esc(scoreLabel)}</div></div></div>
      <div class="sum"><div>Toplam<b>${stats.total}</b></div><div>Açık<b>${stats.open}</b></div><div style="color:#c0392b">Hata<b>${stats.error}</b></div><div style="color:#b8860b">Uyarı<b>${stats.warn}</b></div><div style="color:#2e6da4">Bilgi<b>${stats.info}</b></div><div style="color:#2e7d52">Çözüldü<b>${stats.resolved}</b></div></div>
      ${allFindings.length === 0 ? '<p>Bu dönem için bulgu üretilmedi — defter ön kontrolden temiz geçti.</p>' : body}
      <footer><span>Moren Mali Müşavirlik · e-Defter Ön Kontrol</span><span>Yapay zekâ destekli ön kontroldür; nihai değerlendirme mali müşavire aittir.</span></footer>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
      </body></html>`;
    w.document.write(html);
    w.document.close();
    toast.success('PDF raporu hazırlandı; yazdır penceresinden "PDF olarak kaydet" seçin');
  };

  const selectStyle = (accent = false): CSSProperties => ({
    background: PANEL, border: `1px solid ${accent ? BORDER_STRONG : BORDER}`, color: accent ? NAVY : TEXT,
    backgroundImage: ARROW('5b8def'), backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: '24px',
  });

  return (
    <div className="space-y-4">
      {/* ════════ BAŞLIK + DENETİM SKORU ════════ */}
      <div className="relative rounded-2xl overflow-hidden border" style={{ borderColor: BORDER_STRONG, background: HERO_BG }}>
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: LIGHTBAR }} />
        <div className="px-5 pt-5 pb-4 flex flex-wrap items-center gap-5">
          {/* Sol: kimlik */}
          <div className="flex items-center gap-3.5 flex-1 min-w-[300px]">
            <span className="grid h-12 w-12 place-items-center rounded-2xl shrink-0" style={{ background: ICON_GRAD, boxShadow: '0 8px 22px rgba(59,130,246,0.40)' }}>
              <BookOpen size={23} style={{ color: '#0b1220' }} />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-bold tracking-[.22em] mb-0.5" style={{ color: NAVY }}>e-Defter Ön Kontrol</div>
              <h1 className="truncate" style={{ fontFamily: 'Fraunces, serif', fontSize: 23, fontWeight: 600, color: TEXT, lineHeight: 1.18 }}>
                {taxpayerName(selectedTp)}
              </h1>
              <div className="text-xs mt-1 flex items-center gap-2 flex-wrap" style={{ color: MUTED }}>
                <span>{periodDescriptor(periodMode, year, quarter, month)}</span>
                <span style={{ color: MUTED2 }}>·</span><span className="tabular-nums">{session?.totalVouchers ?? 0} fiş</span>
                <span style={{ color: MUTED2 }}>·</span><span className="tabular-nums">{session?.totalLines ?? 0} satır</span>
                {session?.createdAt && (<><span style={{ color: MUTED2 }}>·</span><span>Son kontrol {fmtDateTime(session.createdAt)}</span></>)}
              </div>
            </div>
          </div>
          {/* Sağ: denetim skoru göstergesi */}
          <div className="flex items-center gap-4">
            <Gauge score={score} color={scoreColor} hasData={hasData} />
            <div className="flex flex-col gap-1.5 max-w-[180px]">
              <span className="text-[11px] font-extrabold uppercase tracking-[.08em] px-2.5 py-1 rounded-lg w-fit"
                style={{ background: `${hasData ? scoreColor : '#94a3b8'}22`, color: hasData ? scoreColor : '#94a3b8', border: `1px solid ${hasData ? scoreColor : '#94a3b8'}44` }}>
                {scoreLabel}
              </span>
              <span className="text-[11.5px] leading-snug" style={{ color: MUTED }}>{scoreHint}</span>
            </div>
          </div>
        </div>

        {/* Aksiyonlar */}
        <div className="px-5 pb-4 flex flex-wrap items-center gap-2">
          <button disabled={!taxpayerId || fetchMut.isPending || !!lucaJobId} onClick={() => fetchMut.mutate()} className="h-9 px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: 'rgba(91,141,239,.18)', color: NAVY, border: '1px solid rgba(91,141,239,.34)' }}>
            {fetchMut.isPending || lucaJobId ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Luca'dan Çek
          </button>
          <button disabled={!activeSessionId || exportMut.isPending} onClick={() => exportMut.mutate()} className="h-9 px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40" style={{ background: PANEL, color: 'rgba(250,250,249,.85)', border: `1px solid ${BORDER_STRONG}` }}>
            {exportMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Excel
          </button>
          <button disabled={!activeSessionId} onClick={printReport} className="h-9 px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40" style={{ background: PANEL, color: 'rgba(250,250,249,.85)', border: `1px solid ${BORDER_STRONG}` }}>
            <FileText size={13} /> PDF Rapor
          </button>
          <button disabled={!activeSessionId || reanalyzeMut.isPending} onClick={() => reanalyzeMut.mutate()} className="h-9 px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40" style={{ background: PANEL, color: 'rgba(250,250,249,.85)', border: `1px solid ${BORDER_STRONG}` }}>
            {reanalyzeMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Yeniden Analiz
          </button>
          <label className="h-9 px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer" style={{ background: PANEL, color: 'rgba(250,250,249,.75)', border: `1px solid ${BORDER}` }}>
            <UploadCloud size={13} /> Yükle
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadMut.mutate(file); e.currentTarget.value = ''; }} />
          </label>
        </div>

        {/* Seçici bandı */}
        <div className="px-5 py-2.5 flex flex-wrap items-center gap-2" style={{ background: 'rgba(0,0,0,.24)', borderTop: `1px solid ${BORDER}` }}>
          <select value={taxpayerId} onChange={(e) => { setTaxpayerId(e.target.value); setSelectedSessionId(null); }} className="h-8 rounded-md px-2 text-xs min-w-[260px] appearance-none cursor-pointer" style={selectStyle()}>
            {taxpayers.length === 0 && (<option value="" style={{ background: '#1a1a17', color: TEXT }}>Bilanço mükellefi yok</option>)}
            {taxpayers.map((t) => (<option key={t.id} value={t.id} style={{ background: '#1a1a17', color: TEXT }}>{taxpayerName(t)}</option>))}
          </select>
          <input type="number" value={year} onChange={(e) => { setYear(Number(e.target.value) || now.getFullYear()); setSelectedSessionId(null); }} className="h-8 rounded-md px-2 text-xs w-20 tabular-nums" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: TEXT }} />
          <div className="flex h-8 rounded-md overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            {(['GECICI', 'AYLIK', 'YILLIK'] as PeriodMode[]).map((mode) => (
              <button key={mode} onClick={() => { setPeriodMode(mode); setSelectedSessionId(null); }} className="px-2.5 text-[11px] font-semibold" style={{ background: periodMode === mode ? 'rgba(91,141,239,.18)' : PANEL, color: periodMode === mode ? NAVY : 'rgba(250,250,249,.6)', borderRight: mode !== 'YILLIK' ? `1px solid ${BORDER}` : undefined }}>
                {mode === 'GECICI' ? 'Geçici' : mode === 'AYLIK' ? 'Aylık' : 'Yıllık'}
              </button>
            ))}
          </div>
          {periodMode === 'GECICI' && (
            <div className="flex h-8 rounded-md overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
              {[1, 2, 3, 4].map((q) => (
                <button key={q} onClick={() => { setQuarter(q); setSelectedSessionId(null); }} className="px-2.5 text-[11px] font-semibold" style={{ background: quarter === q ? 'rgba(91,141,239,.18)' : PANEL, color: quarter === q ? NAVY : 'rgba(250,250,249,.65)', borderRight: q < 4 ? `1px solid ${BORDER}` : undefined }}>
                  {q}
                </button>
              ))}
            </div>
          )}
          {periodMode === 'AYLIK' && (
            <select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setSelectedSessionId(null); }} className="h-8 rounded-md px-2 text-xs appearance-none cursor-pointer" style={selectStyle()}>
              {MONTH_LABELS.map((label, i) => (<option key={i + 1} value={i + 1} style={{ background: '#1a1a17', color: TEXT }}>{label}</option>))}
            </select>
          )}
          {periodSessions.length > 1 && (
            <select value={activeSessionId || ''} onChange={(e) => setSelectedSessionId(e.target.value)} className="h-8 rounded-md px-2 text-xs ml-auto appearance-none cursor-pointer" style={selectStyle(true)}>
              {periodSessions.map((s: any, i: number) => (
                <option key={s.id} value={s.id} style={{ background: '#1a1a17', color: TEXT }}>{i === 0 ? '★ ' : ''}v{periodSessions.length - i} · {fmtDateTime(s.createdAt)} · {s.findingCount} bulgu</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {lucaStatus && (
        <div className="rounded-xl px-4 py-2.5 text-xs flex items-center gap-2" style={{ background: 'rgba(91,141,239,.08)', border: '1px solid rgba(91,141,239,.20)', color: '#bfd4ff' }}>
          <Loader2 size={13} className="animate-spin shrink-0" /> {lucaStatus}
        </div>
      )}

      {/* ════════ DENETİM ÖZETİ ════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.45fr_1fr] gap-3.5">
        {/* Şiddet dağılımı */}
        <div className="rounded-2xl border p-4" style={{ background: PANEL, borderColor: BORDER }}>
          <div className="text-[10px] uppercase tracking-[.18em] font-bold mb-3.5" style={{ color: MUTED2 }}>
            Şiddet Dağılımı {sevTotal > 0 && <span style={{ color: MUTED }}>· {sevTotal} açık bulgu</span>}
          </div>
          <div className="h-3.5 rounded-lg overflow-hidden flex" style={{ background: 'rgba(255,255,255,.05)' }}>
            <div style={{ width: `${pct(stats.error)}%`, background: ERR, transition: 'width .3s' }} />
            <div style={{ width: `${pct(stats.warn)}%`, background: WARN, transition: 'width .3s' }} />
            <div style={{ width: `${pct(stats.info)}%`, background: INFO, transition: 'width .3s' }} />
          </div>
          <div className="flex items-center gap-5 mt-3.5 flex-wrap">
            <LegendItem color={ERR} label="Hata" value={stats.error} active={severityFilter === 'ERROR'} onClick={() => toggleSeverity('ERROR')} />
            <LegendItem color={WARN} label="Uyarı" value={stats.warn} active={severityFilter === 'WARN'} onClick={() => toggleSeverity('WARN')} />
            <LegendItem color={INFO} label="Bilgi" value={stats.info} active={severityFilter === 'INFO'} onClick={() => toggleSeverity('INFO')} />
            <div className="ml-auto flex flex-col items-end">
              <span className="text-[19px] font-bold tabular-nums leading-none" style={{ color: OK }}>{groupedFindings.length}</span>
              <span className="text-[11px]" style={{ color: MUTED }}>Kategori</span>
            </div>
          </div>
        </div>
        {/* Bulgu durumu */}
        <div className="rounded-2xl border p-4" style={{ background: PANEL, borderColor: BORDER }}>
          <div className="text-[10px] uppercase tracking-[.18em] font-bold mb-3.5" style={{ color: MUTED2 }}>Bulgu Durumu</div>
          <div className="grid grid-cols-2 gap-2.5">
            <Metric label="Toplam" value={stats.total} color={TEXT} active={statusFilter === 'ALL'} onClick={() => pickStatus('ALL')} />
            <Metric label="Açık" value={stats.open} color={NAVY} lead active={statusFilter === 'OPEN'} onClick={() => pickStatus('OPEN')} />
            <Metric label="Çözüldü" value={stats.resolved} color={OK} active={statusFilter === 'RESOLVED'} onClick={() => pickStatus('RESOLVED')} />
            <Metric label="Görmezden" value={stats.ignored} color="#94a3b8" active={statusFilter === 'IGNORED'} onClick={() => pickStatus('IGNORED')} />
          </div>
        </div>
      </div>

      {/* ════════ SEKMELER ════════ */}
      <div className="flex items-center gap-1 border-b" style={{ borderColor: BORDER_STRONG }}>
        <TabButton active={activeTab === 'BULGULAR'} onClick={() => setActiveTab('BULGULAR')} icon={LayoutGrid} label="Bulgular" badge={stats.open} />
        <TabButton active={activeTab === 'SATIRLAR'} onClick={() => setActiveTab('SATIRLAR')} icon={ListChecks} label="Fiş Satırları" badge={lines.length} />
        <TabButton active={activeTab === 'MIZAN'} onClick={() => setActiveTab('MIZAN')} icon={FileSpreadsheet} label="Mizan Denetimi" badge={mizan?.anomalyCount} />
        <TabButton active={activeTab === 'KURALLAR'} onClick={() => setActiveTab('KURALLAR')} icon={Sparkles} label="Kontrol Kuralları" />
        <TabButton active={activeTab === 'GECMIS'} onClick={() => setActiveTab('GECMIS')} icon={History} label="Geçmiş Kontroller" badge={periodSessions.length} />
      </div>

      {/* ════════ TAB: BULGULAR ════════ */}
      {activeTab === 'BULGULAR' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-10 rounded-lg px-3 flex items-center gap-2 flex-1 min-w-[300px]" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' }}>
              <Search size={14} />
              <input value={findingSearch} onChange={(e) => setFindingSearch(e.target.value)} placeholder="Bulgu, satır, fiş veya hesap ara..." className="bg-transparent outline-none text-sm w-full" style={{ color: TEXT }} />
            </div>
            <span className="text-xs tabular-nums" style={{ color: MUTED }}>{visibleFindings.length}/{stats.total} bulgu</span>
            {(severityFilter !== 'ALL' || statusFilter !== 'OPEN' || findingSearch) && (
              <button onClick={() => { setSeverityFilter('ALL'); setStatusFilter('OPEN'); setFindingSearch(''); }} className="h-10 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1" style={{ background: PANEL, color: 'rgba(250,250,249,.75)', border: `1px solid ${BORDER}` }}>
                <RotateCcw size={12} /> Sıfırla
              </button>
            )}
          </div>

          {groupedFindings.length === 0 && (
            <div className="rounded-2xl p-12 text-center" style={{ background: PANEL, border: `1px dashed ${BORDER_STRONG}` }}>
              <div className="inline-flex h-14 w-14 rounded-full items-center justify-center mb-3" style={{ background: stats.total === 0 ? 'rgba(92,191,138,.15)' : NAVY_SOFT, color: stats.total === 0 ? OK : NAVY }}>
                {stats.total === 0 ? <CheckCircle2 size={26} /> : <Sparkles size={26} />}
              </div>
              <div className="text-base font-semibold mb-1" style={{ color: TEXT }}>
                {stats.total === 0 ? 'Bu dönem temiz görünüyor' : 'Filtrelerle eşleşen bulgu yok'}
              </div>
              <div className="text-xs" style={{ color: MUTED }}>
                {stats.total === 0 ? 'e-Defter ön kontrol bulgu üretmedi.' : 'Filtreleri sıfırlayarak tüm bulguları görebilirsiniz.'}
              </div>
            </div>
          )}

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
                      {expanded ? <ChevronDown size={15} style={{ color: NAVY }} /> : <ChevronRight size={15} style={{ color: NAVY }} />}
                      <span className="text-sm font-bold uppercase tracking-wide" style={{ color: TEXT }}>{group.label}</span>
                      <span className="text-xs tabular-nums px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,.05)', color: 'rgba(250,250,249,.7)' }}>{group.items.length}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {errs > 0 && <SeverityPill count={errs} color={ERR} label="hata" />}
                      {warns > 0 && <SeverityPill count={warns} color={WARN} label="uyarı" />}
                      {infos > 0 && <SeverityPill count={infos} color={INFO} label="bilgi" />}
                    </span>
                  </button>

                  {expanded && (
                    <div className="p-2.5 space-y-2">
                      {group.items.slice(0, 300).map((f: any) => {
                        const fStatus = f.status || 'OPEN';
                        const c = sevColor(f.severity);
                        return (
                          <div key={f.id} className="relative flex items-start gap-3.5 rounded-xl border px-3.5 py-3" style={{ background: 'rgba(255,255,255,.014)', borderColor: BORDER, opacity: fStatus !== 'OPEN' ? 0.55 : 1 }}>
                            <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full" style={{ background: c }} />
                            <span className="text-[9px] font-bold px-1.5 py-1 rounded mt-0.5 shrink-0" style={{ background: `${c}26`, color: c }}>{sevLabel(f.severity)}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13.5px] leading-snug" style={{ color: TEXT }}>{f.message}</div>
                              <div className="flex items-center gap-2 flex-wrap mt-2">
                                {f.rowIndex && (<span className="text-[10px] tabular-nums px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,.06)', color: 'rgba(250,250,249,.78)' }}>Satır {f.rowIndex}</span>)}
                                {f.hesapKodu && (<span className="text-[10px] tabular-nums px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,.06)', color: 'rgba(250,250,249,.82)' }}>{f.hesapKodu}</span>)}
                                {MEVZUAT_REF[f.category] && (<span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(91,141,239,.10)', color: '#9bc0ff', border: '1px solid rgba(91,141,239,.22)' }}>{MEVZUAT_REF[f.category]}</span>)}
                                <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: statusColor(fStatus) }}>
                                  {fStatus === 'OPEN' ? '● Açık' : fStatus === 'RESOLVED' ? '✓ Çözüldü' : '∅ Görmezden'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 self-center">
                              {(f.rowIndex || f.voucherKey) && (<button onClick={() => focusFinding(f)} className="text-[10.5px] underline whitespace-nowrap mr-1" style={{ color: MUTED }}>Satırı incele →</button>)}
                              {fStatus !== 'RESOLVED' && (
                                <button onClick={() => handleStatusChange(f, 'RESOLVED')} title="Çözüldü" className="h-7 px-2.5 rounded-md text-[10.5px] font-semibold inline-flex items-center gap-1" style={{ background: 'rgba(92,191,138,.12)', color: OK, border: '1px solid rgba(92,191,138,.24)' }}>
                                  <CheckCircle2 size={11} /> Çöz
                                </button>
                              )}
                              {fStatus !== 'IGNORED' && (
                                <button onClick={() => handleStatusChange(f, 'IGNORED')} title="Görmezden gel" className="h-7 px-2.5 rounded-md text-[10.5px] font-semibold inline-flex items-center gap-1" style={{ background: 'rgba(148,163,184,.10)', color: '#94a3b8', border: '1px solid rgba(148,163,184,.22)' }}>
                                  <EyeOff size={11} /> Geç
                                </button>
                              )}
                              {fStatus !== 'OPEN' && (
                                <button onClick={() => handleStatusChange(f, 'OPEN')} title="Yeniden aç" className="h-7 px-2.5 rounded-md text-[10.5px] font-semibold inline-flex items-center gap-1" style={{ background: NAVY_SOFT, color: NAVY, border: `1px solid ${BORDER_STRONG}` }}>
                                  <RotateCcw size={11} /> Aç
                                </button>
                              )}
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
      )}

      {/* ════════ TAB: MIZAN DENETİMİ ════════ */}
      {activeTab === 'MIZAN' && (
        <div className="space-y-3">
          {!mizan ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: PANEL, border: `1px dashed ${BORDER_STRONG}` }}>
              <div className="inline-flex h-14 w-14 rounded-full items-center justify-center mb-3" style={{ background: NAVY_SOFT, color: NAVY }}>
                <FileSpreadsheet size={26} />
              </div>
              <div className="text-base font-semibold mb-1" style={{ color: TEXT }}>Mizan henüz çekilmedi</div>
              <div className="text-xs" style={{ color: MUTED }}>"Luca'dan Çek" butonunu kullandığında aynı dönemin mizanı otomatik olarak buraya gelir.</div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <BigStat label="Toplam Hesap" value={mizan.hesapCount || 0} color={TEXT} />
                <BigStat label="Mizan Bulgusu" value={mizan.anomalyCount || 0} color={mizan.anomalyCount ? WARN : OK} />
                <div className="rounded-xl p-3" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
                  <div className="text-[9px] uppercase tracking-[.18em] mb-1" style={{ color: MUTED2 }}>Durum</div>
                  <div className="text-sm font-semibold" style={{ color: mizan.status === 'READY' ? OK : NAVY }}>{mizan.status || '-'}</div>
                </div>
                <div className="rounded-xl p-3" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
                  <div className="text-[9px] uppercase tracking-[.18em] mb-1" style={{ color: MUTED2 }}>Güncelleme</div>
                  <div className="text-xs font-semibold tabular-nums" style={{ color: TEXT }}>{fmtDateTime(mizan.updatedAt || mizan.createdAt)}</div>
                </div>
              </div>

              {mizanAnomalies.length === 0 ? (
                <div className="rounded-2xl p-10 text-center" style={{ background: 'rgba(92,191,138,.05)', border: '1px dashed rgba(92,191,138,.2)' }}>
                  <div className="inline-flex h-12 w-12 rounded-full items-center justify-center mb-3" style={{ background: 'rgba(92,191,138,.15)', color: OK }}>
                    <CheckCircle2 size={24} />
                  </div>
                  <div className="text-base font-semibold mb-1" style={{ color: '#aeddc4' }}>Mizan kontrolünde bulgu yok</div>
                  <div className="text-xs" style={{ color: MUTED }}>{mizan.hesapCount || 0} hesap kontrol edildi, mizan disiplini açısından temiz.</div>
                </div>
              ) : (
                <div className="rounded-xl border overflow-hidden" style={{ background: PANEL, borderColor: BORDER }}>
                  <table className="w-full text-sm">
                    <thead style={{ background: 'rgba(0,0,0,.18)' }}>
                      <tr style={{ color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
                        <th className="text-left py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Seviye</th>
                        <th className="text-left py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Tip</th>
                        <th className="text-left py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Hesap</th>
                        <th className="text-left py-2.5 px-4 font-semibold text-xs uppercase tracking-wider">Açıklama</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mizanAnomalies.map((a: any) => (
                        <tr key={a.id} style={{ borderBottom: `1px solid ${BORDER}`, color: TEXT }}>
                          <td className="py-2.5 px-4"><Severity value={a.seviye || 'WARN'} /></td>
                          <td className="py-2.5 px-4 text-xs font-semibold" style={{ color: 'rgba(250,250,249,.82)' }}>{a.tip || '-'}</td>
                          <td className="py-2.5 px-4 font-semibold tabular-nums" style={{ color: TEXT }}>{a.hesapKodu || '-'}</td>
                          <td className="py-2.5 px-4 text-xs" style={{ color: 'rgba(250,250,249,.85)' }}>{a.mesaj || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ════════ TAB: FİŞ SATIRLARI ════════ */}
      {activeTab === 'SATIRLAR' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-10 rounded-lg px-3 flex items-center gap-2 flex-1 min-w-[300px]" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' }}>
              <Search size={14} />
              <input value={lineSearch} onChange={(e) => setLineSearch(e.target.value)} placeholder="Satır, fiş, evrak, hesap veya açıklama ara..." className="bg-transparent outline-none text-sm w-full" style={{ color: TEXT }} />
            </div>
            <span className="text-xs tabular-nums" style={{ color: MUTED }}>{visibleLines.length}/{lines.length}</span>
            {focusedFinding && (
              <button onClick={() => setFocusedFinding(null)} className="h-10 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1" style={{ background: NAVY_SOFT, color: NAVY, border: `1px solid ${BORDER_STRONG}` }}>
                <XCircle size={12} /> Bulgu filtresini temizle
              </button>
            )}
          </div>

          {session && visibleLines.length === 0 && (<div className="rounded-2xl p-12 text-center" style={{ background: PANEL, border: `1px dashed ${BORDER_STRONG}`, color: MUTED }}>Bu filtreyle satır bulunamadı.</div>)}
          {!session && (<div className="rounded-2xl p-12 text-center" style={{ background: PANEL, border: `1px dashed ${BORDER_STRONG}`, color: MUTED }}>Bir dönem seç veya Luca'dan Detay Fiş Listesi çek.</div>)}

          <div className="space-y-3 max-h-[720px] overflow-auto pr-1">
            {(() => {
              const groups: any[] = [];
              const groupMap = new Map<string, any>();
              for (const line of visibleLines.slice(0, 1000)) {
                const key = line.voucherKey || `row-${line.rowIndex}`;
                if (!groupMap.has(key)) {
                  const g = { key, lines: [] as any[], first: line, borcSum: 0, alacakSum: 0 };
                  groupMap.set(key, g);
                  groups.push(g);
                }
                const g = groupMap.get(key);
                g.lines.push(line);
                g.borcSum += Number(line.borc || 0);
                g.alacakSum += Number(line.alacak || 0);
              }
              return groups.map((g) => {
                const fark = Math.abs(g.borcSum - g.alacakSum);
                const dengesiz = fark > 0.01 && g.lines.length >= 2;
                const focusedHere = focusedFinding?.rowIndex && g.lines.some((l: any) => Number(l.rowIndex) === Number(focusedFinding.rowIndex));
                return (
                  <div key={g.key} className="rounded-xl border overflow-hidden" style={{ background: PANEL, borderColor: focusedHere ? 'rgba(91,141,239,.45)' : (dengesiz ? 'rgba(226,112,111,.35)' : BORDER), borderLeftWidth: '3px', borderLeftColor: focusedHere ? NAVY : (dengesiz ? ERR : 'rgba(92,191,138,.5)') }}>
                    <div className="flex flex-wrap items-center gap-3 px-3 py-2" style={{ background: focusedHere ? 'rgba(91,141,239,.10)' : 'rgba(0,0,0,.18)', borderBottom: `1px solid ${BORDER}` }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wider" style={{ color: MUTED2 }}>Yevmiye</span>
                        <span className="text-base font-bold" style={{ color: TEXT, fontFamily: 'monospace' }}>{g.first.yevmiyeNo || g.first.fisNo || '-'}</span>
                      </div>
                      <span className="text-xs" style={{ color: MUTED }}>{fmtDate(g.first.fisTarihi)}</span>
                      {g.first.evrakNo && (<span className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,.05)', color: 'rgba(250,250,249,.65)' }}>Evrak: {g.first.evrakNo}</span>)}
                      <span className="text-xs tabular-nums ml-auto" style={{ color: MUTED }}>{g.lines.length} satır</span>
                      <span className="text-xs tabular-nums px-2 py-0.5 rounded font-mono" style={{ background: 'rgba(255,255,255,.04)', color: 'rgba(250,250,249,.8)' }}>
                        B: {fmtTRY(g.borcSum)} · A: {fmtTRY(g.alacakSum)}
                      </span>
                      {dengesiz && (<span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(226,112,111,.18)', color: ERR }}>DENGESİZ {fmtTRY(fark)}</span>)}
                    </div>
                    <table className="w-full text-xs">
                      <tbody>
                        {g.lines.map((line: any, idx: number) => (
                          <tr key={line.id} ref={focusedFinding?.rowIndex && Number(focusedFinding.rowIndex) === Number(line.rowIndex) ? focusedLineRef : undefined} style={{ borderBottom: idx < g.lines.length - 1 ? `1px solid ${BORDER}` : undefined, color: 'rgba(250,250,249,.82)', background: focusedFinding?.rowIndex && Number(focusedFinding.rowIndex) === Number(line.rowIndex) ? NAVY_SOFT : 'transparent' }}>
                            <td className="py-2 px-3 tabular-nums w-12" style={{ color: MUTED2 }}>{line.rowIndex || '-'}</td>
                            <td className="py-2 px-3 whitespace-nowrap w-44">
                              <span className="font-semibold" style={{ color: TEXT }}>{line.hesapKodu || '-'}</span>
                            </td>
                            <td className="py-2 px-3" style={{ color: 'rgba(250,250,249,.7)' }}>{line.hesapAdi || ''}</td>
                            <td className="py-2 px-3 min-w-[180px]" style={{ color: 'rgba(250,250,249,.65)' }}>{line.aciklama || '-'}</td>
                            <td className="py-2 px-3 text-right tabular-nums font-mono w-32" style={{ color: Number(line.borc) > 0 ? TEXT : MUTED2 }}>{Number(line.borc) > 0 ? fmtTRY(line.borc) : '-'}</td>
                            <td className="py-2 px-3 text-right tabular-nums font-mono w-32" style={{ color: Number(line.alacak) > 0 ? TEXT : MUTED2 }}>{Number(line.alacak) > 0 ? fmtTRY(line.alacak) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* ════════ TAB: KONTROL KURALLARI ════════ */}
      {activeTab === 'KURALLAR' && (<KurallarTab />)}

      {/* ════════ TAB: GEÇMİŞ KONTROLLER ════════ */}
      {activeTab === 'GECMIS' && (
        <div className="space-y-3">
          {periodSessions.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: PANEL, border: `1px dashed ${BORDER_STRONG}` }}>
              <div className="inline-flex h-14 w-14 rounded-full items-center justify-center mb-3" style={{ background: NAVY_SOFT, color: NAVY }}>
                <Clock size={26} />
              </div>
              <div className="text-base font-semibold mb-1" style={{ color: TEXT }}>Henüz Detay Fiş Listesi çekilmedi</div>
              <div className="text-xs" style={{ color: MUTED }}>"Luca'dan Çek" butonu ile başlat veya manuel Excel yükle.</div>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden" style={{ background: PANEL, borderColor: BORDER }}>
              <table className="w-full text-sm">
                <thead style={{ background: 'rgba(0,0,0,.18)' }}>
                  <tr style={{ color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
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
                      <tr key={s.id} onClick={() => { setSelectedSessionId(s.id); setActiveTab('BULGULAR'); }} className="cursor-pointer" style={{ borderBottom: `1px solid ${BORDER}`, background: isActive ? NAVY_SOFT : 'transparent', color: TEXT }}>
                        <td className="py-3 px-4 font-bold" style={{ color: isActive ? NAVY : TEXT }}>
                          {i === 0 ? '★ ' : ''}v{periodSessions.length - i}
                        </td>
                        <td className="py-3 px-4" style={{ color: 'rgba(250,250,249,.7)' }}>{fmtDateTime(s.createdAt)}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{s.totalVouchers}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{s.totalLines}</td>
                        <td className="py-3 px-4 text-right tabular-nums">
                          <span className="font-semibold" style={{ color: s.findingCount ? WARN : OK }}>{s.findingCount || 0}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-wider" style={{ background: s.findingCount ? 'rgba(212,168,95,.14)' : 'rgba(92,191,138,.14)', color: s.findingCount ? WARN : OK }}>
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

function Gauge({ score, color, hasData }: { score: number | null; color: string; hasData: boolean }) {
  const p = hasData && score != null ? score : 0;
  const ring = hasData ? color : 'rgba(255,255,255,.16)';
  return (
    <div className="relative shrink-0" style={{ width: 92, height: 92, borderRadius: '50%', background: `conic-gradient(${ring} 0 ${p}%, rgba(255,255,255,.07) ${p}% 100%)` }}>
      <div className="absolute rounded-full" style={{ inset: 9, background: '#0e1116' }} />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[27px] font-bold leading-none tabular-nums" style={{ color: hasData ? TEXT : MUTED2 }}>{hasData && score != null ? score : '—'}</div>
        <div className="text-[8px] uppercase tracking-[.18em] mt-1" style={{ color: MUTED }}>Skor</div>
      </div>
    </div>
  );
}

function Metric({ label, value, color, active, lead, onClick }: { label: string; value: number; color: string; active: boolean; lead?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-xl p-3 text-left transition-all" style={{ border: `1px solid ${active ? 'rgba(91,141,239,.34)' : BORDER}`, background: active || lead ? LEAD_GRAD : 'rgba(255,255,255,.012)' }}>
      <div className="text-[9px] uppercase tracking-[.16em] mb-1.5" style={{ color: active || lead ? 'rgba(91,141,239,.9)' : MUTED2 }}>{label}</div>
      <div className="text-[24px] font-bold tabular-nums leading-none" style={{ color }}>{value}</div>
    </button>
  );
}

function LegendItem({ color, label, value, active, onClick }: { color: string; label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition-all" style={{ background: active ? `${color}1a` : 'transparent', outline: active ? `1px solid ${color}55` : 'none' }}>
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      <span className="flex flex-col items-start leading-none">
        <span className="text-[19px] font-bold tabular-nums" style={{ color }}>{value}</span>
        <span className="text-[11px] mt-1" style={{ color: active ? color : MUTED }}>{label}</span>
      </span>
    </button>
  );
}

function BigStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
      <div className="text-[9px] uppercase tracking-[.18em] mb-1" style={{ color: MUTED2 }}>{label}</div>
      <div className="text-2xl font-bold tabular-nums leading-none" style={{ color }}>{value}</div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: any; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className="h-10 px-4 inline-flex items-center gap-2 text-sm font-semibold border-b-2 transition-colors" style={{ borderColor: active ? NAVY : 'transparent', color: active ? NAVY : 'rgba(250,250,249,.55)' }}>
      <Icon size={15} />
      {label}
      {badge != null && badge > 0 && (
        <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full" style={{ background: active ? NAVY_SOFT : 'rgba(255,255,255,.05)', color: active ? NAVY : 'rgba(250,250,249,.55)' }}>{badge}</span>
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
  const color = sevColor(value);
  return (<span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${color}1c`, color }}>{sevLabel(value)}</span>);
}

type KuralDef = { kod: string; ad: string; aciklama: string; severity: 'ERROR' | 'WARN' | 'INFO'; grup: string; aktif: boolean };
type ManuelKural = { id: string; ad: string; aciklama: string; severity: 'ERROR' | 'WARN' | 'INFO'; hesapKoduPrefix?: string; tutarEsigi?: number; createdAt: string };

const STANDART_KURALLAR: KuralDef[] = [
  { kod: 'DEFTER_GENELI_DENGESIZ', ad: 'Defter geneli borç=alacak', aciklama: 'Tüm dönem toplam borç ile alacak eşit değilse uyarır. Berat oluşturmadan önce mutlaka düzeltilmelidir.', severity: 'ERROR', grup: 'Temel Bütünlük', aktif: true },
  { kod: 'HESAP_KODU_EKSIK', ad: 'Hesap kodu eksik', aciklama: 'Satırda hesap kodu boş bırakılmış.', severity: 'ERROR', grup: 'Temel Bütünlük', aktif: true },
  { kod: 'DONEM_DISI_TARIH', ad: 'Dönem dışı tarih', aciklama: 'Fiş tarihi seçilen dönem aralığının dışında.', severity: 'ERROR', grup: 'Temel Bütünlük', aktif: true },
  { kod: 'FIS_TARIHI_PARSE_HATASI', ad: 'Tarih parse hatası (aggregate)', aciklama: 'Excel sütununda tarih okunamayan satırların toplam sayısı.', severity: 'WARN', grup: 'Temel Bütünlük', aktif: true },
  { kod: 'VKN_FORMAT_HATALI', ad: 'VKN/TCKN format hatası', aciklama: 'VKN/TCKN 10 veya 11 haneli değil.', severity: 'ERROR', grup: 'VKN / TCKN', aktif: true },
  { kod: 'VKN_ALGORITMA_HATALI', ad: 'VKN/TCKN algoritması tutmuyor', aciklama: 'Hane sayısı doğru ama Maliye kontrol algoritması başarısız. BA/BS uyumsuzluğu yaratır.', severity: 'ERROR', grup: 'VKN / TCKN', aktif: true },
  { kod: 'GERCEK_MUKERRER_FATURA', ad: 'Gerçek mükerrer fatura', aciklama: 'Aynı belge no + aynı VKN + aynı tutar üç alan birden eşleşiyor. KDV indirimi mükerrer inmiş olabilir.', severity: 'ERROR', grup: 'Mükerrer Kayıt', aktif: true },
  { kod: 'AYNI_GUN_AYNI_TUTAR_AYNI_TARAF', ad: 'Aynı gün/tutar/taraf', aciklama: 'Aynı tarihte aynı VKN için aynı tutarlı 50.000+ TL kayıt birden fazla.', severity: 'WARN', grup: 'Mükerrer Kayıt', aktif: true },
  { kod: 'HAVADA_KDV_KAYDI', ad: 'Havada KDV kaydı', aciklama: '191/391 KDV var ama matrah veya cari/kasa karşılık hesabı yok.', severity: 'ERROR', grup: 'KDV', aktif: true },
  { kod: 'CARI_TERS_BAKIYE_120', ad: '120 ters bakiye', aciklama: '120 Alıcılar hesabı alacaklı bakiye veriyor — müşteri fazla ödeme yapmış veya kayıt hatası.', severity: 'WARN', grup: 'Cari Hesap', aktif: true },
  { kod: 'CARI_TERS_BAKIYE_320', ad: '320 ters bakiye', aciklama: '320 Satıcılar hesabı borçlu bakiye veriyor — satıcıya fazla ödeme veya kayıt hatası.', severity: 'WARN', grup: 'Cari Hesap', aktif: true },
  { kod: 'ORTAK_ALACAK_FAIZ_RISKI', ad: '131 ortak alacağı', aciklama: '131 Ortaklardan Alacaklar net bakiyesi 100.000+ TL. KKEG faiz hesaplaması gerekebilir.', severity: 'INFO', grup: 'KKEG', aktif: true },
  { kod: 'KASA_GUNLUK_30000_TEVSIK_RISKI', ad: 'Kasa günlük 30.000 TL', aciklama: 'Bir günde 100 Kasa hareket toplamı 30.000 TL üzerinde — VUK 459 tevsik zorunluluğu.', severity: 'WARN', grup: 'Tevsik', aktif: true },
  { kod: 'KASA_TEVSIK_PARCALAMA', ad: 'Tevsik parçalama riski', aciklama: 'Aynı VKN için bir günde birden fazla kasa hareketi toplamı 30.000 TL üstü — parçalama (smurfing).', severity: 'WARN', grup: 'Tevsik', aktif: true },
  { kod: 'FIS_DENGESIZ', ad: 'Fiş dengesiz', aciklama: 'Tek fişin borç ve alacak toplamları eşit değil.', severity: 'ERROR', grup: 'Yevmiye', aktif: true },
  { kod: 'YEVMIYE_NO_MUKERRER', ad: 'Yevmiye no mükerrer', aciklama: 'Aynı yevmiye numarası farklı tarihlerde / farklı fişlerde kullanılmış.', severity: 'ERROR', grup: 'Yevmiye', aktif: true },
  { kod: 'YEVMIYE_NO_ATLAMA', ad: 'Yevmiye no atlama', aciklama: 'Yevmiye numarası sırasında atlanmış aralık var (tek özet). Genelde iptal edilen fişlerden kaynaklanır.', severity: 'INFO', grup: 'Yevmiye', aktif: true },
  { kod: 'YEVMIYE_TARIH_SIRASI', ad: 'Yevmiye tarih sırası', aciklama: 'Yevmiye numarası ile fiş tarihleri sıralı değil.', severity: 'WARN', grup: 'Yevmiye', aktif: true },
  { kod: 'BOS_FIS', ad: 'Boş fiş', aciklama: 'Fişte hiçbir hareket satırı yok.', severity: 'WARN', grup: 'Yevmiye', aktif: true },
  { kod: 'TEK_SATIRLI_FIS', ad: 'Tek satırlı fiş', aciklama: 'Fişte sadece 1 hareket satırı var — çift taraflı kayıt prensibi ihlali.', severity: 'WARN', grup: 'Yevmiye', aktif: true },
  { kod: 'BELGE_TARIHI_FIS_TARIHINDEN_SONRA', ad: 'Belge tarihi > fiş tarihi', aciklama: 'Belge tarihi fiş tarihinden sonra — mantıken belge kaydedildiği günden sonra düzenlenmiş.', severity: 'WARN', grup: 'Belge', aktif: true },
  { kod: 'BELGE_TARIHI_DONEM_DISI', ad: 'Belge tarihi dönem dışı', aciklama: 'Belge tarihi seçilen dönem aralığının dışında.', severity: 'WARN', grup: 'Belge', aktif: true },
  { kod: 'YUKSEK_TUTAR_ACIKLAMA_EKSIK', ad: 'Yüksek tutar açıklama eksik', aciklama: '50.000+ TL fişte açıklama 5 karakterden az — denetimde riskli.', severity: 'INFO', grup: 'Kalite', aktif: true },
  { kod: 'DONEM_SONU_191_BAKIYE', ad: '191 dönem sonu bakiye', aciklama: 'Dönem sonu 191 İndirilecek KDV bakiyesi sıfırlanmamış — tahakkuk fişi eksik.', severity: 'WARN', grup: 'KDV', aktif: true },
  { kod: 'DONEM_SONU_391_BAKIYE', ad: '391 dönem sonu bakiye', aciklama: 'Dönem sonu 391 Hesaplanan KDV bakiyesi sıfırlanmamış — tahakkuk fişi eksik.', severity: 'WARN', grup: 'KDV', aktif: true },
  { kod: 'KDV_TAHAKKUK_EKSIK', ad: 'KDV tahakkuk fişi eksik', aciklama: 'Ay içinde 191/391 hareketi var ama tahakkuk fişi bulunamadı. Çeyrek dönemde son ayın tahakkuku bir sonrakine kaymış olabilir.', severity: 'WARN', grup: 'KDV', aktif: true },
  { kod: 'KDV_ODENECEK_360_UYUMSUZ', ad: 'Ödenecek KDV 360 uyumsuz', aciklama: 'Ödenecek KDV tutarı 360 hesabıyla uyuşmuyor (önceki dönem devreden/tevkifat hariç). Beyanla teyit edilmeli.', severity: 'INFO', grup: 'KDV', aktif: true },
  { kod: 'KDV_DEVREDEN_190_UYUMSUZ', ad: 'Devreden KDV 190 uyumsuz', aciklama: 'Devreden KDV tutarı 190 hesabıyla uyuşmuyor (önceki dönem devreden hariç). Beyanla teyit edilmeli.', severity: 'INFO', grup: 'KDV', aktif: true },
  { kod: 'BORDRO_TAHAKKUK_EKSIK', ad: 'Aylık bordro tahakkuku eksik', aciklama: 'Her ay 770/772 personel gideri + 335 net ücret + 361 SGK kayıtları olmalı.', severity: 'WARN', grup: 'Bordro / SGK', aktif: true },
  { kod: 'KIRA_STOPAJI_EKSIK', ad: 'Kira stopajı eksik', aciklama: 'Kira gideri var ama 360 altında kira stopajı kaydı yok. %20 stopaj (GVK 94) ayrı fişte/dönemde olabilir; kontrol edilmeli.', severity: 'WARN', grup: 'Stopaj', aktif: true },
  { kod: 'KIRA_STOPAJI_ORAN', ad: 'Kira stopaj oranı sapma', aciklama: 'Kira/stopaj oranı %20 dışında — brüt/net hesaplama hatalı olabilir.', severity: 'WARN', grup: 'Stopaj', aktif: true },
  { kod: 'SMM_STOPAJI_KONTROL', ad: 'Serbest meslek stopajı eksik', aciklama: 'SMM/avukat/noter/tercüme ödemesi var ama 360.01.007 boş. %20 tevkifat zorunlu.', severity: 'WARN', grup: 'Stopaj', aktif: true },
  { kod: 'DAMGA_VERGISI_KONTROL', ad: 'Damga vergisi eksik', aciklama: 'Personel ücret ödemesi var ama 360.01.002 damga vergisi boş.', severity: 'INFO', grup: 'Stopaj', aktif: true },
  { kod: 'ACILIS_FISI_YOK', ad: 'Açılış fişi yok', aciklama: 'Dönem başında (1 Ocak) açılış kaydı bulunamadı; geçen yıl kapanış mizanıyla bire bir olmalı.', severity: 'WARN', grup: 'Açılış / Kapanış', aktif: true },
  { kod: 'ACILIS_FISINDE_GELIR_GIDER', ad: 'Açılış fişinde 5/6/7xx', aciklama: 'Açılış fişinde gelir-gider-maliyet (5xx/6xx/7xx) hesabı olmamalı.', severity: 'ERROR', grup: 'Açılış / Kapanış', aktif: true },
  { kod: 'YILLIK_KAPANIS_690_EKSIK', ad: 'Yıllık kapanış 690 eksik', aciklama: 'Yıl sonunda 6xx/7xx var ama 690 Dönem Kârı/Zararı hesabı kullanılmamış.', severity: 'WARN', grup: 'Açılış / Kapanış', aktif: true },
  { kod: 'VERGI_KARSILIGI_370_YOK', ad: '370 Vergi karşılığı yok', aciklama: 'Yıl sonu 690 kullanılmış ama 370/371 vergi karşılığı hesaplanmamış.', severity: 'WARN', grup: 'Açılış / Kapanış', aktif: true },
  { kod: 'YILSONU_AMORTISMAN_EKSIK', ad: 'Yıl sonu amortisman eksik', aciklama: 'Sabit kıymet var ama 257/268 birikmiş amortisman + 770/760/730 amortisman gider kaydı eksik (VUK 333).', severity: 'WARN', grup: 'Açılış / Kapanış', aktif: true },
  { kod: 'AVANS_KAPANMAMIS_159', ad: '159 Verilen avans açık', aciklama: '159 Verilen Sipariş Avansları hesabında 10.000+ TL açık bakiye — mal/hizmet teslim alındıysa kapatılmalı.', severity: 'INFO', grup: 'Avans', aktif: true },
  { kod: 'AVANS_KAPANMAMIS_340', ad: '340 Alınan avans açık', aciklama: '340 Alınan Sipariş Avansları hesabında 10.000+ TL açık bakiye.', severity: 'INFO', grup: 'Avans', aktif: true },
  { kod: 'CEK_SENET_BAKIYE_121', ad: '121 Alınan çek bakiyesi', aciklama: 'Dönem sonu 121 bakiyesi var — vadesi geçmiş çek olabilir.', severity: 'INFO', grup: 'Çek / Senet', aktif: true },
  { kod: 'CEK_SENET_BAKIYE_122', ad: '122 Alınan senet bakiyesi', aciklama: 'Dönem sonu 122 bakiyesi var — vadesi geçmiş senet olabilir.', severity: 'INFO', grup: 'Çek / Senet', aktif: true },
  { kod: 'CEK_SENET_BAKIYE_322', ad: '322 Verilen çek bakiyesi', aciklama: 'Dönem sonu 322 bakiyesi var — vadesi geçmiş çek olabilir.', severity: 'INFO', grup: 'Çek / Senet', aktif: true },
  { kod: 'CEK_SENET_BAKIYE_323', ad: '323 Verilen senet bakiyesi', aciklama: 'Dönem sonu 323 bakiyesi var.', severity: 'INFO', grup: 'Çek / Senet', aktif: true },
  { kod: 'BANKA_EKSI_BAKIYE_102', ad: '102 Banka eksi bakiye', aciklama: 'Banka hesabı dönem hareketinde alacak (eksi) bakiye veriyor (açılış/devir hariç). Gerçekten eksiyse 300 Banka Kredileri hesabında izlenmeli.', severity: 'WARN', grup: 'Banka', aktif: true },
  { kod: 'POS_VALOR_108_BAKIYE', ad: '108 POS valör bakiyesi', aciklama: '108 POS hesabında bakiye — valör tarihi geçip 102 banka hesabına geçmesi gereken kayıtlar olabilir.', severity: 'INFO', grup: 'Banka', aktif: true },
  { kod: 'KKEG_689_KONTROL', ad: '689 KKEG kontrolü', aciklama: '689 Diğer Olağandışı Gider hesabında hareket var — KKEG ise Kurumlar Vergisi matrahına eklenmeli.', severity: 'INFO', grup: 'KKEG', aktif: true },
  { kod: 'BENFORD_SAPMA', ad: 'Benford yasası sapması', aciklama: 'Tutarların ilk basamak dağılımı Benford yasasından sapıyor (MAD eşiği). Doğal olmayan/uydurulmuş tutar göstergesi olabilir — VEDAS resmî olarak kullanır.', severity: 'WARN', grup: 'Forensic / Anomali', aktif: true },
  { kod: 'YUVARLAK_TUTAR_YIGILMASI', ad: 'Yuvarlak tutar yığılması', aciklama: '1.000 TL ve üzeri tutarların aşırı yüksek oranı tam yuvarlak (1.000/10.000 katı). Tahmini/uydurma kayıt işareti.', severity: 'WARN', grup: 'Forensic / Anomali', aktif: true },
  { kod: 'HAFTA_SONU_KAYDI', ad: 'Hafta sonu kaydı', aciklama: 'Cumartesi/Pazar tarihli fişler. Mesai dışı kayıtlar BDS 240 kapsamında denetimde gözden geçirilir.', severity: 'INFO', grup: 'Forensic / Anomali', aktif: true },
  { kod: 'SUPHELI_ACIKLAMA', ad: 'Şüpheli açıklama', aciklama: 'Açıklamada "düzeltme, iptal, hata, sehven, geri alma" gibi riskli ifadeler. Düzeltme/iptal kayıtları denetimde önceliklidir.', severity: 'INFO', grup: 'Forensic / Anomali', aktif: true },
];

function KurallarTab() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [manuel, setManuel] = useState<ManuelKural[]>([]);
  const [form, setForm] = useState<{ ad: string; aciklama: string; severity: 'ERROR' | 'WARN' | 'INFO'; hesapKoduPrefix: string; tutarEsigi: string }>({ ad: '', aciklama: '', severity: 'WARN', hesapKoduPrefix: '', tutarEsigi: '' });

  useEffect(() => {
    try { const raw = localStorage.getItem('edefter-manuel-kurallar'); if (raw) setManuel(JSON.parse(raw)); } catch {}
  }, []);

  const saveManuel = (next: ManuelKural[]) => {
    setManuel(next);
    try { localStorage.setItem('edefter-manuel-kurallar', JSON.stringify(next)); } catch {}
  };

  const ekle = () => {
    if (!form.ad.trim()) { toast.error('Kural adı boş olamaz'); return; }
    const yeni: ManuelKural = {
      id: `manuel-${Date.now()}`,
      ad: form.ad.trim(),
      aciklama: form.aciklama.trim(),
      severity: form.severity,
      hesapKoduPrefix: form.hesapKoduPrefix.trim() || undefined,
      tutarEsigi: form.tutarEsigi ? Number(form.tutarEsigi) : undefined,
      createdAt: new Date().toISOString(),
    };
    saveManuel([yeni, ...manuel]);
    setForm({ ad: '', aciklama: '', severity: 'WARN', hesapKoduPrefix: '', tutarEsigi: '' });
    setShowForm(false);
    toast.success('Manuel kural eklendi (yerel kayıt)');
  };

  const sil = (id: string) => saveManuel(manuel.filter((k) => k.id !== id));

  const q = search.trim().toLocaleLowerCase('tr-TR');
  const filtered = STANDART_KURALLAR.filter((k) => !q || `${k.kod} ${k.ad} ${k.aciklama} ${k.grup}`.toLocaleLowerCase('tr-TR').includes(q));
  const byGroup = new Map<string, KuralDef[]>();
  for (const k of filtered) { if (!byGroup.has(k.grup)) byGroup.set(k.grup, []); byGroup.get(k.grup)!.push(k); }

  const formSelectStyle: CSSProperties = { background: PANEL, border: `1px solid ${BORDER}`, color: TEXT, backgroundImage: ARROW('5b8def'), backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: '30px' };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="h-10 rounded-lg px-3 flex items-center gap-2 flex-1 min-w-[280px]" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: 'rgba(250,250,249,.75)' }}>
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Kural ara..." className="bg-transparent outline-none text-sm w-full" style={{ color: TEXT }} />
        </div>
        <span className="text-xs tabular-nums" style={{ color: MUTED }}>{STANDART_KURALLAR.length} standart · {manuel.length} manuel</span>
        <button onClick={() => setShowForm(!showForm)} className="h-10 px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5" style={{ background: NAVY_SOFT, color: NAVY, border: '1px solid rgba(91,141,239,.3)' }}>
          {showForm ? <XCircle size={13} /> : <Sparkles size={13} />} {showForm ? 'Vazgeç' : 'Manuel Kural Ekle'}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: NAVY_SOFT, border: '1px solid rgba(91,141,239,.3)' }}>
          <div className="text-xs font-bold uppercase tracking-wider" style={{ color: NAVY }}>Yeni Manuel Kural</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Kural Adı *"><input value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} placeholder="Örn: Kira ödemesi 5.000 TL üstü kontrol" className="w-full h-9 rounded-md px-3 text-sm" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: TEXT }} /></Field>
            <Field label="Seviye"><select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as any })} className="w-full h-9 rounded-md px-3 text-sm appearance-none cursor-pointer" style={formSelectStyle}><option value="ERROR" style={{ background: '#1a1a17', color: TEXT }}>Hata</option><option value="WARN" style={{ background: '#1a1a17', color: TEXT }}>Uyarı</option><option value="INFO" style={{ background: '#1a1a17', color: TEXT }}>Bilgi</option></select></Field>
            <Field label="Hesap Kodu Başlangıcı (opsiyonel)"><input value={form.hesapKoduPrefix} onChange={(e) => setForm({ ...form, hesapKoduPrefix: e.target.value })} placeholder="Örn: 770 veya 360.01" className="w-full h-9 rounded-md px-3 text-sm tabular-nums" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: TEXT }} /></Field>
            <Field label="Tutar Eşiği TL (opsiyonel)"><input type="number" value={form.tutarEsigi} onChange={(e) => setForm({ ...form, tutarEsigi: e.target.value })} placeholder="Örn: 5000" className="w-full h-9 rounded-md px-3 text-sm tabular-nums" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: TEXT }} /></Field>
          </div>
          <Field label="Açıklama"><textarea value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} placeholder="Bu kural ne yakalar, neden eklendi?" rows={2} className="w-full rounded-md px-3 py-2 text-sm" style={{ background: PANEL, border: `1px solid ${BORDER}`, color: TEXT }} /></Field>
          <div className="flex justify-end">
            <button onClick={ekle} className="h-9 px-4 rounded-md text-xs font-bold inline-flex items-center gap-1.5" style={{ background: NAVY, color: '#0b1220' }}>
              <CheckCircle2 size={13} /> Kaydet
            </button>
          </div>
          <div className="text-[10px]" style={{ color: MUTED }}>Not: Manuel kurallar şimdilik yerel olarak (bu tarayıcıda) saklanır. Çalıştırma mantığı sonraki sürümde gelecek.</div>
        </div>
      )}

      {manuel.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
          <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: PANEL_HOVER, borderBottom: `1px solid ${BORDER}` }}>
            <Sparkles size={14} style={{ color: NAVY }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: NAVY }}>Senin Manuel Kuralların</span>
            <span className="text-xs tabular-nums ml-auto" style={{ color: MUTED }}>{manuel.length}</span>
          </div>
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {manuel.map((k) => (
              <div key={k.id} className="px-4 py-3 flex items-start gap-3" style={{ borderColor: BORDER }}>
                <Severity value={k.severity} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold mb-0.5" style={{ color: TEXT }}>{k.ad}</div>
                  {k.aciklama && (<div className="text-xs mb-1" style={{ color: 'rgba(250,250,249,.65)' }}>{k.aciklama}</div>)}
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    {k.hesapKoduPrefix && (<span className="px-1.5 py-0.5 rounded tabular-nums" style={{ background: 'rgba(255,255,255,.06)', color: 'rgba(250,250,249,.82)' }}>Hesap: {k.hesapKoduPrefix}*</span>)}
                    {k.tutarEsigi != null && (<span className="px-1.5 py-0.5 rounded tabular-nums" style={{ background: 'rgba(255,255,255,.05)', color: 'rgba(250,250,249,.6)' }}>Eşik: {fmtTRY(k.tutarEsigi)} TL</span>)}
                    <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,.04)', color: MUTED2 }}>{fmtDate(k.createdAt)}</span>
                  </div>
                </div>
                <button onClick={() => sil(k.id)} className="h-7 w-7 rounded-md inline-flex items-center justify-center" style={{ background: 'rgba(226,112,111,.10)', color: ERR, border: '1px solid rgba(226,112,111,.18)' }} title="Sil"><XCircle size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {[...byGroup.entries()].map(([grupAd, kurallar]) => (
          <div key={grupAd} className="rounded-xl overflow-hidden" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
            <div className="px-4 py-2.5" style={{ background: PANEL_HOVER, borderBottom: `1px solid ${BORDER}` }}>
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,.85)' }}>{grupAd}</span>
              <span className="text-xs tabular-nums ml-2" style={{ color: MUTED }}>{kurallar.length}</span>
            </div>
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {kurallar.map((k) => (
                <div key={k.kod} className="px-4 py-3 flex items-start gap-3" style={{ borderColor: BORDER }}>
                  <Severity value={k.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold" style={{ color: TEXT }}>{k.ad}</span>
                      <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(255,255,255,.04)', color: MUTED2 }}>{k.kod}</span>
                    </div>
                    <div className="text-xs" style={{ color: 'rgba(250,250,249,.65)' }}>{k.aciklama}</div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: OK }}>AKTİF</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: MUTED }}>{label}</div>
      {children}
    </div>
  );
}
