'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Search, Download, Plus, BarChart3, CheckCircle2, Clock, RotateCcw, ChevronRight } from 'lucide-react';
import Link from 'next/link';

const GOLD = '#d4b876';

type Declaration = {
  id: string;
  declarationType: string;
  periodLabel: string;
  status: 'PENDING' | 'PREPARING' | 'READY' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  dueDate?: string;
  amount?: number;
  taxpayer?: { id: string; companyName?: string; firstName?: string; lastName?: string };
};

type FilterKey = 'all' | 'KDV' | 'Muhtasar' | 'Gelir' | 'Kurumlar' | 'Gecici';

const STATUS_LABEL: Record<string, { label: string; kind: 'ok' | 'warn' | 'danger' | 'info' }> = {
  PENDING: { label: 'Beklemede', kind: 'warn' },
  PREPARING: { label: 'Hazırlanıyor', kind: 'info' },
  READY: { label: 'Hazır', kind: 'ok' },
  SUBMITTED: { label: 'Gönderildi', kind: 'ok' },
  ACCEPTED: { label: 'Onaylandı', kind: 'ok' },
  REJECTED: { label: 'Reddedildi', kind: 'danger' },
};

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(n) + ' TL';
}

function getMukellefName(d: Declaration): string {
  const t = d.taxpayer;
  if (!t) return '—';
  return t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || '—';
}

