'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Save, Trash2, Bot } from 'lucide-react';
import { toast } from 'sonner';
import type { MukellefProfile, KdvOranBazli, HesapTuru, DefterTuru } from '@/lib/mukellef-profile';

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

function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

const EMPTY_PROFILE: MukellefProfile = {
  sektor: '',
  defterTuru: '',
  malSatisMatrah: { yuzde1: '', yuzde10: '', yuzde20: '' },
  hizmetSatisMatrah: { yuzde1: '', yuzde10: '', yuzde20: '' },
  hesaplananKdv: { yuzde1: '', yuzde10: '', yuzde20: '' },
  indirilecekKdv: { yuzde1: '', yuzde10: '', yuzde20: '' },
  cariFormat: '',
  tahsilatHesabi: '',
  tahsilatHesapTuru: '',
  odemeHesabi: '',
  odemeHesapTuru: '',
  tevkifataTabi: false,
  talimat: '',
};

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
    const existing = ruleMap.get(name)?.profile as MukellefProfile | undefined;
    setProfile({ ...EMPTY_PROFILE, ...(existing || {}) });
  };

  const updP = <K extends keyof MukellefProfile>(key: K, value: MukellefProfile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }));

  const updKdv = (
    key: 'malSatisMatrah' | 'hizmetSatisMatrah' | 'hesaplananKdv' | 'indirilecekKdv',
    oran: keyof KdvOranBazli,
    value: string,
  ) => setProfile((p) => ({ ...p, [key]: { ...(p[key] || {}), [oran]: value } }));

  return (
    <div className="space-y-5 max-w-7xl">
      {/* HEADER */}
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
            Her mükellef için yapılandırılmış profil + serbest talimatlar. AI fatura işlerken bu bilgileri kullanır.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Sol: Mükellef listesi */}
        <div
          className="rounded-xl border p-3"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mükellef ara…"
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

        {/* Sağ: Form */}
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
              onSave={() => upsert.mutate({ mukellef: selected, profile })}
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
  onUpdateKdv: (
    key: 'malSatisMatrah' | 'hizmetSatisMatrah' | 'hesaplananKdv' | 'indirilecekKdv',
    oran: keyof KdvOranBazli, value: string,
  ) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  return (
    <>
      {/* Üst — başlık + sil */}
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

      {/* GENEL */}
      <Section title="Genel">
        <Input label="Sektör / Faaliyet" value={profile.sektor || ''} onChange={(v) => onUpdate('sektor', v)} placeholder="Örn: Toptan gıda ticareti" />
        <Select label="Defter Türü" value={profile.defterTuru || ''} onChange={(v) => onUpdate('defterTuru', v as DefterTuru)} options={[
          { value: '', label: '— seçiniz —' },
          { value: 'bilanco', label: 'Bilanço' },
          { value: 'isletme', label: 'İşletme' },
        ]} />
      </Section>

      {/* MAL SATIŞI MATRAH */}
      <Section title="Mal Satışı Matrah Hesapları (KDV oranı bazında)">
        <Input label="%1 kodu"  value={profile.malSatisMatrah?.yuzde1  || ''} onChange={(v) => onUpdateKdv('malSatisMatrah', 'yuzde1', v)}  placeholder="600.01.001" />
        <Input label="%10 kodu" value={profile.malSatisMatrah?.yuzde10 || ''} onChange={(v) => onUpdateKdv('malSatisMatrah', 'yuzde10', v)} placeholder="600.01.010" />
        <Input label="%20 kodu" value={profile.malSatisMatrah?.yuzde20 || ''} onChange={(v) => onUpdateKdv('malSatisMatrah', 'yuzde20', v)} placeholder="600.01.020" />
      </Section>

      {/* HİZMET SATIŞI MATRAH */}
      <Section title="Hizmet Satışı Matrah Hesapları">
        <Input label="%1 kodu"  value={profile.hizmetSatisMatrah?.yuzde1  || ''} onChange={(v) => onUpdateKdv('hizmetSatisMatrah', 'yuzde1', v)}  placeholder="600.02.001" />
        <Input label="%10 kodu" value={profile.hizmetSatisMatrah?.yuzde10 || ''} onChange={(v) => onUpdateKdv('hizmetSatisMatrah', 'yuzde10', v)} placeholder="600.02.010" />
        <Input label="%20 kodu" value={profile.hizmetSatisMatrah?.yuzde20 || ''} onChange={(v) => onUpdateKdv('hizmetSatisMatrah', 'yuzde20', v)} placeholder="600.02.020" />
      </Section>

      {/* HESAPLANAN KDV */}
      <Section title="Hesaplanan KDV Hesapları (391.x)">
        <Input label="%1 kodu"  value={profile.hesaplananKdv?.yuzde1  || ''} onChange={(v) => onUpdateKdv('hesaplananKdv', 'yuzde1', v)}  placeholder="391.01.001" />
        <Input label="%10 kodu" value={profile.hesaplananKdv?.yuzde10 || ''} onChange={(v) => onUpdateKdv('hesaplananKdv', 'yuzde10', v)} placeholder="391.01.010" />
        <Input label="%20 kodu" value={profile.hesaplananKdv?.yuzde20 || ''} onChange={(v) => onUpdateKdv('hesaplananKdv', 'yuzde20', v)} placeholder="391.01.020" />
      </Section>

      {/* İNDİRİLECEK KDV */}
      <Section title="İndirilecek KDV Hesapları (191.x)">
        <Input label="%1 kodu"  value={profile.indirilecekKdv?.yuzde1  || ''} onChange={(v) => onUpdateKdv('indirilecekKdv', 'yuzde1', v)}  placeholder="191.01.001" />
        <Input label="%10 kodu" value={profile.indirilecekKdv?.yuzde10 || ''} onChange={(v) => onUpdateKdv('indirilecekKdv', 'yuzde10', v)} placeholder="191.01.010" />
        <Input label="%20 kodu" value={profile.indirilecekKdv?.yuzde20 || ''} onChange={(v) => onUpdateKdv('indirilecekKdv', 'yuzde20', v)} placeholder="191.01.020" />
      </Section>

      {/* CARİ & ÖDEME */}
      <Section title="Cari & Ödeme">
        <Input label="Cari Hesap Formatı" value={profile.cariFormat || ''} onChange={(v) => onUpdate('cariFormat', v)} placeholder="120.01.{kod}" />
        <Input label="Tahsilat Hesabı"   value={profile.tahsilatHesabi || ''} onChange={(v) => onUpdate('tahsilatHesabi', v)} placeholder="100.01.001" />
        <Select label="Tahsilat Türü" value={profile.tahsilatHesapTuru || ''} onChange={(v) => onUpdate('tahsilatHesapTuru', v as HesapTuru)} options={HESAP_OPTIONS} />
        <Input label="Ödeme Hesabı"      value={profile.odemeHesabi || ''}    onChange={(v) => onUpdate('odemeHesabi', v)}    placeholder="102.01.001" />
        <Select label="Ödeme Türü"   value={profile.odemeHesapTuru || ''} onChange={(v) => onUpdate('odemeHesapTuru', v as HesapTuru)} options={HESAP_OPTIONS} />
      </Section>

      {/* TEVKİFAT */}
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
          (Sistem kuralı: nakliye/servis/demir içerikli + KDV dahil 12.000+ TL faturalar zaten otomatik tevkifat denetlenir.)
        </p>
      </Section>

      {/* ÖZEL TALİMAT */}
      <Section title="Özel Talimatlar (serbest metin)">
        <textarea
          value={profile.talimat || ''}
          onChange={(e) => onUpdate('talimat', e.target.value)}
          rows={8}
          placeholder={`Örnek:\n- Bu mükellefin akaryakıt faturaları 740.01.001'e yazılır.\n- Lastik 740.01.005'e.\n- Önemli not: faturanın gerçek içeriğine bak, sadece sektöre göre tahmin yapma.`}
          className="w-full px-3 py-2 rounded-lg text-sm border outline-none font-mono"
          style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)', color: '#cbd5e1', minHeight: 160 }}
        />
      </Section>

      {/* SAVE */}
      <div className="flex items-center justify-between mt-5 pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <p className="text-xs" style={{ color: '#6b6b6b' }}>
          Profil ve sistem kuralları her fatura kararında Claude'un prompt'una eklenir.
        </p>
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
          style={{ background: '#6a9a6c', color: 'white' }}
        >
          <Save size={14} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </div>
    </>
  );
}

const HESAP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '',       label: '— seçiniz —' },
  { value: 'kasa',   label: 'Kasa (100.x)' },
  { value: 'banka',  label: 'Banka (102.x)' },
  { value: 'pos',    label: 'POS' },
  { value: 'cek',    label: 'Çek' },
  { value: 'diger',  label: 'Diğer' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: '#b8a06f' }}>{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">{children}</div>
    </div>
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
