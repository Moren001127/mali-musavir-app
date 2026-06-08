'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  BadgeCheck,
  BookOpen,
  Building2,
  CalendarDays,
  Eye,
  FileText,
  Hash,
  Landmark,
  LayoutGrid,
  List,
  Mail,
  MapPin,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Smartphone,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';
const GREEN = '#22c55e';
const ROSE = '#ef4e6d';
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
  address?: string | null;
  notes?: string | null;
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
  naceKodu?: string | null;
  eFaturaEntegrator?: string | null;
  createdAt?: string | null;
  _count?: { taxDeclarations?: number; documents?: number };
};

type TypeFilter = 'TUMU' | 'FIRMA' | 'SAHIS' | 'BASIT';
type StatusFilter = 'active' | 'inactive' | 'all';
type ViewMode = 'cards' | 'table';

const LETTERS = ['A', 'B', 'C', 'Ç', 'D', 'E', 'F', 'G', 'Ğ', 'H', 'I', 'İ', 'J', 'K', 'L', 'M', 'N', 'O', 'Ö', 'P', 'R', 'S', 'Ş', 'T', 'U', 'Ü', 'V', 'Y', 'Z', 'W', 'X', 'Q'];

const TYPE_FILTERS: Array<{ key: TypeFilter; label: string; icon: typeof Building2; color: string }> = [
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
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
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

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function isBasit(t: Taxpayer): boolean {
  const value = `${t.defterTuru || ''} ${t.mihsapDefterTuru || ''}`.toUpperCase();
  return /ISLETME|İŞLETME|DEFTER[_\s-]*BEYAN/.test(value);
}

function typeLabel(t: Taxpayer): string {
  if (isBasit(t)) return 'BASİT';
  return t.type === 'TUZEL_KISI' ? 'FİRMA' : 'ŞAHIS';
}

function matchesType(t: Taxpayer, filter: TypeFilter): boolean {
  if (filter === 'TUMU') return true;
  if (filter === 'FIRMA') return t.type === 'TUZEL_KISI';
  if (filter === 'SAHIS') return t.type === 'GERCEK_KISI';
  return isBasit(t);
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
  const [view, setView] = useState<ViewMode>('cards');

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

  const counts = useMemo(() => {
    const active = taxpayers.filter((t) => t.isActive).length;
    const inactive = taxpayers.filter((t) => !t.isActive).length;
    const firm = taxpayers.filter((t) => t.type === 'TUZEL_KISI').length;
    const person = taxpayers.filter((t) => t.type === 'GERCEK_KISI').length;
    return { active, inactive, firm, person, total: taxpayers.length };
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
    <div className="space-y-4 max-w-none">
      <header
        className="flex flex-wrap items-end justify-between gap-3 rounded-[8px] px-4 py-3.5"
        style={{ background: CARD, border: `1px solid ${LINE}`, boxShadow: '0 12px 30px rgba(0,0,0,0.18)' }}
      >
        <div>
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="h-px w-[26px]" style={{ background: GOLD }} />
            <span className="text-[9.5px] uppercase font-bold tracking-[.18em]" style={{ color: GOLD_SOFT }}>Mükellef CRM</span>
          </div>
          <h1 style={{ fontFamily: 'Manrope, Inter, system-ui, sans-serif', fontSize: 27, fontWeight: 800, color: TEXT, letterSpacing: 0 }}>Mükellef Listesi</h1>
          <p className="mt-1 text-[12.5px] font-medium" style={{ color: MUTED }}>
            {counts.active} aktif, {counts.inactive} pasif, toplam {counts.total} kayıt
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView((v) => (v === 'cards' ? 'table' : 'cards'))}
            className="inline-flex items-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[12.5px] font-semibold transition-all"
            style={{ background: 'rgba(79,134,201,0.12)', border: '1px solid rgba(79,134,201,0.28)', color: '#9fc6f2' }}
          >
            {view === 'cards' ? <List size={14} /> : <LayoutGrid size={14} />}
            Görünüm
          </button>
          <Link
            href="/panel/mukellefler/yeni"
            className="inline-flex items-center gap-1.5 rounded-[8px] px-4 py-2 text-[12.5px] font-bold transition-all"
            style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b' }}
          >
            <Plus size={14} /> Yeni Mükellef
          </Link>
        </div>
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

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard label="Aktif" value={counts.active} color={GREEN} />
        <StatCard label="Pasif" value={counts.inactive} color={ROSE} />
        <StatCard label="Firma" value={counts.firm} color={SKY} />
        <StatCard label="Şahıs" value={counts.person} color={AMBER} />
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
      ) : view === 'cards' ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((taxpayer) => (
            <TaxpayerCard
              key={taxpayer.id}
              taxpayer={taxpayer}
              onToggle={() => toggleActive.mutate({ id: taxpayer.id, isActive: !taxpayer.isActive })}
              busy={toggleActive.isPending}
            />
          ))}
        </div>
      ) : (
        <TaxpayerTable
          taxpayers={filtered}
          onToggle={(taxpayer) => toggleActive.mutate({ id: taxpayer.id, isActive: !taxpayer.isActive })}
          busy={toggleActive.isPending}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-[8px] px-4 py-3" style={{ background: CARD, border: `1px solid ${LINE}` }}>
      <div className="text-[23px] font-black tabular-nums" style={{ color }}>{value}</div>
      <div className="mt-1 text-[11.5px] font-semibold" style={{ color: MUTED }}>{label}</div>
    </div>
  );
}

