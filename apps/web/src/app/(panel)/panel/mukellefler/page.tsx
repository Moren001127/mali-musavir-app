'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ClipboardCheck, Search, Upload, AlertCircle, PhoneOff, Check as CheckIcon } from 'lucide-react';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';
// Satır: avatar | ad | durum etiketi | 6 onay kutusu | not
const TAXPAYER_TABLE_GRID = '34px minmax(190px, 1.2fr) 142px repeat(6, minmax(46px, 0.32fr)) minmax(150px, 0.8fr)';

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

// 'islenmedi' geriye dönük (dış bağlantı) korunuyor; 'beyanname-verilmedi' de
type FilterKey = 'all' | 'evrak-gelmedi' | 'islem-bekliyor' | 'kontrol-bekliyor' | 'islenmedi' | 'beyanname-bekliyor' | 'beyanname-verilmedi' | 'verildi';
type ProfileFilterKey = 'all' | 'profil-eksik' | 'telefon-yok';
type CompletenessItem = { id: string; score: number; durum: string; eksikSayisi: number; kritikEksikSayisi: number };

const AYLAR_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const FILTER_KEYS: FilterKey[] = ['all', 'evrak-gelmedi', 'islem-bekliyor', 'kontrol-bekliyor', 'islenmedi', 'beyanname-bekliyor', 'beyanname-verilmedi', 'verildi'];
const PROFILE_FILTER_KEYS: ProfileFilterKey[] = ['all', 'profil-eksik', 'telefon-yok'];

// İş akışı aşamaları — sıradaki bekleyen adımı gösterir, her biri farklı renk
type Stage = 'evrak-bekliyor' | 'islem-bekliyor' | 'kontrol-bekliyor' | 'beyan-hazir' | 'verildi';
const STAGES: Record<Stage, { label: string; color: string }> = {
  'evrak-bekliyor':   { label: 'Evrak bekleniyor', color: '#e0843e' },
  'islem-bekliyor':   { label: 'İşlem bekliyor',   color: '#5b9bd5' },
  'kontrol-bekliyor': { label: 'Kontrol bekliyor', color: '#a78bdb' },
  'beyan-hazir':      { label: 'Beyanname hazır',  color: GOLD },
  'verildi':          { label: 'Verildi',          color: '#4ade80' },
};

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

/** İş akışı aşaması — evrak → işlem → kontrol → beyanname */
function deriveStage(s: MonthlyStatus | null): Stage {
  if (!s) return 'evrak-bekliyor';
  if (s.beyannameVerildi) return 'verildi';
  if (!s.evraklarGeldi) return 'evrak-bekliyor';
  if (!s.evraklarIslendi) return 'islem-bekliyor';
  const kontrolBitti = s.indirilecekKdvKontrol && s.hesaplananKdvKontrol && s.eArsivKontrol;
  return kontrolBitti ? 'beyan-hazir' : 'kontrol-bekliyor';
}

/** Beyanname durumu — CSV ve geriye dönük filtre için */
function deriveBeyannameStatus(s: MonthlyStatus | null): 'verildi' | 'bekliyor' | 'verilmedi' {
  const stage = deriveStage(s);
  if (stage === 'verildi') return 'verildi';
  if (stage === 'beyan-hazir') return 'bekliyor';
  return 'verilmedi';
}

