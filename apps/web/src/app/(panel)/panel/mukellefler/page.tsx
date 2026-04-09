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

  const taxpayers = raw.filter(t => filter === 'done' ? isAllDone(t) : filter === 'pending' ? !isAllDone(t) : true);
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

        {/* DASHBOARD */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Genel İlerleme */}
          <div className="lg:col-span-1 rounded-2xl p-5 flex flex-col justify-between"
            style={{ background: 'linear-gradient(145deg,var(--navy) 0%,#1e3f7a 100%)', minHeight: 140 }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/50 font-semibold">Dönem İlerlemesi</p>
                <p className="text-white font-semibold text-sm mt-0.5">{MONTHS[month - 1]} {year}</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-black text-white leading-none">%{pct}</p>
                <p className="text-[10px] text-white/40 mt-0.5">{allDone}/{total} tamamlandı</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${pct}%`, background: 'linear-gradient(90deg,var(--gold),#f0c040)' }} />
              </div>
              <div className="flex justify-between mt-1.5 text-[9px] text-white/30">
                <span>0%</span><span>50%</span><span>100%</span>
              </div>
            </div>
          </div>

          {/* KPI — 4 kutu (E-Arşiv hariç) */}
          <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Evrak Geldi',    val: geldi,   tot: total, icon: '📥', c: '#16a34a', t: '#f0fdf4' },
              { label: 'Evrak İşlendi', val: islendi,  tot: total, icon: '⚙️', c: '#0369a1', t: '#f0f9ff' },
              { label: 'KDV Kontrol',   val: kdv,      tot: total, icon: '🔍', c: '#b45309', t: '#fffbeb' },
              { label: 'Beyanname',     val: beyan,    tot: total, icon: '📄', c: '#7c3aed', t: '#faf5ff' },
            ].map(({ label, val, tot, icon, c, t }) => {
              const p = tot > 0 ? Math.round((val / tot) * 100) : 0;
              return (
                <div key={label} className="rounded-xl p-3.5 flex flex-col gap-2" style={{ background: t, border: `1px solid ${c}1a` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-base">{icon}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: `${c}15`, color: c }}>%{p}</span>
                  </div>
                  <div>
                    <p className="text-xl font-black leading-none" style={{ color: c }}>{val}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5 font-medium">{label}</p>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: `${c}18` }}>
                    <div className="h-full rounded-full" style={{ width: `${p}%`, background: c }} />
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
                style={{ background: filter === v ? 'var(--navy)' : 'transparent', color: filter === v ? 'white' : '#9ca3af' }}>
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

        {/* TABLO */}
        <div className="rounded-2xl overflow-hidden border border-gray-200/80 shadow-sm">

          {/* Başlık */}
          <div className="grid items-center px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-white/70"
            style={{ background: 'linear-gradient(135deg,var(--navy),#1e3f7a)', gridTemplateColumns: GRID }}>
            <span>Mükellef</span>
            <span className="text-center">Son<br/>Gün</span>
            <span className="text-center">Evrak<br/>Geldi</span>
            <span className="text-center">Evrak<br/>İşlendi</span>
            <span className="text-center" title="İndirilecek KDV Kontrolü (191)">İnd.<br/>KDV</span>
            <span className="text-center" title="Hesaplanan KDV Kontrolü (391)">Hes.<br/>KDV</span>
            <span className="text-center">Beyan<br/>name</span>
            <span className="text-center">E-Arşiv<br/>Kontrol</span>
            <span className="text-center">İlerleme</span>
          </div>

          {/* Satırlar */}
          <div className="divide-y divide-gray-100 bg-white">
            {isLoading ? (
              <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
                <div className="w-7 h-7 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Yükleniyor...</span>
              </div>
            ) : taxpayers.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-3xl mb-2">📋</p>
                <p className="text-sm font-medium text-gray-500">Kayıt bulunamadı</p>
                <p className="text-xs text-gray-400 mt-1">Dönem seçimini kontrol edin</p>
              </div>
            ) : taxpayers.map((t) => {
              const s    = t.monthlyStatus;
              const done = isAllDone(t);
              const cnt  = doneCount(t);
              const kDone = kdvDone(t);
              const initials = name(t).split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

              return (
                <div key={t.id}
                  className="grid items-center px-4 py-2.5 group hover:bg-slate-50/80 transition-colors duration-100"
                  style={{ gridTemplateColumns: GRID, background: done ? 'linear-gradient(90deg,#f0fdf408,transparent)' : undefined }}>

                  {/* Mükellef adı + edit ikonu */}
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                      style={{ background: done ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'linear-gradient(135deg,var(--navy),#2a4ea0)' }}>
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link href={`/panel/mukellefler/${t.id}`}
                        className="text-sm font-semibold truncate block hover:underline leading-tight"
                        style={{ color: 'var(--navy)' }}>
                        {name(t)}
                      </Link>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-[4px] inline-block mt-0.5"
                        style={{ background: t.type === 'TUZEL_KISI' ? '#eff6ff' : '#fefce8', color: t.type === 'TUZEL_KISI' ? '#3b82f6' : '#ca8a04' }}>
                        {t.type === 'TUZEL_KISI' ? 'Tüzel' : 'Gerçek'}
                      </span>
                    </div>
                    <Link
                      href={`/panel/mukellefler/${t.id}`}
                      tabIndex={-1}
                      aria-hidden="true"
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <span className="text-[11px] px-2 py-1 rounded-md font-medium"
                        style={{ background: 'var(--navy)', color: 'white' }}>✎</span>
                    </Link>
                  </div>

                  {/* Son gün */}
                  <div className="flex items-center justify-center">
                    {t.evrakTeslimGunu
                      ? <span className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center"
                          style={{ background: 'rgba(200,168,75,0.12)', color: 'var(--gold)' }}>{t.evrakTeslimGunu}</span>
                      : <span className="text-gray-200 text-base">—</span>}
                  </div>

                  {/* Checkboxlar */}
                  <div className="flex justify-center">
                    <StatusCheckbox checked={s?.evraklarGeldi ?? false}   onChange={v => handleStatus(t.id, 'evraklarGeldi', v)}   title="Evraklar Geldi" />
                  </div>
                  <div className="flex justify-center">
                    <StatusCheckbox checked={s?.evraklarIslendi ?? false} onChange={v => handleStatus(t.id, 'evraklarIslendi', v)} title="Evraklar İşlendi" />
                  </div>
                  <div className="flex justify-center">
                    <StatusCheckbox checked={s?.indirilecekKdvKontrol ?? false} onChange={v => handleStatus(t.id, 'indirilecekKdvKontrol', v)} title="İndirilecek KDV Kontrolü (191)" />
                  </div>
                  <div className="flex justify-center">
                    <StatusCheckbox checked={s?.hesaplananKdvKontrol ?? false} onChange={v => handleStatus(t.id, 'hesaplananKdvKontrol', v)} title="Hesaplanan KDV Kontrolü (391)" />
                  </div>
                  <div className="flex justify-center">
                    <StatusCheckbox checked={s?.beyannameVerildi ?? false} onChange={v => handleStatus(t.id, 'beyannameVerildi', v)} title="Beyanname Verildi" />
                  </div>
                  {/* E-Arşiv — mavi checkbox, sayaca dahil değil */}
                  <div className="flex justify-center">
                    <EArsivCheckbox checked={s?.eArsivKontrol ?? false} onChange={v => handleStatus(t.id, 'eArsivKontrol', v)} title="Gelen E-Arşiv Kontrol" />
                  </div>

                  {/* İlerleme (4 adım, e-Arşiv hariç) */}
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex gap-[3px]">
                      {[0, 1, 2, 3].map(n => (
                        <div key={n} className="w-3.5 h-1 rounded-full transition-all duration-300"
                          style={{ background: n < cnt ? (done ? '#16a34a' : kDone && n === 2 ? '#b45309' : 'var(--gold)') : '#e5e7eb' }} />
                      ))}
                    </div>
                    <span className="text-[10px] font-semibold" style={{ color: done ? '#16a34a' : cnt > 0 ? 'var(--navy)' : '#d1d5db' }}>
                      {done ? '✓ Tamam' : `${cnt}/4`}
                    </span>
                  </div>
                </div>
              );
            })}
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
