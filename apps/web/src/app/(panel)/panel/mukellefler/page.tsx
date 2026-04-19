'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Search, Download, Upload, Plus, ChevronRight } from 'lucide-react';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';

type MonthlyStatus = {
  id?: string;
  evraklarGeldi: boolean;
  evraklarIslendi: boolean;
  kontrolEdildi: boolean;
  beyannameVerildi: boolean;
  kdvKontrolEdildi: boolean;
  indirilecekKdvKontrol: boolean;
  hesaplananKdvKontrol: boolean;
  eArsivKontrol: boolean;
};

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
  phones?: string[];
  address?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  startDate?: string;
  endDate?: string;
  monthlyStatus: MonthlyStatus | null;
};

// Tablodaki checkbox alanlarının tipi
type StatusKey =
  | 'evraklarGeldi'
  | 'evraklarIslendi'
  | 'indirilecekKdvKontrol'
  | 'hesaplananKdvKontrol'
  | 'eArsivKontrol'
  | 'beyannameVerildi';

type FilterKey = 'all' | 'evrak-gelmedi' | 'beyanname-bekliyor' | 'beyanname-verilmedi' | 'verildi';

const AYLAR_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

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

/** Beyanname durumu türetimi */
function deriveBeyannameStatus(s: MonthlyStatus | null): 'verildi' | 'bekliyor' | 'verilmedi' {
  if (!s) return 'verilmedi';
  if (s.beyannameVerildi) return 'verildi';
  const tumuTamam =
    s.evraklarGeldi &&
    s.evraklarIslendi &&
    s.indirilecekKdvKontrol &&
    s.hesaplananKdvKontrol &&
    s.eArsivKontrol;
  return tumuTamam ? 'bekliyor' : 'verilmedi';
}

