'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Search, Download, Upload, Plus, ChevronRight } from 'lucide-react';

const GOLD = '#d4b876';

type Taxpayer = {
  id: string;
  type: 'GERCEK_KISI' | 'TUZEL_KISI';
  firstName?: string;
  lastName?: string;
  companyName?: string;
  taxNumber: string;
  taxOffice: string;
  email?: string;
  phone?: string;
  address?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  startDate?: string;
  endDate?: string;
};

type FilterKey = 'all' | 'sirket' | 'sahis' | 'aktif' | 'pasif';

function getName(t: Taxpayer): string {
  return t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || '—';
}

function getInitials(t: Taxpayer): string {
  const name = getName(t);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '—';
}

function getSubLabel(t: Taxpayer): string {
  // Tüzel kişide adres kısaltması, gerçek kişide başlangıç tarihi veya mihsap defteri türü
  if (t.type === 'TUZEL_KISI') {
    if (t.address) {
      const parts = t.address.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
      return parts.slice(0, 2).join(' · ');
    }
    return 'Tüzel Kişi';
  }
  return t.address ? t.address.split(/[,/]/)[0].trim() : 'Gerçek Kişi';
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function MukelleflerPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  const { data: raw = [], isLoading } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers', 'list', search],
    queryFn: () => api.get('/taxpayers', { params: { search: search || undefined } }).then((r) => r.data),
  });

  const counts = useMemo(() => {
    const sirket = raw.filter((t) => t.type === 'TUZEL_KISI').length;
    const sahis = raw.filter((t) => t.type === 'GERCEK_KISI').length;
    const aktif = raw.filter((t) => t.isActive !== false).length;
    const pasif = raw.filter((t) => t.isActive === false).length;
    return { total: raw.length, sirket, sahis, aktif, pasif };
  }, [raw]);

  const filtered = useMemo(() => {
    let list = raw.slice();
    if (filter === 'sirket') list = list.filter((t) => t.type === 'TUZEL_KISI');
    else if (filter === 'sahis') list = list.filter((t) => t.type === 'GERCEK_KISI');
    else if (filter === 'aktif') list = list.filter((t) => t.isActive !== false);
    else if (filter === 'pasif') list = list.filter((t) => t.isActive === false);
    return list.sort((a, b) => getName(a).localeCompare(getName(b), 'tr', { sensitivity: 'base' }));
  }, [raw, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageItems = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const filterBtns: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'Tümü', count: counts.total },
    { key: 'sirket', label: 'Şirket', count: counts.sirket },
    { key: 'sahis', label: 'Şahıs', count: counts.sahis },
    { key: 'aktif', label: 'Aktif', count: counts.aktif },
    { key: 'pasif', label: 'Pasif', count: counts.pasif },
  ];

  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Ana Modül</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>Mükellef Listesi</h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            {counts.total} mükellef · {counts.aktif} aktif{counts.pasif > 0 ? ` · ${counts.pasif} pasif` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-[18px] py-2.5 text-[13px] font-medium rounded-[10px] transition-all"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.08)'; e.currentTarget.style.borderColor = 'rgba(184,160,111,0.2)'; e.currentTarget.style.color = '#fafaf9'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(250,250,249,0.75)'; }}
          >
            <Download size={14} /> İçe Aktar
          </button>
          <button
            type="button"
            onClick={() => {
              const rows = [
                ['İsim', 'Tür', 'VKN/TC', 'Vergi Dairesi', 'Durum', 'Kayıt Tarihi'],
                ...raw.map((t) => [getName(t), t.type === 'TUZEL_KISI' ? 'Şirket' : 'Şahıs', t.taxNumber, t.taxOffice, t.isActive ? 'Aktif' : 'Pasif', fmtDate(t.createdAt)]),
              ];
              const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
              const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `mukellefler-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex items-center gap-1.5 px-[18px] py-2.5 text-[13px] font-medium rounded-[10px] transition-all"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.08)'; e.currentTarget.style.borderColor = 'rgba(184,160,111,0.2)'; e.currentTarget.style.color = '#fafaf9'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(250,250,249,0.75)'; }}
          >
            <Upload size={14} /> Dışa Aktar
          </button>
          <Link
            href="/panel/mukellefler/yeni"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
          >
            <Plus size={14} /> Yeni Mükellef
          </Link>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[260px] relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="İsim, VKN/TC veya VD ara..."
            className="w-full pl-10 pr-3 py-2.5 text-[13px] rounded-[10px] outline-none"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
          />
        </div>
        {filterBtns.map((b) => {
          const active = filter === b.key;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => { setFilter(b.key); setPage(1); }}
              className="px-3.5 py-2 text-[12px] font-medium rounded-[9px] transition-all"
              style={{
                background: active ? 'rgba(184,160,111,0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? 'rgba(184,160,111,0.3)' : 'rgba(255,255,255,0.08)'}`,
                color: active ? GOLD : 'rgba(250,250,249,0.55)',
              }}
            >
              {b.label} ({b.count})
            </button>
          );
        })}
      </div>

      {/* TABLE */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div
          className="grid items-center px-5 py-3 text-[10px] font-semibold uppercase"
          style={{
            gridTemplateColumns: '44px 1fr 90px 150px 180px 130px 90px 70px',
            gap: 14,
            background: 'rgba(255,255,255,0.015)',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            color: 'rgba(250,250,249,0.4)',
            letterSpacing: '0.12em',
          }}
        >
          <span></span>
          <span>Mükellef</span>
          <span>Tür</span>
          <span>VKN / TC</span>
          <span>Vergi Dairesi</span>
          <span>Son İşlem</span>
          <span>Durum</span>
          <span></span>
        </div>

        {isLoading ? (
          <div className="py-16 flex flex-col items-center gap-3" style={{ color: 'rgba(250,250,249,0.4)' }}>
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: GOLD }} />
            <span className="text-sm">Yükleniyor...</span>
          </div>
        ) : pageItems.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Kayıt bulunamadı</p>
            <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>Arama veya filtrelemeyi değiştirmeyi deneyin</p>
          </div>
        ) : (
          pageItems.map((t) => {
            const isCompany = t.type === 'TUZEL_KISI';
            const active = t.isActive !== false;
            return (
              <Link
                key={t.id}
                href={`/panel/mukellefler/${t.id}`}
                className="grid items-center px-5 py-3.5 transition-all group"
                style={{
                  gridTemplateColumns: '44px 1fr 90px 150px 180px 130px 90px 70px',
                  gap: 14,
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.04)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Avatar */}
                <div className="flex justify-center">
                  <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[12px] font-bold" style={{ background: 'rgba(184,160,111,0.08)', color: GOLD, border: '1px solid rgba(184,160,111,0.15)' }}>
                    {getInitials(t)}
                  </div>
                </div>

                {/* İsim + alt bilgi */}
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold truncate" style={{ color: '#fafaf9', letterSpacing: '-0.01em' }}>{getName(t)}</p>
                  <p className="text-[11.5px] mt-0.5 truncate" style={{ color: 'rgba(250,250,249,0.4)' }}>{getSubLabel(t)}</p>
                </div>

                {/* Tür */}
                <div>
                  <span
                    className="inline-block px-2 py-[2px] rounded-md text-[10px] font-bold uppercase"
                    style={{
                      background: isCompany ? 'rgba(184,160,111,0.12)' : 'rgba(255,255,255,0.06)',
                      color: isCompany ? GOLD : 'rgba(250,250,249,0.5)',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {isCompany ? 'Şirket' : 'Şahıs'}
                  </span>
                </div>

                {/* VKN/TC */}
                <div className="text-[12px] tabular-nums truncate" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.65)' }}>
                  {t.taxNumber}
                </div>

                {/* Vergi Dairesi */}
                <div className="text-[12px] truncate" style={{ color: 'rgba(250,250,249,0.55)' }}>{t.taxOffice || '—'}</div>

                {/* Son İşlem */}
                <div className="text-[12px] tabular-nums" style={{ color: 'rgba(250,250,249,0.5)' }}>{fmtDate(t.updatedAt || t.createdAt)}</div>

                {/* Durum */}
                <div>
                  <span
                    className="inline-block px-2.5 py-[3px] rounded-md text-[10.5px] font-semibold"
                    style={{
                      background: active ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)',
                      color: active ? '#22c55e' : 'rgba(250,250,249,0.45)',
                    }}
                  >
                    {active ? 'Aktif' : 'Pasif'}
                  </span>
                </div>

                {/* Detay oku */}
                <div className="text-right">
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-medium transition-all opacity-60 group-hover:opacity-100" style={{ color: GOLD }}>
                    Detay <ChevronRight size={12} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            );
          })
        )}

        {/* Pagination */}
        {!isLoading && filtered.length > 0 && (
          <div
            className="px-5 py-3.5 flex items-center justify-between"
            style={{ borderTop: '1px solid rgba(255,255,255,0.04)', fontSize: 12, color: 'rgba(250,250,249,0.4)' }}
          >
            <span className="tabular-nums">
              Gösterilen: {(pageSafe - 1) * PAGE_SIZE + 1}-{Math.min(pageSafe * PAGE_SIZE, filtered.length)} / {filtered.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pageSafe <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3.5 py-1.5 text-[11.5px] font-medium rounded-[8px] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
              >
                ← Önceki
              </button>
              <span className="px-3 py-1.5 text-[11.5px] font-medium" style={{ color: 'rgba(250,250,249,0.55)' }}>
                Sayfa {pageSafe} / {totalPages}
              </span>
              <button
                type="button"
                disabled={pageSafe >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3.5 py-1.5 text-[11.5px] font-medium rounded-[8px] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
              >
                Sonraki →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
