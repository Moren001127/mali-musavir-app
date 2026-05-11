'use client';
import React, { useState, useMemo, useEffect } from 'react';
// useMemo zaten import edildi
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { mizanApi, gelirTablosuApi, fmtTRY } from '@/lib/mizan';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  Download, Search, X, ChevronDown, Users, Calendar, Sparkles, Loader2,
  Trash2, Eye, TrendingUp, TrendingDown, Zap, FileSpreadsheet, Lock, Unlock,
} from 'lucide-react';

const GOLD = '#e6c979';
const TABLE_BG = '#0a0907';
const GRID_LINE = 'rgba(245,240,230,0.24)';
const GRID_LINE_STRONG = 'rgba(212,184,118,0.50)';
const CELL_LINE = 'rgba(245,240,230,0.16)';
const CELL_LINE_STRONG = 'rgba(212,184,118,0.42)';
const AMOUNT_COLOR = '#fffaf0';
const TOTAL_COLOR = '#fff0b8';
const MUTED_AMOUNT_COLOR = 'rgba(250,250,249,0.58)';
const MISSING_AMOUNT_COLOR = 'rgba(250,250,249,0.28)';
const PROFIT_COLOR = '#86efac';
const LOSS_COLOR = '#fca5a5';
const RATIO_COLOR = '#ffffff';
const RATIO_BG = 'rgba(13,148,136,0.58)';
const RATIO_BORDER = 'rgba(153,246,228,0.80)';

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
  { manual: 'satisMaliyetiManuel', label: '2. Satılan Ticari Mallar Maliyeti (-)' },
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
        <div className="font-normal mt-0.5" style={{ fontSize: 11, color: 'rgba(250,250,249,0.55)', fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: 0 }}>
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

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
            <Sparkles size={10} className="inline mr-1" /> Mali Rapor
          </span>
        </div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
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
                  {m.donem} · {m.donemTipi}
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
        </h3>
        <div className="rounded-xl overflow-hidden overflow-x-auto" style={{
          background: TABLE_BG,
          border: `1px solid ${GRID_LINE_STRONG}`,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05), 0 16px 34px rgba(0,0,0,0.24)',
        }}>
          <table className="w-full text-left" style={{ fontVariantNumeric: 'tabular-nums', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 70 }} />
              <col />
              <col style={{ width: 180 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 180 }} />
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
                      fontFamily: 'Fraunces, serif',
                      fontSize: 14,
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {taxpayerName(selectedTp)}
                    {selectedTp.taxNumber && (
                      <span className="ml-2 font-mono text-[12px]" style={{ color: 'rgba(250,250,249,0.5)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 400 }}>
                        · VKN/TCKN: {selectedTp.taxNumber}
                      </span>
                    )}
                  </th>
                </tr>
              )}
              <tr>
                <th style={{ padding: '12px 14px', background: 'rgba(184,160,111,0.08)', width: 80, borderBottom: `1px solid ${GRID_LINE}` }}></th>
                <th style={{ padding: '12px 14px', background: 'rgba(184,160,111,0.08)', width: 280, borderBottom: `1px solid ${GRID_LINE}` }}></th>
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
                        fontFamily: 'Fraunces, serif',
                        fontWeight: 600,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      <div style={{ fontSize: 15 }}>{year} · {t.no}</div>
                      <div className="font-normal mt-0.5" style={{ fontSize: 11.5, color: gt ? 'rgba(250,250,249,0.6)' : 'rgba(250,250,249,0.3)', fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: 0 }}>
                        {t.range}
                      </div>
                      {locked && (
                        <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                          <Lock size={9} /> KESİN
                        </span>
                      )}
                      {!gt && <div className="text-[10px] font-normal mt-0.5" style={{ color: 'rgba(250,250,249,0.3)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Veri yok</div>}
                      {gt && (
                        <div className="flex items-center justify-center gap-1 mt-1.5" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
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
                    <tr key={idx} style={{ borderTop: `1px solid ${GRID_LINE}`, background: idx % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.16)' }}>
                      <td className="px-3 py-2 font-mono text-[13px]" style={{ color: '#d8c17f', textAlign: 'left', width: 80, fontWeight: 600, borderRight: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${CELL_LINE}` }}>{row.sub}</td>
                      <td className="px-3 py-2 text-[13px]" style={{ color: 'rgba(250,250,249,0.78)', paddingLeft: 8, borderRight: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${CELL_LINE}` }}>
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
                      <td className="px-3 py-2.5 font-mono text-[12.5px]" style={{ color: '#60a5fa', textAlign: 'left', width: 80, fontWeight: 700, borderRight: `1px solid ${GRID_LINE}`, borderBottom: '1px dashed rgba(96,165,250,0.35)' }}>Manuel</td>
                      <td className="px-3 py-2.5 text-[13.5px] italic" style={{ color: '#60a5fa', paddingLeft: 8, borderRight: `1px solid ${GRID_LINE}`, borderBottom: '1px dashed rgba(96,165,250,0.35)' }}>
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
                  row.final ? 'linear-gradient(90deg, rgba(245,240,230,0.075), rgba(245,240,230,0.025))' :
                  row.total ? 'rgba(184,160,111,0.06)' :
                  row.group ? 'rgba(255,255,255,0.028)' :
                  idx % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.16)';
                const bold = row.final || row.total || row.group;
                const labelColor = row.final ? TOTAL_COLOR : row.total ? TOTAL_COLOR : row.group ? '#fafaf9' : 'rgba(250,250,249,0.7)';
                const labelFont = 'Plus Jakarta Sans';
                return (
                  <tr
                    key={idx}
                    style={{
                      background: rowBg,
                      borderTop: row.total ? `1px solid ${GRID_LINE_STRONG}` : `1px solid ${GRID_LINE}`,
                      borderBottom: row.total ? `1px solid ${GRID_LINE_STRONG}` : undefined,
                    }}
                  >
                    <td className="px-3 py-2.5 font-mono text-[12.5px]" style={{ color: 'rgba(250,250,249,0.55)', textAlign: 'left', width: 80, fontWeight: 600, borderRight: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${row.total || row.final ? CELL_LINE_STRONG : CELL_LINE}` }}>{row.kod || ''}</td>
                    <td
                      className="px-3 py-2.5"
                      style={{
                        color: labelColor,
                        fontWeight: row.final ? 650 : bold ? 700 : 400,
                        fontFamily: labelFont,
                        fontSize: row.final ? 14.5 : row.total ? 14.5 : row.group ? 14.5 : 14,
                        fontStyle: row.total && !row.final ? 'italic' : 'normal',
                        textTransform: row.total && !row.final ? 'uppercase' : 'none',
                        letterSpacing: row.total && !row.final ? '.04em' : '0',
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
                          className="px-3 py-2.5 text-center font-mono"
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
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: 12.5,
                                lineHeight: 1.05,
                                fontWeight: 850,
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
                      <td key={qi} className="px-2 py-2 text-right" style={{ borderLeft: '1px solid rgba(255,255,255,0.18)', width: 160 }}>
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
            <div key={qi} className="space-y-5 pt-2" style={{ borderTop: displayIdx > 0 ? '1px dashed rgba(184,160,111,0.15)' : 'none', paddingTop: displayIdx > 0 ? 24 : 0 }}>
              {/* Dönem başlığı */}
              <div className="flex items-baseline gap-3">
                <span className="w-1 h-7 rounded-sm" style={{ background: GOLD }} />
                <h2 className="text-[20px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>
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
                              <td className="px-3 py-2 text-right font-mono" style={{ color: row.color || (val === 0 ? MUTED_AMOUNT_COLOR : AMOUNT_COLOR), fontWeight: row.bold ? 800 : 750, fontSize: row.big ? 16 : 14.5, width: 220, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
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
                            <td className="px-3 py-2 text-right font-mono text-[14.5px]" style={{ color: Number(h.bakiye) === 0 ? MUTED_AMOUNT_COLOR : AMOUNT_COLOR, fontWeight: 750, whiteSpace: 'nowrap' }}>
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
            <table className="w-full text-left text-[13px]" style={{ fontVariantNumeric: 'tabular-nums', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
              <colgroup>
                <col />
                <col style={{ width: 180 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 180 }} />
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
                        fontFamily: 'Fraunces, serif',
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
                  <tr key={ri} style={{ borderTop: `1px solid ${GRID_LINE}`, background: row.bg || (ri % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.16)') }}>
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
                        const oncekiOdenen = draftOO !== null ? draftOO : Number(v.oncekiDonemOdenen || 0);
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
                        <td key={qi} className="px-3 py-2 text-center font-mono" style={{ color: !hasData ? MISSING_AMOUNT_COLOR : row.color || (val === 0 ? MUTED_AMOUNT_COLOR : AMOUNT_COLOR), fontWeight: row.bold ? 800 : 750, fontSize: row.big ? 15.5 : 14.5, borderLeft: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${GRID_LINE}`, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
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
              <table className="w-full text-left text-[13px]" style={{ fontVariantNumeric: 'tabular-nums', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 70 }} />
                  <col />
                  <col style={{ width: 180 }} />
                  <col style={{ width: 180 }} />
                  <col style={{ width: 180 }} />
                  <col style={{ width: 180 }} />
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
                          fontFamily: 'Fraunces, serif',
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
                    <tr key={baseH.kod} style={{ borderTop: `1px solid ${GRID_LINE}`, background: hi % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.16)' }}>
                      <td className="px-3 py-2 font-mono text-[13px]" style={{ color: '#d8c17f', textAlign: 'left', fontWeight: 600, borderRight: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${GRID_LINE}` }}>{baseH.kod}</td>
                      <td className="px-3 py-2 text-[13px]" style={{ color: 'rgba(250,250,249,0.78)', borderRight: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${GRID_LINE}` }}>{baseH.hesapAdi || HESAP_ADLARI[baseH.kod] || '—'}</td>
                      {DISPLAY_ORDER.map((qi) => {
                        const v = getBakiye(qi, baseH.kod);
                        return (
                          <td key={qi} className="px-3 py-2 text-center font-mono text-[14.5px]" style={{ color: v === null ? MISSING_AMOUNT_COLOR : v === 0 ? MUTED_AMOUNT_COLOR : AMOUNT_COLOR, fontWeight: v === 0 ? 600 : 750, borderLeft: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${GRID_LINE}`, whiteSpace: 'nowrap' }}>
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
                        <td key={qi} className="px-3 py-2.5 text-center font-mono font-bold" style={{ color: TOTAL_COLOR, borderLeft: `1px solid ${GRID_LINE}`, borderBottom: `1px solid ${GRID_LINE}` }}>
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
                          className="px-3 py-2.5 text-center font-mono font-bold"
                          style={{
                            color: LOSS_COLOR,
                            borderLeft: `1px solid ${GRID_LINE}`,
                            borderBottom: `1px solid ${GRID_LINE}`,
                            background: ihlal ? 'rgba(239,68,68,0.18)' : undefined,
                            position: 'relative',
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
                          className="px-3 py-2.5 text-center font-mono font-bold text-[14px]"
                          style={{
                            color: negatif ? LOSS_COLOR : TOTAL_COLOR,
                            borderLeft: `1px solid ${GRID_LINE}`,
                            borderBottom: `1px solid ${GRID_LINE}`,
                            background: negatif ? 'rgba(239,68,68,0.18)' : undefined,
                            position: 'relative',
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
              {latestQuarter.donem}
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
                    <td className="px-4 py-3 font-mono">{g.donem}</td>
                    <td className="px-4 py-3 text-[11.5px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
                      {g.donemTipi}
                      {g.locked && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>KESİN</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono" style={{ color: GOLD, fontWeight: 600 }}>{fmtTRY(g.donemNetKari)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
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
        fontSize: readOnlySaved ? 14.5 : 13.5,
        fontWeight: readOnlySaved ? 750 : 650,
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
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: final ? 16 : isStrong ? 15.5 : 14.5,
        fontWeight: zero ? 500 : isStrong ? 800 : 550,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}
    >
      {missing ? '—' : fmtTRY(value ?? 0)}
    </span>
  );
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
