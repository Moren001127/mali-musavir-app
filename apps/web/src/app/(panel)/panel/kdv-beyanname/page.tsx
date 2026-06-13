'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { LucaInlineCaptchaPanel } from '@/components/luca/LucaInlineCaptchaPanel';
import {
  FileCheck, Calendar, Users, Download, AlertCircle, CheckCircle2,
  Loader2, Receipt, Sparkles,
  Bell, RefreshCw, ChevronRight, ChevronDown, AlertTriangle, ArrowLeft, Layers,
} from 'lucide-react';
import TaxpayerSelect from '@/components/ui/TaxpayerSelect';

// Teal kimlik
const TEAL = '#14b8a6';
const TEAL_BR = '#2dd4bf';
const TEAL_SF = 'rgba(20,184,166,0.13)';
const TEAL_LN = 'rgba(20,184,166,0.32)';
const STAT_GREEN = '#5fcf8e';
const STAT_AMBER = '#f0b755';
const STAT_RED = '#ef6b6b';

// Akış (Concept A) paleti — KDV1 detay ekranı
const A_INK = '#fffaf0';
const A_MUTED = '#b8aea0';
const A_FAINT = '#857c70';
const A_PANEL = '#1a1613';
const A_BG2 = '#15120f';
const A_LINE = 'rgba(255,250,240,0.08)';
const A_LINE2 = 'rgba(255,250,240,0.14)';
const A_TEAL3 = '#5eead4';
const A_CARD = 'linear-gradient(160deg,#1a1613 0%,#15120f 100%)';
const SERIF = 'Fraunces, Georgia, serif';

type GenelBakisRow = {
  mukellefId: string;
  ad: string;
  faturaAdet: number;
  hesaplananKdv: number;
  indirilecekKdv: number;
  devredenKdv: number;
  odenecekKdv: number;
  sonrakiAyaDevreden: number;
  veriGuveniPuan: number;
  veriGuveniSeviye: 'kesin' | 'kontrol_gerekli' | 'eksik';
  durum: 'hazir' | 'eksik' | 'bos';
  kdv1Var: boolean;
  kdv1Verildi: boolean;
  kdv2Var: boolean;
  kdv2TevkifatTutari: number;
  kdv2FaturaAdet: number;
  kdv2Verildi: boolean;
};
type GenelBakis = {
  donem: string;
  hesaplandiAt: string;
  toplam: {
    mukellefAdet: number; hazirAdet: number; dikkatAdet: number;
    toplamOdenecek: number; toplamDevreden: number; kdv2Adet: number;
    kdv1VerilmeyenAdet: number; kdv2VerilmeyenAdet: number;
  };
  satirlar: GenelBakisRow[];
};

type Taxpayer = {
  id: string;
  type: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  taxNumber: string;
  mihsapId?: string | null;
};

type MonthlyStatus = {
  evraklarGeldi: boolean;
  evraklarIslendi: boolean;
  kontrolEdildi: boolean;
  indirilecekKdvKontrol: boolean;
  hesaplananKdvKontrol: boolean;
  eArsivKontrol?: boolean;
};

type Period = 'AYLIK' | 'UCAYLIK' | null;
type BeyanConfigRow = {
  taxpayerId: string;
  ad: string;
  config: {
    kdv1Period?: Period;
    kdv2Enabled?: boolean;
  };
};

type OranRow = { oran: number; matrah: number; kdv: number; adet: number; kaynak?: 'kdv_kontrol' | 'mihsap_xml' };
type KdvEksikVeri = {
  tur: string;
  seviye: 'bilgi' | 'uyari' | 'kritik';
  belgeNo?: string | null;
  taraf?: string;
  mesaj: string;
  aksiyon?: string;
};
type VeriGuveni = {
  seviye: 'kesin' | 'kontrol_gerekli' | 'eksik';
  puan: number;
  kesinFaturaAdet: number;
  toplamFaturaAdet: number;
  kontrolGerekliAdet: number;
  lucaMizanVar: boolean;
};

type Kdv1 = {
  mukellefId: string;
  mukellefAd: string;
  donem: string;
  isletmeGelirGider?: {
    gelirKdvToplam: number;
    giderKdvToplam: number;
    gelirSatirAdet: number;
    giderSatirAdet: number;
    netKdv: number;
    cekildiAt: string | null;
  } | null;
  satis: { oranlar: OranRow[]; toplamMatrah: number; toplamHesaplananKdv: number; faturaAdet: number; oranBelirsizKdv?: number; oranBelirsizAdet?: number };
  alis: {
    oranlar: OranRow[];
    toplamMatrah: number;
    toplamIndirilecekKdv: number;
    faturaAdet: number;
    tevkifatsiz: { matrah: number; kdv: number; adet: number };
    tevkifatli: { matrah: number; kdv: number; adet: number };
    oranBelirsizKdv?: number;
    oranBelirsizAdet?: number;
  };
  devreden: { tutar: number; kaynak: string; sonKayitDonem: string | null };
  sonuc: {
    hesaplananKdv: number;
    indirilecekKdv: number;
    devredenKdv: number;
    odenecekKdv: number;
    sonrakiAyaDevreden: number;
  };
  lucaKontrol: {
    mizanVar: boolean;
    luca391Bakiye: number | null;
    luca191Bakiye: number | null;
    luca190Bakiye: number | null;
    fark391: number | null;
    fark191: number | null;
    uyarilar: string[];
  };
  kaliteRapor: { ocrliFaturaOrani: number; tahminFaturaOrani: number; uyarilar: string[] };
  eksikVeriler: KdvEksikVeri[];
  veriGuveni: VeriGuveni;
};

type Kdv2 = {
  mukellefId: string;
  mukellefAd: string;
  donem: string;
  tevkifatli: Array<{
    belgeNo: string; satici: string; saticiVkn: string; tarih: string;
    matrah: number; hesaplananKdv: number; tevkifatOrani: string; tevkifatKodu: string; tevkifatTutari: number; kaynak: 'ocr' | 'ocr_eksik';
  }>;
  toplamlar: {
    faturaAdet: number; toplamMatrah: number; toplamHesaplananKdv: number; toplamTevkifat: number;
  };
  tevkifatKodlari: Array<{ kod: string; matrah: number; tevkifat: number; adet: number }>;
  uyarilar: string[];
  eksikVeriler: KdvEksikVeri[];
  veriGuveni: VeriGuveni;
};

const MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12'];
const MONTH_NAMES = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

const fmt = (n: number | null | undefined) => {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const parseMoneyInput = (value: string) => {
  const raw = String(value || '').replace(/\s/g, '').replace(/[₺TL]/gi, '');
  const normalized =
    raw.includes(',') && raw.includes('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.includes(',')
        ? raw.replace(',', '.')
        : raw;
  const n = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0;
};
const TRY = '\u20ba';
const REPORT_FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const FINANCIAL_AMOUNT_COLOR = '#fffaf0';
const VALID_KDV_RATES = [1, 8, 10, 18, 20];

const normalizeKdvRateForDisplay = (rate: number) => {
  const n = Number(rate || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 0 && n < 1 ? n * 100 : n;
};

const isValidKdvRateForDisplay = (rate: number) => {
  const normalized = normalizeKdvRateForDisplay(rate);
  return VALID_KDV_RATES.some((valid) => Math.abs(valid - normalized) < 0.01);
};

const cleanOranRows = (rows: OranRow[] | undefined) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      ...row,
      oran: normalizeKdvRateForDisplay(row.oran),
      matrah: Number(row.matrah || 0),
      kdv: Number(row.kdv || 0),
      adet: Number(row.adet || 0),
    }))
    // KDV Kontrol kaynağında matrah çoğu kez 0 (yalnız KDV tutarı + oran biliniyor).
    // Beyan için belirleyici olan KDV tutarı ve geçerli oran; matrah>0 ŞARTI KALDIRILDI
    // (yoksa Luca-mutabık satırlar elenip "kayıt yok / OCR gelmiyor" görünüyordu).
    .filter((row) => isValidKdvRateForDisplay(row.oran) && row.kdv > 0);

const sumOranRows = (rows: OranRow[]) => ({
  matrah: Math.round(rows.reduce((sum, row) => sum + Number(row.matrah || 0), 0) * 100) / 100,
  kdv: Math.round(rows.reduce((sum, row) => sum + Number(row.kdv || 0), 0) * 100) / 100,
  adet: rows.reduce((sum, row) => sum + Number(row.adet || 0), 0),
});

function MoneyText({
  value,
  color = FINANCIAL_AMOUNT_COLOR,
  strong = false,
  size,
}: {
  value: number | null | undefined;
  color?: string;
  strong?: boolean;
  size?: number;
}) {
  return (
    <span
      className="tabular-nums whitespace-nowrap"
      style={{
        color,
        fontFamily: REPORT_FONT,
        fontVariantNumeric: 'tabular-nums',
        fontSize: size ?? (strong ? 15 : 14),
        fontWeight: strong ? 750 : 650,
        letterSpacing: 0,
      }}
    >
      {TRY}{fmt(value)}
    </span>
  );
}

