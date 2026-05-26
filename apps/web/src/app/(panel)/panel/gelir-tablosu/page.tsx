'use client';
import React, { useState, useMemo, useEffect } from 'react';
// useMemo zaten import edildi
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { mizanApi, gelirTablosuApi, fmtTRY } from '@/lib/mizan';
import { api } from '@/lib/api';
import { formatDonemLabel, formatDonemRangeLabel, formatDonemTipiLabel } from '@/lib/period';
import { toast } from 'sonner';
import {
  Download, Search, X, ChevronDown, Users, Calendar, Sparkles, Loader2,
  Trash2, Eye, TrendingUp, TrendingDown, Zap, FileSpreadsheet, Lock, Unlock,
  Printer,
} from 'lucide-react';

const GOLD = '#e6c979';
const TABLE_BG = '#0a0907';
const GRID_LINE = 'rgba(245,240,230,0.24)';
const GRID_LINE_STRONG = 'rgba(212,184,118,0.50)';
const CELL_LINE = 'rgba(245,240,230,0.16)';
const CELL_LINE_STRONG = 'rgba(212,184,118,0.42)';
const AMOUNT_COLOR = '#fffaf0';
const TOTAL_COLOR = '#fff0b8';
const MUTED_AMOUNT_COLOR = 'rgba(250,250,249,0.66)';
const MISSING_AMOUNT_COLOR = 'rgba(250,250,249,0.46)';
const PROFIT_COLOR = '#86efac';
const LOSS_COLOR = '#fca5a5';
const RATIO_COLOR = '#ffffff';
const RATIO_BG = 'rgba(13,148,136,0.58)';
const RATIO_BORDER = 'rgba(153,246,228,0.80)';
const REPORT_FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const FINANCIAL_FONT = REPORT_FONT;
const FINANCIAL_AMOUNT_SIZE = 14.5;
const FINANCIAL_AMOUNT_WEIGHT = 600;
const FINANCIAL_AMOUNT_STRONG_WEIGHT = 700;
const ACCOUNT_ROW_BG = 'rgba(255,255,255,0.045)';
const MAIN_ROW_BG = 'rgba(0,0,0,0.24)';
const FINAL_ROW_BG = 'linear-gradient(90deg, rgba(0,0,0,0.34), rgba(184,160,111,0.08))';
const CODE_COL_WIDTH = 70;
const PERIOD_COL_WIDTH = 180;
const PERIOD_COLS_WIDTH = PERIOD_COL_WIDTH * 4;
const ACCOUNT_COL_WIDTH = `calc(100% - ${CODE_COL_WIDTH + PERIOD_COLS_WIDTH}px)`;
const LEADING_COL_WIDTH = `calc(100% - ${PERIOD_COLS_WIDTH}px)`;

type Taxpayer = { id: string; firstName?: string | null; lastName?: string | null; companyName?: string | null; taxNumber?: string | null; };
function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

// Çeyrek aralığını "01-2026 → 03-2026" formatında döndürür
function quarterRangeLabel(year: number, q: number): string {
  const ranges: Record<number, [string, string]> = {
    1: ['01', '03'],
    2: ['04', '06'],
    3: ['07', '09'],
    4: ['10', '12'],
  };
  const [bas, bit] = ranges[q] || ['01', '03'];
  return `${bas}-${year} → ${bit}-${year}`;
}

// TDHP standart hesap adları (stok ve maliyet hesapları için)
const HESAP_ADLARI: Record<string, string> = {
  '150': 'İlk Madde ve Malzeme',
  '151': 'Yarı Mamuller — Üretim',
  '152': 'Mamuller',
  '153': 'Ticari Mallar',
  '157': 'Diğer Stoklar',
  '720': 'Direkt İlk Madde Malzeme Gideri',
  '721': 'Direkt İlk Madde Malzeme Gid. Yansıtma (-)',
  '730': 'Genel Üretim Giderleri',
  '731': 'Genel Üretim Giderleri Yansıtma (-)',
};

/**
 * Gelir tablosu satır tipi.
 *  - `group`: toplama/başlık satırı (bold, koyu zemin)
 *  - `total`: altın çerçeveli ara toplam
 *  - `final`: dönem net karı (fraunces)
 *  - `sub`: alt hesap satırı (TDHP hesap kodu + ad)
 *  - `manual`: kullanıcının elle tutar girdiği düzeltme satırı
 */
type RowType = {
  k?: string;                         // Gelir tablosu top-level alan (brutSatislar, satisMaliyeti vs.)
  sub?: string;                       // Alt hesap kodu (600, 621, 740 vs.)
  subLabel?: string;                  // Alt hesap adı
  label: string;
  kod?: string;
  group?: boolean;
  total?: boolean;
  final?: boolean;
  negative?: boolean;
  manual?: 'satisMaliyetiManuel' | 'faaliyetGiderleri' | 'digerGiderler' | 'finansmanGiderleri' | 'olaganDisiGider' | 'vergiKarsiligi';
};

type ClientReportRow = {
  code: string;
  label: string;
  value: number;
  percent?: string;
  type: 'group' | 'total' | 'final' | 'sub' | 'manual';
};

type ClientReportRatio = {
  label: string;
  value: string;
  tone: 'good' | 'neutral' | 'warn' | 'bad';
};

type ClientReportHighlight = {
  label: string;
  value: string;
  tone: 'good' | 'neutral' | 'warn' | 'bad';
};

const TDHP_ROWS: RowType[] = [
  // A. BRÜT SATIŞLAR
  { k: 'brutSatislar', label: 'A. BRÜT SATIŞLAR', group: true },
  { sub: '600', subLabel: '1. Yurtiçi Satışlar',        label: '1. Yurtiçi Satışlar' },
  { sub: '601', subLabel: '2. Yurtdışı Satışlar',       label: '2. Yurtdışı Satışlar' },
  { sub: '602', subLabel: '3. Diğer Gelirler',          label: '3. Diğer Gelirler' },
  // B. SATIŞ İNDİRİMLERİ
  { k: 'satisIndirimleri', label: 'B. SATIŞ İNDİRİMLERİ (-)', group: true, negative: true },
  { sub: '610', subLabel: '1. Satıştan İadeler (-)',     label: '1. Satıştan İadeler (-)' },
  { sub: '611', subLabel: '2. Satış İskontoları (-)',    label: '2. Satış İskontoları (-)' },
  { sub: '612', subLabel: '3. Diğer İndirimler (-)',     label: '3. Diğer İndirimler (-)' },
  // C. NET SATIŞLAR
  { k: 'netSatislar', label: 'C. NET SATIŞLAR', total: true },
  // D. SATIŞLARIN MALİYETİ
  { k: 'satisMaliyeti', label: 'D. SATIŞLARIN MALİYETİ (-)', group: true, negative: true },
  { sub: '620', subLabel: '1. Satılan Mamuller Maliyeti (-)',          label: '1. Satılan Mamuller Maliyeti (-)' },
  { sub: '621', subLabel: '2. Satılan Ticari Mallar Maliyeti (-)',     label: '2. Satılan Ticari Mallar Maliyeti (-)' },
  // Manuel düzeltme — SADECE burada (2. Satılan Ticari Mallar Maliyeti altında)
  { manual: 'satisMaliyetiManuel', kod: '621', label: '2. Satılan Ticari Mallar Maliyeti (-)' },
  { sub: '622', subLabel: '3. Satılan Hizmet Maliyeti (-)',            label: '3. Satılan Hizmet Maliyeti (-)' },
  { sub: '740', subLabel: '3. Satılan Hizmet Maliyeti (7/A)',          label: '3. Satılan Hizmet Maliyeti (7/A)' },
  { sub: '623', subLabel: '4. Diğer Satışların Maliyeti (-)',          label: '4. Diğer Satışların Maliyeti (-)' },
  // BRÜT SATIŞ KARI
  { k: 'brutSatisKari', label: 'BRÜT SATIŞ KARI VEYA ZARARI', total: true },
  // E. FAALİYET GİDERLERİ — 7/A ve 7/B çiftli (Ar-Ge, Pazarlama, Genel Yönetim)
  { k: 'faaliyetGiderleri', label: 'E. FAALİYET GİDERLERİ (-)', group: true, negative: true },
  { sub: '750', subLabel: '1. Araştırma ve Geliştirme Giderleri (-)',  label: '1. Araştırma ve Geliştirme Giderleri (-)' },
  { sub: '633', subLabel: '1. Araştırma ve Geliştirme Giderleri (-)',  label: '1. Araştırma ve Geliştirme Giderleri (-)' },
  { sub: '760', subLabel: '2. Pazarlama Satış ve Dağıtım Giderleri (-)', label: '2. Pazarlama Satış ve Dağıtım Giderleri (-)' },
  { sub: '631', subLabel: '2. Pazarlama Satış ve Dağıtım Giderleri (-)', label: '2. Pazarlama Satış ve Dağıtım Giderleri (-)' },
  { sub: '770', subLabel: '3. Genel Yönetim Giderleri (-)',              label: '3. Genel Yönetim Giderleri (-)' },
  { sub: '632', subLabel: '3. Genel Yönetim Giderleri (-)',              label: '3. Genel Yönetim Giderleri (-)' },
  // FAALİYET KARI
  { k: 'faaliyetKari', label: 'FAALİYET KARI VEYA ZARARI', total: true },
  // F. DİĞER OLAĞAN GELİR
  { k: 'digerGelirler', label: 'F. DİĞER FAAL. OLAĞAN GELİR VE KARLAR', group: true },
  { sub: '640', subLabel: '1. İştiraklerden Temettü Gelirleri',         label: '1. İştiraklerden Temettü Gelirleri' },
  { sub: '641', subLabel: '2. Bağlı Ortaklıklardan Temettü Gelirleri',  label: '2. Bağlı Ortaklıklardan Temettü Gelirleri' },
  { sub: '642', subLabel: '3. Faiz Gelirleri',                          label: '3. Faiz Gelirleri' },
  { sub: '643', subLabel: '4. Komisyon Gelirleri',                      label: '4. Komisyon Gelirleri' },
  { sub: '644', subLabel: '5. Konusu Kalmayan Karşılıklar',             label: '5. Konusu Kalmayan Karşılıklar' },
  { sub: '645', subLabel: '6. Menkul Kıymet Satış Karları',             label: '6. Menkul Kıymet Satış Karları' },
  { sub: '646', subLabel: '7. Kambiyo Karları',                         label: '7. Kambiyo Karları' },
  { sub: '647', subLabel: '8. Reeskont Faiz Gelirleri',                 label: '8. Reeskont Faiz Gelirleri' },
  { sub: '648', subLabel: '9. Enflasyon Düzeltmesi Karları',            label: '9. Enflasyon Düzeltmesi Karları' },
  { sub: '649', subLabel: '10. Diğer Olağan Gelir ve Karlar',           label: '10. Diğer Olağan Gelir ve Karlar' },
  // G. DİĞER OLAĞAN GİDER
  { k: 'digerGiderler', label: 'G. DİĞER FAAL. OLAĞAN GİDER VE ZARARLAR (-)', group: true, negative: true },
  { sub: '653', subLabel: '1. Komisyon Giderleri (-)',                  label: '1. Komisyon Giderleri (-)' },
  { sub: '654', subLabel: '2. Karşılık Giderleri (-)',                  label: '2. Karşılık Giderleri (-)' },
  { sub: '655', subLabel: '3. Menkul Kıymet Satış Zararları (-)',       label: '3. Menkul Kıymet Satış Zararları (-)' },
  { sub: '656', subLabel: '4. Kambiyo Zararları (-)',                   label: '4. Kambiyo Zararları (-)' },
  { sub: '657', subLabel: '5. Reeskont Faiz Giderleri (-)',             label: '5. Reeskont Faiz Giderleri (-)' },
  { sub: '658', subLabel: '6. Enflasyon Düzeltmesi Zararları',          label: '6. Enflasyon Düzeltmesi Zararları' },
  { sub: '659', subLabel: '7. Diğer Olağan Gider ve Zararlar (-)',      label: '7. Diğer Olağan Gider ve Zararlar (-)' },
  // H. FİNANSMAN GİDERLERİ
  { k: 'finansmanGiderleri', label: 'H. FİNANSMAN GİDERLERİ (-)', group: true, negative: true },
  { sub: '660', subLabel: '1. Kısa Vadeli Borçlanma Giderleri (-)',     label: '1. Kısa Vadeli Borçlanma Giderleri (-)' },
  { sub: '780', subLabel: '1. Kısa Vadeli Borçlanma Giderleri (7/A)',   label: '1. Kısa Vadeli Borçlanma Giderleri (7/A)' },
  { sub: '661', subLabel: '2. Uzun Vadeli Borçlanma Giderleri (-)',     label: '2. Uzun Vadeli Borçlanma Giderleri (-)' },
  // OLAĞAN KAR
  { k: 'olaganKar', label: 'OLAĞAN KAR VEYA ZARAR', total: true },
  // I. OLAĞANDIŞI GELİR
  { k: 'olaganDisiGelir', label: 'I. OLAĞANDIŞI GELİR VE KARLAR', group: true },
  { sub: '671', subLabel: '1. Önceki Dönem Gelir ve Karları',           label: '1. Önceki Dönem Gelir ve Karları' },
  { sub: '679', subLabel: '2. Diğer Olağandışı Gelir ve Karlar',        label: '2. Diğer Olağandışı Gelir ve Karlar' },
  // J. OLAĞANDIŞI GİDER
  { k: 'olaganDisiGider', label: 'J. OLAĞANDIŞI GİDER VE ZARARLAR (-)', group: true, negative: true },
  { sub: '680', subLabel: '1. Çalışmayan Kısım Gider ve Zararları (-)', label: '1. Çalışmayan Kısım Gider ve Zararları (-)' },
  { sub: '681', subLabel: '2. Önceki Dönem Gider ve Zararları (-)',     label: '2. Önceki Dönem Gider ve Zararları (-)' },
  { sub: '689', subLabel: '3. Diğer Olağandışı Gider ve Zararlar (-)',  label: '3. Diğer Olağandışı Gider ve Zararlar (-)' },
  // DÖNEM KARI
  { k: 'donemKari', label: 'DÖNEM KARI VEYA ZARARI', total: true },
  // K. VERGİ
  { k: 'vergiKarsiligi', label: 'K. DÖNEM KARI VERGİ VE YASAL YÜKÜMLÜLÜK KARŞILIKLARI (-)', negative: true },
  // DÖNEM NET KARI
  { k: 'donemNetKari', label: 'DÖNEM NET KARI VEYA ZARARI', final: true },
];

