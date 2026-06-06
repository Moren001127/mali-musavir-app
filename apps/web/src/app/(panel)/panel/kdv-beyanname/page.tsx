'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { LucaInlineCaptchaPanel } from '@/components/luca/LucaInlineCaptchaPanel';
import {
  FileCheck, Calendar, Users, Download, AlertCircle, CheckCircle2,
  Loader2, Receipt, Sparkles,
  Bell, RefreshCw, ChevronRight, Wallet, AlertTriangle, ArrowLeft, Layers,
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
  satis: { oranlar: OranRow[]; toplamMatrah: number; toplamHesaplananKdv: number; faturaAdet: number };
  alis: {
    oranlar: OranRow[];
    toplamMatrah: number;
    toplamIndirilecekKdv: number;
    faturaAdet: number;
    tevkifatsiz: { matrah: number; kdv: number; adet: number };
    tevkifatli: { matrah: number; kdv: number; adet: number };
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
    .filter((row) => isValidKdvRateForDisplay(row.oran) && row.matrah > 0 && row.kdv > 0);

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
  const [selectedMukellef, setSelectedMukellef] = useState<string>('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
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
    <div className="px-6 py-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div
            className="text-[10.5px] font-bold uppercase tracking-[.14em] mb-1"
            style={{ color: 'rgba(20,184,166,0.7)' }}
          >
            Vergi Uyum · KDV Durum Panosu
          </div>
          <h1
            className="font-semibold"
            style={{ fontFamily: 'Fraunces, serif', fontSize: 28, color: '#fafaf9', letterSpacing: '-.03em' }}
          >
            KDV Durum Panosu
          </h1>
          <p className="text-[12.5px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Kontrolü biten mükellefin KDV durumu otomatik hazır. KDV2 (tevkifat) tespiti + verilme takibi.
          </p>
        </div>
        <button
          onClick={handleDownload}
          disabled={!selectedMukellef}
          className="px-4 py-2 rounded-[9px] text-[12.5px] font-bold inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          style={{
            background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
            color: '#0f0d0b',
            boxShadow: '0 2px 10px rgba(20,184,166,0.35)',
          }}
        >
          <Download size={14} /> Excel İndir
        </button>
      </div>

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
              <label className="text-[11px] font-bold uppercase tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                <Calendar size={11} className="inline mr-1" /> Yıl
              </label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-[10px] text-[13px] outline-none cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>
                ))}
              </select>
            </div>
            <div className="col-span-6 md:col-span-3">
              <label className="text-[11px] font-bold uppercase tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>Ay</label>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full px-3 py-2.5 rounded-[10px] text-[13px] outline-none cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={m} style={{ background: '#0f0d0b' }}>{MONTH_NAMES[i]}</option>
                ))}
              </select>
            </div>
            <div className="col-span-12 md:col-span-6">
              <label className="text-[11px] font-bold uppercase tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                <Users size={11} className="inline mr-1" /> Mükellefe git (opsiyonel)
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
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-[9px] px-2.5 py-1.5 text-[12.5px] outline-none cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
            >
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>
              ))}
            </select>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-[9px] px-2.5 py-1.5 text-[12.5px] outline-none cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={m} style={{ background: '#0f0d0b' }}>{MONTH_NAMES[i]}</option>
              ))}
            </select>
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
function GenelBakisPano({ donem, onSelect }: { donem: string; onSelect: (id: string) => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'hepsi' | 'kdv2' | 'dikkat' | 'verilmeyen'>('hepsi');
  const [forcing, setForcing] = useState(false);

  const { data, isLoading, error } = useQuery<GenelBakis>({
    queryKey: ['kdv-genel-bakis', donem],
    queryFn: () => api.get('/kdv-beyanname/genel-bakis', { params: { donem } }).then((r) => r.data),
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

  const satirlar = React.useMemo(() => {
    const all = data?.satirlar || [];
    if (filter === 'kdv2') return all.filter((r) => r.kdv2Var);
    if (filter === 'dikkat') return all.filter((r) => r.durum !== 'hazir');
    if (filter === 'verilmeyen')
      return all.filter((r) => (r.kdv1Var && !r.kdv1Verildi) || (r.kdv2Var && !r.kdv2Verildi));
    return all;
  }, [data, filter]);

  if (isLoading) return <LoadingCard />;
  if (error) return <ErrorCard error={error} label="Genel bakış" />;
  if (!data) return null;
  const t = data.toplam;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Wallet} label="Toplam Ödenecek" value={`${TRY}${fmt(t.toplamOdenecek)}`} accent={TEAL_BR} />
        <StatCard icon={CheckCircle2} label="Hazır" value={`${t.hazirAdet}/${t.mukellefAdet}`} accent={STAT_GREEN} />
        <StatCard icon={AlertTriangle} label="Dikkat" value={String(t.dikkatAdet)} accent={STAT_AMBER} />
        <StatCard icon={Layers} label="KDV2 mükellef" value={String(t.kdv2Adet)} accent={TEAL_BR} />
        <StatCard icon={FileCheck} label="KDV1 verilmeyen" value={String(t.kdv1VerilmeyenAdet)} accent={STAT_RED} />
        <StatCard icon={Receipt} label="KDV2 verilmeyen" value={String(t.kdv2VerilmeyenAdet)} accent={STAT_RED} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ['hepsi', 'Hepsi'],
          ['kdv2', 'KDV2 olanlar'],
          ['dikkat', 'Dikkat'],
          ['verilmeyen', 'Verilmeyen'],
        ] as const).map(([k, l]) => {
          const on = filter === k;
          return (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className="rounded-[9px] border px-3 py-1.5 text-[12px] font-semibold transition"
              style={on
                ? { background: TEAL_SF, borderColor: TEAL_LN, color: TEAL_BR }
                : { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.6)' }}
            >
              {l}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
            Son güncelleme: {new Date(data.hesaplandiAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
          </span>
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

      <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <table className="w-full border-collapse text-left" style={{ minWidth: 1060 }}>
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.4)', background: 'rgba(255,255,255,0.02)' }}>
              <th className="px-3 py-2.5">Mükellef</th>
              <th className="px-3 py-2.5">Durum</th>
              <th className="px-3 py-2.5 text-right">Hesaplanan</th>
              <th className="px-3 py-2.5 text-right">İndirilecek</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap" title="Önceki dönemden devreden KDV">ÖN.DÖN.DEVREDEN</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap" title="Sonraki döneme devreden KDV">SON.DÖN.DEVREDEN</th>
              <th className="px-3 py-2.5 text-right">Ödenecek</th>
              <th className="px-3 py-2.5 text-center">Güven</th>
              <th className="px-3 py-2.5 text-center">KDV1</th>
              <th className="px-3 py-2.5 text-center">KDV2</th>
            </tr>
          </thead>
          <tbody>
            {satirlar.map((r) => (
              <tr key={r.mukellefId} className="border-t transition hover:bg-white/[0.025]" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <td className="px-3 py-2.5">
                  <button onClick={() => onSelect(r.mukellefId)} className="inline-flex items-center gap-1.5 text-left">
                    <span className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{r.ad}</span>
                    <ChevronRight size={13} style={{ color: TEAL_BR, opacity: 0.6 }} />
                  </button>
                  <div className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.35)' }}>{r.faturaAdet} fatura</div>
                </td>
                <td className="px-3 py-2.5"><DurumBadge durum={r.durum} /></td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[12.5px]" style={{ color: '#fffaf0' }}>{TRY}{fmt(r.hesaplananKdv)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[12.5px]" style={{ color: '#fffaf0' }}>{TRY}{fmt(r.indirilecekKdv)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[12.5px]" style={{ color: '#fffaf0' }}>{TRY}{fmt(r.devredenKdv)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[12.5px]" style={{ color: '#fffaf0' }}>{TRY}{fmt(r.sonrakiAyaDevreden)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[13px] font-bold" style={{ color: r.odenecekKdv > 0 ? STAT_RED : STAT_GREEN }}>{TRY}{fmt(r.odenecekKdv)}</td>
                <td className="px-3 py-2.5 text-center"><GuvenDot seviye={r.veriGuveniSeviye} puan={r.veriGuveniPuan} /></td>
                <td className="px-3 py-2.5 text-center">
                  {r.kdv1Var ? (
                    <VerToggle verildi={r.kdv1Verildi} onClick={() => durumMut.mutate({ mukellefId: r.mukellefId, tip: 'KDV1', verildi: !r.kdv1Verildi })} />
                  ) : (
                    <span style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {r.kdv2Var ? (
                    <div className="inline-flex flex-col items-center gap-1">
                      <span className="text-[10.5px] tabular-nums" style={{ color: TEAL_BR }}>{TRY}{fmt(r.kdv2TevkifatTutari)}</span>
                      <VerToggle verildi={r.kdv2Verildi} onClick={() => durumMut.mutate({ mukellefId: r.mukellefId, tip: 'KDV2', verildi: !r.kdv2Verildi })} />
                    </div>
                  ) : (
                    <span style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>
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

function StatCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
        <Icon size={12} style={{ color: accent }} /> {label}
      </div>
      <div className="mt-1.5 text-[18px] font-extrabold tabular-nums" style={{ color: '#fafaf9' }}>{value}</div>
    </div>
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
function barBg(kind: 'pos' | 'neg' | 'result', val: number): React.CSSProperties {
  if (val <= 0)
    return {
      borderRadius: 11,
      background: 'linear-gradient(90deg,rgba(255,250,240,.18),rgba(255,250,240,.07))',
      border: `1px solid ${A_LINE2}`,
    };
  if (kind === 'result')
    return {
      borderRadius: '11px 11px 4px 4px',
      background: 'linear-gradient(180deg,#2dd4bf,#14b8a6 60%,#0b8174)',
      border: '1px solid rgba(94,234,212,.4)',
      boxShadow: '0 18px 40px -14px rgba(20,184,166,.6), inset 0 1px 0 rgba(255,255,255,.22)',
    };
  if (kind === 'neg')
    return {
      borderRadius: '11px 11px 4px 4px',
      background: 'linear-gradient(180deg,rgba(239,107,107,.5),rgba(239,107,107,.22))',
      border: '1px dashed rgba(239,107,107,.5)',
    };
  return {
    borderRadius: '11px 11px 4px 4px',
    background: 'linear-gradient(180deg,#2dd4bf,#0d9488)',
    border: '1px solid rgba(255,255,255,.06)',
    boxShadow: '0 14px 30px -16px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.12)',
  };
}

function FootItem({ sw, label, neg, val }: { sw: 'pos' | 'neg' | 'res'; label: string; neg?: boolean; val: number }) {
  const bg =
    sw === 'pos'
      ? 'linear-gradient(180deg,#2dd4bf,#0d9488)'
      : sw === 'res'
        ? 'linear-gradient(180deg,#2dd4bf,#14b8a6)'
        : 'rgba(239,107,107,.4)';
  return (
    <div className="flex items-center gap-2 text-[12.5px]" style={{ color: A_MUTED }}>
      <span className="rounded-[3px]" style={{ width: 11, height: 11, background: bg, border: sw === 'neg' ? '1px dashed rgba(239,107,107,.6)' : 'none' }} />
      {label}{' '}
      <b className="tabular-nums" style={{ color: A_INK }}>{neg ? '−' : ''}{TRY}{fmt(val)}</b>
    </div>
  );
}

function KdvWaterfall({ sonuc }: { sonuc: Kdv1['sonuc'] }) {
  const odenecek = sonuc.odenecekKdv > 0;
  const resultVal = odenecek ? sonuc.odenecekKdv : sonuc.sonrakiAyaDevreden;
  const resultLabel = odenecek ? 'Ödenecek' : 'Sonraki Aya Devreden';

  const steps: Array<{ nm: string; sub: string; val: number; pre: string; op: string; kind: 'pos' | 'neg' | 'result'; ico: string }> = [
    { nm: 'Satış KDV', sub: 'Hesaplanan', val: sonuc.hesaplananKdv, pre: '+', op: '', kind: 'pos', ico: '📈' },
    { nm: 'İndirilecek', sub: 'Alış KDV', val: sonuc.indirilecekKdv, pre: '−', op: '−', kind: 'neg', ico: '📥' },
    { nm: 'Önceki Devreden', sub: 'Geçmiş dönem', val: sonuc.devredenKdv, pre: '−', op: '−', kind: 'neg', ico: '↪' },
    { nm: resultLabel, sub: 'Bu dönem', val: resultVal, pre: '', op: '=', kind: 'result', ico: '✓' },
  ];
  const maxVal = Math.max(1, ...steps.map((s) => s.val));
  const barH = (v: number) => (v <= 0 ? 6 : Math.max(14, Math.round((v / maxVal) * 188)));

  return (
    <div
      className="rounded-[18px] border p-6 sm:p-7 relative overflow-hidden"
      style={{
        background:
          'radial-gradient(520px 220px at 12% -30%, rgba(20,184,166,.16), transparent 60%), radial-gradient(420px 200px at 95% 120%, rgba(240,183,85,.06), transparent 60%), linear-gradient(165deg,#15211e 0%, #141210 70%)',
        borderColor: 'rgba(20,184,166,0.22)',
        boxShadow: '0 30px 70px -36px rgba(0,0,0,.85), inset 0 1px 0 rgba(255,255,255,.04)',
      }}
    >
      <div className="flex items-end justify-between gap-4 flex-wrap mb-2">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[.16em]" style={{ color: A_TEAL3 }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: TEAL_BR, boxShadow: `0 0 10px ${TEAL_BR}` }} />
            KDV Akış Şelalesi
          </div>
          <h2 className="mt-1.5 font-semibold" style={{ fontFamily: SERIF, fontSize: 23, color: A_INK }}>Vergi nasıl oluştu?</h2>
          <p className="mt-1 text-[13px] max-w-[440px]" style={{ color: A_MUTED }}>
            Satıştan toplanan KDV'den indirim ve devreden düşülür; kalan tutar bu dönem {odenecek ? 'ödenir' : 'sonraki aya devreder'}.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: A_FAINT }}>Bu Dönem Sonucu · {resultLabel}</div>
          <div className="mt-0.5 tabular-nums font-bold" style={{ fontFamily: SERIF, fontSize: 34, color: odenecek ? TEAL_BR : STAT_GREEN, textShadow: '0 0 26px rgba(45,212,191,.45)' }}>
            {TRY}{fmt(resultVal)}
          </div>
        </div>
      </div>

      <div className="relative mt-7 px-1">
        <div className="absolute left-0 right-0" style={{ bottom: 74, height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,250,240,.14) 8%,rgba(255,250,240,.14) 92%,transparent)' }} />
        <div className="flex items-end" style={{ height: 300 }}>
          {steps.map((s, i) => (
            <React.Fragment key={s.nm}>
              {i > 0 && (
                <div className="relative flex-none" style={{ width: 24 }}>
                  <span className="absolute font-semibold" style={{ bottom: 108, left: 0, right: 0, textAlign: 'center', fontFamily: SERIF, fontSize: 22, color: A_FAINT }}>{s.op}</span>
                </div>
              )}
              <div className="relative flex-1 min-w-0 flex flex-col justify-end items-center" style={{ height: '100%', paddingBottom: 74 }}>
                <div className="relative" style={{ width: '78%', maxWidth: 128, height: barH(s.val), ...barBg(s.kind, s.val) }}>
                  <span
                    className="absolute left-0 right-0 tabular-nums font-bold"
                    style={{ top: -28, textAlign: 'center', fontFamily: SERIF, fontSize: s.kind === 'result' ? 17 : 15, color: s.kind === 'result' ? '#fff' : s.val <= 0 ? A_FAINT : s.kind === 'neg' ? STAT_RED : A_TEAL3 }}
                  >
                    {s.pre}{TRY}{fmt(s.val)}
                  </span>
                </div>
                <div className="absolute bottom-0 left-2 right-2 text-center">
                  <div className="mx-auto mb-2 grid place-items-center rounded-[9px]" style={{ width: 30, height: 30, border: `1px solid ${A_LINE2}`, background: s.kind === 'result' ? 'linear-gradient(135deg,#14b8a6,#0d9488)' : A_BG2, fontSize: 15 }}>{s.ico}</div>
                  <div className="text-[12.5px] font-bold leading-tight" style={{ color: A_INK }}>{s.nm}</div>
                  <div className="text-[11px]" style={{ color: A_FAINT }}>{s.sub}</div>
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="flex gap-4 flex-wrap mt-6 pt-4 border-t" style={{ borderColor: A_LINE }}>
        <FootItem sw="pos" label="Toplanan KDV" val={sonuc.hesaplananKdv} />
        <FootItem sw="neg" neg label="Düşülen" val={Math.round((sonuc.indirilecekKdv + sonuc.devredenKdv) * 100) / 100} />
        <FootItem sw="res" label={odenecek ? 'Net ödenecek' : 'Sonraki aya'} val={resultVal} />
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

      {alerts.length === 0 && notlar.length === 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-xl p-3.5 text-[13px] font-semibold" style={{ background: 'rgba(94,207,142,.08)', border: '1px solid rgba(94,207,142,.28)', color: STAT_GREEN }}>
          <CheckCircle2 size={15} /> Tüm kontroller temiz — beyana hazır
        </div>
      )}

      {alerts.slice(0, 4).map((a, i) => {
        const c = a.lvl === 'kritik' ? STAT_RED : STAT_AMBER;
        return (
          <div key={i} className="mt-3 flex gap-2.5 rounded-xl p-3.5 items-start" style={{ background: `${c}12`, border: `1px solid ${c}47` }}>
            <AlertTriangle size={16} style={{ color: c, flexShrink: 0, marginTop: 1 }} />
            <div>
              <div className="text-[13px] font-bold flex items-center gap-2" style={{ color: A_INK }}>
                {a.aksiyon || (a.lvl === 'kritik' ? 'Kritik kontrol gerekli' : 'Kontrol bekliyor')}
                {a.count > 1 && (
                  <span className="text-[11px] font-bold rounded-full px-1.5 py-0.5" style={{ color: c, background: `${c}1f` }}>×{a.count}</span>
                )}
              </div>
              <div className="text-[12.5px] mt-0.5" style={{ color: A_MUTED }}>
                {a.belge && (
                  <span className="rounded px-1.5 py-0.5 mr-1" style={{ color: STAT_AMBER, background: 'rgba(240,183,85,.08)' }}>{a.belge}</span>
                )}
                {a.msg}
              </div>
            </div>
          </div>
        );
      })}

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
  // Beyannameden gelmediyse (hesaplandı / kayıt yok), kullanıcıya nedenini açıkça söyle.
  const beyannameYok = !fromBeyanname && (devreden?.kaynak === 'hesaplanan' || devreden?.kaynak === 'yok' || devreden?.kaynak === 'beyan_kaydi');
  return (
    <div className="rounded-[18px] border p-6" style={{ background: A_CARD, borderColor: 'rgba(20,184,166,0.18)' }}>
      <div className="mb-1 flex items-center gap-2.5">
        <span className="text-[11px] font-bold uppercase tracking-[.12em]" style={{ color: A_FAINT }}>İndirim</span>
        <span className="font-semibold" style={{ fontFamily: SERIF, fontSize: 18, color: A_INK }}>Önceki Dönemden Devreden</span>
      </div>
      <div className="tabular-nums font-bold mt-1" style={{ fontFamily: SERIF, fontSize: 30, color: A_INK }}>{TRY}{fmt(data.sonuc?.devredenKdv || 0)}</div>

      <div
        className="mt-3 flex gap-2.5 items-start rounded-[9px] px-3 py-2.5 text-[11.5px] leading-relaxed"
        style={{ background: fromBeyanname ? 'rgba(20,184,166,.08)' : 'rgba(255,250,240,.03)', border: `1px solid ${fromBeyanname ? 'rgba(20,184,166,.22)' : A_LINE}` }}
      >
        <FileCheck size={14} style={{ flexShrink: 0, marginTop: 1, color: fromBeyanname ? A_TEAL3 : A_FAINT }} />
        <span style={{ color: A_MUTED }}>
          {fromBeyanname && <b style={{ color: A_INK }}>Beyannameler modülünden</b>}{fromBeyanname ? ' · ' : ''}{kaynakLabel}
        </span>
      </div>
      {beyannameYok && (
        <div className="-mt-1 flex gap-2 items-start text-[11px] leading-relaxed" style={{ color: A_FAINT }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2, color: STAT_AMBER }} />
          <span>
            <b style={{ color: A_MUTED }}>{oncekiDonem}</b> KDV beyannamesi Beyannameler modülünde bulunamadı; tutar önceki ay verisinden hesaplandı. Beyanname indirilince otomatik oradan gelir.
          </span>
        </div>
      )}

      <div className="mt-4">
        <label className="block text-[11px] font-bold uppercase tracking-[.1em] mb-1.5" style={{ color: A_FAINT }}>Bu dönem devreden tutarı</label>
        <div className="flex items-center gap-2 rounded-[11px] px-3.5 max-w-[260px]" style={{ background: A_BG2, border: `1px solid ${A_LINE2}` }}>
          <span className="font-bold" style={{ color: A_FAINT }}>{TRY}</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="bg-transparent border-none outline-none w-full py-3 tabular-nums"
            style={{ color: A_INK, fontSize: 17, fontWeight: 600 }}
          />
        </div>
      </div>

      <div className="mt-4 flex gap-2.5 flex-wrap">
        <button
          onClick={() => saveMut.mutate({ tutar: parseMoneyInput(value), mode: 'onceki' })}
          disabled={saveMut.isPending}
          className="inline-flex items-center gap-2 text-[13px] font-semibold rounded-[10px] px-3.5 py-2.5 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#14b8a6,#0d9488)', color: '#04201c' }}
        >
          <CheckCircle2 size={14} /> Bu dönem devredenini kaydet
        </button>
        <button
          onClick={() => saveMut.mutate({ tutar: sonraki, mode: 'sonraki' })}
          disabled={saveMut.isPending || sonraki <= 0}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-[10px] px-3.5 py-2.5 border disabled:opacity-40"
          style={{ background: 'transparent', borderColor: A_LINE2, color: A_MUTED }}
        >
          Sonraki aya aktar: <b className="tabular-nums" style={{ color: A_INK }}>{TRY}{fmt(sonraki)}</b>
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
  const hasInvalidSatisRows = cleanSatisRows.length !== (satis.oranlar || []).length;
  const hasInvalidAlisRows = cleanAlisRows.length !== (alis.oranlar || []).length;
  const cleanSatisTotal = sumOranRows(cleanSatisRows);
  const cleanAlisTotal = sumOranRows(cleanAlisRows);
  const displaySatis = hasInvalidSatisRows
    ? {
        ...satis,
        oranlar: cleanSatisRows,
        toplamMatrah: cleanSatisTotal.matrah,
        toplamHesaplananKdv: cleanSatisTotal.kdv,
      }
    : { ...satis, oranlar: cleanSatisRows };
  const displayAlis = hasInvalidAlisRows
    ? {
        ...alis,
        oranlar: cleanAlisRows,
        toplamMatrah: cleanAlisTotal.matrah,
        toplamIndirilecekKdv: cleanAlisTotal.kdv,
        tevkifatsiz: cleanAlisTotal,
        tevkifatli: { matrah: 0, kdv: 0, adet: 0 },
      }
    : { ...alis, oranlar: cleanAlisRows };
  const displaySonuc =
    hasInvalidSatisRows || hasInvalidAlisRows
      ? {
          ...sonuc,
          hesaplananKdv: displaySatis.toplamHesaplananKdv,
          indirilecekKdv: displayAlis.toplamIndirilecekKdv,
          odenecekKdv: Math.max(
            0,
            Math.round((displaySatis.toplamHesaplananKdv - displayAlis.toplamIndirilecekKdv - sonuc.devredenKdv) * 100) / 100,
          ),
          sonrakiAyaDevreden: Math.max(
            0,
            Math.round((displayAlis.toplamIndirilecekKdv + sonuc.devredenKdv - displaySatis.toplamHesaplananKdv) * 100) / 100,
          ),
        }
      : sonuc;

  // Hero'daki "X fatura" gerçek oran kaleminden gelsin (hayalet allDocKeys değil)
  (displaySatis as any).faturaAdet = cleanSatisTotal.adet;
  (displayAlis as any).faturaAdet = cleanAlisTotal.adet;

  return (
    <>
      <KdvWaterfall sonuc={displaySonuc} />

      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-4">
        <DevredenKdvEditor data={data} />
        <KontrolKarti
          guven={data.veriGuveni}
          eksikVeriler={data.eksikVeriler || []}
          uyarilar={[...lucaKontrol.uyarilar, ...kaliteRapor.uyarilar]}
        />
      </div>

      <BeyannameAksiyonlari
        mukellefId={data.mukellefId}
        donem={data.donem}
        tip="KDV1"
        tahakkukTutari={displaySonuc.odenecekKdv}
      />

      {/* Satış & Alış oran tabloları — yan yana */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <OranTablosu
          baslik="Satış · Hesaplanan KDV"
          renk="#5fcf8e"
          oranlar={displaySatis.oranlar}
          toplamMatrah={displaySatis.toplamMatrah}
          toplamKdv={displaySatis.toplamHesaplananKdv}
          adet={cleanSatisTotal.adet}
        />
        <OranTablosu
          baslik="Alış · İndirilecek KDV"
          renk="#7fc8ff"
          oranlar={displayAlis.oranlar}
          toplamMatrah={displayAlis.toplamMatrah}
          toplamKdv={displayAlis.toplamIndirilecekKdv}
          adet={cleanAlisTotal.adet}
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
            <div className="rounded-2xl border p-5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
              <div className="mb-3 flex items-center gap-2">
                <Sparkles size={14} style={{ color: '#14b8a6' }} />
                <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>Luca Çapraz Kontrol</h3>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <LucaCrossCard hesap="391 · Hesaplanan" mihsap={displaySatis.toplamHesaplananKdv} luca={lucaKontrol.luca391Bakiye} fark={lucaKontrol.fark391} />
                <LucaCrossCard hesap="191 · İndirilecek" mihsap={displayAlis.toplamIndirilecekKdv} luca={lucaKontrol.luca191Bakiye} fark={lucaKontrol.fark191} />
                <LucaCrossCard hesap="190 · Devreden" mihsap={null} luca={lucaKontrol.luca190Bakiye} fark={null} />
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
function LucaSnapshotFetchPanel({ mukellefId, donem, autoStart }: { mukellefId: string; donem: string; autoStart?: boolean }) {
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

      {/* KDV-ilgili hesap satırları tablosu */}
      {snap?.exists && snap.kdvSatirlari && snap.kdvSatirlari.length > 0 && (
        <div className="rounded-md overflow-x-auto" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <table className="w-full min-w-[980px] text-[12px]">
            <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
              <tr style={{ color: 'rgba(250,250,249,0.55)' }}>
                <th className="text-left px-3 py-2 font-semibold">Kod</th>
                <th className="text-left px-3 py-2 font-semibold">Hesap</th>
                <th className="text-right px-3 py-2 font-semibold">Borç Hareket</th>
                <th className="text-right px-3 py-2 font-semibold">Alacak Hareket</th>
                <th className="text-right px-3 py-2 font-semibold">Borç Bakiye</th>
                <th className="text-right px-3 py-2 font-semibold">Alacak Bakiye</th>
              </tr>
            </thead>
            <tbody style={{ color: 'rgba(250,250,249,0.85)' }}>
              {snap.kdvSatirlari.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td className="px-3 py-1.5 font-mono" style={{ color: '#14b8a6' }}>{r.kod}</td>
                  <td className="px-3 py-1.5">{r.ad || '—'}</td>
                  <td className="text-right px-3 py-1.5">
                    {r.borcToplami ? <MoneyText value={r.borcToplami} /> : ''}
                  </td>
                  <td className="text-right px-3 py-1.5">
                    {r.alacakToplami ? <MoneyText value={r.alacakToplami} /> : ''}
                  </td>
                  <td className="text-right px-3 py-1.5">
                    {r.borcBakiye ? <MoneyText value={r.borcBakiye} /> : ''}
                  </td>
                  <td className="text-right px-3 py-1.5">
                    {r.alacakBakiye ? <MoneyText value={r.alacakBakiye} /> : ''}
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

function LucaCrossCard({ hesap, mihsap, luca, fark }: { hesap: string; mihsap: number | null; luca: number | null; fark: number | null }) {
  const farkliMi = fark !== null && Math.abs(fark) > 0.01;
  const farkColor = fark == null ? 'rgba(250,250,249,0.4)' : farkliMi ? '#fca5a5' : '#5fcf8e';
  return (
    <div className="rounded-xl border p-3" style={{ background: 'rgba(0,0,0,0.2)', borderColor: farkliMi ? 'rgba(239,107,107,0.3)' : 'rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-bold" style={{ color: '#fafaf9' }}>{hesap}</span>
        {fark == null ? null : farkliMi ? <AlertCircle size={13} style={{ color: '#fca5a5' }} /> : <CheckCircle2 size={13} style={{ color: '#5fcf8e' }} />}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span style={{ color: 'rgba(250,250,249,0.45)' }}>Mihsap</span>
        {mihsap == null ? <span style={{ color: 'rgba(250,250,249,0.38)' }}>—</span> : <MoneyText value={mihsap} size={12} />}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span style={{ color: 'rgba(250,250,249,0.45)' }}>Luca</span>
        {luca == null ? <span style={{ color: 'rgba(250,250,249,0.38)' }}>—</span> : <MoneyText value={luca} size={12} />}
      </div>
      <div className="mt-2 flex items-center justify-between border-t pt-2 text-[11px]" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <span style={{ color: 'rgba(250,250,249,0.55)' }}>Fark</span>
        {fark == null ? <span style={{ color: farkColor }}>—</span> : <MoneyText value={fark} color={farkColor} strong size={12} />}
      </div>
    </div>
  );
}

function OranTablosu({
  baslik, renk, oranlar, toplamMatrah, toplamKdv, adet, altSatir,
}: {
  baslik: string; renk: string; oranlar: OranRow[] | null | undefined;
  toplamMatrah: number; toplamKdv: number; adet: number;
  altSatir?: Array<{ ad: string; v: { matrah: number; kdv: number; adet: number } }>;
}) {
  const safeOranlar = cleanOranRows(oranlar || []);
  const maxKdv = Math.max(1, ...safeOranlar.map((o) => o.kdv));
  return (
    <div
      className="rounded-2xl p-5 border"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: renk, boxShadow: `0 0 8px ${renk}` }} />
          <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>{baslik}</h3>
        </div>
        <span className="rounded-md border px-2 py-1 text-[10.5px] font-bold tabular-nums" style={{ borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.6)' }}>{adet} fatura</span>
      </div>

      {safeOranlar.length === 0 ? (
        <div className="rounded-xl border border-dashed py-8 text-center text-[12.5px]" style={{ borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.4)' }}>
          Bu dönem için kayıt yok
        </div>
      ) : (
        <div className="space-y-2">
          {safeOranlar.map((o) => (
            <div key={o.oran} className="rounded-xl border p-3" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11.5px] font-bold" style={{ background: `${renk}22`, color: renk }}>%{o.oran}</span>
                <div className="flex items-end gap-4">
                  <div className="w-[124px] text-right">
                    <div className="text-[9px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.4)' }}>Matrah</div>
                    <MoneyText value={o.matrah} />
                  </div>
                  <div className="w-[112px] text-right">
                    <div className="text-[9px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.4)' }}>KDV</div>
                    <MoneyText value={o.kdv} color={renk} strong />
                  </div>
                  <span className="w-9 text-right tabular-nums text-[11px]" style={{ color: 'rgba(250,250,249,0.5)' }}>{o.adet}×</span>
                </div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <span className="block h-full rounded-full" style={{ width: `${Math.round((o.kdv / maxKdv) * 100)}%`, background: renk }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.22)' }}>
        <span className="text-[12px] font-extrabold tracking-wide" style={{ color: '#5eead4' }}>TOPLAM</span>
        <div className="flex items-center gap-4">
          <div className="w-[124px] text-right"><MoneyText value={toplamMatrah} color="#5eead4" strong /></div>
          <div className="w-[112px] text-right"><MoneyText value={toplamKdv} color={renk} strong /></div>
          <span className="w-9" />
        </div>
      </div>

      {altSatir && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {altSatir.map((a) => (
            <div key={a.ad} className="rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>{a.ad}</div>
              <div className="mt-0.5 flex items-center justify-between">
                <MoneyText value={a.v.kdv} color="rgba(250,250,249,0.78)" />
                <span className="text-[10.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.4)' }}>{a.v.adet}×</span>
              </div>
            </div>
          ))}
        </div>
      )}
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
