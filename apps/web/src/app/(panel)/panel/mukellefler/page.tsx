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
  evraklarGeldi: boolean; evraklarIslendi: boolean;
  beyannameVerildi: boolean; kdvKontrolEdildi: boolean;
};
type Taxpayer = {
  id: string; type: string;
  firstName?: string; lastName?: string; companyName?: string;
  taxNumber: string; evrakTeslimGunu?: number;
  monthlyStatus: MonthlyStatus | null;
};

/* ─── İstatistik Kartı ────────────────────────────────── */
function KPICard({
  icon, label, value, total, color, bg,
}: { icon: string; label: string; value: number; total: number; color: string; bg: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const remaining = total - value;
  return (
    <div className="flex-1 min-w-[180px] rounded-2xl p-5 flex flex-col gap-3"
      style={{ background: bg, border: `1px solid ${color}22` }}>
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ background: `${color}18`, color }}>
          %{pct}
        </span>
      </div>
      <div>
        <p className="text-3xl font-black" style={{ color }}>{value}</p>
        <p className="text-xs font-medium text-gray-500 mt-0.5">{label}</p>
      </div>
      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-2 rounded-full bg-white/60 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}99, ${color})` }} />
        </div>
        <p className="text-xs text-gray-400">{remaining > 0 ? `${remaining} bekliyor` : 'Tümü tamamlandı'}</p>
      </div>
    </div>
  );
}

/* ─── Durum Rozeti ────────────────────────────────────── */
function StatusBadge({ done, label }: { done: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        background: done ? '#dcfce7' : '#f1f5f9',
        color: done ? '#16a34a' : '#94a3b8',
      }}>
      {done ? '✓' : '○'} {label}
    </span>
  );
}

/* ─── Checkbox ────────────────────────────────────────── */
function StatusCheckbox({ checked, onChange, title }: { checked: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <label className="flex items-center justify-center cursor-pointer group" title={title}>
      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all
        ${checked
          ? 'border-[var(--gold)] bg-[var(--gold)]'
          : 'border-gray-200 bg-white group-hover:border-[var(--gold)]'}`}>
        {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>}
      </div>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only" />
    </label>
  );
}

