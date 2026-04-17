'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Search, Download, Plus, Users, FileText, Wallet, BarChart3 } from 'lucide-react';

const GOLD = '#d4b876';

type Employee = {
  id: string;
  firstName: string;
  lastName: string;
  tcNo: string;
  startDate?: string;
  endDate?: string;
  jobTitle?: string;
  grossSalary?: number;
  netSalary?: number;
  sgkPrim?: number;
  isActive: boolean;
  status?: 'AKTIF' | 'IZINDE' | 'PASIF';
};

type FilterKey = 'all' | 'aktif' | 'izinde' | 'pasif';

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtMoney(n?: number): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Number(n)) + ' TL';
}

export default function BordroPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['employees', 'list'],
    queryFn: () => api.get('/employees').then((r) => r.data).catch(() => []),
  });

  const counts = useMemo(() => {
    const aktif = employees.filter((e) => e.isActive && e.status !== 'IZINDE' && e.status !== 'PASIF').length;
    const izinde = employees.filter((e) => e.status === 'IZINDE').length;
    const pasif = employees.filter((e) => !e.isActive || e.status === 'PASIF').length;
    return { total: employees.length, aktif, izinde, pasif };
  }, [employees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (filter === 'aktif' && !(e.isActive && e.status !== 'IZINDE' && e.status !== 'PASIF')) return false;
      if (filter === 'izinde' && e.status !== 'IZINDE') return false;
      if (filter === 'pasif' && e.isActive && e.status !== 'PASIF') return false;
      if (!q) return true;
      return (`${e.firstName} ${e.lastName}`.toLowerCase().includes(q)) || e.tcNo.includes(q);
    });
  }, [employees, search, filter]);

  const sgkTotal = useMemo(() => employees.reduce((s, e) => s + Number(e.sgkPrim || 0), 0), [employees]);
  const avgBrut = useMemo(() => {
    const actives = employees.filter((e) => e.isActive);
    if (actives.length === 0) return 0;
    return actives.reduce((s, e) => s + Number(e.grossSalary || 0), 0) / actives.length;
  }, [employees]);

  const filterBtns: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'Tümü', count: counts.total },
    { key: 'aktif', label: 'Aktif', count: counts.aktif },
    { key: 'izinde', label: 'İzinde', count: counts.izinde },
    { key: 'pasif', label: 'Pasif', count: counts.pasif },
  ];

  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>İnsan Kaynakları</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>Bordro & SGK</h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>Çalışan bordro ve sosyal güvenlik yönetimi</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="inline-flex items-center gap-1.5 px-[18px] py-2.5 text-[13px] font-medium rounded-[10px] transition-all" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}>
            <Download size={14} /> Bordro İçe Aktar
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
            <Plus size={14} /> Yeni Çalışan
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {[
          { label: 'Aktif Çalışan', value: counts.aktif, sub: `${counts.total} toplam`, icon: Users },
          { label: 'Bu Ay Bordro', value: counts.aktif, sub: new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }), icon: FileText },
          { label: 'SGK Prim Toplamı', value: fmtMoney(sgkTotal), sub: new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }), icon: Wallet },
          { label: 'Ort. Brüt Ücret', value: fmtMoney(avgBrut), sub: 'kişi başına', icon: BarChart3 },
        ].map(({ label, value, sub, icon: Icon }) => (
          <div key={label} className="rounded-2xl p-5 transition-all" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD }}><Icon size={17} /></div>
            </div>
            <p className="text-[11px] uppercase font-semibold tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.38)' }}>{label}</p>
            <p className="mt-1.5 leading-none tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: typeof value === 'number' ? 34 : 24, fontWeight: 700, letterSpacing: '-0.03em', color: GOLD }}>{value}</p>
            <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.32)' }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* FILTER */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[260px] relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Çalışan adı veya TC ara..." className="w-full pl-10 pr-3 py-2.5 text-[13px] rounded-[10px] outline-none" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
        </div>
        {filterBtns.map((b) => {
          const active = filter === b.key;
          return (
            <button key={b.key} onClick={() => setFilter(b.key)} className="px-3.5 py-2 text-[12px] font-medium rounded-[9px] transition-all"
              style={{ background: active ? 'rgba(184,160,111,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${active ? 'rgba(184,160,111,0.3)' : 'rgba(255,255,255,0.08)'}`, color: active ? GOLD : 'rgba(250,250,249,0.55)' }}>
              {b.label} ({b.count})
            </button>
          );
        })}
      </div>

      {/* TABLE */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="grid items-center px-5 py-3 text-[10px] font-semibold uppercase"
          style={{ gridTemplateColumns: '1fr 140px 120px 140px 130px 130px 130px 90px', gap: 14, background: 'rgba(255,255,255,0.015)', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.4)', letterSpacing: '0.12em' }}>
          <span>Ad</span>
          <span>TC Kimlik</span>
          <span>İşe Giriş</span>
          <span>Görev</span>
          <span className="text-right">Brüt</span>
          <span className="text-right">Net</span>
          <span className="text-right">SGK Primi</span>
          <span>Durum</span>
        </div>

        {isLoading ? (
          <div className="py-16 flex flex-col items-center gap-3" style={{ color: 'rgba(250,250,249,0.4)' }}>
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: GOLD }} />
            <span className="text-sm">Yükleniyor...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <Users size={24} style={{ color: 'rgba(250,250,249,0.35)' }} />
            </div>
            <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Henüz çalışan kaydı yok</p>
            <p className="text-[11.5px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>Bordro modülü backend tarafında aktifleşince liste burada görünecek</p>
          </div>
        ) : (
          filtered.map((e) => {
            const active = e.isActive && e.status !== 'IZINDE' && e.status !== 'PASIF';
            const izinde = e.status === 'IZINDE';
            return (
              <div key={e.id} className="grid items-center px-5 py-3.5 transition-all"
                style={{ gridTemplateColumns: '1fr 140px 120px 140px 130px 130px 130px 90px', gap: 14, borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                onMouseEnter={(evt) => { evt.currentTarget.style.background = 'rgba(184,160,111,0.04)'; }}
                onMouseLeave={(evt) => { evt.currentTarget.style.background = 'transparent'; }}>
                <div className="text-[14px] font-medium truncate" style={{ color: '#fafaf9' }}>{e.firstName} {e.lastName}</div>
                <div className="text-[11px] tabular-nums truncate" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.5)' }}>{e.tcNo}</div>
                <div className="text-[11px] tabular-nums" style={{ color: 'rgba(250,250,249,0.5)' }}>{fmtDate(e.startDate)}</div>
                <div className="text-[12px] truncate" style={{ color: 'rgba(250,250,249,0.7)' }}>{e.jobTitle || '—'}</div>
                <div className="text-right text-[13px] font-semibold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: GOLD }}>{fmtMoney(e.grossSalary)}</div>
                <div className="text-right text-[12px] tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.7)' }}>{fmtMoney(e.netSalary)}</div>
                <div className="text-right text-[12px] tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.7)' }}>{fmtMoney(e.sgkPrim)}</div>
                <div>
                  <span className="inline-block px-2.5 py-[3px] rounded-md text-[10.5px] font-semibold"
                    style={{
                      background: active ? 'rgba(34,197,94,0.1)' : izinde ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.04)',
                      color: active ? '#22c55e' : izinde ? '#f59e0b' : 'rgba(250,250,249,0.45)',
                    }}>
                    {active ? 'Aktif' : izinde ? 'İzinde' : 'Pasif'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
