'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from 'sonner';

const MONTHS = [
  'Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
  'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık',
];

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;

type MonthlyStatus = {
  evraklarGeldi: boolean;
  evraklarIslendi: boolean;
  beyannameVerildi: boolean;
  kdvKontrolEdildi: boolean;
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
    <label className="flex items-center justify-center cursor-pointer" title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-[var(--gold)] cursor-pointer"
      />
    </label>
  );
}

// Özet istatistik kartı
function StatCard({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="card flex-1 min-w-[140px]">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <p className="text-xs text-gray-400 mt-1">{pct}% tamamlandı</p>
    </div>
  );
}

export default function MukelleflerPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(CURRENT_MONTH);

  const { data: taxpayers = [], isLoading } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers', search, year, month],
    queryFn: () =>
      api.get('/taxpayers', { params: { search: search || undefined, year, month } })
        .then(r => r.data),
  });

  const { mutate: updateStatus } = useMutation({
    mutationFn: ({ id, field, value }: { id: string; field: string; value: boolean }) =>
      api.patch(`/taxpayers/${id}/monthly-status`, { year, month, [field]: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taxpayers'] }),
    onError: () => toast.error('Durum güncellenemedi'),
  });

  const handleStatus = useCallback((id: string, field: string, value: boolean) => {
    updateStatus({ id, field, value });
  }, [updateStatus]);

  const getAdUnvan = (t: Taxpayer) =>
    t.companyName || `${(t as any).firstName || ''} ${(t as any).lastName || ''}`.trim() || '-';

  const total = taxpayers.length;
  const evraklarGeldi   = taxpayers.filter(t => t.monthlyStatus?.evraklarGeldi).length;
  const evraklarIslendi = taxpayers.filter(t => t.monthlyStatus?.evraklarIslendi).length;
  const beyanname       = taxpayers.filter(t => t.monthlyStatus?.beyannameVerildi).length;
  const kdvKontrol      = taxpayers.filter(t => t.monthlyStatus?.kdvKontrolEdildi).length;

  return (
    <div className="p-6">

      {/* Başlık */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--navy)' }}>Mükellef Listesi</h1>
          <p className="text-sm text-gray-500 mt-1">
            {MONTHS[month - 1]} {year} — {total} mükellef
          </p>
        </div>
        <Link href="/panel/mukellefler/yeni">
          <button className="btn-primary text-sm">+ Mükellef Ekle</button>
        </Link>
      </div>

      {/* İstatistik Kartları */}
      <div className="flex gap-3 flex-wrap mb-6">
        <StatCard label="Evrak Geldi"    value={evraklarGeldi}   total={total} color="#16a34a" />
        <StatCard label="İşlem Yapıldı"  value={evraklarIslendi} total={total} color="var(--navy)" />
        <StatCard label="Beyanname"      value={beyanname}       total={total} color="#2563eb" />
        <StatCard label="KDV Kontrol"    value={kdvKontrol}      total={total} color="var(--gold)" />
      </div>

      {/* Filtreler */}
      <div className="card mb-4 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">Dönem:</span>
          <select value={month} onChange={e => setMonth(parseInt(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)]">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(parseInt(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gold)]">
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <input type="text" placeholder="Mükellef ara..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]" />
      </div>

      {/* Tablo */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '2px solid var(--gold)' }}>
              <th className="text-left py-3 px-3 font-semibold" style={{ color: 'var(--navy)' }}>Ad / Unvan</th>
              <th className="text-left py-3 px-3 font-semibold text-xs" style={{ color: 'var(--navy)' }}>VKN/TC</th>
              <th className="text-center py-3 px-2 font-semibold text-xs" style={{ color: 'var(--navy)' }}>Son<br/>Gün</th>
              <th className="text-center py-3 px-2 font-semibold text-xs" style={{ color: 'var(--navy)' }}>Evrak<br/>Geldi</th>
              <th className="text-center py-3 px-2 font-semibold text-xs" style={{ color: 'var(--navy)' }}>Evrak<br/>İşlendi</th>
              <th className="text-center py-3 px-2 font-semibold text-xs" style={{ color: 'var(--navy)' }}>KDV<br/>Kontrol</th>
              <th className="text-center py-3 px-2 font-semibold text-xs" style={{ color: 'var(--navy)' }}>Beyanname<br/>Verildi</th>
              <th className="text-center py-3 px-2 font-semibold text-xs" style={{ color: 'var(--navy)' }}>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400">Yükleniyor...</td></tr>
            ) : taxpayers.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12">
                  <div className="text-gray-400">
                    <div className="text-3xl mb-2">📋</div>
                    <p className="font-medium">{MONTHS[month - 1]} {year} döneminde mükellef bulunamadı</p>
                    <p className="text-xs mt-1">Dönem seçimini kontrol edin veya yeni mükellef ekleyin</p>
                  </div>
                </td>
              </tr>
            ) : taxpayers.map((t, i) => {
              const s = t.monthlyStatus;
              const allDone = s?.evraklarGeldi && s?.evraklarIslendi && s?.beyannameVerildi && s?.kdvKontrolEdildi;
              return (
                <tr key={t.id}
                  className={`border-b border-gray-100 transition-colors ${allDone ? 'bg-green-50' : i % 2 === 0 ? 'bg-gray-50/50' : 'bg-white'}`}>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      {allDone && <span className="text-green-500 text-xs">✓</span>}
                      <Link href={`/panel/mukellefler/${t.id}`}
                        className="font-medium hover:underline" style={{ color: 'var(--navy)' }}>
                        {getAdUnvan(t)}
                      </Link>
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{
                        background: t.type === 'TUZEL_KISI' ? 'rgba(0,51,102,0.08)' : 'rgba(204,165,0,0.12)',
                        color: t.type === 'TUZEL_KISI' ? 'var(--navy)' : '#92700a',
                      }}>
                        {t.type === 'TUZEL_KISI' ? 'Tüzel' : 'Gerçek'}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-gray-500 font-mono text-xs">{t.taxNumber}</td>
                  <td className="py-2.5 px-2 text-center">
                    {t.evrakTeslimGunu
                      ? <span className="font-semibold text-sm" style={{ color: 'var(--gold)' }}>{t.evrakTeslimGunu}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <StatusCheckbox checked={s?.evraklarGeldi ?? false}
                      onChange={v => handleStatus(t.id, 'evraklarGeldi', v)} title="Evraklar Geldi" />
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <StatusCheckbox checked={s?.evraklarIslendi ?? false}
                      onChange={v => handleStatus(t.id, 'evraklarIslendi', v)} title="Evraklar İşlendi" />
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <StatusCheckbox checked={s?.kdvKontrolEdildi ?? false}
                      onChange={v => handleStatus(t.id, 'kdvKontrolEdildi', v)} title="KDV Kontrol" />
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <StatusCheckbox checked={s?.beyannameVerildi ?? false}
                      onChange={v => handleStatus(t.id, 'beyannameVerildi', v)} title="Beyanname Verildi" />
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <Link href={`/panel/mukellefler/${t.id}`}>
                      <button className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-100 transition">
                        Düzenle
                      </button>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Alt Özet */}
      {total > 0 && (
        <p className="text-xs text-gray-400 mt-3 text-right">
          {total} mükellef · {evraklarGeldi} evrak geldi · {beyanname} beyanname verildi · {kdvKontrol} KDV kontrol
        </p>
      )}
    </div>
  );
}