export default function MukelleflerPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [search, setSearch] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const { data: raw = [], isLoading } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers', 'list', search, year, month],
    queryFn: () =>
      api.get('/taxpayers', { params: { search: search || undefined, year, month } }).then(r => r.data),
  });

  // Checkbox toggle — optimistic update
  const toggleStatus = useMutation({
    mutationFn: async ({ id, key, value }: { id: string; key: StatusKey; value: boolean }) => {
      return api.patch(`/taxpayers/${id}/monthly-status`, { year, month, [key]: value });
    },
    onMutate: async ({ id, key, value }) => {
      await qc.cancelQueries({ queryKey: ['taxpayers', 'list', search, year, month] });
      const prev = qc.getQueryData<Taxpayer[]>(['taxpayers', 'list', search, year, month]);
      qc.setQueryData<Taxpayer[]>(['taxpayers', 'list', search, year, month], (old) =>
        (old || []).map((t) => {
          if (t.id !== id) return t;
          const base: MonthlyStatus = t.monthlyStatus ?? {
            evraklarGeldi: false, evraklarIslendi: false, kontrolEdildi: false,
            beyannameVerildi: false, kdvKontrolEdildi: false,
            indirilecekKdvKontrol: false, hesaplananKdvKontrol: false, eArsivKontrol: false,
          };
          return { ...t, monthlyStatus: { ...base, [key]: value } };
        }),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['taxpayers', 'list', search, year, month], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['taxpayers', 'list', search, year, month] });
    },
  });

  const counts = useMemo(() => {
    let evrakGeldi = 0, evrakGelmedi = 0, islenmedi = 0;
    let beyannameVerildi = 0, beyannameBekliyor = 0, beyannameVerilmedi = 0;
    for (const t of raw) {
      const s = t.monthlyStatus;
      if (s?.evraklarGeldi) evrakGeldi++; else evrakGelmedi++;
      if (!s?.evraklarIslendi) islenmedi++;
      const b = deriveBeyannameStatus(s);
      if (b === 'verildi') beyannameVerildi++;
      else if (b === 'bekliyor') beyannameBekliyor++;
      else beyannameVerilmedi++;
    }
    return {
      total: raw.length, evrakGeldi, evrakGelmedi, islenmedi,
      beyannameVerildi, beyannameBekliyor, beyannameVerilmedi,
    };
  }, [raw]);

  const filtered = useMemo(() => {
    let list = raw.slice();
    if (filter === 'evrak-gelmedi') list = list.filter(t => !t.monthlyStatus?.evraklarGeldi);
    else if (filter === 'beyanname-bekliyor') list = list.filter(t => deriveBeyannameStatus(t.monthlyStatus) === 'bekliyor');
    else if (filter === 'beyanname-verilmedi') list = list.filter(t => deriveBeyannameStatus(t.monthlyStatus) === 'verilmedi');
    else if (filter === 'verildi') list = list.filter(t => t.monthlyStatus?.beyannameVerildi);
    return list.sort((a, b) => getName(a).localeCompare(getName(b), 'tr', { sensitivity: 'base' }));
  }, [raw, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageItems = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const filterBtns: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'Tümü', count: counts.total },
    { key: 'evrak-gelmedi', label: 'Evrak Gelmedi', count: counts.evrakGelmedi },
    { key: 'beyanname-bekliyor', label: 'Beyanname Bekliyor', count: counts.beyannameBekliyor },
    { key: 'beyanname-verilmedi', label: 'Beyanname Verilmedi', count: counts.beyannameVerilmedi },
    { key: 'verildi', label: 'Verildi', count: counts.beyannameVerildi },
  ];

  const donemStr = `${AYLAR_TR[month - 1]} ${year}`;

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Ana Modül</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>Mükellef Listesi</h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            {donemStr} döneminde aktif {counts.total} mükellef
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-[18px] py-2.5 text-[13px] font-medium rounded-[10px] transition-all"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
          >
            <Download size={14} /> İçe Aktar
          </button>
          <button
            type="button"
            onClick={() => {
              const rows = [
                ['İsim','Tür','VKN/TC','VD','Evrak','İşlendi','İnd.KDV','Hes.KDV','E-Arşiv','Beyanname'],
                ...raw.map(t => {
                  const s = t.monthlyStatus;
                  return [
                    getName(t),
                    t.type === 'TUZEL_KISI' ? 'Şirket' : 'Şahıs',
                    t.taxNumber,
                    t.taxOffice,
                    s?.evraklarGeldi ? 'Evet' : 'Hayır',
                    s?.evraklarIslendi ? 'Evet' : 'Hayır',
                    s?.indirilecekKdvKontrol ? 'Evet' : 'Hayır',
                    s?.hesaplananKdvKontrol ? 'Evet' : 'Hayır',
                    s?.eArsivKontrol ? 'Evet' : 'Hayır',
                    deriveBeyannameStatus(s) === 'verildi' ? 'Verildi' : deriveBeyannameStatus(s) === 'bekliyor' ? 'Bekliyor' : 'Verilmedi',
                  ];
                }),
              ];
              const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
              const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `mukellefler-${year}-${String(month).padStart(2,'0')}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex items-center gap-1.5 px-[18px] py-2.5 text-[13px] font-medium rounded-[10px] transition-all"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
          >
            <Upload size={14} /> Dışa Aktar
          </button>
          <Link
            href="/panel/mukellefler/yeni"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all"
            style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b' }}
          >
            <Plus size={14} /> Yeni Mükellef
          </Link>
        </div>
      </div>

      {/* TOOLBAR: Search + Period + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px] relative">
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

        {/* Period picker */}
        <div className="flex items-center gap-1 p-1 rounded-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <select
            value={month}
            onChange={(e) => { setMonth(parseInt(e.target.value)); setPage(1); }}
            className="bg-transparent outline-none px-2 py-1.5 text-[12.5px] font-medium cursor-pointer"
            style={{ color: '#fafaf9' }}
          >
            {AYLAR_TR.map((a, i) => (<option key={i} value={i + 1} style={{ background: '#0f0d0b' }}>{a}</option>))}
          </select>
          <span style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.08)' }} />
          <select
            value={year}
            onChange={(e) => { setYear(parseInt(e.target.value)); setPage(1); }}
            className="bg-transparent outline-none px-2 py-1.5 text-[12.5px] font-medium cursor-pointer"
            style={{ color: '#fafaf9' }}
          >
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
              <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>
            ))}
          </select>
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

      {/* STAT CARDS */}
      <div className="grid grid-cols-6 gap-2.5">
        <StatCard variant="gold" label="Dönemde Aktif" value={String(counts.total)} />
        <StatCard variant="ok" label="Evrak Geldi" value={String(counts.evrakGeldi)} sub={counts.total ? `%${((counts.evrakGeldi / counts.total) * 100).toFixed(0)}` : ''} />
        <StatCard variant="danger" label="Evrak Gelmedi" value={String(counts.evrakGelmedi)} sub={counts.evrakGelmedi > 0 ? 'hatırlat' : ''} />
        <StatCard variant="warn" label="İşlenmedi" value={String(counts.islenmedi)} sub={counts.islenmedi > 0 ? 'işle' : ''} />
        <StatCard variant="warn" label="Beyanname Bekliyor" value={String(counts.beyannameBekliyor)} sub={counts.beyannameBekliyor > 0 ? 'gönder' : ''} />
        <StatCard variant="gold" label="Beyanname Verildi" value={`${counts.beyannameVerildi} / ${counts.total}`} sub={counts.total ? `%${((counts.beyannameVerildi / counts.total) * 100).toFixed(0)}` : ''} />
      </div>

      {/* TABLE */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div
          className="grid items-center px-5 py-3 text-[10px] font-semibold uppercase"
          style={{
            gridTemplateColumns: '44px 1.6fr 95px 75px 90px 90px 90px 110px 55px',
            gap: 12,
            background: 'rgba(255,255,255,0.015)',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            color: 'rgba(250,250,249,0.4)',
            letterSpacing: '0.12em',
          }}
        >
          <span></span>
          <span>Mükellef</span>
          <span className="text-center">Evrak</span>
          <span className="text-center">İşlendi</span>
          <span className="text-center">İnd. KDV</span>
          <span className="text-center">Hes. KDV</span>
          <span className="text-center">E-Arşiv</span>
          <span className="text-center">Beyanname</span>
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
            <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
              {donemStr} döneminde kayıt yok veya filtre eşleşmedi
            </p>
          </div>
        ) : (
          pageItems.map((t) => (
            <TaxpayerRow
              key={t.id}
              taxpayer={t}
              onToggle={(key, value) => toggleStatus.mutate({ id: t.id, key, value })}
            />
          ))
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

// ─────────────────────────────────────────────────────────────
// Bileşenler
// ─────────────────────────────────────────────────────────────

function StatCard({
  variant, label, value, sub,
}: {
  variant: 'gold' | 'ok' | 'warn' | 'danger';
  label: string; value: string; sub?: string;
}) {
  const palette = {
    gold:   { line: GOLD,       val: GOLD,       lbl: 'rgba(212,184,118,0.7)', bg: 'linear-gradient(135deg, rgba(212,184,118,0.06), rgba(212,184,118,0.015))', border: 'rgba(212,184,118,0.18)' },
    ok:     { line: '#22c55e',  val: '#22c55e',  lbl: 'rgba(34,197,94,0.65)',  bg: 'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(34,197,94,0.015))',    border: 'rgba(34,197,94,0.16)' },
    warn:   { line: '#f59e0b',  val: '#f59e0b',  lbl: 'rgba(245,158,11,0.7)',  bg: 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(245,158,11,0.015))',  border: 'rgba(245,158,11,0.16)' },
    danger: { line: '#ef4444',  val: '#ef4444',  lbl: 'rgba(239,68,68,0.7)',   bg: 'linear-gradient(135deg, rgba(239,68,68,0.06), rgba(239,68,68,0.015))',    border: 'rgba(239,68,68,0.16)' },
  }[variant];
  return (
    <div className="relative rounded-xl px-3.5 py-3 overflow-hidden" style={{ background: palette.bg, border: `1px solid ${palette.border}` }}>
      <span className="absolute left-0 top-3 bottom-3 w-[2px] rounded" style={{ background: palette.line }} />
      <div className="pl-1.5">
        <div className="text-[10px] uppercase font-medium tracking-[0.14em] mb-1.5" style={{ color: palette.lbl }}>{label}</div>
        <div className="text-[22px] leading-none font-semibold" style={{ fontFamily: 'Fraunces, serif', letterSpacing: '-0.02em', color: palette.val }}>{value}</div>
        {sub && <div className="text-[10.5px] mt-1" style={{ color: 'rgba(250,250,249,0.35)', fontFamily: 'JetBrains Mono, monospace' }}>{sub}</div>}
      </div>
    </div>
  );
}

function TaxpayerRow({
  taxpayer,
  onToggle,
}: {
  taxpayer: Taxpayer;
  onToggle: (key: StatusKey, value: boolean) => void;
}) {
  const s = taxpayer.monthlyStatus;
  const isCompany = taxpayer.type === 'TUZEL_KISI';
  const beyanname = deriveBeyannameStatus(s);

  return (
    <div
      className="grid items-center px-5 py-3 transition-all group"
      style={{
        gridTemplateColumns: '44px 1.6fr 95px 75px 90px 90px 90px 110px 55px',
        gap: 12,
        borderBottom: '1px solid rgba(255,255,255,0.03)',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(184,160,111,0.04)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      {/* Avatar */}
      <div className="flex justify-center">
        <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[12px] font-bold" style={{ background: 'rgba(184,160,111,0.08)', color: GOLD, border: '1px solid rgba(184,160,111,0.15)' }}>
          {getInitials(taxpayer)}
        </div>
      </div>

      {/* Mükellef adı + alt bilgi */}
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold truncate" style={{ color: '#fafaf9', letterSpacing: '-0.01em' }}>{getName(taxpayer)}</p>
        <p className="text-[11px] mt-0.5 truncate" style={{ color: 'rgba(250,250,249,0.4)', fontFamily: 'JetBrains Mono, monospace' }}>
          {taxpayer.taxNumber} · {taxpayer.taxOffice || '—'} · {isCompany ? 'Şirket' : 'Şahıs'}
        </p>
      </div>

      {/* Evrak */}
      <div className="flex justify-center">
        <Check checked={!!s?.evraklarGeldi} onClick={() => onToggle('evraklarGeldi', !s?.evraklarGeldi)} title="Evrak geldi" />
      </div>

      {/* İşlendi */}
      <div className="flex justify-center">
        <Check checked={!!s?.evraklarIslendi} onClick={() => onToggle('evraklarIslendi', !s?.evraklarIslendi)} title="Evraklar işlendi" />
      </div>

      {/* İnd. KDV */}
      <div className="flex justify-center">
        <Check checked={!!s?.indirilecekKdvKontrol} onClick={() => onToggle('indirilecekKdvKontrol', !s?.indirilecekKdvKontrol)} title="İndirilecek KDV kontrol" />
      </div>

      {/* Hes. KDV */}
      <div className="flex justify-center">
        <Check checked={!!s?.hesaplananKdvKontrol} onClick={() => onToggle('hesaplananKdvKontrol', !s?.hesaplananKdvKontrol)} title="Hesaplanan KDV kontrol" />
      </div>

      {/* E-Arşiv */}
      <div className="flex justify-center">
        <Check checked={!!s?.eArsivKontrol} onClick={() => onToggle('eArsivKontrol', !s?.eArsivKontrol)} title="E-Arşiv Fatura kontrol" />
      </div>

      {/* Beyanname */}
      <div className="flex justify-center">
        <BeyannamePill
          status={beyanname}
          onClick={() => onToggle('beyannameVerildi', !s?.beyannameVerildi)}
        />
      </div>

      {/* Detay */}
      <div className="text-right">
        <Link
          href={`/panel/mukellefler/${taxpayer.id}`}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium transition-all opacity-60 group-hover:opacity-100"
          style={{ color: GOLD }}
        >
          <ChevronRight size={14} />
        </Link>
      </div>
    </div>
  );
}

function Check({ checked, onClick, title }: { checked: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center justify-center transition-all"
      style={{
        width: 24, height: 24, borderRadius: 7,
        border: checked ? `1px solid ${GOLD}` : '1px solid rgba(255,255,255,0.1)',
        background: checked ? `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})` : 'rgba(255,255,255,0.02)',
        color: checked ? '#0f0d0b' : 'transparent',
        fontWeight: 700, fontSize: 13, lineHeight: 1,
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!checked) {
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(212,184,118,0.4)';
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(212,184,118,0.06)';
        }
      }}
      onMouseLeave={(e) => {
        if (!checked) {
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.1)';
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.02)';
        }
      }}
    >
      {checked ? '✓' : ''}
    </button>
  );
}

function BeyannamePill({ status, onClick }: { status: 'verildi' | 'bekliyor' | 'verilmedi'; onClick: () => void }) {
  const s = {
    verildi:   { bg: 'rgba(34,197,94,0.1)',  color: '#22c55e', label: 'Verildi' },
    bekliyor:  { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', label: 'Bekliyor' },
    verilmedi: { bg: 'rgba(239,68,68,0.1)',  color: '#ef4444', label: 'Verilmedi' },
  }[status];
  return (
    <button
      type="button"
      onClick={onClick}
      title={status === 'verildi' ? 'Beyanname verildi — geri al için tıkla' : status === 'bekliyor' ? 'Hazır — tıklayarak "Verildi" işaretle' : 'Kontroller eksik — önce tüm kutucukları tamamla'}
      className="px-2.5 py-[4px] rounded-[8px] text-[10.5px] font-bold uppercase cursor-pointer transition-all hover:brightness-125"
      style={{ background: s.bg, color: s.color, letterSpacing: '0.06em' }}
    >
      {s.label}
    </button>
  );
}
