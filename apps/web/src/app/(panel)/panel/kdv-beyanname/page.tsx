'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { LucaInlineCaptchaPanel } from '@/components/luca/LucaInlineCaptchaPanel';
import {
  FileCheck, Calendar, Users, Download, AlertCircle, CheckCircle2,
  Loader2, Receipt, TrendingUp, TrendingDown, Sparkles,
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
const FINANCIAL_TOTAL_COLOR = '#5eead4';
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
            <Kdv1View data={kdv1} />
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
        <table className="w-full border-collapse text-left" style={{ minWidth: 920 }}>
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.4)', background: 'rgba(255,255,255,0.02)' }}>
              <th className="px-3 py-2.5">Mükellef</th>
              <th className="px-3 py-2.5">Durum</th>
              <th className="px-3 py-2.5 text-right">Hesaplanan</th>
              <th className="px-3 py-2.5 text-right">İndirilecek</th>
              <th className="px-3 py-2.5 text-right">Devreden</th>
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
                <td className="px-3 py-2.5 text-right tabular-nums text-[12.5px]" style={{ color: 'rgba(250,250,249,0.6)' }}>{TRY}{fmt(r.devredenKdv)}</td>
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
                <td colSpan={9} className="px-3 py-10 text-center text-[13px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
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
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => hazirMut.mutate()}
        disabled={hazirMut.isPending}
        className="px-3 py-2 rounded-[9px] text-[12px] font-semibold inline-flex items-center gap-2 disabled:opacity-50"
        style={{ background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.28)', color: '#14b8a6' }}
      >
        {hazirMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        Hazır notu düş
      </button>
      <button
        onClick={() => verildiMut.mutate()}
        disabled={verildiMut.isPending}
        className="px-3 py-2 rounded-[9px] text-[12px] font-semibold inline-flex items-center gap-2 disabled:opacity-50"
        style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.28)', color: '#86efac' }}
      >
        {verildiMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        Verildi işaretle
      </button>
    </div>
  );
}

function KdvTotalsTable({
  sonuc,
  satis,
  alis,
  devreden,
}: {
  sonuc: Kdv1['sonuc'];
  satis: Kdv1['satis'];
  alis: Kdv1['alis'];
  devreden: Kdv1['devreden'];
}) {
  const odenecek = sonuc.odenecekKdv > 0;
  const resultLabel = odenecek ? 'Ödenecek KDV' : 'Sonraki Aya Devreden';
  const resultValue = odenecek ? sonuc.odenecekKdv : sonuc.sonrakiAyaDevreden;
  const resultColor = odenecek ? '#fca5a5' : '#86efac';
  const devredenDetail = devredenKaynakLabel(devreden);

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: 'rgba(20,184,166,0.05)', borderColor: 'rgba(20,184,166,0.22)' }}
    >
      {/* Sonuç hero */}
      <div className="flex items-end justify-between gap-3 px-5 pt-4 pb-3.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[.16em]" style={{ color: '#5eead4' }}>
            Beyan Sonucu
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-[27px] font-extrabold tabular-nums" style={{ color: resultColor, fontFamily: REPORT_FONT }}>
              {TRY}{fmt(resultValue)}
            </span>
            <span className="text-[12.5px] font-semibold" style={{ color: 'rgba(250,250,249,0.6)' }}>{resultLabel}</span>
          </div>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: odenecek ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', color: resultColor }}>
          {odenecek ? <TrendingUp size={19} /> : <TrendingDown size={19} />}
        </div>
      </div>
      {/* Bileşenler */}
      <div className="grid grid-cols-3 gap-px" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <EqTile label="Hesaplanan KDV" detail={`${satis.faturaAdet} satış faturası`} amount={sonuc.hesaplananKdv} color="#86efac" />
        <EqTile label="İndirilecek KDV" detail={`${alis.faturaAdet} alış faturası`} amount={sonuc.indirilecekKdv} color="#7fc8ff" op="−" />
        <EqTile label="Devreden KDV" detail={devredenDetail} amount={sonuc.devredenKdv} color="#5eead4" op="−" />
      </div>
    </div>
  );
}

