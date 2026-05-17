'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Search, Upload, Plus, AlertCircle, PhoneOff, Check as CheckIcon } from 'lucide-react';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';
const TAXPAYER_TABLE_GRID = '34px minmax(230px, 1.35fr) repeat(6, minmax(54px, 0.34fr)) minmax(190px, 0.95fr)';

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
  notes?: string | null;
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
  emails?: string[];
  phone?: string;
  phones?: string[];
  address?: string;
  evrakTeslimGunu?: number | null;
  lucaSlug?: string | null;
  mihsapId?: string | null;
  defterTuru?: string | null;
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
type MonthlyStatusPatch = Partial<Pick<MonthlyStatus, StatusKey | 'notes'>>;

type FilterKey = 'all' | 'evrak-gelmedi' | 'beyanname-bekliyor' | 'beyanname-verilmedi' | 'verildi';
type ProfileFilterKey = 'all' | 'profil-eksik' | 'telefon-yok';
type CompletenessItem = { id: string; score: number; durum: string; eksikSayisi: number; kritikEksikSayisi: number };

const AYLAR_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const FILTER_KEYS: FilterKey[] = ['all', 'evrak-gelmedi', 'beyanname-bekliyor', 'beyanname-verilmedi', 'verildi'];
const PROFILE_FILTER_KEYS: ProfileFilterKey[] = ['all', 'profil-eksik', 'telefon-yok'];

function getQueryParam(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
}

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

