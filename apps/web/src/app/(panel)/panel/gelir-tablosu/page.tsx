'use client';
import React, { useState, useMemo } from 'react';
// useMemo zaten import edildi
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mizanApi, gelirTablosuApi, fmtTRY } from '@/lib/mizan';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  Download, Search, X, ChevronDown, Users, Calendar, Sparkles, Loader2,
  Trash2, Eye, TrendingUp, TrendingDown, Zap, FileSpreadsheet, Lock, Unlock,
} from 'lucide-react';

const GOLD = '#d4b876';

type Taxpayer = { id: string; firstName?: string | null; lastName?: string | null; companyName?: string | null; };
function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

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
  manual?: 'satisMaliyeti' | 'faaliyetGiderleri' | 'digerGiderler' | 'finansmanGiderleri' | 'olaganDisiGider' | 'vergiKarsiligi';
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
  { manual: 'satisMaliyeti', label: '2. Satılan Ticari Mallar Maliyeti (-)' },
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

  const [selectedMizan, setSelectedMizan] = useState('');

  // Manuel düzeltme state — her çeyrek için ayrı düzenleme
  // { [gelirTablosuId]: { satisMaliyeti: 150000, faaliyetGiderleri: 20000, ... } }
  const [duzeltmelerDraft, setDuzeltmelerDraft] = useState<Record<string, Record<string, number>>>({});

  const setDuzeltme = (gtId: string, key: string, val: number) => {
    setDuzeltmelerDraft((prev) => {
      const curr = { ...(prev[gtId] || {}) };
      if (val === 0 || !isFinite(val)) delete curr[key];
      else curr[key] = val;
      return { ...prev, [gtId]: curr };
    });
  };

  /** Bir kalem için manuel düzeltme dahil efektif tutar */
  const effectiveVal = (gt: any, key: string): number => {
    const base = Number(gt[key]) || 0;
    const draft = duzeltmelerDraft[gt.id]?.[key];
    if (draft !== undefined) return base + draft;
    const saved = gt.duzeltmeler?.[key];
    if (typeof saved === 'number') return base + saved;
    return base;
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

      {/* 4 Çeyrek Yıllık Görünüm — Q1 · Q2 · Q3 · Q4 */}
      <div>
        <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          Gelir Tablosu · {year} Yılı Çeyreklik Görünüm
          <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.12)', color: GOLD }}>
            {quarterSlots.filter(Boolean).length}/4 çeyrek
          </span>
        </h3>
        <div className="rounded-xl overflow-hidden overflow-x-auto" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <table className="w-full text-left" style={{ fontVariantNumeric: 'tabular-nums', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.02)' }} colSpan={2}></th>
                {['Q1 · Oca-Mar', 'Q2 · Nis-Haz', 'Q3 · Tem-Eyl', 'Q4 · Eki-Ara'].map((title, qi) => {
                  const gt = quarterSlots[qi];
                  const locked = gt?.locked;
                  return (
                    <th
                      key={qi}
                      colSpan={2}
                      className="text-center"
                      style={{
                        color: gt ? GOLD : 'rgba(250,250,249,0.35)',
                        fontSize: 13,
                        padding: '10px 14px 4px',
                        background: locked ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.02)',
                        borderLeft: '1px solid rgba(255,255,255,0.05)',
                      }}
                    >
                      {year} · {title}
                      {locked && (
                        <span className="inline-flex items-center gap-1 ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                          <Lock size={9} /> KESİN
                        </span>
                      )}
                      {!gt && <div className="text-[9.5px] font-normal mt-0.5" style={{ color: 'rgba(250,250,249,0.3)' }}>Veri yok</div>}
                      {gt && (
                        <div className="flex items-center justify-center gap-1 mt-1">
                          <button
                            onClick={() => locked ? handleUnlock(gt.id) : handleLock(gt.id)}
                            className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded"
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
                            className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded"
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
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <th className="px-3 py-2 text-right text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Kod</th>
                <th className="px-3 py-2 text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Kalem</th>
                {quarterSlots.map((gt, qi) => (
                  <React.Fragment key={qi}>
                    <th className="px-3 py-2 text-right text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)', borderLeft: '1px solid rgba(255,255,255,0.05)' }}>Tutar</th>
                    <th className="px-3 py-2 text-right text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Oran</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {TDHP_ROWS.map((row, idx) => {
                // Alt hesap satırı (sub kodu)
                if (row.sub) {
                  return (
                    <tr key={idx} style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                      <td className="px-3 py-2 font-mono text-[10.5px]" style={{ color: GOLD, textAlign: 'right', width: 70 }}>{row.sub}</td>
                      <td className="px-3 py-2 text-[12px]" style={{ color: 'rgba(250,250,249,0.65)', paddingLeft: 32 }}>
                        {row.subLabel}
                      </td>
                      {quarterSlots.map((gt, qi) => {
                        const v = gt ? getSubAccountAmount(gt, row.sub!) : null;
                        const hasData = gt !== null;
                        return (
                          <React.Fragment key={qi}>
                            <td className="px-3 py-2 text-right font-mono text-[12px]" style={{ color: !hasData ? 'rgba(250,250,249,0.2)' : v === 0 ? 'rgba(250,250,249,0.35)' : '#fafaf9', borderLeft: '1px solid rgba(255,255,255,0.03)', width: 130 }}>
                              {hasData ? fmtTRY(v!) : '—'}
                            </td>
                            <td style={{ width: 80 }}></td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  );
                }

                // Manuel düzeltme satırı (input ile)
                if (row.manual) {
                  return (
                    <tr key={idx} style={{ borderTop: '1px dashed rgba(96,165,250,0.25)', background: 'rgba(96,165,250,0.03)' }}>
                      <td className="px-3 py-2 font-mono text-[10.5px]" style={{ color: '#60a5fa', textAlign: 'right', width: 70 }}>✎</td>
                      <td className="px-3 py-2 text-[11.5px] italic" style={{ color: '#60a5fa', paddingLeft: 32 }}>
                        {row.label}
                      </td>
                      {quarterSlots.map((gt, qi) => {
                        const hasData = gt !== null;
                        if (!hasData) {
                          return (
                            <React.Fragment key={qi}>
                              <td style={{ borderLeft: '1px solid rgba(255,255,255,0.03)', width: 130 }}></td>
                              <td style={{ width: 80 }}></td>
                            </React.Fragment>
                          );
                        }
                        const draftVal = duzeltmelerDraft[gt.id]?.[row.manual!];
                        const savedVal = gt.duzeltmeler?.[row.manual!] as number | undefined;
                        const currentVal = draftVal !== undefined ? draftVal : (savedVal ?? 0);
                        const isLocked = gt.locked;
                        return (
                          <React.Fragment key={qi}>
                            <td className="px-2 py-1.5 text-right" style={{ borderLeft: '1px solid rgba(255,255,255,0.03)', width: 130 }}>
                              <input
                                type="text"
                                value={currentVal === 0 ? '' : currentVal.toString().replace('.', ',')}
                                onChange={(e) => {
                                  if (isLocked) return;
                                  const raw = e.target.value.replace(/[^\d,.-]/g, '').replace(',', '.');
                                  const n = parseFloat(raw) || 0;
                                  setDuzeltme(gt.id, row.manual!, n);
                                }}
                                disabled={isLocked}
                                placeholder={isLocked ? 'Kilitli' : '0,00'}
                                className="w-full px-2 py-1 rounded text-[12px] font-mono text-right outline-none border disabled:opacity-50"
                                style={{
                                  background: isLocked ? 'rgba(34,197,94,0.04)' : 'rgba(96,165,250,0.08)',
                                  borderColor: isLocked ? 'rgba(34,197,94,0.15)' : 'rgba(96,165,250,0.25)',
                                  color: isLocked ? 'rgba(34,197,94,0.7)' : '#60a5fa',
                                }}
                              />
                            </td>
                            <td style={{ width: 80 }}></td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  );
                }

                // Normal satır (group / total / final)
                const rowBg =
                  row.final ? 'linear-gradient(135deg, rgba(184,160,111,0.14), rgba(184,160,111,0.06))' :
                  row.total ? 'rgba(184,160,111,0.05)' :
                  row.group ? 'rgba(255,255,255,0.02)' :
                  'transparent';
                const bold = row.final || row.total || row.group;
                const labelColor = row.final ? GOLD : row.total ? GOLD : row.group ? '#fafaf9' : 'rgba(250,250,249,0.7)';
                const labelFont = row.final ? 'Fraunces, serif' : 'Plus Jakarta Sans';
                return (
                  <tr
                    key={idx}
                    style={{
                      background: rowBg,
                      borderTop: row.total ? '1px solid rgba(184,160,111,0.15)' : '1px solid rgba(255,255,255,0.03)',
                      borderBottom: row.total ? '1px solid rgba(184,160,111,0.15)' : undefined,
                    }}
                  >
                    <td className="px-3 py-2 font-mono text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)', textAlign: 'right', width: 70 }}>{row.kod || ''}</td>
                    <td
                      className="px-3 py-2 text-[12.5px]"
                      style={{
                        color: labelColor,
                        fontWeight: bold ? 700 : 400,
                        fontFamily: labelFont,
                        fontSize: row.final ? 14 : 12.5,
                        fontStyle: row.total && !row.final ? 'italic' : 'normal',
                        textTransform: row.total && !row.final ? 'uppercase' : 'none',
                        letterSpacing: row.total && !row.final ? '.04em' : '0',
                      }}
                    >
                      {row.label}
                    </td>
                    {quarterSlots.map((gt, qi) => {
                      const d = derived(gt);
                      const v = d ? ((d as any)[row.k!] ?? 0) : null;
                      const netSatis = d ? (d.netSatislar || 1) : 1;
                      const hasData = gt !== null;
                      return (
                        <React.Fragment key={qi}>
                          <td
                            className="px-3 py-2 text-right font-mono"
                            style={{
                              color: !hasData ? 'rgba(250,250,249,0.2)' : v === 0 ? 'rgba(250,250,249,0.35)' : row.final ? GOLD : row.total ? GOLD : '#fafaf9',
                              fontSize: row.final ? 15 : 12.5,
                              fontWeight: row.final || row.total ? 700 : 500,
                              borderLeft: '1px solid rgba(255,255,255,0.03)',
                              fontFamily: row.final ? 'Fraunces, serif' : 'JetBrains Mono, monospace',
                              width: 130,
                            }}
                          >
                            {hasData ? fmtTRY(v!) : '—'}
                          </td>
                          <td
                            className="px-3 py-2 text-right font-mono text-[11.5px]"
                            style={{
                              color: hasData && showPct(row.k as string) ? '#60a5fa' : 'transparent',
                              background: hasData && showPct(row.k as string) && v !== 0 ? 'rgba(96,165,250,0.06)' : 'transparent',
                              fontWeight: row.final || row.total ? 700 : 500,
                              width: 80,
                            }}
                          >
                            {hasData && showPct(row.k as string) && v !== 0 ? pct(v!, netSatis) : ''}
                          </td>
                        </React.Fragment>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Kaydet butonu satırı — manuel düzeltme taslağı varsa */}
              {quarterSlots.some((gt) => gt && Object.keys(duzeltmelerDraft[gt.id] || {}).length > 0) && (
                <tr style={{ background: 'rgba(96,165,250,0.08)', borderTop: '1px solid rgba(96,165,250,0.25)' }}>
                  <td colSpan={2} className="px-3 py-3 text-[11.5px]" style={{ color: '#60a5fa' }}>
                    ✎ Kaydedilmemiş manuel düzeltme var
                  </td>
                  {quarterSlots.map((gt, qi) => (
                    <td key={qi} colSpan={2} className="px-2 py-2 text-right" style={{ borderLeft: '1px solid rgba(255,255,255,0.03)' }}>
                      {gt && Object.keys(duzeltmelerDraft[gt.id] || {}).length > 0 ? (
                        <button
                          onClick={() => saveDuzeltmelerMut.mutate(gt.id)}
                          disabled={saveDuzeltmelerMut.isPending}
                          className="px-3 py-1.5 rounded text-[11px] font-bold"
                          style={{ background: 'rgba(96,165,250,0.2)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.4)' }}
                        >
                          {saveDuzeltmelerMut.isPending ? 'Kaydediliyor…' : 'Kaydet'}
                        </button>
                      ) : null}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Finansal Oranlar — son dolu çeyreğe göre */}
      {latestQuarter && (
        <div>
          <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
            <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
            Finansal Oranlar
            <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.12)', color: GOLD }}>
              {latestQuarter.donem}
            </span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <RatioCard label="Brüt Kar Marjı" value={pct(Number(latestQuarter.brutSatisKari), Number(latestQuarter.netSatislar) || 1)} formula="Brüt Satış Karı / Net Satışlar" tone="good" />
            <RatioCard label="Faaliyet Kar Marjı" value={pct(Number(latestQuarter.faaliyetKari), Number(latestQuarter.netSatislar) || 1)} formula="Faaliyet Karı / Net Satışlar" tone="good" />
            <RatioCard label="Faaliyet Gider Oranı" value={pct(Number(latestQuarter.faaliyetGiderleri), Number(latestQuarter.netSatislar) || 1)} formula="Faaliyet Giderleri / Net Satışlar" tone="neutral" />
            <RatioCard label="Finansman Gider Oranı" value={pct(Number(latestQuarter.finansmanGiderleri), Number(latestQuarter.netSatislar) || 1)} formula="Finansman Giderleri / Net Satışlar" tone="warn" />
            <RatioCard label="Olağan Kar Marjı" value={pct(Number(latestQuarter.olaganKar), Number(latestQuarter.netSatislar) || 1)} formula="Olağan Kar / Net Satışlar" tone="good" />
            <RatioCard label="Net Kar Marjı" value={pct(Number(latestQuarter.donemNetKari), Number(latestQuarter.netSatislar) || 1)} formula="Dönem Net Karı / Net Satışlar" tone="good" />
            <RatioCard label="Maliyet / Ciro" value={pct(Number(latestQuarter.satisMaliyeti), Number(latestQuarter.netSatislar) || 1)} formula="Satışların Maliyeti / Net Satışlar" tone="neutral" />
            <RatioCard label="Efektif Vergi Oranı" value={pct(Number(latestQuarter.vergiKarsiligi), Number(latestQuarter.donemKari) || 1)} formula="Vergi Karşılığı / Dönem Karı" tone="neutral" />
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
          <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.12)', color: GOLD }}>
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
                  <tr key={g.id} style={{ borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.03)' }}>
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
    <div className="rounded-xl border p-4" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
      <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>{label}</div>
      <div className="font-[Fraunces,serif] text-[26px] font-bold" style={{ color, letterSpacing: '-0.02em' }}>{value}</div>
      <div className="text-[10.5px] font-mono mt-1.5" style={{ color: 'rgba(250,250,249,0.4)' }}>{formula}</div>
    </div>
  );
}
