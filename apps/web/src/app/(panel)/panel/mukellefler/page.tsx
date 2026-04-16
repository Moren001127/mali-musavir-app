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
    <div className="min-h-screen" style={{ background: '#0a0906' }}>
      <div className="max-w-[1400px] mx-auto p-6 space-y-5">

        {/* HEADER */}
        <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="w-[26px] h-px" style={{ background: '#d4b876' }} />
              <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>TAKIP PANELİ</span>
            </div>
            <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
              Mükellef Takip
            </h1>
            <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
              {MONTHS[month - 1]} {year} · {total} aktif mükellef
            </p>
          </div>
          <Link href="/panel/mukellefler/yeni">
            <button className="text-sm px-5 py-2.5 rounded-[10px] font-bold transition-all" style={{ background: 'linear-gradient(135deg, #d4b876, #b8a06f)', color: '#0f0d0b' }}>+ Mükellef Ekle</button>
          </Link>
        </div>

        {/* DASHBOARD — Kompakt Özet Şerit */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">

          {/* === KOMPAKT HERO: Dönem (4/12) === */}
          <div
            className="lg:col-span-4 relative overflow-hidden rounded-2xl group transition-all duration-300"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            {/* Hafif altın ışıltı */}
            <div
              className="absolute inset-0 opacity-20"
              style={{ background: 'radial-gradient(circle at 10% 20%, rgba(184,160,111,0.2), transparent 50%)' }}
            />

            <div className="relative px-5 py-4 flex items-center gap-4">
              {/* Mini donut */}
              <div className="relative flex-shrink-0" style={{ width: 54, height: 54 }}>
                <svg width="54" height="54" className="-rotate-90">
                  <circle cx="27" cy="27" r="22" strokeWidth="3" stroke="rgba(255,255,255,0.08)" fill="none" />
                  <circle
                    cx="27" cy="27" r="22"
                    strokeWidth="3"
                    stroke="#b8a06f"
                    fill="none"
                    strokeDasharray={2 * Math.PI * 22}
                    strokeDashoffset={2 * Math.PI * 22 * (1 - pct / 100)}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span
                    className="text-white tabular-nums"
                    style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}
                  >
                    %{pct}
                  </span>
                </div>
              </div>

              {/* Metin */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-3 h-px" style={{ background: '#b8a06f' }} />
                  <span className="text-[9.5px] uppercase font-bold tracking-[0.2em]" style={{ color: '#b8a06f' }}>
                    Dönem İlerlemesi
                  </span>
                </div>
                <p className="text-white leading-tight" style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 17, fontWeight: 600 }}>
                  {MONTHS[month - 1]} <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{year}</span>
                </p>
                <p className="text-[11px] mt-0.5 tabular-nums" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {allDone} / {total} tamamlandı
                </p>
              </div>
            </div>
          </div>

          {/* === 4 KOMPAKT KPI (8/12) === */}
          <div className="lg:col-span-8 grid grid-cols-4 gap-3">
            {[
              { label: 'Evrak Geldi',    val: geldi,    tot: total },
              { label: 'İşlendi',         val: islendi,  tot: total },
              { label: 'KDV Kontrol',    val: kdv,       tot: total },
              { label: 'Beyanname',      val: beyan,    tot: total },
            ].map(({ label, val, tot }) => {
              const p = tot > 0 ? Math.round((val / tot) * 100) : 0;
              return (
                <div
                  key={label}
                  className="relative rounded-2xl px-4 py-3 transition-all duration-200 group"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.4)' }}>
                    {label}
                  </p>
                  <div className="flex items-baseline justify-between">
                    <div className="flex items-baseline gap-1">
                      <span
                        className="tabular-nums leading-none"
                        style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 700, color: '#d4b876', letterSpacing: '-0.02em' }}
                      >
                        {val}
                      </span>
                      <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.35)' }}>/ {tot}</span>
                    </div>
                    <span className="text-[10.5px] font-bold tabular-nums" style={{ color: '#d4b876' }}>
                      %{p}
                    </span>
                  </div>
                  <div className="mt-2 h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(212,184,118,0.1)' }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${p}%`, background: '#d4b876' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* FİLTRE ÇUBUĞU */}
        <div className="flex flex-wrap gap-2.5 items-center">
          <div className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}>
            <select value={month} onChange={e => setMonth(parseInt(e.target.value))}
              className="font-semibold border-none outline-none cursor-pointer text-sm" style={{ background: 'transparent', color: '#fafaf9' }}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <span className="px-0.5" style={{ color: 'rgba(250,250,249,0.3)' }}>/</span>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))}
              className="font-semibold border-none outline-none cursor-pointer text-sm" style={{ background: 'transparent', color: '#fafaf9' }}>
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div className="flex rounded-xl overflow-hidden text-xs" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {([['all', 'Tümü'], ['pending', 'Bekleyenler'], ['done', 'Tamamlananlar']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className="px-3.5 py-2 font-medium transition-all duration-150"
                style={{ background: filter === v ? 'rgba(212,184,118,0.15)' : 'transparent', color: filter === v ? '#d4b876' : 'rgba(250,250,249,0.5)' }}>
                {l}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-[180px] relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="rgba(250,250,249,0.4)" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input type="text" placeholder="Mükellef ara..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm rounded-xl outline-none transition-all" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
          </div>
        </div>

        {/* TABLO - Yeni Yaratıcı Kurumsal Tasarım */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>

          {/* Üstte bilgi şeridi */}
          <div className="px-5 py-3 flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.015)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-3">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tabular-nums"
                style={{ background: 'rgba(212,184,118,0.15)', color: '#d4b876', letterSpacing: '0.1em' }}
              >
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#d4b876' }} />
                {taxpayers.length} kayıt
              </span>
              <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                Alfabetik sıralı · {MONTHS[month - 1]} {year} dönemi
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10.5px] font-semibold" style={{ color: 'rgba(250,250,249,0.4)' }}>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: '#22c55e' }} /> Tamam</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: '#d4b876' }} /> Devam</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }} /> Bekliyor</span>
            </div>
          </div>

          {/* Satırlar */}
          <div>
            {isLoading ? (
              <div className="py-16 flex flex-col items-center gap-3" style={{ color: 'rgba(250,250,249,0.4)' }}>
                <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: '#d4b876' }} />
                <span className="text-sm">Yükleniyor...</span>
              </div>
            ) : taxpayers.length === 0 ? (
              <div className="py-20 text-center">
                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <span className="text-2xl">📋</span>
                </div>
                <p className="text-sm font-semibold" style={{ color: '#fafaf9' }}>Kayıt bulunamadı</p>
                <p className="text-xs mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>Dönem seçimini kontrol edin</p>
              </div>
            ) : (
              <>
                {/* Tablo başlığı */}
                <div
                  className="grid items-center px-5 py-2.5 text-[10px] font-semibold uppercase"
                  style={{
                    gridTemplateColumns: '8px 1fr 44px 200px 110px 24px',
                    gap: 16,
                    background: 'rgba(255,255,255,0.015)',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    color: 'rgba(250,250,249,0.4)',
                    letterSpacing: '0.12em',
                  }}
                >
                  <span></span>
                  <span>Mükellef</span>
                  <span className="text-center">Gün</span>
                  <span className="text-center">Durum</span>
                  <span className="text-right">İlerleme</span>
                  <span></span>
                </div>

                {taxpayers.map((t) => {
                  const s    = t.monthlyStatus;
                  const done = isAllDone(t);
                  const cnt  = doneCount(t);
                  const initials = name(t).split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

                  const steps = [
                    { field: 'evraklarGeldi',         done: s?.evraklarGeldi,          label: 'Evrak' },
                    { field: 'evraklarIslendi',       done: s?.evraklarIslendi,        label: 'İşlendi' },
                    { field: 'indirilecekKdvKontrol', done: s?.indirilecekKdvKontrol,  label: 'İnd.KDV' },
                    { field: 'hesaplananKdvKontrol',  done: s?.hesaplananKdvKontrol,   label: 'Hes.KDV' },
                    { field: 'beyannameVerildi',      done: s?.beyannameVerildi,       label: 'Beyanname' },
                    { field: 'eArsivKontrol',         done: s?.eArsivKontrol,          label: 'E-Arşiv' },
                  ];

                  const dotCount = steps.filter(x => x.done).length;

                  return (
                    <div
                      key={t.id}
                      className="relative group transition-all duration-200"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                    >
                      <div
                        className="grid items-center px-5 py-3"
                        style={{ gridTemplateColumns: '8px 1fr 44px 200px 110px 24px', gap: 16 }}
                      >
                        {/* 1) Durum çizgisi (sol) */}
                        <div className="flex justify-center">
                          <span
                            className="w-[3px] h-9 rounded-full transition-all duration-300"
                            style={{
                              background: done
                                ? '#22c55e'
                                : cnt > 0
                                ? '#d4b876'
                                : 'rgba(255,255,255,0.1)',
                            }}
                          />
                        </div>

                        {/* 2) İsim + meta */}
                        <Link
                          href={`/panel/mukellefler/${t.id}`}
                          className="min-w-0 block"
                        >
                          <p
                            className="text-[14.5px] font-semibold truncate leading-tight hover:underline"
                            style={{ color: '#fafaf9', letterSpacing: '-0.01em' }}
                          >
                            {name(t)}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span
                              className="text-[10px] font-bold uppercase"
                              style={{
                                color: t.type === 'TUZEL_KISI' ? '#60a5fa' : '#fbbf24',
                                letterSpacing: '0.08em',
                              }}
                            >
                              {t.type === 'TUZEL_KISI' ? 'Tüzel' : 'Gerçek'}
                            </span>
                            <span style={{ color: 'rgba(250,250,249,0.2)' }}>·</span>
                            <span className="text-[11px] tabular-nums" style={{ color: 'rgba(250,250,249,0.35)' }}>
                              {t.taxNumber}
                            </span>
                          </div>
                        </Link>

                        {/* 3) Gün numarası */}
                        <div className="flex justify-center">
                          {t.evrakTeslimGunu ? (
                            <span
                              className="tabular-nums"
                              style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 600, color: '#d4b876' }}
                            >
                              {String(t.evrakTeslimGunu).padStart(2, '0')}
                            </span>
                          ) : (
                            <span style={{ color: 'rgba(255,255,255,0.1)', fontSize: 16 }}>·</span>
                          )}
                        </div>

                        {/* 4) 6 minik DOT — gazete stili */}
                        <div className="flex items-center justify-center gap-2.5">
                          {steps.map((step) => (
                            <button
                              key={step.field}
                              onClick={() => handleStatus(t.id, step.field, !step.done)}
                              title={`${step.label} — ${step.done ? 'Tamam' : 'Bekliyor'}`}
                              className="relative group/dot transition-transform duration-150 hover:scale-150"
                              style={{ width: 10, height: 10 }}
                            >
                              <span
                                className="block rounded-full transition-all duration-200"
                                style={{
                                  width: 10,
                                  height: 10,
                                  background: step.done ? '#d4b876' : 'transparent',
                                  border: step.done ? '1.5px solid #d4b876' : '1.5px solid rgba(255,255,255,0.2)',
                                }}
                              />
                              {/* Hover label */}
                              <span
                                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-0.5 rounded text-[9px] font-semibold uppercase whitespace-nowrap opacity-0 group-hover/dot:opacity-100 transition-opacity pointer-events-none"
                                style={{ background: 'rgba(212,184,118,0.15)', color: '#d4b876', letterSpacing: '0.08em' }}
                              >
                                {step.label}
                              </span>
                            </button>
                          ))}
                        </div>

                        {/* 5) İlerleme — sayı + mini bar */}
                        <div className="flex items-center justify-end gap-2.5">
                          <div className="flex items-baseline gap-1">
                            <span
                              className="tabular-nums leading-none"
                              style={{
                                fontFamily: 'Fraunces, Georgia, serif',
                                fontSize: 17,
                                fontWeight: 600,
                                color: done ? '#22c55e' : cnt > 0 ? '#d4b876' : 'rgba(250,250,249,0.35)',
                                letterSpacing: '-0.02em',
                              }}
                            >
                              {dotCount}
                            </span>
                            <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.35)' }}>/6</span>
                          </div>
                          <div className="w-14 h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${(dotCount / 6) * 100}%`,
                                background: done ? '#22c55e' : '#d4b876',
                              }}
                            />
                          </div>
                        </div>

                        {/* 6) Ok */}
                        <Link
                          href={`/panel/mukellefler/${t.id}`}
                          className="flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ color: '#d4b876' }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Alt bilgi */}
          {!isLoading && taxpayers.length > 0 && (
            <div className="px-4 py-2.5 border-t flex items-center justify-between" style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)' }}>
              <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.35)' }}>{taxpayers.length} kayıt · E-Arşiv sütunu ilerleme sayacına dahil değil</span>
              <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.35)' }}>{MONTHS[month - 1]} {year} dönemi</span>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
