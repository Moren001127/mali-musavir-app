'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { LucaInlineCaptchaPanel } from '@/components/luca/LucaInlineCaptchaPanel';
import {
  FileCheck, Calendar, Users, Download, AlertCircle, CheckCircle2,
  Loader2, Receipt, TrendingUp, TrendingDown, Sparkles,
} from 'lucide-react';
import TaxpayerSelect from '@/components/ui/TaxpayerSelect';

type Taxpayer = {
  id: string;
  type: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  taxNumber: string;
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
const TRY = '\u20ba';
const REPORT_FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const FINANCIAL_AMOUNT_COLOR = '#fffaf0';
const FINANCIAL_TOTAL_COLOR = '#fff0b8';

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
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div
            className="text-[10.5px] font-bold uppercase tracking-[.14em] mb-1"
            style={{ color: 'rgba(212,184,118,0.7)' }}
          >
            Vergi Uyum · Ön Hazırlık
          </div>
          <h1
            className="font-semibold"
            style={{ fontFamily: 'Fraunces, serif', fontSize: 32, color: '#fafaf9', letterSpacing: '-.03em' }}
          >
            KDV Beyanname Ön Hazırlığı
          </h1>
          <p className="text-[12.5px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Mihsap fatura + Luca mizan hibriti. KDV1 genel beyan + KDV2 tevkifat sorumlusu.
          </p>
        </div>
        <button
          onClick={handleDownload}
          disabled={!selectedMukellef}
          className="px-4 py-2 rounded-[9px] text-[12.5px] font-bold inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          style={{
            background: 'linear-gradient(135deg, #d4b876, #b8a06f)',
            color: '#0f0d0b',
            boxShadow: '0 2px 10px rgba(212,184,118,0.35)',
          }}
        >
          <Download size={14} /> Excel İndir
        </button>
      </div>

      {/* Seçim kartı */}
      <div
        className="rounded-2xl p-5 border"
        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <span className="w-[3px] h-4 rounded-sm" style={{ background: '#d4b876' }} />
          <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>
            Mükellef & Dönem
          </h3>
        </div>

        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 md:col-span-6">
            <label className="text-[11px] font-bold uppercase tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <Users size={11} className="inline mr-1" /> Mükellef
            </label>
            <TaxpayerSelect
              taxpayers={kdvTaxpayers}
              value={selectedMukellef}
              onChange={setSelectedMukellef}
              placeholder="— Mükellef Seçin —"
            />
            {beyanConfigs.length > 0 && (
              <p className="text-[11px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
                {tab} kapsamında {kdvTaxpayers.length} mükellef gösteriliyor; KDV mükellefiyeti olmayanlar gizlendi.
              </p>
            )}
          </div>

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
        </div>
      </div>

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
                  background: active ? 'rgba(184,160,111,0.15)' : 'rgba(255,255,255,0.03)',
                  color: active ? '#d4b876' : 'rgba(250,250,249,0.6)',
                  border: `1px solid ${active ? 'rgba(184,160,111,0.35)' : 'rgba(255,255,255,0.08)'}`,
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
        <div
          className="rounded-2xl p-12 text-center border"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(212,184,118,0.1)' }}>
            <FileCheck size={24} style={{ color: '#d4b876' }} />
          </div>
          <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Başlamak için mükellef seçin</p>
          <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>
            Sistem Mihsap faturaları + Luca mizan + geçmiş beyanlardan ön hazırlık üretir
          </p>
        </div>
      )}
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="rounded-2xl py-16 flex flex-col items-center gap-3 border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
      <Loader2 size={28} className="animate-spin" style={{ color: '#d4b876' }} />
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
        style={{ background: 'rgba(212,184,118,0.1)' }}
      >
        <Receipt size={24} style={{ color: '#d4b876' }} />
      </div>
      <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>
        Dönem <span style={{ color: '#d4b876' }}>{donem}</span> için kayıtlı fatura bulunamadı
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
  const color = guven.seviye === 'kesin' ? '#86efac' : guven.seviye === 'kontrol_gerekli' ? '#fbbf24' : '#fca5a5';
  const label = guven.seviye === 'kesin' ? 'Kesin' : guven.seviye === 'kontrol_gerekli' ? 'Kontrol gerekli' : 'Eksik';
  return (
    <div className="rounded-2xl p-4 border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.5)' }}>
            Veri Güveni
          </div>
          <div className="text-[13px] mt-1" style={{ color: '#fafaf9' }}>
            {guven.kesinFaturaAdet}/{guven.toplamFaturaAdet} fatura kesin, {guven.kontrolGerekliAdet} kayıt kontrol bekliyor
          </div>
        </div>
        <div className="text-right">
          <div className="text-[22px] font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color }}>
            %{guven.puan}
          </div>
          <div className="text-[11px] font-semibold" style={{ color }}>{label}</div>
        </div>
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
        style={{ background: 'rgba(212,184,118,0.12)', border: '1px solid rgba(212,184,118,0.28)', color: '#d4b876' }}
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
  const rows = [
    {
      label: 'Hesaplanan KDV',
      detail: `${satis.faturaAdet} satış faturası`,
      amount: sonuc.hesaplananKdv,
      color: '#86efac',
    },
    {
      label: 'İndirilecek KDV',
      detail: `${alis.faturaAdet} alış faturası`,
      amount: sonuc.indirilecekKdv,
      color: '#93c5fd',
    },
    {
      label: 'Devreden KDV',
      detail: devreden?.kaynak === 'beyan_kaydi' ? `Beyan kaydı · ${devreden?.sonKayitDonem || '—'}` : 'Kayıt yok',
      amount: sonuc.devredenKdv,
      color: '#d8c17f',
    },
    {
      label: resultLabel,
      detail: 'Beyan sonucu',
      amount: resultValue,
      color: odenecek ? '#fca5a5' : '#86efac',
      result: true,
    },
  ];

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'rgba(255,255,255,0.07)' }}
    >
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="text-[12px] font-bold uppercase tracking-[.14em]" style={{ color: '#d8c17f' }}>
          KDV Toplam Özeti
        </div>
        <div className="flex items-center gap-2" style={{ color: rows[3].color }}>
          {odenecek ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
          <MoneyText value={resultValue} color={rows[3].color} strong />
        </div>
      </div>
      <table className="w-full text-left" style={{ fontFamily: REPORT_FONT, fontVariantNumeric: 'tabular-nums', tableLayout: 'fixed' }}>
        <thead style={{ background: 'rgba(0,0,0,0.18)' }}>
          <tr style={{ color: 'rgba(250,250,249,0.52)' }}>
            <th className="px-5 py-2.5 text-[11.5px] font-semibold">Kalem</th>
            <th className="px-4 py-2.5 text-[11.5px] font-semibold">Açıklama</th>
            <th className="px-5 py-2.5 text-[11.5px] font-semibold text-right">Tutar</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              style={{
                background: row.result ? 'rgba(212,184,118,0.07)' : 'transparent',
                borderTop: '1px solid rgba(255,255,255,0.055)',
              }}
            >
              <td className="px-5 py-3 text-[13px] font-semibold" style={{ color: row.result ? FINANCIAL_TOTAL_COLOR : '#fafaf9' }}>
                {row.label}
              </td>
              <td className="px-4 py-3 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.58)' }}>
                {row.detail}
              </td>
              <td className="px-5 py-3 text-right">
                <MoneyText value={row.amount} color={row.color} strong={row.result} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  return (
    <>
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

      {/* Toplam tablosu */}
      <KdvTotalsTable sonuc={sonuc} satis={satis} alis={alis} devreden={data.devreden} />

      <BeyannameAksiyonlari
        mukellefId={data.mukellefId}
        donem={data.donem}
        tip="KDV1"
        tahakkukTutari={sonuc.odenecekKdv}
      />

      {/* Satış oran tablosu */}
      <OranTablosu
        baslik="Satış · Hesaplanan KDV (Oran Bazlı)"
        renk="#4ade80"
        oranlar={satis.oranlar}
        toplamMatrah={satis.toplamMatrah}
        toplamKdv={satis.toplamHesaplananKdv}
        adet={satis.faturaAdet}
      />

      {/* Alış oran tablosu */}
      <OranTablosu
        baslik="Alış · İndirilecek KDV (Oran Bazlı)"
        renk="#60a5fa"
        oranlar={alis.oranlar}
        toplamMatrah={alis.toplamMatrah}
        toplamKdv={alis.toplamIndirilecekKdv}
        adet={alis.faturaAdet}
        altSatir={[
          { ad: 'Tevkifatsız', v: alis.tevkifatsiz },
          { ad: 'Tevkifatlı (KDV2\'ye)', v: alis.tevkifatli },
        ]}
      />

      {/* Luca çapraz kontrol — KDV'ye özel sync ileride aktif olacak */}
      {lucaKontrol.mizanVar && (
        <div
          className="rounded-2xl p-5 border"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={14} style={{ color: '#d4b876' }} />
            <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
              Luca Çapraz Kontrol
            </h3>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ color: 'rgba(250,250,249,0.5)' }}>
                <th className="text-left py-2 font-semibold">Hesap</th>
                <th className="text-right py-2 font-semibold">Mihsap</th>
                <th className="text-right py-2 font-semibold">Luca</th>
                <th className="text-right py-2 font-semibold">Fark</th>
              </tr>
            </thead>
            <tbody style={{ color: '#fafaf9' }}>
              <LucaCrossRow hesap="391 · Hesaplanan KDV" mihsap={satis.toplamHesaplananKdv} luca={lucaKontrol.luca391Bakiye} fark={lucaKontrol.fark391} />
              <LucaCrossRow hesap="191 · İndirilecek KDV" mihsap={alis.toplamIndirilecekKdv} luca={lucaKontrol.luca191Bakiye} fark={lucaKontrol.fark191} />
              <LucaCrossRow hesap="190 · Devreden KDV" mihsap={null} luca={lucaKontrol.luca190Bakiye} fark={null} />
            </tbody>
          </table>
        </div>
      )}
      <LucaSnapshotFetchPanel mukellefId={data.mukellefId} donem={data.donem} />
    </>
  );
}

