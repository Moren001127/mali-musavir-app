'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  Gauge,
  ListChecks,
  Plus,
  ReceiptText,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type {
  CariTakipPolitikasi,
  DefterTuru,
  HesapTuru,
  KdvOranBazli,
  MukellefProfile,
} from '@/lib/mukellef-profile';

interface Taxpayer {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}

interface Rule {
  id: string;
  mukellef: string;
  profile: MukellefProfile | any;
}

type KdvGroup =
  | 'malSatisMatrah'
  | 'hizmetSatisMatrah'
  | 'faturaSatisMatrah'
  | 'perakendeSatisMatrah'
  | 'malAlisMatrah'
  | 'hesaplananKdv'
  | 'indirilecekKdv';

type ProfileTab = 'genel' | 'kodlar' | 'kurallar' | 'firma';

const tabLabels: Record<ProfileTab, string> = {
  genel: 'Genel',
  kodlar: 'Hesap Kodları',
  kurallar: 'Karar Kuralları',
  firma: 'Firma Talimatları',
};

const tabIcons: Record<ProfileTab, ReactNode> = {
  genel: <Settings2 size={16} />,
  kodlar: <ReceiptText size={16} />,
  kurallar: <ShieldCheck size={16} />,
  firma: <Building2 size={16} />,
};

function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

const emptyKdv = (): KdvOranBazli => ({
  yuzde1: '',
  yuzde8: '',
  yuzde10: '',
  yuzde18: '',
  yuzde20: '',
});

const EMPTY_PROFILE: MukellefProfile = {
  sektor: '',
  defterTuru: '',
  malSatisMatrah: emptyKdv(),
  hizmetSatisMatrah: emptyKdv(),
  faturaSatisMatrah: emptyKdv(),
  perakendeSatisMatrah: emptyKdv(),
  malAlisMatrah: emptyKdv(),
  hesaplananKdv: emptyKdv(),
  indirilecekKdv: emptyKdv(),
  cariFormat: '',
  cariTakipPolitikasi: 'cari_yoksa_onay',
  cariYoksaHesap: '',
  surekliTedarikciler: '',
  tahsilatHesabi: '',
  tahsilatHesapTuru: '',
  odemeHesabi: '',
  odemeHesapTuru: '',
  tevkifataTabi: false,
  demirbasKontrolAktif: true,
  demirbasAnahtarKelimeler:
    'araba, araç, otomobil, kamyonet, bilgisayar, laptop, yazıcı, telefon, televizyon, TV, klima, mobilya, masa, sandalye, raf, makine, ekipman, cihaz, demirbaş, şasi, motor no, ÖTV',
  demirbasTalimat:
    'Demirbaş, taşıt, sabit kıymet veya olağan dışı yüksek tutarlı alımlarda otomatik F2 yapma; manuel incelemeye düşür.',
  ozelKararKurallari: '',
  firmaOzelTalimatlar: '',
  otomatikOnayNotlari: '',
  talimat: '',
};

function mergeProfile(existing?: MukellefProfile): MukellefProfile {
  const merged: MukellefProfile = { ...EMPTY_PROFILE, ...(existing || {}) };
  merged.faturaSatisMatrah = merged.faturaSatisMatrah || merged.malSatisMatrah || emptyKdv();
  merged.perakendeSatisMatrah = merged.perakendeSatisMatrah || merged.hizmetSatisMatrah || emptyKdv();
  merged.malAlisMatrah = merged.malAlisMatrah || emptyKdv();
  merged.hesaplananKdv = merged.hesaplananKdv || emptyKdv();
  merged.indirilecekKdv = merged.indirilecekKdv || emptyKdv();
  merged.ozelKararKurallari = merged.ozelKararKurallari || '';
  merged.firmaOzelTalimatlar = merged.firmaOzelTalimatlar || '';
  merged.otomatikOnayNotlari = merged.otomatikOnayNotlari || '';
  return merged;
}

function countFilledKdv(values?: KdvOranBazli) {
  if (!values) return 0;
  return ['yuzde1', 'yuzde8', 'yuzde10', 'yuzde18', 'yuzde20'].filter(
    (key) => !!String(values[key as keyof KdvOranBazli] || '').trim(),
  ).length;
}

function parseRuleLines(value?: string) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function joinRuleLines(lines: string[]) {
  return lines.map((line) => line.trim()).filter(Boolean).join('\n');
}

function countManagedRules(value?: string) {
  return parseRuleLines(value).length;
}

function parseKeywords(value?: string) {
  return String(value || '')
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinKeywords(values: string[]) {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean))).join(', ');
}

function parseFirmRules(value?: string) {
  return parseRuleLines(value).map((line) => {
    const colonIndex = line.indexOf(':');
    const arrowIndex = line.indexOf('->');
    const splitIndex =
      colonIndex >= 0 && arrowIndex >= 0
        ? Math.min(colonIndex, arrowIndex)
        : colonIndex >= 0
          ? colonIndex
          : arrowIndex;
    if (splitIndex < 0) return { firm: '', instruction: line };
    const firm = line.slice(0, splitIndex).trim();
    const instruction = line.slice(splitIndex + (line.slice(splitIndex, splitIndex + 2) === '->' ? 2 : 1)).trim();
    return { firm, instruction };
  });
}

function joinFirmRules(rules: Array<{ firm: string; instruction: string }>) {
  return rules
    .map((rule) => {
      const firm = rule.firm.trim();
      const instruction = rule.instruction.trim();
      if (!firm && !instruction) return '';
      return firm ? `${firm}: ${instruction}` : instruction;
    })
    .filter(Boolean)
    .join('\n');
}

const DEFTER_TURU_LABEL: Record<string, string> = {
  bilanco: 'Bilanço',
  isletme: 'İşletme',
};

function defterTuruLabel(value?: string | null): string {
  const key = String(value || '').trim();
  return DEFTER_TURU_LABEL[key] || key;
}

function profileKodCount(p?: any): number {
  if (!p) return 0;
  return (
    countFilledKdv(p.faturaSatisMatrah || p.malSatisMatrah) +
    countFilledKdv(p.perakendeSatisMatrah || p.hizmetSatisMatrah) +
    countFilledKdv(p.malAlisMatrah) +
    countFilledKdv(p.hesaplananKdv) +
    countFilledKdv(p.indirilecekKdv)
  );
}

function profileRuleCount(p?: any): number {
  if (!p) return 0;
  return (
    countManagedRules(p.ozelKararKurallari) +
    countManagedRules(p.firmaOzelTalimatlar) +
    countManagedRules(p.talimat) +
    countManagedRules(p.demirbasTalimat)
  );
}

