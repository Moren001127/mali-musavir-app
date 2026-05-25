'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Bot,
  Building2,
  CheckCircle2,
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

export default function ProfillerPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [profile, setProfile] = useState<MukellefProfile>(EMPTY_PROFILE);
  const [search, setSearch] = useState('');

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

  const ruleMap = useMemo(() => new Map(rules.map((r) => [r.mukellef, r])), [rules]);
  const configuredCount = rules.length;
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    return taxpayers
      .filter((t) => !q || taxpayerName(t).toLocaleLowerCase('tr-TR').includes(q))
      .sort((a, b) => taxpayerName(a).localeCompare(taxpayerName(b), 'tr'));
  }, [search, taxpayers]);

  const selectTaxpayer = (name: string) => {
    setSelected(name);
    setProfile(mergeProfile(ruleMap.get(name)?.profile as MukellefProfile | undefined));
  };

  const updP = <K extends keyof MukellefProfile>(key: K, value: MukellefProfile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }));

  const updKdv = (key: KdvGroup, oran: keyof KdvOranBazli, value: string) =>
    setProfile((p) => ({ ...p, [key]: { ...(p[key] || {}), [oran]: value } }));

  const saveProfile = () => {
    if (!selected) return;
    const profileToSave: MukellefProfile = {
      ...profile,
      malSatisMatrah: profile.faturaSatisMatrah || profile.malSatisMatrah,
      hizmetSatisMatrah: profile.perakendeSatisMatrah || profile.hizmetSatisMatrah,
    };
    upsert.mutate({ mukellef: selected, profile: profileToSave });
  };

  return (
    <div className="max-w-[1680px] space-y-5">
      <div className="flex flex-col gap-4 border-b border-white/[0.06] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2.5">
            <span className="h-px w-8 bg-[#d4b876]" />
            <span className="text-[10px] font-bold uppercase tracking-[.18em] text-[#b8a06f]">Ajan</span>
          </div>
          <h1
            className="text-[34px] font-semibold leading-none text-[#fafaf9]"
            style={{ fontFamily: 'Fraunces, serif', letterSpacing: '-0.02em' }}
          >
            Mükellef Profilleri
          </h1>
          <p className="mt-2 max-w-3xl text-[13px] text-white/45">
            Fatura karar motorunun mükellef bazlı hesap kodu, risk ve özel talimat merkezi.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Metric label="Mükellef" value={taxpayers.length} />
          <Metric label="Tanımlı" value={configuredCount} tone="green" />
          <Metric label="Eksik" value={Math.max(0, taxpayers.length - configuredCount)} tone="amber" />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="min-h-[720px] rounded-xl border border-white/[0.06] bg-white/[0.025]">
          <div className="border-b border-white/[0.06] p-4">
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
          <div className="max-h-[calc(100vh-255px)] overflow-y-auto p-2">
            {filtered.map((t) => {
              const name = taxpayerName(t);
              const has = ruleMap.has(name);
              const active = selected === name;
              return (
                <button
                  key={t.id}
                  onClick={() => selectTaxpayer(name)}
                  className="group mb-1 grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition"
                  style={{
                    background: active ? 'rgba(184,160,111,.13)' : 'transparent',
                    color: active ? '#d9c78f' : '#cbd5e1',
                  }}
                >
                  {has ? (
                    <Bot size={14} className={active ? 'text-[#8ecf96]' : 'text-[#6a9a6c]'} />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                  )}
                  <span className="truncate font-medium">{name}</span>
                  {has && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">kural</span>}
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
            <div className="flex min-h-[720px] items-center justify-center text-sm text-white/40">
              Sol listeden mükellef seç
            </div>
          ) : (
            <ProfileForm
              selected={selected}
              profile={profile}
              has={ruleMap.has(selected)}
              onUpdate={updP}
              onUpdateKdv={updKdv}
              onSave={saveProfile}
              onDelete={() => {
                if (confirm(`${selected} için profil silinsin mi?`)) del.mutate(selected);
              }}
              saving={upsert.isPending}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function ProfileForm({
  selected,
  profile,
  has,
  onUpdate,
  onUpdateKdv,
  onSave,
  onDelete,
  saving,
}: {
  selected: string;
  profile: MukellefProfile;
  has: boolean;
  onUpdate: <K extends keyof MukellefProfile>(k: K, v: MukellefProfile[K]) => void;
  onUpdateKdv: (key: KdvGroup, oran: keyof KdvOranBazli, value: string) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [tab, setTab] = useState<ProfileTab>('genel');
  const kdvCodeCount =
    countFilledKdv(profile.faturaSatisMatrah) +
    countFilledKdv(profile.perakendeSatisMatrah) +
    countFilledKdv(profile.malAlisMatrah) +
    countFilledKdv(profile.hesaplananKdv) +
    countFilledKdv(profile.indirilecekKdv);
  const ruleCount = [
    profile.demirbasKontrolAktif !== false,
    !!profile.tevkifataTabi,
    ...Array(countManagedRules(profile.ozelKararKurallari)).fill(true),
    ...Array(countManagedRules(profile.firmaOzelTalimatlar)).fill(true),
    ...Array(countManagedRules(profile.talimat)).fill(true),
  ].filter(Boolean).length;

  return (
    <div className="min-h-[720px]">
      <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#10100f]/95 px-5 py-4 backdrop-blur">
        <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="min-w-0">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[.16em] text-white/35">Mükellef</div>
            <div className="truncate text-xl font-semibold text-[#d9c78f]">{selected}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill icon={<FileText size={14} />} label={profile.sektor || 'Sektör yok'} />
            <StatusPill icon={<ReceiptText size={14} />} label={`${kdvCodeCount} hesap kodu`} tone={kdvCodeCount ? 'green' : 'amber'} />
            <StatusPill icon={<ListChecks size={14} />} label={`${ruleCount} kural`} tone={ruleCount ? 'green' : 'amber'} />
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
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/20 px-4 text-sm font-semibold text-emerald-200 disabled:opacity-50"
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
                borderColor: tab === key ? 'rgba(212,184,118,.45)' : 'rgba(255,255,255,.07)',
                background: tab === key ? 'rgba(212,184,118,.14)' : 'rgba(255,255,255,.03)',
                color: tab === key ? '#d9c78f' : 'rgba(250,250,249,.62)',
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
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#d9c78f]">
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

function Metric({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'green' | 'amber' }) {
  const color = tone === 'green' ? '#86efac' : tone === 'amber' ? '#facc15' : '#d9c78f';
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-white/35">{label}</div>
      <div className="mt-1 text-xl font-semibold" style={{ color }}>{value}</div>
    </div>
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
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3 text-sm font-semibold uppercase tracking-[.12em] text-[#b8a06f]">
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
          className="h-10 min-w-0 flex-1 rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 text-sm text-[#e5e7eb] outline-none placeholder:text-white/24 focus:border-[#d4b876]/45"
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
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 text-xs font-semibold text-white/55 hover:text-[#d9c78f]"
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
          <div className="flex items-center gap-2 text-sm font-semibold text-[#d9c78f]">
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
              className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-[#d4b876]/20 bg-[#d4b876]/10 px-3 text-xs font-semibold text-[#ead79b] hover:bg-[#d4b876]/15"
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
              className="w-full resize-y rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-sm leading-6 text-[#e5e7eb] outline-none placeholder:text-white/24 focus:border-[#d4b876]/45"
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
          className="w-full rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-sm leading-6 text-[#e5e7eb] outline-none placeholder:text-white/24 focus:border-[#d4b876]/45"
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
          <div className="flex items-center gap-2 text-sm font-semibold text-[#d9c78f]">
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
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#d4b876]/20 bg-[#d4b876]/10 px-3 text-xs font-semibold text-[#ead79b] hover:bg-[#d4b876]/15"
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
        <h3 className="text-sm font-semibold text-[#d9c78f]">{title}</h3>
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
        className="h-10 w-full rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 text-sm text-[#e5e7eb] outline-none placeholder:text-white/24 focus:border-[#d4b876]/45"
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
        className="w-full rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-sm leading-6 text-[#e5e7eb] outline-none placeholder:text-white/24 focus:border-[#d4b876]/45"
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
        className="h-10 w-full rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 text-sm text-[#e5e7eb] outline-none focus:border-[#d4b876]/45"
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