export default function GelirTablosuPage() {
  const qc = useQueryClient();
  const [taxpayerId, setTaxpayerId] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [year, setYear] = useState(() => new Date().getFullYear());

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data?.data ?? r.data ?? []),
  });
  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);

  // Mizan listesini çek — generate için mizan seçmeli
  const { data: mizanList = [] } = useQuery<any[]>({
    queryKey: ['mizan-list', taxpayerId],
    queryFn: () => mizanApi.list(taxpayerId || undefined),
    enabled: !!taxpayerId,
  });

  // Gelir tablosu listesi
  const { data: gtList = [] } = useQuery<any[]>({
    queryKey: ['gt-list', taxpayerId],
    queryFn: () => gelirTablosuApi.list(taxpayerId || undefined),
  });

  // Seçilen yılın 4 çeyreğini slot'lara yerleştir: Q1/Q2/Q3/Q4
  const quarterSlots: Array<any | null> = useMemo(() => {
    const slots: Array<any | null> = [null, null, null, null];
    for (const gt of gtList) {
      // donem "2026-Q1" veya donemTipi "GECICI_Q1" olabilir
      const gtYear = parseInt(String(gt.donem).slice(0, 4));
      if (gtYear !== year) continue;
      const qMatch = String(gt.donem).match(/Q(\d)/) || String(gt.donemTipi).match(/Q(\d)/);
      if (qMatch) {
        const q = parseInt(qMatch[1]) - 1;
        if (q >= 0 && q < 4 && !slots[q]) slots[q] = gt;
      }
    }
    return slots;
  }, [gtList, year]);

  // Mevcut (latest) referans: son dolu çeyrek
  const latestQuarter = [...quarterSlots].reverse().find((s) => s !== null) as any | undefined;
  // Geçmiş karşılaştırma için bir önceki çeyreği bul
  const latestIndex = quarterSlots.findIndex((s) => s === latestQuarter);
  const prevQuarter = latestIndex > 0 ? quarterSlots[latestIndex - 1] : null;

  // 4 çeyreğin TAM detayı — her dönemin stokMaliyetOzet + geciciVergiHesabi backend'den
  const quarterDetails = useQueries({
    queries: quarterSlots.map((q, i) => ({
      queryKey: ['gt-detail', q?.id || `empty-${i}`],
      queryFn: () => (q?.id ? gelirTablosuApi.get(q.id) : Promise.resolve(null)),
      enabled: !!q?.id,
      refetchInterval: 0,
    })),
  });
  // Backwards-compat: eski latestFull referansı — son dolu dönemin detayı
  const latestFull = quarterDetails[latestIndex]?.data || null;

  // Manuel düzeltme inputları — her dönem için ayrı
  const [manuelInputs, setManuelInputs] = useState<Record<string, { gecmisYil: string; oncekiOdenen: string }>>({});
  const getManuel = (id: string) => manuelInputs[id] || { gecmisYil: '', oncekiOdenen: '' };
  const setManuel = (id: string, patch: Partial<{ gecmisYil: string; oncekiOdenen: string }>) =>
    setManuelInputs((prev) => ({ ...prev, [id]: { ...getManuel(id), ...patch } }));
  const parseLocale = (s: string): number => {
    const c = String(s || '').trim();
    if (!c) return 0;
    const n = parseFloat(c.replace(/\./g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  };
  const vergiDuzeltmeMut = useMutation({
    mutationFn: (args: { id: string; gecmisYilZarari: number; oncekiDonemOdenenGeciciVergi: number }) =>
      gelirTablosuApi.updateDuzeltmeler(args.id, {
        gecmisYilZarari: args.gecmisYilZarari,
        oncekiDonemOdenenGeciciVergi: args.oncekiDonemOdenenGeciciVergi,
      }),
    onSuccess: (_d, vars) => {
      toast.success('Vergi matrahı düzeltmesi kaydedildi');
      qc.invalidateQueries({ queryKey: ['gt-detail'] });
      qc.invalidateQueries({ queryKey: ['gt-list'] });
      setManuelInputs((prev) => ({ ...prev, [vars.id]: { gecmisYil: '', oncekiOdenen: '' } }));
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydedilemedi'),
  });

  // Görsel sıralama: Q4 önce → Q1 sonra (kullanıcı isteği)
  // qi (orijinal index 0..3) ile slot'a erişiyoruz, sadece render sırası ters
  const DISPLAY_ORDER = [3, 2, 1, 0] as const;

  // Dönem başlık etiketleri — gelir tablosu, geçici vergi ve stok tablolarında ortak
  const QUARTER_LABELS = [
    { no: '1. DÖNEM', range: 'Ocak – Mart' },
    { no: '2. DÖNEM', range: 'Nisan – Haziran' },
    { no: '3. DÖNEM', range: 'Temmuz – Eylül' },
    { no: '4. DÖNEM', range: 'Ekim – Aralık' },
  ];

  // Dönem başlık <th> render — 3 tabloda da aynı şekilde
  const renderQuarterHeader = (qi: number) => {
    const t = QUARTER_LABELS[qi];
    return (
      <>
        <div style={{ fontSize: 13 }}>{year} · {t.no}</div>
        <div className="font-normal mt-0.5" style={{ fontSize: 11, color: 'rgba(250,250,249,0.55)', fontFamily: REPORT_FONT, letterSpacing: 0 }}>
          {t.range}
        </div>
      </>
    );
  };

  const [selectedMizan, setSelectedMizan] = useState('');

  // Manuel düzeltme state — her çeyrek için ayrı düzenleme
  // { [gelirTablosuId]: { satisMaliyeti: 150000, faaliyetGiderleri: 20000, ... } }
  const [duzeltmelerDraft, setDuzeltmelerDraft] = useState<Record<string, Record<string, number>>>({});
  const [editingManual, setEditingManual] = useState<Record<string, boolean>>({});
  const [clientOutputLoadingId, setClientOutputLoadingId] = useState<string | null>(null);

  const setDuzeltme = (gtId: string, key: string, val: number) => {
    setDuzeltmelerDraft((prev) => {
      const curr = { ...(prev[gtId] || {}) };
      const editingExisting = !!editingManual[manualEditKey(gtId, key)];
      if ((val === 0 || !isFinite(val)) && !editingExisting) delete curr[key];
      else curr[key] = isFinite(val) ? val : 0;
      return { ...prev, [gtId]: curr };
    });
  };
  const manualEditKey = (gtId: string, field: string) => `${gtId}:${field}`;
  const startManualEdit = (gt: any, field: string) => {
    const saved = Number(gt?.duzeltmeler?.[field]) || 0;
    setEditingManual((prev) => ({ ...prev, [manualEditKey(gt.id, field)]: true }));
    setDuzeltme(gt.id, field, saved);
  };
  const baseSatisMaliyeti = (gt: any): number => {
    const original = Number(gt?.detay?.satisMal?.toplam);
    return Number.isFinite(original) ? original : Number(gt?.satisMaliyeti || 0);
  };

  /** Bir kalem için manuel düzeltme dahil efektif tutar */
  const effectiveVal = (gt: any, key: string): number => {
    const base = key === 'satisMaliyeti' ? baseSatisMaliyeti(gt) : Number(gt[key]) || 0;
    // v1.36.52: satisMaliyeti için ÖZEL OVERRİDE mantığı.
    // Manuel SMM input SADECE 621 (Satılan Ticari Mallar Maliyeti) yerine geçer.
    // Diğer kalemler (620, 622, 623, 740) otomatik kalır.
    // Formül: gt.satisMaliyeti (auto 620+621+622+623+740) - gt.detay.satisMaliyeti621 + manuel
    if (key === 'satisMaliyeti') {
      const draftManuel = duzeltmelerDraft[gt.id]?.satisMaliyetiManuel;
      const savedManuel = gt.duzeltmeler?.satisMaliyetiManuel;
      const manuelVal = typeof draftManuel === 'number' ? draftManuel : (typeof savedManuel === 'number' ? savedManuel : 0);
      if (manuelVal > 0) {
        const auto621 = Number(gt?.detay?.satisMaliyeti621) || 0;
        return base - auto621 + manuelVal;
      }
    }
    const draft = duzeltmelerDraft[gt.id]?.[key];
    const saved = gt.duzeltmeler?.[key];
    let val = base;
    if (typeof draft === 'number') val += draft;
    else if (typeof saved === 'number') val += saved;
    return val;
  };

  /** Türevler (Net Satışlar, Brüt Kar vb.) manuel düzeltmeye göre yeniden hesaplanır */
  const derived = (gt: any) => {
    if (!gt) return null;
    const brutSatislar = effectiveVal(gt, 'brutSatislar');
    const satisIndirimleri = effectiveVal(gt, 'satisIndirimleri');
    const netSatislar = brutSatislar - satisIndirimleri;
    const satisMaliyeti = effectiveVal(gt, 'satisMaliyeti');
    const brutSatisKari = netSatislar - satisMaliyeti;
    const faaliyetGiderleri = effectiveVal(gt, 'faaliyetGiderleri');
    const faaliyetKari = brutSatisKari - faaliyetGiderleri;
    const digerGelirler = effectiveVal(gt, 'digerGelirler');
    const digerGiderler = effectiveVal(gt, 'digerGiderler');
    const finansmanGiderleri = effectiveVal(gt, 'finansmanGiderleri');
    const olaganKar = faaliyetKari + digerGelirler - digerGiderler - finansmanGiderleri;
    const olaganDisiGelir = effectiveVal(gt, 'olaganDisiGelir');
    const olaganDisiGider = effectiveVal(gt, 'olaganDisiGider');
    const donemKari = olaganKar + olaganDisiGelir - olaganDisiGider;
    const vergiKarsiligi = effectiveVal(gt, 'vergiKarsiligi');
    const donemNetKari = donemKari - vergiKarsiligi;
    return {
      brutSatislar, satisIndirimleri, netSatislar, satisMaliyeti, brutSatisKari,
      faaliyetGiderleri, faaliyetKari, digerGelirler, digerGiderler, finansmanGiderleri,
      olaganKar, olaganDisiGelir, olaganDisiGider, donemKari, vergiKarsiligi, donemNetKari,
    };
  };

  const saveDuzeltmelerMut = useMutation({
    mutationFn: async (gtId: string) => {
      const data = duzeltmelerDraft[gtId] || {};
      return gelirTablosuApi.updateDuzeltmeler(gtId, data);
    },
    onSuccess: (_, gtId) => {
      toast.success('Düzeltmeler kaydedildi');
      setDuzeltmelerDraft((prev) => {
        const cp = { ...prev }; delete cp[gtId]; return cp;
      });
      setEditingManual((prev) => {
        const cp = { ...prev };
        for (const key of Object.keys(cp)) {
          if (key.startsWith(`${gtId}:`)) delete cp[key];
        }
        return cp;
      });
      qc.invalidateQueries({ queryKey: ['gt-list'] });
    },
    onError: () => toast.error('Kaydedilemedi'),
  });

  const generateMut = useMutation({
    mutationFn: () => gelirTablosuApi.generate({ mizanId: selectedMizan }),
    onSuccess: () => {
      toast.success('Gelir tablosu oluşturuldu');
      qc.invalidateQueries({ queryKey: ['gt-list'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Oluşturulamadı'),
  });

  const exportMut = useMutation({
    mutationFn: async (id: string) => {
      const ab = await gelirTablosuApi.exportExcel(id);
      const blob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gelir-tablosu-${id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => gelirTablosuApi.remove(id),
    onSuccess: () => {
      toast.success('Gelir tablosu silindi');
      qc.invalidateQueries({ queryKey: ['gt-list'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Silinemedi'),
  });

  const lockMut = useMutation({
    mutationFn: (args: { id: string; note?: string }) => gelirTablosuApi.lock(args.id, args.note),
    onSuccess: () => { toast.success('Gelir tablosu kesin kayıt'); qc.invalidateQueries({ queryKey: ['gt-list'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kilitlenemedi'),
  });
  const unlockMut = useMutation({
    mutationFn: (args: { id: string; reason: string }) => gelirTablosuApi.unlock(args.id, args.reason),
    onSuccess: () => { toast.success('Kilit açıldı'); qc.invalidateQueries({ queryKey: ['gt-list'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Açılamadı'),
  });
  const handleLock = (id: string) => {
    const note = prompt('Kesin kayıt notu (opsiyonel — beyanname no vb.):') || '';
    if (!confirm('Gelir tablosu kesin kayıt olarak işaretlenecek. Sonra düzeltme yapılamaz. Devam?')) return;
    lockMut.mutate({ id, note });
  };
  const handleUnlock = (id: string) => {
    const reason = prompt('Kilidi açma sebebi (en az 5 karakter):') || '';
    if (reason.length < 5) return toast.error('En az 5 karakter gerekli');
    unlockMut.mutate({ id, reason });
  };

  const filteredTp = taxpayers.filter((t) =>
    taxpayerName(t).toLowerCase().includes(pickerSearch.toLowerCase()),
  );

  // Oran hesaplama
  const pct = (numerator: number, denominator: number): string => {
    if (!denominator) return '';
    return '%' + ((numerator / denominator) * 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Oran göster: hangi satırlarda?
  const showPct = (k: string): boolean =>
    ['netSatislar', 'brutSatisKari', 'faaliyetGiderleri', 'faaliyetKari', 'finansmanGiderleri', 'olaganKar', 'donemKari', 'donemNetKari'].includes(k as string);

  const latestDerived = latestQuarter ? derived(latestQuarter) : null;

  const getPreviousQuarter = (gt: any): any | null => {
    const yearOfGt = parseInt(String(gt?.donem || '').slice(0, 4), 10);
    if (yearOfGt !== year) return null;
    const qMatch = String(gt?.donem || '').match(/Q(\d)/) || String(gt?.donemTipi || '').match(/Q(\d)/);
    if (!qMatch) return null;
    const qIndex = parseInt(qMatch[1], 10) - 1;
    if (qIndex <= 0) return null;
    return quarterSlots[qIndex - 1] || null;
  };

  const reportPct = (numerator: number, denominator: number): string => {
    if (!denominator) return '—';
    return pct(numerator, denominator);
  };

  const buildClientReportRows = (gt: any, values: any): ClientReportRow[] => {
    const rows: ClientReportRow[] = [];
    const netSales = Number(values?.netSatislar) || 0;
    const hasMissingSalesCost = netSales > 0 && Math.abs(Number(values?.satisMaliyeti) || 0) <= 0.004;
    const costSensitiveKeys = new Set(['brutSatisKari', 'faaliyetKari', 'olaganKar', 'donemKari', 'donemNetKari']);
    const push = (row: ClientReportRow, force = false) => {
      if (force || Math.abs(Number(row.value) || 0) > 0.004) rows.push(row);
    };

    for (const row of TDHP_ROWS) {
      if (row.manual) {
        const draft = duzeltmelerDraft[gt.id]?.[row.manual];
        const saved = gt?.duzeltmeler?.[row.manual];
        const v = typeof draft === 'number' ? draft : (typeof saved === 'number' ? saved : 0);
        push({ code: row.kod || '', label: row.label, value: v, type: 'manual' });
        continue;
      }

      if (row.sub) {
        const v = getSubAccountAmount(gt, row.sub);
        push({ code: row.sub, label: row.subLabel || row.label, value: v, type: 'sub' });
        continue;
      }

      if (row.k) {
        const v = Number(values?.[row.k]) || 0;
        const forceMissingCostRow = hasMissingSalesCost && row.k === 'satisMaliyeti';
        const percent = forceMissingCostRow
          ? 'Kayıt yok'
          : hasMissingSalesCost && costSensitiveKeys.has(row.k)
          ? 'Kontrol'
          : showPct(row.k) && netSales
          ? reportPct(v, netSales)
          : undefined;
        push({
          code: row.kod || '',
          label: row.label,
          value: v,
          percent,
          type: row.final ? 'final' : row.total ? 'total' : 'group',
        }, forceMissingCostRow);
      }
    }

    return rows;
  };

  const buildClientReportRatios = (gt: any, values: any): ClientReportRatio[] => {
    const netSales = Number(values?.netSatislar) || 0;
    const netProfit = Number(values?.donemNetKari) || 0;
    const grossProfit = Number(values?.brutSatisKari) || 0;
    const operatingProfit = Number(values?.faaliyetKari) || 0;
    const cost = Number(values?.satisMaliyeti) || 0;
    const financeCost = Number(values?.finansmanGiderleri) || 0;
    const hasMissingSalesCost = netSales > 0 && Math.abs(cost) <= 0.004;
    const previous = getPreviousQuarter(gt);
    const previousSales = Number(previous?.netSatislar) || 0;
    const salesGrowth = previousSales ? netSales - previousSales : 0;

    const ratios: ClientReportRatio[] = [
      { label: 'Brüt Kar Marjı', value: hasMissingSalesCost ? 'Kontrol' : reportPct(grossProfit, netSales), tone: hasMissingSalesCost ? 'warn' : grossProfit >= 0 ? 'good' : 'bad' },
      { label: 'Faaliyet Kar Marjı', value: hasMissingSalesCost ? 'Kontrol' : reportPct(operatingProfit, netSales), tone: hasMissingSalesCost ? 'warn' : operatingProfit >= 0 ? 'good' : 'warn' },
      { label: 'Net Kar Marjı', value: hasMissingSalesCost ? 'Kontrol' : reportPct(netProfit, netSales), tone: hasMissingSalesCost ? 'warn' : netProfit >= 0 ? 'good' : 'bad' },
      { label: 'Maliyet / Ciro', value: hasMissingSalesCost ? 'Kayıt yok' : reportPct(cost, netSales), tone: hasMissingSalesCost || cost > netSales * 0.75 ? 'warn' : 'neutral' },
      ...(financeCost ? [{ label: 'Finansman Gider Oranı', value: reportPct(financeCost, netSales), tone: financeCost > netSales * 0.1 ? 'warn' : 'neutral' } as ClientReportRatio] : []),
      ...(previousSales ? [{ label: 'Satış Büyümesi', value: reportPct(salesGrowth, previousSales), tone: salesGrowth >= 0 ? 'good' : 'bad' } as ClientReportRatio] : []),
    ];
    return ratios.filter((r) => r.value !== '—');
  };

  const buildClientTaxPayable = (gt: any, values: any): number => {
    const tax = gt?.geciciVergiHesabi;
    if (!tax) return Number(values?.vergiKarsiligi) || 0;

    const manualState = gt?.id ? getManuel(gt.id) : { gecmisYil: '', oncekiOdenen: '' };
    const draftGY = manualState?.gecmisYil ? parseLocale(manualState.gecmisYil) : null;
    const draftOO = manualState?.oncekiOdenen ? parseLocale(manualState.oncekiOdenen) : null;
    const gecmisYil = draftGY !== null ? draftGY : Number(tax.gecmisYilZarari || 0);
    const oncekiOdenen =
      draftOO !== null
        ? draftOO
        : Number(tax.oncekiDonemOdenenGeciciVergi ?? tax.oncekiDonemOdenen ?? 0);
    const toplamKar = (Number(values?.donemNetKari) || 0) + (Number(tax.kkeg) || 0);
    const matrah = Math.max(0, toplamKar - gecmisYil);
    const oran = Number(tax.gecicVergiOrani) || 0.25;

    return Math.max(0, matrah * oran - oncekiOdenen);
  };

  const buildClientHighlights = (gt: any, values: any): ClientReportHighlight[] => {
    const netProfit = Number(values?.donemNetKari) || 0;
    const netSales = Number(values?.netSatislar) || 0;
    const cost = Number(values?.satisMaliyeti) || 0;
    const hasMissingSalesCost = netSales > 0 && Math.abs(cost) <= 0.004;
    const taxPayable = buildClientTaxPayable(gt, values);
    return [
      {
        label: hasMissingSalesCost ? (netProfit >= 0 ? 'Tablodaki kâr' : 'Tablodaki zarar') : netProfit >= 0 ? 'Çıkan kâr' : 'Çıkan zarar',
        value: `${fmtTRY(Math.abs(netProfit))} TL`,
        tone: hasMissingSalesCost ? 'warn' : netProfit >= 0 ? 'good' : 'bad',
      },
      {
        label: hasMissingSalesCost ? 'Vergi kontrol' : 'Ödenecek vergi',
        value: `${fmtTRY(taxPayable)} TL`,
        tone: hasMissingSalesCost || taxPayable > 0 ? 'warn' : 'neutral',
      },
    ];
  };

  const buildClientAssessment = (gt: any, values: any, ratios: ClientReportRatio[]): string[] => {
    const netSales = Number(values?.netSatislar) || 0;
    const netProfit = Number(values?.donemNetKari) || 0;
    const grossProfit = Number(values?.brutSatisKari) || 0;
    const operatingProfit = Number(values?.faaliyetKari) || 0;
    const cost = Number(values?.satisMaliyeti) || 0;
    const expenses = Number(values?.faaliyetGiderleri) || 0;
    const financeCost = Number(values?.finansmanGiderleri) || 0;
    const taxPayable = buildClientTaxPayable(gt, values);
    const hasMissingSalesCost = netSales > 0 && Math.abs(cost) <= 0.004;
    const netMargin = ratios.find((r) => r.label === 'Net Kar Marjı')?.value || '—';
    const grossMargin = ratios.find((r) => r.label === 'Brüt Kar Marjı')?.value || '—';
    const costRatio = ratios.find((r) => r.label === 'Maliyet / Ciro')?.value || '—';
    const expenseRatio = reportPct(expenses, netSales);
    const growth = ratios.find((r) => r.label === 'Satış Büyümesi')?.value;
    const netMarginValue = netSales ? (netProfit / netSales) * 100 : 0;

    if (!netSales) {
      return [
        'Bu dönem için satış hareketi görünmüyor.',
        'Mükellefe göndermeden önce satış, maliyet ve gider kayıtlarının eksiksiz aktarıldığını kontrol etmek iyi olur.',
      ];
    }

    if (hasMissingSalesCost) {
      const lines = [
        `Genel tablo: ${fmtTRY(netSales)} ciro görünüyor; ancak satış maliyeti eksik olduğu için tablodaki ${fmtTRY(Math.abs(netProfit))} ${netProfit >= 0 ? 'kâr' : 'zarar'} nihai sonuç değildir.`,
        'Kritik kontrol: Alış, stok ve maliyet kayıtları tamamlanmadan brüt kâr, net kâr ve vergi tutarı sağlıklı yorumlanamaz.',
        `Vergi etkisi: Şu anki vergi görünümü ${fmtTRY(taxPayable)} TL; maliyet kaydı eklendiğinde bu tutar değişebilir.`,
        'Aksiyon: Mizan, stok ve maliyet kayıtları kontrol edilip rapor tekrar alınmalıdır.',
      ];
      if (financeCost > netSales * 0.05) {
        lines.push(`Ek kontrol: Finansman gideri ${fmtTRY(financeCost)} seviyesinde. Borçlanma maliyeti ayrıca izlenmeli.`);
      }
      if (growth) lines.push(`Önceki döneme göre satışlardaki değişim ${growth}.`);
      return lines.slice(0, 6);
    }

    const resultText = netProfit >= 0
      ? `${fmtTRY(netProfit)} kâr`
      : `${fmtTRY(Math.abs(netProfit))} zarar`;
    const costText = cost > netSales * 0.75
      ? `Maliyet oranı ${costRatio}; bu seviye kârı baskılıyor. Alış maliyeti, satış fiyatı ve indirimler birlikte gözden geçirilmeli.`
      : cost < netSales * 0.45
      ? `Maliyet oranı ${costRatio}; brüt kâr marjı ${grossMargin}. Bu güçlü görünüm stok ve maliyet kayıtlarıyla teyit edilmeli.`
      : `Maliyet oranı ${costRatio}; brüt kâr marjı ${grossMargin}. Mevcut yapı korunursa kârlılık dengeli ilerler.`;
    const expenseText = financeCost > netSales * 0.05
      ? `Faaliyet giderleri ${expenseRatio}; ayrıca ${fmtTRY(financeCost)} finansman gideri var. Borçlanma maliyeti net kârı aşağı çekebilir.`
      : operatingProfit >= 0
      ? `Faaliyet giderleri cironun ${expenseRatio} kadarını kullanıyor; gider seviyesi mevcut kârlılığı destekliyor.`
      : `Faaliyet giderleri kârı aşağı çekiyor; giderlerin ciroya oranı ${expenseRatio}. Gider kalemleri ayrı ayrı izlenmeli.`;
    const profitText = netProfit >= 0
      ? netMarginValue >= 15
        ? `Net kâr marjı ${netMargin}; işletme satıştan güçlü kâr üretiyor.`
        : `Net kâr marjı ${netMargin}; kâr var ancak marj hassas, gider ve maliyet artışları yakından izlenmeli.`
      : `Dönem zarar ile kapanıyor; fiyatlama, maliyet ve gider planı birlikte yeniden değerlendirilmelidir.`;
    const taxText = taxPayable > 0
      ? `Vergi hazırlığı: Bu tabloya göre ${fmtTRY(taxPayable)} TL geçici vergi karşılığı ayrılması gerekir.`
      : 'Vergi hazırlığı: Bu tabloya göre ödenecek geçici vergi görünmüyor; yine de mahsup ve geçmiş dönem kayıtları kontrol edilmelidir.';
    const forecastText = netProfit >= 0
      ? 'Nakit ve öngörü: Kâr, tahsilat anlamına gelmez. Cari hesap, banka/kasa ve tahsilat yaşlandırması birlikte kontrol edilirse dönem daha güvenli yönetilir.'
      : 'Nakit ve öngörü: Zarar dönemlerinde tahsilat ve gider ödeme planı birlikte hazırlanmalı; nakit açığı oluşmadan önlem alınmalıdır.';

    const lines = [
      `Genel tablo: Bu dönem ${fmtTRY(netSales)} ciro yapılmış ve dönem sonunda ${resultText} oluşmuştur.`,
      `Kârlılık: ${profitText}`,
      `Maliyet disiplini: ${costText}`,
      `Gider kontrolü: ${expenseText}`,
      taxText,
      forecastText,
    ];
    if (growth) lines[0] += ` Önceki döneme göre satış değişimi ${growth}.`;
    return lines.slice(0, 6);
  };

  const handleClientOutput = async (gt: any) => {
    if (!gt?.id) {
      toast.error('Önce gelir tablosu oluşturun');
      return;
    }

    setClientOutputLoadingId(gt.id);
    try {
      const full = await gelirTablosuApi.get(gt.id);
      const values = derived(full);
      if (!values) {
        toast.error('Gelir tablosu verisi hazırlanamadı');
        return;
      }

      const taxpayer = selectedTp || full.taxpayer || gt.taxpayer;
      const rows = buildClientReportRows(full, values);
      if (!rows.length) {
        toast.info('Çıktıya yansıyacak hareket bulunmuyor');
        return;
      }
      const ratios = buildClientReportRatios(full, values);
      const highlights = buildClientHighlights(full, values);
      const assessment = buildClientAssessment(full, values, ratios);
      const reportHtml = buildClientReportHtml({
        taxpayerName: taxpayer ? taxpayerName(taxpayer) : 'Mükellef',
        taxNumber: taxpayer?.taxNumber || '',
        period: formatDonemRangeLabel(full.donem, full.donemTipi),
        logoUrl: `${window.location.origin}/brand/moren-logo-gold.png`,
        rows,
        ratios,
        highlights,
        assessment,
        generatedAt: new Date().toLocaleDateString('tr-TR'),
      });

      const printWindow = window.open('', '_blank', 'width=960,height=720');
      if (!printWindow) {
        toast.error('Çıktı penceresi açılamadı. Tarayıcı pop-up iznini kontrol edin.');
        return;
      }
      printWindow.document.open();
      printWindow.document.write(reportHtml);
      printWindow.document.close();
      printWindow.focus();
      printWindow.document.title = '';
      setTimeout(() => {
        printWindow.document.title = '';
        printWindow.print();
      }, 750);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Mükellef çıktısı hazırlanamadı');
    } finally {
      setClientOutputLoadingId(null);
    }
  };

  return (
    <div className="financial-report-readable space-y-3 max-w-7xl">
      <div className="pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
            <Sparkles size={10} className="inline mr-1" /> Mali Rapor
          </span>
        </div>
        <h1 style={{ fontFamily: REPORT_FONT, fontSize: 30, fontWeight: 700, color: '#fafaf9', letterSpacing: 0 }}>
          Gelir Tablosu
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
          Mizan hesap kodlarından otomatik üretilen gelir tablosu. Geçici vergi beyannameleri için hazır format, geçmiş dönemler karşılaştırmalı.
        </p>
      </div>

      {/* Komut barı */}
      <div className="rounded-xl border p-5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[260px]">
            <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <Users size={11} className="inline mr-1" /> Mükellef
            </label>
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full px-3 py-2.5 rounded-lg text-sm border outline-none flex items-center gap-2 text-left"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
            >
              <span className="flex-1 truncate" style={{ color: selectedTp ? '#fafaf9' : 'rgba(250,250,249,0.45)' }}>
                {selectedTp ? taxpayerName(selectedTp) : 'Mükellef seç…'}
              </span>
              {selectedTp && (
                <span onClick={(e) => { e.stopPropagation(); setTaxpayerId(''); setSelectedMizan(''); }} className="p-0.5 rounded">
                  <X size={13} />
                </span>
              )}
              <ChevronDown size={14} />
            </button>
          </div>

          <div>
            <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <Calendar size={11} className="inline mr-1" /> Yıl
            </label>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="px-3 py-2.5 rounded-lg text-sm border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9', minWidth: 110 }}
            >
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i).map((y) => (
                <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[240px]">
            <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              Kaynak Mizan
            </label>
            <select
              value={selectedMizan}
              onChange={(e) => setSelectedMizan(e.target.value)}
              disabled={!taxpayerId || mizanList.length === 0}
              className="w-full px-3 py-2.5 rounded-lg text-sm border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
            >
              <option value="" style={{ background: '#0f0d0b' }}>
                {!taxpayerId ? 'Önce mükellef seçin' : mizanList.length === 0 ? 'Bu mükellef için mizan yok' : '— Mizan seçin (hangi çeyreği üretecek) —'}
              </option>
              {mizanList.map((m: any) => (
                <option key={m.id} value={m.id} style={{ background: '#0f0d0b' }}>
                  {formatDonemRangeLabel(m.donem, m.donemTipi)}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => {
              if (!selectedMizan) { toast.error('Önce mizan seçin'); return; }
              generateMut.mutate();
            }}
            disabled={generateMut.isPending || !selectedMizan}
            className="px-5 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
          >
            {generateMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Mizandan Oluştur
          </button>
        </div>
      </div>

      {/* 4 Çeyrek Yıllık Görünüm — Q4 · Q3 · Q2 · Q1 (ters sıra, kullanıcı isteği) */}
      <div>
        <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          Gelir Tablosu
          {selectedTp && (
            <span style={{ color: GOLD, fontWeight: 700 }}>
              · {taxpayerName(selectedTp)}
            </span>
          )}
          <span style={{ color: 'rgba(250,250,249,0.55)' }}>· {year}</span>
          <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.28)', color: GOLD }}>
            {quarterSlots.filter(Boolean).length}/4 çeyrek
          </span>
          {latestQuarter && (
            <button
              type="button"
              onClick={() => handleClientOutput(latestQuarter)}
              disabled={clientOutputLoadingId === latestQuarter.id}
              className="ml-auto inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-bold disabled:opacity-50"
              style={{
                background: 'rgba(212,184,118,0.12)',
                border: '1px solid rgba(212,184,118,0.32)',
                color: AMOUNT_COLOR,
              }}
            >
              {clientOutputLoadingId === latestQuarter.id ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
              Mükellef Çıktısı
            </button>
          )}
        </h3>
        <div className="rounded-xl overflow-hidden overflow-x-auto" style={{
          background: TABLE_BG,
          border: `1px solid ${GRID_LINE_STRONG}`,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05), 0 16px 34px rgba(0,0,0,0.24)',
        }}>
          <table className="w-full text-left" style={{ fontFamily: REPORT_FONT, fontVariantNumeric: 'tabular-nums', borderCollapse: 'collapse', borderSpacing: 0, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: CODE_COL_WIDTH }} />
              <col style={{ width: ACCOUNT_COL_WIDTH }} />
              <col style={{ width: PERIOD_COL_WIDTH }} />
              <col style={{ width: PERIOD_COL_WIDTH }} />
              <col style={{ width: PERIOD_COL_WIDTH }} />
              <col style={{ width: PERIOD_COL_WIDTH }} />
            </colgroup>
            <thead>
              {/* Firma adı satırı — KOD/KALEM üstüne */}
              {selectedTp && (
                <tr style={{ background: 'rgba(184,160,111,0.12)', borderBottom: `1px solid ${GRID_LINE_STRONG}` }}>
                  <th
                    colSpan={2 + 4}
                    className="px-4 py-2.5 text-left"
                    style={{
                      color: GOLD,
                      fontFamily: REPORT_FONT,
                      fontSize: 14,
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {taxpayerName(selectedTp)}
                    {selectedTp.taxNumber && (
                      <span className="ml-2 text-[12px]" style={{ color: 'rgba(250,250,249,0.5)', fontFamily: REPORT_FONT, fontWeight: 500 }}>
                        · VKN/TCKN: {selectedTp.taxNumber}
                      </span>
                    )}
                  </th>
                </tr>
              )}
              <tr>
                <th style={{ padding: '12px 14px', background: 'rgba(184,160,111,0.08)', borderBottom: `1px solid ${GRID_LINE}` }}></th>
                <th style={{ padding: '12px 14px', background: 'rgba(184,160,111,0.08)', borderBottom: `1px solid ${GRID_LINE}` }}></th>
                {DISPLAY_ORDER.map((qi) => {
                  const t = [
                    { no: '1. DÖNEM', range: 'Ocak – Mart' },
                    { no: '2. DÖNEM', range: 'Nisan – Haziran' },
                    { no: '3. DÖNEM', range: 'Temmuz – Eylül' },
                    { no: '4. DÖNEM', range: 'Ekim – Aralık' },
                  ][qi];
                  const gt = quarterSlots[qi];
                  const locked = gt?.locked;
                  return (
                    <th
                      key={qi}
                      className="text-center"
                      style={{
                        color: gt ? GOLD : MISSING_AMOUNT_COLOR,
                        fontSize: 14,
                        padding: '12px 14px 6px',
                        background: locked ? 'rgba(184,160,111,0.14)' : 'rgba(184,160,111,0.08)',
                        borderLeft: `1px solid ${GRID_LINE}`,
                        borderBottom: `1px solid ${GRID_LINE}`,
                        fontFamily: REPORT_FONT,
                        fontWeight: 600,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      <div style={{ fontSize: 15 }}>{year} · {t.no}</div>
                      <div className="font-normal mt-0.5" style={{ fontSize: 11.5, color: gt ? 'rgba(250,250,249,0.6)' : 'rgba(250,250,249,0.3)', fontFamily: REPORT_FONT, letterSpacing: 0 }}>
                        {t.range}
                      </div>
                      {locked && (
                        <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontFamily: REPORT_FONT }}>
                          <Lock size={9} /> KESİN
                        </span>
                      )}
                      {!gt && <div className="text-[10px] font-normal mt-0.5" style={{ color: 'rgba(250,250,249,0.3)', fontFamily: REPORT_FONT }}>Veri yok</div>}
                      {gt && (
                        <div className="flex items-center justify-center gap-1 mt-1.5" style={{ fontFamily: REPORT_FONT }}>
                          <button
                            onClick={() => locked ? handleUnlock(gt.id) : handleLock(gt.id)}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded"
                            style={{
                              background: locked ? 'rgba(244,63,94,0.1)' : 'rgba(184,160,111,0.1)',
                              color: locked ? '#f43f5e' : GOLD,
                              border: `1px solid ${locked ? 'rgba(244,63,94,0.25)' : 'rgba(184,160,111,0.25)'}`,
                            }}
                          >
                            {locked ? 'Kilidi Aç' : 'Kesin Kayıt'}
                          </button>
                          <button
                            onClick={() => exportMut.mutate(gt.id)}
                            disabled={exportMut.isPending}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded"
                            style={{ background: 'rgba(184,160,111,0.1)', color: GOLD, border: '1px solid rgba(184,160,111,0.25)' }}
                          >
                            Excel
                          </button>
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
              <tr style={{ borderBottom: `1px solid ${GRID_LINE_STRONG}` }}>
                <th className="px-3 py-2 text-left text-[12px] font-bold uppercase tracking-[.06em]" style={{ color: '#f5efe3', background: 'rgba(184,160,111,0.16)', borderRight: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${CELL_LINE_STRONG}` }}>Kod</th>
                <th className="px-3 py-2 text-left text-[12px] font-bold uppercase tracking-[.06em]" style={{ color: '#f5efe3', background: 'rgba(184,160,111,0.16)', borderRight: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${CELL_LINE_STRONG}` }}>Kalem</th>
                {DISPLAY_ORDER.map((qi) => (
                  <th key={qi} className="px-3 py-2 text-center text-[12px] font-bold uppercase tracking-[.06em]" style={{ color: '#f5efe3', background: 'rgba(184,160,111,0.16)', borderLeft: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${CELL_LINE_STRONG}` }}>Tutar</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TDHP_ROWS.map((row, idx) => {
                // Alt hesap satırı (sub kodu)
                if (row.sub) {
                  return (
                    <tr key={idx} style={{ borderTop: `1px solid ${GRID_LINE}`, background: ACCOUNT_ROW_BG }}>
                      <td className="px-3 py-2 text-[13px]" style={{ color: '#d8c17f', textAlign: 'left', fontWeight: 700, fontFamily: REPORT_FONT, fontVariantNumeric: 'tabular-nums', borderRight: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${CELL_LINE}` }}>{row.sub}</td>
                      <td className="px-3 py-2 text-[13px]" style={{ color: 'rgba(250,250,249,0.82)', fontWeight: 500, paddingLeft: 8, borderRight: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${CELL_LINE}` }}>
                        {row.subLabel}
                      </td>
                      {DISPLAY_ORDER.map((qi) => {
                        const gt = quarterSlots[qi];
                        const v = gt ? getSubAccountAmount(gt, row.sub!) : null;
                        const hasData = gt !== null;
                        return (
                          <td key={qi} className="px-3 py-2 text-center" style={{ borderLeft: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${CELL_LINE}` }}>
                            <AmountText value={hasData ? v! : null} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                }

                // Manuel düzeltme satırı (input ile) — 621'in hemen altında
                if (row.manual) {
                  return (
                    <tr key={idx} style={{ borderTop: '1px dashed rgba(96,165,250,0.30)', background: 'rgba(96,165,250,0.045)' }}>
                      <td className="px-3 py-2.5 text-[12.5px]" style={{ color: '#60a5fa', textAlign: 'left', fontWeight: 700, fontFamily: REPORT_FONT, borderRight: `1px solid ${GRID_LINE}`, borderBottom: '1px dashed rgba(96,165,250,0.35)' }}>Manuel</td>
                      <td className="px-3 py-2.5 text-[13.5px]" style={{ color: '#60a5fa', fontWeight: 600, paddingLeft: 8, borderRight: `1px solid ${GRID_LINE}`, borderBottom: '1px dashed rgba(96,165,250,0.35)' }}>
                        {row.label}
                      </td>
                      {DISPLAY_ORDER.map((qi) => {
                        const gt = quarterSlots[qi];
                        const hasData = gt !== null;
                        if (!hasData) {
                          return (
                            <td key={qi} style={{ borderLeft: `1px solid ${GRID_LINE}`, borderBottom: '1px dashed rgba(96,165,250,0.35)' }}></td>
                          );
                        }
                        const field = row.manual!;
                        const hasDraft = duzeltmelerDraft[gt.id]?.[field] !== undefined;
                        const savedVal = gt.duzeltmeler?.[field] as number | undefined;
                        const hasSaved = typeof savedVal === 'number' && savedVal > 0;
                        const isEditing = !hasSaved || hasDraft || !!editingManual[manualEditKey(gt.id, field)];
                        return (
                          <td key={qi} className="px-2 py-1.5 text-center" style={{ borderLeft: `1px solid ${GRID_LINE}`, borderBottom: '1px dashed rgba(96,165,250,0.35)' }}>
                            <ManuelInput
                              gtId={gt.id}
                              field={field}
                              draftVal={duzeltmelerDraft[gt.id]?.[field]}
                              savedVal={savedVal}
                              isLocked={gt.locked}
                              isEditing={isEditing}
                              onChange={(n) => setDuzeltme(gt.id, row.manual!, n)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                }

                // Normal satır (group / total / final)
                const rowBg =
                  row.final ? FINAL_ROW_BG :
                  row.total ? MAIN_ROW_BG :
                  row.group ? MAIN_ROW_BG :
                  ACCOUNT_ROW_BG;
                const bold = row.final || row.total || row.group;
                const labelColor = row.final ? TOTAL_COLOR : row.total ? TOTAL_COLOR : row.group ? '#fafaf9' : 'rgba(250,250,249,0.7)';
                const labelFont = REPORT_FONT;
                return (
                  <tr
                    key={idx}
                    style={{
                      background: rowBg,
                      borderTop: row.total ? `1px solid ${GRID_LINE_STRONG}` : `1px solid ${GRID_LINE}`,
                      borderBottom: row.total ? `1px solid ${GRID_LINE_STRONG}` : undefined,
                    }}
                  >
                    <td className="px-3 py-2.5 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.62)', textAlign: 'left', fontWeight: 600, fontFamily: REPORT_FONT, fontVariantNumeric: 'tabular-nums', borderRight: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${row.total || row.final ? CELL_LINE_STRONG : CELL_LINE}` }}>{row.kod || ''}</td>
                    <td
                      className="px-3 py-2.5"
                      style={{
                        color: labelColor,
                        fontWeight: row.final ? 700 : bold ? 700 : 500,
                        fontFamily: labelFont,
                        fontSize: row.final ? 14.5 : row.total ? 14.5 : row.group ? 14.5 : 14,
                        fontStyle: 'normal',
                        textTransform: 'none',
                        letterSpacing: 0,
                        borderRight: `1px solid ${GRID_LINE}`,
                        borderBottom: `1px solid ${row.total || row.final ? CELL_LINE_STRONG : CELL_LINE}`,
                      }}
                    >
                      {row.label}
                    </td>
                    {DISPLAY_ORDER.map((qi) => {
                      const gt = quarterSlots[qi];
                      const d = derived(gt);
                      const v = d ? ((d as any)[row.k!] ?? 0) : null;
                      const netSatis = d ? (d.netSatislar || 1) : 1;
                      const hasData = gt !== null;
                      const showOranBadge = hasData && showPct(row.k as string) && v !== 0;
                      const mainAmount = row.group || row.total || row.final;
                      const amountColor = hasData && v !== 0
                        ? ['brutSatisKari','faaliyetKari','olaganKar','donemKari','donemNetKari'].includes(row.k as string)
                          ? (v < 0 ? LOSS_COLOR : PROFIT_COLOR)
                          : row.total ? TOTAL_COLOR
                            : (v < 0 ? LOSS_COLOR : AMOUNT_COLOR)
                        : undefined;
                      return (
                        <td
                          key={qi}
                          className="px-3 py-2.5 text-center"
                          style={{
                            // v1.36.50: Kar/Zarar satırları (brutSatisKari, faaliyetKari, olaganKar, donemKari, donemNetKari)
                            // → pozitif yeşil, negatif kırmızı (önceden total altın renkti, kar/zarar belli olmuyordu)
                            borderLeft: `1px solid ${GRID_LINE}`,
                            borderBottom: `1px solid ${row.total || row.final ? CELL_LINE_STRONG : CELL_LINE}`,
                          }}
                        >
                          <AmountText value={hasData ? v! : null} color={amountColor} emphasis={!!mainAmount} final={!!row.final} />
                          {showOranBadge && (
                            <div
                              className="inline-flex items-center justify-center mt-1 rounded-md px-2 py-[3px]"
                              style={{
                                color: RATIO_COLOR,
                                background: RATIO_BG,
                                border: `1px solid ${RATIO_BORDER}`,
                                fontFamily: FINANCIAL_FONT,
                                fontSize: 12.5,
                                lineHeight: 1.05,
                                fontWeight: FINANCIAL_AMOUNT_STRONG_WEIGHT,
                                whiteSpace: 'nowrap',
                                minWidth: 86,
                                maxWidth: '100%',
                                textShadow: '0 1px 1px rgba(0,0,0,0.35)',
                              }}
                            >
                              {pct(v!, netSatis)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Kaydet butonu satırı — manuel düzeltme taslağı varsa */}
              {quarterSlots.some((gt) =>
                gt && (
                  Object.keys(duzeltmelerDraft[gt.id] || {}).length > 0 ||
                  (Number(gt.duzeltmeler?.satisMaliyetiManuel) || 0) > 0
                )
              ) && (
                <tr style={{ background: 'rgba(96,165,250,0.08)', borderTop: '1px solid rgba(96,165,250,0.25)' }}>
                  <td colSpan={2} className="px-3 py-3 text-[11.5px]" style={{ color: '#60a5fa' }}>
                    Manuel satılan ticari mallar maliyeti
                  </td>
                  {DISPLAY_ORDER.map((qi) => {
                    const gt = quarterSlots[qi];
                    const hasDraft = !!gt && Object.keys(duzeltmelerDraft[gt.id] || {}).length > 0;
                    const hasSaved = !!gt && (Number(gt.duzeltmeler?.satisMaliyetiManuel) || 0) > 0;
                    return (
                      <td key={qi} className="px-2 py-2 text-right" style={{ borderLeft: '1px solid rgba(255,255,255,0.18)' }}>
                        {gt && (hasDraft || hasSaved) ? (
                          <div className="inline-flex items-center gap-1.5">
                            {hasSaved && !gt.locked && (
                              <button
                                type="button"
                                onClick={() => startManualEdit(gt, 'satisMaliyetiManuel')}
                                className="px-3 py-1.5 rounded text-[11px] font-bold"
                                style={{ background: 'rgba(255,255,255,0.05)', color: '#d4b876', border: '1px solid rgba(212,184,118,0.35)' }}
                              >
                                Düzelt
                              </button>
                            )}
                            {hasDraft && (
                              <button
                                onClick={() => saveDuzeltmelerMut.mutate(gt.id)}
                                disabled={saveDuzeltmelerMut.isPending || gt.locked}
                                className="px-3 py-1.5 rounded text-[11px] font-bold"
                                style={{ background: 'rgba(96,165,250,0.2)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.4)' }}
                              >
                                {saveDuzeltmelerMut.isPending ? 'Kaydediliyor...' : 'Kaydet'}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DEVRE DIŞI — her dönem ayrı blok (kullanıcı 4-sütun yan yana istiyor) */}
      {false && DISPLAY_ORDER.map((qi, displayIdx) => {
          const qd = quarterDetails[qi];
          const detail = qd?.data as any;
          const isLocked = !!detail?.locked;
          const ms = detail?.id ? getManuel(detail.id) : { gecmisYil: '', oncekiOdenen: '' };
          const v = detail?.geciciVergiHesabi as any;
          const stokKodList = detail?.stokMaliyetOzet?.stokHesaplari || [];
          const maliyetKodList = detail?.stokMaliyetOzet?.maliyetHesaplari || [];
          const allKodlar = [...stokKodList, ...maliyetKodList];

          return (
            <div key={qi} className="space-y-3 pt-2" style={{ borderTop: displayIdx > 0 ? '1px dashed rgba(184,160,111,0.15)' : 'none', paddingTop: displayIdx > 0 ? 24 : 0 }}>
              {/* Dönem başlığı */}
              <div className="flex items-baseline gap-3">
                <span className="w-1 h-7 rounded-sm" style={{ background: GOLD }} />
                <h2 className="text-[20px] font-semibold" style={{ color: '#fafaf9', fontFamily: REPORT_FONT }}>
                  {qi + 1}. Dönem
                </h2>
                <span className="text-[12px] font-medium px-2.5 py-[3px] rounded-md" style={{ background: 'rgba(184,160,111,0.28)', color: GOLD }}>
                  {quarterRangeLabel(year, qi + 1)}
                </span>
                {isLocked && (
                  <span className="text-[10px] font-bold px-2 py-[2px] rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                    KESİN KAYIT
                  </span>
                )}
                {!detail && (
                  <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.4)', fontStyle: 'italic' }}>
                    · Bu dönem için veri yok
                  </span>
                )}
              </div>

              {/* Veri yoksa boş placeholder iki tablo göster */}
              {!detail?.geciciVergiHesabi && !detail?.stokMaliyetOzet && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl p-4 text-center text-[12px]" style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.35)' }}>
                    Geçici Vergi Matrahı — veri yok
                  </div>
                  <div className="rounded-xl p-4 text-center text-[12px]" style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.35)' }}>
                    Stok ve Satılan Malın Maliyeti — veri yok
                  </div>
                </div>
              )}

              {/* Geçici Vergi Matrahı — tek sütun */}
              {detail?.geciciVergiHesabi && (
                <div>
                  <h3 className="text-[13px] font-semibold mb-2.5 flex items-center gap-2" style={{ color: 'rgba(250,250,249,0.9)' }}>
                    <span className="w-[3px] h-3.5 rounded-sm" style={{ background: GOLD }} />
                    Geçici Vergi Matrahı Hesaplama
                  </h3>
                  <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(184,160,111,0.2)' }}>
                    <table className="w-full text-left text-[13px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <tbody>
                        {[
                          { key: 'kkeg', label: 'Kanunen Kabul Edilmeyen Gider' },
                          { key: 'toplamKar', label: 'Toplam Kar', bold: true, color: GOLD },
                          { key: 'gecmisYilZarari', label: 'Geçmiş Yıl Zararı', manual: 'gecmisYil' as const, negSign: true },
                          { key: 'gecicVergiMatrahi', label: 'Geçici Vergi Matrahı', bold: true, color: '#22c55e', bg: 'rgba(34,197,94,0.04)' },
                          // v1.36.52: oran etiket backend'den gelen v.gecicVergiOrani'a göre dinamik (TUZEL %25, GERCEK %15)
                          { key: 'hesaplananGeciciVergi', label: `Hesaplanan Geçici Vergi %${Math.round((v.gecicVergiOrani || 0.25) * 100)}` },
                          { key: 'oncekiDonemOdenen', label: 'Önceki Dönem Ödenen Geçici Vergi', manual: 'oncekiOdenen' as const, negSign: true },
                          { key: 'odenecekGeciciVergi', label: 'ÖDENECEK GEÇİCİ VERGİ', bold: true, color: GOLD, bg: 'linear-gradient(135deg, rgba(184,160,111,0.10), rgba(184,160,111,0.03))', big: true },
                        ].map((row: any, ri) => {
                          const val = v[row.key] ?? 0;
                          const isManual = !!row.manual;
                          const isFirstQuarter = v.donemSirasi === 1 && row.key === 'oncekiDonemOdenen';
                          return (
                            <tr key={ri} style={{ borderTop: ri === 0 ? 'none' : '1px solid rgba(255,255,255,0.18)', background: row.bg || 'transparent' }}>
                              <td className="px-3 py-2.5" style={{ color: row.color || 'rgba(250,250,249,0.7)', fontWeight: row.bold ? 700 : 400, fontSize: row.big ? 14 : 13 }}>
                                <span className="inline-flex items-center gap-2">
                                  {row.label}
                                  {row.manual && (
                                    <span className="text-[9.5px] font-bold px-1.5 py-[1px] rounded" style={{ background: 'rgba(184,160,111,0.28)', color: GOLD }}>MANUEL</span>
                                  )}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono" style={{ color: row.color || (val === 0 ? MUTED_AMOUNT_COLOR : AMOUNT_COLOR), fontWeight: row.bold ? FINANCIAL_AMOUNT_STRONG_WEIGHT : FINANCIAL_AMOUNT_WEIGHT, fontSize: FINANCIAL_AMOUNT_SIZE, width: 220, fontFamily: FINANCIAL_FONT, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', letterSpacing: 0 }}>
                                {isManual && !isLocked ? (
                                  isFirstQuarter ? (
                                    <span style={{ color: 'rgba(250,250,249,0.3)' }}>— (ilk dönem)</span>
                                  ) : (
                                    <input
                                      type="text"
                                      placeholder={val > 0 ? fmtTRY(val) : '0,00'}
                                      value={row.manual === 'gecmisYil' ? ms.gecmisYil : ms.oncekiOdenen}
                                      onChange={(e) => setManuel(detail.id, { [row.manual!]: e.target.value } as any)}
                                      className="w-full px-2 py-1 rounded text-[12px] font-mono text-right outline-none border"
                                      style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(184,160,111,0.25)', color: '#fafaf9' }}
                                    />
                                  )
                                ) : val !== 0 ? (row.negSign ? '−' + fmtTRY(val) : fmtTRY(val)) : '0,00'}
                              </td>
                            </tr>
                          );
                        })}
                        {!isLocked && (
                          <tr style={{ borderTop: '1px dashed rgba(184,160,111,0.25)' }}>
                            <td className="px-3 py-2 text-[11px] italic" style={{ color: 'rgba(250,250,249,0.4)' }}>Manuel değerleri kaydet</td>
                            <td className="px-3 py-2 text-right" style={{ width: 220 }}>
                              <button
                                onClick={() => {
                                  vergiDuzeltmeMut.mutate({
                                    id: detail.id,
                                    gecmisYilZarari: parseLocale(ms.gecmisYil),
                                    oncekiDonemOdenenGeciciVergi: parseLocale(ms.oncekiOdenen),
                                  });
                                }}
                                disabled={vergiDuzeltmeMut.isPending}
                                className="px-3 py-1 rounded text-[11px] font-semibold transition-all"
                                style={{ background: GOLD, color: '#0a0906' }}
                              >
                                {vergiDuzeltmeMut.isPending ? '…' : 'Kaydet'}
                              </button>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Stok ve Satılan Malın Maliyeti — tek sütun */}
              {detail?.stokMaliyetOzet && (
                <div>
                  <h3 className="text-[13px] font-semibold mb-2.5 flex items-center gap-2" style={{ color: 'rgba(250,250,249,0.9)' }}>
                    <span className="w-[3px] h-3.5 rounded-sm" style={{ background: GOLD }} />
                    Stok ve Satılan Malın Maliyeti
                  </h3>
                  <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <table className="w-full text-left text-[13px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <th className="px-3 py-2 text-left text-[12px] font-bold uppercase tracking-[.06em]" style={{ color: 'rgba(250,250,249,0.55)', width: 90 }}>Kod</th>
                          <th className="px-3 py-2 text-left text-[12px] font-bold uppercase tracking-[.06em]" style={{ color: 'rgba(250,250,249,0.55)' }}>Hesap Adı</th>
                          <th className="px-3 py-2 text-right text-[12px] font-bold uppercase tracking-[.06em]" style={{ color: 'rgba(250,250,249,0.55)', width: 220 }}>Bakiye</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allKodlar.map((h: any) => (
                          <tr key={h.kod} style={{ borderTop: '1px solid rgba(255,255,255,0.18)' }}>
                            <td className="px-3 py-2 font-mono text-[13px]" style={{ color: GOLD, fontWeight: 600 }}>{h.kod}</td>
                            <td className="px-3 py-2 text-[14px]" style={{ color: 'rgba(250,250,249,0.78)' }}>{h.hesapAdi || HESAP_ADLARI[h.kod] || '—'}</td>
                            <td className="px-3 py-2 text-right font-mono" style={{ color: Number(h.bakiye) === 0 ? MUTED_AMOUNT_COLOR : AMOUNT_COLOR, fontWeight: FINANCIAL_AMOUNT_WEIGHT, fontSize: FINANCIAL_AMOUNT_SIZE, fontFamily: FINANCIAL_FONT, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', letterSpacing: 0 }}>
                              {Number(h.bakiye) !== 0 ? fmtTRY(Number(h.bakiye)) : '0,00'}
                            </td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: '2px solid rgba(184,160,111,0.3)', background: 'rgba(184,160,111,0.04)' }}>
                          <td colSpan={2} className="px-3 py-2.5 font-semibold" style={{ color: GOLD }}>Toplam Stok</td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold" style={{ color: GOLD }}>
                            {fmtTRY(Number(detail.stokMaliyetOzet.toplamStok))}
                          </td>
                        </tr>
                        <tr style={{ borderTop: '1px solid rgba(244,63,94,0.2)', background: 'rgba(244,63,94,0.04)' }}>
                          <td colSpan={2} className="px-3 py-2.5 font-semibold" style={{ color: '#f43f5e' }}>Satılan Malın Maliyeti</td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold" style={{ color: '#f43f5e' }}>
                            {'−' + fmtTRY(Number(detail.stokMaliyetOzet.satisMaliyeti))}
                          </td>
                        </tr>
                        <tr style={{ borderTop: '2px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.04)' }}>
                          <td colSpan={2} className="px-3 py-2.5 font-bold text-[13.5px]" style={{ color: '#22c55e' }}>Kalan Stok</td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold text-[14px]" style={{ color: '#22c55e' }}>
                            {fmtTRY(Number(detail.stokMaliyetOzet.kalanStok))}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}

      {/* GEÇİCİ VERGİ MATRAHI HESAPLAMA — 4 çeyrek yan yana, Q4→Q1 (gelir tablosunun devamı) */}
      {quarterDetails.some((qd) => qd?.data?.geciciVergiHesabi) && (
        <div>
          <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
            <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
            Geçici Vergi Matrahı Hesaplama
            <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.28)', color: GOLD }}>
              {year} · 4 Çeyrek
            </span>
          </h3>
          <div className="rounded-xl overflow-hidden" style={{ background: TABLE_BG, border: `1px solid ${GRID_LINE_STRONG}` }}>
            <table className="w-full text-left text-[13px]" style={{ fontVariantNumeric: 'tabular-nums', borderCollapse: 'collapse', borderSpacing: 0, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: LEADING_COL_WIDTH }} />
                <col style={{ width: PERIOD_COL_WIDTH }} />
                <col style={{ width: PERIOD_COL_WIDTH }} />
                <col style={{ width: PERIOD_COL_WIDTH }} />
                <col style={{ width: PERIOD_COL_WIDTH }} />
              </colgroup>
              <thead>
                {/* Üst başlık — gelir tablosundaki gibi: 2026 · X. DÖNEM + ay aralığı */}
                <tr style={{ borderBottom: `1px solid ${GRID_LINE}` }}>
                  <th style={{ padding: '10px 14px', background: 'rgba(184,160,111,0.08)' }}></th>
                  {DISPLAY_ORDER.map((qi) => (
                    <th
                      key={qi}
                      className="text-center"
                      style={{
                        color: GOLD,
                        fontSize: 13,
                        padding: '10px 14px',
                        background: 'rgba(184,160,111,0.08)',
                        borderLeft: `1px solid ${GRID_LINE}`,
                        fontFamily: REPORT_FONT,
                        fontWeight: 600,
                      }}
                    >
                      {renderQuarterHeader(qi)}
                    </th>
                  ))}
                </tr>
                <tr style={{ borderBottom: `1px solid ${GRID_LINE_STRONG}` }}>
                  <th className="px-3 py-2 text-[12px] font-bold uppercase tracking-[.06em]" style={{ color: '#f5efe3', background: 'rgba(184,160,111,0.16)' }}>Kalem</th>
                  {DISPLAY_ORDER.map((qi) => (
                    <th key={qi} className="px-3 py-2 text-center text-[12px] font-bold uppercase tracking-[.06em]" style={{ color: '#f5efe3', background: 'rgba(184,160,111,0.16)', borderLeft: `1px solid ${GRID_LINE}` }}>
                      Tutar
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { key: 'kkeg', label: 'Kanunen Kabul Edilmeyen Gider' },
                  { key: 'toplamKar', label: 'Toplam Kar', bold: true, color: GOLD },
                  { key: 'gecmisYilZarari', label: 'Geçmiş Yıl Zararı', manual: 'gecmisYil' as const, negSign: true },
                  { key: 'gecicVergiMatrahi', label: 'Geçici Vergi Matrahı', bold: true, color: TOTAL_COLOR, bg: 'rgba(184,160,111,0.08)' },
                  // v1.36.53: dinamik vergi oranı etiketi (TUZEL %25 / GERCEK %15) — quarterDetails'tan ilk dolu olanı kullan
                  { key: 'hesaplananGeciciVergi', label: `Hesaplanan Geçici Vergi %${Math.round((Number(quarterDetails.find((qd) => qd?.data?.geciciVergiHesabi)?.data?.geciciVergiHesabi?.gecicVergiOrani) || 0.25) * 100)}` },
                  { key: 'oncekiDonemOdenen', label: 'Önceki Dönem Ödenen Geçici Vergi', manual: 'oncekiOdenen' as const, negSign: true },
                  { key: 'odenecekGeciciVergi', label: 'ÖDENECEK GEÇİCİ VERGİ', bold: true, color: GOLD, bg: 'linear-gradient(135deg, rgba(184,160,111,0.10), rgba(184,160,111,0.03))', big: true },
                ].map((row: any, ri) => (
                  <tr key={ri} style={{ borderTop: `1px solid ${GRID_LINE}`, background: row.bg || ACCOUNT_ROW_BG }}>
                    <td className="px-3 py-2.5" style={{ color: row.color || 'rgba(250,250,249,0.7)', fontWeight: row.bold ? 700 : 400, fontSize: row.big ? 14 : 13, borderBottom: `1px solid ${GRID_LINE}` }}>
                      <span className="inline-flex items-center gap-2">
                        {row.label}
                        {row.manual && (
                          <span className="text-[9.5px] font-bold px-1.5 py-[1px] rounded" style={{ background: 'rgba(184,160,111,0.28)', color: GOLD }}>MANUEL</span>
                        )}
                      </span>
                    </td>
                    {DISPLAY_ORDER.map((qi) => {
                      const detail = quarterDetails[qi]?.data as any;
                      const v = detail?.geciciVergiHesabi;
                      const hasData = !!v;
                      const manuelState = hasData ? getManuel(detail.id) : null;
                      const isManual = !!row.manual;
                      const isLocked = !!detail?.locked;
                      const isFirstQuarter = hasData && v?.donemSirasi === 1 && row.key === 'oncekiDonemOdenen';

                      // ─── LIVE PREVIEW ─── manuel input değişikliklerini anında yansıt
                      let val: number | null = hasData ? (v[row.key] ?? 0) : null;
                      if (hasData) {
                        // Manuel düzeltmelerle yeniden hesaplanmış donemNetKari → toplamKar'ı etkiler
                        // (gelir tablosundaki manuel düzeltme — örn. satılan ticari mal maliyeti)
                        const slot = quarterSlots[qi];
                        const der = slot ? derived(slot) : null;
                        const liveDonemNetKari = der ? der.donemNetKari : Number(v.donemNetKari || 0);
                        const kkeg = Number(v.kkeg || 0);
                        const liveToplamKar = liveDonemNetKari + kkeg;

                        const draftGY = manuelState?.gecmisYil ? parseLocale(manuelState.gecmisYil) : null;
                        const draftOO = manuelState?.oncekiOdenen ? parseLocale(manuelState.oncekiOdenen) : null;
                        const gecmisYil = draftGY !== null ? draftGY : Number(v.gecmisYilZarari || 0);
                        const oncekiOdenen =
                          draftOO !== null ? draftOO : Number(v.oncekiDonemOdenenGeciciVergi ?? v.oncekiDonemOdenen ?? 0);
                        const matrah = Math.max(0, liveToplamKar - gecmisYil);
                        // v1.36.57: Vergi oranı backend'den (TUZEL %25, GERCEK %15) — hardcoded 0.25 değildi BUG idi
                        const oran = Number(v.gecicVergiOrani) || 0.25;
                        const hesaplanan = matrah * oran;
                        const odenecek = Math.max(0, hesaplanan - oncekiOdenen);
                        if (row.key === 'toplamKar') val = liveToplamKar;
                        else if (row.key === 'gecmisYilZarari') val = gecmisYil;
                        else if (row.key === 'gecicVergiMatrahi') val = matrah;
                        else if (row.key === 'hesaplananGeciciVergi') val = hesaplanan;
                        else if (row.key === 'oncekiDonemOdenen') val = oncekiOdenen;
                        else if (row.key === 'odenecekGeciciVergi') val = odenecek;
                      }

                      return (
                        <td key={qi} className="px-3 py-2 text-center font-mono" style={{ color: !hasData ? MISSING_AMOUNT_COLOR : row.color || (val === 0 ? MUTED_AMOUNT_COLOR : AMOUNT_COLOR), fontWeight: row.bold ? FINANCIAL_AMOUNT_STRONG_WEIGHT : FINANCIAL_AMOUNT_WEIGHT, fontSize: FINANCIAL_AMOUNT_SIZE, borderLeft: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${GRID_LINE}`, fontFamily: FINANCIAL_FONT, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', letterSpacing: 0 }}>
                          {!hasData ? '—' : isManual && !isLocked ? (
                            isFirstQuarter ? (
                              <span style={{ color: 'rgba(250,250,249,0.3)' }}>— (ilk)</span>
                            ) : (
                              <input
                                type="text"
                                placeholder={(val ?? 0) > 0 ? fmtTRY(val ?? 0) : '0,00'}
                                value={row.manual === 'gecmisYil' ? manuelState!.gecmisYil : manuelState!.oncekiOdenen}
                                onChange={(e) => setManuel(detail.id, { [row.manual!]: e.target.value } as any)}
                                onBlur={(e) => {
                                  // Blur'da formatla — TR locale
                                  const n = parseLocale(e.target.value);
                                  const formatted = n === 0 ? '' : n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                  setManuel(detail.id, { [row.manual!]: formatted } as any);
                                }}
                                className="w-full px-2 py-1 rounded text-[13px] font-mono text-center outline-none border"
                                style={{ background: 'rgba(96,165,250,0.06)', borderColor: 'rgba(96,165,250,0.3)', color: '#60a5fa', fontWeight: 600 }}
                              />
                            )
                          ) : val !== 0 && val !== null ? (row.negSign ? '−' + fmtTRY(val) : fmtTRY(val)) : '0,00'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* Kaydet butonları satırı */}
                <tr style={{ borderTop: `1px dashed ${GRID_LINE_STRONG}` }}>
                  <td className="px-3 py-2 text-[11px] italic" style={{ color: 'rgba(250,250,249,0.4)', borderBottom: `1px solid ${GRID_LINE}` }}>Manuel değerleri kaydet</td>
                  {DISPLAY_ORDER.map((qi) => {
                    const detail = quarterDetails[qi]?.data as any;
                    const hasData = !!detail?.geciciVergiHesabi;
                    const isLocked = !!detail?.locked;
                    return (
                      <td key={qi} className="px-2 py-2 text-center" style={{ borderLeft: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${GRID_LINE}` }}>
                        {hasData && !isLocked && (
                          <button
                            onClick={() => {
                              const ms = getManuel(detail.id);
                              vergiDuzeltmeMut.mutate({
                                id: detail.id,
                                gecmisYilZarari: parseLocale(ms.gecmisYil),
                                oncekiDonemOdenenGeciciVergi: parseLocale(ms.oncekiOdenen),
                              });
                            }}
                            disabled={vergiDuzeltmeMut.isPending}
                            className="px-3 py-1 rounded text-[11px] font-semibold transition-all"
                            style={{ background: GOLD, color: '#0a0906' }}
                          >
                            {vergiDuzeltmeMut.isPending ? '…' : 'Kaydet'}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STOK VE SATILAN MALIN MALİYETİ — 4 çeyrek yan yana, Q4→Q1 (gelir tablosunun devamı) */}
      {quarterDetails.some((qd) => qd?.data?.stokMaliyetOzet) && (() => {
        const firstWithStok = quarterDetails.find((qd) => qd?.data?.stokMaliyetOzet)?.data as any;
        const stokKodList = firstWithStok?.stokMaliyetOzet?.stokHesaplari || [];
        const maliyetKodList = firstWithStok?.stokMaliyetOzet?.maliyetHesaplari || [];
        const allKodlar = [...stokKodList, ...maliyetKodList];
        const getBakiye = (qi: number, kod: string): number | null => {
          const d = quarterDetails[qi]?.data as any;
          if (!d?.stokMaliyetOzet) return null;
          const arr = [...(d.stokMaliyetOzet.stokHesaplari || []), ...(d.stokMaliyetOzet.maliyetHesaplari || [])];
          return Number(arr.find((x: any) => x.kod === kod)?.bakiye || 0);
        };
        return (
          <div>
            <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
              <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
              Stok ve Satılan Malın Maliyeti
              <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.28)', color: GOLD }}>
                {year} · 4 Çeyrek
              </span>
            </h3>
            <div className="rounded-xl overflow-hidden" style={{ background: TABLE_BG, border: `1px solid ${GRID_LINE_STRONG}` }}>
              <table className="w-full text-left text-[13px]" style={{ fontVariantNumeric: 'tabular-nums', borderCollapse: 'collapse', borderSpacing: 0, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: CODE_COL_WIDTH }} />
                  <col style={{ width: ACCOUNT_COL_WIDTH }} />
                  <col style={{ width: PERIOD_COL_WIDTH }} />
                  <col style={{ width: PERIOD_COL_WIDTH }} />
                  <col style={{ width: PERIOD_COL_WIDTH }} />
                  <col style={{ width: PERIOD_COL_WIDTH }} />
                </colgroup>
                <thead>
                  {/* Üst başlık — gelir tablosundaki gibi */}
                  <tr style={{ borderBottom: `1px solid ${GRID_LINE}` }}>
                    <th colSpan={2} style={{ padding: '10px 14px', background: 'rgba(184,160,111,0.08)' }}></th>
                    {DISPLAY_ORDER.map((qi) => (
                      <th
                        key={qi}
                        className="text-center"
                        style={{
                          color: GOLD,
                          fontSize: 13,
                          padding: '10px 14px',
                          background: 'rgba(184,160,111,0.08)',
                          borderLeft: `1px solid ${GRID_LINE}`,
                          fontFamily: REPORT_FONT,
                          fontWeight: 600,
                        }}
                      >
                        {renderQuarterHeader(qi)}
                      </th>
                    ))}
                  </tr>
                  <tr style={{ borderBottom: `1px solid ${GRID_LINE_STRONG}` }}>
                    <th className="px-3 py-2 text-left text-[12px] font-bold uppercase tracking-[.06em]" style={{ color: '#f5efe3', background: 'rgba(184,160,111,0.16)', borderRight: `1px solid ${GRID_LINE}` }}>Kod</th>
                    <th className="px-3 py-2 text-left text-[12px] font-bold uppercase tracking-[.06em]" style={{ color: '#f5efe3', background: 'rgba(184,160,111,0.16)', borderRight: `1px solid ${GRID_LINE}` }}>Hesap Adı</th>
                    {DISPLAY_ORDER.map((qi) => (
                      <th key={qi} className="px-3 py-2 text-center text-[12px] font-bold uppercase tracking-[.06em]" style={{ color: '#f5efe3', background: 'rgba(184,160,111,0.16)', borderLeft: `1px solid ${GRID_LINE}` }}>
                        Tutar
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allKodlar.map((baseH: any, hi: number) => (
                    <tr key={baseH.kod} style={{ borderTop: `1px solid ${GRID_LINE}`, background: ACCOUNT_ROW_BG }}>
                      <td className="px-3 py-2 font-mono text-[13px]" style={{ color: '#d8c17f', textAlign: 'left', fontWeight: 600, borderRight: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${GRID_LINE}` }}>{baseH.kod}</td>
                      <td className="px-3 py-2 text-[13px]" style={{ color: 'rgba(250,250,249,0.78)', borderRight: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${GRID_LINE}` }}>{baseH.hesapAdi || HESAP_ADLARI[baseH.kod] || '—'}</td>
                      {DISPLAY_ORDER.map((qi) => {
                        const v = getBakiye(qi, baseH.kod);
                        return (
                          <td key={qi} className="px-3 py-2 text-center font-mono" style={{ color: v === null ? MISSING_AMOUNT_COLOR : v === 0 ? MUTED_AMOUNT_COLOR : AMOUNT_COLOR, fontWeight: v === 0 ? 500 : FINANCIAL_AMOUNT_WEIGHT, fontSize: FINANCIAL_AMOUNT_SIZE, fontFamily: FINANCIAL_FONT, borderLeft: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${GRID_LINE}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', letterSpacing: 0 }}>
                            {v === null ? '—' : v !== 0 ? fmtTRY(v) : '0,00'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Toplam Stok */}
                  <tr style={{ borderTop: `2px solid ${GRID_LINE_STRONG}`, background: 'rgba(184,160,111,0.08)' }}>
                    <td></td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: GOLD, borderBottom: `1px solid ${GRID_LINE}` }}>Toplam Stok</td>
                    {DISPLAY_ORDER.map((qi) => {
                      const d = quarterDetails[qi]?.data as any;
                      const v = d?.stokMaliyetOzet?.toplamStok;
                      return (
                        <td key={qi} className="px-3 py-2.5 text-center font-mono" style={{ color: TOTAL_COLOR, fontWeight: FINANCIAL_AMOUNT_STRONG_WEIGHT, fontSize: FINANCIAL_AMOUNT_SIZE, fontFamily: FINANCIAL_FONT, borderLeft: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${GRID_LINE}`, fontVariantNumeric: 'tabular-nums', letterSpacing: 0 }}>
                          {d?.stokMaliyetOzet ? fmtTRY(Number(v)) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Satılan Malın Maliyeti — v1.36.55: SADECE Manuel girilen değer (toplam SMM değil).
                      User'ın talep ettiği: yukarıdaki "Manuel: 2. Satılan Ticari Mallar Maliyeti" alanına yazdığı değer
                      buraya birebir gelir; D. SATIŞLARIN MALİYETİ toplamına 740 vs eklenmiş halde gelmez. */}
                  <tr style={{ borderTop: '1px solid rgba(244,63,94,0.26)', background: 'rgba(244,63,94,0.055)' }}>
                    <td></td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: LOSS_COLOR, borderBottom: `1px solid ${GRID_LINE}` }}>Satılan Malın Maliyeti</td>
                    {DISPLAY_ORDER.map((qi) => {
                      const d = quarterDetails[qi]?.data as any;
                      const slot = quarterSlots[qi];
                      // SADECE manuel input (taslak veya kayıtlı). Toplam SMM (846k) DEĞİL.
                      const draftManuel = slot ? duzeltmelerDraft[slot.id]?.satisMaliyetiManuel : undefined;
                      const savedManuel = slot ? slot.duzeltmeler?.satisMaliyetiManuel : undefined;
                      const v = typeof draftManuel === 'number' ? draftManuel : (typeof savedManuel === 'number' ? savedManuel : 0);
                      const toplamStok = Number(d?.stokMaliyetOzet?.toplamStok ?? 0);
                      const ihlal = d?.stokMaliyetOzet && v > toplamStok && toplamStok > 0;
                      return (
                        <td
                          key={qi}
                          className="px-3 py-2.5 text-center font-mono"
                          style={{
                            color: LOSS_COLOR,
                            fontWeight: FINANCIAL_AMOUNT_STRONG_WEIGHT,
                            fontSize: FINANCIAL_AMOUNT_SIZE,
                            fontFamily: FINANCIAL_FONT,
                            borderLeft: `1px solid ${GRID_LINE}`,
                            borderBottom: `1px solid ${GRID_LINE}`,
                            background: ihlal ? 'rgba(239,68,68,0.18)' : undefined,
                            position: 'relative',
                            fontVariantNumeric: 'tabular-nums',
                            letterSpacing: 0,
                          }}
                          title={ihlal ? `⚠ Satılan maliyet (${fmtTRY(v)}) toplam stoktan (${fmtTRY(toplamStok)}) büyük olamaz` : undefined}
                        >
                          {d?.stokMaliyetOzet ? '−' + fmtTRY(v) : '—'}
                          {ihlal && (
                            <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 11 }}>⚠</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Kalan Stok — manuel düzeltmeyle re-compute + negatif olunca kırmızı */}
                  <tr style={{ borderTop: `2px solid ${GRID_LINE_STRONG}`, background: 'rgba(184,160,111,0.08)' }}>
                    <td></td>
                    <td className="px-3 py-2.5 font-bold text-[13.5px]" style={{ color: TOTAL_COLOR, borderBottom: `1px solid ${GRID_LINE}` }}>Kalan Stok</td>
                    {DISPLAY_ORDER.map((qi) => {
                      const d = quarterDetails[qi]?.data as any;
                      // v1.36.55: Kalan Stok = Toplam Stok − Manuel SMM (toplam SMM değil)
                      const slot = quarterSlots[qi];
                      const draftManuel = slot ? duzeltmelerDraft[slot.id]?.satisMaliyetiManuel : undefined;
                      const savedManuel = slot ? slot.duzeltmeler?.satisMaliyetiManuel : undefined;
                      const sm = typeof draftManuel === 'number' ? draftManuel : (typeof savedManuel === 'number' ? savedManuel : 0);
                      const ts = Number(d?.stokMaliyetOzet?.toplamStok ?? 0);
                      const v = d?.stokMaliyetOzet ? ts - sm : 0;
                      const negatif = d?.stokMaliyetOzet && v < 0;
                      return (
                        <td
                          key={qi}
                          className="px-3 py-2.5 text-center font-mono"
                          style={{
                            color: negatif ? LOSS_COLOR : TOTAL_COLOR,
                            fontWeight: FINANCIAL_AMOUNT_STRONG_WEIGHT,
                            fontSize: FINANCIAL_AMOUNT_SIZE,
                            fontFamily: FINANCIAL_FONT,
                            borderLeft: `1px solid ${GRID_LINE}`,
                            borderBottom: `1px solid ${GRID_LINE}`,
                            background: negatif ? 'rgba(239,68,68,0.18)' : undefined,
                            position: 'relative',
                            fontVariantNumeric: 'tabular-nums',
                            letterSpacing: 0,
                          }}
                          title={negatif ? `⚠ Kalan stok negatif (${fmtTRY(v)}) — satılan maliyet toplam stoktan büyük` : undefined}
                        >
                          {d?.stokMaliyetOzet ? fmtTRY(v) : '—'}
                          {negatif && (
                            <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 11 }}>⚠</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Uyarı satırı — herhangi bir çeyrekte ihlal varsa (manuel düzeltme dahil) */}
                  {DISPLAY_ORDER.some((qi) => {
                    const d = quarterDetails[qi]?.data as any;
                    const slot = quarterSlots[qi];
                    // v1.36.55: tutarsızlık kontrolü manuel SMM'ye göre
                    const draftManuel = slot ? duzeltmelerDraft[slot.id]?.satisMaliyetiManuel : undefined;
                    const savedManuel = slot ? slot.duzeltmeler?.satisMaliyetiManuel : undefined;
                    const sm = typeof draftManuel === 'number' ? draftManuel : (typeof savedManuel === 'number' ? savedManuel : 0);
                    const ts = Number(d?.stokMaliyetOzet?.toplamStok ?? 0);
                    return d?.stokMaliyetOzet && ((sm > ts && ts > 0) || (ts - sm) < 0);
                  }) && (
                    <tr style={{ borderTop: '1px dashed rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)' }}>
                      <td colSpan={6} className="px-4 py-2.5 text-[12px]" style={{ color: '#ef4444' }}>
                        ⚠ <strong>Tutarsızlık:</strong> Satılan Malın Maliyeti, Toplam Stok'tan büyük olamaz; Kalan Stok negatif olamaz. Yukarıda kırmızı işaretli hücreler hatalı. Mizan kayıtlarını kontrol edin.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Finansal Oranlar — son dolu çeyreğe göre */}
      {latestQuarter && (
        <div>
          <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
            <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
            Finansal Oranlar
            <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.28)', color: GOLD }}>
              {formatDonemLabel(latestQuarter.donem, latestQuarter.donemTipi)}
            </span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <RatioCard label="Brüt Kar Marjı" value={pct(Number(latestDerived?.brutSatisKari), Number(latestDerived?.netSatislar) || 1)} formula="Brüt Satış Karı / Net Satışlar" tone="good" />
            <RatioCard label="Faaliyet Kar Marjı" value={pct(Number(latestDerived?.faaliyetKari), Number(latestDerived?.netSatislar) || 1)} formula="Faaliyet Karı / Net Satışlar" tone="good" />
            <RatioCard label="Faaliyet Gider Oranı" value={pct(Number(latestDerived?.faaliyetGiderleri), Number(latestDerived?.netSatislar) || 1)} formula="Faaliyet Giderleri / Net Satışlar" tone="neutral" />
            <RatioCard label="Finansman Gider Oranı" value={pct(Number(latestDerived?.finansmanGiderleri), Number(latestDerived?.netSatislar) || 1)} formula="Finansman Giderleri / Net Satışlar" tone="warn" />
            <RatioCard label="Olağan Kar Marjı" value={pct(Number(latestDerived?.olaganKar), Number(latestDerived?.netSatislar) || 1)} formula="Olağan Kar / Net Satışlar" tone="good" />
            <RatioCard label="Net Kar Marjı" value={pct(Number(latestDerived?.donemNetKari), Number(latestDerived?.netSatislar) || 1)} formula="Dönem Net Karı / Net Satışlar" tone="good" />
            <RatioCard label="Maliyet / Ciro" value={pct(Number(latestDerived?.satisMaliyeti), Number(latestDerived?.netSatislar) || 1)} formula="Satışların Maliyeti / Net Satışlar" tone="neutral" />
            <RatioCard label="Efektif Vergi Oranı" value={pct(Number(latestDerived?.vergiKarsiligi), Number(latestDerived?.donemKari) || 1)} formula="Vergi Karşılığı / Dönem Karı" tone="neutral" />
            {prevQuarter && (
              <RatioCard
                label="Satış Büyümesi (Önceki Çeyrek)"
                value={pct(Number(latestQuarter.netSatislar) - Number(prevQuarter.netSatislar), Number(prevQuarter.netSatislar) || 1)}
                formula="Δ Net Satışlar / önceki çeyrek"
                tone={Number(latestQuarter.netSatislar) > Number(prevQuarter.netSatislar) ? 'good' : 'bad'}
              />
            )}
          </div>
        </div>
      )}

      {/* Geçmiş Gelir Tabloları */}
      <div>
        <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          Kayıtlı Gelir Tabloları
          <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.28)', color: GOLD }}>
            {gtList.length}
          </span>
        </h3>
        {gtList.length === 0 ? (
          <div className="rounded-xl py-10 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <FileSpreadsheet size={24} style={{ color: 'rgba(250,250,249,0.3)', margin: '0 auto 8px' }} />
            <p className="text-[13px]" style={{ color: 'rgba(250,250,249,0.5)' }}>Henüz kayıtlı gelir tablosu yok</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Oluşturma</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Mükellef</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Dönem</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Tür</th>
                  <th className="px-4 py-3 text-right text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Net Kar</th>
                  <th className="px-4 py-3 text-right text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {gtList.map((g: any, idx: number) => (
                  <tr key={g.id} style={{ borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.18)' }}>
                    <td className="px-4 py-3 font-mono text-[12px]" style={{ color: 'rgba(250,250,249,0.7)' }}>{new Date(g.createdAt).toLocaleDateString('tr-TR')}</td>
                    <td className="px-4 py-3 font-medium">
                      {g.locked && <Lock size={11} style={{ color: '#22c55e', display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />}
                      {g.taxpayer ? taxpayerName(g.taxpayer) : '—'}
                    </td>
                    <td className="px-4 py-3">{formatDonemLabel(g.donem, g.donemTipi)}</td>
                    <td className="px-4 py-3 text-[11.5px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
                      {formatDonemTipiLabel(g.donemTipi, g.donem)}
                      {g.locked && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>KESİN</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono" style={{ color: GOLD, fontWeight: 600 }}>{fmtTRY(g.donemNetKari)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          onClick={() => handleClientOutput(g)}
                          disabled={clientOutputLoadingId === g.id}
                          className="p-1.5 rounded-md disabled:opacity-50"
                          style={{ color: AMOUNT_COLOR, background: 'rgba(212,184,118,0.10)' }}
                          title="Mükellef Çıktısı"
                        >
                          {clientOutputLoadingId === g.id ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                        </button>
                        <button onClick={() => exportMut.mutate(g.id)} disabled={exportMut.isPending} className="p-1.5 rounded-md" style={{ color: GOLD, background: 'rgba(184,160,111,0.08)' }} title="Excel İndir">
                          <Download size={14} />
                        </button>
                        <button
                          onClick={() => { if (g.locked) return toast.error('Kesin kayıtlı silinemez'); if (confirm('Silinsin mi?')) deleteMut.mutate(g.id); }}
                          disabled={g.locked}
                          className="p-1.5 rounded-md disabled:opacity-30"
                          style={{ color: '#f43f5e', background: 'rgba(244,63,94,0.08)' }}
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
      </div>

      {/* Mükellef Picker */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)' }} onClick={() => setPickerOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl border flex flex-col overflow-hidden" style={{ background: 'rgba(17,14,12,0.98)', borderColor: 'rgba(255,255,255,0.05)', maxHeight: '84vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <h3 className="text-lg font-bold" style={{ color: '#fafaf9' }}>Mükellef Seç</h3>
              <button onClick={() => setPickerOpen(false)}><X size={16} /></button>
            </div>
            <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)' }}>
                <Search size={14} /><input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Ara…" autoFocus className="flex-1 bg-transparent outline-none text-sm" style={{ color: '#fafaf9' }} />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filteredTp.map((t) => (
                <button key={t.id} onClick={() => { setTaxpayerId(t.id); setPickerOpen(false); setPickerSearch(''); }} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg text-left" style={{ color: '#fafaf9', background: taxpayerId === t.id ? 'rgba(184,160,111,.08)' : 'transparent' }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: 'rgba(255,255,255,0.05)' }}>{taxpayerName(t).charAt(0)}</div>
                  <span className="flex-1 truncate font-medium">{taxpayerName(t)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Backend'in `detay` JSON'undan bir alt hesap kodunun tutarını çıkarır.
 * detay yapısı: { brutSatis: { detay: [{kod, tutar, hesapAdi}] }, satisMal: {...}, ... }
 */
/**
 * v1.36.51: Focus-stable manuel sayı input.
 * Önceki versiyon her keystroke'ta value'yu Türkçe formatlıyordu (1.000,00) →
 * cursor pozisyonu kayıyordu, kullanıcı tekrar tıklamak zorunda kalıyordu.
 * Bu versiyon: kullanıcı yazarken raw text saklar, blur'da formatlar.
 */
function ManuelInput({
  gtId, field, draftVal, savedVal, isLocked, isEditing, onChange,
}: {
  gtId: string;
  field: string;
  draftVal: number | undefined;
  savedVal: number | undefined;
  isLocked: boolean;
  isEditing: boolean;
  onChange: (n: number) => void;
}) {
  const numericVal = draftVal !== undefined ? draftVal : (savedVal ?? 0);
  const formattedVal = numericVal === 0 ? '' : numericVal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const [focused, setFocused] = useState(false);
  const [rawText, setRawText] = useState(formattedVal);

  // Eğer biz odaklı değilsek (kaydetme veya başka bir kaynaktan değer geldiyse) sync et
  useEffect(() => {
    if (!focused) setRawText(formattedVal);
  }, [formattedVal, focused]);

  const parse = (s: string): number => {
    // Önce binlik nokta sil, virgülü noktaya çevir, parse
    const cleaned = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  };
  const disabled = isLocked || !isEditing;
  const readOnlySaved = disabled && numericVal > 0 && !isEditing;

  if (readOnlySaved) {
    return <AmountText value={numericVal} className="px-2 py-1" />;
  }

  return (
    <input
      type="text"
      value={focused ? rawText : formattedVal}
      onFocus={(e) => {
        setFocused(true);
        // Focus aldığında format'lı görünümü ham text'e çevir (kullanıcı kolayca silsin)
        setRawText(numericVal === 0 ? '' : String(numericVal).replace('.', ','));
        // Tüm metni seç → "Üzerine yaz" deneyimi
        setTimeout(() => e.target.select?.(), 0);
      }}
      onBlur={() => {
        setFocused(false);
        const n = parse(rawText);
        if (n !== numericVal) onChange(n);
      }}
      onChange={(e) => {
        if (disabled) return;
        setRawText(e.target.value);
        // Hemen parent state'i de güncelle (Kaydet düğmesi taslak kontrolü görsün)
        onChange(parse(e.target.value));
      }}
      disabled={disabled}
      placeholder={isLocked ? 'Kilitli' : isEditing ? '0,00' : 'Düzelt'}
      className="w-full px-2 py-1 rounded font-mono text-center outline-none border"
      style={{
        background: readOnlySaved ? 'transparent' : disabled ? 'rgba(255,255,255,0.012)' : 'rgba(96,165,250,0.08)',
        borderColor: readOnlySaved ? 'transparent' : disabled ? 'rgba(255,255,255,0.06)' : 'rgba(96,165,250,0.25)',
        color: readOnlySaved ? AMOUNT_COLOR : disabled ? MUTED_AMOUNT_COLOR : '#60a5fa',
        fontSize: readOnlySaved ? FINANCIAL_AMOUNT_SIZE : 13.5,
        fontWeight: readOnlySaved ? FINANCIAL_AMOUNT_WEIGHT : FINANCIAL_AMOUNT_STRONG_WEIGHT,
        fontFamily: FINANCIAL_FONT,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: 0,
        opacity: 1,
        cursor: readOnlySaved ? 'default' : disabled ? 'not-allowed' : 'text',
      }}
    />
  );
}

function AmountText({
  value,
  className = '',
  color,
  emphasis = false,
  final = false,
}: {
  value: number | null;
  className?: string;
  color?: string;
  emphasis?: boolean;
  final?: boolean;
}) {
  const missing = value === null;
  const zero = !missing && value === 0;
  const isStrong = final || emphasis;
  return (
    <span
      className={className}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'center',
        color: missing ? MISSING_AMOUNT_COLOR : zero ? MUTED_AMOUNT_COLOR : (color || AMOUNT_COLOR),
        fontFamily: FINANCIAL_FONT,
        fontSize: final ? 15 : FINANCIAL_AMOUNT_SIZE,
        fontWeight: zero ? 500 : isStrong ? FINANCIAL_AMOUNT_STRONG_WEIGHT : FINANCIAL_AMOUNT_WEIGHT,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: 0,
      }}
    >
      {missing ? '—' : fmtTRY(value ?? 0)}
    </span>
  );
}

function escapeReportHtml(v: string | number | null | undefined): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildClientReportHtml({
  taxpayerName,
  taxNumber,
  period,
  logoUrl,
  rows,
  ratios,
  highlights,
  assessment,
  generatedAt,
}: {
  taxpayerName: string;
  taxNumber?: string;
  period: string;
  logoUrl?: string;
  rows: ClientReportRow[];
  ratios: ClientReportRatio[];
  highlights: ClientReportHighlight[];
  assessment: string[];
  generatedAt: string;
}) {
  const toneStyles: Record<ClientReportRatio['tone'], string> = {
    good: 'color:#087f5b;border-color:#a7f3d0;background:#ecfdf5;',
    neutral: 'color:#525252;border-color:#e5e5e5;background:#fafafa;',
    warn: 'color:#9a5b00;border-color:#fde68a;background:#fffbeb;',
    bad: 'color:#b91c1c;border-color:#fecaca;background:#fef2f2;',
  };
  const rowClass = (type: ClientReportRow['type']) =>
    type === 'final' ? 'report-final' : type === 'total' ? 'report-total' : type === 'manual' ? 'report-manual' : '';
  const escapedLogoUrl = logoUrl ? escapeReportHtml(logoUrl) : '';
  const ratioColumns = Math.min(Math.max(ratios.length, 1), 4);
  const subjectGap = rows.length >= 19 ? '26px' : rows.length >= 17 ? '34px' : '44px';
  const signoffGap = rows.length >= 19 ? '8mm' : rows.length >= 17 ? '14mm' : '20mm';
  const highlightClass = (tone: ClientReportHighlight['tone']) =>
    tone === 'good' ? 'highlight-good' : tone === 'bad' ? 'highlight-bad' : tone === 'warn' ? 'highlight-warn' : 'highlight-neutral';

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title></title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1c1917; background: #f2eee5; font-family: Inter, Arial, sans-serif; font-size: 10.5px; }
    .page { width: 210mm; min-height:277mm; margin: 32px auto; background:#fff; padding: 18mm 13mm 12mm; border:1px solid #e8dcc1; box-shadow:0 18px 48px rgba(45,35,18,.16); position:relative; overflow:hidden; display:flex; flex-direction:column; }
    .page:before { content:""; position:absolute; inset:0 0 auto 0; height:8px; background:linear-gradient(90deg,#1f1a12,#d4b876,#1f1a12); }
    .letterhead { display:flex; align-items:center; justify-content:space-between; gap:18px; border-bottom:2px solid #d4b876; padding:0 0 12px; }
    .office-logo { width:128px; height:auto; display:block; }
    .logo-fallback { color:#8a6f35; font-weight:900; font-size:18px; letter-spacing:.08em; }
    .report-label { text-align:right; color:#8a6f35; font-weight:900; letter-spacing:.12em; text-transform:uppercase; font-size:10px; padding-top:4px; }
    .report-sub { margin-top:5px; color:#6b6258; font-size:9px; font-weight:700; letter-spacing:.04em; }
    .subject { display:flex; align-items:flex-end; justify-content:space-between; gap:18px; margin:20px 0 12px; }
    h1 { margin:0; font-size:25px; line-height:1.08; letter-spacing:0; color:#17130d; }
    .meta { color:#6b6258; font-weight:700; line-height:1.5; }
    .highlights { list-style:none; margin:12px 0; padding:10px 12px; display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px 18px; border:1px solid #d7bd75; border-radius:10px; background:#fff9ea; }
    .highlights li { position:relative; padding-left:14px; color:#2a2114; font-size:12px; line-height:1.2; }
    .highlights li:before { content:""; position:absolute; left:0; top:.42em; width:6px; height:6px; border-radius:999px; background:#b88a2f; }
    .highlights strong { font-weight:900; color:#5f4721; }
    .highlights b { font-size:16px; line-height:1; font-weight:900; font-variant-numeric:tabular-nums; color:#1f1a12; margin-left:4px; }
    .highlights .highlight-good b { color:#087f5b; }
    .highlights .highlight-bad b { color:#b91c1c; }
    .highlights .highlight-warn b { color:#9a5b00; }
    .ratios { display:grid; grid-template-columns:repeat(${ratioColumns}, 1fr); gap:8px; margin:12px 0 13px; }
    .ratio { border:1px solid #e5e5e5; border-radius:9px; padding:9px 10px; min-height:52px; box-shadow:inset 0 1px 0 rgba(255,255,255,.8); }
    .ratio span { display:block; color:#78716c; font-size:8.5px; text-transform:uppercase; letter-spacing:.08em; font-weight:900; margin-bottom:5px; }
    .ratio strong { font-size:18px; line-height:1; letter-spacing:0; font-variant-numeric:tabular-nums; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; margin-top:8px; border:1px solid #d7c8a8; border-radius:9px; overflow:hidden; }
    th { background:#251f14; color:#fff8e6; font-size:9px; text-transform:uppercase; letter-spacing:.08em; padding:8px 9px; text-align:right; border-bottom:1px solid #b99b58; }
    th:first-child { text-align:left; width:11%; }
    th:nth-child(2) { text-align:left; width:53%; }
    th + th { border-left:1px solid rgba(255,248,230,.24); }
    th:nth-child(3), td:nth-child(3) { border-left:1.5px solid #c9b06f; }
    th:nth-child(4), td:nth-child(4) { border-left:1.5px solid #c9b06f; }
    td { border-bottom:1px solid #d9cfbd; padding:6px 9px; text-align:right; font-size:10.8px; font-weight:760; font-variant-numeric:tabular-nums; }
    td + td { border-left:1px solid #e0d6c2; }
    td:first-child, td:nth-child(2) { text-align:left; }
    td:first-child { color:#8a6f35; font-weight:800; }
    td:nth-child(2) { color:#3f3a33; font-weight:700; }
    tbody tr:nth-child(even) td { background:#fcfaf5; }
    tr.report-total td, tr.report-final td { background:#fff5dd !important; font-weight:900; }
    tr.report-final td { color:#087f5b; border-bottom-color:#b7e4c7; }
    tr.report-manual td:first-child { color:#8a6f35; }
    .assessment { margin-top:12px; border:1px solid #d7bd75; border-radius:10px; padding:10px 12px; background:#fffaf0; }
    .assessment h2 { margin:0 0 8px; font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:#7b5d24; }
    .assessment ul { margin:0; padding:0; list-style:none; display:grid; grid-template-columns:1fr 1fr; gap:7px 10px; }
    .assessment li { line-height:1.32; color:#3f3a33; font-weight:650; padding:8px 9px; border:1px solid #eadbb8; border-radius:8px; background:#fffdf7; }
    .assessment li:last-child:nth-child(odd) { grid-column:1 / -1; }
    .assessment li strong { display:block; margin-bottom:2px; color:#17130d; font-size:9.5px; text-transform:uppercase; letter-spacing:.07em; }
    .assessment li span { display:block; }
    .signoff { display:flex; justify-content:flex-end; margin-top:16px; padding-top:6px; break-inside:avoid; }
    .signoff-inner { min-width:270px; text-align:center; padding-top:8px; border-top:1px solid #d7bd75; }
    .signoff-name { font-family:"Segoe Script","Brush Script MT","Lucida Handwriting",cursive; font-size:26px; line-height:1; font-weight:650; color:#202020; transform:rotate(-1deg); }
    .signoff-title { margin-top:4px; font-family:Georgia,"Times New Roman",serif; font-size:12px; line-height:1.1; font-style:italic; color:#7b5d24; letter-spacing:.01em; }
    @media print {
      html, body { width:210mm; height:297mm; overflow:hidden; }
      body { background:#fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { width:210mm; height:297mm; min-height:0; margin:0; padding:9mm 9mm 7mm; border:0; box-shadow:none; display:block; overflow:hidden; page-break-before:avoid; page-break-after:avoid; break-before:avoid; break-after:avoid; }
      .page:before { display:none; }
      .letterhead { padding-bottom:12px; }
      .office-logo { width:116px; }
      .report-label { font-size:9.5px; }
      .report-sub { font-size:8.5px; }
      .subject { margin:${subjectGap} 0 10px; }
      h1 { font-size:24px; }
      .meta { font-size:9.5px; }
      .highlights { margin:9px 0; padding:8px 10px; }
      .highlights li { font-size:11.4px; }
      .highlights b { font-size:15px; }
      .ratios { margin:9px 0 10px; gap:7px; }
      .ratio { min-height:44px; padding:7.5px 9px; }
      .ratio strong { font-size:16px; }
      table { margin-top:7px; }
      th { padding:6px 7px; font-size:8.5px; }
      td { padding:4.2px 7px; font-size:9.7px; line-height:1.18; }
      .assessment { margin-top:10px; padding:8px 9px; border-radius:8px; }
      .assessment h2 { margin-bottom:6px; font-size:9.2px; }
      .assessment ul { gap:7px 8px; }
      .assessment li { padding:6px 8px; line-height:1.22; font-size:9.5px; }
      .assessment li strong { font-size:8.7px; }
      .signoff { position:static; margin-top:${signoffGap}; padding-top:0; display:flex; justify-content:flex-end; }
      .signoff-inner { min-width:66mm; padding-top:5px; }
      .signoff-name { font-size:23px; }
      .signoff-title { margin-top:2px; font-size:10.5px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="letterhead">
      <div>
        ${escapedLogoUrl ? `<img class="office-logo" src="${escapedLogoUrl}" alt="Moren Mali Müşavirlik" onerror="this.style.display='none';this.nextElementSibling.style.display='block';" />` : ''}
        <span class="logo-fallback" style="${escapedLogoUrl ? 'display:none' : 'display:block'}">MOREN MALİ MÜŞAVİRLİK</span>
      </div>
      <div>
        <div class="report-label">Gelir Tablosu Özeti</div>
        <div class="report-sub">${escapeReportHtml(generatedAt)}</div>
      </div>
    </section>
    <section class="subject">
      <div>
        <h1>${escapeReportHtml(taxpayerName)}</h1>
        <div class="meta">${taxNumber ? `Vergi No: ${escapeReportHtml(taxNumber)} · ` : ''}${escapeReportHtml(period)} Gelir Tablosu</div>
      </div>
    </section>
    <ul class="highlights">
      ${highlights.map((h) => `<li class="${highlightClass(h.tone)}"><strong>${escapeReportHtml(h.label)}:</strong><b>${escapeReportHtml(h.value)}</b></li>`).join('')}
    </ul>
    <section class="ratios">
      ${ratios.map((r) => `<div class="ratio" style="${toneStyles[r.tone]}"><span>${escapeReportHtml(r.label)}</span><strong>${escapeReportHtml(r.value)}</strong></div>`).join('')}
    </section>
    <table>
      <thead><tr><th>Kod</th><th>Kalem</th><th>Tutar</th><th>Oran</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr class="${rowClass(r.type)}"><td>${escapeReportHtml(r.code)}</td><td>${escapeReportHtml(r.label)}</td><td>${escapeReportHtml(fmtTRY(r.value))}</td><td>${escapeReportHtml(r.percent || '')}</td></tr>`).join('')}
      </tbody>
    </table>
    <section class="assessment">
      <h2>Değerlendirme, Öngörü ve Dikkat Noktaları</h2>
      <ul>${assessment.map((line) => {
        const idx = line.indexOf(':');
        if (idx <= 0) return `<li><span>${escapeReportHtml(line)}</span></li>`;
        return `<li><strong>${escapeReportHtml(line.slice(0, idx))}</strong><span>${escapeReportHtml(line.slice(idx + 1).trim())}</span></li>`;
      }).join('')}</ul>
    </section>
    <section class="signoff" aria-label="Meslek mensubu">
      <div class="signoff-inner">
        <div class="signoff-name">Muzaffer Ören</div>
        <div class="signoff-title">Serbest Muhasebeci Mali Müşavir</div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function getSubAccountAmount(gt: any, kod: string): number {
  const d = gt?.detay;
  if (!d) return 0;
  // Tüm detay gruplarında ara
  for (const grupKey of Object.keys(d)) {
    const grup = d[grupKey];
    if (!grup?.detay || !Array.isArray(grup.detay)) continue;
    for (const item of grup.detay) {
      if (String(item.kod).startsWith(kod)) return Number(item.tutar) || 0;
    }
  }
  return 0;
}

function RatioCard({ label, value, formula, tone }: { label: string; value: string; formula: string; tone: 'good' | 'neutral' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? '#22c55e' : tone === 'warn' ? '#f59e0b' : tone === 'bad' ? '#f43f5e' : GOLD;
  return (
    <div className="rounded-xl border p-4" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)', minWidth: 0 }}>
      <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>{label}</div>
      <div
        className="font-mono text-[24px] font-bold"
        style={{ color, letterSpacing: 0, lineHeight: 1.15, whiteSpace: 'nowrap', overflowWrap: 'normal' }}
      >
        {value}
      </div>
      <div className="text-[10.5px] font-mono mt-1.5 leading-snug" style={{ color: 'rgba(250,250,249,0.48)' }}>{formula}</div>
    </div>
  );
}
