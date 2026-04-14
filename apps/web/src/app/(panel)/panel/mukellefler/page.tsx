'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from 'sonner';

const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const CURRENT_YEAR  = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;

type MonthlyStatus = {
  evraklarGeldi: boolean;
  evraklarIslendi: boolean;
  beyannameVerildi: boolean;
  indirilecekKdvKontrol: boolean;
  hesaplananKdvKontrol: boolean;
  eArsivKontrol: boolean;
};
type Taxpayer = {
  id: string;
  type: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  taxNumber: string;
  evrakTeslimGunu?: number;
  monthlyStatus: MonthlyStatus | null;
};

function StatusCheckbox({ checked, onChange, title }: { checked: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <label className="flex items-center justify-center cursor-pointer group" title={title}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only" />
      <div className={`w-[18px] h-[18px] rounded-[5px] border-[1.5px] flex items-center justify-center transition-all duration-150
        ${checked ? 'border-[var(--gold)] bg-[var(--gold)]' : 'border-gray-300 bg-white group-hover:border-[var(--gold)]/60'}`}>
        {checked && (
          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
            <path d="M1 3.5L3.2 5.5L8 1" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
    </label>
  );
}

// E-Arşiv için farklı renk (mavi)
function EArsivCheckbox({ checked, onChange, title }: { checked: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <label className="flex items-center justify-center cursor-pointer group" title={title}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only" />
      <div className={`w-[18px] h-[18px] rounded-[5px] border-[1.5px] flex items-center justify-center transition-all duration-150
        ${checked ? 'border-blue-500 bg-blue-500' : 'border-gray-300 bg-white group-hover:border-blue-400'}`}>
        {checked && (
          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
            <path d="M1 3.5L3.2 5.5L8 1" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
    </label>
  );
}

export default function MukelleflerPage() {
  const qc = useQueryClient();
  const [search, setSearch]   = useState('');
  const [year, setYear]       = useState(CURRENT_YEAR);
  const [month, setMonth]     = useState(CURRENT_MONTH);
  const [filter, setFilter]   = useState<'all' | 'pending' | 'done'>('all');

  const { data: raw = [], isLoading } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers', search, year, month],
    queryFn: () => api.get('/taxpayers', { params: { search: search || undefined, year, month } }).then(r => r.data),
  });

  const { mutate: updateStatus } = useMutation({
    mutationFn: ({ id, field, value }: { id: string; field: string; value: boolean }) =>
      api.patch(`/taxpayers/${id}/monthly-status`, { year, month, [field]: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taxpayers'] }),
    onError: () => toast.error('Durum güncellenemedi'),
  });
  const handleStatus = useCallback((id: string, field: string, value: boolean) => updateStatus({ id, field, value }), [updateStatus]);

  const name = (t: Taxpayer) => t.companyName || `${(t as any).firstName || ''} ${(t as any).lastName || ''}`.trim() || '-';

  // KDV tamamlandı: her iki KDV alanı da işaretliyse
  const kdvDone     = (t: Taxpayer) => !!(t.monthlyStatus?.indirilecekKdvKontrol && t.monthlyStatus?.hesaplananKdvKontrol);
  // Genel tamamlandı: 4 ana kriter (e-Arşiv hariç)
  const isAllDone   = (t: Taxpayer) => !!(t.monthlyStatus?.evraklarGeldi && t.monthlyStatus?.evraklarIslendi && t.monthlyStatus?.beyannameVerildi && kdvDone(t));
  // İlerleme sayacı: 4 adım (e-Arşiv hariç)
  const doneCount   = (t: Taxpayer) => [
    t.monthlyStatus?.evraklarGeldi,
    t.monthlyStatus?.evraklarIslendi,
    kdvDone(t),
    t.monthlyStatus?.beyannameVerildi,
  ].filter(Boolean).length;

  const taxpayers = raw
    .filter(t => filter === 'done' ? isAllDone(t) : filter === 'pending' ? !isAllDone(t) : true)
    .slice()
    .sort((a, b) => name(a).localeCompare(name(b), 'tr', { sensitivity: 'base' }));
  const total   = raw.length;
  const geldi   = raw.filter(t => t.monthlyStatus?.evraklarGeldi).length;
  const islendi = raw.filter(t => t.monthlyStatus?.evraklarIslendi).length;
  const beyan   = raw.filter(t => t.monthlyStatus?.beyannameVerildi).length;
  const kdv     = raw.filter(t => kdvDone(t)).length;
  const allDone = raw.filter(t => isAllDone(t)).length;
  const pct     = total > 0 ? Math.round((allDone / total) * 100) : 0;

  // Grid: Mükellef | SonGün | EvrakGeldi | EvrakIşlendi | İndKDV | HesKDV | Beyanname | E-Arşiv | İlerleme
  const GRID = '1fr 40px 48px 52px 48px 48px 52px 60px 80px';

  return (
    <div className="min-h-screen" style={{ background: '#f5f6fa' }}>
      <div className="max-w-[1400px] mx-auto p-6 space-y-5">

        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--navy)' }}>Mükellef Takip Paneli</h1>
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
              {MONTHS[month - 1]} {year} · {total} aktif mükellef
            </p>
          </div>
          <Link href="/panel/mukellefler/yeni">
            <button className="btn-primary text-sm px-4 py-2">+ Mükellef Ekle</button>
          </Link>
        </div>

        {/* DASHBOARD — Yaratıcı Görsel Tasarım */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* === BÜYÜK HERO KART: Dönem İlerlemesi (5/12) === */}
          <div
            className="lg:col-span-5 relative overflow-hidden rounded-2xl p-6 group transition-all duration-500 hover:shadow-2xl"
            style={{
              background: 'linear-gradient(135deg, #0f0d0b 0%, #1c1917 50%, #2c2520 100%)',
              minHeight: 200,
              boxShadow: '0 10px 40px -10px rgba(0,0,0,0.3)',
            }}
          >
            {/* Animasyonlu radial arkaplan */}
            <div
              className="absolute inset-0 opacity-60 transition-opacity duration-700 group-hover:opacity-90"
              style={{
                background: `radial-gradient(circle at 20% 20%, rgba(184,160,111,0.25), transparent 45%),
                             radial-gradient(circle at 80% 80%, rgba(184,160,111,0.12), transparent 50%)`,
              }}
            />
            {/* Grid pattern overlay */}
            <div
              className="absolute inset-0 opacity-[0.08]"
              style={{
                backgroundImage: 'linear-gradient(rgba(255,255,255,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px)',
                backgroundSize: '32px 32px',
              }}
            />
            {/* Dekoratif büyük daire */}
            <div
              className="absolute -top-16 -right-16 w-52 h-52 rounded-full opacity-20 transition-transform duration-700 group-hover:scale-110"
              style={{ background: 'radial-gradient(circle, #b8a06f, transparent 65%)' }}
            />

            <div className="relative flex flex-col h-full justify-between" style={{ minHeight: 160 }}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-6 h-px" style={{ background: '#b8a06f' }} />
                    <span className="text-[10px] uppercase font-bold tracking-[0.2em]" style={{ color: '#b8a06f' }}>
                      Dönem
                    </span>
                  </div>
                  <h2
                    className="text-white leading-none mb-2"
                    style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}
                  >
                    {MONTHS[month - 1]}
                  </h2>
                  <p className="text-sm tabular-nums" style={{ color: 'rgba(255,255,255,0.4)' }}>{year}</p>
                </div>

                {/* Sirküler % göstergesi */}
                <div className="relative" style={{ width: 90, height: 90 }}>
                  <svg width="90" height="90" className="-rotate-90">
                    <circle cx="45" cy="45" r="38" strokeWidth="5" stroke="rgba(255,255,255,0.08)" fill="none" />
                    <circle
                      cx="45" cy="45" r="38"
                      strokeWidth="5"
                      stroke="url(#goldGrad)"
                      fill="none"
                      strokeDasharray={2 * Math.PI * 38}
                      strokeDashoffset={2 * Math.PI * 38 * (1 - pct / 100)}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dashoffset 1s ease-out', filter: 'drop-shadow(0 0 6px rgba(184,160,111,0.5))' }}
                    />
                    <defs>
                      <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#d4b876" />
                        <stop offset="100%" stopColor="#8b7649" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span
                      className="text-white leading-none tabular-nums"
                      style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em' }}
                    >
                      {pct}
                    </span>
                    <span className="text-[10px] font-bold" style={{ color: '#b8a06f' }}>%</span>
                  </div>
                </div>
              </div>

              {/* Alt bilgi + ilerleme çubuğu */}
              <div className="mt-5">
                <div className="flex items-baseline justify-between mb-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold tabular-nums" style={{ color: '#fafaf9', fontFamily: 'Fraunces, Georgia, serif' }}>
                      {allDone}
                    </span>
                    <span className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>/</span>
                    <span className="text-base tabular-nums" style={{ color: 'rgba(255,255,255,0.5)' }}>{total}</span>
                    <span className="text-[11px] ml-2" style={{ color: 'rgba(255,255,255,0.4)' }}>mükellef tamamlandı</span>
                  </div>
                </div>
                <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-out"
                    style={{
                      width: `${pct}%`,
                      background: 'linear-gradient(90deg, #d4b876 0%, #b8a06f 50%, #d4b876 100%)',
                      boxShadow: '0 0 10px rgba(184,160,111,0.5)',
                    }}
                  />
                  {/* Shine animation */}
                  <div
                    className="absolute inset-y-0 w-8 pointer-events-none"
                    style={{
                      left: `${Math.max(0, pct - 4)}%`,
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                      transition: 'left 1s ease-out',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* === 4 KPI KUTUSU (7/12) === */}
          <div className="lg:col-span-7 grid grid-cols-2 gap-3">
            {[
              { label: 'Evrak Geldi',    val: geldi,   tot: total, Icon: '📥', color: '#10b981', bg: '#ecfdf5', dark: '#047857' },
              { label: 'Evrak İşlendi', val: islendi,  tot: total, Icon: '⚙️', color: '#0ea5e9', bg: '#f0f9ff', dark: '#0369a1' },
              { label: 'KDV Kontrol',   val: kdv,      tot: total, Icon: '🔍', color: '#f59e0b', bg: '#fffbeb', dark: '#b45309' },
              { label: 'Beyanname',     val: beyan,    tot: total, Icon: '📄', color: '#8b5cf6', bg: '#f5f3ff', dark: '#6d28d9' },
            ].map(({ label, val, tot, Icon, color, bg, dark }, idx) => {
              const p = tot > 0 ? Math.round((val / tot) * 100) : 0;
              return (
                <div
                  key={label}
                  className="relative overflow-hidden rounded-2xl p-4 group transition-all duration-300 hover:-translate-y-1 hover:shadow-lg cursor-pointer"
                  style={{
                    background: '#fff',
                    border: `1px solid ${color}22`,
                  }}
                >
                  {/* Üst renkli çizgi */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1 transition-all duration-300 group-hover:h-1.5"
                    style={{ background: `linear-gradient(90deg, ${color}, ${dark})` }}
                  />
                  {/* Dekoratif kavis */}
                  <div
                    className="absolute -right-8 -bottom-8 w-28 h-28 rounded-full opacity-[0.08] transition-transform duration-500 group-hover:scale-125"
                    style={{ background: color }}
                  />

                  <div className="relative">
                    {/* Üst satır: ikon + % rozet */}
                    <div className="flex items-start justify-between mb-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-transform duration-200 group-hover:scale-110 group-hover:rotate-6"
                        style={{
                          background: `linear-gradient(135deg, ${bg}, #fff)`,
                          border: `1px solid ${color}22`,
                          boxShadow: `0 2px 8px ${color}1a`,
                        }}
                      >
                        {Icon}
                      </div>
                      <div
                        className="px-2 py-0.5 rounded-full flex items-center gap-1"
                        style={{ background: `${color}14` }}
                      >
                        <span className="w-1 h-1 rounded-full" style={{ background: color }} />
                        <span className="text-[10.5px] font-bold tabular-nums" style={{ color: dark }}>%{p}</span>
                      </div>
                    </div>

                    {/* Büyük sayı */}
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span
                        className="tabular-nums leading-none"
                        style={{ fontSize: 28, fontFamily: 'Fraunces, Georgia, serif', fontWeight: 700, color: dark, letterSpacing: '-0.03em' }}
                      >
                        {val}
                      </span>
                      <span className="text-[11px] font-medium" style={{ color: '#94a3b8' }}>
                        / {tot}
                      </span>
                    </div>
                    <p className="text-[11.5px] font-semibold uppercase tracking-wider" style={{ color: '#64748b' }}>
                      {label}
                    </p>

                    {/* Alt ilerleme */}
                    <div className="mt-3 h-[5px] rounded-full overflow-hidden" style={{ background: `${color}12` }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${p}%`,
                          background: `linear-gradient(90deg, ${color}, ${dark})`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* FİLTRE ÇUBUĞU */}
        <div className="flex flex-wrap gap-2.5 items-center">
          <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 px-3 py-2 shadow-sm text-sm"
            style={{ color: 'var(--navy)' }}>
            <select value={month} onChange={e => setMonth(parseInt(e.target.value))}
              className="font-semibold border-none outline-none bg-transparent cursor-pointer text-sm">
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <span className="text-gray-300 px-0.5">/</span>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))}
              className="font-semibold border-none outline-none bg-transparent cursor-pointer text-sm">
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div className="flex bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden text-xs">
            {([['all', 'Tümü'], ['pending', 'Bekleyenler'], ['done', 'Tamamlananlar']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className="px-3.5 py-2 font-medium transition-all duration-150"
                style={{ background: filter === v ? 'var(--accent)' : 'transparent', color: filter === v ? 'white' : 'var(--text-muted)' }}>
                {l}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-[180px] relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input type="text" placeholder="Mükellef ara..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 focus:border-[var(--gold)]/50 transition-all" />
          </div>
        </div>

        {/* TABLO - Yeni Yaratıcı Kurumsal Tasarım */}
        <div className="rounded-2xl overflow-hidden border border-gray-200/80 bg-white" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.03), 0 4px 20px rgba(0,0,0,0.04)' }}>

          {/* Üstte bilgi şeridi */}
          <div className="px-5 py-3 flex items-center justify-between" style={{ background: 'linear-gradient(90deg, #faf8f4 0%, #ffffff 100%)', borderBottom: '1px solid #e6e0d2' }}>
            <div className="flex items-center gap-3">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tabular-nums"
                style={{ background: '#1c1917', color: '#b8a06f', letterSpacing: '0.1em' }}
              >
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#b8a06f' }} />
                {taxpayers.length} kayıt
              </span>
              <span className="text-[11px]" style={{ color: '#78716c' }}>
                Alfabetik sıralı · {MONTHS[month - 1]} {year} dönemi
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10.5px] font-semibold" style={{ color: '#78716c' }}>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: '#10b981' }} /> Tamam</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: '#b8a06f' }} /> Devam</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: '#e5e7eb' }} /> Bekliyor</span>
            </div>
          </div>

          {/* Satırlar */}
          <div className="bg-white">
            {isLoading ? (
              <div className="py-16 flex flex-col items-center gap-3" style={{ color: '#78716c' }}>
                <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid #e6e0d2', borderTopColor: '#b8a06f' }} />
                <span className="text-sm">Yükleniyor...</span>
              </div>
            ) : taxpayers.length === 0 ? (
              <div className="py-20 text-center">
                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ background: '#f4f1ea' }}>
                  <span className="text-2xl">📋</span>
                </div>
                <p className="text-sm font-semibold" style={{ color: '#44403c' }}>Kayıt bulunamadı</p>
                <p className="text-xs mt-1" style={{ color: '#78716c' }}>Dönem seçimini kontrol edin</p>
              </div>
            ) : (
              <>
                {/* Tablo başlığı */}
                <div
                  className="grid items-center px-6 py-3 text-[10px] font-bold uppercase"
                  style={{
                    gridTemplateColumns: '40px 1fr 60px repeat(6, 44px) 90px',
                    gap: 12,
                    background: '#faf8f4',
                    borderBottom: '1px solid #e6e0d2',
                    color: '#78716c',
                    letterSpacing: '0.1em',
                  }}
                >
                  <span></span>
                  <span>Mükellef</span>
                  <span className="text-center">Son Gün</span>
                  <span className="text-center" title="Evrak Geldi">Gel</span>
                  <span className="text-center" title="Evrak İşlendi">İşl</span>
                  <span className="text-center" title="İndirilecek KDV">İnd</span>
                  <span className="text-center" title="Hesaplanan KDV">Hes</span>
                  <span className="text-center" title="Beyanname">Bey</span>
                  <span className="text-center" title="E-Arşiv">Arş</span>
                  <span className="text-right pr-2">İlerleme</span>
                </div>

                {taxpayers.map((t) => {
                  const s    = t.monthlyStatus;
                  const done = isAllDone(t);
                  const cnt  = doneCount(t);
                  const initials = name(t).split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

                  const steps = [
                    { field: 'evraklarGeldi',         done: s?.evraklarGeldi,          label: 'Evrak Geldi' },
                    { field: 'evraklarIslendi',       done: s?.evraklarIslendi,        label: 'Evrak İşlendi' },
                    { field: 'indirilecekKdvKontrol', done: s?.indirilecekKdvKontrol,  label: 'İndirilecek KDV' },
                    { field: 'hesaplananKdvKontrol',  done: s?.hesaplananKdvKontrol,   label: 'Hesaplanan KDV' },
                    { field: 'beyannameVerildi',      done: s?.beyannameVerildi,       label: 'Beyanname' },
                    { field: 'eArsivKontrol',         done: s?.eArsivKontrol,          label: 'E-Arşiv' },
                  ];

                  return (
                    <div
                      key={t.id}
                      className="relative group transition-colors duration-150 hover:bg-[#faf8f4]"
                      style={{ borderBottom: '1px solid #f4f1ea' }}
                    >
                      {/* Ana satır */}
                      <div
                        className="grid items-center px-6 py-4"
                        style={{ gridTemplateColumns: '40px 1fr 60px repeat(6, 44px) 90px', gap: 12 }}
                      >
                        {/* 1) Avatar */}
                        <div className="flex-shrink-0">
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center text-[12px] font-semibold transition-all duration-200"
                            style={{
                              background: done ? '#10b981' : '#1c1917',
                              color: done ? '#fff' : '#b8a06f',
                              fontFamily: 'Fraunces, Georgia, serif',
                              letterSpacing: '-0.01em',
                            }}
                          >
                            {initials}
                          </div>
                        </div>

                        {/* 2) İsim */}
                        <div className="min-w-0">
                          <Link
                            href={`/panel/mukellefler/${t.id}`}
                            className="text-[14px] font-semibold truncate block leading-tight hover:underline"
                            style={{ color: '#1c1917', letterSpacing: '-0.01em' }}
                          >
                            {name(t)}
                          </Link>
                          <p className="text-[11px] mt-1 tabular-nums" style={{ color: '#a8a29e' }}>
                            {t.type === 'TUZEL_KISI' ? 'Tüzel' : 'Gerçek'} · {t.taxNumber}
                          </p>
                        </div>

                        {/* 3) Son Gün */}
                        <div className="flex justify-center">
                          {t.evrakTeslimGunu ? (
                            <span
                              className="text-[13px] font-semibold tabular-nums"
                              style={{ color: '#8b7649', fontFamily: 'Fraunces, Georgia, serif' }}
                            >
                              {String(t.evrakTeslimGunu).padStart(2, '0')}
                            </span>
                          ) : (
                            <span className="text-[13px]" style={{ color: '#e7e5e4' }}>·</span>
                          )}
                        </div>

                        {/* 4) Durum hücreleri (6 adet) */}
                        {steps.map((step) => (
                          <div key={step.field} className="flex justify-center">
                            <button
                              onClick={() => handleStatus(t.id, step.field, !step.done)}
                              title={`${step.label} — ${step.done ? 'Tamamlandı' : 'Tamamla'}`}
                              className="transition-all duration-150 hover:scale-110"
                            >
                              {step.done ? (
                                <div
                                  className="w-6 h-6 rounded-md flex items-center justify-center"
                                  style={{ background: '#1c1917' }}
                                >
                                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                    <path d="M1 4L3.5 6.5L9 1" stroke="#b8a06f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </div>
                              ) : (
                                <div
                                  className="w-6 h-6 rounded-md"
                                  style={{ background: '#faf8f4', border: '1px solid #e6e0d2' }}
                                />
                              )}
                            </button>
                          </div>
                        ))}

                        {/* 5) İlerleme */}
                        <div className="flex items-center justify-end gap-2 pr-2">
                          <div className="relative w-20 h-[6px] rounded-full overflow-hidden" style={{ background: '#f0ebde' }}>
                            <div
                              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                              style={{
                                width: `${(cnt / 4) * 100}%`,
                                background: done ? '#10b981' : '#b8a06f',
                              }}
                            />
                          </div>
                          <span
                            className="text-[11px] tabular-nums font-semibold w-7 text-right"
                            style={{
                              color: done ? '#10b981' : cnt > 0 ? '#8b7649' : '#a8a29e',
                              fontFamily: 'Fraunces, Georgia, serif',
                            }}
                          >
                            {cnt}/4
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Alt bilgi */}
          {!isLoading && taxpayers.length > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between bg-gray-50/80">
              <span className="text-[11px] text-gray-400">{taxpayers.length} kayıt · E-Arşiv sütunu ilerleme sayacına dahil değil</span>
              <span className="text-[11px] text-gray-400">{MONTHS[month - 1]} {year} dönemi</span>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
