'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  FolderCheck, Calendar, Search, FileText, Landmark,
  CheckCircle2, AlertTriangle, XCircle, Loader2, ChevronRight,
} from 'lucide-react';

const GOLD = '#d4b876';

type Durum = 'TAM' | 'EKSIK' | 'KRITIK' | 'YOK';

interface MatrixItem {
  taxpayerId: string;
  ad: string;
  taxNumber: string;
  type: string;
  fatura: { count: number; ok: boolean };
  banka: { toplam: number; gelen: number; islenen: number; ok: boolean | null; islendiOk: boolean | null };
  durum: Durum;
}

interface Matrix {
  donem: string;
  total: number;
  tam: number;
  eksik: number;
  kritik: number;
  yok: number;
  items: MatrixItem[];
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const DURUM_RENKLER: Record<Durum, string> = {
  TAM: '#22c55e',
  EKSIK: '#f59e0b',
  KRITIK: '#ef4444',
  YOK: '#94a3b8',
};

const DURUM_LABELS: Record<Durum, string> = {
  TAM: 'Tam',
  EKSIK: 'Eksik',
  KRITIK: 'Hiçbir Şey Gelmedi',
  YOK: 'Beklenmiyor',
};

/**
 * v1.36.77: Belge Takibi sayfası
 * Mükellef × dönem matrix — FATURA ve BANKA EKSTRESI durumunu tek bakışta gösterir.
 * Mevcut Banka Takip sayfasından farkı: Daha basit, sadece "geldi/eksik" özet.
 */
export default function BelgeTakipPage() {
  const now = new Date();
  const [donem, setDonem] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'tumu' | Durum>('tumu');

  const { data, isLoading } = useQuery<Matrix>({
    queryKey: ['belge-takip-matrix', donem],
    queryFn: () => api.get('/taxpayers/belge-takip/matrix', { params: { donem } }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    let items = data?.items || [];
    if (filter !== 'tumu') items = items.filter((i) => i.durum === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((i) =>
        i.ad.toLowerCase().includes(q) || i.taxNumber.includes(q),
      );
    }
    return items;
  }, [data, filter, search]);

  const yIl = donem.split('-')[0];
  const ayNum = parseInt(donem.split('-')[1], 10);
  const ayAdi = AYLAR[ayNum - 1] || '';

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="pb-5 flex items-end justify-between flex-wrap gap-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
              <FolderCheck size={10} className="inline mr-1" /> BELGE TAKİBİ
            </span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
            Belge Takibi
          </h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Hangi mükelleften hangi belge geldi/gelmedi — fatura ve banka ekstresi tek bakışta
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={ayNum}
            onChange={(e) => setDonem(`${yIl}-${String(e.target.value).padStart(2, '0')}`)}
            className="px-3 py-2 rounded-lg text-sm border outline-none cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
          >
            {AYLAR.map((a, i) => <option key={i} value={i + 1} style={{ background: '#0f0d0b' }}>{a}</option>)}
          </select>
          <select
            value={yIl}
            onChange={(e) => setDonem(`${e.target.value}-${String(ayNum).padStart(2, '0')}`)}
            className="px-3 py-2 rounded-lg text-sm border outline-none cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
          >
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
              <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Sayaçlar */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <CountCard label="Toplam" value={data.total} color={GOLD} icon={FolderCheck} />
          <CountCard label="Tam" value={data.tam} color="#22c55e" icon={CheckCircle2} />
          <CountCard label="Eksik" value={data.eksik} color="#f59e0b" icon={AlertTriangle} />
          <CountCard label="Hiçbir Şey" value={data.kritik} color="#ef4444" icon={XCircle} pulse={data.kritik > 0} />
          <CountCard label="Beklenmiyor" value={data.yok} color="#94a3b8" icon={FolderCheck} />
        </div>
      )}