export default function BeyannamelerPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const { data: declarations = [], isLoading } = useQuery<Declaration[]>({
    queryKey: ['declarations', 'list'],
    queryFn: () => api.get('/tax-declarations').then((r) => r.data).catch(() => []),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return declarations.filter((d) => {
      if (filter !== 'all' && !d.declarationType?.toUpperCase().includes(filter.toUpperCase())) return false;
      if (!q) return true;
      const haystack = `${d.declarationType} ${d.periodLabel} ${getMukellefName(d)}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [declarations, filter, search]);

  const counts = useMemo((): { total: number; KDV: number; Muhtasar: number; Gelir: number; Kurumlar: number; Gecici: number } => {
    let kdv = 0, muhtasar = 0, gelir = 0, kurumlar = 0, gecici = 0;
    for (const d of declarations) {
      const t = (d.declarationType || '').toUpperCase();
      if (t.includes('KDV')) kdv++;
      else if (t.includes('MUHTASAR')) muhtasar++;
      else if (t.includes('GELIR')) gelir++;
      else if (t.includes('KURUMLAR')) kurumlar++;
      else if (t.includes('GECICI')) gecici++;
    }
    return { total: declarations.length, KDV: kdv, Muhtasar: muhtasar, Gelir: gelir, Kurumlar: kurumlar, Gecici: gecici };
  }, [declarations]);

  const stats = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear(); const m = now.getMonth();
    const thisMonth = declarations.filter((d) => {
      const lbl = d.periodLabel || '';
      return lbl.startsWith(`${y}/${String(m + 1).padStart(2, '0')}`) || lbl.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`);
    }).length;
    const ready = declarations.filter((d) => d.status === 'READY').length;
    const pending = declarations.filter((d) => d.status === 'PENDING' || d.status === 'PREPARING').length;
    const submitted = declarations.filter((d) => d.status === 'SUBMITTED' || d.status === 'ACCEPTED').length;
    return { thisMonth, ready, pending, submitted };
  }, [declarations]);

  const filterBtns: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'Tümü', count: counts.total },
    { key: 'KDV', label: 'KDV', count: counts.KDV },
    { key: 'Muhtasar', label: 'Muhtasar', count: counts.Muhtasar },
    { key: 'Gelir', label: 'Gelir', count: counts.Gelir },
    { key: 'Kurumlar', label: 'Kurumlar', count: counts.Kurumlar },
    { key: 'Gecici', label: 'Geçici', count: counts.Gecici },
  ];

  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Belgeler</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>Beyannameler</h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>Tüm vergi beyannameleri ve durum takibi</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="inline-flex items-center gap-1.5 px-[18px] py-2.5 text-[13px] font-medium rounded-[10px] transition-all" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.08)'; e.currentTarget.style.borderColor = 'rgba(184,160,111,0.2)'; e.currentTarget.style.color = '#fafaf9'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(250,250,249,0.75)'; }}>
            <Download size={14} /> İçe Aktar
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
            <Plus size={14} /> Yeni Beyanname
          </button>
        </div>
      </div>

      {/* KPI GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {[
          { label: 'Bu Ay', value: stats.thisMonth, sub: 'beyanname', icon: BarChart3 },
          { label: 'Hazır', value: stats.ready, sub: 'gönderilmeye hazır', icon: CheckCircle2 },
          { label: 'Beklemede', value: stats.pending, sub: 'hazırlanıyor', icon: Clock },
          { label: 'Gönderilen', value: stats.submitted, sub: 'tamamlandı', icon: RotateCcw },
        ].map(({ label, value, sub, icon: Icon }) => (
          <div key={label} className="rounded-2xl p-5 transition-all" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD }}><Icon size={17} /></div>
            </div>
            <p className="text-[11px] uppercase font-semibold tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.38)' }}>{label}</p>
            <p className="mt-1.5 leading-none tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em', color: GOLD }}>{value}</p>
            <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.32)' }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* FILTER BAR */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[260px] relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Beyanname veya mükellef ara..." className="w-full pl-10 pr-3 py-2.5 text-[13px] rounded-[10px] outline-none" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
        </div>
        {filterBtns.map((b) => {
          const active = filter === b.key;
          return (
            <button key={b.key} type="button" onClick={() => setFilter(b.key)} className="px-3.5 py-2 text-[12px] font-medium rounded-[9px] transition-all"
              style={{ background: active ? 'rgba(184,160,111,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${active ? 'rgba(184,160,111,0.3)' : 'rgba(255,255,255,0.08)'}`, color: active ? GOLD : 'rgba(250,250,249,0.55)' }}>
              {b.label} ({b.count})
            </button>
          );
        })}
      </div>

      {/* TABLE */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="grid items-center px-5 py-3 text-[10px] font-semibold uppercase"
          style={{ gridTemplateColumns: '120px 1fr 130px 130px 140px 130px 50px', gap: 14, background: 'rgba(255,255,255,0.015)', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.4)', letterSpacing: '0.12em' }}>
          <span>Beyanname</span>
          <span>Mükellef</span>
          <span className="text-center">Dönem</span>
          <span className="text-center">Son Tarih</span>
          <span className="text-right">Tutar</span>
          <span>Ödeme Durumu</span>
          <span></span>
        </div>

        {isLoading ? (
          <div className="py-16 flex flex-col items-center gap-3" style={{ color: 'rgba(250,250,249,0.4)' }}>
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: GOLD }} />
            <span className="text-sm">Yükleniyor...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <BarChart3 size={24} style={{ color: 'rgba(250,250,249,0.35)' }} />
            </div>
            <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Henüz beyanname kaydı yok</p>
            <p className="text-[11.5px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>Beyanname modülü backend tarafında aktifleşince liste burada görünecek</p>
          </div>
        ) : (
          filtered.map((d) => {
            const status = STATUS_LABEL[d.status] || { label: d.status, kind: 'info' as const };
            const chipStyles: Record<string, { bg: string; c: string }> = {
              ok: { bg: 'rgba(34,197,94,0.1)', c: '#22c55e' },
              warn: { bg: 'rgba(245,158,11,0.1)', c: '#f59e0b' },
              danger: { bg: 'rgba(244,63,94,0.1)', c: '#f43f5e' },
              info: { bg: 'rgba(184,160,111,0.12)', c: GOLD },
            };
            const st = chipStyles[status.kind];
            return (
              <div key={d.id} className="grid items-center px-5 py-3.5 transition-all group" style={{ gridTemplateColumns: '120px 1fr 130px 130px 140px 130px 50px', gap: 14, borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.04)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <div><span className="inline-block px-2.5 py-[3px] rounded-md text-[11px] font-semibold" style={{ background: 'rgba(184,160,111,0.12)', color: GOLD }}>{d.declarationType}</span></div>
                <div className="text-[14px] font-medium truncate" style={{ color: '#fafaf9' }}>{getMukellefName(d)}</div>
                <div className="text-center text-[12px]" style={{ color: 'rgba(250,250,249,0.65)' }}>{d.periodLabel || '—'}</div>
                <div className="text-center text-[12px] tabular-nums" style={{ color: 'rgba(250,250,249,0.5)' }}>{fmtDate(d.dueDate)}</div>
                <div className="text-right text-[13px] font-semibold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: GOLD }}>{fmtMoney(d.amount)}</div>
                <div><span className="inline-block px-2.5 py-[3px] rounded-md text-[10.5px] font-semibold" style={{ background: st.bg, color: st.c }}>{status.label}</span></div>
                <div className="flex justify-end">
                  <Link href={`/panel/beyannameler/${d.id}`} className="text-[13px] font-semibold transition-all opacity-60 group-hover:opacity-100" style={{ color: GOLD }}>→</Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