// Profil doluluk skoru (0-100): karar motoru için anlamlı alanların ağırlıklı toplamı.
function profileScore(p?: any): number {
  if (!p) return 0;
  let s = 0;
  if (String(p.sektor || '').trim()) s += 15;
  if (String(p.defterTuru || '').trim()) s += 10;
  s += (Math.min(profileKodCount(p), 10) / 10) * 35;
  if (String(p.cariFormat || '').trim()) s += 10;
  if (String(p.tahsilatHesabi || '').trim() || String(p.odemeHesabi || '').trim()) s += 10;
  s += (Math.min(profileRuleCount(p), 4) / 4) * 20;
  return Math.round(Math.max(0, Math.min(100, s)));
}

type ListFilter = 'all' | 'configured' | 'missing';

export default function ProfillerPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [profile, setProfile] = useState<MukellefProfile>(EMPTY_PROFILE);
  const [search, setSearch] = useState('');
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTargets, setCopyTargets] = useState<Set<string>>(() => new Set());
  const [copySearch, setCopySearch] = useState('');

  const { data: taxpayers = [] } = useQuery({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data as Taxpayer[]),
  });

  const { data: rules = [] } = useQuery({
    queryKey: ['agent-rules'],
    queryFn: () => api.get('/agent/rules').then((r) => r.data as Rule[]),
  });

  const upsert = useMutation({
    mutationFn: (data: { mukellef: string; profile: MukellefProfile }) =>
      api.put(`/agent/rules/${encodeURIComponent(data.mukellef)}`, { profile: data.profile }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-rules'] });
      toast.success('Profil kaydedildi');
    },
    onError: () => toast.error('Kayıt başarısız'),
  });

  const del = useMutation({
    mutationFn: (m: string) => api.delete(`/agent/rules/${encodeURIComponent(m)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-rules'] });
      toast.success('Profil silindi');
      setSelected(null);
      setProfile(EMPTY_PROFILE);
    },
  });

  const copyMut = useMutation({
    mutationFn: async (vars: { targets: string[]; profile: MukellefProfile }) => {
      for (const name of vars.targets) {
        await api.put(`/agent/rules/${encodeURIComponent(name)}`, { profile: vars.profile });
      }
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agent-rules'] });
      toast.success(`${variables.targets.length} mükellefe kopyalandı`);
      setCopyOpen(false);
      setCopyTargets(new Set());
      setCopySearch('');
    },
    onError: () => toast.error('Kopyalama başarısız'),
  });

  const ruleMap = useMemo(() => new Map(rules.map((r) => [r.mukellef, r])), [rules]);
  const configuredCount = rules.length;
  const missingCount = Math.max(0, taxpayers.length - configuredCount);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    const hasRule = (t: Taxpayer) => ruleMap.has(taxpayerName(t));
    return taxpayers
      .filter((t) => {
        if (listFilter === 'configured' && !hasRule(t)) return false;
        if (listFilter === 'missing' && hasRule(t)) return false;
        return !q || taxpayerName(t).toLocaleLowerCase('tr-TR').includes(q);
      })
      .sort((a, b) => taxpayerName(a).localeCompare(taxpayerName(b), 'tr'));
  }, [search, taxpayers, ruleMap, listFilter]);

  const missingTaxpayers = useMemo(
    () =>
      taxpayers
        .filter((t) => !ruleMap.has(taxpayerName(t)))
        .map((t) => taxpayerName(t))
        .sort((a, b) => a.localeCompare(b, 'tr')),
    [taxpayers, ruleMap],
  );

  const copyCandidates = useMemo(() => {
    const q = copySearch.trim().toLocaleLowerCase('tr-TR');
    return taxpayers
      .map((t) => taxpayerName(t))
      .filter((name) => name !== selected)
      .filter((name) => !q || name.toLocaleLowerCase('tr-TR').includes(q))
      .sort((a, b) => a.localeCompare(b, 'tr'));
  }, [taxpayers, selected, copySearch]);

  const selectTaxpayer = (name: string) => {
    setSelected(name);
    setProfile(mergeProfile(ruleMap.get(name)?.profile as MukellefProfile | undefined));
  };

  const updP = <K extends keyof MukellefProfile>(key: K, value: MukellefProfile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }));

  const updKdv = (key: KdvGroup, oran: keyof KdvOranBazli, value: string) =>
    setProfile((p) => ({ ...p, [key]: { ...(p[key] || {}), [oran]: value } }));

  const normalizeForSave = (p: MukellefProfile): MukellefProfile => ({
    ...p,
    malSatisMatrah: p.faturaSatisMatrah || p.malSatisMatrah,
    hizmetSatisMatrah: p.perakendeSatisMatrah || p.hizmetSatisMatrah,
  });

  const saveProfile = () => {
    if (!selected) return;
    upsert.mutate({ mukellef: selected, profile: normalizeForSave(profile) });
  };

  const toggleCopyTarget = (name: string) =>
    setCopyTargets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const openCopy = () => {
    setCopyTargets(new Set());
    setCopySearch('');
    setCopyOpen(true);
  };

  const doCopy = () => {
    if (!selected || copyTargets.size === 0) return;
    copyMut.mutate({ targets: Array.from(copyTargets), profile: normalizeForSave(profile) });
  };

  const selectedScore = profileScore(profile);

  return (
    <div className="max-w-[1680px] space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0f0d0b]">
        <div className="h-[3px] w-full" style={{ background: 'linear-gradient(90deg,#8b7cf0,#a78bfa 35%,#6d5fd1 60%,#8b7cf0)' }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(520px 220px at 24% -40%, rgba(139,124,240,.20), transparent 70%)' }} />
        <div className="relative flex flex-col gap-6 p-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-4">
            <div
              className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl"
              style={{ background: 'linear-gradient(145deg,#8b7cf0,#6d5fd1)', boxShadow: '0 10px 30px -8px rgba(139,124,240,.5)' }}
            >
              <ShieldCheck size={28} className="text-[#0b0a14]" />
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2.5">
                <span className="h-px w-8 bg-[#8b7cf0]" />
                <span className="text-[10px] font-bold uppercase tracking-[.18em] text-[#b3a4ef]">Ajan</span>
              </div>
              <h1
                className="text-[33px] font-semibold leading-none text-[#fafaf9]"
                style={{ fontFamily: 'Fraunces, serif', letterSpacing: '-0.02em' }}
              >
                Mükellef Profilleri
              </h1>
              <p className="mt-2 max-w-xl text-[13px] text-white/45">
                Fatura karar motorunun mükellef bazlı hesap kodu, risk ve özel talimat merkezi.
              </p>
            </div>
          </div>
          <div className="flex gap-2.5">
            <FilterStat label="Mükellef" value={taxpayers.length} tone="violet" active={listFilter === 'all'} onClick={() => setListFilter('all')} />
            <FilterStat label="Tanımlı" value={configuredCount} tone="green" active={listFilter === 'configured'} onClick={() => setListFilter('configured')} />
            <FilterStat label="Eksik" value={missingCount} tone="amber" active={listFilter === 'missing'} onClick={() => setListFilter('missing')} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[386px_minmax(0,1fr)]">
        <aside className="min-h-[720px] rounded-xl border border-white/[0.06] bg-white/[0.025]">
          <div className="p-4 pb-2">
            <label className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2">
              <Search size={16} className="text-white/35" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Mükellef ara..."
                className="min-w-0 flex-1 bg-transparent text-sm text-[#fafaf9] outline-none placeholder:text-white/30"
              />
            </label>
          </div>
          <div className="flex gap-1.5 px-4 pb-3">
            {([
              { key: 'all', label: `Tümü (${taxpayers.length})` },
              { key: 'configured', label: `Tanımlı (${configuredCount})` },
              { key: 'missing', label: `Eksik (${missingCount})` },
            ] as { key: ListFilter; label: string }[]).map((f) => (
              <button
                key={f.key}
                onClick={() => setListFilter(f.key)}
                className="flex-1 rounded-lg border px-2 py-1.5 text-[11.5px] font-semibold transition"
                style={{
                  borderColor: listFilter === f.key ? 'rgba(139,124,240,.4)' : 'rgba(255,255,255,.07)',
                  background: listFilter === f.key ? 'rgba(139,124,240,.14)' : 'rgba(255,255,255,.03)',
                  color: listFilter === f.key ? '#c4b5fd' : 'rgba(250,250,249,.5)',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="max-h-[calc(100vh-285px)] overflow-y-auto px-2 pb-3">
            {filtered.map((t) => {
              const name = taxpayerName(t);
              const rule = ruleMap.get(name);
              const has = !!rule;
              const p = rule?.profile;
              const score = has ? profileScore(p) : 0;
              const kod = profileKodCount(p);
              const kural = profileRuleCount(p);
              const sektor = String(p?.sektor || '').trim();
              const defter = defterTuruLabel(p?.defterTuru);
              const meta = has ? [sektor || 'Sektör —', defter || 'Defter —'].join(' · ') : 'Profil tanımlı değil';
              const active = selected === name;
              const dotClass = !has ? 'border border-white/25' : score >= 70 ? 'bg-[#5cbf8a]' : 'bg-[#d4a85f]';
              return (
                <button
                  key={t.id}
                  onClick={() => selectTaxpayer(name)}
                  className="group relative mb-1 grid w-full grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition"
                  style={{
                    background: active ? 'linear-gradient(90deg, rgba(139,124,240,.16), rgba(139,124,240,.04))' : 'transparent',
                    border: active ? '1px solid rgba(139,124,240,.28)' : '1px solid transparent',
                  }}
                >
                  {active && <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-[#8b7cf0]" />}
                  <span className={`h-2.5 w-2.5 justify-self-center rounded-full ${dotClass}`} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold" style={{ color: active ? '#d9cffb' : '#e5e7eb' }}>{name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-white/35">{meta}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {has ? (
                      <>
                        <span className="flex items-center gap-1.5">
                          <span className="h-1 w-[46px] overflow-hidden rounded-full bg-white/10">
                            <span className="block h-full rounded-full" style={{ width: `${score}%`, background: 'linear-gradient(90deg,#6d5fd1,#a78bfa)' }} />
                          </span>
                          <span className="w-8 text-right text-[10.5px] tabular-nums text-white/45">%{score}</span>
                        </span>
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: '#bcaef4', background: 'rgba(139,124,240,.13)', border: '1px solid rgba(139,124,240,.22)' }}>
                          {kod} kod · {kural} kural
                        </span>
                      </>
                    ) : (
                      <span className="rounded-full border border-white/[0.07] bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-white/40">tanımsız</span>
                    )}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-white/35">Sonuç yok</div>
            )}
          </div>
        </aside>

        <main className="rounded-xl border border-white/[0.06] bg-white/[0.025]">
          {!selected ? (
            <EmptyState missingCount={missingCount} missing={missingTaxpayers} onPick={selectTaxpayer} />
          ) : (
            <ProfileForm
              selected={selected}
              profile={profile}
              score={selectedScore}
              has={ruleMap.has(selected)}
              onUpdate={updP}
              onUpdateKdv={updKdv}
              onSave={saveProfile}
              onCopy={openCopy}
              onDelete={() => {
                if (confirm(`${selected} için profil silinsin mi?`)) del.mutate(selected);
              }}
              saving={upsert.isPending}
            />
          )}
        </main>
      </div>

      {copyOpen && selected && (
        <CopyModal
          source={selected}
          score={selectedScore}
          kod={profileKodCount(profile)}
          kural={profileRuleCount(profile)}
          candidates={copyCandidates}
          configured={(name) => ruleMap.has(name)}
          targets={copyTargets}
          search={copySearch}
          onSearch={setCopySearch}
          onToggle={toggleCopyTarget}
          onClose={() => setCopyOpen(false)}
          onConfirm={doCopy}
          busy={copyMut.isPending}
        />
      )}
    </div>
  );
}

function ProfileForm({
  selected,
  profile,
  score,
  has,
  onUpdate,
  onUpdateKdv,
  onSave,
  onCopy,
  onDelete,
  saving,
}: {
  selected: string;
  profile: MukellefProfile;
  score: number;
  has: boolean;
  onUpdate: <K extends keyof MukellefProfile>(k: K, v: MukellefProfile[K]) => void;
  onUpdateKdv: (key: KdvGroup, oran: keyof KdvOranBazli, value: string) => void;
  onSave: () => void;
  onCopy: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [tab, setTab] = useState<ProfileTab>('genel');
  const kdvCodeCount = profileKodCount(profile);
  const ruleCount = profileRuleCount(profile);

  return (
    <div className="min-h-[720px]">
      <div
        className="sticky top-0 z-20 border-b border-white/[0.06] px-5 py-4"
        style={{ background: '#0d0b09', boxShadow: '0 10px 24px -14px rgba(0,0,0,0.85)' }}
      >
        <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <ScoreRing value={score} />
            <div className="min-w-0">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[.16em] text-white/35">Mükellef</div>
              <div className="truncate text-xl font-semibold text-[#d9cffb]">{selected}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill icon={<FileText size={14} />} label={profile.sektor || 'Sektör yok'} />
            <StatusPill icon={<ReceiptText size={14} />} label={`${kdvCodeCount} hesap kodu`} tone={kdvCodeCount ? 'green' : 'amber'} />
            <StatusPill icon={<ListChecks size={14} />} label={`${ruleCount} kural`} tone={ruleCount ? 'green' : 'amber'} />
            <button
              onClick={onCopy}
              className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold"
              style={{ color: '#c4b5fd', background: 'rgba(139,124,240,.12)', borderColor: 'rgba(139,124,240,.35)' }}
            >
              <Copy size={15} /> Profili Kopyala
            </button>
            {has && (
              <button
                onClick={onDelete}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 text-sm font-semibold text-red-300"
              >
                <Trash2 size={15} /> Sil
              </button>
            )}
            <button
              onClick={onSave}
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold text-[#0b0a14] disabled:opacity-50"
              style={{ background: 'linear-gradient(145deg,#8b7cf0,#6d5fd1)', borderColor: 'rgba(139,124,240,.5)' }}
            >
              <Save size={15} /> {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(tabLabels) as ProfileTab[]).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition"
              style={{
                borderColor: tab === key ? 'rgba(139,124,240,.45)' : 'rgba(255,255,255,.07)',
                background: tab === key ? 'rgba(139,124,240,.14)' : 'rgba(255,255,255,.03)',
                color: tab === key ? '#c4b5fd' : 'rgba(250,250,249,.62)',
              }}
            >
              {tabIcons[key]}
              {tabLabels[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5 p-5">
        {tab === 'genel' && (
          <>
            <Panel title="Genel Profil" icon={<Settings2 size={18} />} columns={2}>
              <Input label="Sektör / Faaliyet" value={profile.sektor || ''} onChange={(v) => onUpdate('sektor', v)} placeholder="Örn: nakliye, inşaat, market, eczane" />
              <Select label="Defter Türü" value={profile.defterTuru || ''} onChange={(v) => onUpdate('defterTuru', v as DefterTuru)} options={[
                { value: '', label: '- seçiniz -' },
                { value: 'bilanco', label: 'Bilanço' },
                { value: 'isletme', label: 'İşletme' },
              ]} />
            </Panel>

            <Panel title="Cari ve Ödeme Mantığı" icon={<WalletCards size={18} />} columns={3}>
              <Input label="Cari Hesap Formatı" value={profile.cariFormat || ''} onChange={(v) => onUpdate('cariFormat', v)} placeholder="120.01.{kod} / 320.01.{kod}" />
              <Select label="Cari Takip Politikası" value={profile.cariTakipPolitikasi || ''} onChange={(v) => onUpdate('cariTakipPolitikasi', v as CariTakipPolitikasi)} options={CARI_POLICY_OPTIONS} />
              <Input label="Cari yoksa kullanılacak hesap" value={profile.cariYoksaHesap || ''} onChange={(v) => onUpdate('cariYoksaHesap', v)} placeholder="100.01.001 / 102.01.001" />
              <Input label="Tahsilat Hesabı" value={profile.tahsilatHesabi || ''} onChange={(v) => onUpdate('tahsilatHesabi', v)} placeholder="100.01.001" />
              <Select label="Tahsilat Türü" value={profile.tahsilatHesapTuru || ''} onChange={(v) => onUpdate('tahsilatHesapTuru', v as HesapTuru)} options={HESAP_OPTIONS} />
              <Input label="Ödeme Hesabı" value={profile.odemeHesabi || ''} onChange={(v) => onUpdate('odemeHesabi', v)} placeholder="100.01.001 / 102.01.001" />
              <Select label="Ödeme Türü" value={profile.odemeHesapTuru || ''} onChange={(v) => onUpdate('odemeHesapTuru', v as HesapTuru)} options={HESAP_OPTIONS} />
              <Textarea className="lg:col-span-3" label="Sürekli cari takip edilecek firmalar" value={profile.surekliTedarikciler || ''} onChange={(v) => onUpdate('surekliTedarikciler', v)} rows={5} placeholder={`SANCAK ECZA -> 320.01.002\nMEDAŞ -> 320.01.015\nTek seferlik market/akaryakıt alışları cari açılmasın.`} />
            </Panel>
          </>
        )}

        {tab === 'kodlar' && (
          <>
            <Panel title="Satış Matrah Hesapları" icon={<ReceiptText size={18} />} columns={1}>
              <KdvBlock title="Fatura / e-Belge Satış" group="faturaSatisMatrah" values={profile.faturaSatisMatrah || profile.malSatisMatrah} onUpdateKdv={onUpdateKdv} basePlaceholder="600.01" />
              <KdvBlock title="Perakende / Z Raporu Satış" group="perakendeSatisMatrah" values={profile.perakendeSatisMatrah || profile.hizmetSatisMatrah} onUpdateKdv={onUpdateKdv} basePlaceholder="600.02" />
            </Panel>

            <Panel title="Alış ve KDV Hesapları" icon={<BookOpen size={18} />} columns={1}>
              <KdvBlock title="Ticari Mal Alışı Matrah" group="malAlisMatrah" values={profile.malAlisMatrah} onUpdateKdv={onUpdateKdv} basePlaceholder="153.01" />
              <KdvBlock title="Hesaplanan KDV (391.x)" group="hesaplananKdv" values={profile.hesaplananKdv} onUpdateKdv={onUpdateKdv} basePlaceholder="391.01" />
              <KdvBlock title="İndirilecek KDV (191.x)" group="indirilecekKdv" values={profile.indirilecekKdv} onUpdateKdv={onUpdateKdv} basePlaceholder="191.01" />
            </Panel>
          </>
        )}

        {tab === 'kurallar' && (
          <>
            <RuleShelf />

            <Panel title="Risk ve Otomatik Onay" icon={<ShieldCheck size={18} />} columns={2}>
              <Toggle
                label="Demirbaş / taşıt adaylarını otomatik F2 yapma"
                checked={profile.demirbasKontrolAktif !== false}
                onChange={(v) => onUpdate('demirbasKontrolAktif', v)}
              />
              <Toggle
                label="Tevkifat kontrolü aktif"
                checked={!!profile.tevkifataTabi}
                onChange={(v) => onUpdate('tevkifataTabi', v)}
              />
              <KeywordEditor
                className="lg:col-span-2"
                label="Risk anahtar kelimeleri"
                value={profile.demirbasAnahtarKelimeler || ''}
                onChange={(v) => onUpdate('demirbasAnahtarKelimeler', v)}
                suggestions={['şasi', 'motor no', 'ÖTV', 'taşıt alımı', 'otomobil', 'kamyonet', 'demirbaş', 'sabit kıymet']}
              />
              <RuleListEditor
                className="lg:col-span-2"
                title="Demirbaş / olağan dışı işlem talimatları"
                description="Bu talimatlar risk anahtar kelimeleri yakalandığında otomatik onay yerine manuel inceleme mantığını belirler."
                lineLabel="Talimat"
                value={profile.demirbasTalimat || ''}
                onChange={(v) => onUpdate('demirbasTalimat', v)}
                placeholder="Örn: Demirbaş adayı ise otomatik F2 yapma; onay bekliyor kararına düşür."
                templates={RISK_RULE_TEMPLATES}
              />
              <RuleListEditor
                className="lg:col-span-2"
                title="Özel karar kuralları"
                description="Mükellefe özel karar kuralları firma hafızasından önce uygulanır. Her kart ayrı bir kuraldır."
                lineLabel="Kural"
                value={profile.ozelKararKurallari || ''}
                onChange={(v) => onUpdate('ozelKararKurallari', v)}
                placeholder="Örn: Otomotiv firmalarından yüksek tutarlı alışlarda 740 hesabıyla otomatik onay verme."
                templates={DECISION_RULE_TEMPLATES}
              />
              <RuleListEditor
                className="lg:col-span-2"
                title="Otomatik onay notları"
                description="Sadece gerçekten güvenli, tekrar eden ve düşük riskli durumları buraya ekle."
                lineLabel="Onay notu"
                value={profile.otomatikOnayNotlari || ''}
                onChange={(v) => onUpdate('otomatikOnayNotlari', v)}
                placeholder="Örn: Aynı dönem içindeki küçük tutarlı sabit telefon faturaları otomatik onaylanabilir."
                templates={APPROVAL_NOTE_TEMPLATES}
              />
            </Panel>
          </>
        )}

        {tab === 'firma' && (
          <Panel title="Firma Özel Talimatları" icon={<Building2 size={18} />} columns={1}>
            <FirmRuleEditor
              value={profile.firmaOzelTalimatlar || ''}
              onChange={(v) => onUpdate('firmaOzelTalimatlar', v)}
            />
            <RuleListEditor
              title="Genel serbest talimatlar"
              description="Firma adı fark etmeksizin bu mükellefin bütün fatura kararlarına eklenen notlar."
              lineLabel="Talimat"
              value={profile.talimat || ''}
              onChange={(v) => onUpdate('talimat', v)}
              placeholder="Örn: Firma hafızası geçmişte aynı kodu göstermiş olsa bile içerik farklıysa gerçek fatura içeriğine göre karar ver."
              templates={GENERAL_INSTRUCTION_TEMPLATES}
            />
          </Panel>
        )}
      </div>
    </div>
  );
}

function RuleShelf() {
  const rules = [
    { icon: <CheckCircle2 size={16} />, title: 'Boş alış kodu', text: 'Alış tarafında matrah/KDV/cari hesabı boşsa otomatik seçim yapılmaz, manuel geçilir.' },
    { icon: <AlertTriangle size={16} />, title: 'Taşıt ve demirbaş', text: 'Araç, şasi, motor no, ÖTV, makine, bilgisayar gibi sabit kıymet sinyalleri otomatik F2 dışıdır.' },
    { icon: <Gauge size={16} />, title: 'Kasa limiti', text: '100.x kasa hesabı yüksek tutarlı kayıtlarda ayrıca engellenir.' },
    { icon: <Bot size={16} />, title: 'Firma hafızası', text: 'Aynı firma geçmişi sadece içerik temizse hızlandırıcıdır; özel talimat ve risk kuralları önce gelir.' },
  ];
  return (
    <div className="grid gap-3 lg:grid-cols-4">
      {rules.map((rule) => (
        <div key={rule.title} className="rounded-xl border border-white/[0.06] bg-black/15 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#c4b5fd]">
            {rule.icon}
            {rule.title}
          </div>
          <p className="text-xs leading-5 text-white/45">{rule.text}</p>
        </div>
      ))}
    </div>
  );
}

const HESAP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '- seçiniz -' },
  { value: 'kasa', label: 'Kasa (100.x)' },
  { value: 'banka', label: 'Banka (102.x)' },
  { value: 'pos', label: 'POS' },
  { value: 'cek', label: 'Çek' },
  { value: 'diger', label: 'Diğer' },
];

const CARI_POLICY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '- seçiniz -' },
  { value: 'hepsi_cari', label: 'Her firma cari takip edilsin' },
  { value: 'sadece_tanimli', label: 'Sadece tanımlı / sürekli firmalar' },
  { value: 'cari_yoksa_odeme', label: 'Cari yoksa ödeme / kasa hesabı kullan' },
  { value: 'cari_yoksa_onay', label: 'Cari yoksa onay iste' },
];

const RISK_RULE_TEMPLATES = [
  'Demirbaş, taşıt, sabit kıymet veya olağan dışı yüksek tutarlı alımlarda otomatik F2 yapma; manuel incelemeye düşür.',
  'Şasi, motor no, ÖTV, ruhsat veya tescil ifadesi varsa fatura araç alımı olabilir; firma hafızasını kullanma.',
  'Bilgisayar, makine, ekipman, klima veya mobilya alımlarında tutar ve hesap kodu net değilse otomatik onay verme.',
];

const DECISION_RULE_TEMPLATES = [
  'Otomotiv firmalarından gelen yüksek tutarlı alışlarda 740 bakım-onarım hesabıyla otomatik onay verme.',
  'Araç bakımı gider olabilir; araç satın alma, ÖTV, şasi veya motor no içeren faturalar manuel incelensin.',
  'Geçmiş firma hafızası sadece fatura içeriği aynıysa kullanılabilir; içerik farklıysa manuel incelemeye düşür.',
  'Alış tarafında matrah, KDV veya cari hesap kodu boşsa otomatik seçim yapma; faturayı atla.',
];

const APPROVAL_NOTE_TEMPLATES = [
  'Küçük tutarlı ve aynı içerikli tekrar eden telefon/internet faturaları, tarih-belge-tutar uyumluysa otomatik onaylanabilir.',
  'Akaryakıt faturaları tutar ve KDV oranı uyumluysa, mükellef talimatındaki gider hesabıyla otomatik onaylanabilir.',
];

const GENERAL_INSTRUCTION_TEMPLATES = [
  'Firma hafızası geçmişte aynı kodu göstermiş olsa bile içerik farklıysa gerçek fatura içeriğine göre karar ver.',
  'Emin olunmayan veya hesap kodu açıkça görünmeyen alış faturalarında otomatik F2 yapma.',
];

const FIRM_RULE_TEMPLATES = [
  {
    firm: 'ÇETAŞ OTOMOTİV',
    instruction: 'Araç/taşıt alımı, ÖTV, şasi veya motor no varsa otomatik F2 yapma; manuel incele.',
  },
  {
    firm: 'OPET',
    instruction: 'Akaryakıt faturası gider hesabına gidebilir; lastik, ekipman veya demirbaş alımı varsa manuel incele.',
  },
  {
    firm: 'TTNET',
    instruction: 'İnternet hizmet faturası otomatik işlenebilir; cihaz/modem satışı varsa manuel incele.',
  },
];

function FilterStat({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: 'violet' | 'green' | 'amber';
  active: boolean;
  onClick: () => void;
}) {
  const color = tone === 'green' ? '#9fe3bf' : tone === 'amber' ? '#ecc987' : '#c4b5fd';
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative min-w-[112px] rounded-2xl border px-4 py-3 text-left transition"
      style={{
        borderColor: active ? 'rgba(139,124,240,.55)' : 'rgba(255,255,255,.07)',
        background: active
          ? 'linear-gradient(160deg, rgba(139,124,240,.18), rgba(139,124,240,.05))'
          : 'rgba(255,255,255,.025)',
      }}
    >
      <div className="text-[10px] font-bold uppercase tracking-[.12em] text-white/35">{label}</div>
      <div className="mt-1 text-[22px] font-bold" style={{ color }}>{value}</div>
      {active && <span className="absolute inset-x-3.5 -bottom-px h-0.5 rounded bg-[#8b7cf0]" />}
    </button>
  );
}

function ScoreRing({ value }: { value: number }) {
  const ring = value >= 70 ? '#8b7cf0' : value >= 35 ? '#d4a85f' : 'rgba(255,255,255,.28)';
  return (
    <div
      className="relative flex h-[54px] w-[54px] flex-none items-center justify-center rounded-full"
      style={{ background: `conic-gradient(${ring} ${value * 3.6}deg, rgba(255,255,255,.08) 0)` }}
    >
      <div className="absolute inset-[5px] rounded-full bg-[#10100f]" />
      <span className="relative text-[13px] font-bold" style={{ color: value >= 35 ? '#c4b5fd' : 'rgba(250,250,249,.5)' }}>
        %{value}
      </span>
    </div>
  );
}

function EmptyState({ missingCount, missing, onPick }: { missingCount: number; missing: string[]; onPick: (name: string) => void }) {
  const top = missing.slice(0, 5);
  return (
    <div className="flex min-h-[720px] items-center justify-center p-10">
      <div className="w-full max-w-[520px] text-center">
        <div
          className="mx-auto mb-5 flex h-[70px] w-[70px] items-center justify-center rounded-[20px] border border-[#8b7cf0]/25"
          style={{ background: 'linear-gradient(145deg, rgba(139,124,240,.2), rgba(139,124,240,.05))' }}
        >
          <ShieldCheck size={34} className="text-[#a78bfa]" />
        </div>
        <h3 className="text-[18px] font-bold text-[#fafaf9]">Soldan bir mükellef seç</h3>
        <p className="mx-auto mt-2 max-w-[440px] text-[13px] leading-6 text-white/45">
          Profili tanımlanan her mükellef için karar motoru hesap kodlarını, risk kurallarını ve firma talimatlarını otomatik uygular.{' '}
          {missingCount > 0 ? (
            <>
              <b className="text-[#c4b5fd]">{missingCount} mükellefin</b> henüz profili yok.
            </>
          ) : (
            'Tüm mükelleflerin profili tanımlı.'
          )}
        </p>
        {top.length > 0 && (
          <div className="mt-5 flex flex-col gap-1.5 rounded-2xl border border-white/[0.06] bg-black/20 p-3 text-left">
            <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[.1em] text-[#d4a85f]">En çok eksikler — hızlı başla</div>
            {top.map((name) => (
              <button
                key={name}
                onClick={() => onPick(name)}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-left transition hover:border-[#8b7cf0]/35"
              >
                <span className="truncate text-[13px] text-[#dcdce0]">{name}</span>
                <span className="flex-none text-[11px] text-white/35">profil yok →</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CopyModal({
  source,
  score,
  kod,
  kural,
  candidates,
  configured,
  targets,
  search,
  onSearch,
  onToggle,
  onClose,
  onConfirm,
  busy,
}: {
  source: string;
  score: number;
  kod: number;
  kural: number;
  candidates: string[];
  configured: (name: string) => boolean;
  targets: Set<string>;
  search: string;
  onSearch: (v: string) => void;
  onToggle: (name: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(5,5,8,.66)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-[#8b7cf0]/25 bg-[#0f0d0b]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[3px] w-full" style={{ background: 'linear-gradient(90deg,#8b7cf0,#a78bfa,#6d5fd1)' }} />
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(145deg,#8b7cf0,#6d5fd1)' }}>
              <Copy size={18} className="text-[#0b0a14]" />
            </div>
            <div>
              <div className="text-[15px] font-bold text-[#fafaf9]">Profili Kopyala</div>
              <div className="text-[12px] text-white/45">Bu profilin tüm ayarlarını seçtiğin mükellef(ler)e uygula.</div>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-white/45 hover:bg-white/[0.06]">
            <X size={17} />
          </button>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#8b7cf0]/20 px-3 py-2.5 text-[13px]" style={{ background: 'rgba(139,124,240,.08)' }}>
            <span className="text-[11px] font-bold uppercase tracking-[.08em] text-[#c4b5fd]">Kaynak</span>
            <b className="text-[#fafaf9]">{source}</b>
            <span className="text-white/35">· %{score} dolu · {kod} kod · {kural} kural</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2">
            <Search size={15} className="text-white/35" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Hedef mükellef ara..."
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[#fafaf9] outline-none placeholder:text-white/30"
            />
          </div>
          <div className="flex max-h-[240px] flex-col gap-1.5 overflow-y-auto">
            {candidates.map((name) => {
              const sel = targets.has(name);
              const has = configured(name);
              return (
                <button
                  key={name}
                  onClick={() => onToggle(name)}
                  className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[13px] transition"
                  style={{
                    borderColor: sel ? 'rgba(139,124,240,.45)' : 'rgba(255,255,255,.07)',
                    background: sel ? 'rgba(139,124,240,.1)' : 'rgba(255,255,255,.02)',
                  }}
                >
                  <span
                    className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-md border"
                    style={{ background: sel ? '#8b7cf0' : 'transparent', borderColor: sel ? '#8b7cf0' : 'rgba(255,255,255,.25)' }}
                  >
                    {sel && <Check size={12} className="text-[#0b0a14]" strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate text-[#e5e7eb]">{name}</span>
                  <span className="flex-none text-[11px]" style={{ color: has ? '#d4a85f' : 'rgba(250,250,249,.32)' }}>
                    {has ? 'profil var' : 'profil yok'}
                  </span>
                </button>
              );
            })}
            {candidates.length === 0 && <div className="px-3 py-8 text-center text-[13px] text-white/35">Sonuç yok</div>}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-4">
          <span className="text-[12px] text-white/45">
            <b className="text-[#c4b5fd]">{targets.size}</b> mükellef seçili
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="inline-flex h-10 items-center rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 text-[13px] font-semibold text-white/65">
              Vazgeç
            </button>
            <button
              onClick={onConfirm}
              disabled={busy || targets.size === 0}
              className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-[13px] font-bold text-[#0b0a14] disabled:opacity-40"
              style={{ background: 'linear-gradient(145deg,#8b7cf0,#6d5fd1)', borderColor: 'rgba(139,124,240,.5)' }}
            >
              <Copy size={15} /> {busy ? 'Kopyalanıyor...' : `${targets.size ? `${targets.size} ` : ''}Mükellefe Kopyala`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function StatusPill({ icon, label, tone = 'default' }: { icon: ReactNode; label: string; tone?: 'default' | 'green' | 'amber' }) {
  const toneClass =
    tone === 'green'
      ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
      : tone === 'amber'
        ? 'border-amber-400/20 bg-amber-500/10 text-amber-200'
        : 'border-white/[0.07] bg-white/[0.035] text-white/60';
  return (
    <span className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm ${toneClass}`}>
      {icon}
      <span className="max-w-[220px] truncate">{label}</span>
    </span>
  );
}

