'use client';
import './module-white.css';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe } from '@/hooks/useAuth';
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ExternalLink,
  FileText,
  List,
  Plus,
  Search,
  Smartphone,
  Trash2,
  User,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PortalCredentialInsightCard, portalAutomationApi } from '@/lib/portal-automation';

/* Renkler module-white.css içindeki değişkenlerden gelir: A teması koyu, D teması beyaz kurumsal.
   Bu dosyada yalnız yerleşim ve işlev vardır. */

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
type TypeKey = 'FİRMA' | 'ŞAHIS' | 'BASİT';

const LETTERS = ['A', 'B', 'C', 'Ç', 'D', 'E', 'F', 'G', 'Ğ', 'H', 'I', 'İ', 'J', 'K', 'L', 'M', 'N', 'O', 'Ö', 'P', 'R', 'S', 'Ş', 'T', 'U', 'Ü', 'V', 'Y', 'Z', 'W', 'X', 'Q'];

const TYPE_FILTERS: Array<{ key: TypeFilter; label: string; icon: LucideIcon }> = [
  { key: 'FIRMA', label: 'Firma', icon: Building2 },
  { key: 'SAHIS', label: 'Şahıs', icon: User },
  { key: 'BASIT', label: 'Basit', icon: FileText },
  { key: 'TUMU', label: 'Tümü', icon: List },
];

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'active', label: 'Aktif' },
  { key: 'inactive', label: 'Pasif' },
  { key: 'all', label: 'Tümü' },
];

const TYPE_TONE: Record<TypeKey, string> = { 'FİRMA': 'blue', 'ŞAHIS': 'teal', 'BASİT': 'amber' };

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

