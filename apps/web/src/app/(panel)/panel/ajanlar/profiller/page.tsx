'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Save, Trash2, Bot } from 'lucide-react';
import { toast } from 'sonner';
import type {
  MukellefProfile,
  KdvOranBazli,
  HesapTuru,
  DefterTuru,
  CariTakipPolitikasi,
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
    'araba, arac, otomobil, kamyonet, bilgisayar, laptop, yazici, telefon, televizyon, TV, klima, mobilya, masa, sandalye, raf, makine, ekipman, cihaz, demirbas',
  demirbasTalimat:
    'Demirbas adayi ise otomatik F2 yapma. Onay bekliyor kararina dusur; hesap kodunu insan secsin.',
  talimat: '',
};

function mergeProfile(existing?: MukellefProfile): MukellefProfile {
  const merged: MukellefProfile = { ...EMPTY_PROFILE, ...(existing || {}) };
  merged.faturaSatisMatrah = merged.faturaSatisMatrah || merged.malSatisMatrah || emptyKdv();
  merged.perakendeSatisMatrah = merged.perakendeSatisMatrah || merged.hizmetSatisMatrah || emptyKdv();
  merged.malAlisMatrah = merged.malAlisMatrah || emptyKdv();
  merged.hesaplananKdv = merged.hesaplananKdv || emptyKdv();
  merged.indirilecekKdv = merged.indirilecekKdv || emptyKdv();
  return merged;
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
      toast.success('Silindi');
      setSelected(null);
      setProfile(EMPTY_PROFILE);
    },
  });

  const ruleMap = new Map(rules.map((r) => [r.mukellef, r]));
  const filtered = taxpayers.filter((t) =>
    taxpayerName(t).toLowerCase().includes(search.toLowerCase()),
  );

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
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: '#d4b876' }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Ajan</span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
            Mükellef Profilleri
          </h1>
          <p className="text-[13px] mt-1.5 max-w-2xl" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Her mükellef için yapılandırılmış profil ve talimatlar. Fatura agenti karar verirken bu bilgileri kullanır.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          className="rounded-xl border p-3"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mükellef ara..."
            className="w-full px-3 py-2 rounded-lg text-sm border outline-none mb-2"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#fafaf9' }}
          />
          <div className="space-y-0.5 max-h-[70vh] overflow-y-auto">
            {filtered.map((t) => {
              const name = taxpayerName(t);
              const has = ruleMap.has(name);
              const active = selected === name;
              return (
                <button
                  key={t.id}
                  onClick={() => selectTaxpayer(name)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors"
                  style={{
                    background: active ? 'rgba(184,160,111,.12)' : 'transparent',
                    color: active ? '#b8a06f' : '#cbd5e1',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {has && <Bot size={13} style={{ color: '#6a9a6c' }} />}
                  <span className="flex-1 truncate">{name}</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-xs p-3 text-center" style={{ color: 'rgba(250,250,249,0.45)' }}>
                Sonuç yok
              </div>
            )}
          </div>
        </div>

        <div
          className="md:col-span-2 rounded-xl border p-5"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          {!selected ? (
            <div className="text-center py-16" style={{ color: 'rgba(250,250,249,0.45)' }}>
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
        </div>
      </div>
    </div>
  );
}

function ProfileForm({
  selected, profile, has, onUpdate, onUpdateKdv, onSave, onDelete, saving,
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
  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Mükellef
          </div>
          <div className="font-semibold text-lg" style={{ color: '#b8a06f' }}>
            {selected}
          </div>
        </div>
        {has && (
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm"
            style={{ background: 'rgba(200,85,85,.1)', color: '#c85555' }}
          >
            <Trash2 size={13} /> Sil
          </button>
        )}
      </div>

      <Section title="Genel">
        <Input label="Sektör / Faaliyet" value={profile.sektor || ''} onChange={(v) => onUpdate('sektor', v)} placeholder="Örn: eczane, toptan gıda, inşaat" />
        <Select label="Defter Türü" value={profile.defterTuru || ''} onChange={(v) => onUpdate('defterTuru', v as DefterTuru)} options={[
          { value: '', label: '- seçiniz -' },
          { value: 'bilanco', label: 'Bilanço' },
          { value: 'isletme', label: 'İşletme' },
        ]} />
      </Section>

      <Section title="Fatura / e-Belge Satış Matrah Hesapları">
        <KdvInputs group="faturaSatisMatrah" values={profile.faturaSatisMatrah || profile.malSatisMatrah} onUpdateKdv={onUpdateKdv} basePlaceholder="600.01" />
      </Section>

      <Section title="Perakende / Z Raporu Satış Matrah Hesapları">
        <KdvInputs group="perakendeSatisMatrah" values={profile.perakendeSatisMatrah || profile.hizmetSatisMatrah} onUpdateKdv={onUpdateKdv} basePlaceholder="600.02" />
      </Section>

      <Section title="Ticari Mal Alışı Matrah Hesapları (KDV oranı bazında) - Zorunlu Öncelik">
        <KdvInputs group="malAlisMatrah" values={profile.malAlisMatrah} onUpdateKdv={onUpdateKdv} basePlaceholder="153.01" />
      </Section>

      <Section title="Hesaplanan KDV Hesapları (391.x)">
        <KdvInputs group="hesaplananKdv" values={profile.hesaplananKdv} onUpdateKdv={onUpdateKdv} basePlaceholder="391.01" />
      </Section>

      <Section title="İndirilecek KDV Hesapları (191.x)">
        <KdvInputs group="indirilecekKdv" values={profile.indirilecekKdv} onUpdateKdv={onUpdateKdv} basePlaceholder="191.01" />
      </Section>

      <Section title="Cari & Ödeme">
        <Input label="Cari Hesap Formatı" value={profile.cariFormat || ''} onChange={(v) => onUpdate('cariFormat', v)} placeholder="120.01.{kod} / 320.01.{kod}" />
        <Input label="Tahsilat Hesabı" value={profile.tahsilatHesabi || ''} onChange={(v) => onUpdate('tahsilatHesabi', v)} placeholder="100.01.001" />
        <Select label="Tahsilat Türü" value={profile.tahsilatHesapTuru || ''} onChange={(v) => onUpdate('tahsilatHesapTuru', v as HesapTuru)} options={HESAP_OPTIONS} />
        <Input label="Ödeme Hesabı" value={profile.odemeHesabi || ''} onChange={(v) => onUpdate('odemeHesabi', v)} placeholder="100.01.001 / 102.01.001" />
        <Select label="Ödeme Türü" value={profile.odemeHesapTuru || ''} onChange={(v) => onUpdate('odemeHesapTuru', v as HesapTuru)} options={HESAP_OPTIONS} />
        <Select label="Cari Takip Politikası" value={profile.cariTakipPolitikasi || ''} onChange={(v) => onUpdate('cariTakipPolitikasi', v as CariTakipPolitikasi)} options={CARI_POLICY_OPTIONS} />
        <Input label="Cari yoksa kullanılacak hesap" value={profile.cariYoksaHesap || ''} onChange={(v) => onUpdate('cariYoksaHesap', v)} placeholder="100.01.001 / 102.01.001" />
        <Textarea label="Sürekli cari takip edilecek firmalar" value={profile.surekliTedarikciler || ''} onChange={(v) => onUpdate('surekliTedarikciler', v)} rows={4} placeholder={`Örn:\nSANCAK ECZA -> 320.01.002\nMEDAŞ -> 320.01.015\nTek seferlik market/akaryakıt alışları cari açılmasın.`} />
      </Section>

      <Section title="Demirbaş Kontrolü">
        <label className="flex items-center gap-2 text-sm" style={{ color: '#cbd5e1' }}>
          <input
            type="checkbox"
            checked={profile.demirbasKontrolAktif !== false}
            onChange={(e) => onUpdate('demirbasKontrolAktif', e.target.checked)}
          />
          Demirbaş adaylarını otomatik F2 yapmadan onaya düşür
        </label>
        <Textarea label="Demirbaş anahtar kelimeleri" value={profile.demirbasAnahtarKelimeler || ''} onChange={(v) => onUpdate('demirbasAnahtarKelimeler', v)} rows={3} placeholder="araba, bilgisayar, laptop, klima, televizyon, mobilya, makine, cihaz..." />
        <Textarea label="Demirbaş talimatı" value={profile.demirbasTalimat || ''} onChange={(v) => onUpdate('demirbasTalimat', v)} rows={3} placeholder="Demirbaş adayı ise otomatik F2 yapma; onay bekliyor kararına düşür." />
      </Section>

      <Section title="Tevkifat">
        <label className="flex items-center gap-2 text-sm" style={{ color: '#cbd5e1' }}>
          <input
            type="checkbox"
            checked={!!profile.tevkifataTabi}
            onChange={(e) => onUpdate('tevkifataTabi', e.target.checked)}
          />
          Bu mükellef tevkifata tabi mi?
        </label>
        <p className="text-xs mt-1" style={{ color: '#6b6b6b' }}>
          Sistem kuralı: nakliye/servis/demir içerikli ve KDV dahil 12.000 TL üzeri faturalar ayrıca denetlenir.
        </p>
      </Section>

      <Section title="Özel Talimatlar">
        <Textarea
          value={profile.talimat || ''}
          onChange={(v) => onUpdate('talimat', v)}
          rows={8}
          placeholder={`Örnek:\n- Akaryakıt faturaları 740.01.001'e yazılır.\n- Z raporu satışları perakende 600.02 kodlarına gider.\n- Fatura içeriği demirbaş adayıysa otomatik onaylama.`}
        />
      </Section>

      <div className="flex items-center justify-between mt-5 pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <p className="text-xs" style={{ color: '#6b6b6b' }}>
          Profil ve sistem kuralları her fatura kararında agent prompt'una eklenir.
        </p>
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
          style={{ background: '#6a9a6c', color: 'white' }}
        >
          <Save size={14} /> {saving ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
      </div>
    </>
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
  { value: 'sadece_tanimli', label: 'Sadece tanımlı/sürekli firmalar' },
  { value: 'cari_yoksa_odeme', label: 'Cari yoksa ödeme/kasa hesabı kullan' },
  { value: 'cari_yoksa_onay', label: 'Cari yoksa onay iste' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: '#b8a06f' }}>{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">{children}</div>
    </div>
  );
}

function KdvInputs({
  group,
  values,
  onUpdateKdv,
  basePlaceholder,
}: {
  group: KdvGroup;
  values?: KdvOranBazli;
  onUpdateKdv: (key: KdvGroup, oran: keyof KdvOranBazli, value: string) => void;
  basePlaceholder: string;
}) {
  return (
    <>
      <Input label="%1 kodu" value={values?.yuzde1 || ''} onChange={(v) => onUpdateKdv(group, 'yuzde1', v)} placeholder={`${basePlaceholder}.001`} />
      <Input label="%8 kodu" value={values?.yuzde8 || ''} onChange={(v) => onUpdateKdv(group, 'yuzde8', v)} placeholder={`${basePlaceholder}.008`} />
      <Input label="%10 kodu" value={values?.yuzde10 || ''} onChange={(v) => onUpdateKdv(group, 'yuzde10', v)} placeholder={`${basePlaceholder}.010`} />
      <Input label="%18 kodu" value={values?.yuzde18 || ''} onChange={(v) => onUpdateKdv(group, 'yuzde18', v)} placeholder={`${basePlaceholder}.018`} />
      <Input label="%20 kodu" value={values?.yuzde20 || ''} onChange={(v) => onUpdateKdv(group, 'yuzde20', v)} placeholder={`${basePlaceholder}.020`} />
    </>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <div className="text-[11px] mb-1" style={{ color: '#6b6b6b' }}>{label}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
        style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#cbd5e1' }}
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
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block sm:col-span-3">
      {label && <div className="text-[11px] mb-1" style={{ color: '#6b6b6b' }}>{label}</div>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg text-sm border outline-none font-mono"
        style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#cbd5e1', minHeight: rows >= 8 ? 160 : undefined }}
      />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="block">
      <div className="text-[11px] mb-1" style={{ color: '#6b6b6b' }}>{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
        style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#cbd5e1' }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
