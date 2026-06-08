'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Building2,
  ChevronDown,
  FileText,
  List,
  Plus,
  Search,
  Smartphone,
  User,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';
const GREEN = '#00a65a';
const ROSE = '#e74c3c';
const SKY = '#4f86c9';
const AMBER = '#f59e0b';
const CARD = 'rgba(255,255,255,0.022)';
const LINE = 'rgba(255,255,255,0.075)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const FAINT = 'rgba(250,250,249,0.38)';

type Taxpayer = {
  id: string;
  type: 'GERCEK_KISI' | 'TUZEL_KISI';
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
  taxOffice?: string | null;
  email?: string | null;
  emails?: string[];
  phone?: string | null;
  phones?: string[];
  startDate?: string | null;
  endDate?: string | null;
  isActive: boolean;
  isEFaturaMukellefi?: boolean;
  logoUrl?: string | null;
  defterTuru?: string | null;
  mihsapDefterTuru?: string | null;
  lucaSlug?: string | null;
  mihsapId?: string | null;
  hattatId?: string | null;
  cariHizmetCount?: number;
  aktifCariHizmetCount?: number;
  cariTakipAktif?: boolean;
  hasVergiDairesiCredential?: boolean;
  hasSgkCredential?: boolean;
};

type TypeFilter = 'TUMU' | 'FIRMA' | 'SAHIS' | 'BASIT';
type StatusFilter = 'active' | 'inactive' | 'all';

const LETTERS = ['A', 'B', 'C', 'Ç', 'D', 'E', 'F', 'G', 'Ğ', 'H', 'I', 'İ', 'J', 'K', 'L', 'M', 'N', 'O', 'Ö', 'P', 'R', 'S', 'Ş', 'T', 'U', 'Ü', 'V', 'Y', 'Z', 'W', 'X', 'Q'];

const TYPE_FILTERS: Array<{ key: TypeFilter; label: string; icon: LucideIcon; color: string }> = [
  { key: 'FIRMA', label: 'FİRMA', icon: Building2, color: '#e74c3c' },
  { key: 'SAHIS', label: 'ŞAHIS', icon: User, color: '#18aee2' },
  { key: 'BASIT', label: 'BASİT', icon: FileText, color: '#f59e0b' },
  { key: 'TUMU', label: 'TÜMÜ', icon: List, color: '#00a65a' },
];

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'active', label: 'Aktif' },
  { key: 'inactive', label: 'Pasif' },
  { key: 'all', label: 'Tümü' },
];

function taxpayerName(t: Taxpayer): string {
  return (t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || 'Mükellef').trim();
}

function initials(t: Taxpayer): string {
  const name = taxpayerName(t);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toLocaleUpperCase('tr-TR');
  return name.slice(0, 2).toLocaleUpperCase('tr-TR');
}

function cleanList(values: Array<string | null | undefined>): string[] {
  return values.map((v) => String(v || '').trim()).filter(Boolean);
}

function primaryPhone(t: Taxpayer): string {
  return cleanList([t.phone, ...(t.phones || [])])[0] || '';
}

function primaryEmail(t: Taxpayer): string {
  return cleanList([t.email, ...(t.emails || [])])[0] || '';
}

function isBasit(t: Taxpayer): boolean {
  const value = `${t.mihsapDefterTuru || ''}`.toLocaleUpperCase('tr-TR');
  return /BASIT|BASİT|BASIT[_\s-]*USUL/.test(value);
}

function typeLabel(t: Taxpayer): string {
  if (isBasit(t)) return 'BASİT';
  return t.type === 'TUZEL_KISI' ? 'FİRMA' : 'ŞAHIS';
}

function matchesType(t: Taxpayer, filter: TypeFilter): boolean {
  if (filter === 'TUMU') return true;
  if (filter === 'BASIT') return isBasit(t);
  if (filter === 'FIRMA') return t.type === 'TUZEL_KISI' && !isBasit(t);
  return t.type === 'GERCEK_KISI' && !isBasit(t);
}

function matchesLetter(t: Taxpayer, letter: string): boolean {
  if (letter === 'TÜMÜ') return true;
  return taxpayerName(t).toLocaleUpperCase('tr-TR').startsWith(letter);
}