export default function MukelleflerPage() {
  const qc = useQueryClient();
  const [search, setSearch]   = useState('');
  const [year, setYear]       = useState(CURRENT_YEAR);
  const [month, setMonth]     = useState(CURRENT_MONTH);
  const [filter, setFilter]   = useState<'all'|'pending'|'done'>('all');

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

  const getAdUnvan = (t: Taxpayer) => t.companyName || `${(t as any).firstName||''} ${(t as any).lastName||''}`.trim() || '-';
  const isAllDone = (t: Taxpayer) => !!(t.monthlyStatus?.evraklarGeldi && t.monthlyStatus?.evraklarIslendi && t.monthlyStatus?.beyannameVerildi && t.monthlyStatus?.kdvKontrolEdildi);

  const taxpayers = raw.filter(t =>
    filter === 'done'    ? isAllDone(t) :
    filter === 'pending' ? !isAllDone(t) :
    true
  );

  const total    = raw.length;
  const geldi    = raw.filter(t => t.monthlyStatus?.evraklarGeldi).length;
  const islendi  = raw.filter(t => t.monthlyStatus?.evraklarIslendi).length;
  const beyan    = raw.filter(t => t.monthlyStatus?.beyannameVerildi).length;
  const kdv      = raw.filter(t => t.monthlyStatus?.kdvKontrolEdildi).length;
  const done     = raw.filter(t => isAllDone(t)).length;
  const overall  = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="p-6 space-y-6">

      {/* ── Başlık ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight" style={{ color: 'var(--navy)' }}>
            Mükellef Takip Paneli
          </h1>
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 inline-block animate-pulse"></span>
            {MONTHS[month-1]} {year} dönemi · {total} aktif mükellef
          </p>
        </div>
        <Link href="/panel/mukellefler/yeni">
          <button className="btn-primary text-sm flex items-center gap-2">
            <span className="text-lg leading-none">+</span> Mükellef Ekle
          </button>
        </Link>
      </div>

      {/* ── Genel İlerleme ─────────────────────────────────── */}
      <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, var(--navy) 0%, #1e4080 100%)' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-white/70 text-xs font-medium uppercase tracking-wider">Genel İlerleme</p>
            <p className="text-white text-lg font-bold mt-0.5">{MONTHS[month-1]} {year} Dönem Tamamlanma Oranı</p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-black text-white">%{overall}</p>
            <p className="text-white/60 text-xs">{done} / {total} tamamlandı</p>
          </div>
        </div>
        <div className="h-3 rounded-full bg-white/20 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${overall}%`, background: 'linear-gradient(90deg, var(--gold), #f5d020)' }} />
        </div>
        <div className="flex justify-between mt-2 text-xs text-white/50">
          <span>0%</span><span>50%</span><span>100%</span>
        </div>
      </div>

      {/* ── KPI Kartlar ─────────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap">
        <KPICard icon="📥" label="Evrak Geldi"    value={geldi}   total={total} color="#16a34a" bg="linear-gradient(135deg,#f0fdf4,#dcfce7)" />
        <KPICard icon="⚙️" label="Evrak İşlendi"  value={islendi} total={total} color="#0369a1" bg="linear-gradient(135deg,#f0f9ff,#e0f2fe)" />
        <KPICard icon="🔍" label="KDV Kontrol"    value={kdv}     total={total} color="#b45309" bg="linear-gradient(135deg,#fffbeb,#fef3c7)" />
        <KPICard icon="📄" label="Beyanname"      value={beyan}   total={total} color="#7c3aed" bg="linear-gradient(135deg,#faf5ff,#ede9fe)" />
      </div>

      {/* ── Filtre + Arama ──────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Dönem */}
        <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 px-3 py-1.5 shadow-sm">
          <select value={month} onChange={e => setMonth(parseInt(e.target.value))}
            className="text-sm font-medium border-none outline-none bg-transparent cursor-pointer" style={{ color: 'var(--navy)' }}>
            {MONTHS.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
          <span className="text-gray-300">|</span>
          <select value={year} onChange={e => setYear(parseInt(e.target.value))}
            className="text-sm font-medium border-none outline-none bg-transparent cursor-pointer" style={{ color: 'var(--navy)' }}>
            {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* Durum filtresi */}
        <div className="flex bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {[['all','Tümü'],['pending','Bekleyenler'],['done','Tamamlananlar']].map(([v,l]) => (
            <button key={v} onClick={() => setFilter(v as any)}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ background: filter===v ? 'var(--navy)' : 'transparent', color: filter===v ? 'white' : '#6b7280' }}>
              {l}
            </button>
          ))}
        </div>

        {/* Arama */}
        <div className="flex-1 min-w-[200px] relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔎</span>
          <input type="text" placeholder="Mükellef adı veya VKN ara..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)] focus:border-transparent" />
        </div>
      </div>

      {/* ── Tablo ──────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-sm bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'linear-gradient(135deg, var(--navy) 0%, #1e3a6e 100%)' }}>
              <th className="text-left py-3.5 px-4 text-white/80 font-semibold text-xs uppercase tracking-wider">Mükellef</th>
              <th className="text-left py-3.5 px-3 text-white/80 font-semibold text-xs uppercase tracking-wider">VKN/TC</th>
              <th className="text-center py-3.5 px-2 text-white/80 font-semibold text-xs uppercase tracking-wider">Evrak<br/>Son Gün</th>
              <th className="text-center py-3.5 px-2 text-white/80 font-semibold text-xs uppercase tracking-wider">Evrak<br/>Geldi</th>
              <th className="text-center py-3.5 px-2 text-white/80 font-semibold text-xs uppercase tracking-wider">Evrak<br/>İşlendi</th>
              <th className="text-center py-3.5 px-2 text-white/80 font-semibold text-xs uppercase tracking-wider">KDV<br/>Kontrol</th>
              <th className="text-center py-3.5 px-2 text-white/80 font-semibold text-xs uppercase tracking-wider">Beyanname<br/>Verildi</th>
              <th className="text-center py-3.5 px-3 text-white/80 font-semibold text-xs uppercase tracking-wider">Durum</th>
              <th className="text-center py-3.5 px-3 text-white/80 font-semibold text-xs uppercase tracking-wider"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={9} className="text-center py-16 text-gray-400">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-sm">Yükleniyor...</span>
                </div>
              </td></tr>
            ) : taxpayers.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-16">
                <div className="text-gray-400">
                  <div className="text-4xl mb-3">📋</div>
                  <p className="font-semibold text-gray-500">{MONTHS[month-1]} {year} döneminde mükellef bulunamadı</p>
                  <p className="text-xs mt-1">Dönem seçimini kontrol edin veya yeni mükellef ekleyin</p>
                </div>
              </td></tr>
            ) : taxpayers.map((t, i) => {
              const s = t.monthlyStatus;
              const done = isAllDone(t);
              const hasEvrak = s?.evraklarGeldi;
              const completedCount = [s?.evraklarGeldi,s?.evraklarIslendi,s?.kdvKontrolEdildi,s?.beyannameVerildi].filter(Boolean).length;
              return (
                <tr key={t.id}
                  className="group hover:bg-blue-50/40 transition-colors"
                  style={{ background: done ? 'linear-gradient(90deg,#f0fdf420,transparent)' : undefined }}>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      {/* Avatar */}
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ background: done ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'linear-gradient(135deg,var(--navy),#1e4080)' }}>
                        {getAdUnvan(t).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <Link href={`/panel/mukellefler/${t.id}`}
                          className="font-semibold hover:underline leading-tight block" style={{ color: 'var(--navy)' }}>
                          {getAdUnvan(t)}
                        </Link>
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                          style={{ background: t.type==='TUZEL_KISI'?'#e0e7ff':'#fef9c3', color: t.type==='TUZEL_KISI'?'#4338ca':'#92400e' }}>
                          {t.type==='TUZEL_KISI'?'Tüzel Kişi':'Gerçek Kişi'}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-gray-400 font-mono text-xs">{t.taxNumber}</td>
                  <td className="py-3 px-2 text-center">
                    {t.evrakTeslimGunu
                      ? <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mx-auto"
                          style={{ background:'var(--gold)22', color:'var(--gold)' }}>
                          {t.evrakTeslimGunu}
                        </span>
                      : <span className="text-gray-200 text-lg">—</span>}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <StatusCheckbox checked={s?.evraklarGeldi??false} onChange={v=>handleStatus(t.id,'evraklarGeldi',v)} title="Evraklar Geldi" />
                  </td>
                  <td className="py-3 px-2 text-center">
                    <StatusCheckbox checked={s?.evraklarIslendi??false} onChange={v=>handleStatus(t.id,'evraklarIslendi',v)} title="Evraklar İşlendi" />
                  </td>
                  <td className="py-3 px-2 text-center">
                    <StatusCheckbox checked={s?.kdvKontrolEdildi??false} onChange={v=>handleStatus(t.id,'kdvKontrolEdildi',v)} title="KDV Kontrol" />
                  </td>
                  <td className="py-3 px-2 text-center">
                    <StatusCheckbox checked={s?.beyannameVerildi??false} onChange={v=>handleStatus(t.id,'beyannameVerildi',v)} title="Beyanname Verildi" />
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex gap-0.5">
                        {[0,1,2,3].map(n => (
                          <div key={n} className="w-4 h-1.5 rounded-full transition-colors"
                            style={{ background: n < completedCount ? 'var(--gold)' : '#e5e7eb' }} />
                        ))}
                      </div>
                      <span className="text-xs font-medium"
                        style={{ color: done?'#16a34a':completedCount>0?'var(--navy)':'#9ca3af' }}>
                        {done ? '✓ Tamam' : `${completedCount}/4`}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <Link href={`/panel/mukellefler/${t.id}`}>
                      <button className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-3 py-1.5 rounded-lg font-medium"
                        style={{ background:'var(--navy)', color:'white' }}>
                        Düzenle
                      </button>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Tablo alt bilgisi */}
        {!isLoading && taxpayers.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between"
            style={{ background:'#f8fafc' }}>
            <span className="text-xs text-gray-400">{taxpayers.length} kayıt gösteriliyor</span>
            <span className="text-xs text-gray-400">{MONTHS[month-1]} {year} · Son güncelleme: şimdi</span>
          </div>
        )}
      </div>
    </div>
  );
}