/**
 * Luca'dan KDV mizan çekme paneli — kdv-beyanname için bağımsız.
 * Mevcut Mizan modülünden BAĞIMSIZ; KdvLucaSnapshot tablosuna yazar.
 */
function LucaSnapshotFetchPanel({ mukellefId, donem }: { mukellefId: string; donem: string }) {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);

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
            <Sparkles size={14} style={{ color: 'rgba(212,184,118,0.8)' }} />
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
          style={{ background: '#d4b876', color: '#0a0906' }}
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
            color="#d4b876"
            onAnswered={() => qc.invalidateQueries({ queryKey: ['kdv-luca-job', jobId] })}
            onCancel={() => cancelJobMut.mutate()}
          />
          {lastLogLine && (
            <div
              className="rounded-md px-3 py-2 text-[11.5px] font-mono"
              style={{
                background: 'rgba(0,0,0,0.35)',
                border: '1px solid rgba(184,160,111,0.2)',
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
                  <td className="px-3 py-1.5 font-mono" style={{ color: '#d4b876' }}>{r.kod}</td>
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

function LucaCrossRow({ hesap, mihsap, luca, fark }: { hesap: string; mihsap: number | null; luca: number | null; fark: number | null }) {
  const farkliMi = fark !== null && Math.abs(fark) > 0.01;
  const farkColor = fark == null ? 'rgba(250,250,249,0.4)' : farkliMi ? '#fca5a5' : '#86efac';
  return (
    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      <td className="py-2">{hesap}</td>
      <td className="text-right">
        {mihsap == null ? <span style={{ color: 'rgba(250,250,249,0.38)' }}>—</span> : <MoneyText value={mihsap} />}
      </td>
      <td className="text-right">
        {luca == null ? <span style={{ color: 'rgba(250,250,249,0.38)' }}>—</span> : <MoneyText value={luca} />}
      </td>
      <td className="text-right">
        {fark == null ? <span style={{ color: farkColor }}>—</span> : <MoneyText value={fark} color={farkColor} strong />}
      </td>
    </tr>
  );
}

function OranTablosu({
  baslik, renk, oranlar, toplamMatrah, toplamKdv, adet, altSatir,
}: {
  baslik: string; renk: string; oranlar: OranRow[] | null | undefined;
  toplamMatrah: number; toplamKdv: number; adet: number;
  altSatir?: Array<{ ad: string; v: { matrah: number; kdv: number; adet: number } }>;
}) {
  const safeOranlar = oranlar || [];
  return (
    <div
      className="rounded-2xl p-5 border"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="w-[3px] h-4 rounded-sm" style={{ background: renk }} />
        <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{baslik}</h3>
      </div>
      <table className="w-full text-[12.5px]" style={{ fontFamily: REPORT_FONT, fontVariantNumeric: 'tabular-nums', tableLayout: 'fixed' }}>
        <thead style={{ background: 'rgba(0,0,0,0.16)' }}>
          <tr style={{ color: 'rgba(250,250,249,0.54)' }}>
            <th className="text-left py-2 px-2 font-semibold">Oran</th>
            <th className="text-right py-2 px-2 font-semibold">Matrah</th>
            <th className="text-right py-2 px-2 font-semibold">KDV</th>
            <th className="text-right py-2 px-2 font-semibold">Adet</th>
          </tr>
        </thead>
        <tbody style={{ color: '#fafaf9' }}>
          {safeOranlar.length === 0 && (
            <tr><td colSpan={4} className="text-center py-4" style={{ color: 'rgba(250,250,249,0.4)' }}>Bu dönem için kayıt yok</td></tr>
          )}
          {safeOranlar.map((o) => (
            <tr key={o.oran} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <td className="py-2.5 px-2 font-semibold">%{o.oran}</td>
              <td className="text-right px-2"><MoneyText value={o.matrah} /></td>
              <td className="text-right px-2"><MoneyText value={o.kdv} color={renk} /></td>
              <td className="text-right px-2 tabular-nums" style={{ color: 'rgba(250,250,249,0.62)', fontWeight: 650 }}>{o.adet}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid rgba(212,184,118,0.28)', background: 'rgba(212,184,118,0.055)' }}>
            <td className="py-2.5 px-2 font-bold" style={{ color: FINANCIAL_TOTAL_COLOR }}>TOPLAM</td>
            <td className="text-right px-2"><MoneyText value={toplamMatrah} color={FINANCIAL_TOTAL_COLOR} strong /></td>
            <td className="text-right px-2"><MoneyText value={toplamKdv} color={renk} strong /></td>
            <td className="text-right px-2 tabular-nums" style={{ color: FINANCIAL_TOTAL_COLOR, fontWeight: 750 }}>{adet}</td>
          </tr>
          {altSatir && altSatir.map((a) => (
            <tr key={a.ad} style={{ color: 'rgba(250,250,249,0.5)' }}>
              <td className="py-1.5 px-2 text-[11.8px] pl-5">└ {a.ad}</td>
              <td className="text-right px-2"><MoneyText value={a.v.matrah} color="rgba(250,250,249,0.64)" /></td>
              <td className="text-right px-2"><MoneyText value={a.v.kdv} color="rgba(250,250,249,0.64)" /></td>
              <td className="text-right px-2 tabular-nums text-[12px]" style={{ fontWeight: 600 }}>{a.v.adet}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
                    <td className="px-4 py-2 tabular-nums" style={{ color: '#d4b876', fontFamily: 'JetBrains Mono, monospace' }}>{t.belgeNo}</td>
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