function hasText(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

function hasUsablePhone(t: Taxpayer): boolean {
  const phones = [t.phone, ...(Array.isArray(t.phones) ? t.phones : [])];
  return phones.some(hasText);
}

function fallbackCompletenessScore(t: Taxpayer): number {
  const critical = [
    hasText(t.companyName) || (hasText(t.firstName) && hasText(t.lastName)),
    hasText(t.taxNumber),
    hasText(t.taxOffice),
    hasText(t.defterTuru),
  ];
  const important = [
    hasText(t.type),
    hasUsablePhone(t),
    hasText(t.email) || (Array.isArray(t.emails) && t.emails.some(hasText)),
    hasText(t.address),
  ];
  const useful = [
    hasText(t.evrakTeslimGunu),
    hasText(t.lucaSlug),
    hasText(t.mihsapId),
    hasText(t.startDate),
  ];

  const ratio = (items: boolean[]) => items.filter(Boolean).length / Math.max(items.length, 1);
  return Math.round((ratio(critical) * 50) + (ratio(important) * 30) + (ratio(useful) * 20));
}

function isProfileIncomplete(t: Taxpayer, completeness?: CompletenessItem): boolean {
  if (completeness) {
    return completeness.score < 80 || completeness.durum === 'EKSIK' || completeness.durum === 'KRITIK_EKSIK';
  }
  return fallbackCompletenessScore(t) < 80;
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
  const [filter, setFilter] = useState<FilterKey>(() => {
    const value = getQueryParam('filter') as FilterKey | null;
    return value && FILTER_KEYS.includes(value) ? value : 'all';
  });
  const [profileFilter, setProfileFilter] = useState<ProfileFilterKey>(() => {
    const value = getQueryParam('profile') as ProfileFilterKey | null;
    return value && PROFILE_FILTER_KEYS.includes(value) ? value : 'all';
  });
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  useEffect(() => {
    const nextFilter = getQueryParam('filter') as FilterKey | null;
    const nextProfile = getQueryParam('profile') as ProfileFilterKey | null;
    if (nextFilter && FILTER_KEYS.includes(nextFilter)) {
      setFilter(nextFilter);
      setPage(1);
    }
    if (nextProfile && PROFILE_FILTER_KEYS.includes(nextProfile)) {
      setProfileFilter(nextProfile);
      setPage(1);
    }
  }, []);

  const { data: raw = [], isLoading } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers', 'list', search, year, month],
    queryFn: () =>
      api.get('/taxpayers', { params: { search: search || undefined, year, month } }).then(r => r.data),
  });

  // v1.36.76: Tüm mükelleflerin profil tamamlığı — tek toplu fetch
  const { data: completenessSummary } = useQuery<{ taxpayers: CompletenessItem[] }>({
    queryKey: ['taxpayers-completeness-summary'],
    queryFn: () => api.get('/taxpayers/completeness/summary').then(r => r.data).catch(() => ({ taxpayers: [] })),
    staleTime: 60_000, // 1 dk cache — sürekli yeniden hesaplamasın
  });
  const completenessMap = useMemo(() => {
    const m = new Map<string, CompletenessItem>();
    (completenessSummary?.taxpayers || []).forEach((t) => m.set(t.id, t));
    return m;
  }, [completenessSummary]);

  // Checkbox toggle — optimistic update
  const updateStatus = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: MonthlyStatusPatch }) => {
      return api.patch(`/taxpayers/${id}/monthly-status`, { year, month, ...data });
    },
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ['taxpayers', 'list', search, year, month] });
      const prev = qc.getQueryData<Taxpayer[]>(['taxpayers', 'list', search, year, month]);
      qc.setQueryData<Taxpayer[]>(['taxpayers', 'list', search, year, month], (old) =>
        (old || []).map((t) => {
          if (t.id !== id) return t;
          const base: MonthlyStatus = t.monthlyStatus ?? {
            evraklarGeldi: false, evraklarIslendi: false, kontrolEdildi: false,
            beyannameVerildi: false, kdvKontrolEdildi: false,
            indirilecekKdvKontrol: false, hesaplananKdvKontrol: false, eArsivKontrol: false,
            notes: null,
          };
          return { ...t, monthlyStatus: { ...base, ...data } };
        }),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['taxpayers', 'list', search, year, month], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['taxpayers', 'list', search, year, month] });
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      qc.invalidateQueries({ queryKey: ['workflow-queue'] });
      qc.invalidateQueries({ queryKey: ['dashboard-workflow-queue'] });
      qc.invalidateQueries({ queryKey: ['moren-ai-brifing'] });
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
    if (profileFilter === 'profil-eksik') list = list.filter(t => isProfileIncomplete(t, completenessMap.get(t.id)));
    else if (profileFilter === 'telefon-yok') list = list.filter(t => !hasUsablePhone(t));
    return list.sort((a, b) => getName(a).localeCompare(getName(b), 'tr', { sensitivity: 'base' }));
  }, [raw, filter, profileFilter, completenessMap]);

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

  const profileCounts = useMemo(() => ({
    profilEksik: raw.filter(t => isProfileIncomplete(t, completenessMap.get(t.id))).length,
    telefonYok: raw.filter(t => !hasUsablePhone(t)).length,
  }), [raw, completenessMap]);
  const profileFilterBtns: { key: Exclude<ProfileFilterKey, 'all'>; label: string; count: number; icon: typeof AlertCircle }[] = [
    { key: 'profil-eksik', label: 'Profil Eksik', count: profileCounts.profilEksik, icon: AlertCircle },
    { key: 'telefon-yok', label: 'Telefon Yok', count: profileCounts.telefonYok, icon: PhoneOff },
  ];

  const donemStr = `${AYLAR_TR[month - 1]} ${year}`;

  return (
    <div className="space-y-5 max-w-none">
      {/* HEADER */}
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Ana Modül</span>
          </div>
          <h1 style={{ fontFamily: 'Manrope, Inter, system-ui, sans-serif', fontSize: 32, fontWeight: 700, color: '#fafaf9', letterSpacing: 0 }}>Mükellef Listesi</h1>
          <p className="text-[13px] mt-1.5 font-medium" style={{ color: 'rgba(250,250,249,0.52)' }}>
            {donemStr} döneminde aktif {counts.total} mükellef
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const rows = [
                ['İsim','Tür','VKN/TC','VD','Evrak','İşlendi','İnd.KDV','Hes.KDV','E-Arşiv','Beyanname','Not'],
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
                    s?.notes || '',
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
              onClick={() => { setFilter(b.key); if (b.key === 'all') setProfileFilter('all'); setPage(1); }}
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
        {profileFilterBtns.map((b) => {
          const Icon = b.icon;
          const active = profileFilter === b.key;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => { setProfileFilter(active ? 'all' : (b.key as ProfileFilterKey)); setPage(1); }}
              className="px-3.5 py-2 text-[12px] font-medium rounded-[9px] transition-all inline-flex items-center gap-1.5"
              style={{
                background: active ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? 'rgba(239,68,68,0.32)' : 'rgba(255,255,255,0.08)'}`,
                color: active ? '#fca5a5' : 'rgba(250,250,249,0.55)',
              }}
            >
              <Icon size={12} /> {b.label} ({b.count})
            </button>
          );
        })}
      </div>

      {/* STAT CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <StatCard variant="gold" label="Dönemde Aktif" value={String(counts.total)} />
        <StatCard variant="ok" label="Evrak Geldi" value={String(counts.evrakGeldi)} sub={counts.total ? `%${((counts.evrakGeldi / counts.total) * 100).toFixed(0)}` : ''} />
        <StatCard variant="danger" label="Evrak Gelmedi" value={String(counts.evrakGelmedi)} sub={counts.evrakGelmedi > 0 ? 'hatırlat' : ''} />
        <StatCard variant="warn" label="İşlenmedi" value={String(counts.islenmedi)} sub={counts.islenmedi > 0 ? 'işle' : ''} />
        <StatCard variant="warn" label="Beyanname Bekliyor" value={String(counts.beyannameBekliyor)} sub={counts.beyannameBekliyor > 0 ? 'gönder' : ''} />
        <StatCard variant="gold" label="Beyanname Verildi" value={`${counts.beyannameVerildi} / ${counts.total}`} sub={counts.total ? `%${((counts.beyannameVerildi / counts.total) * 100).toFixed(0)}` : ''} />
      </div>

      {/* TABLE */}
      <div className="rounded-xl overflow-x-auto overflow-y-hidden" style={{ background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div
          className="grid min-w-[1120px] w-full items-center px-3 py-2.5 text-[9.5px] font-semibold uppercase"
          style={{
            gridTemplateColumns: TAXPAYER_TABLE_GRID,
            gap: 8,
            background: 'rgba(212,184,118,0.045)',
            borderBottom: '1px solid rgba(212,184,118,0.13)',
            color: 'rgba(250,250,249,0.48)',
            letterSpacing: '0.09em',
          }}
        >
          <span></span>
          <span>Mükellef</span>
          <span className="text-center">Evrak</span>
          <span className="text-center">İşl.</span>
          <span className="text-center">İnd.</span>
          <span className="text-center">Hes.</span>
          <span className="text-center">Arşiv</span>
          <span className="text-center">Beyan</span>
          <span>Not / Açıklama</span>
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
              completeness={completenessMap.get(t.id)}
              onToggle={(key, value) => updateStatus.mutate({ id: t.id, data: { [key]: value } as MonthlyStatusPatch })}
              onNotesChange={(notes) => updateStatus.mutate({ id: t.id, data: { notes } })}
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
    <div className="relative rounded-[10px] px-3.5 py-2.5 overflow-hidden" style={{ background: palette.bg, border: `1px solid ${palette.border}` }}>
      <span className="absolute left-0 top-3 bottom-3 w-[2px] rounded" style={{ background: palette.line }} />
      <div className="pl-1.5">
        <div className="text-[10px] uppercase font-semibold tracking-[0.11em] mb-1.5" style={{ color: palette.lbl }}>{label}</div>
        <div className="text-[20px] leading-none font-bold tabular-nums" style={{ fontFamily: 'Manrope, Inter, system-ui, sans-serif', letterSpacing: 0, color: palette.val }}>{value}</div>
        {sub && <div className="text-[10.5px] mt-1 font-medium" style={{ color: 'rgba(250,250,249,0.42)', fontFamily: 'Manrope, Inter, system-ui, sans-serif' }}>{sub}</div>}
      </div>
    </div>
  );
}

function TaxpayerRow({
  taxpayer,
  completeness,
  onToggle,
  onNotesChange,
}: {
  taxpayer: Taxpayer;
  completeness?: { score: number; durum: string; eksikSayisi: number; kritikEksikSayisi: number };
  onToggle: (key: StatusKey, value: boolean) => void;
  onNotesChange: (notes: string) => void;
}) {
  const s = taxpayer.monthlyStatus;
  const isCompany = taxpayer.type === 'TUZEL_KISI';
  const beyanname = deriveBeyannameStatus(s);
  const [notesDraft, setNotesDraft] = useState(s?.notes || '');

  useEffect(() => {
    setNotesDraft(s?.notes || '');
  }, [s?.notes, taxpayer.id]);

  // v1.36.76: Profil tamamlık göstergesi rengi
  const compColor =
    !completeness ? 'rgba(255,255,255,0.10)' :
    completeness.durum === 'TAM' ? '#22c55e' :
    completeness.durum === 'IYI' ? '#84cc16' :
    completeness.durum === 'EKSIK' ? '#f59e0b' : '#ef4444';
  const compTooltip = completeness
    ? `Profil: %${completeness.score}${completeness.kritikEksikSayisi > 0 ? ` · ${completeness.kritikEksikSayisi} KRİTİK eksik` : completeness.eksikSayisi > 0 ? ` · ${completeness.eksikSayisi} eksik` : ' · TAM'}`
    : 'Profil yükleniyor...';

  return (
    <div
      className="grid min-w-[1120px] w-full items-center px-3 py-2 transition-all group"
      style={{
        gridTemplateColumns: TAXPAYER_TABLE_GRID,
        gap: 8,
        minHeight: 54,
        borderBottom: '1px solid rgba(255,255,255,0.035)',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(184,160,111,0.04)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      {/* Avatar — sağ üst köşede tamamlık göstergesi noktası */}
      <div className="flex justify-center">
        <div className="relative">
          <div className="w-8 h-8 rounded-[9px] flex items-center justify-center text-[11.5px] font-bold" style={{ background: 'rgba(184,160,111,0.075)', color: GOLD, border: '1px solid rgba(184,160,111,0.16)' }}>
            {getInitials(taxpayer)}
          </div>
          {/* v1.36.76: Profil tamamlık dot — avatar'ın sağ üst köşesinde */}
          <div
            className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
            style={{
              background: compColor,
              border: '1.5px solid #0f0d0b',
              boxShadow: completeness?.kritikEksikSayisi ? `0 0 6px ${compColor}` : undefined,
            }}
            title={compTooltip}
          />
        </div>
      </div>

      {/* Mükellef adı + alt bilgi — kart linki olarak */}
      <Link
        href={`/panel/mukellefler/${taxpayer.id}`}
        className="min-w-0 block transition-colors"
        title="Mükellef kartını aç"
      >
        <div className="flex items-center gap-2">
          <p
            className="text-[13.5px] font-semibold truncate transition-colors hover:text-[#d4b876]"
            style={{ color: '#fafaf9', letterSpacing: '-0.01em' }}
          >
            {getName(taxpayer)}
          </p>
          {completeness && completeness.score < 80 && (
            <span
              className="text-[10px] tabular-nums font-bold px-1.5 py-0.5 rounded shrink-0"
              style={{ background: `${compColor}22`, color: compColor }}
              title={compTooltip}
            >
              %{completeness.score}
            </span>
          )}
        </div>
        <p className="text-[11.5px] mt-0.5 truncate" style={{ color: 'rgba(250,250,249,0.46)', fontFamily: 'Manrope, Inter, system-ui, sans-serif' }}>
          {taxpayer.taxNumber} · {taxpayer.taxOffice || '—'} · {isCompany ? 'Şirket' : 'Şahıs'}
        </p>
      </Link>

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
        <Check
          checked={!!s?.beyannameVerildi}
          onClick={() => onToggle('beyannameVerildi', !s?.beyannameVerildi)}
          title={beyanname === 'verildi' ? 'Beyanname verildi' : beyanname === 'bekliyor' ? 'Beyanname bekliyor' : 'Beyanname verilmedi'}
        />
      </div>

      {/* Not / Açıklama */}
      <input
        value={notesDraft}
        onChange={(e) => setNotesDraft(e.target.value)}
        onBlur={() => {
          const next = notesDraft.trim();
          setNotesDraft(next);
          if ((s?.notes || '') !== next) onNotesChange(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        maxLength={1000}
        placeholder="Not ekle..."
        className="h-8 w-full rounded-[7px] px-2.5 text-[11.5px] outline-none transition-colors"
        style={{
          background: notesDraft ? 'rgba(212,184,118,0.055)' : 'rgba(255,255,255,0.025)',
          border: `1px solid ${notesDraft ? 'rgba(212,184,118,0.20)' : 'rgba(255,255,255,0.065)'}`,
          color: '#fafaf9',
        }}
        title={notesDraft || 'Not / açıklama'}
      />

    </div>
  );
}

function Check({ checked, onClick, title }: { checked: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center justify-center transition-all hover:brightness-110"
      style={{
        width: 22, height: 22, borderRadius: 7,
        border: checked ? '1px solid rgba(74,222,128,0.55)' : '1px solid rgba(255,255,255,0.12)',
        background: checked ? 'rgba(74,222,128,0.16)' : 'rgba(255,255,255,0.035)',
        color: checked ? '#4ade80' : 'rgba(250,250,249,0.28)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!checked) {
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(212,184,118,0.42)';
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(212,184,118,0.07)';
        }
      }}
      onMouseLeave={(e) => {
        if (!checked) {
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.12)';
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.035)';
        }
      }}
    >
      {checked ? <CheckIcon size={13} strokeWidth={2.8} /> : <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'rgba(250,250,249,0.25)' }} />}
    </button>
  );
}
