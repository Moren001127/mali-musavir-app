'use client';
import './aylik-takip.css';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileCheck2,
  Inbox,
  PhoneOff,
  ScanSearch,
  Search,
  Settings2,
  Upload,
  Users,
  Check as CheckIcon,
  type LucideIcon,
} from 'lucide-react';

/* Renkler aylik-takip.css içindeki değişkenlerden gelir: A teması koyu, D teması beyaz kurumsal.
   Bu dosyada yalnız yerleşim ve işlev vardır. */

type MonthlyStatus = {
  id?: string;
  evraklarGeldi: boolean;
  yuklendi: boolean;
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

// Tablodaki onay kutusu alanlarının tipi
type StatusKey =
  | 'evraklarGeldi'
  | 'yuklendi'
  | 'evraklarIslendi'
  | 'indirilecekKdvKontrol'
  | 'hesaplananKdvKontrol'
  | 'eArsivKontrol'
  | 'beyannameVerildi';
type MonthlyStatusPatch = Partial<Pick<MonthlyStatus, StatusKey | 'notes'>>;

// 'islenmedi' geriye dönük (dış bağlantı) korunuyor; 'beyanname-verilmedi' de
type FilterKey = 'all' | 'evrak-gelmedi' | 'yukleme-bekliyor' | 'islem-bekliyor' | 'kontrol-bekliyor' | 'islenmedi' | 'beyanname-bekliyor' | 'beyanname-verilmedi' | 'verildi';
type ProfileFilterKey = 'all' | 'profil-eksik' | 'telefon-yok';
type CompletenessItem = { id: string; score: number; durum: string; eksikSayisi: number; kritikEksikSayisi: number };

const AYLAR_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const FILTER_KEYS: FilterKey[] = ['all', 'evrak-gelmedi', 'yukleme-bekliyor', 'islem-bekliyor', 'kontrol-bekliyor', 'islenmedi', 'beyanname-bekliyor', 'beyanname-verilmedi', 'verildi'];
const PROFILE_FILTER_KEYS: ProfileFilterKey[] = ['all', 'profil-eksik', 'telefon-yok'];

// İş akışı aşamaları — sıradaki bekleyen adımı gösterir; ton CSS'te (data-stage) tanımlıdır
type Stage = 'evrak-bekliyor' | 'yukleme-bekliyor' | 'islem-bekliyor' | 'kontrol-bekliyor' | 'beyan-hazir' | 'verildi';
const STAGES: Record<Stage, { label: string }> = {
  'evrak-bekliyor':   { label: 'Evrak bekleniyor' },
  'yukleme-bekliyor': { label: 'Yükleme bekliyor' },
  'islem-bekliyor':   { label: 'İşleme bekliyor' },
  'kontrol-bekliyor': { label: 'Kontrol bekliyor' },
  'beyan-hazir':      { label: 'Beyanname verilebilir' },
  'verildi':          { label: 'Verildi' },
};

/** Sayaç kartları: anahtar → ton (CSS data-tone) ve simge. Dolu gradyan kart (gösterge paneli sayaçlarıyla aynı dil);
 *  toplam nötr kurşuni, aşamalar kendi renginde. */
const STAGE_CARD_META: Record<Exclude<FilterKey, 'islenmedi' | 'beyanname-verilmedi'>, { tone: string; icon: LucideIcon }> = {
  'all':                { tone: 'slate', icon: Users },
  'evrak-gelmedi':      { tone: 'amber', icon: Inbox },
  'yukleme-bekliyor':   { tone: 'teal', icon: Upload },
  'islem-bekliyor':     { tone: 'blue', icon: Settings2 },
  'kontrol-bekliyor':   { tone: 'violet', icon: ScanSearch },
  'beyanname-bekliyor': { tone: 'indigo', icon: FileCheck2 },
  'verildi':            { tone: 'green', icon: CheckCircle2 },
};

function getQueryParam(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
}

function getName(t: Taxpayer): string {
  return t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || '—';
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
  if (!s.yuklendi) return 'yukleme-bekliyor';
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
      // periodShift=-1: bu ekranda year/month İŞLEM AYI'dır, takip edilen dönem BİR ÖNCEKİ aydır
      //   (Ağustos işlem ayında Temmuz evrakı/beyannamesi takip edilir). İşe başlama/bırakma
      //   süzgeci takip dönemine göre çalışsın diye backend'e kaydırma bildirilir — aksi hâlde
      //   19.08'de açılan mükellef Temmuz listesinde "Evrak bekleniyor" olarak çıkıyordu.
      api.get('/taxpayers', { params: { search: search || undefined, year, month, periodShift: -1 } }).then(r => r.data),
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

  // Onay kutusu değişimi — iyimser güncelleme
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
            evraklarGeldi: false, yuklendi: false, evraklarIslendi: false, kontrolEdildi: false,
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
    let evrakBekliyor = 0, yuklemeBekliyor = 0, islemBekliyor = 0, kontrolBekliyor = 0, beyanHazir = 0, verildi = 0;
    for (const t of raw) {
      switch (deriveStage(t.monthlyStatus)) {
        case 'evrak-bekliyor': evrakBekliyor++; break;
        case 'yukleme-bekliyor': yuklemeBekliyor++; break;
        case 'islem-bekliyor': islemBekliyor++; break;
        case 'kontrol-bekliyor': kontrolBekliyor++; break;
        case 'beyan-hazir': beyanHazir++; break;
        case 'verildi': verildi++; break;
      }
    }
    return { total: raw.length, evrakBekliyor, yuklemeBekliyor, islemBekliyor, kontrolBekliyor, beyanHazir, verildi };
  }, [raw]);

  const matchesFilter = (t: Taxpayer): boolean => {
    const stage = deriveStage(t.monthlyStatus);
    switch (filter) {
      case 'evrak-gelmedi': return stage === 'evrak-bekliyor';
      case 'yukleme-bekliyor': return stage === 'yukleme-bekliyor';
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
  const stageCards: { key: keyof typeof STAGE_CARD_META; label: string; count: number }[] = [
    { key: 'all',                label: 'Takipteki mükellef',   count: counts.total },
    { key: 'evrak-gelmedi',      label: 'Evrak bekleniyor',     count: counts.evrakBekliyor },
    { key: 'yukleme-bekliyor',   label: 'Yükleme bekliyor',     count: counts.yuklemeBekliyor },
    { key: 'islem-bekliyor',     label: 'İşleme bekliyor',      count: counts.islemBekliyor },
    { key: 'kontrol-bekliyor',   label: 'Kontrol bekliyor',     count: counts.kontrolBekliyor },
    { key: 'beyanname-bekliyor', label: 'Beyanname verilebilir', count: counts.beyanHazir },
    { key: 'verildi',            label: 'Verildi',              count: counts.verildi },
  ];

  const profileCounts = useMemo(() => ({
    profilEksik: raw.filter(t => isProfileIncomplete(t, completenessMap.get(t.id))).length,
    telefonYok: raw.filter(t => !hasUsablePhone(t)).length,
  }), [raw, completenessMap]);
  const profileFilterBtns: { key: Exclude<ProfileFilterKey, 'all'>; label: string; count: number; icon: LucideIcon; tone: 'amber' | 'slate' }[] = [
    { key: 'profil-eksik', label: 'Profil eksik', count: profileCounts.profilEksik, icon: AlertCircle, tone: 'amber' },
    { key: 'telefon-yok', label: 'Telefon yok', count: profileCounts.telefonYok, icon: PhoneOff, tone: 'slate' },
  ];

  const donemStr = `${AYLAR_TR[month - 1]} ${year}`;
  const beyannameDonemiStr = getPreviousMonthPeriodLabel(year, month);

  const disaAktar = () => {
    const rows = [
      ['İsim','Tür','VKN/TC','VD','Evrak','Yüklendi','İşlendi','İnd.KDV','Hes.KDV','E-Arşiv','Beyanname','Not'],
      ...raw.map(t => {
        const s = t.monthlyStatus;
        return [
          getName(t),
          t.type === 'TUZEL_KISI' ? 'Şirket' : 'Şahıs',
          t.taxNumber,
          t.taxOffice,
          s?.evraklarGeldi ? 'Evet' : 'Hayır',
          s?.yuklendi ? 'Evet' : 'Hayır',
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
  };

  return (
    <div className="at-root max-w-none space-y-3">
      {/* Sayfa başlığı: simge kutusu + başlık + dönem satırı; sağda ikincil dışa aktarım */}
      <header className="at-head flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="at-head-icon grid h-9 w-9 shrink-0 place-items-center rounded-[10px]">
            <ClipboardCheck size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="at-title text-[22px] font-bold leading-tight tracking-[-0.01em]">Aylık Takip Listesi</h1>
            <p className="at-sub mt-0.5 text-[13px]" title={`${donemStr} işlem ayında ${beyannameDonemiStr} beyannameleri takip edilir`}>
              İşlem ayı <b className="at-sub-strong">{donemStr}</b>
              <span className="at-dot">·</span>
              Beyanname dönemi <b className="at-sub-strong">{beyannameDonemiStr}</b>
              <span className="at-dot">·</span>
              <b className="at-sub-strong">{counts.total}</b> mükellef takipte
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={disaAktar}
          className="at-btn-secondary inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3.5 text-[13px] font-semibold transition"
          title="Takip listesini CSV olarak indir"
        >
          <Download size={15} /> Dışa Aktar
        </button>
      </header>

      {/* Araç çubuğu: arama · ay/yıl · profil çipleri */}
      <div className="at-toolbar flex flex-wrap items-center gap-2 rounded-[12px] px-3 py-2.5">
        <label className="relative min-w-[240px] flex-1">
          <Search size={14} className="at-search-icon pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Takipteki mükellef, VKN/TC veya vergi dairesi ara..."
            className="at-input h-9 w-full rounded-[10px] py-2 pl-9 pr-3 text-[13px] outline-none"
            aria-label="Mükellef ara"
          />
        </label>

        {/* Dönem seçici */}
        <div className="at-select-group inline-flex h-9 items-center rounded-[10px]">
          <select
            value={month}
            onChange={(e) => { setMonth(parseInt(e.target.value)); setPage(1); }}
            className="at-select h-full cursor-pointer rounded-l-[10px] pl-3 pr-2 text-[13px] font-semibold outline-none"
            aria-label="İşlem ayı"
          >
            {AYLAR_TR.map((a, i) => (<option key={i} value={i + 1}>{a}</option>))}
          </select>
          <span className="at-select-sep h-[18px] w-px" />
          <select
            value={year}
            onChange={(e) => { setYear(parseInt(e.target.value)); setPage(1); }}
            className="at-select h-full cursor-pointer rounded-r-[10px] pl-2 pr-3 text-[13px] font-semibold outline-none"
            aria-label="İşlem yılı"
          >
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* İkincil profil süzgeçleri */}
        {profileFilterBtns.map((b) => {
          const Icon = b.icon;
          const active = profileFilter === b.key;
          return (
            <button
              key={b.key}
              type="button"
              aria-pressed={active}
              data-tone={b.count > 0 ? b.tone : 'zero'}
              onClick={() => { setProfileFilter(active ? 'all' : (b.key as ProfileFilterKey)); setPage(1); }}
              className="at-chip inline-flex h-8 items-center gap-1.5 rounded-full pl-2.5 pr-1.5 text-[11.5px] font-semibold transition"
              title={active ? 'Süzgeci kaldır' : `${b.label} olan mükellefleri göster`}
            >
              <Icon size={12} /> {b.label}
              <span className="at-chip-count inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold tabular-nums">{b.count}</span>
            </button>
          );
        })}
      </div>

      {/* AŞAMA SAYAÇLARI — dolu gradyan kart (gösterge paneli dili): yarı saydam simge dairesi + yüzde çipi + beyaz sayı + ince çubuk; tıklanınca süzer */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        {stageCards.map((c) => {
          const active = filter === c.key;
          const meta = STAGE_CARD_META[c.key];
          const Icon = meta.icon;
          const pct = counts.total > 0 ? Math.round((c.count / counts.total) * 100) : 0;
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
              data-tone={meta.tone}
              data-zero={c.count === 0 ? 'true' : undefined}
              aria-pressed={active}
              className="at-kpi relative overflow-hidden rounded-[14px] px-3.5 pb-3 pt-3 text-left transition"
              title={active && c.key !== 'all' ? 'Süzgeci kaldır' : `${c.label} olanları göster`}
            >
              <span className="at-kpi-halka pointer-events-none absolute -right-5 -top-7 h-[92px] w-[92px] rounded-full" aria-hidden />
              <div className="relative flex items-center justify-between gap-2">
                <span className="at-kpi-icon grid h-8 w-8 place-items-center rounded-full"><Icon size={16} strokeWidth={2.2} /></span>
                {c.key !== 'all' && <span className="at-kpi-pct rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums">%{pct}</span>}
              </div>
              <div className="at-kpi-num relative mt-2.5 text-[26px] font-extrabold leading-none tabular-nums">{c.count}</div>
              <div className="at-kpi-label relative mt-1 truncate text-[12px] font-semibold">{c.label}</div>
              <div className="at-kpi-bar relative mt-2.5 h-[4px] overflow-hidden rounded-full">
                <div className="at-kpi-bar-fill h-full rounded-full" style={{ width: `${c.key === 'all' ? 100 : pct}%` }} />
              </div>
            </button>
          );
        })}
      </div>

      {/* TABLO */}
      <div className="at-table-wrap overflow-x-auto rounded-[12px]">
        <table className="at-table w-full min-w-[1080px] table-fixed border-collapse text-left">
          <colgroup>
            <col />
            <col style={{ width: 168 }} />
            <col style={{ width: 62 }} /><col style={{ width: 66 }} /><col style={{ width: 62 }} />
            <col style={{ width: 70 }} /><col style={{ width: 70 }} /><col style={{ width: 66 }} />
            <col style={{ width: 62 }} />
            <col style={{ width: 280 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="at-th">Mükellef</th>
              <th className="at-th">Durum</th>
              <th className="at-th at-th-center" title="Evrak geldi">Evrak</th>
              <th className="at-th at-th-center" title="Sisteme yüklendi (fiş görselleri / portal faturaları)">Yüklendi</th>
              <th className="at-th at-th-center" title="Evraklar işlendi">İşlem</th>
              <th className="at-th at-th-center at-th-group" title="İndirilecek KDV kontrol">İnd. KDV</th>
              <th className="at-th at-th-center" title="Hesaplanan KDV kontrol">Hes. KDV</th>
              <th className="at-th at-th-center" title="e-Arşiv fatura kontrol">e-Arşiv</th>
              <th className="at-th at-th-center at-th-group" title="Beyanname verildi">Beyan</th>
              <th className="at-th">Not / Açıklama</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={10} className="at-td">
                  <div className="at-loading flex flex-col items-center gap-3 py-14">
                    <div className="at-spinner h-7 w-7 animate-spin rounded-full" />
                    <span className="text-[13px]">Yükleniyor...</span>
                  </div>
                </td>
              </tr>
            ) : pageItems.length === 0 ? (
              <tr>
                <td colSpan={10} className="at-td">
                  <div className="at-empty mx-3 my-3 rounded-[10px] py-12 text-center">
                    <ClipboardCheck size={22} className="at-empty-icon mx-auto mb-2" />
                    <p className="at-empty-title text-[14px] font-semibold">Kayıt bulunamadı</p>
                    <p className="at-empty-sub mt-1 text-[12px]">{donemStr} döneminde takip kaydı yok veya süzgeç eşleşmedi</p>
                  </div>
                </td>
              </tr>
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
          </tbody>
        </table>

        {/* Sayfalama */}
        {!isLoading && filtered.length > 0 && (
          <div className="at-paging flex items-center justify-between px-4 py-2.5 text-[12px]">
            <span className="tabular-nums">
              Gösterilen: {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)} / {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pageSafe <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="at-btn-secondary h-8 rounded-[8px] px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← Önceki
              </button>
              <span className="at-paging-page px-1 tabular-nums">Sayfa {pageSafe} / {totalPages}</span>
              <button
                type="button"
                disabled={pageSafe >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="at-btn-secondary h-8 rounded-[8px] px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
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
  const { label } = STAGES[stage];
  return (
    <span
      data-stage={stage}
      className="at-stage inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold"
      title={label}
    >
      <span className="at-stage-dot h-1.5 w-1.5 shrink-0 rounded-full" />
      {label}
    </span>
  );
}

type CompletenessLevel = 'tam' | 'iyi' | 'eksik' | 'kritik' | 'yok';

function completenessLevel(c?: { durum: string }): CompletenessLevel {
  if (!c) return 'yok';
  if (c.durum === 'TAM') return 'tam';
  if (c.durum === 'IYI') return 'iyi';
  if (c.durum === 'EKSIK') return 'eksik';
  return 'kritik';
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
  const stage = deriveStage(s);
  const [notesDraft, setNotesDraft] = useState(s?.notes || '');

  useEffect(() => {
    setNotesDraft(s?.notes || '');
  }, [s?.notes, taxpayer.id]);

  // v1.36.76: Profil tamamlık göstergesi
  const level = completenessLevel(completeness);
  const compTooltip = completeness
    ? `Profil: %${completeness.score}${completeness.kritikEksikSayisi > 0 ? ` · ${completeness.kritikEksikSayisi} KRİTİK eksik` : completeness.eksikSayisi > 0 ? ` · ${completeness.eksikSayisi} eksik` : ' · TAM'}`
    : 'Profil yükleniyor...';

  return (
    <tr className="at-tr">
      {/* Mükellef adı — kart bağlantısı; önünde profil tamamlık noktası (baş harf kutusu kaldırıldı, yer Not/Açıklama'ya) */}
      <td className="at-td at-td-name">
        <Link href={`/panel/mukellefler/${taxpayer.id}`} className="flex min-w-0 items-center gap-2.5" title="Mükellef kartını aç">
          <span className="at-dot-comp h-2 w-2 shrink-0 rounded-full" data-level={level} title={compTooltip} />
          <span className="flex min-w-0 items-center gap-2">
            <span className="at-name truncate text-[13.5px] font-semibold" title={getName(taxpayer)}>{getName(taxpayer)}</span>
            {completeness && completeness.score < 80 && (
              <span className="at-score shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums" data-level={level} title={compTooltip}>
                %{completeness.score}
              </span>
            )}
          </span>
        </Link>
      </td>

      {/* Durum etiketi */}
      <td className="at-td"><StatusPill stage={stage} /></td>

      {/* Evrak · Yüklendi · İşlem */}
      <td className="at-td at-td-center">
        <Check checked={!!s?.evraklarGeldi} onClick={() => onToggle('evraklarGeldi', !s?.evraklarGeldi)} title="Evrak geldi" />
      </td>
      <td className="at-td at-td-center">
        <Check checked={!!s?.yuklendi} onClick={() => onToggle('yuklendi', !s?.yuklendi)} title="Sisteme yüklendi (fiş görselleri / portal faturaları)" />
      </td>
      <td className="at-td at-td-center">
        <Check checked={!!s?.evraklarIslendi} onClick={() => onToggle('evraklarIslendi', !s?.evraklarIslendi)} title="Evraklar işlendi" />
      </td>

      {/* KDV kontrol grubu */}
      <td className="at-td at-td-center at-td-group">
        <Check checked={!!s?.indirilecekKdvKontrol} onClick={() => onToggle('indirilecekKdvKontrol', !s?.indirilecekKdvKontrol)} title="İndirilecek KDV kontrol" />
      </td>
      <td className="at-td at-td-center">
        <Check checked={!!s?.hesaplananKdvKontrol} onClick={() => onToggle('hesaplananKdvKontrol', !s?.hesaplananKdvKontrol)} title="Hesaplanan KDV kontrol" />
      </td>
      <td className="at-td at-td-center">
        <Check checked={!!s?.eArsivKontrol} onClick={() => onToggle('eArsivKontrol', !s?.eArsivKontrol)} title="e-Arşiv fatura kontrol" />
      </td>

      {/* Beyanname */}
      <td className="at-td at-td-center at-td-group">
        <Check
          checked={!!s?.beyannameVerildi}
          onClick={() => onToggle('beyannameVerildi', !s?.beyannameVerildi)}
          title={stage === 'verildi' ? 'Beyanname verildi' : stage === 'beyan-hazir' ? 'Beyanname verilebilir' : 'Beyanname verilmedi'}
        />
      </td>

      {/* Not / Açıklama */}
      <td className="at-td">
        <input
          type="text"
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
          data-filled={notesDraft ? 'true' : undefined}
          className="at-note h-8 w-full rounded-[8px] px-2.5 text-[12px] outline-none transition"
          title={notesDraft || 'Not / açıklama'}
          aria-label={`${getName(taxpayer)} notu`}
        />
      </td>
    </tr>
  );
}

function Check({ checked, onClick, title, disabled = false }: { checked: boolean; onClick: () => void; title: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={checked}
      disabled={disabled}
      className="at-check inline-flex h-[22px] w-[22px] items-center justify-center rounded-[6px] transition"
    >
      {checked ? <CheckIcon size={13} strokeWidth={3} /> : <span className="at-check-dot h-1.5 w-1.5 rounded-full" />}
    </button>
  );
}