      {/* Filtreler */}
      <div className="rounded-xl p-4 flex flex-wrap items-center gap-3"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex-1 min-w-[200px] flex items-center gap-2">
          <Search size={14} style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mükellef ara..."
            className="flex-1 px-3 py-2 rounded-lg text-sm border outline-none"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
          />
        </div>
        <div className="flex gap-2">
          {(['tumu', 'TAM', 'EKSIK', 'KRITIK', 'YOK'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-2 rounded-md text-[11.5px] font-semibold transition"
              style={{
                background: filter === f ? GOLD : 'rgba(255,255,255,0.04)',
                color: filter === f ? '#0f0d0b' : 'rgba(250,250,249,0.7)',
                border: `1px solid ${filter === f ? GOLD : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              {f === 'tumu' ? 'Tümü' : DURUM_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Matrix */}
      {isLoading ? (
        <div className="text-center py-16" style={{ color: 'rgba(250,250,249,0.4)' }}>
          <Loader2 className="inline animate-spin mr-2" size={16} /> Yükleniyor...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.4)' }}>
          {ayAdi} {yIl} döneminde kayıt veya filtre eşleşmesi yok
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          {/* Header row */}
          <div className="grid items-center px-5 py-3 text-[10.5px] uppercase font-bold tracking-wider"
            style={{
              gridTemplateColumns: '12px 2fr 90px 130px 100px 36px',
              gap: 12,
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              color: 'rgba(250,250,249,0.5)',
            }}>
            <div></div>
            <div>Mükellef</div>
            <div className="text-center">Fatura</div>
            <div className="text-center">Banka Ekstresi</div>
            <div className="text-center">Durum</div>
            <div></div>
          </div>

          {/* Rows */}
          {filtered.map((it) => <MatrixRow key={it.taxpayerId} item={it} />)}
        </div>
      )}
    </div>
  );
}

function CountCard({ label, value, color, icon: Icon, pulse }: any) {
  return (
    <div className="rounded-xl p-4"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex items-center gap-2 mb-2 text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'rgba(250,250,249,0.55)' }}>
        <Icon size={12} style={{ color }} />
        <span>{label}</span>
        {pulse && value > 0 && <span className="w-1.5 h-1.5 rounded-full ml-auto"
          style={{ background: color, boxShadow: `0 0 8px ${color}` }} />}
      </div>
      <p className="leading-none tabular-nums"
        style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 700, color: '#fafaf9' }}>
        {value}
      </p>
    </div>
  );
}

function MatrixRow({ item }: { item: MatrixItem }) {
  const dColor = DURUM_RENKLER[item.durum];
  return (
    <Link
      href={`/panel/mukellefler/${item.taxpayerId}`}
      className="grid items-center px-5 py-3 transition group hover:bg-white/[0.03]"
      style={{
        gridTemplateColumns: '12px 2fr 90px 130px 100px 36px',
        gap: 12,
        borderBottom: '1px solid rgba(255,255,255,0.03)',
      }}>
      <div className="w-1.5 h-6 rounded-sm" style={{ background: dColor }} />
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold truncate" style={{ color: '#fafaf9' }}>{item.ad}</div>
        <div className="text-[11px] mt-0.5 truncate"
          style={{ color: 'rgba(250,250,249,0.4)', fontFamily: 'JetBrains Mono, monospace' }}>
          {item.taxNumber}
        </div>
      </div>
      {/* Fatura */}
      <div className="text-center">
        {item.fatura.count > 0 ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-bold tabular-nums"
            style={{ color: '#22c55e' }}>
            <CheckCircle2 size={12} /> {item.fatura.count}
          </span>
        ) : (
          <span className="text-[12px] font-bold" style={{ color: '#ef4444' }}>
            ✗ yok
          </span>
        )}
      </div>
      {/* Banka */}
      <div className="text-center">
        {item.banka.toplam === 0 ? (
          <span className="text-[12px]" style={{ color: 'rgba(250,250,249,0.4)' }}>—</span>
        ) : (
          <div className="inline-flex flex-col items-center gap-0.5">
            <span className="text-[12px] font-bold tabular-nums"
              style={{ color: item.banka.ok ? '#22c55e' : '#f59e0b' }}>
              {item.banka.gelen}/{item.banka.toplam} geldi
            </span>
            {item.banka.islenen > 0 && (
              <span className="text-[10px] tabular-nums"
                style={{ color: 'rgba(250,250,249,0.5)' }}>
                {item.banka.islenen}/{item.banka.toplam} işlendi
              </span>
            )}
          </div>
        )}
      </div>
      {/* Durum */}
      <div className="text-center">
        <span className="inline-block px-2 py-0.5 rounded text-[10.5px] font-bold uppercase tracking-wider"
          style={{ background: `${dColor}22`, color: dColor }}>
          {DURUM_LABELS[item.durum]}
        </span>
      </div>
      <ChevronRight size={14} className="opacity-30 group-hover:opacity-100 transition justify-self-end"
        style={{ color: GOLD }} />
    </Link>
  );
}