export default function MukellefListesiPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('TUMU');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [letter, setLetter] = useState('TÜMÜ');

  const { data: taxpayers = [], isLoading } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers', 'directory', search],
    queryFn: () =>
      api
        .get('/taxpayers', {
          params: { scope: 'directory', status: 'all', search: search || undefined },
        })
        .then((res) => res.data),
    staleTime: 30_000,
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.put(`/taxpayers/${id}`, { isActive }),
    onSuccess: (_res, vars) => {
      toast.success(vars.isActive ? 'Mükellef aktife alındı' : 'Mükellef pasife alındı');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
    },
    onError: () => toast.error('Durum güncellenemedi'),
  });

  const deleteTaxpayer = useMutation({
    mutationFn: (id: string) => api.delete(`/taxpayers/${id}`),
    onSuccess: () => {
      toast.success('Mükellef silindi');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Mükellef silinemedi'),
  });

  const counts = useMemo(() => {
    const active = taxpayers.filter((t) => t.isActive).length;
    const inactive = taxpayers.filter((t) => !t.isActive).length;
    const firm = taxpayers.filter((t) => t.type === 'TUZEL_KISI' && !isBasit(t)).length;
    const person = taxpayers.filter((t) => t.type === 'GERCEK_KISI' && !isBasit(t)).length;
    const basit = taxpayers.filter(isBasit).length;
    return { active, inactive, firm, person, basit, total: taxpayers.length };
  }, [taxpayers]);

  const filtered = useMemo(() => {
    const collator = new Intl.Collator('tr', { sensitivity: 'base' });
    return taxpayers
      .filter((t) => {
        if (statusFilter === 'active' && !t.isActive) return false;
        if (statusFilter === 'inactive' && t.isActive) return false;
        return matchesType(t, typeFilter) && matchesLetter(t, letter);
      })
      .sort((a, b) => collator.compare(taxpayerName(a), taxpayerName(b)));
  }, [taxpayers, statusFilter, typeFilter, letter]);

  return (
    <div className="max-w-none space-y-4">
      <header
        className="flex flex-wrap items-end justify-between gap-3 rounded-[8px] px-4 py-3.5"
        style={{ background: CARD, border: `1px solid ${LINE}`, boxShadow: '0 12px 30px rgba(0,0,0,0.18)' }}
      >
        <div>
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="h-px w-[26px]" style={{ background: GOLD }} />
            <span className="text-[9.5px] font-bold uppercase tracking-[.18em]" style={{ color: GOLD_SOFT }}>Mükellef CRM</span>
          </div>
          <h1 style={{ fontFamily: 'Manrope, Inter, system-ui, sans-serif', fontSize: 27, fontWeight: 800, color: TEXT, letterSpacing: 0 }}>Mükellef Listesi</h1>
          <p className="mt-1 text-[12.5px] font-medium" style={{ color: MUTED }}>
            {counts.active} aktif, {counts.inactive} pasif, toplam {counts.total} kayıt
          </p>
        </div>
        <Link
          href="/panel/mukellefler/yeni"
          className="inline-flex items-center gap-1.5 rounded-[8px] px-4 py-2 text-[12.5px] font-bold transition-all"
          style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b' }}
        >
          <Plus size={14} /> Yeni Mükellef
        </Link>
      </header>

      <section
        className="rounded-[8px] p-3"
        style={{ background: 'rgba(255,255,255,0.018)', border: `1px solid ${LINE}` }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map((item) => {
              const Icon = item.icon;
              const active = typeFilter === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTypeFilter(item.key)}
                  className="inline-flex h-10 items-center gap-2 rounded-[6px] px-3.5 text-[13px] font-bold transition"
                  style={{
                    background: active ? item.color : 'rgba(255,255,255,0.035)',
                    border: `1px solid ${active ? item.color : 'rgba(255,255,255,0.09)'}`,
                    color: active ? '#fff' : 'rgba(250,250,249,0.72)',
                  }}
                  title={`${item.label} filtresi`}
                >
                  <Icon size={15} /> {item.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[280px] flex-1">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: FAINT }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="İsim, VKN/TC, vergi dairesi ara..."
                className="h-10 w-full rounded-[8px] py-2 pl-10 pr-3 text-[12.5px] outline-none"
                style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.09)', color: TEXT }}
              />
            </div>
            <div className="inline-flex rounded-[8px] p-1" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {STATUS_FILTERS.map((item) => {
                const active = statusFilter === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setStatusFilter(item.key)}
                    className="h-8 rounded-[6px] px-3 text-[12px] font-bold transition"
                    style={{ background: active ? `${GOLD}26` : 'transparent', color: active ? GOLD : MUTED }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section
        className="grid grid-cols-[repeat(auto-fit,minmax(42px,1fr))] gap-px overflow-hidden rounded-[8px]"
        style={{ border: `1px solid ${LINE}`, background: LINE }}
      >
        {[...LETTERS, 'TÜMÜ'].map((item) => {
          const active = letter === item;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setLetter(item)}
              className="h-10 text-[13px] font-bold transition"
              style={{ background: active ? 'rgba(212,184,118,0.18)' : 'rgba(255,255,255,0.028)', color: active ? GOLD : 'rgba(250,250,249,0.68)' }}
            >
              {item}
            </button>
          );
        })}
      </section>

      {isLoading ? (
        <div className="rounded-[8px] py-16 text-center" style={{ background: CARD, border: `1px solid ${LINE}`, color: MUTED }}>
          Yükleniyor...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[8px] py-16 text-center" style={{ background: CARD, border: `1px solid ${LINE}` }}>
          <p className="text-[14px] font-semibold" style={{ color: TEXT }}>Kayıt bulunamadı</p>
          <p className="mt-1 text-[12px]" style={{ color: FAINT }}>Seçili filtrelerde mükellef yok</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((taxpayer) => (
            <TaxpayerCard
              key={taxpayer.id}
              taxpayer={taxpayer}
              onToggle={() => toggleActive.mutate({ id: taxpayer.id, isActive: !taxpayer.isActive })}
              busy={toggleActive.isPending}
              onDelete={() => {
                if (confirm(`${taxpayerName(taxpayer)} silinsin mi?`)) deleteTaxpayer.mutate(taxpayer.id);
              }}
              deleteBusy={deleteTaxpayer.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaxpayerCard({
  taxpayer,
  onToggle,
  busy,
  onDelete,
  deleteBusy,
}: {
  taxpayer: Taxpayer;
  onToggle: () => void;
  busy: boolean;
  onDelete: () => void;
  deleteBusy: boolean;
}) {
  const name = taxpayerName(taxpayer);
  const phone = primaryPhone(taxpayer);
  const email = primaryEmail(taxpayer);
  const type = typeLabel(taxpayer);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);

  return (
    <article
      className="group grid gap-3 rounded-[8px] p-3 transition md:grid-cols-[74px_minmax(0,1fr)_96px]"
      style={{
        background: 'linear-gradient(180deg, rgba(18,18,17,0.98), rgba(10,10,10,0.98))',
        border: '1px solid rgba(212,184,118,0.16)',
        boxShadow: '0 10px 24px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.035)',
      }}
    >
      <div className="flex h-[74px] items-center justify-center overflow-hidden rounded-[7px]" style={{ background: 'linear-gradient(135deg, #21313b, #516979)', border: '1px solid rgba(255,255,255,0.12)' }}>
        {taxpayer.logoUrl ? (
          <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${taxpayer.logoUrl})` }} />
        ) : (
          <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full text-[16px] font-black" style={{ background: 'rgba(11,16,22,0.38)', color: '#fff', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
            {initials(taxpayer)}
          </div>
        )}
      </div>

      <div className="min-w-0 py-0.5">
        <div className="flex min-w-0 items-start gap-2">
          <Link href={`/panel/mukellefler/${taxpayer.id}`} className="min-w-0 flex-1">
            <h2 className="truncate text-[18px] font-black leading-tight transition group-hover:text-[#d4b876]" style={{ color: TEXT, fontFamily: 'Inter, Manrope, system-ui, sans-serif', letterSpacing: 0 }}>{name}</h2>
          </Link>
          <span
            className="shrink-0 rounded-[5px] px-2 py-1 text-[10.5px] font-black"
            style={{
              background: type === 'BASİT' ? 'rgba(245,158,11,0.16)' : type === 'FİRMA' ? 'rgba(79,134,201,0.18)' : 'rgba(24,174,226,0.18)',
              color: type === 'BASİT' ? AMBER : '#7fc2f0',
            }}
          >
            {type}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <HattatPresenceIcon active={!!taxpayer.hasVergiDairesiCredential} kind="gib" title="Vergi dairesi şifresi" />
          <HattatPresenceIcon active={!!taxpayer.hasSgkCredential} kind="sgk" title="SGK e-Bildirge şifresi" />
          <HattatPresenceIcon active={!!email} kind="mail" title="E-posta" />
          <HattatPresenceIcon active={!!phone} kind="phone" title="Telefon" />
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-2 md:items-end">
        <div className="relative w-full md:w-auto">
          <button
            type="button"
            onClick={() => setStatusMenuOpen((v) => !v)}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-[6px] px-2.5 py-2 text-[12px] font-black transition hover:brightness-110 disabled:opacity-40 md:w-[90px]"
            style={{
              background: taxpayer.isActive ? 'rgba(0,166,90,0.14)' : 'rgba(96,121,135,0.14)',
              border: `1px solid ${taxpayer.isActive ? 'rgba(0,166,90,0.36)' : 'rgba(96,121,135,0.32)'}`,
              color: taxpayer.isActive ? '#39d17e' : '#9fb1bb',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035)',
            }}
          >
            <BadgeCheck size={14} /> {taxpayer.isActive ? 'Aktif' : 'Pasif'} <ChevronDown size={13} />
          </button>
          {statusMenuOpen && (
            <div
              className="absolute right-0 top-[calc(100%+6px)] z-20 w-[150px] overflow-hidden rounded-[7px] border p-1 shadow-2xl"
              style={{ background: '#141414', borderColor: LINE }}
            >
              <button
                type="button"
                onClick={() => {
                  setStatusMenuOpen(false);
                  onToggle();
                }}
                disabled={busy}
                className="w-full rounded-[5px] px-3 py-2 text-left text-[12px] font-bold transition hover:bg-white/[0.06] disabled:opacity-40"
                style={{ color: taxpayer.isActive ? '#ff9aae' : '#7eeaa5' }}
              >
                {taxpayer.isActive ? 'Pasife al' : 'Aktife al'}
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteBusy}
          className="inline-flex h-8 items-center justify-center rounded-[6px] px-3 text-[12px] font-black transition hover:brightness-110 disabled:opacity-40 md:w-[64px]"
          style={{
            background: 'rgba(216,27,96,0.13)',
            border: '1px solid rgba(216,27,96,0.36)',
            color: '#ff8fb0',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035)',
          }}
          title="Mükellefi sil"
        >
          Sil
        </button>
      </div>
    </article>
  );
}

function PresenceIcon({ active, icon: Icon, title }: { active: boolean; icon: LucideIcon; title: string }) {
  const color = active ? GREEN : ROSE;
  return (
    <span
      title={`${title}: ${active ? 'tanımlı' : 'eksik'}`}
      aria-label={`${title}: ${active ? 'tanımlı' : 'eksik'}`}
      className="inline-flex h-10 w-10 items-center justify-center rounded-[5px]"
      style={{
        background: active ? 'rgba(34,197,94,0.13)' : 'rgba(251,113,133,0.12)',
        border: `1px solid ${active ? 'rgba(34,197,94,0.32)' : 'rgba(251,113,133,0.32)'}`,
        color,
      }}
    >
      <Icon size={17} />
    </span>
  );
}

type HattatIconKind = 'gib' | 'sgk' | 'mail' | 'phone';

function HattatPresenceIcon({ active, kind, title }: { active: boolean; kind: HattatIconKind; title: string }) {
  const color = active ? GREEN : ROSE;
  return (
    <span
      title={`${title}: ${active ? 'tanımlı' : 'eksik'}`}
      aria-label={`${title}: ${active ? 'tanımlı' : 'eksik'}`}
      className="inline-flex h-[34px] min-w-[38px] items-center justify-center rounded-[6px] px-2"
      style={{
        background: active ? 'rgba(0,166,90,0.12)' : 'rgba(231,76,60,0.10)',
        border: `1px solid ${active ? 'rgba(0,166,90,0.34)' : 'rgba(231,76,60,0.30)'}`,
        color,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035), 0 1px 0 rgba(0,0,0,0.18)',
      }}
    >
      {kind === 'gib' && <GibMark color={color} />}
      {kind === 'sgk' && <span className="font-serif text-[10.5px] font-black leading-none">SGK</span>}
      {kind === 'mail' && <EnvelopeMark color={color} />}
      {kind === 'phone' && <Smartphone size={16} strokeWidth={2.55} />}
    </span>
  );
}

function GibMark({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 100 100" width="22" height="22" aria-hidden="true">
      <path
        d="M53.8 8.8C32.7 23.6 21.7 45.2 23.5 72.7c.5 7.1 2.1 13.4 4.4 18.5H48C38 64.6 40.8 35.2 64.8 8.8h-11Z"
        fill={color}
      />
      <path
        d="M56.3 47.8h32.4L79.6 91.2H48.4l8.8-36.5H50l1.6-6.9h4.7Z"
        fill={color}
      />
      <ellipse cx="76.2" cy="29.4" rx="12.8" ry="17.5" transform="rotate(9 76.2 29.4)" fill={color} />
    </svg>
  );
}

function EnvelopeMark({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 32 24" width="22" height="18" aria-hidden="true">
      <path d="M3.2 3.2h25.6v17.6H3.2V3.2Z" fill={color} />
      <path d="M4.7 5.1 16 13.1 27.3 5.1" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" opacity="0.96" />
      <path d="M4.8 20 13.1 12.8M27.2 20 18.9 12.8" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" opacity="0.78" />
    </svg>
  );
}