export default function KdvBeyannamePage() {
  const now = new Date();
  const prevMonthDate =
    now.getMonth() === 0
      ? new Date(now.getFullYear() - 1, 11)
      : new Date(now.getFullYear(), now.getMonth() - 1);
  const [selectedMukellef, setSelectedMukellef] = useState<string>('');
  const [year, setYear] = useState(prevMonthDate.getFullYear());
  const [month, setMonth] = useState(String(prevMonthDate.getMonth() + 1).padStart(2, '0'));
  const [tab, setTab] = useState<'KDV1' | 'KDV2'>('KDV1');

  const donem = `${year}-${month}`;

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers-for-kdv-beyanname'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });

  const { data: beyanConfigs = [] } = useQuery<BeyanConfigRow[]>({
    queryKey: ['beyanname-takip-configs-for-kdv-beyanname'],
    queryFn: () => api.get('/beyanname-takip/configs').then((r) => r.data).catch(() => []),
  });

  const kdvTaxpayers = React.useMemo(() => {
    if (beyanConfigs.length === 0) return taxpayers;
    const configMap = new Map(beyanConfigs.map((row) => [row.taxpayerId, row.config]));
    return taxpayers.filter((t) => {
      const cfg = configMap.get(t.id);
      if (!cfg) return false;
      return tab === 'KDV1' ? !!cfg.kdv1Period : !!cfg.kdv2Enabled;
    });
  }, [beyanConfigs, taxpayers, tab]);

  const taxpayerName = (t: Taxpayer) =>
    t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.taxNumber;

  const isBilancoTaxpayer = (t: Taxpayer | null) => {
    const d = String((t as any)?.defterTuru || (t as any)?.mihsapDefterTuru || '').toUpperCase().replace(/İ/g, 'I');
    if (!d) return true; // bilinmiyorsa bilanço varsay (mizan denemesini engellemeyelim)
    return !(d.includes('ISLETME') || d.includes('DEFTER_BEYAN') || d.includes('DEFTER BEYAN'));
  };

  const selectedTaxpayer = React.useMemo(
    () => taxpayers.find((t) => t.id === selectedMukellef) || null,
    [taxpayers, selectedMukellef],
  );

  const { data: kdv1, isLoading: kdv1Loading, error: kdv1Error } = useQuery<Kdv1>({
    queryKey: ['kdv-beyanname-kdv1', selectedMukellef, donem],
    queryFn: () =>
      api
        .get('/kdv-beyanname/on-hazirlik/kdv1', {
          params: { mukellefId: selectedMukellef, donem },
        })
        .then((r) => r.data),
    enabled: !!selectedMukellef && tab === 'KDV1',
    retry: 0,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: kdv2, isLoading: kdv2Loading, error: kdv2Error } = useQuery<Kdv2>({
    queryKey: ['kdv-beyanname-kdv2', selectedMukellef, donem],
    queryFn: () =>
      api
        .get('/kdv-beyanname/on-hazirlik/kdv2', {
          params: { mukellefId: selectedMukellef, donem },
        })
        .then((r) => r.data),
    enabled: !!selectedMukellef && tab === 'KDV2',
    retry: 0,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // NOT: Açılışta otomatik Mihsap/Luca çekme KALDIRILDI (kullanıcı isteği).
  // Veri zaten depodaysa gösterilir; çekme yalnızca manuel butonlarla yapılır.

  const handleDownload = async () => {
    if (!selectedMukellef) return;
    try {
      const resp = await api.get('/kdv-beyanname/xlsx', {
        params: { mukellefId: selectedMukellef, donem },
        responseType: 'blob',
      });
      const blob = new Blob([resp.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const muk = taxpayers.find((t) => t.id === selectedMukellef);
      a.download = `KDV-OnHazirlik_${taxpayerName(muk || ({} as any)) || 'mukellef'}_${donem}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) {
      alert(`Excel oluşturulamadı: ${e?.response?.data?.message || e?.message || 'hata'}`);
    }
  };

  return (
    <div className="px-1 py-2 space-y-3">
      {/* Header */}
      <header
        className="relative overflow-hidden rounded-[18px] border px-5 py-4"
        style={{
          background: `radial-gradient(circle at 12% 0%, ${TEAL}2e, transparent 34%), radial-gradient(circle at 84% 8%, rgba(240,183,85,0.20), transparent 42%), linear-gradient(160deg, rgba(13,31,29,0.96) 0%, #0f0d0b 74%)`,
          borderColor: 'rgba(255,255,255,0.06)',
          boxShadow: '0 16px 42px rgba(0,0,0,0.28)',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: `linear-gradient(90deg, ${TEAL}, ${TEAL_BR}, ${STAT_AMBER}, #8db6c6, ${TEAL_BR})` }}
        />
        <div className="mb-3 flex items-center gap-2.5">
          <span className="h-px w-[26px]" style={{ background: TEAL_BR }} />
          <span className="text-[10px] font-bold uppercase tracking-[.18em]" style={{ color: TEAL_BR }}>
            Vergi Uyum · KDV
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              className="grid shrink-0 place-items-center rounded-xl"
              style={{
                width: 46,
                height: 46,
                background: `linear-gradient(135deg, ${TEAL_BR}, ${STAT_AMBER})`,
                boxShadow: '0 8px 22px rgba(20,184,166,0.24)',
              }}
            >
              <FileCheck size={24} style={{ color: '#10201d' }} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[30px] font-semibold leading-none tracking-normal text-[#fafaf9]" style={{ fontFamily: SERIF }}>
                KDV Durum Panosu
              </h1>
              <p className="mt-2 text-[13px] font-semibold text-white/45">
                Kontrolü biten mükellefin KDV durumu, KDV2 tevkifat tespiti ve verilme takibi aynı panelde izlenir.
              </p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <span
              className="inline-flex h-9 max-w-[280px] items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-bold"
              style={{ color: '#fafaf9', background: 'rgba(255,255,255,0.035)', borderColor: 'rgba(255,255,255,0.08)' }}
              title={selectedTaxpayer ? taxpayerName(selectedTaxpayer) : 'Mükellef seçilmedi'}
            >
              <Users size={14} style={{ color: TEAL_BR }} />
              <span className="truncate">{selectedTaxpayer ? taxpayerName(selectedTaxpayer) : 'Mükellef seçilmedi'}</span>
            </span>
            <span
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-bold"
              style={{ color: '#fafaf9', background: 'rgba(255,255,255,0.035)', borderColor: 'rgba(255,255,255,0.08)' }}
            >
              <Calendar size={14} style={{ color: STAT_AMBER }} />
              {donem}
            </span>
            <span
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-bold"
              style={{ color: '#fafaf9', background: 'rgba(255,255,255,0.035)', borderColor: 'rgba(255,255,255,0.08)' }}
            >
              <Layers size={14} style={{ color: TEAL_BR }} />
              {tab}
            </span>
            <button
              onClick={handleDownload}
              disabled={!selectedMukellef}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] px-4 text-[12.5px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: `linear-gradient(135deg, ${STAT_AMBER}, ${TEAL_BR})`,
                color: '#0f0d0b',
                boxShadow: '0 10px 24px rgba(20,184,166,0.18)',
              }}
            >
              <Download size={15} /> Excel İndir
            </button>
          </div>
        </div>
      </header>

      {/* Seçim kartı — yalnız pano modunda (mükellef seçili değilken) */}
      {!selectedMukellef && (
        <div
          className="rounded-2xl p-4 border"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="w-[3px] h-4 rounded-sm" style={{ background: '#14b8a6' }} />
            <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>Dönem & Mükellef</h3>
          </div>
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-6 md:col-span-3">
              <label className="text-[11px] font-bold uppercase tracking-[.12em] flex items-center gap-1.5 mb-1.5" style={{ color: A_TEAL3 }}>
                <Calendar size={12} /> Yıl
              </label>
              <div className="relative">
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-full appearance-none pl-3.5 pr-9 py-3 rounded-[11px] text-[14px] font-semibold outline-none cursor-pointer transition focus:border-teal-500/60"
                  style={{ background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.28)', color: '#fff' }}
                >
                  {[2024, 2025, 2026, 2027].map((y) => (
                    <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: A_TEAL3 }} />
              </div>
            </div>
            <div className="col-span-6 md:col-span-3">
              <label className="text-[11px] font-bold uppercase tracking-[.12em] flex items-center gap-1.5 mb-1.5" style={{ color: A_TEAL3 }}>
                <Calendar size={12} /> Ay
              </label>
              <div className="relative">
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full appearance-none pl-3.5 pr-9 py-3 rounded-[11px] text-[14px] font-semibold outline-none cursor-pointer transition"
                  style={{ background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.28)', color: '#fff' }}
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={m} style={{ background: '#0f0d0b' }}>{MONTH_NAMES[i]}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: A_TEAL3 }} />
              </div>
            </div>
            <div className="col-span-12 md:col-span-6">
              <label className="text-[11px] font-bold uppercase tracking-[.12em] flex items-center gap-1.5 mb-1.5" style={{ color: A_TEAL3 }}>
                <Users size={12} /> Mükellefe git (opsiyonel)
              </label>
              <TaxpayerSelect
                taxpayers={kdvTaxpayers}
                value={selectedMukellef}
                onChange={setSelectedMukellef}
                placeholder="— Mükellef Seçin —"
              />
            </div>
          </div>
        </div>
      )}

      {/* Detay üst bar — kompakt (mükellef seçiliyken) */}
      {selectedMukellef && (
        <div
          className="flex flex-wrap items-center gap-2.5 rounded-xl border px-3 py-2.5"
          style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
        >
          <button
            type="button"
            onClick={() => setSelectedMukellef('')}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition hover:bg-white/[0.05]"
            style={{ borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.72)' }}
          >
            <ArrowLeft size={14} /> Pano
          </button>
          <Users size={14} style={{ color: '#14b8a6' }} />
          <span className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>
            {selectedTaxpayer ? taxpayerName(selectedTaxpayer) : ''}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="appearance-none rounded-[9px] pl-3 pr-8 py-2 text-[13px] font-semibold outline-none cursor-pointer"
                style={{ background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.28)', color: '#fff' }}
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: A_TEAL3 }} />
            </div>
            <div className="relative">
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="appearance-none rounded-[9px] pl-3 pr-8 py-2 text-[13px] font-semibold outline-none cursor-pointer"
                style={{ background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.28)', color: '#fff' }}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={m} style={{ background: '#0f0d0b' }}>{MONTH_NAMES[i]}</option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: A_TEAL3 }} />
            </div>
          </div>
        </div>
      )}

      {/* Tab seçici */}
      {selectedMukellef && (
        <div className="flex gap-2">
          {(['KDV1', 'KDV2'] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-4 py-2 rounded-[10px] text-[12.5px] font-semibold transition-all"
                style={{
                  background: active ? 'rgba(13,148,136,0.15)' : 'rgba(255,255,255,0.03)',
                  color: active ? '#14b8a6' : 'rgba(250,250,249,0.6)',
                  border: `1px solid ${active ? 'rgba(13,148,136,0.35)' : 'rgba(255,255,255,0.08)'}`,
                }}
              >
                {t === 'KDV1' ? 'KDV1 · Genel Beyan' : 'KDV2 · Tevkifat Sorumlusu'}
              </button>
            );
          })}
        </div>
      )}

      {/* KDV1 içerik */}
      {selectedMukellef && tab === 'KDV1' && (
        <div className="space-y-4">
          {kdv1Loading && <LoadingCard />}
          {!kdv1Loading && kdv1Error && <ErrorCard error={kdv1Error} label="KDV1" />}
          {!kdv1Loading && !kdv1Error && kdv1 && kdv1.satis.faturaAdet === 0 && kdv1.alis.faturaAdet === 0 && (
            <EmptyStateCard donem={donem} />
          )}
          {!kdv1Loading && !kdv1Error && kdv1 && (kdv1.satis.faturaAdet > 0 || kdv1.alis.faturaAdet > 0) && (
            <Kdv1View data={kdv1} isBilanco={isBilancoTaxpayer(selectedTaxpayer)} />
          )}
        </div>
      )}

      {/* KDV2 içerik */}
      {selectedMukellef && tab === 'KDV2' && (
        <div className="space-y-4">
          {kdv2Loading && <LoadingCard />}
          {!kdv2Loading && kdv2Error && <ErrorCard error={kdv2Error} label="KDV2" />}
          {!kdv2Loading && !kdv2Error && kdv2 && kdv2.toplamlar.faturaAdet === 0 && (
            <div
              className="rounded-2xl p-10 text-center border"
              style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
            >
              <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>
                Bu dönemde tevkifatlı fatura bulunamadı
              </p>
              <p className="text-[12px] mt-2" style={{ color: 'rgba(250,250,249,0.5)' }}>
                KDV2 beyanı için tevkifatlı alış faturası gerekir. Faturalar KDV Kontrol'den geçmiş olmalı (OCR tevkifat tutarını okur).
              </p>
            </div>
          )}
          {!kdv2Loading && !kdv2Error && kdv2 && kdv2.toplamlar.faturaAdet > 0 && <Kdv2View data={kdv2} />}
        </div>
      )}

      {!selectedMukellef && (
        <GenelBakisPano donem={donem} onSelect={(id) => setSelectedMukellef(id)} />
      )}
    </div>
  );
}

// ============================================================
// KDV DURUM PANOSU — otomatik genel bakış (teal)
// ============================================================
type Filtre = 'hepsi' | 'odeme' | 'hazir' | 'dikkat' | 'kdv2' | 'kdv1verilmeyen' | 'kdv2verilmeyen';
const FILTRE_ETIKET: Record<Filtre, string> = {
  hepsi: 'Hepsi',
  odeme: 'Ödeme çıkanlar',
  hazir: 'Hazır olanlar',
  dikkat: 'Dikkat gerekenler',
  kdv2: 'KDV2 olanlar',
  kdv1verilmeyen: 'KDV1 verilmeyenler',
  kdv2verilmeyen: 'KDV2 verilmeyenler',
};

function GenelBakisPano({ donem, onSelect }: { donem: string; onSelect: (id: string) => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filtre>('hepsi');
  const [forcing, setForcing] = useState(false);
  // Sayaç kartına tıklanınca aynı filtre tekrar tıklanırsa "hepsi"ye döner
  const toggleFilter = (k: Filtre) => setFilter((cur) => (cur === k ? 'hepsi' : k));

  const { data, isLoading, error } = useQuery<GenelBakis>({
    queryKey: ['kdv-genel-bakis', donem],
    queryFn: () => api.get('/kdv-beyanname/genel-bakis', { params: { donem } }).then((r) => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const yenile = async () => {
    setForcing(true);
    try {
      const d = await api.get('/kdv-beyanname/genel-bakis', { params: { donem, force: 1 } }).then((r) => r.data);
      qc.setQueryData(['kdv-genel-bakis', donem], d);
    } catch {
      toast.error('Yenilenemedi');
    } finally {
      setForcing(false);
    }
  };

  const bildirMut = useMutation({
    mutationFn: () => api.post('/kdv-beyanname/bildir', { donem }).then((r) => r.data),
    onSuccess: (res: any) => {
      toast.success(`${res.kdv2Adet} mükellefte KDV2 · ${res.bildirimAdet} yeni bildirim · ${res.verilmeyenAdet} verilmemiş`);
      yenile();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Bildirim üretilemedi'),
  });

  const durumMut = useMutation({
    mutationFn: (v: { mukellefId: string; tip: 'KDV1' | 'KDV2'; verildi: boolean }) =>
      api.put(`/beyanname-takip/durum/${v.mukellefId}/${v.tip}/${donem}`, {
        durum: v.verildi ? 'onaylandi' : 'beklemede',
      }),
    onMutate: (v) => {
      qc.setQueryData<GenelBakis>(['kdv-genel-bakis', donem], (old) =>
        !old
          ? old
          : {
              ...old,
              satirlar: old.satirlar.map((r) =>
                r.mukellefId === v.mukellefId
                  ? { ...r, [v.tip === 'KDV1' ? 'kdv1Verildi' : 'kdv2Verildi']: v.verildi }
                  : r,
              ),
            },
      );
    },
    onError: () => {
      toast.error('Durum güncellenemedi');
      yenile();
    },
  });

  const backfillOranMut = useMutation({
    mutationFn: () => api.post('/kdv-control/backfill-oran-donem', { donem }).then((r) => r.data),
    onSuccess: (d: any) => {
      if ((d?.fixed ?? 0) > 0) {
        toast.success(
          `${d.fixed} faturanın oranı dolduruldu` + (d.stillMissing > 0 ? ` · ${d.stillMissing} fatura elle girilmeli` : ''),
        );
      } else if ((d?.stillMissing ?? 0) > 0) {
        toast(`${d.stillMissing} faturanın oranı veriden türetilemedi — Teyit Paneli'nden elle girilmeli`, { icon: 'ℹ️' });
      } else {
        toast.success('Doldurulacak eksik oran yok — hepsi tam');
      }
      yenile();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Oran tamamlama başarısız'),
  });

  const satirlar = React.useMemo(() => {
    const all = data?.satirlar || [];
    switch (filter) {
      case 'odeme':          return all.filter((r) => r.odenecekKdv > 0);
      case 'hazir':          return all.filter((r) => r.durum === 'hazir');
      case 'dikkat':         return all.filter((r) => r.durum !== 'hazir');
      case 'kdv2':           return all.filter((r) => r.kdv2Var);
      case 'kdv1verilmeyen': return all.filter((r) => r.kdv1Var && !r.kdv1Verildi);
      case 'kdv2verilmeyen': return all.filter((r) => r.kdv2Var && !r.kdv2Verildi);
      default:               return all;
    }
  }, [data, filter]);

  if (isLoading) return <LoadingCard />;
  if (error) return <ErrorCard error={error} label="Genel bakış" />;
  if (!data) return null;
  const t = data.toplam;
  const odemeciAdet = data.satirlar.filter((r) => r.odenecekKdv > 0).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Receipt} label="Ödeme Çıkan" value={String(odemeciAdet)} accent={STAT_RED} sub={`/${t.mukellefAdet} mükellef`} active={filter === 'odeme'} onClick={() => toggleFilter('odeme')} />
        <StatCard icon={CheckCircle2} label="Hazır" value={`${t.hazirAdet}/${t.mukellefAdet}`} accent={STAT_GREEN} active={filter === 'hazir'} onClick={() => toggleFilter('hazir')} />
        <StatCard icon={AlertTriangle} label="Dikkat" value={String(t.dikkatAdet)} accent={STAT_AMBER} active={filter === 'dikkat'} onClick={() => toggleFilter('dikkat')} />
        <StatCard icon={Layers} label="KDV2 mükellef" value={String(t.kdv2Adet)} accent={TEAL_BR} active={filter === 'kdv2'} onClick={() => toggleFilter('kdv2')} />
        <StatCard icon={FileCheck} label="KDV1 verilmeyen" value={String(t.kdv1VerilmeyenAdet)} accent={STAT_RED} active={filter === 'kdv1verilmeyen'} onClick={() => toggleFilter('kdv1verilmeyen')} />
        <StatCard icon={Receipt} label="KDV2 verilmeyen" value={String(t.kdv2VerilmeyenAdet)} accent={STAT_RED} active={filter === 'kdv2verilmeyen'} onClick={() => toggleFilter('kdv2verilmeyen')} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {filter !== 'hepsi' ? (
          <button
            onClick={() => setFilter('hepsi')}
            className="inline-flex items-center gap-1.5 rounded-[9px] border px-3 py-1.5 text-[12px] font-semibold transition"
            style={{ background: TEAL_SF, borderColor: TEAL_LN, color: TEAL_BR }}
          >
            {FILTRE_ETIKET[filter]} · {satirlar.length} kayıt
            <span className="ml-0.5 text-[14px] leading-none opacity-70">×</span>
          </button>
        ) : (
          <span className="text-[12px] font-semibold" style={{ color: 'rgba(250,250,249,0.4)' }}>
            Tüm mükellefler · {satirlar.length} kayıt — yukarıdaki sayaçlara tıklayarak süzebilirsiniz
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
            Son güncelleme: {new Date(data.hesaplandiAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button
            onClick={() => backfillOranMut.mutate()}
            disabled={backfillOranMut.isPending}
            title="OCR'ın okuyamadığı KDV oranlarını, görseli yeniden okumadan kayıtlı veriden (matrah + metin) tüm mükelleflerde doldurur"
            className="inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12px] font-bold disabled:opacity-50"
            style={{ background: 'rgba(20,184,166,0.14)', border: `1px solid ${TEAL_LN}`, color: TEAL_BR }}
          >
            {backfillOranMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <span className="text-[13px] leading-none">%</span>} Oranları Tamamla
          </button>
          <button
            onClick={yenile}
            disabled={forcing}
            className="inline-flex items-center gap-1.5 rounded-[9px] border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.7)' }}
          >
            <RefreshCw size={13} className={forcing ? 'animate-spin' : ''} /> Yenile
          </button>
          <button
            onClick={() => bildirMut.mutate()}
            disabled={bildirMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12px] font-bold disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${TEAL}, #0d9488)`, color: '#04201c' }}
          >
            {bildirMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Bell size={13} />} KDV2 Tara & Bildir
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'rgba(255,255,255,0.1)', background: '#0f0d0b' }}>
        <table className="w-full text-left" style={{ minWidth: 1050, borderCollapse: 'collapse' }}>
          <thead>
            <tr
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{
                color: 'rgba(250,250,249,0.5)',
                background: 'rgba(255,255,255,0.04)',
                borderBottom: '2px solid rgba(255,255,255,0.12)',
              }}
            >
              <th className="px-4 py-3 whitespace-nowrap">Mükellef</th>
              <th className="px-3 py-3 whitespace-nowrap" style={{ borderLeft: '1px solid rgba(255,255,255,0.08)' }}>Durum</th>
              <th className="px-3 py-3 text-right whitespace-nowrap" style={{ borderLeft: '2px solid rgba(255,255,255,0.12)' }}>Hesaplanan KDV</th>
              <th className="px-3 py-3 text-right whitespace-nowrap" style={{ borderLeft: '1px solid rgba(255,255,255,0.08)' }}>İndirilecek KDV</th>
              <th className="px-3 py-3 text-right whitespace-nowrap" style={{ borderLeft: '1px solid rgba(255,255,255,0.08)' }} title="Önceki dönemden devreden KDV">Önceki Dev.</th>
              <th className="px-3 py-3 text-right whitespace-nowrap" style={{ borderLeft: '1px solid rgba(255,255,255,0.08)' }} title="Sonraki döneme devreden KDV">Sonraki Dev.</th>
              <th className="px-3 py-3 text-right whitespace-nowrap" style={{ borderLeft: '2px solid rgba(255,255,255,0.12)' }}>Ödenecek KDV</th>
              <th className="px-2 py-3 text-center whitespace-nowrap" style={{ borderLeft: '1px solid rgba(255,255,255,0.08)', width: 64 }} title="Veri Güveni">Güven</th>
              <th className="px-3 py-3 text-center whitespace-nowrap" style={{ borderLeft: '2px solid rgba(255,255,255,0.12)' }}>KDV1</th>
              <th className="px-3 py-3 text-center whitespace-nowrap" style={{ borderLeft: '1px solid rgba(255,255,255,0.08)' }}>KDV2</th>
            </tr>
          </thead>
          <tbody>
            {satirlar.map((r, idx) => (
              <tr
                key={r.mukellefId}
                className="transition hover:bg-white/[0.03]"
                style={{
                  borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.08)',
                  background: r.odenecekKdv > 0 ? 'rgba(239,107,107,0.04)' : undefined,
                }}
              >
                <td className="px-4 py-2">
                  <button onClick={() => onSelect(r.mukellefId)} className="inline-flex items-center gap-1.5 text-left">
                    <span className="text-[13px] font-bold" style={{ color: '#fafaf9' }}>{r.ad}</span>
                    <ChevronRight size={12} style={{ color: TEAL_BR, opacity: 0.6 }} />
                  </button>
                  <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.35)' }}>{r.faturaAdet} fatura</div>
                </td>
                <td className="px-3 py-2" style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
                  <DurumBadge durum={r.durum} />
                </td>
                <td className="px-3 py-2 text-right" style={{ borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                  <span className="tabular-nums text-[13px] font-semibold" style={{ color: '#fffaf0' }}>{TRY}{fmt(r.hesaplananKdv)}</span>
                </td>
                <td className="px-3 py-2 text-right" style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="tabular-nums text-[13px] font-semibold" style={{ color: '#fffaf0' }}>{TRY}{fmt(r.indirilecekKdv)}</span>
                </td>
                <td className="px-3 py-2 text-right" style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="tabular-nums text-[13px] font-semibold" style={{ color: '#fffaf0' }}>{TRY}{fmt(r.devredenKdv)}</span>
                </td>
                <td className="px-3 py-2 text-right" style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="tabular-nums text-[13px] font-semibold" style={{ color: '#fffaf0' }}>{TRY}{fmt(r.sonrakiAyaDevreden)}</span>
                </td>
                <td className="px-3 py-2 text-right" style={{ borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                  {r.odenecekKdv > 0 ? (
                    <span className="tabular-nums text-[13px] font-extrabold" style={{ color: STAT_RED }}>
                      {TRY}{fmt(r.odenecekKdv)}
                    </span>
                  ) : (
                    <span style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>
                  )}
                </td>
                <td className="px-2 py-2 text-center" style={{ borderLeft: '1px solid rgba(255,255,255,0.06)', width: 64 }}>
                  <GuvenDot seviye={r.veriGuveniSeviye} puan={r.veriGuveniPuan} />
                </td>
                <td className="px-3 py-2 text-center" style={{ borderLeft: '2px solid rgba(255,255,255,0.08)' }}>
                  {r.kdv1Var ? (
                    <VerToggle verildi={r.kdv1Verildi} onClick={() => durumMut.mutate({ mukellefId: r.mukellefId, tip: 'KDV1', verildi: !r.kdv1Verildi })} />
                  ) : (
                    <span style={{ color: 'rgba(250,250,249,0.2)' }}>—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center" style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
                  {r.kdv2Var ? (
                    <div className="inline-flex flex-col items-center gap-1">
                      <span className="text-[11px] tabular-nums font-semibold" style={{ color: TEAL_BR }}>{TRY}{fmt(r.kdv2TevkifatTutari)}</span>
                      <VerToggle verildi={r.kdv2Verildi} onClick={() => durumMut.mutate({ mukellefId: r.mukellefId, tip: 'KDV2', verildi: !r.kdv2Verildi })} />
                    </div>
                  ) : (
                    <span style={{ color: 'rgba(250,250,249,0.2)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
            {satirlar.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-[13px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                  Bu filtrede mükellef yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent, sub, active, onClick }: { icon: any; label: string; value: string; accent: string; sub?: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border p-3 text-left transition hover:bg-white/[0.04] focus:outline-none"
      style={{
        background: active ? `${accent}1a` : 'rgba(255,255,255,0.02)',
        borderColor: active ? accent : 'rgba(255,255,255,0.06)',
        boxShadow: active ? `0 0 0 1px ${accent}55` : undefined,
      }}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: active ? accent : 'rgba(250,250,249,0.45)' }}>
        <Icon size={12} style={{ color: accent }} /> {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-[20px] font-extrabold tabular-nums" style={{ color: '#fafaf9' }}>{value}</span>
        {sub && <span className="text-[11px] font-semibold" style={{ color: 'rgba(250,250,249,0.4)' }}>{sub}</span>}
      </div>
    </button>
  );
}

function DurumBadge({ durum }: { durum: 'hazir' | 'eksik' | 'bos' }) {
  const map = {
    hazir: { l: 'Hazır', c: STAT_GREEN, b: 'rgba(95,207,142,0.13)' },
    eksik: { l: 'Kontrol gerekli', c: STAT_AMBER, b: 'rgba(240,183,85,0.13)' },
    bos: { l: 'Veri yok', c: 'rgba(250,250,249,0.4)', b: 'rgba(255,255,255,0.04)' },
  }[durum];
  return <span className="inline-flex items-center rounded-md px-2 py-1 text-[10.5px] font-bold" style={{ background: map.b, color: map.c }}>{map.l}</span>;
}

function GuvenDot({ seviye, puan }: { seviye: string; puan: number }) {
  const c = seviye === 'kesin' ? STAT_GREEN : seviye === 'kontrol_gerekli' ? STAT_AMBER : STAT_RED;
  return (
    <span title={`Veri güveni: %${puan}`} className="inline-flex items-center gap-1 text-[11px] tabular-nums" style={{ color: c }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />%{puan}
    </span>
  );
}

function VerToggle({ verildi, onClick }: { verildi: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] font-bold transition"
      style={verildi
        ? { background: 'rgba(95,207,142,0.13)', borderColor: 'rgba(95,207,142,0.35)', color: STAT_GREEN }
        : { background: 'rgba(240,183,85,0.10)', borderColor: 'rgba(240,183,85,0.30)', color: STAT_AMBER }}
    >
      {verildi ? <CheckCircle2 size={11} /> : null}
      {verildi ? 'Verildi' : 'Bekliyor'}
    </button>
  );
}

function LoadingCard() {
  return (
    <div className="rounded-2xl py-16 flex flex-col items-center gap-3 border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
      <Loader2 size={28} className="animate-spin" style={{ color: '#14b8a6' }} />
      <span className="text-[12.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>Hesaplanıyor...</span>
    </div>
  );
}

function ErrorCard({ error, label }: { error: any; label: string }) {
  const status = error?.response?.status;
  const msg = error?.response?.data?.message || error?.message || 'bilinmeyen hata';
  const isNotFound = status === 404;
  const isServerError = status >= 500;
  return (
    <div
      className="rounded-2xl p-8 border"
      style={{
        background: 'rgba(239,68,68,0.06)',
        borderColor: 'rgba(239,68,68,0.25)',
      }}
    >
      <div className="flex items-start gap-3">
        <AlertCircle size={22} style={{ color: '#fca5a5', flexShrink: 0, marginTop: 2 }} />
        <div className="flex-1">
          <h3 className="text-[14.5px] font-bold mb-1" style={{ color: '#fca5a5' }}>
            {label} verisi yüklenemedi
          </h3>
          <p className="text-[12.5px] mb-2" style={{ color: 'rgba(252,165,165,0.85)' }}>
            {isNotFound && 'Backend endpoint bulunamadı (404). Railway deploy tamamlandı mı? API build başarısız olduysa son commit canlıya çıkmamış olabilir.'}
            {isServerError && `Sunucu hatası (${status}). Backend log'unu kontrol et. Prisma schema eşleşmiyor olabilir veya mükellef bulunamıyor olabilir.`}
            {!isNotFound && !isServerError && msg}
          </p>
          <code
            className="block p-2 rounded-md text-[11px] font-mono"
            style={{
              background: 'rgba(0,0,0,0.3)',
              color: 'rgba(252,165,165,0.7)',
              wordBreak: 'break-word',
            }}
          >
            {status ? `HTTP ${status} · ` : ''}{msg}
          </code>
          <p className="text-[11px] mt-2" style={{ color: 'rgba(250,250,249,0.4)' }}>
            DevTools → Network → /kdv-beyanname/on-hazirlik/{label.toLowerCase()} isteğini açıp response'a bak.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyStateCard({ donem }: { donem: string }) {
  return (
    <div
      className="rounded-2xl p-10 text-center border"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <div
        className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(20,184,166,0.1)' }}
      >
        <Receipt size={24} style={{ color: '#14b8a6' }} />
      </div>
      <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>
        Dönem <span style={{ color: '#14b8a6' }}>{donem}</span> için kayıtlı fatura bulunamadı
      </p>
      <p className="text-[12px] mt-2 max-w-md mx-auto" style={{ color: 'rgba(250,250,249,0.55)' }}>
        Önce <b>Faturalar</b> modülünden Mihsap fatura çekilmiş olmalı. Oradan "Alış Çek" ve "Satış Çek"
        butonlarıyla dönem verisi geldikten sonra burada KDV1 ön hazırlığı otomatik üretilir.
      </p>
    </div>
  );
}

function VeriGuveniPanel({ guven }: { guven?: VeriGuveni }) {
  if (!guven) return null;
  const color = guven.seviye === 'kesin' ? '#5fcf8e' : guven.seviye === 'kontrol_gerekli' ? '#f0b755' : '#ef6b6b';
  const label = guven.seviye === 'kesin' ? 'Kesin' : guven.seviye === 'kontrol_gerekli' ? 'Kontrol gerekli' : 'Eksik';
  const pct = Math.min(100, Math.max(0, guven.puan));
  return (
    <div className="rounded-2xl p-4 border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.5)' }}>Veri Güveni</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[20px] font-extrabold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color }}>%{guven.puan}</span>
          <span className="text-[11px] font-semibold" style={{ color }}>{label}</span>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <span className="block h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="mt-2 text-[12px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
        {guven.kesinFaturaAdet}/{guven.toplamFaturaAdet} fatura kesin · {guven.kontrolGerekliAdet} kayıt kontrol bekliyor
      </div>
    </div>
  );
}

function EksikVeriListesi({ items }: { items: KdvEksikVeri[] }) {
  if (!items.length) {
    return (
      <div className="rounded-2xl p-4 border flex items-center gap-2" style={{ background: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.22)', color: '#86efac' }}>
        <CheckCircle2 size={16} />
        <span className="text-[12.5px] font-semibold">Eksik veri görünmüyor; yine de Luca karşılaştırmasını kontrol et.</span>
      </div>
    );
  }
  return (
    <div className="rounded-2xl p-4 border" style={{ background: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.25)' }}>
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle size={15} style={{ color: '#fbbf24' }} />
        <h3 className="text-[13px] font-semibold" style={{ color: '#fde68a' }}>Eksik / Kontrol Gereken Veri</h3>
      </div>
      <div className="space-y-2">
        {items.slice(0, 6).map((item, i) => (
          <div key={`${item.tur}-${item.belgeNo || i}`} className="flex items-start justify-between gap-3 rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,0.18)' }}>
            <div>
              <div className="text-[12.5px] font-semibold" style={{ color: '#fafaf9' }}>
                {item.belgeNo ? `${item.belgeNo} · ` : ''}{item.mesaj}
              </div>
              {item.aksiyon && <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>{item.aksiyon}</div>}
            </div>
            <span className="text-[10.5px] uppercase font-bold" style={{ color: item.seviye === 'kritik' ? '#fca5a5' : '#fbbf24' }}>
              {item.seviye}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BeyannameAksiyonlari({
  mukellefId,
  donem,
  tip,
  tahakkukTutari,
}: {
  mukellefId: string;
  donem: string;
  tip: 'KDV1' | 'KDV2';
  tahakkukTutari?: number;
}) {
  const qc = useQueryClient();
  const [year, month] = donem.split('-').map((v) => Number(v));

  const hazirMut = useMutation({
    mutationFn: () =>
      api.put(`/beyanname-takip/durum/${mukellefId}/${tip}/${donem}`, {
        durum: 'beklemede',
        tahakkukTutari: tahakkukTutari ?? null,
        notlar: `${tip} ön hazırlığı üretildi; kontrol bekliyor.`,
      }),
    onSuccess: () => {
      toast.success(`${tip} takip kaydı güncellendi`);
      qc.invalidateQueries({ queryKey: ['beyanname-takip'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Takip kaydı güncellenemedi'),
  });

  const verildiMut = useMutation({
    mutationFn: () =>
      Promise.all([
        api.put(`/beyanname-takip/durum/${mukellefId}/${tip}/${donem}`, {
          durum: 'onaylandi',
          tahakkukTutari: tahakkukTutari ?? null,
          notlar: `${tip} beyanı verildi olarak işaretlendi.`,
        }),
        api.patch(`/taxpayers/${mukellefId}/monthly-status`, {
          year,
          month,
          kontrolEdildi: true,
          beyannameVerildi: true,
        }),
      ]),
    onSuccess: () => {
      toast.success(`${tip} verildi olarak işaretlendi`);
      qc.invalidateQueries({ queryKey: ['beyanname-takip'] });
      qc.invalidateQueries({ queryKey: ['taxpayers-for-kdv-beyanname'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Durum güncellenemedi'),
  });

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap rounded-2xl border px-5 py-4" style={{ background: 'linear-gradient(135deg,#211c18,#15120f)', borderColor: A_LINE }}>
      <div className="text-[13.5px]" style={{ color: A_MUTED }}>Beyan hazır olduğunda işaretle</div>
      <div className="flex gap-2.5 flex-wrap">
        <button
          onClick={() => hazirMut.mutate()}
          disabled={hazirMut.isPending}
          className="inline-flex items-center gap-2 text-[13px] font-semibold rounded-[10px] px-4 py-2.5 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#f0b755,#d9952f)', color: '#2a1c05' }}
        >
          {hazirMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          Hazır notu düş
        </button>
        <button
          onClick={() => verildiMut.mutate()}
          disabled={verildiMut.isPending}
          className="inline-flex items-center gap-2 text-[13px] font-semibold rounded-[10px] px-4 py-2.5 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#5fcf8e,#3da968)', color: '#062414' }}
        >
          {verildiMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          Verildi işaretle
        </button>
      </div>
    </div>
  );
}

// ============================================================
// KDV AKIŞ ŞELALESİ — Concept A yıldız bölümü
// ============================================================
function KdvWaterfall({ sonuc }: { sonuc: Kdv1['sonuc'] }) {
  const odenecek = sonuc.odenecekKdv > 0;
  const resultVal = odenecek ? sonuc.odenecekKdv : sonuc.sonrakiAyaDevreden;
  const resultLabel = odenecek ? 'Ödenecek KDV' : 'Sonraki Aya Devreden';
  // Renk mantığı (kullanıcı onayı): akış adımları NÖTR (iyi/kötü değil — sadece +/− yön);
  // renk SADECE sonuçta anlamlı. Ödenecek = ALTIN (normal sonuç, alarm değil),
  // Devreden = yeşil (alacak kalır). Kırmızı yalnız gerçek sorunlarda (Veri Güveni).
  const GOLD = '#f0b755';
  const resultColor = odenecek ? GOLD : STAT_GREEN;
  const resultRgb = odenecek ? '240,183,85' : '95,207,142';

  // Akış adımları — başlangıç (satış) → çıkarımlar → sonuç.
  const steps: Array<{
    nm: string; sub: string; val: number; sign: '+' | '−' | ''; op: '' | '−' | '=';
    kind: 'pos' | 'neg' | 'result'; Ico: typeof Receipt;
  }> = [
    { nm: 'Satış KDV', sub: 'Hesaplanan', val: sonuc.hesaplananKdv, sign: '+', op: '', kind: 'pos', Ico: Receipt },
    { nm: 'İndirilecek', sub: 'Alış KDV', val: sonuc.indirilecekKdv, sign: '−', op: '−', kind: 'neg', Ico: Download },
    { nm: 'Önceki Devreden', sub: 'Geçmiş dönem', val: sonuc.devredenKdv, sign: '−', op: '−', kind: 'neg', Ico: ArrowLeft },
    { nm: resultLabel, sub: 'Bu dönem', val: resultVal, sign: '', op: '=', kind: 'result', Ico: odenecek ? Receipt : CheckCircle2 },
  ];

  const tileTheme = (kind: 'pos' | 'neg' | 'result') => {
    // pos & neg → NÖTR (renk yok). Yalnız sonuç renkli.
    if (kind !== 'result')
      return { val: A_INK, bd: A_LINE2, bg: 'rgba(255,255,255,0.025)', icoBg: A_BG2, icoClr: A_MUTED };
    return {
      val: resultColor,
      bd: `rgba(${resultRgb},0.5)`,
      bg: `rgba(${resultRgb},0.12)`,
      icoBg: `linear-gradient(135deg, ${resultColor}, ${odenecek ? '#c9962f' : '#3fae6e'})`,
      icoClr: odenecek ? '#1a1205' : '#04201c',
    };
  };

  return (
    <div
      className="rounded-[18px] border p-6 sm:p-7 relative overflow-hidden"
      style={{
        background:
          `radial-gradient(560px 220px at 10% -30%, rgba(${resultRgb},.12), transparent 60%), linear-gradient(165deg,#15211e 0%, #141210 70%)`,
        borderColor: `rgba(${resultRgb},0.26)`,
        boxShadow: '0 30px 70px -36px rgba(0,0,0,.85), inset 0 1px 0 rgba(255,255,255,.04)',
      }}
    >
      {/* Başlık + sonuç */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[.16em]" style={{ color: resultColor }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: resultColor, boxShadow: `0 0 10px ${resultColor}` }} />
            KDV Akışı
          </div>
          <h2 className="mt-1.5 font-semibold" style={{ fontFamily: SERIF, fontSize: 23, color: A_INK }}>Vergi nasıl oluştu?</h2>
          <p className="mt-1 text-[13px] max-w-[470px]" style={{ color: A_MUTED }}>
            Satıştan toplanan KDV'den indirilecek KDV ve önceki dönem devreden düşülür; kalan tutar bu dönem {odenecek ? 'ödenir' : 'sonraki aya devreder'}.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: A_FAINT }}>Bu Dönem Sonucu</div>
          <div className="mt-0.5 tabular-nums font-bold" style={{ fontFamily: SERIF, fontSize: 34, color: resultColor, textShadow: `0 0 26px rgba(${resultRgb},.45)` }}>
            {TRY}{fmt(resultVal)}
          </div>
          <div className="text-[12px] font-semibold" style={{ color: resultColor }}>{resultLabel}</div>
        </div>
      </div>

      {/* Akış kartları (operatörlü) */}
      <div className="flex items-stretch flex-wrap lg:flex-nowrap gap-2.5 lg:gap-0">
        {steps.map((s, i) => {
          const t = tileTheme(s.kind);
          const sifir = s.val <= 0 && s.kind !== 'result';
          return (
            <React.Fragment key={s.nm}>
              {i > 0 && (
                <div className="hidden lg:flex items-center justify-center flex-none" style={{ width: 38 }}>
                  <span className="font-semibold" style={{ fontFamily: SERIF, fontSize: 24, color: A_FAINT }}>{s.op}</span>
                </div>
              )}
              <div
                className="flex-1 min-w-[150px] rounded-2xl border p-4 flex flex-col"
                style={{ borderColor: t.bd, background: t.bg }}
              >
                <div className="flex items-center gap-2.5 mb-3">
                  <div
                    className="grid place-items-center rounded-[9px] flex-none"
                    style={{ width: 32, height: 32, background: t.icoBg, border: s.kind === 'neg' ? `1px solid ${A_LINE2}` : 'none' }}
                  >
                    <s.Ico size={16} style={{ color: t.icoClr }} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-bold leading-tight truncate" style={{ color: A_INK }}>{s.nm}</div>
                    <div className="text-[10.5px]" style={{ color: A_FAINT }}>{s.sub}</div>
                  </div>
                </div>
                <div className="tabular-nums font-bold mt-auto" style={{ fontFamily: SERIF, fontSize: 23, color: sifir ? A_FAINT : t.val }}>
                  {s.sign}{TRY}{fmt(s.val)}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Alt özet şeridi */}
      <div className="flex gap-5 flex-wrap mt-5 pt-4 border-t text-[12.5px]" style={{ borderColor: A_LINE, color: A_MUTED }}>
        <span>Toplanan KDV <b className="tabular-nums ml-1" style={{ color: A_INK }}>{TRY}{fmt(sonuc.hesaplananKdv)}</b></span>
        <span style={{ color: A_FAINT }}>·</span>
        <span>Düşülen <b className="tabular-nums ml-1" style={{ color: A_INK }}>−{TRY}{fmt(Math.round((sonuc.indirilecekKdv + sonuc.devredenKdv) * 100) / 100)}</b></span>
        <span style={{ color: A_FAINT }}>·</span>
        <span>{odenecek ? 'Net ödenecek' : 'Sonraki aya'} <b className="tabular-nums ml-1" style={{ color: resultColor }}>{TRY}{fmt(resultVal)}</b></span>
      </div>
    </div>
  );
}

// ============================================================
// KONTROL & VERİ GÜVENİ — Concept A birleşik kart (KDV1)
// ============================================================
function KontrolKarti({ guven, eksikVeriler, uyarilar }: { guven?: VeriGuveni; eksikVeriler: KdvEksikVeri[]; uyarilar: string[] }) {
  const seviye = guven?.seviye || 'eksik';
  const puan = Math.min(100, Math.max(0, guven?.puan ?? 0));
  const color = seviye === 'kesin' ? STAT_GREEN : seviye === 'kontrol_gerekli' ? STAT_AMBER : STAT_RED;
  const stateLabel = seviye === 'kesin' ? 'Kesin' : seviye === 'kontrol_gerekli' ? 'Kontrol gerekli' : 'Eksik';

  // Aynı uyarı (örn. KDV Kontrol verisi yok — satış+alış için ayrı ayrı gelir) tek satırda birleşir (×N).
  type Alert = { lvl: 'kritik' | 'uyari'; belge?: string | null; msg: string; aksiyon?: string; count: number };
  const alertMap = new Map<string, Alert>();
  const pushAlert = (a: Omit<Alert, 'count'>) => {
    const key = `${a.lvl}|${a.belge || ''}|${a.msg}|${a.aksiyon || ''}`;
    const ex = alertMap.get(key);
    if (ex) ex.count += 1;
    else alertMap.set(key, { ...a, count: 1 });
  };
  for (const e of eksikVeriler) {
    if (e.seviye === 'kritik' || e.seviye === 'uyari') pushAlert({ lvl: e.seviye, belge: e.belgeNo, msg: e.mesaj, aksiyon: e.aksiyon });
  }
  for (const u of uyarilar) pushAlert({ lvl: 'uyari', msg: u });
  const alerts = Array.from(alertMap.values());
  const notSeen = new Set<string>();
  const notlar = eksikVeriler.filter((e) => {
    if (e.seviye !== 'bilgi') return false;
    const k = `${e.belgeNo || ''}|${e.mesaj}`;
    if (notSeen.has(k)) return false;
    notSeen.add(k);
    return true;
  });

  return (
    <div className="rounded-[18px] border p-6" style={{ background: A_CARD, borderColor: A_LINE }}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="text-[11px] font-bold uppercase tracking-[.12em]" style={{ color: A_FAINT }}>Kontrol</span>
        <span className="font-semibold" style={{ fontFamily: SERIF, fontSize: 18, color: A_INK }}>Veri Güveni</span>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="grid place-items-center rounded-full relative flex-none" style={{ width: 84, height: 84, background: `conic-gradient(${color} 0% ${puan}%, rgba(255,250,240,.07) ${puan}% 100%)` }}>
          <span className="absolute rounded-full" style={{ inset: 8, background: A_PANEL }} />
          <span className="relative tabular-nums font-bold" style={{ fontFamily: SERIF, fontSize: 21, color }}>%{puan}</span>
        </div>
        <div>
          <div className="font-semibold" style={{ fontFamily: SERIF, fontSize: 17, color: A_INK }}>{guven?.kesinFaturaAdet ?? 0} / {guven?.toplamFaturaAdet ?? 0} fatura kesin</div>
          <div className="text-[13px] mt-0.5" style={{ color: A_MUTED }}>{guven?.kontrolGerekliAdet ?? 0} belge kontrol bekliyor</div>
          <span className="inline-flex items-center gap-1.5 mt-2 text-[12px] font-bold rounded-full px-2.5 py-1" style={{ color, background: `${color}1a`, border: `1px solid ${color}47` }}>
            {seviye === 'kesin' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {stateLabel}
          </span>
        </div>
      </div>

      {alerts.length === 0 && notlar.length === 0 && seviye === 'kesin' && (
        <div className="mt-4 flex items-center gap-2 rounded-xl p-3.5 text-[13px] font-semibold" style={{ background: 'rgba(94,207,142,.08)', border: '1px solid rgba(94,207,142,.28)', color: STAT_GREEN }}>
          <CheckCircle2 size={15} /> Tüm kontroller temiz — beyana hazır
        </div>
      )}

      {alerts.length > 0 && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
          {alerts.slice(0, 6).map((a, i) => {
            const c = a.lvl === 'kritik' ? STAT_RED : STAT_AMBER;
            return (
              <div key={i} className="flex gap-2 rounded-lg p-2.5 items-start" style={{ background: `${c}10`, border: `1px solid ${c}38` }}>
                <AlertTriangle size={13} style={{ color: c, flexShrink: 0, marginTop: 2 }} />
                <div className="min-w-0">
                  <div className="text-[12px] font-bold flex items-center gap-1.5" style={{ color: A_INK }}>
                    {a.aksiyon || (a.lvl === 'kritik' ? 'Kritik kontrol gerekli' : 'Kontrol bekliyor')}
                    {a.count > 1 && (
                      <span className="text-[10.5px] font-bold rounded-full px-1.5 py-0.5" style={{ color: c, background: `${c}1f` }}>×{a.count}</span>
                    )}
                  </div>
                  <div className="text-[11.5px] mt-0.5 leading-snug" style={{ color: A_MUTED }}>
                    {a.belge && (
                      <span className="rounded px-1.5 py-0.5 mr-1" style={{ color: STAT_AMBER, background: 'rgba(240,183,85,.08)' }}>{a.belge}</span>
                    )}
                    {a.msg}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {notlar.length > 0 && (
        <details className="mt-3 rounded-xl border overflow-hidden [&_summary::-webkit-details-marker]:hidden" style={{ borderColor: A_LINE, background: A_BG2 }}>
          <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold flex items-center gap-2.5 list-none" style={{ color: A_MUTED }}>
            Bilgi notları
            <span className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ color: A_TEAL3, background: 'rgba(20,184,166,.1)', border: '1px solid rgba(20,184,166,.25)' }}>{notlar.length}</span>
            <ChevronRight size={14} className="ml-auto" style={{ color: A_FAINT }} />
          </summary>
          {notlar.map((n, i) => (
            <div key={i} className="px-4 py-3 text-[12.5px] border-t" style={{ borderColor: A_LINE, color: A_MUTED }}>
              {n.belgeNo ? `${n.belgeNo} · ` : ''}{n.mesaj}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function devredenKaynakLabel(devreden: Kdv1['devreden']): string {
  switch (devreden?.kaynak) {
    case 'manuel': return 'Elle girildi';
    case 'beyan_durumu': return `Önceki ay aktarımı · ${devreden?.sonKayitDonem || '—'}`;
    case 'hesaplanan': return `Önceki dönemden hesaplandı · ${devreden?.sonKayitDonem || '—'}`;
    case 'beyanname_pdf': return `Önceki beyannameden (otomatik) · ${devreden?.sonKayitDonem || '—'}`;
    case 'beyan_kaydi': return `Beyan kaydı · ${devreden?.sonKayitDonem || '—'}`;
    case 'luca_mizan': return 'Luca mizandan';
    default: return 'Kayıt yok';
  }
}

function DevredenKdvEditor({ data }: { data: Kdv1 }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(fmt(data.sonuc?.devredenKdv || 0));
  const devreden = data.devreden || { tutar: 0, kaynak: 'yok', sonKayitDonem: null };
  const sonraki = data.sonuc?.sonrakiAyaDevreden || 0;
  const kaynakLabel = devredenKaynakLabel(devreden as Kdv1['devreden']);

  React.useEffect(() => {
    setValue(fmt(data.sonuc?.devredenKdv || 0));
  }, [data.mukellefId, data.donem, data.sonuc?.devredenKdv]);

  const saveMut = useMutation({
    mutationFn: (payload: { tutar: number; mode: 'onceki' | 'sonraki' }) =>
      api.put('/kdv-beyanname/devreden', {
        mukellefId: data.mukellefId,
        donem: data.donem,
        ...payload,
      }),
    onSuccess: (_r, payload) => {
      toast.success(payload.mode === 'sonraki' ? 'Sonraki aya devreden KDV aktarıldı' : 'Devreden KDV kaydedildi');
      qc.invalidateQueries({ queryKey: ['kdv-beyanname-kdv1', data.mukellefId, data.donem] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Devreden KDV kaydedilemedi'),
  });

  const fromBeyanname = devreden?.kaynak === 'beyanname_pdf';
  const [dyy, dmm] = String(data.donem || '').split('-').map((v) => Number(v));
  const oncekiDonem = dmm === 1 ? `${dyy - 1}-12` : `${dyy}-${String(dmm - 1).padStart(2, '0')}`;
  const beyannameYok = !fromBeyanname && (devreden?.kaynak === 'hesaplanan' || devreden?.kaynak === 'yok' || devreden?.kaynak === 'beyan_kaydi');

  return (
    <div
      className="rounded-[14px] border px-4 py-3 flex items-center gap-4 flex-wrap"
      style={{ background: A_CARD, borderColor: 'rgba(20,184,166,0.18)' }}
    >
      {/* Sol: etiket + büyük tutar */}
      <div className="flex items-center gap-3 flex-none">
        <div
          className="rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[.14em]"
          style={{ background: 'rgba(20,184,166,0.12)', color: A_TEAL3, border: '1px solid rgba(20,184,166,0.25)' }}
        >
          İndirim
        </div>
        <div>
          <div className="text-[11.5px] font-semibold" style={{ color: A_MUTED }}>Önceki Dönemden Devreden</div>
          <div className="tabular-nums font-bold leading-none mt-1" style={{ fontFamily: SERIF, fontSize: 24, color: A_INK }}>
            {TRY}{fmt(data.sonuc?.devredenKdv || 0)}
          </div>
        </div>
      </div>

      {/* Orta: kaynak/uyarı (esnek alan) */}
      <div className="flex-1 min-w-[200px] flex items-center gap-2 text-[11.5px] leading-snug">
        {beyannameYok ? (
          <>
            <AlertTriangle size={13} style={{ flexShrink: 0, color: STAT_AMBER }} />
            <span style={{ color: A_MUTED }}>
              <b style={{ color: A_INK }}>{oncekiDonem}</b> beyannamesi bulunamadı; önceki ay verisinden hesaplandı. İnerse otomatik gelir.
            </span>
          </>
        ) : (
          <>
            <FileCheck size={13} style={{ flexShrink: 0, color: fromBeyanname ? A_TEAL3 : A_FAINT }} />
            <span style={{ color: A_MUTED }}>
              {fromBeyanname && <b style={{ color: A_INK }}>Beyannameler modülünden · </b>}{kaynakLabel}
            </span>
          </>
        )}
      </div>

      {/* Sağ: input + kaydet + sonraki aya */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 rounded-[8px] px-3 py-2" style={{ background: A_BG2, border: `1px solid ${A_LINE2}` }}>
          <span className="text-[10px] font-bold uppercase tracking-[.1em]" style={{ color: A_FAINT }}>Bu dönem</span>
          <span className="font-bold" style={{ color: A_FAINT }}>{TRY}</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="bg-transparent border-none outline-none tabular-nums"
            style={{ color: A_INK, fontSize: 14, fontWeight: 600, width: 100 }}
          />
        </div>
        <button
          onClick={() => saveMut.mutate({ tutar: parseMoneyInput(value), mode: 'onceki' })}
          disabled={saveMut.isPending}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-[8px] px-3 py-2 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#14b8a6,#0d9488)', color: '#04201c' }}
        >
          <CheckCircle2 size={13} /> Kaydet
        </button>
        <button
          onClick={() => saveMut.mutate({ tutar: sonraki, mode: 'sonraki' })}
          disabled={saveMut.isPending || sonraki <= 0}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-[8px] px-3 py-2 border disabled:opacity-40"
          style={{ background: 'transparent', borderColor: A_LINE2, color: A_MUTED }}
        >
          Sonraki aya: <b className="tabular-nums" style={{ color: A_INK }}>{TRY}{fmt(sonraki)}</b>
        </button>
      </div>
    </div>
  );
}

function Kdv1View({ data, isBilanco }: { data: Kdv1; isBilanco: boolean }) {
  // Backend'ten gelen veride eksik alanlar olabileceğini varsay; defansif ol
  const sonuc = data.sonuc || { hesaplananKdv: 0, indirilecekKdv: 0, devredenKdv: 0, odenecekKdv: 0, sonrakiAyaDevreden: 0 };
  const satis = data.satis || { oranlar: [], toplamMatrah: 0, toplamHesaplananKdv: 0, faturaAdet: 0 };
  const alis = data.alis || { oranlar: [], toplamMatrah: 0, toplamIndirilecekKdv: 0, faturaAdet: 0, tevkifatsiz: { matrah: 0, kdv: 0, adet: 0 }, tevkifatli: { matrah: 0, kdv: 0, adet: 0 } };
  const lucaKontrol = data.lucaKontrol || { mizanVar: false, luca391Bakiye: null, luca191Bakiye: null, luca190Bakiye: null, fark391: null, fark191: null, uyarilar: [] };
  const kaliteRapor = data.kaliteRapor || { ocrliFaturaOrani: 0, tahminFaturaOrani: 0, uyarilar: [] };
  const cleanSatisRows = cleanOranRows(satis.oranlar);
  const cleanAlisRows = cleanOranRows(alis.oranlar);
  const cleanSatisTotal = sumOranRows(cleanSatisRows);
  const cleanAlisTotal = sumOranRows(cleanAlisRows);
  const satisBelirsizAdet = (satis as any).oranBelirsizAdet ?? 0;
  const alisBelirsizAdet = (alis as any).oranBelirsizAdet ?? 0;
  // Backend (KDV Kontrol) toplamları OTORİTEDİR — oran-belirsiz tutarı da içerir.
  // Ekranda yalnız geçerli-oran satırlarını çiziyoruz; oran-belirsiz ayrı satırda
  // gösteriliyor. (Eski "hasInvalid → toplamı sıfırdan hesapla" yaması KALDIRILDI:
  //  oran-belirsiz KDV'yi siliyor, Toplam KDV'yi olduğundan düşük gösteriyordu.)
  const displaySatis = { ...satis, oranlar: cleanSatisRows };
  const displayAlis = { ...alis, oranlar: cleanAlisRows };
  const displaySonuc = sonuc;

  // Başlık "X fatura" = beyana dahil TÜM belge = geçerli-oran + oran-belirsiz
  // (yoksa "0 fatura" ama "29 belge oran okunamadı" çelişkisi çıkıyordu).
  const satisFaturaAdet = cleanSatisTotal.adet + satisBelirsizAdet;
  const alisFaturaAdet = cleanAlisTotal.adet + alisBelirsizAdet;

  return (
    <>
      <KdvWaterfall sonuc={displaySonuc} />

      <DevredenKdvEditor data={data} />
      <KontrolKarti
        guven={data.veriGuveni}
        eksikVeriler={data.eksikVeriler || []}
        uyarilar={[...lucaKontrol.uyarilar, ...kaliteRapor.uyarilar]}
      />

      <BeyannameAksiyonlari
        mukellefId={data.mukellefId}
        donem={data.donem}
        tip="KDV1"
        tahakkukTutari={displaySonuc.odenecekKdv}
      />

      {/* BELGE OCR — Satış & Alış: oran payı barlı iki kart yan yana (Konsept B) */}
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        <OranTablosu
          baslik="Satış · Hesaplanan KDV"
          renk="#5fcf8e"
          oranlar={displaySatis.oranlar}
          toplamMatrah={displaySatis.toplamMatrah}
          toplamKdv={displaySatis.toplamHesaplananKdv}
          adet={satisFaturaAdet}
          oranBelirsizKdv={data.satis?.oranBelirsizKdv ?? 0}
          oranBelirsizAdet={satisBelirsizAdet}
        />
        <OranTablosu
          baslik="Alış · İndirilecek KDV"
          renk="#7fc8ff"
          oranlar={displayAlis.oranlar}
          toplamMatrah={displayAlis.toplamMatrah}
          toplamKdv={displayAlis.toplamIndirilecekKdv}
          adet={alisFaturaAdet}
          oranBelirsizKdv={data.alis?.oranBelirsizKdv ?? 0}
          oranBelirsizAdet={alisBelirsizAdet}
          altSatir={[
            { ad: 'Tevkifatsız', v: displayAlis.tevkifatsiz },
            { ad: 'Tevkifatlı (KDV2\'ye)', v: displayAlis.tevkifatli },
          ]}
        />
      </div>

      {/* Luca — defter türü duyarlı: bilanço→mizan çapraz kontrol; işletme→uygulanmaz */}
      {isBilanco ? (
        <>
          {lucaKontrol.mizanVar && (
            <div>
              <div className="mb-2.5 flex items-center gap-2">
                <Sparkles size={14} style={{ color: '#14b8a6' }} />
                <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>Luca Çapraz Kontrol</h3>
              </div>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <LucaCrossCard hesap="391 · Hesaplanan" mihsap={displaySatis.toplamHesaplananKdv} luca={lucaKontrol.luca391Bakiye} fark={lucaKontrol.fark391} />
                <LucaCrossCard hesap="191 · İndirilecek" mihsap={displayAlis.toplamIndirilecekKdv} luca={lucaKontrol.luca191Bakiye} fark={lucaKontrol.fark191} />
              </div>
            </div>
          )}
          <LucaSnapshotFetchPanel mukellefId={data.mukellefId} donem={data.donem} autoStart={false} />
        </>
      ) : (
        <IsletmeGgFetchPanel
          data={data}
          hesaplanan={displaySatis.toplamHesaplananKdv}
          indirilecek={displayAlis.toplamIndirilecekKdv}
        />
      )}
    </>
  );
}

/**
 * İŞLETME DEFTERİ — Luca gelir-gider çekme paneli (bilanço mizanının işletme karşılığı).
 * Manuel "Luca'dan Çek" + job polling + captcha + gelir/gider KDV çapraz kontrol.
 */
function IsletmeGgFetchPanel({ data, hesaplanan, indirilecek }: { data: Kdv1; hesaplanan: number; indirilecek: number }) {
  const qc = useQueryClient();
  // İşletme: GELİR + GİDER ayrı iki iş — ikisini birlikte bekle.
  const [jobIds, setJobIds] = useState<string[]>([]);
  const gg = data.isletmeGelirGider;

  const fetchMut = useMutation({
    mutationFn: () =>
      api.post('/kdv-beyanname/isletme-gg/fetch', { mukellefId: data.mukellefId, donem: data.donem })
        .then((r) => r.data as { jobId: string; jobIds?: string[]; status: string }),
    onSuccess: (d) => {
      setJobIds(d.jobIds && d.jobIds.length ? d.jobIds : (d.jobId ? [d.jobId] : []));
      toast.info('Luca gelir-gider çekme başlatıldı (gelir + gider) — güvenlik kodu gerekirse portalda görünecek');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Çekme başlatılamadı'),
  });

  const cancelJobMut = useMutation({
    mutationFn: () => Promise.all(jobIds.map((id) => api.post(`/luca/jobs/${id}/cancel`).then((r) => r.data).catch(() => null))),
    onSuccess: () => { toast.info('Çekim iptal edildi'); setJobIds([]); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İptal edilemedi'),
  });

  const jobQuery = useQuery({
    queryKey: ['kdv-luca-jobs', jobIds],
    queryFn: async () => {
      const jobs = await Promise.all(
        jobIds.map((id) => api.get(`/kdv-beyanname/luca-job/${id}`).then((r) => (r.data as any)?.job).catch(() => null)),
      );
      return jobs.filter(Boolean) as any[];
    },
    enabled: jobIds.length > 0,
    refetchInterval: 3000,
  });

  React.useEffect(() => {
    const jobs = jobQuery.data as any[] | undefined;
    if (!jobs || jobs.length === 0) return;
    const terminal = (s: string) => s === 'done' || s === 'failed' || s === 'cancelled';
    if (!jobs.every((j) => terminal(j.status))) return; // ikisi de bitsin
    if (jobs.some((j) => j.status === 'done')) {
      toast.success('Gelir-gider çekildi');
      qc.invalidateQueries({ queryKey: ['kdv-beyanname-kdv1', data.mukellefId, data.donem] });
    }
    if (jobs.some((j) => j.status === 'failed')) {
      const f = jobs.find((j) => j.status === 'failed');
      toast.error(`Hata: ${f?.errorMsg ? String(f.errorMsg).split('\n').filter((l: string) => l.trim()).pop() : 'bilinmeyen'}`);
    }
    setTimeout(() => setJobIds([]), 1500);
  }, [jobQuery.data, qc]);

  const fetching = jobIds.length > 0;
  const lastLogLine = (() => {
    const jobs = jobQuery.data as any[] | undefined;
    const running = jobs?.find((j) => j.status === 'running') || jobs?.[jobs.length - 1];
    if (!running?.errorMsg) return null;
    const lines = String(running.errorMsg).split('\n').filter((l: string) => l.trim());
    return lines[lines.length - 1] || null;
  })();

  return (
    <div className="rounded-2xl border p-5 space-y-3" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: '#14b8a6' }} />
            <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>Luca Gelir-Gider Çapraz Kontrol</h3>
          </div>
          <p className="text-[11.5px] mt-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
            {gg?.cekildiAt
              ? `Son çekim: ${new Date(gg.cekildiAt).toLocaleString('tr-TR')}`
              : 'İşletme defteri usulü — mizan yerine Luca gelir-gider listesi KDV toplamı çekilir. Kontrol tamamlanınca otomatik gelir; elle de çekebilirsin.'}
          </p>
        </div>
        <button
          onClick={() => fetchMut.mutate()}
          disabled={fetchMut.isPending || fetching}
          className="px-4 py-2 rounded-md text-sm font-semibold flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
          style={{ background: '#14b8a6', color: '#0a0906' }}
        >
          {fetchMut.isPending || fetching ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {fetching ? 'Çekiliyor…' : "Luca'dan Çek"}
        </button>
      </div>

      {fetching && (
        <>
          <LucaInlineCaptchaPanel
            jobIds={jobIds}
            color="#14b8a6"
            onAnswered={() => qc.invalidateQueries({ queryKey: ['kdv-luca-jobs', jobIds] })}
            onCancel={() => cancelJobMut.mutate()}
          />
          {lastLogLine && (
            <div className="rounded-md px-3 py-2 text-[11.5px] font-mono" style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(13,148,136,0.2)', color: 'rgba(250,250,249,0.75)' }}>
              {lastLogLine}
            </div>
          )}
        </>
      )}

      {gg && (
        <>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <LucaCrossCard hesap="Gelir KDV · Hesaplanan" mihsap={hesaplanan} luca={gg.gelirKdvToplam} fark={Math.round((hesaplanan - gg.gelirKdvToplam) * 100) / 100} />
            <LucaCrossCard hesap="Gider KDV · İndirilecek" mihsap={indirilecek} luca={gg.giderKdvToplam} fark={Math.round((indirilecek - gg.giderKdvToplam) * 100) / 100} />
          </div>
          <div className="text-[11.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
            Luca gelir-gider listesindeki "Hesaplanan / İndirilecek K.D.V." toplamları.
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Luca'dan KDV mizan çekme paneli — kdv-beyanname için bağımsız.
 * Mevcut Mizan modülünden BAĞIMSIZ; KdvLucaSnapshot tablosuna yazar.
 */
function LucaSnapshotFetchPanel({
  mukellefId, donem, autoStart,
  mihsapSatisOranlar, mihsapAlisOranlar,
  mihsapSatisToplam, mihsapAlisToplam,
}: {
  mukellefId: string;
  donem: string;
  autoStart?: boolean;
  mihsapSatisOranlar?: OranRow[];
  mihsapAlisOranlar?: OranRow[];
  mihsapSatisToplam?: number;
  mihsapAlisToplam?: number;
}) {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [autoStartedKey, setAutoStartedKey] = useState<string | null>(null);

  // Mevcut snapshot
  const { data: snap } = useQuery({
    queryKey: ['kdv-luca-snapshot', mukellefId, donem],
    queryFn: () =>
      api.get('/kdv-beyanname/luca-snapshot', { params: { mukellefId, donem } })
        .then((r) => r.data as {
          exists: boolean;
          cekildiAt?: string;
          toplamHesapAdet?: number;
          kdvSatirlari?: Array<{
            kod: string; ad: string;
            borcToplami: number; alacakToplami: number;
            borcBakiye: number; alacakBakiye: number;
          }>;
        }),
  });

  const fetchMut = useMutation({
    mutationFn: () =>
      api.post('/kdv-beyanname/luca-snapshot/fetch', { mukellefId, donem })
        .then((r) => r.data as { jobId: string; status: string }),
    onSuccess: (d) => {
      setJobId(d.jobId);
      toast.info('Luca job oluşturuldu — güvenlik kodu gerekirse portalda görünecek');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Job oluşturulamadı'),
  });

  React.useEffect(() => {
    const key = `${mukellefId}:${donem}`;
    if (!autoStart || snap?.exists !== false || jobId || fetchMut.isPending || autoStartedKey === key) return;
    setAutoStartedKey(key);
    fetchMut.mutate();
  }, [autoStart, snap?.exists, jobId, fetchMut.isPending, autoStartedKey, mukellefId, donem]);

  const cancelJobMut = useMutation({
    mutationFn: () => api.post(`/luca/jobs/${jobId}/cancel`).then((r) => r.data),
    onSuccess: () => {
      toast.info('Luca çekimi iptal edildi');
      setJobId(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Luca işlemi iptal edilemedi'),
  });

  // Job polling — done olunca snapshot fetch
  const jobQuery = useQuery({
    queryKey: ['kdv-luca-job', jobId],
    queryFn: () =>
      api.get(`/kdv-beyanname/luca-job/${jobId}`).then((r) => r.data),
    enabled: !!jobId,
    refetchInterval: 3000,
  });

  React.useEffect(() => {
    const j = (jobQuery.data as any)?.job;
    if (!j) return;
    if (j.status === 'done') {
      toast.success('Mizan çekildi');
      qc.invalidateQueries({ queryKey: ['kdv-luca-snapshot', mukellefId, donem] });
      qc.invalidateQueries({ queryKey: ['kdv-beyanname-kdv1', mukellefId, donem] });
      qc.invalidateQueries({ queryKey: ['kdv-beyanname-kdv2', mukellefId, donem] });
      setTimeout(() => setJobId(null), 1500);
    } else if (j.status === 'failed') {
      toast.error(`Hata: ${j.errorMsg || 'bilinmeyen'}`);
    }
  }, [jobQuery.data, qc]);

  const lastLogLine = (() => {
    const j = (jobQuery.data as any)?.job;
    if (!j?.errorMsg) return null;
    const lines = String(j.errorMsg).split('\n').filter((l: string) => l.trim());
    return lines[lines.length - 1] || null;
  })();

  return (
    <div
      className="rounded-2xl p-5 border space-y-3"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: 'rgba(20,184,166,0.8)' }} />
            <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
              Luca Mizan Çapraz Kontrol
            </h3>
          </div>
          {snap?.exists ? (
            <p className="text-[11.5px] mt-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
              Son çekim: <strong>{new Date(snap.cekildiAt!).toLocaleString('tr-TR')}</strong> · {snap.toplamHesapAdet} hesap satırı
            </p>
          ) : (
            <p className="text-[11.5px] mt-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>
              KDV beyanname için bağımsız Luca mizan henüz çekilmedi.
              "Luca'dan Çek" ile mizanı al — 191 / 391 / 190 hesapları otomatik karşılaştırılır.
            </p>
          )}
        </div>
        <button
          onClick={() => fetchMut.mutate()}
          disabled={fetchMut.isPending || !!jobId}
          className="px-4 py-2 rounded-md text-sm font-semibold flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
          style={{ background: '#14b8a6', color: '#0a0906' }}
        >
          {fetchMut.isPending || jobId ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          {jobId ? 'Çekiliyor…' : "Luca'dan Çek"}
        </button>
      </div>

      {jobId && (
        <>
          <LucaInlineCaptchaPanel
            jobIds={[jobId]}
            color="#14b8a6"
            onAnswered={() => qc.invalidateQueries({ queryKey: ['kdv-luca-job', jobId] })}
            onCancel={() => cancelJobMut.mutate()}
          />
          {lastLogLine && (
            <div
              className="rounded-md px-3 py-2 text-[11.5px] font-mono"
              style={{
                background: 'rgba(0,0,0,0.35)',
                border: '1px solid rgba(13,148,136,0.2)',
                color: 'rgba(250,250,249,0.75)',
              }}
            >
              {lastLogLine}
            </div>
          )}
        </>
      )}

      {/* KDV hesap satırları — belirgin grid tablo */}
      {snap?.exists && snap.kdvSatirlari && snap.kdvSatirlari.length > 0 && (
        <div className="rounded-2xl overflow-x-auto" style={{ border: '1px solid rgba(255,255,255,0.12)', borderLeft: '3px solid #14b8a6' }}>
          <table
            className="w-full min-w-[980px] text-[13px]"
            style={{ borderCollapse: 'collapse' }}
          >
            <thead>
              <tr style={{ color: 'rgba(255,255,255,0.55)', background: 'rgba(255,255,255,0.04)' }}>
                <th className="text-left px-3 py-2.5 font-bold uppercase tracking-[.08em] text-[10.5px]" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>Kod</th>
                <th className="text-left px-3 py-2.5 font-bold uppercase tracking-[.08em] text-[10.5px]" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>Hesap</th>
                <th className="text-right px-3 py-2.5 font-bold uppercase tracking-[.08em] text-[10.5px]" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>Borç Hareket</th>
                <th className="text-right px-3 py-2.5 font-bold uppercase tracking-[.08em] text-[10.5px]" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>Alacak Hareket</th>
                <th className="text-right px-3 py-2.5 font-bold uppercase tracking-[.08em] text-[10.5px]" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>Borç Bakiye</th>
                <th className="text-right px-3 py-2.5 font-bold uppercase tracking-[.08em] text-[10.5px]" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>Alacak Bakiye</th>
              </tr>
            </thead>
            <tbody style={{ color: '#fff' }}>
              {snap.kdvSatirlari.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? 'rgba(255,255,255,0.022)' : 'transparent' }}>
                  <td className="px-3 py-2.5 font-mono font-bold" style={{ color: '#2dd4bf', border: '1px solid rgba(255,255,255,0.09)' }}>{r.kod}</td>
                  <td className="px-3 py-2.5 font-semibold" style={{ border: '1px solid rgba(255,255,255,0.09)' }}>{r.ad || '—'}</td>
                  <td className="text-right px-3 py-2.5" style={{ border: '1px solid rgba(255,255,255,0.09)' }}>
                    {r.borcToplami ? <MoneyText value={r.borcToplami} size={13} /> : ''}
                  </td>
                  <td className="text-right px-3 py-2.5" style={{ border: '1px solid rgba(255,255,255,0.09)' }}>
                    {r.alacakToplami ? <MoneyText value={r.alacakToplami} size={13} /> : ''}
                  </td>
                  <td className="text-right px-3 py-2.5" style={{ border: '1px solid rgba(255,255,255,0.09)' }}>
                    {r.borcBakiye ? <MoneyText value={r.borcBakiye} size={13} /> : ''}
                  </td>
                  <td className="text-right px-3 py-2.5" style={{ border: '1px solid rgba(255,255,255,0.09)' }}>
                    {r.alacakBakiye ? <MoneyText value={r.alacakBakiye} size={13} /> : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Luca mizanı oran-bazlı çapraz kontrol kartı.
 * Mihsap'tan gelen %X oran kalemlerini Luca mizanındaki "...KDV %X" satırlarıyla
 * eşleştirip her oran için Mihsap/Luca/Fark sütununu gösterir.
 */
function LucaCrossDetayli({
  baslik, mihsapOranlar, mihsapToplam, lucaSatirlar, prefix, lucaField,
}: {
  baslik: string;
  mihsapOranlar: OranRow[];
  mihsapToplam: number;
  lucaSatirlar: Array<{ kod: string; ad: string; borcToplami: number; alacakToplami: number; borcBakiye: number; alacakBakiye: number }>;
  prefix: '391' | '191';
  lucaField: 'alacakBakiye' | 'borcBakiye';
}) {
  const buHesap = (lucaSatirlar || []).filter((s) => String(s.kod || '').startsWith(prefix));
  const lucaOranToplam = new Map<number, number>();
  for (const s of buHesap) {
    const m = String(s.ad || '').match(/%\s*(\d{1,2})/);
    if (!m) continue;
    const oran = Number(m[1]);
    if (!isFinite(oran)) continue;
    const val = Number((s as any)[lucaField] || 0);
    lucaOranToplam.set(oran, (lucaOranToplam.get(oran) || 0) + val);
  }
  const allOranlar = new Set<number>();
  for (const o of mihsapOranlar) allOranlar.add(o.oran);
  for (const k of lucaOranToplam.keys()) allOranlar.add(k);
  const sortedOranlar = Array.from(allOranlar).sort((a, b) => a - b);

  const lucaToplam = Array.from(lucaOranToplam.values()).reduce((a, b) => a + b, 0);
  const toplamFark = Math.round((mihsapToplam - lucaToplam) * 100) / 100;
  const farkliMi = Math.abs(toplamFark) > 0.01;
  const borderClr = farkliMi ? 'rgba(239,107,107,0.3)' : 'rgba(255,255,255,0.08)';
  const cellBorder = '1px solid rgba(255,255,255,0.06)';

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: 'rgba(0,0,0,0.2)', borderColor: borderClr }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-[12px] font-bold" style={{ color: '#fafaf9' }}>{baslik}</span>
        {farkliMi ? <AlertCircle size={13} style={{ color: '#fca5a5' }} /> : <CheckCircle2 size={13} style={{ color: '#5fcf8e' }} />}
      </div>
      <table className="w-full text-[11.5px]" style={{ borderCollapse: 'collapse' }}>
        <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
          <tr style={{ color: 'rgba(250,250,249,0.55)' }}>
            <th className="text-left px-3 py-1.5 font-semibold" style={{ border: cellBorder }}>Oran</th>
            <th className="text-right px-3 py-1.5 font-semibold" style={{ border: cellBorder }}>Mihsap</th>
            <th className="text-right px-3 py-1.5 font-semibold" style={{ border: cellBorder }}>Luca</th>
            <th className="text-right px-3 py-1.5 font-semibold" style={{ border: cellBorder }}>Fark</th>
          </tr>
        </thead>
        <tbody style={{ color: 'rgba(250,250,249,0.88)' }}>
          {sortedOranlar.length === 0 && (
            <tr>
              <td className="px-3 py-2 text-center" colSpan={4} style={{ border: cellBorder, color: 'rgba(250,250,249,0.45)' }}>
                Bu hesapta oran satırı yok
              </td>
            </tr>
          )}
          {sortedOranlar.map((oran) => {
            const mihsap = mihsapOranlar.find((o) => o.oran === oran)?.kdv || 0;
            const luca = lucaOranToplam.get(oran) || 0;
            const fark = Math.round((mihsap - luca) * 100) / 100;
            const rowFark = Math.abs(fark) > 0.01;
            return (
              <tr key={oran}>
                <td className="px-3 py-1.5 font-semibold" style={{ border: cellBorder, color: '#14b8a6' }}>%{oran}</td>
                <td className="text-right px-3 py-1.5 tabular-nums" style={{ border: cellBorder }}>
                  {mihsap ? <MoneyText value={mihsap} size={11.5} /> : <span style={{ color: 'rgba(250,250,249,0.35)' }}>—</span>}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums" style={{ border: cellBorder }}>
                  {luca ? <MoneyText value={luca} size={11.5} /> : <span style={{ color: 'rgba(250,250,249,0.35)' }}>—</span>}
                </td>
                <td className="text-right px-3 py-1.5 tabular-nums" style={{ border: cellBorder }}>
                  {fark === 0 ? (
                    <span style={{ color: 'rgba(250,250,249,0.35)' }}>—</span>
                  ) : (
                    <MoneyText value={fark} size={11.5} color={rowFark ? '#fca5a5' : '#5fcf8e'} strong />
                  )}
                </td>
              </tr>
            );
          })}
          <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
            <td className="px-3 py-2 font-bold" style={{ border: cellBorder, color: '#fafaf9' }}>TOPLAM</td>
            <td className="text-right px-3 py-2 tabular-nums" style={{ border: cellBorder }}>
              <MoneyText value={mihsapToplam} size={12} strong />
            </td>
            <td className="text-right px-3 py-2 tabular-nums" style={{ border: cellBorder }}>
              <MoneyText value={lucaToplam} size={12} strong />
            </td>
            <td className="text-right px-3 py-2 tabular-nums" style={{ border: cellBorder }}>
              {toplamFark === 0 ? (
                <span style={{ color: '#5fcf8e' }}>—</span>
              ) : (
                <MoneyText value={toplamFark} size={12} color={farkliMi ? '#fca5a5' : '#5fcf8e'} strong />
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function LucaCrossCard({ hesap, mihsap, luca, fark }: { hesap: string; mihsap: number | null; luca: number | null; fark: number | null }) {
  // Terazi kartı (Konsept B): Mihsap ↔ Luca yan yana, ortada eşitlik/fark rozeti.
  const bekliyor = luca == null;
  // KDV Kontrol modülüyle AYNI mantık: kuruşu kuruşuna. Fark 0,01 TL'yi aşarsa "fark"tır.
  // (Eski %0,5 yüzde toleransı, örn. 30.000 TL'lik tutarda 149 TL'ye kadar farkı "Eşit"
  // gösterip altta gerçek farkı yazarak çelişiyordu — kaldırıldı.)
  const farkliMi = fark !== null && Math.abs(fark) > 0.01;
  const accent = bekliyor ? '#5eead4' : farkliMi ? '#ef6b6b' : '#5fcf8e';
  const accentRgb = bekliyor ? '94,234,212' : farkliMi ? '239,107,107' : '95,207,142';
  const [acctRaw, ...rest] = hesap.split('·');
  const acctNum = (acctRaw || hesap).trim();
  const acctLabel = rest.join('·').trim();
  const midIcon = farkliMi ? (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
  ) : (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round"><path d="M5 9h14M5 15h14" /></svg>
  );
  return (
    <div className="relative overflow-hidden rounded-2xl p-5" style={{ background: '#13100d', border: '1px solid rgba(255,255,255,0.12)' }}>
      <span className="absolute left-0 top-0 bottom-0" style={{ width: 3, background: accent }} />
      {/* Başlık + karar rozeti */}
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[14.5px] font-bold" style={{ color: '#fff' }}>
          {acctNum}
          {acctLabel && (
            <span className="ml-1.5 text-[10.5px] font-semibold uppercase tracking-[.08em]" style={{ color: 'rgba(255,255,255,0.45)' }}>{acctLabel}</span>
          )}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-[11px] px-3 py-1.5 text-[12px] font-extrabold"
          style={{ background: `rgba(${accentRgb},0.12)`, border: `1px solid rgba(${accentRgb},0.4)`, color: accent }}
        >
          {bekliyor ? <RefreshCw size={13} /> : farkliMi ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
          {bekliyor ? 'Bekliyor' : farkliMi ? 'Fark var' : 'Eşit'}
        </span>
      </div>
      {/* Terazi: Mihsap = Luca */}
      <div className="flex items-stretch gap-3">
        <div className="flex-1 rounded-xl px-4 py-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,250,240,0.08)' }}>
          <div className="text-[10px] font-extrabold uppercase tracking-[.12em]" style={{ color: 'rgba(255,255,255,0.45)' }}>Mihsap</div>
          <div className="mt-1.5">{mihsap == null ? <span style={{ color: 'rgba(255,255,255,0.35)' }}>—</span> : <MoneyText value={mihsap} size={17} strong />}</div>
        </div>
        <div className="flex items-center justify-center" style={{ width: 38 }}>
          <span className="flex items-center justify-center rounded-full" style={{ width: 32, height: 32, background: `rgba(${accentRgb},0.13)`, color: accent }}>{midIcon}</span>
        </div>
        <div className="flex-1 rounded-xl px-4 py-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,250,240,0.08)' }}>
          <div className="text-[10px] font-extrabold uppercase tracking-[.12em]" style={{ color: 'rgba(255,255,255,0.45)' }}>Luca</div>
          <div className="mt-1.5">{luca == null ? <span style={{ color: 'rgba(255,255,255,0.35)' }}>—</span> : <MoneyText value={luca} size={17} strong />}</div>
        </div>
      </div>
      {/* Fark */}
      <div className="mt-4 flex items-center justify-between pt-3.5" style={{ borderTop: '1px solid rgba(255,250,240,0.08)' }}>
        <span className="text-[11px] font-extrabold uppercase tracking-[.08em]" style={{ color: 'rgba(255,255,255,0.45)' }}>Fark</span>
        {fark == null ? <span style={{ color: 'rgba(255,255,255,0.4)' }}>—</span> : <MoneyText value={fark} color={accent} strong size={16} />}
      </div>
    </div>
  );
}

function OranTablosu({
  baslik, renk, oranlar, toplamKdv, adet, altSatir, oranBelirsizKdv = 0, oranBelirsizAdet = 0,
}: {
  baslik: string; renk: string; oranlar: OranRow[] | null | undefined;
  toplamMatrah?: number; toplamKdv: number; adet: number;
  oranBelirsizKdv?: number; oranBelirsizAdet?: number;
  altSatir?: Array<{ ad: string; v: { matrah: number; kdv: number; adet: number } }>;
}) {
  // Konsept B — oran payı barlı kart: her oranın KDV'si toplam içindeki payı kadar dolu bar.
  const safeOranlar = cleanOranRows(oranlar || []);
  const taraf = (baslik.split('·')[0] || baslik).trim();   // "Satış" / "Alış"
  const kdvBaslik = (baslik.split('·')[1] || '').trim();   // "Hesaplanan KDV" / "İndirilecek KDV"
  const toplamPay = Math.max(toplamKdv, 0.0001);
  const PILL_INK = '#08130f';
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl" style={{ background: '#13100d', border: '1px solid rgba(255,255,255,0.12)' }}>
      {/* Renk şeridi */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${renk}, transparent)` }} />
      {/* Başlık */}
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: renk, boxShadow: `0 0 10px ${renk}` }} />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: 'rgba(255,255,255,0.45)' }}>{taraf} · OCR</div>
            <div className="text-[15px] font-bold" style={{ color: '#fff' }}>{kdvBaslik}</div>
          </div>
        </div>
        <span className="rounded-full px-3 py-1 text-[11.5px] font-bold tabular-nums" style={{ background: `${renk}24`, color: renk, border: `1px solid ${renk}66` }}>{adet} fatura</span>
      </div>

      {safeOranlar.length === 0 && oranBelirsizKdv <= 0 ? (
        <div className="py-10 text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Bu dönem için kayıt yok
        </div>
      ) : (
        <div className="px-5 pb-3">
          {safeOranlar.map((o, idx) => {
            const pay = Math.min(100, Math.max(3, Math.round((o.kdv / toplamPay) * 100)));
            return (
              <div key={o.oran} className="py-3" style={{ borderTop: idx === 0 ? 'none' : '1px solid rgba(255,250,240,0.08)' }}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2.5">
                    <span className="inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[13px] font-extrabold" style={{ background: renk, color: PILL_INK, minWidth: 46 }}>%{o.oran}</span>
                    <span className="text-[12px] font-semibold tabular-nums" style={{ color: 'rgba(255,255,255,0.5)' }}>{o.adet} belge{o.matrah > 0 ? ` · ${TRY}${fmt(o.matrah)} matrah` : ''}</span>
                  </span>
                  <MoneyText value={o.kdv} color={renk} strong size={15} />
                </div>
                <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <span className="block h-full rounded-full transition-all" style={{ width: `${pay}%`, background: renk }} />
                </div>
              </div>
            );
          })}
          {oranBelirsizKdv > 0 && (
            <div className="py-3" style={{ borderTop: safeOranlar.length === 0 ? 'none' : '1px solid rgba(255,250,240,0.08)' }}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2.5">
                  <span className="inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[12px] font-extrabold" style={{ background: 'rgba(240,183,85,0.18)', color: STAT_AMBER, border: `1px solid ${STAT_AMBER}55`, minWidth: 46 }}>?</span>
                  <span className="text-[12px] font-semibold tabular-nums" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    Oran okunamadı{oranBelirsizAdet > 0 ? ` · ${oranBelirsizAdet} belge` : ''}
                  </span>
                </span>
                <MoneyText value={oranBelirsizKdv} color={STAT_AMBER} strong size={15} />
              </div>
              <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(3, Math.round((oranBelirsizKdv / toplamPay) * 100)))}%`, background: STAT_AMBER }} />
              </div>
              <p className="mt-1.5 text-[10.5px]" style={{ color: 'rgba(240,183,85,0.65)' }}>
                Tutar Luca'dan kesin (toplama dahil) ama KDV oranı OCR/Luca kaydından okunamadı.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tevkifat alt kırılım (yalnız alış) */}
      {altSatir && (
        <div className="grid grid-cols-2 text-[11.5px]" style={{ borderTop: '1px solid rgba(255,250,240,0.08)' }}>
          {altSatir.map((a, i) => (
            <div key={a.ad} className="px-5 py-2.5" style={{ borderRight: i === 0 ? '1px solid rgba(255,250,240,0.08)' : undefined }}>
              <div className="flex items-center justify-between" style={{ color: 'rgba(255,255,255,0.5)' }}>
                <span className="font-semibold">{a.ad}</span>
                <span className="tabular-nums">{a.v.adet}×</span>
              </div>
              <div className="mt-0.5"><MoneyText value={a.v.kdv} color={a.v.kdv > 0 ? '#fff' : 'rgba(255,255,255,0.4)'} size={13.5} /></div>
            </div>
          ))}
        </div>
      )}

      {/* Toplam KDV bandı */}
      <div className="mt-auto flex items-center justify-between px-5 py-3.5" style={{ borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.022)' }}>
        <span className="text-[10.5px] font-extrabold uppercase tracking-[.1em]" style={{ color: renk }}>Toplam KDV</span>
        <span className="tabular-nums" style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 20, color: renk }}>{TRY}{fmt(toplamKdv)}</span>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color, subtitle }: { label: string; value: number; color: string; subtitle: string }) {
  const countCard = subtitle === 'adet';
  return (
    <div
      className="rounded-2xl p-4 border"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <div className="text-[10.5px] font-bold uppercase tracking-[.12em] mb-2" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</div>
      <div className="text-[22px] font-bold tabular-nums" style={{ fontFamily: REPORT_FONT, color, fontVariantNumeric: 'tabular-nums', letterSpacing: 0 }}>
        {countCard ? value : <MoneyText value={value} color={color} strong size={22} />}
      </div>
      <div className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.4)' }}>{subtitle}</div>
    </div>
  );
}

function Kdv2View({ data }: { data: Kdv2 }) {
  // Defansif: backend eksik alan döndürürse patlamasın
  const uyarilar = data.uyarilar || [];
  const tevkifatli = data.tevkifatli || [];
  const tevkifatKodlari = data.tevkifatKodlari || [];
  const toplamlar = data.toplamlar || { faturaAdet: 0, toplamMatrah: 0, toplamHesaplananKdv: 0, toplamTevkifat: 0 };
  return (
    <>
      {uyarilar.length > 0 && (
        <div
          className="rounded-2xl p-4 border"
          style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)' }}
        >
          <div className="flex items-start gap-2">
            <AlertCircle size={16} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 2 }} />
            <div className="space-y-1">
              {uyarilar.map((u, i) => (
                <p key={i} className="text-[12.5px]" style={{ color: '#fde68a' }}>{u}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      <VeriGuveniPanel guven={data.veriGuveni} />
      <EksikVeriListesi items={data.eksikVeriler || []} />
      <BeyannameAksiyonlari
        mukellefId={data.mukellefId}
        donem={data.donem}
        tip="KDV2"
        tahakkukTutari={toplamlar.toplamTevkifat}
      />

      {/* Toplam kart */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard label="Tevkifatlı Fatura" value={toplamlar.faturaAdet} color="#c9a77c" subtitle="adet" />
        <SummaryCard label="Toplam Matrah" value={toplamlar.toplamMatrah} color="#60a5fa" subtitle="—" />
        <SummaryCard label="Hesaplanan KDV" value={toplamlar.toplamHesaplananKdv} color="#4ade80" subtitle="—" />
        <SummaryCard label="Tevkifat Tutarı" value={toplamlar.toplamTevkifat} color="#fca5a5" subtitle="beyan edilecek" />
      </div>

      {/* Detay satır tablosu */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
      >
        <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>Tevkifat Detayı</h3>
        </div>
        {tevkifatli.length === 0 ? (
          <div className="py-8 text-center text-[12.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
            Bu dönemde tevkifatlı alış faturası yok
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ color: 'rgba(250,250,249,0.5)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <th className="text-left px-4 py-2">Belge No</th>
                  <th className="text-left px-4 py-2">Satıcı</th>
                  <th className="text-left px-4 py-2">Tarih</th>
                  <th className="text-right px-4 py-2">Matrah</th>
                  <th className="text-right px-4 py-2">KDV</th>
                  <th className="text-center px-4 py-2">Kod</th>
                  <th className="text-center px-4 py-2">Oran</th>
                  <th className="text-right px-4 py-2">Tevkifat</th>
                </tr>
              </thead>
              <tbody style={{ color: '#fafaf9' }}>
                {tevkifatli.map((t, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                    <td className="px-4 py-2 tabular-nums" style={{ color: '#14b8a6', fontFamily: 'JetBrains Mono, monospace' }}>{t.belgeNo}</td>
                    <td className="px-4 py-2 truncate max-w-[220px]">{t.satici}</td>
                    <td className="px-4 py-2 tabular-nums" style={{ color: 'rgba(250,250,249,0.55)' }}>{t.tarih}</td>
                    <td className="px-4 py-2 text-right"><MoneyText value={t.matrah} /></td>
                    <td className="px-4 py-2 text-right"><MoneyText value={t.hesaplananKdv} /></td>
                    <td className="px-4 py-2 text-center font-semibold" style={{ color: t.tevkifatKodu === 'KOD_YOK' ? '#fbbf24' : '#93c5fd' }}>{t.tevkifatKodu}</td>
                    <td className="px-4 py-2 text-center font-semibold" style={{ color: '#c9a77c' }}>{t.tevkifatOrani}</td>
                    <td className="px-4 py-2 text-right"><MoneyText value={t.tevkifatTutari} color="#fca5a5" strong /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Oran bazlı özet */}
      {tevkifatKodlari.length > 0 && (
        <div
          className="rounded-2xl p-5 border"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <h3 className="text-[13px] font-semibold mb-3" style={{ color: '#fafaf9' }}>Tevkifat Oran Özeti</h3>
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ color: 'rgba(250,250,249,0.5)' }}>
                <th className="text-left py-2">Oran</th>
                <th className="text-right py-2">Matrah</th>
                <th className="text-right py-2">Tevkifat</th>
                <th className="text-right py-2">Adet</th>
              </tr>
            </thead>
            <tbody style={{ color: '#fafaf9' }}>
              {data.tevkifatKodlari.map((k) => (
                <tr key={k.kod} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td className="py-2 font-semibold" style={{ color: '#c9a77c' }}>{k.kod}</td>
                  <td className="text-right"><MoneyText value={k.matrah} /></td>
                  <td className="text-right"><MoneyText value={k.tevkifat} color="#fca5a5" /></td>
                  <td className="text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{k.adet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