function TaxpayerCard({ taxpayer, onToggle, busy }: { taxpayer: Taxpayer; onToggle: () => void; busy: boolean }) {
  const name = taxpayerName(taxpayer);
  const phone = primaryPhone(taxpayer);
  const email = primaryEmail(taxpayer);
  const type = typeLabel(taxpayer);
  const statusColor = taxpayer.isActive ? GREEN : ROSE;

  return (
    <article
      className="grid gap-4 rounded-[8px] p-4 md:grid-cols-[150px_minmax(0,1fr)_190px]"
      style={{ background: CARD, border: `1px solid ${LINE}`, boxShadow: '0 12px 30px rgba(0,0,0,0.16)' }}
    >
      <div className="flex h-[150px] items-center justify-center overflow-hidden rounded-[6px]" style={{ background: 'rgba(79,134,201,0.24)', border: '1px solid rgba(79,134,201,0.22)' }}>
        {taxpayer.logoUrl ? (
          <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${taxpayer.logoUrl})` }} />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full text-[24px] font-black" style={{ background: 'rgba(255,255,255,0.16)', color: TEXT }}>
            {initials(taxpayer)}
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-start gap-2">
          <Link href={`/panel/mukellefler/${taxpayer.id}`} className="min-w-0 flex-1">
            <h2 className="truncate text-[19px] font-black leading-tight transition hover:text-[#d4b876]" style={{ color: TEXT }}>{name}</h2>
          </Link>
          <span className="rounded-[5px] px-2 py-1 text-[11px] font-black" style={{ background: type === 'FİRMA' ? 'rgba(79,134,201,0.18)' : 'rgba(24,174,226,0.18)', color: type === 'BASİT' ? AMBER : '#7fc2f0' }}>
            {type}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <MiniIcon active={!!taxpayer.isEFaturaMukellefi} icon={FileText} title="E-Fatura" />
          <MiniIcon active={!!taxpayer._count?.documents} icon={BookOpen} title="Evrak" />
          <MiniIcon active={!!email} icon={Mail} title={email || 'E-posta yok'} />
          <MiniIcon active={!!phone} icon={Smartphone} title={phone || 'Telefon yok'} />
        </div>

        <div className="mt-4 grid gap-2 text-[12px] md:grid-cols-2" style={{ color: MUTED }}>
          <InfoLine icon={Landmark} label={taxpayer.taxNumber || '-'} />
          <InfoLine icon={MapPin} label={taxpayer.taxOffice || '-'} />
          <InfoLine icon={CalendarDays} label={`Başlama ${formatDate(taxpayer.startDate)}`} />
          <InfoLine icon={CalendarDays} label={`Bitiş ${formatDate(taxpayer.endDate)}`} />
          <InfoLine icon={Hash} label={taxpayer.naceKodu || taxpayer.hattatId || '-'} />
          <InfoLine icon={Phone} label={phone || '-'} />
        </div>

        {taxpayer.notes && (
          <p className="mt-3 line-clamp-2 rounded-[6px] px-3 py-2 text-[12px]" style={{ background: 'rgba(255,255,255,0.028)', color: FAINT }}>
            {taxpayer.notes}
          </p>
        )}
      </div>

      <div className="flex flex-col items-stretch gap-2 md:items-end">
        <span
          className="inline-flex items-center justify-center gap-1.5 rounded-[6px] px-3 py-2 text-[12px] font-black"
          style={{ background: `${statusColor}22`, border: `1px solid ${statusColor}44`, color: statusColor }}
        >
          <BadgeCheck size={14} /> {taxpayer.isActive ? 'Aktif' : 'Pasif'}
        </span>
        <span className="inline-flex items-center justify-center rounded-[6px] px-3 py-2 text-[12px] font-black" style={{ background: 'rgba(34,197,94,0.16)', color: '#70e69e' }}>
          Cari Aktif
        </span>
        <Link
          href={`/panel/mukellefler/${taxpayer.id}`}
          className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-[6px] px-3 py-2 text-[12.5px] font-bold"
          style={{ background: 'rgba(79,134,201,0.13)', border: '1px solid rgba(79,134,201,0.28)', color: '#a9cdf5' }}
        >
          <Eye size={14} /> Kartı Aç
        </Link>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 rounded-[6px] px-3 py-2 text-[12.5px] font-bold transition disabled:opacity-40"
          style={{
            background: taxpayer.isActive ? 'rgba(239,78,109,0.12)' : 'rgba(34,197,94,0.13)',
            border: `1px solid ${taxpayer.isActive ? 'rgba(239,78,109,0.30)' : 'rgba(34,197,94,0.30)'}`,
            color: taxpayer.isActive ? '#ff9aae' : '#7eeaa5',
          }}
        >
          {taxpayer.isActive ? <Archive size={14} /> : <RotateCcw size={14} />}
          {taxpayer.isActive ? 'Pasife Al' : 'Aktife Al'}
        </button>
      </div>
    </article>
  );
}

function MiniIcon({ active, icon: Icon, title }: { active: boolean; icon: typeof FileText; title: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-9 w-9 items-center justify-center rounded-[5px]"
      style={{ background: active ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.026)', border: `1px solid ${active ? 'rgba(34,197,94,0.28)' : 'rgba(255,255,255,0.08)'}`, color: active ? '#6ee7a2' : FAINT }}
    >
      <Icon size={16} />
    </span>
  );
}

function InfoLine({ icon: Icon, label }: { icon: typeof Landmark; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon size={13} style={{ color: GOLD }} />
      <span className="truncate">{label}</span>
    </div>
  );
}

function TaxpayerTable({ taxpayers, onToggle, busy }: { taxpayers: Taxpayer[]; onToggle: (taxpayer: Taxpayer) => void; busy: boolean }) {
  return (
    <div className="overflow-x-auto rounded-[8px]" style={{ background: CARD, border: `1px solid ${LINE}` }}>
      <div className="grid min-w-[1050px] grid-cols-[minmax(260px,1.2fr)_120px_145px_140px_160px_150px_150px] gap-3 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: FAINT, background: 'rgba(212,184,118,0.045)' }}>
        <span>Mükellef</span>
        <span>Tip</span>
        <span>VKN/TC</span>
        <span>Vergi Dairesi</span>
        <span>Başlama / Bitiş</span>
        <span>Durum</span>
        <span>Aksiyon</span>
      </div>
      {taxpayers.map((taxpayer) => (
        <div key={taxpayer.id} className="grid min-w-[1050px] grid-cols-[minmax(260px,1.2fr)_120px_145px_140px_160px_150px_150px] items-center gap-3 px-4 py-3 text-[12.5px]" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: MUTED }}>
          <Link href={`/panel/mukellefler/${taxpayer.id}`} className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] text-[12px] font-black" style={{ background: 'rgba(184,160,111,0.10)', color: GOLD }}>
              {initials(taxpayer)}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-bold" style={{ color: TEXT }}>{taxpayerName(taxpayer)}</span>
              <span className="block truncate text-[11px]" style={{ color: FAINT }}>{primaryPhone(taxpayer) || primaryEmail(taxpayer) || '-'}</span>
            </span>
          </Link>
          <span>{typeLabel(taxpayer)}</span>
          <span className="font-mono">{taxpayer.taxNumber || '-'}</span>
          <span className="truncate">{taxpayer.taxOffice || '-'}</span>
          <span>{formatDate(taxpayer.startDate)} / {formatDate(taxpayer.endDate)}</span>
          <span style={{ color: taxpayer.isActive ? GREEN : ROSE }}>{taxpayer.isActive ? 'Aktif' : 'Pasif'}</span>
          <button
            type="button"
            onClick={() => onToggle(taxpayer)}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-[6px] px-3 py-2 text-[12px] font-bold disabled:opacity-40"
            style={{ background: taxpayer.isActive ? 'rgba(239,78,109,0.12)' : 'rgba(34,197,94,0.13)', color: taxpayer.isActive ? '#ff9aae' : '#7eeaa5' }}
          >
            {taxpayer.isActive ? <Archive size={13} /> : <RotateCcw size={13} />}
            {taxpayer.isActive ? 'Pasife Al' : 'Aktife Al'}
          </button>
        </div>
      ))}
    </div>
  );
}