function getPreviousMonthPeriodLabel(year: number, month: number): string {
  const period = new Date(year, month - 2, 1);
  return `${AYLAR_TR[period.getMonth()]} ${period.getFullYear()}`;
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
    // Arka planda (otomasyon/başka kullanıcı) veya başka sayfada (KDV kilidi) yapılan
    // durum değişikliklerini anlık yansıt. ÖNEMLİ: Portal içinde sayfa değişimi (KDV
    // kontrol → aylık takip) "window focus" saymaz; o yüzden sayfaya her gelişte taze
    // çekmek için refetchOnMount şart. Açıkken periyodik (8 sn), başka sekmeden dönünce
    // hemen tazelenir.
    refetchOnMount: 'always',
    staleTime: 0,
    refetchInterval: 8_000,
    refetchIntervalInBackground: false, // sekme arka plandayken boşa istek atma
    refetchOnWindowFocus: true,
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

  // Aşama bazlı sayımlar — her mükellef tam olarak bir aşamada
  const counts = useMemo(() => {
    let evrakBekliyor = 0, islemBekliyor = 0, kontrolBekliyor = 0, beyanHazir = 0, verildi = 0;
    for (const t of raw) {
      switch (deriveStage(t.monthlyStatus)) {
        case 'evrak-bekliyor': evrakBekliyor++; break;
        case 'islem-bekliyor': islemBekliyor++; break;
        case 'kontrol-bekliyor': kontrolBekliyor++; break;
        case 'beyan-hazir': beyanHazir++; break;
        case 'verildi': verildi++; break;
      }
    }
    return { total: raw.length, evrakBekliyor, islemBekliyor, kontrolBekliyor, beyanHazir, verildi };
  }, [raw]);

  const matchesFilter = (t: Taxpayer): boolean => {
    const stage = deriveStage(t.monthlyStatus);
    switch (filter) {
      case 'evrak-gelmedi': return stage === 'evrak-bekliyor';
      case 'islem-bekliyor': return stage === 'islem-bekliyor';
      case 'kontrol-bekliyor': return stage === 'kontrol-bekliyor';
      case 'islenmedi': return stage === 'islem-bekliyor' || stage === 'kontrol-bekliyor';
      case 'beyanname-bekliyor': return stage === 'beyan-hazir';
      case 'beyanname-verilmedi': return stage !== 'verildi';
      case 'verildi': return stage === 'verildi';
      default: return true;
    }
  };

  const filtered = useMemo(() => {
    let list = raw.filter(matchesFilter);
    if (profileFilter === 'profil-eksik') list = list.filter(t => isProfileIncomplete(t, completenessMap.get(t.id)));
    else if (profileFilter === 'telefon-yok') list = list.filter(t => !hasUsablePhone(t));
    return list.sort((a, b) => getName(a).localeCompare(getName(b), 'tr', { sensitivity: 'base' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, filter, profileFilter, completenessMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageItems = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  // KPI = filtre kartları (sayı + tıklayınca o aşamayı süzer)
  const stageCards: { key: FilterKey; label: string; count: number; color: string }[] = [
    { key: 'all',                label: 'Takipteki mükellef', count: counts.total,          color: GOLD },
    { key: 'evrak-gelmedi',      label: 'Evrak bekleniyor', count: counts.evrakBekliyor,    color: STAGES['evrak-bekliyor'].color },
    { key: 'islem-bekliyor',     label: 'İşlem bekliyor',   count: counts.islemBekliyor,    color: STAGES['islem-bekliyor'].color },
    { key: 'kontrol-bekliyor',   label: 'Kontrol bekliyor', count: counts.kontrolBekliyor,  color: STAGES['kontrol-bekliyor'].color },
    { key: 'beyanname-bekliyor', label: 'Beyanname hazır',  count: counts.beyanHazir,       color: STAGES['beyan-hazir'].color },
    { key: 'verildi',            label: 'Verildi',          count: counts.verildi,          color: STAGES['verildi'].color },
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
  const beyannameDonemiStr = getPreviousMonthPeriodLabel(year, month);

  return (
    <div className="space-y-3 max-w-none">
      <header
        className="relative overflow-hidden rounded-[18px] border px-5 py-4"
        style={{
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.16), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(139,118,73,0.12), transparent 48%), #0f0d0b',
          borderColor: 'rgba(255,255,255,0.06)',
          boxShadow: '0 16px 42px rgba(0,0,0,0.28)',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #8b7649, #b8a06f, #d4b876, #e7cf95, #d4b876, #b8a06f)' }}
        />
        <div className="mb-3 flex items-center gap-2.5">
          <span className="h-px w-[26px]" style={{ background: GOLD }} />
          <span className="text-[10px] font-bold uppercase tracking-[.18em]" style={{ color: GOLD_SOFT }}>Mükellef CRM</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              className="grid shrink-0 place-items-center rounded-xl"
              style={{
                width: 46,
                height: 46,
                background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`,
                boxShadow: '0 8px 22px rgba(212,184,118,0.30)',
              }}
            >
              <ClipboardCheck size={24} style={{ color: '#1a1410' }} />
            </span>
            <div className="min-w-0">
              <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1.05 }}>Aylık Takip Listesi</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
                  style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.72)' }}
                >
                  İşlem ayı: {donemStr}
                </span>
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold"
                  style={{ background: 'rgba(212,184,118,0.11)', border: '1px solid rgba(212,184,118,0.32)', color: GOLD }}
                >
                  Beyanname dönemi: {beyannameDonemiStr}
                </span>
                <span className="text-[12px] font-semibold" style={{ color: 'rgba(250,250,249,0.48)' }}>
                  işe başlama/bitiş tarihine göre takipte {counts.total} mükellef
                </span>
              </div>
            </div>
          </div>
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
              const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `aylik-takip-${year}-${String(month).padStart(2,'0')}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] px-4 text-[12.5px] font-bold transition-all"
            style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b', boxShadow: '0 10px 24px rgba(212,184,118,0.16)' }}
          >
            <Upload size={14} /> Dışa Aktar
          </button>
        </div>
      </header>

      {/* TOOLBAR: arama + dönem + profil çipleri */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex-1 min-w-[240px] relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.4)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Takipteki mükellef, VKN/TC veya VD ara..."
            className="w-full rounded-[10px] py-2 pl-10 pr-3 text-[12.5px] outline-none"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
          />
        </div>

        {/* Dönem seçici */}
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

        <div
          className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[11.5px] font-bold"
          style={{ background: 'rgba(212,184,118,0.1)', border: '1px solid rgba(212,184,118,0.24)', color: GOLD }}
          title={`${donemStr} işlem ayında ${beyannameDonemiStr} beyannameleri takip edilir`}
        >
          Beyanname: {beyannameDonemiStr}
        </div>

        {/* İkincil profil filtreleri */}
        {profileFilterBtns.map((b) => {
          const Icon = b.icon;
          const active = profileFilter === b.key;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => { setProfileFilter(active ? 'all' : (b.key as ProfileFilterKey)); setPage(1); }}
              className="inline-flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[11.5px] font-semibold transition-all"
              style={{
                background: active ? 'rgba(224,168,62,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? 'rgba(224,168,62,0.32)' : 'rgba(255,255,255,0.08)'}`,
                color: active ? '#e9b75a' : 'rgba(250,250,249,0.55)',
              }}
            >
              <Icon size={12} /> {b.label} ({b.count})
            </button>
          );
        })}
      </div>

      {/* AŞAMA KARTLARI — hem KPI hem filtre */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {stageCards.map((c) => {
          const active = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                const next: FilterKey = active && c.key !== 'all' ? 'all' : c.key;
                setFilter(next);
                if (next === 'all') setProfileFilter('all');
                setPage(1);
              }}
              className="relative overflow-hidden rounded-[11px] px-3.5 py-3 text-left transition-all"
              style={{
                background: active ? `${c.color}14` : 'rgba(255,255,255,0.02)',
                border: `1px solid ${active ? `${c.color}66` : 'rgba(255,255,255,0.07)'}`,
              }}
            >
              <span className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded" style={{ background: c.color, opacity: active ? 1 : 0.5 }} />
              <div className="pl-2">
                <div className="text-[24px] leading-none font-black tabular-nums" style={{ fontFamily: 'Manrope, Inter, system-ui, sans-serif', color: active ? c.color : '#fafaf9' }}>
                  {c.count}
                </div>
                <div className="mt-1.5 text-[11px] font-semibold tracking-[0.01em]" style={{ color: active ? c.color : 'rgba(250,250,249,0.6)' }}>
                  {c.label}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* TABLO */}
      <div className="rounded-xl overflow-x-auto overflow-y-hidden" style={{ background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div
          className="grid min-w-[1180px] w-full items-center px-3 py-2.5 text-[9.5px] font-semibold uppercase"
          style={{
            gridTemplateColumns: TAXPAYER_TABLE_GRID,
            gap: 8,
            background: 'rgba(212,184,118,0.04)',
            borderBottom: '1px solid rgba(212,184,118,0.12)',
            color: 'rgba(250,250,249,0.48)',
            letterSpacing: '0.09em',
          }}
        >
          <span></span>
          <span>Mükellef</span>
          <span>Durum</span>
          <span className="text-center" title="Evrak geldi">Evrak</span>
          <span className="text-center" title="Evraklar işlendi">İşlem</span>
          <span className="text-center" title="İndirilecek KDV kontrol" style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', paddingLeft: 6 }}>İnd</span>
          <span className="text-center" title="Hesaplanan KDV kontrol">Hes</span>
          <span className="text-center" title="E-Arşiv fatura kontrol">Arşiv</span>
          <span className="text-center" title="Beyanname verildi" style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', paddingLeft: 6 }}>Beyan</span>
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
              {donemStr} döneminde takip kaydı yok veya filtre eşleşmedi
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

        {/* Sayfalama */}
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

function StatusPill({ stage }: { stage: Stage }) {
  const { label, color } = STAGES[stage];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold whitespace-nowrap"
      style={{ background: `${color}1a`, border: `1px solid ${color}40`, color }}
      title={label}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      {label}
    </span>
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
  const stage = deriveStage(s);
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
      className="grid min-w-[1180px] w-full items-center px-3 py-2 transition-all group"
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

      {/* Durum etiketi */}
      <div className="min-w-0">
        <StatusPill stage={stage} />
      </div>

      {/* Evrak */}
      <div className="flex justify-center">
        <Check checked={!!s?.evraklarGeldi} onClick={() => onToggle('evraklarGeldi', !s?.evraklarGeldi)} title="Evrak geldi" />
      </div>

      {/* İşlendi */}
      <div className="flex justify-center">
        <Check checked={!!s?.evraklarIslendi} onClick={() => onToggle('evraklarIslendi', !s?.evraklarIslendi)} title="Evraklar işlendi" />
      </div>

      {/* İnd. KDV — KDV grubu başlangıcı */}
      <div className="flex justify-center" style={{ borderLeft: '1px solid rgba(255,255,255,0.05)' }}>
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

      {/* Beyanname — beyan grubu başlangıcı */}
      <div className="flex justify-center" style={{ borderLeft: '1px solid rgba(255,255,255,0.05)' }}>
        <Check
          checked={!!s?.beyannameVerildi}
          onClick={() => onToggle('beyannameVerildi', !s?.beyannameVerildi)}
          title={stage === 'verildi' ? 'Beyanname verildi' : stage === 'beyan-hazir' ? 'Beyanname hazır' : 'Beyanname verilmedi'}
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