function EqTile({ label, detail, amount, color, op }: { label: string; detail: string; amount: number; color: string; op?: string }) {
  return (
    <div className="relative px-4 py-3.5" style={{ background: '#0d1312' }}>
      {op && (
        <span className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[15px] font-bold" style={{ color: 'rgba(250,250,249,0.4)' }}>
          {op}
        </span>
      )}
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>{label}</div>
      <div className="mt-1 text-[15px] font-bold tabular-nums" style={{ color, fontFamily: REPORT_FONT }}>{TRY}{fmt(amount)}</div>
      <div className="mt-0.5 truncate text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>{detail}</div>
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

  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'rgba(20,184,166,0.18)' }}
    >
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[.13em]" style={{ color: '#d8c17f' }}>
          Önceki Dönemden Devreden
        </div>
        <div className="text-[11.5px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
          {kaynakLabel}
        </div>
      </div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full px-3 py-2.5 rounded-[10px] text-right outline-none tabular-nums"
        style={{
          background: 'rgba(0,0,0,0.22)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: FINANCIAL_TOTAL_COLOR,
          fontFamily: REPORT_FONT,
          fontWeight: 750,
        }}
      />
      <div className="grid grid-cols-1 gap-2">
        <button
          onClick={() => saveMut.mutate({ tutar: parseMoneyInput(value), mode: 'onceki' })}
          disabled={saveMut.isPending}
          className="px-3 py-2 rounded-[9px] text-[12px] font-semibold disabled:opacity-50"
          style={{ background: 'rgba(20,184,166,0.14)', border: '1px solid rgba(20,184,166,0.3)', color: '#d8c17f' }}
        >
          Bu dönem devredenini kaydet
        </button>
        <button
          onClick={() => saveMut.mutate({ tutar: sonraki, mode: 'sonraki' })}
          disabled={saveMut.isPending || sonraki <= 0}
          className="px-3 py-2 rounded-[9px] text-[12px] font-semibold disabled:opacity-40"
          style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.24)', color: '#86efac' }}
        >
          Sonraki aya aktar: {TRY}{fmt(sonraki)}
        </button>
      </div>
    </div>
  );
}

function Kdv1View({ data }: { data: Kdv1 }) {
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
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-3">
        <KdvTotalsTable sonuc={displaySonuc} satis={displaySatis} alis={displayAlis} devreden={data.devreden} />
        <DevredenKdvEditor data={data} />
      </div>
      {/* Uyarılar */}
      {(kaliteRapor.uyarilar.length > 0 || lucaKontrol.uyarilar.length > 0) && (
        <div
          className="rounded-2xl p-4 border"
          style={{ background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.25)' }}
        >
          <div className="flex items-start gap-2">
            <AlertCircle size={16} style={{ color: '#fca5a5', flexShrink: 0, marginTop: 2 }} />
            <div className="space-y-1">
              {[...lucaKontrol.uyarilar, ...kaliteRapor.uyarilar].map((u, i) => (
                <p key={i} className="text-[12.5px]" style={{ color: '#fca5a5' }}>{u}</p>
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
        tip="KDV1"
        tahakkukTutari={displaySonuc.odenecekKdv}
      />

      {/* Satış & Alış oran tabloları — yan yana */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
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

      {/* Luca çapraz kontrol — karşılaştırma kartları */}
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
                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <div className="text-[9px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.4)' }}>Matrah</div>
                    <MoneyText value={o.matrah} />
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.4)' }}>KDV</div>
                    <MoneyText value={o.kdv} color={renk} strong />
                  </div>
                  <span className="w-8 text-right tabular-nums text-[11px]" style={{ color: 'rgba(250,250,249,0.5)' }}>{o.adet}×</span>
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
        <div className="flex items-center gap-5">
          <MoneyText value={toplamMatrah} color="#5eead4" strong />
          <MoneyText value={toplamKdv} color={renk} strong />
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