function typeLabel(t: Taxpayer): TypeKey {
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

/** Uyarı çipinin tonu: sıfır → kurşuni; "yanlış" → kırmızı; diğer (aynı şifre, "iz") → kehribar. */
function insightTone(card: PortalCredentialInsightCard): 'zero' | 'red' | 'amber' {
  if (!card.count) return 'zero';
  const wrong = /wrong|yanl/i.test(`${card.key} ${card.label}`);
  return wrong ? 'red' : 'amber';
}

export default function MukellefListesiPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canDelete = !!(me as any)?.roles?.includes('ADMIN');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('TUMU');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [letter, setLetter] = useState('TÜMÜ');
  const [selectedInsight, setSelectedInsight] = useState<PortalCredentialInsightCard | null>(null);

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
  const { data: credentialInsights } = useQuery({
    queryKey: ['portal-automation-credential-insights'],
    queryFn: () => portalAutomationApi.credentialInsights(),
    refetchInterval: 5000,
    staleTime: 0,
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

  const typeCounts: Record<TypeFilter, number> = { FIRMA: counts.firm, SAHIS: counts.person, BASIT: counts.basit, TUMU: counts.total };

  /** Durum + tür süzgecinden geçen kayıtların baş harfleri — boş harfler soluk gösterilir, tıklanabilir kalır. */
  const lettersInUse = useMemo(() => {
    const set = new Set<string>();
    for (const t of taxpayers) {
      if (statusFilter === 'active' && !t.isActive) continue;
      if (statusFilter === 'inactive' && t.isActive) continue;
      if (!matchesType(t, typeFilter)) continue;
      const first = taxpayerName(t).toLocaleUpperCase('tr-TR').charAt(0);
      if (first) set.add(first);
    }
    return set;
  }, [taxpayers, statusFilter, typeFilter]);

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
    <div className="ml-root max-w-none space-y-4">
      {/* Sayfa başlığı: simge kutusu + başlık + sayılar; sağda birincil eylem */}
      <header className="ml-head flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="ml-head-icon grid h-9 w-9 shrink-0 place-items-center rounded-[10px]">
            <Users size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="ml-title text-[22px] font-bold leading-tight tracking-[-0.01em]">Mükellef Listesi</h1>
            <p className="ml-sub mt-0.5 text-[13px]">
              <b className="ml-sub-num">{counts.active}</b> aktif <span className="ml-dot">·</span> <b className="ml-sub-num">{counts.inactive}</b> pasif <span className="ml-dot">·</span> <b className="ml-sub-num">{counts.total}</b> kayıt
            </p>
          </div>
        </div>
        <Link href="/panel/mukellefler/yeni" className="ml-btn-primary inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3.5 text-[13px] font-semibold transition">
          <Plus size={15} /> Yeni Mükellef
        </Link>
      </header>

      <CredentialInsightStrip cards={credentialInsights?.cards || []} onOpen={setSelectedInsight} />

      {/* Araç çubuğu: tür kapsül grubu · arama · durum kapsül grubu */}
      <section className="ml-toolbar flex flex-wrap items-center justify-between gap-3 rounded-[12px] px-3 py-2.5">
        <div className="ml-seg inline-flex items-center gap-0.5 rounded-[10px] p-[3px]" role="tablist" aria-label="Mükellef türü">
          {TYPE_FILTERS.map((item) => {
            const Icon = item.icon;
            const active = typeFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                aria-pressed={active}
                onClick={() => setTypeFilter(item.key)}
                className="ml-seg-btn inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-semibold transition"
                title={`${item.label} süzgeci`}
              >
                <Icon size={14} /> {item.label}
                <span className="ml-seg-count inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold tabular-nums">{typeCounts[item.key]}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <label className="relative min-w-[260px] max-w-[420px] flex-1">
            <Search size={14} className="ml-search-icon pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="İsim, VKN/TC veya vergi dairesi ara..."
              className="ml-input h-9 w-full rounded-[10px] py-2 pl-9 pr-3 text-[13px] outline-none"
              aria-label="Mükellef ara"
            />
          </label>
          <div className="ml-seg inline-flex items-center gap-0.5 rounded-[10px] p-[3px]" role="tablist" aria-label="Durum">
            {STATUS_FILTERS.map((item) => {
              const active = statusFilter === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-pressed={active}
                  onClick={() => setStatusFilter(item.key)}
                  className="ml-seg-btn h-8 rounded-[8px] px-3 text-[12.5px] font-semibold transition"
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Harf seçici: kompakt çip satırı */}
      <nav className="ml-letters flex flex-wrap items-center gap-1" aria-label="Baş harfe göre süz">
        {['TÜMÜ', ...LETTERS].map((item) => {
          const active = letter === item;
          const empty = item !== 'TÜMÜ' && !lettersInUse.has(item);
          return (
            <button
              key={item}
              type="button"
              aria-pressed={active}
              data-empty={empty ? 'true' : undefined}
              onClick={() => setLetter(item)}
              className={`ml-letter inline-flex h-7 items-center justify-center rounded-[7px] text-[11.5px] font-semibold transition ${item === 'TÜMÜ' ? 'px-2.5' : 'w-7'}`}
              title={empty ? `${item} ile başlayan kayıt yok` : `${item} ile başlayanlar`}
            >
              {item === 'TÜMÜ' ? 'Tümü' : item}
            </button>
          );
        })}
      </nav>

      {isLoading ? (
        <div className="ml-empty rounded-[12px] py-14 text-center text-[13px]">Yükleniyor...</div>
      ) : filtered.length === 0 ? (
        <div className="ml-empty rounded-[12px] py-14 text-center">
          <Users size={22} className="ml-empty-icon mx-auto mb-2" />
          <p className="ml-empty-title text-[14px] font-semibold">Kayıt bulunamadı</p>
          <p className="ml-empty-sub mt-1 text-[12px]">Seçili süzgeçlerde mükellef yok</p>
        </div>
      ) : (
        <div className="ml-table-wrap overflow-x-auto rounded-[12px]">
          <table className="ml-table w-full min-w-[960px] border-collapse text-left">
            <thead>
              <tr>
                <th className="ml-th">Mükellef</th>
                <th className="ml-th w-[92px]">Tür</th>
                <th className="ml-th w-[170px]">Vergi dairesi</th>
                <th className="ml-th w-[150px]">Erişim</th>
                <th className="ml-th w-[118px]">Durum</th>
                <th className="ml-th w-[96px] text-right">Eylemler</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((taxpayer) => (
                <TaxpayerRow
                  key={taxpayer.id}
                  taxpayer={taxpayer}
                  onToggle={() => toggleActive.mutate({ id: taxpayer.id, isActive: !taxpayer.isActive })}
                  busy={toggleActive.isPending}
                  onDelete={() => {
                    if (confirm(`${taxpayerName(taxpayer)} silinsin mi?`)) deleteTaxpayer.mutate(taxpayer.id);
                  }}
                  deleteBusy={deleteTaxpayer.isPending}
                  canDelete={canDelete}
                />
              ))}
            </tbody>
          </table>
          <div className="ml-table-foot px-4 py-2.5 text-[12px] tabular-nums">
            {filtered.length} kayıt gösteriliyor
            {letter !== 'TÜMÜ' && <> · <b>{letter}</b> harfi</>}
          </div>
        </div>
      )}
      {selectedInsight && (
        <CredentialInsightDialog card={selectedInsight} onClose={() => setSelectedInsight(null)} />
      )}
    </div>
  );
}

/** Şifre/uyarı sayaçları: tek satır çipler; sıfır olanlar soluk, dolu olanlar anlamına göre renkli; tıklanınca liste açılır. */
function CredentialInsightStrip({
  cards,
  onOpen,
}: {
  cards: PortalCredentialInsightCard[];
  onOpen: (card: PortalCredentialInsightCard) => void;
}) {
  if (!cards.length) return null;
  return (
    <section className="ml-chips flex flex-wrap items-center gap-1.5" aria-label="Şifre ve uyarı sayaçları">
      {cards.map((card) => {
        const tone = insightTone(card);
        return (
          <button
            key={card.key}
            type="button"
            data-tone={tone}
            onClick={() => onOpen(card)}
            className="ml-chip inline-flex h-7 items-center gap-1.5 rounded-full pl-2.5 pr-1.5 text-[11px] font-semibold transition"
            title={`${card.label}: ${card.count} mükellef`}
          >
            {tone !== 'zero' && <AlertTriangle size={12} className="shrink-0" />}
            <span className="truncate">{card.label}</span>
            <span className="ml-chip-count inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold tabular-nums">{card.count}</span>
          </button>
        );
      })}
    </section>
  );
}

function CredentialInsightDialog({ card, onClose }: { card: PortalCredentialInsightCard; onClose: () => void }) {
  const taxpayers = card.taxpayers || [];
  const tone = insightTone(card);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ml-dialog-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4" onClick={onClose} role="presentation">
      <div
        onClick={(event) => event.stopPropagation()}
        className="ml-dialog w-full max-w-3xl overflow-hidden rounded-[14px]"
        role="dialog"
        aria-modal="true"
        aria-label={card.label}
      >
        <div className="ml-dialog-head flex items-start justify-between gap-4 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="ml-dialog-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" data-tone={tone}>
              <AlertTriangle size={17} />
            </div>
            <div>
              <h2 className="ml-dialog-title text-[16px] font-bold">{card.label}</h2>
              <p className="ml-dialog-sub mt-0.5 text-[12.5px]">{card.count} mükellef listeleniyor</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="ml-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-[8px] transition" aria-label="Kapat">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[62vh] overflow-y-auto p-4">
          {taxpayers.length === 0 ? (
            <div className="ml-empty rounded-[10px] px-4 py-10 text-center text-[13px]">Bu grupta mükellef yok.</div>
          ) : (
            <div className="ml-table-wrap overflow-hidden rounded-[10px]">
              <table className="ml-table w-full border-collapse text-left">
                <thead>
                  <tr>
                    <th className="ml-th w-[52px]">No</th>
                    <th className="ml-th">Mükellef</th>
                    <th className="ml-th w-[150px]">VKN/TC</th>
                    <th className="ml-th">Açıklama</th>
                  </tr>
                </thead>
                <tbody>
                  {taxpayers.map((item, index) => (
                    <tr key={`${card.key}-${item.id}-${index}`} className="ml-tr">
                      <td className="ml-td ml-num-faint tabular-nums">{index + 1}</td>
                      <td className="ml-td">
                        <Link href={`/panel/mukellefler/${item.id}`} onClick={onClose} className="ml-name block truncate text-[13.5px] font-semibold">{item.name}</Link>
                        <div className="ml-id mt-0.5 truncate text-[11.5px]">{item.taxOffice || '—'}</div>
                      </td>
                      <td className="ml-td ml-id-cell tabular-nums">{item.taxNumber || '—'}</td>
                      <td className="ml-td ml-cell-secondary">{item.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TaxpayerRow({
  taxpayer,
  onToggle,
  busy,
  onDelete,
  deleteBusy,
  canDelete,
}: {
  taxpayer: Taxpayer;
  onToggle: () => void;
  busy: boolean;
  onDelete: () => void;
  deleteBusy: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const name = taxpayerName(taxpayer);
  const phone = primaryPhone(taxpayer);
  const email = primaryEmail(taxpayer);
  const type = typeLabel(taxpayer);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const href = `/panel/mukellefler/${taxpayer.id}`;

  return (
    <tr
      className="ml-tr ml-tr-link"
      onClick={() => router.push(href)}
      title="Mükellef kartını aç"
    >
      <td className="ml-td">
        <div className="flex min-w-0 items-center gap-3">
          <span className="ml-avatar grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[9px] text-[11.5px] font-bold">
            {taxpayer.logoUrl ? (
              <span className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${taxpayer.logoUrl})` }} />
            ) : (
              initials(taxpayer)
            )}
          </span>
          <div className="min-w-0">
            <Link href={href} onClick={(e) => e.stopPropagation()} className="ml-name block truncate text-[13.5px] font-semibold leading-tight">{name}</Link>
            <div className="ml-id mt-0.5 truncate text-[11.5px] tabular-nums">{taxpayer.taxNumber || 'VKN/TC yok'}</div>
          </div>
        </div>
      </td>
      <td className="ml-td">
        <span className="ml-type-chip inline-flex h-[22px] items-center rounded-full px-2 text-[11px] font-semibold" data-tone={TYPE_TONE[type]}>
          {type === 'FİRMA' ? 'Firma' : type === 'ŞAHIS' ? 'Şahıs' : 'Basit'}
        </span>
      </td>
      <td className="ml-td ml-cell-secondary">
        {taxpayer.taxOffice ? <span className="block truncate">{taxpayer.taxOffice}</span> : <span className="ml-num-faint">—</span>}
      </td>
      <td className="ml-td">
        <div className="flex items-center gap-1">
          <PresenceIcon active={!!taxpayer.hasVergiDairesiCredential} kind="gib" title="Vergi dairesi şifresi" />
          <PresenceIcon active={!!taxpayer.hasSgkCredential} kind="sgk" title="SGK e-Bildirge şifresi" />
          <PresenceIcon active={!!email} kind="mail" title="E-posta" />
          <PresenceIcon active={!!phone} kind="phone" title="Telefon" />
        </div>
      </td>
      <td className="ml-td" onClick={(e) => e.stopPropagation()}>
        <div className="relative inline-block">
          <button
            type="button"
            onClick={() => setStatusMenuOpen((v) => !v)}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={statusMenuOpen}
            data-on={taxpayer.isActive ? 'true' : 'false'}
            className="ml-status inline-flex h-7 items-center gap-1 rounded-full pl-2 pr-1.5 text-[11.5px] font-semibold transition disabled:opacity-50"
            title="Durumu değiştir"
          >
            <span className="ml-status-dot h-1.5 w-1.5 rounded-full" />
            {taxpayer.isActive ? 'Aktif' : 'Pasif'}
            <ChevronDown size={13} className="ml-status-caret" />
          </button>
          {statusMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setStatusMenuOpen(false)} aria-hidden="true" />
              <div className="ml-menu absolute left-0 top-[calc(100%+4px)] z-20 w-[150px] rounded-[9px] p-1" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setStatusMenuOpen(false);
                    onToggle();
                  }}
                  disabled={busy}
                  data-tone={taxpayer.isActive ? 'red' : 'green'}
                  className="ml-menu-item w-full rounded-[6px] px-3 py-2 text-left text-[12.5px] font-semibold transition disabled:opacity-50"
                >
                  {taxpayer.isActive ? 'Pasife al' : 'Aktife al'}
                </button>
              </div>
            </>
          )}
        </div>
      </td>
      <td className="ml-td" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <Link href={href} className="ml-icon-btn inline-flex h-7 w-7 items-center justify-center rounded-[7px] transition" title="Mükellef kartını aç" aria-label="Mükellef kartını aç">
            <ExternalLink size={14} />
          </Link>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleteBusy}
              className="ml-icon-btn ml-icon-btn--danger inline-flex h-7 w-7 items-center justify-center rounded-[7px] transition disabled:opacity-50"
              title="Mükellefi sil"
              aria-label="Mükellefi sil"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

type PresenceKind = 'gib' | 'sgk' | 'mail' | 'phone';

/** Erişim simgeleri (Hattat kalıbı): tanımlı olan yeşil, olmayan soluk. */
function PresenceIcon({ active, kind, title }: { active: boolean; kind: PresenceKind; title: string }) {
  return (
    <span
      title={`${title}: ${active ? 'tanımlı' : 'eksik'}`}
      aria-label={`${title}: ${active ? 'tanımlı' : 'eksik'}`}
      data-on={active ? 'true' : 'false'}
      className="ml-access inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]"
    >
      {kind === 'gib' && <GibMark />}
      {kind === 'sgk' && <span className="inline-flex h-4 w-4 items-center justify-center font-sans text-[8px] font-bold leading-none">SGK</span>}
      {kind === 'mail' && <EnvelopeMark />}
      {kind === 'phone' && <Smartphone size={15} strokeWidth={2.4} />}
    </span>
  );
}

function GibMark() {
  return (
    <svg viewBox="0 0 100 100" width="15" height="15" aria-hidden="true" fill="currentColor">
      <path d="M53.8 8.8C32.7 23.6 21.7 45.2 23.5 72.7c.5 7.1 2.1 13.4 4.4 18.5H48C38 64.6 40.8 35.2 64.8 8.8h-11Z" />
      <path d="M56.3 47.8h32.4L79.6 91.2H48.4l8.8-36.5H50l1.6-6.9h4.7Z" />
      <ellipse cx="76.2" cy="29.4" rx="12.8" ry="17.5" transform="rotate(9 76.2 29.4)" />
    </svg>
  );
}

function EnvelopeMark() {
  return (
    <svg viewBox="0 0 32 24" width="15" height="15" aria-hidden="true" fill="currentColor">
      <path d="M3.4 4.1h25.2v2.1L16 14.1 3.4 6.2V4.1Zm0 4.6 9.1 5.7-9.1 6.1V8.7Zm25.2 0v11.8l-9.1-6.1 9.1-5.7Zm-15 6.6 2.4 1.5 2.4-1.5 9.2 6.2H4.4l9.2-6.2Z" />
    </svg>
  );
}