function Panel({
  title,
  icon,
  children,
  columns = 3,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  const gridClass = columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 lg:grid-cols-3';
  return (
    <section className="rounded-xl border border-white/[0.06] bg-black/10">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3 text-sm font-semibold uppercase tracking-[.12em] text-[#b3a4ef]">
        {icon}
        {title}
      </div>
      <div className={`grid gap-3 p-4 ${gridClass}`}>{children}</div>
    </section>
  );
}

function KeywordEditor({
  label,
  value,
  onChange,
  suggestions = [],
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suggestions?: string[];
  className?: string;
}) {
  const [draft, setDraft] = useState('');
  const keywords = parseKeywords(value);
  const addKeyword = (keyword: string) => {
    const clean = keyword.trim();
    if (!clean) return;
    onChange(joinKeywords([...keywords, clean]));
    setDraft('');
  };
  const removeKeyword = (index: number) => {
    onChange(joinKeywords(keywords.filter((_, i) => i !== index)));
  };

  return (
    <div className={`rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 ${className}`}>
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[.12em] text-white/35">{label}</div>
          <p className="mt-1 text-xs text-white/40">Bu kelimeler yakalanınca risk talimatları devreye girer.</p>
        </div>
        <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-200">
          {keywords.length} kelime
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {keywords.map((keyword, index) => (
          <span
            key={`${keyword}-${index}`}
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/10 px-3 text-sm font-semibold text-amber-100"
          >
            {keyword}
            <button
              type="button"
              onClick={() => removeKeyword(index)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-amber-100/70 hover:bg-white/10 hover:text-amber-50"
              aria-label={`${keyword} kelimesini sil`}
            >
              <X size={13} />
            </button>
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addKeyword(draft);
            }
          }}
          placeholder="Yeni anahtar kelime"
          className="h-10 min-w-0 flex-1 rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 text-sm text-[#e5e7eb] outline-none placeholder:text-white/24 focus:border-[#8b7cf0]/45"
        />
        <button
          type="button"
          onClick={() => addKeyword(draft)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/15 px-3 text-sm font-semibold text-emerald-200"
        >
          <Plus size={15} /> Ekle
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              onClick={() => addKeyword(suggestion)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 text-xs font-semibold text-white/55 hover:text-[#c4b5fd]"
            >
              <Plus size={12} /> {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RuleListEditor({
  title,
  description,
  value,
  onChange,
  placeholder,
  lineLabel,
  templates = [],
  className = '',
}: {
  title: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  lineLabel: string;
  templates?: string[];
  className?: string;
}) {
  const [draft, setDraft] = useState('');
  const lines = parseRuleLines(value);

  const addLine = (line: string) => {
    const clean = line.trim();
    if (!clean) return;
    onChange(joinRuleLines([...lines, clean]));
    setDraft('');
  };
  const updateLine = (index: number, line: string) => {
    const next = [...lines];
    next[index] = line;
    onChange(joinRuleLines(next));
  };
  const removeLine = (index: number) => {
    onChange(joinRuleLines(lines.filter((_, i) => i !== index)));
  };
  const moveLine = (index: number, direction: -1 | 1) => {
    const next = [...lines];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(joinRuleLines(next));
  };

  return (
    <div className={`rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 ${className}`}>
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#c4b5fd]">
            <ListChecks size={16} />
            {title}
          </div>
          {description && <p className="mt-1 max-w-3xl text-xs leading-5 text-white/42">{description}</p>}
        </div>
        <span className="w-fit rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-200">
          {lines.length} kayıt
        </span>
      </div>

      {templates.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {templates.map((template) => (
            <button
              type="button"
              key={template}
              onClick={() => addLine(template)}
              className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-[#8b7cf0]/20 bg-[#8b7cf0]/10 px-3 text-xs font-semibold text-[#c4b5fd] hover:bg-[#8b7cf0]/15"
            >
              <Sparkles size={12} className="shrink-0" />
              <span className="max-w-[520px] truncate">{template}</span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={`${line}-${index}`} className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-[.1em] text-white/32">
                {lineLabel} {index + 1}
              </span>
              <div className="flex items-center gap-1">
                <IconButton label="Yukarı taşı" onClick={() => moveLine(index, -1)} disabled={index === 0}>
                  <ArrowUp size={14} />
                </IconButton>
                <IconButton label="Aşağı taşı" onClick={() => moveLine(index, 1)} disabled={index === lines.length - 1}>
                  <ArrowDown size={14} />
                </IconButton>
                <IconButton label="Sil" onClick={() => removeLine(index)} tone="danger">
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </div>
            <textarea
              value={line}
              onChange={(e) => updateLine(index, e.target.value)}
              rows={2}
              className="w-full resize-y rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-sm leading-6 text-[#e5e7eb] outline-none placeholder:text-white/24 focus:border-[#8b7cf0]/45"
            />
          </div>
        ))}

        {lines.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/[0.09] px-4 py-6 text-center text-sm text-white/35">
            Henüz kayıt yok. Aşağıdan yeni {lineLabel.toLocaleLowerCase('tr-TR')} ekleyebilirsin.
          </div>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/15 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[.1em] text-white/32">Yeni {lineLabel}</div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder={placeholder}
          className="w-full rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-sm leading-6 text-[#e5e7eb] outline-none placeholder:text-white/24 focus:border-[#8b7cf0]/45"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => addLine(draft)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/15 px-3 text-sm font-semibold text-emerald-200"
          >
            <Plus size={15} /> {lineLabel} Ekle
          </button>
        </div>
      </div>
    </div>
  );
}

function FirmRuleEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draftFirm, setDraftFirm] = useState('');
  const [draftInstruction, setDraftInstruction] = useState('');
  const rules = parseFirmRules(value);

  const commit = (rule: { firm: string; instruction: string }) => {
    if (!rule.firm.trim() && !rule.instruction.trim()) return;
    onChange(joinFirmRules([...rules, rule]));
    setDraftFirm('');
    setDraftInstruction('');
  };
  const update = (index: number, patch: Partial<{ firm: string; instruction: string }>) => {
    const next = rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
    onChange(joinFirmRules(next));
  };
  const remove = (index: number) => {
    onChange(joinFirmRules(rules.filter((_, i) => i !== index)));
  };
  const move = (index: number, direction: -1 | 1) => {
    const next = [...rules];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(joinFirmRules(next));
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#c4b5fd]">
            <Building2 size={16} />
            Karşı firma bazlı manuel kurallar
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-white/42">
            Firma adı eşleşirse bu talimat genel firma hafızasından önce uygulanır.
          </p>
        </div>
        <span className="w-fit rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-200">
          {rules.length} firma kuralı
        </span>
      </div>

      <div className="hidden">
        {FIRM_RULE_TEMPLATES.map((template) => (
          <button
            type="button"
            key={`${template.firm}-${template.instruction}`}
            onClick={() => commit(template)}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#8b7cf0]/20 bg-[#8b7cf0]/10 px-3 text-xs font-semibold text-[#c4b5fd] hover:bg-[#8b7cf0]/15"
          >
            <Sparkles size={12} /> {template.firm}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {rules.map((rule, index) => (
          <div key={`${rule.firm}-${rule.instruction}-${index}`} className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-[.1em] text-white/32">Firma Kuralı {index + 1}</span>
              <div className="flex items-center gap-1">
                <IconButton label="Yukarı taşı" onClick={() => move(index, -1)} disabled={index === 0}>
                  <ArrowUp size={14} />
                </IconButton>
                <IconButton label="Aşağı taşı" onClick={() => move(index, 1)} disabled={index === rules.length - 1}>
                  <ArrowDown size={14} />
                </IconButton>
                <IconButton label="Sil" onClick={() => remove(index)} tone="danger">
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </div>
            <div className="grid gap-2 lg:grid-cols-[260px_minmax(0,1fr)]">
              <Input label="Firma" value={rule.firm} onChange={(firm) => update(index, { firm })} placeholder="ÇETAŞ OTOMOTİV" />
              <Textarea
                label="Talimat"
                value={rule.instruction}
                onChange={(instruction) => update(index, { instruction })}
                rows={2}
                placeholder="Araç alımı veya ÖTV varsa otomatik F2 yapma."
              />
            </div>
          </div>
        ))}

        {rules.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/[0.09] px-4 py-6 text-center text-sm text-white/35">
            Henüz firma kuralı yok. Aşağıdan firma ve talimat ekleyebilirsin.
          </div>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/15 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[.1em] text-white/32">Yeni Firma Kuralı</div>
        <div className="grid gap-2 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Input label="Firma" value={draftFirm} onChange={setDraftFirm} placeholder="Firma adı" />
          <Textarea
            label="Talimat"
            value={draftInstruction}
            onChange={setDraftInstruction}
            rows={3}
            placeholder="Bu firma için karar kuralını yaz."
          />
        </div>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => commit({ firm: draftFirm, instruction: draftInstruction })}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/15 px-3 text-sm font-semibold text-emerald-200"
          >
            <Plus size={15} /> Firma Kuralı Ekle
          </button>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  disabled = false,
  tone = 'default',
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  const toneClass =
    tone === 'danger'
      ? 'border-red-400/20 text-red-300 hover:bg-red-500/10'
      : 'border-white/[0.07] text-white/45 hover:bg-white/[0.06] hover:text-white/70';
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border disabled:cursor-not-allowed disabled:opacity-30 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function KdvBlock({
  title,
  group,
  values,
  onUpdateKdv,
  basePlaceholder,
}: {
  title: string;
  group: KdvGroup;
  values?: KdvOranBazli;
  onUpdateKdv: (key: KdvGroup, oran: keyof KdvOranBazli, value: string) => void;
  basePlaceholder: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#c4b5fd]">{title}</h3>
        <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/40">
          {countFilledKdv(values)} / 5 dolu
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        <Input label="%1" value={values?.yuzde1 || ''} onChange={(v) => onUpdateKdv(group, 'yuzde1', v)} placeholder={`${basePlaceholder}.001`} />
        <Input label="%8" value={values?.yuzde8 || ''} onChange={(v) => onUpdateKdv(group, 'yuzde8', v)} placeholder={`${basePlaceholder}.008`} />
        <Input label="%10" value={values?.yuzde10 || ''} onChange={(v) => onUpdateKdv(group, 'yuzde10', v)} placeholder={`${basePlaceholder}.010`} />
        <Input label="%18" value={values?.yuzde18 || ''} onChange={(v) => onUpdateKdv(group, 'yuzde18', v)} placeholder={`${basePlaceholder}.018`} />
        <Input label="%20" value={values?.yuzde20 || ''} onChange={(v) => onUpdateKdv(group, 'yuzde20', v)} placeholder={`${basePlaceholder}.020`} />
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex min-h-[58px] items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-left"
    >
      <span className="text-sm font-semibold text-white/70">{label}</span>
      <span
        className="relative h-6 w-11 rounded-full transition"
        style={{ background: checked ? 'rgba(16,185,129,.45)' : 'rgba(255,255,255,.12)' }}
      >
        <span
          className="absolute top-1 h-4 w-4 rounded-full bg-white transition"
          style={{ left: checked ? 22 : 4 }}
        />
      </span>
    </button>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[.08em] text-white/32">{label}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 text-sm text-[#e5e7eb] outline-none placeholder:text-white/24 focus:border-[#8b7cf0]/45"
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
  className = '',
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      {label && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[.08em] text-white/32">{label}</div>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-sm leading-6 text-[#e5e7eb] outline-none placeholder:text-white/24 focus:border-[#8b7cf0]/45"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block min-w-0">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[.08em] text-white/32">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 text-sm text-[#e5e7eb] outline-none focus:border-[#8b7cf0]/45"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#151513] text-[#e5e7eb]">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
