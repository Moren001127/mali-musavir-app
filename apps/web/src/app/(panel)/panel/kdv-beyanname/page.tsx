'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
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

type OranRow = { oran: number; matrah: number; kdv: number; adet: number };

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
};

type Kdv2 = {
  mukellefId: string;
  mukellefAd: string;
  donem: string;
  tevkifatli: Array<{
    belgeNo: string; satici: string; saticiVkn: string; tarih: string;
    matrah: number; hesaplananKdv: number; tevkifatOrani: string; tevkifatTutari: number;
  }>;
  toplamlar: {
    faturaAdet: number; toplamMatrah: number; toplamHesaplananKdv: number; toplamTevkifat: number;
  };
  tevkifatKodlari: Array<{ kod: string; matrah: number; tevkifat: number; adet: number }>;
  uyarilar: string[];
};

const MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12'];
const MONTH_NAMES = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

const fmt = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  const taxpayerName = (t: Taxpayer) =>
    t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.taxNumber;

  const { data: kdv1, isLoading: kdv1Loading } = useQuery<Kdv1>({
    queryKey: ['kdv-beyanname-kdv1', selectedMukellef, donem],
    queryFn: () =>
      api
        .get('/kdv-beyanname/on-hazirlik/kdv1', {
          params: { mukellefId: selectedMukellef, donem },
        })
        .then((r) => r.data),
    enabled: !!selectedMukellef && tab === 'KDV1',
  });

  const { data: kdv2, isLoading: kdv2Loading } = useQuery<Kdv2>({
    queryKey: ['kdv-beyanname-kdv2', selectedMukellef, donem],
    queryFn: () =>
      api
        .get('/kdv-beyanname/on-hazirlik/kdv2', {
          params: { mukellefId: selectedMukellef, donem },
        })
        .then((r) => r.data),
    enabled: !!selectedMukellef && tab === 'KDV2',
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
              taxpayers={taxpayers}
              value={selectedMukellef}
              onChange={setSelectedMukellef}
              placeholder="— Mükellef Seçin —"
            />
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
          {kdv1 && <Kdv1View data={kdv1} />}
        </div>
      )}

      {/* KDV2 içerik */}
      {selectedMukellef && tab === 'KDV2' && (
        <div className="space-y-4">
          {kdv2Loading && <LoadingCard />}
          {kdv2 && <Kdv2View data={kdv2} />}
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

function Kdv1View({ data }: { data: Kdv1 }) {
  const odenecek = data.sonuc.odenecekKdv > 0;
  return (
    <>
      {/* Uyarılar */}
      {(data.kaliteRapor.uyarilar.length > 0 || data.lucaKontrol.uyarilar.length > 0) && (
        <div
          className="rounded-2xl p-4 border"
          style={{ background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.25)' }}
        >
          <div className="flex items-start gap-2">
            <AlertCircle size={16} style={{ color: '#fca5a5', flexShrink: 0, marginTop: 2 }} />
            <div className="space-y-1">
              {[...data.lucaKontrol.uyarilar, ...data.kaliteRapor.uyarilar].map((u, i) => (
                <p key={i} className="text-[12.5px]" style={{ color: '#fca5a5' }}>{u}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sonuç kartı — en üstte büyük */}
      <div
        className="rounded-2xl p-6 border"
        style={{
          background: odenecek
            ? 'linear-gradient(135deg, rgba(239,68,68,0.1), rgba(156,70,86,0.08))'
            : 'linear-gradient(135deg, rgba(34,197,94,0.1), rgba(74,222,128,0.08))',
          borderColor: odenecek ? 'rgba(239,68,68,0.25)' : 'rgba(74,222,128,0.25)',
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[.12em] mb-1" style={{ color: 'rgba(250,250,249,0.55)' }}>
              {odenecek ? 'Ödenecek KDV' : 'Sonraki Aya Devreden KDV'}
            </div>
            <div
              className="font-bold tabular-nums"
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 36,
                color: odenecek ? '#fca5a5' : '#86efac',
              }}
            >
              ₺{fmt(odenecek ? data.sonuc.odenecekKdv : data.sonuc.sonrakiAyaDevreden)}
            </div>
          </div>
          {odenecek ? <TrendingUp size={40} style={{ color: '#fca5a5' }} /> : <TrendingDown size={40} style={{ color: '#86efac' }} />}
        </div>
      </div>

      {/* 3 özet kart */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryCard label="Hesaplanan KDV" value={data.sonuc.hesaplananKdv} color="#4ade80" subtitle={`${data.satis.faturaAdet} satış faturası`} />
        <SummaryCard label="İndirilecek KDV" value={data.sonuc.indirilecekKdv} color="#60a5fa" subtitle={`${data.alis.faturaAdet} alış faturası`} />
        <SummaryCard
          label="Devreden KDV"
          value={data.sonuc.devredenKdv}
          color="#d4b876"
          subtitle={
            data.devreden.kaynak === 'beyan_kaydi'
              ? `Beyan Kaydı · ${data.devreden.sonKayitDonem}`
              : data.devreden.kaynak === 'luca_mizan'
                ? 'Luca Mizan'
                : 'Kayıt yok'
          }
        />
      </div>

      {/* Satış oran tablosu */}
      <OranTablosu
        baslik="Satış · Hesaplanan KDV (Oran Bazlı)"
        renk="#4ade80"
        oranlar={data.satis.oranlar}
        toplamMatrah={data.satis.toplamMatrah}
        toplamKdv={data.satis.toplamHesaplananKdv}
        adet={data.satis.faturaAdet}
      />

      {/* Alış oran tablosu */}
      <OranTablosu
        baslik="Alış · İndirilecek KDV (Oran Bazlı)"
        renk="#60a5fa"
        oranlar={data.alis.oranlar}
        toplamMatrah={data.alis.toplamMatrah}
        toplamKdv={data.alis.toplamIndirilecekKdv}
        adet={data.alis.faturaAdet}
        altSatir={[
          { ad: 'Tevkifatsız', v: data.alis.tevkifatsiz },
          { ad: 'Tevkifatlı (KDV2\'ye)', v: data.alis.tevkifatli },
        ]}
      />

      {/* Luca çapraz kontrol */}
      {data.lucaKontrol.mizanVar && (
        <div
          className="rounded-2xl p-5 border"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={14} style={{ color: '#d4b876' }} />
            <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
              Luca Mizan Çapraz Kontrol
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
              <LucaCrossRow hesap="391 · Hesaplanan KDV" mihsap={data.satis.toplamHesaplananKdv} luca={data.lucaKontrol.luca391Bakiye} fark={data.lucaKontrol.fark391} />
              <LucaCrossRow hesap="191 · İndirilecek KDV" mihsap={data.alis.toplamIndirilecekKdv} luca={data.lucaKontrol.luca191Bakiye} fark={data.lucaKontrol.fark191} />
              <LucaCrossRow hesap="190 · Devreden KDV" mihsap={null} luca={data.lucaKontrol.luca190Bakiye} fark={null} />
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function LucaCrossRow({ hesap, mihsap, luca, fark }: { hesap: string; mihsap: number | null; luca: number | null; fark: number | null }) {
  const farkliMi = fark !== null && Math.abs(fark) > 0.01;
  return (
    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      <td className="py-2">{hesap}</td>
      <td className="text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        {mihsap == null ? '—' : `₺${fmt(mihsap)}`}
      </td>
      <td className="text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        {luca == null ? '—' : `₺${fmt(luca)}`}
      </td>
      <td
        className="text-right tabular-nums font-semibold"
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          color: fark == null ? 'rgba(250,250,249,0.4)' : farkliMi ? '#fca5a5' : '#86efac',
        }}
      >
        {fark == null ? '—' : `₺${fmt(fark)}`}
      </td>
    </tr>
  );
}

function OranTablosu({
  baslik, renk, oranlar, toplamMatrah, toplamKdv, adet, altSatir,
}: {
  baslik: string; renk: string; oranlar: OranRow[];
  toplamMatrah: number; toplamKdv: number; adet: number;
  altSatir?: Array<{ ad: string; v: { matrah: number; kdv: number; adet: number } }>;
}) {
  return (
    <div
      className="rounded-2xl p-5 border"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="w-[3px] h-4 rounded-sm" style={{ background: renk }} />
        <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{baslik}</h3>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{ color: 'rgba(250,250,249,0.5)' }}>
            <th className="text-left py-2 font-semibold">Oran</th>
            <th className="text-right py-2 font-semibold">Matrah</th>
            <th className="text-right py-2 font-semibold">KDV</th>
            <th className="text-right py-2 font-semibold">Adet</th>
          </tr>
        </thead>
        <tbody style={{ color: '#fafaf9' }}>
          {oranlar.length === 0 && (
            <tr><td colSpan={4} className="text-center py-4" style={{ color: 'rgba(250,250,249,0.4)' }}>Bu dönem için kayıt yok</td></tr>
          )}
          {oranlar.map((o) => (
            <tr key={o.oran} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <td className="py-2 font-semibold">%{o.oran}</td>
              <td className="text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace' }}>₺{fmt(o.matrah)}</td>
              <td className="text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: renk }}>₺{fmt(o.kdv)}</td>
              <td className="text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.5)' }}>{o.adet}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid rgba(255,255,255,0.1)', fontWeight: 700 }}>
            <td className="py-2">TOPLAM</td>
            <td className="text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace' }}>₺{fmt(toplamMatrah)}</td>
            <td className="text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: renk }}>₺{fmt(toplamKdv)}</td>
            <td className="text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{adet}</td>
          </tr>
          {altSatir && altSatir.map((a) => (
            <tr key={a.ad} style={{ color: 'rgba(250,250,249,0.5)' }}>
              <td className="py-1 text-[11.5px] pl-3">└ {a.ad}</td>
              <td className="text-right tabular-nums text-[11.5px]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>₺{fmt(a.v.matrah)}</td>
              <td className="text-right tabular-nums text-[11.5px]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>₺{fmt(a.v.kdv)}</td>
              <td className="text-right tabular-nums text-[11.5px]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{a.v.adet}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCard({ label, value, color, subtitle }: { label: string; value: number; color: string; subtitle: string }) {
  return (
    <div
      className="rounded-2xl p-4 border"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <div className="text-[10.5px] font-bold uppercase tracking-[.12em] mb-2" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</div>
      <div className="text-[22px] font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color }}>
        ₺{fmt(value)}
      </div>
      <div className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.4)' }}>{subtitle}</div>
    </div>
  );
}

function Kdv2View({ data }: { data: Kdv2 }) {
  return (
    <>
      {data.uyarilar.length > 0 && (
        <div
          className="rounded-2xl p-4 border"
          style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)' }}
        >
          <div className="flex items-start gap-2">
            <AlertCircle size={16} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 2 }} />
            <div className="space-y-1">
              {data.uyarilar.map((u, i) => (
                <p key={i} className="text-[12.5px]" style={{ color: '#fde68a' }}>{u}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Toplam kart */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard label="Tevkifatlı Fatura" value={data.toplamlar.faturaAdet} color="#c9a77c" subtitle="adet" />
        <SummaryCard label="Toplam Matrah" value={data.toplamlar.toplamMatrah} color="#60a5fa" subtitle="—" />
        <SummaryCard label="Hesaplanan KDV" value={data.toplamlar.toplamHesaplananKdv} color="#4ade80" subtitle="—" />
        <SummaryCard label="Tevkifat Tutarı" value={data.toplamlar.toplamTevkifat} color="#fca5a5" subtitle="beyan edilecek" />
      </div>

      {/* Detay satır tablosu */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
      >
        <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <h3 className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>Tevkifat Detayı</h3>
        </div>
        {data.tevkifatli.length === 0 ? (
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
                  <th className="text-center px-4 py-2">Oran</th>
                  <th className="text-right px-4 py-2">Tevkifat</th>
                </tr>
              </thead>
              <tbody style={{ color: '#fafaf9' }}>
                {data.tevkifatli.map((t, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                    <td className="px-4 py-2 tabular-nums" style={{ color: '#d4b876', fontFamily: 'JetBrains Mono, monospace' }}>{t.belgeNo}</td>
                    <td className="px-4 py-2 truncate max-w-[220px]">{t.satici}</td>
                    <td className="px-4 py-2 tabular-nums" style={{ color: 'rgba(250,250,249,0.55)' }}>{t.tarih}</td>
                    <td className="px-4 py-2 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace' }}>₺{fmt(t.matrah)}</td>
                    <td className="px-4 py-2 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace' }}>₺{fmt(t.hesaplananKdv)}</td>
                    <td className="px-4 py-2 text-center font-semibold" style={{ color: '#c9a77c' }}>{t.tevkifatOrani}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#fca5a5' }}>₺{fmt(t.tevkifatTutari)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Oran bazlı özet */}
      {data.tevkifatKodlari.length > 0 && (
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
                  <td className="text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace' }}>₺{fmt(k.matrah)}</td>
                  <td className="text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: '#fca5a5' }}>₺{fmt(k.tevkifat)}</td>
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
