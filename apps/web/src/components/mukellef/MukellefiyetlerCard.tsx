'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { FileCheck, Save, Loader2 } from 'lucide-react';

const GOLD = '#d4b876';
const GOLD_DEEP = '#8b7649';
const PANEL = '#2a241c';
const PANEL_LIGHT = '#352e23';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.65)';
const LINE = 'rgba(255,255,255,0.10)';
const LINE_GOLD = 'rgba(212,184,118,0.30)';

type Period = 'AYLIK' | 'UCAYLIK' | 'ON_BES_GUNLUK' | null;
type IncomeTaxType = 'KURUMLAR' | 'GELIR' | 'BASIT_USUL' | null;

interface BeyanConfig {
  incomeTaxType: IncomeTaxType;
  // KDV ailesi
  kdv1Period: Period;
  kdv2Enabled: boolean;
  kdv4Period: Period;
  kdv9015Period: Period;
  // Geçici Vergi
  gelirGeciciPeriod: Period;
  kurumGeciciPeriod: Period;
  // Muhtasar
  muhtasarPeriod: Period;
  muhtasar2Period: Period;
  // ÖTV
  otv1Period: Period;
  otv3aPeriod: Period;
  otv3bPeriod: Period;
  otv4Period: Period;
  // Sürekli/yıllık
  damgaEnabled: boolean;
  posetEnabled: boolean;
  sgkBildirgeEnabled: boolean;
  konaklamaEnabled: boolean;
  oivEnabled: boolean;
  gmsiEnabled: boolean;
  turizmPeriod: Period;
  // E-Defter
  eDefterPeriod: Period;
}

const DEFAULT: BeyanConfig = {
  incomeTaxType: null,
  kdv1Period: null,
  kdv2Enabled: false,
  kdv4Period: null,
  kdv9015Period: null,
  gelirGeciciPeriod: null,
  kurumGeciciPeriod: null,
  muhtasarPeriod: null,
  muhtasar2Period: null,
  otv1Period: null,
  otv3aPeriod: null,
  otv3bPeriod: null,
  otv4Period: null,
  damgaEnabled: false,
  posetEnabled: false,
  sgkBildirgeEnabled: false,
  konaklamaEnabled: false,
  oivEnabled: false,
  gmsiEnabled: false,
  turizmPeriod: null,
  eDefterPeriod: null,
};

type BeyannameDef = {
  key: keyof BeyanConfig;
  kod: string;
  ad: string;
  desc: string;
  tip: 'period' | 'period_full' | 'period_15gun' | 'toggle';
};

const KDV_GRUBU: BeyannameDef[] = [
  { key: 'kdv1Period',    kod: 'KDV1',    ad: 'KDV1',                          desc: 'Katma Değer Vergisi (genel)',           tip: 'period' },
  { key: 'kdv2Enabled',   kod: 'KDV2',    ad: 'KDV2 — Tevkifat',               desc: 'Sorumlu sıfatıyla — aylık zorunlu',     tip: 'toggle' },
  { key: 'kdv4Period',    kod: 'KDV4',    ad: 'KDV4',                          desc: 'E-ticaret / hizmet ihracatı',           tip: 'period' },
  { key: 'kdv9015Period', kod: 'KDV9015', ad: 'KDV9015 — Tevkifat Beyanı',     desc: 'Kıymetli maden, kira tevkifatı',        tip: 'period' },
];

const GECICI_GRUBU: BeyannameDef[] = [
  { key: 'gelirGeciciPeriod', kod: 'GGECICI', ad: 'Gelir Geçici Vergi (GGEÇİCİ)', desc: '3 aylık — şahıs işletmeleri için',   tip: 'period' },
  { key: 'kurumGeciciPeriod', kod: 'KGECICI', ad: 'Kurum Geçici Vergi (KGEÇİCİ)', desc: '3 aylık — kurumlar vergisi için',     tip: 'period' },
];

const MUHTASAR_GRUBU: BeyannameDef[] = [
  { key: 'muhtasarPeriod',  kod: 'MUHSGK',  ad: 'Muhtasar (MUHSGK)',           desc: 'Aylık veya 3 aylık (mükellef tipine göre)', tip: 'period' },
  { key: 'muhtasar2Period', kod: 'MUHSGK2', ad: 'Muhtasar (MUHSGK2)',          desc: '3 aylık muhtasar varyantı',                  tip: 'period' },
];

const OTV_GRUBU: BeyannameDef[] = [
  { key: 'otv1Period',  kod: 'ÖTV1',  ad: 'ÖTV1',  desc: 'Akaryakıt, doğalgaz vb. (aylık)',                tip: 'period' },
  { key: 'otv3aPeriod', kod: 'ÖTV3A', ad: 'ÖTV3A', desc: 'Motorlu taşıt (aylık)',                          tip: 'period' },
  { key: 'otv3bPeriod', kod: 'ÖTV3B', ad: 'ÖTV3B', desc: 'Özel akaryakıt — aylık veya 15 günlük',         tip: 'period_15gun' },
  { key: 'otv4Period',  kod: 'ÖTV4',  ad: 'ÖTV4',  desc: 'Alkollü içecek, tütün (aylık)',                  tip: 'period' },
];

const DIGER_GRUBU: BeyannameDef[] = [
  { key: 'damgaEnabled',      kod: 'DAMGA',     ad: 'Damga Vergisi',          desc: 'Sürekli damga vergisi mükellefiyse',  tip: 'toggle' },
  { key: 'sgkBildirgeEnabled',kod: 'BILDIRGE',  ad: 'SGK Aylık Prim Bildirge',desc: 'Çalışanı olan mükellefler için',      tip: 'toggle' },
  { key: 'posetEnabled',      kod: 'POSET',     ad: 'Poşet Beyannamesi',      desc: '3 aylık — plastik poşet kullananlar', tip: 'toggle' },
  { key: 'konaklamaEnabled',  kod: 'KONAKLAMA', ad: 'Konaklama Vergisi',      desc: 'Otel, pansiyon vb. (aylık)',          tip: 'toggle' },
  { key: 'oivEnabled',        kod: 'ÖİV',       ad: 'ÖİV (Özel İletişim V.)', desc: 'GSM / iletişim hizmetleri',           tip: 'toggle' },
  { key: 'gmsiEnabled',       kod: 'GMSI',      ad: 'GMSİ',                   desc: 'Gayrimenkul sermaye iradı (yıllık)',  tip: 'toggle' },
  { key: 'turizmPeriod',      kod: 'TURIZM',    ad: 'Turizm Payı',            desc: 'Aylık veya 3 aylık',                  tip: 'period' },
  { key: 'eDefterPeriod',     kod: 'EDEFTER',   ad: 'E-Defter / E-Berat',     desc: 'Bilanço usulü için zorunlu',          tip: 'period' },
];

/**
 * v1.37.1: Mükellefiyetler kartı — Hattat tarzı tüm beyanname türleri.
 * Backend: PUT /beyanname-takip/configs/:taxpayerId
 */
export function MukellefiyetlerCard({ taxpayerId }: { taxpayerId: string }) {
  const qc = useQueryClient();

  const { data: configData, isLoading } = useQuery<{ items: any[] }>({
    queryKey: ['beyan-config-list'],
    queryFn: () => api.get('/beyanname-takip/configs').then((r) => r.data).catch(() => ({ items: [] })),
  });

  const existingConfig = configData?.items?.find((i: any) => i.taxpayerId === taxpayerId)?.config;
  const [form, setForm] = useState<BeyanConfig>(DEFAULT);

  useEffect(() => {
    if (existingConfig) {
      setForm({
        incomeTaxType: existingConfig.incomeTaxType || null,
        kdv1Period: existingConfig.kdv1Period || null,
        kdv2Enabled: !!existingConfig.kdv2Enabled,
        kdv4Period: existingConfig.kdv4Period || null,
        kdv9015Period: existingConfig.kdv9015Period || null,
        gelirGeciciPeriod: existingConfig.gelirGeciciPeriod || null,
        kurumGeciciPeriod: existingConfig.kurumGeciciPeriod || null,
        muhtasarPeriod: existingConfig.muhtasarPeriod || null,
        muhtasar2Period: existingConfig.muhtasar2Period || null,
        otv1Period: existingConfig.otv1Period || null,
        otv3aPeriod: existingConfig.otv3aPeriod || null,
        otv3bPeriod: existingConfig.otv3bPeriod || null,
        otv4Period: existingConfig.otv4Period || null,
        damgaEnabled: !!existingConfig.damgaEnabled,
        posetEnabled: !!existingConfig.posetEnabled,
        sgkBildirgeEnabled: !!existingConfig.sgkBildirgeEnabled,
        konaklamaEnabled: !!existingConfig.konaklamaEnabled,
        oivEnabled: !!existingConfig.oivEnabled,
        gmsiEnabled: !!existingConfig.gmsiEnabled,
        turizmPeriod: existingConfig.turizmPeriod || null,
        eDefterPeriod: existingConfig.eDefterPeriod || null,
      });
    }
  }, [existingConfig]);

  const saveMut = useMutation({
    mutationFn: () => api.put(`/beyanname-takip/configs/${taxpayerId}`, form),
    onSuccess: () => {
      toast.success('Mükellefiyetler kaydedildi');
      qc.invalidateQueries({ queryKey: ['beyan-config-list'] });
      qc.invalidateQueries({ queryKey: ['taxpayer-completeness', taxpayerId] });
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || 'Kayıt başarısız');
    },
  });

  // Aktif beyanname sayısı (özet için)
  const aktifSayisi = (() => {
    let n = 0;
    if (form.kdv1Period) n++;
    if (form.kdv2Enabled) n++;
    if (form.kdv4Period) n++;
    if (form.kdv9015Period) n++;
    if (form.gelirGeciciPeriod) n++;
    if (form.kurumGeciciPeriod) n++;
    if (form.muhtasarPeriod) n++;
    if (form.muhtasar2Period) n++;
    if (form.otv1Period) n++;
    if (form.otv3aPeriod) n++;
    if (form.otv3bPeriod) n++;
    if (form.otv4Period) n++;
    if (form.damgaEnabled) n++;
    if (form.posetEnabled) n++;
    if (form.sgkBildirgeEnabled) n++;
    if (form.konaklamaEnabled) n++;
    if (form.oivEnabled) n++;
    if (form.gmsiEnabled) n++;
    if (form.turizmPeriod) n++;
    if (form.eDefterPeriod) n++;
    if (form.incomeTaxType) n++;
    return n;
  })();

  if (isLoading) return null;

  return (
    <div className="rounded-xl border p-5" style={{ background: PANEL, borderColor: LINE_GOLD }}>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border" style={{ borderColor: LINE_GOLD, background: 'rgba(212,184,118,0.14)', color: GOLD }}>
            <FileCheck size={18} />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: GOLD }}>Mükellefiyetler & Dönemler</h2>
            <p className="mt-0.5 text-[11.5px]" style={{ color: MUTED }}>Hangi beyannameler, hangi dönemde?</p>
          </div>
        </div>
        <span className="rounded-md border px-2 py-1 text-[11px] font-bold tabular-nums" style={{ background: 'rgba(212,184,118,0.10)', color: GOLD, borderColor: LINE_GOLD }}>
          {aktifSayisi} aktif
        </span>
      </div>

      {/* Yıllık Beyanname Tipi */}
      <div className="mb-5 rounded-lg border p-3" style={{ background: PANEL_LIGHT, borderColor: LINE }}>
        <div className="text-[11.5px] font-semibold uppercase tracking-wider" style={{ color: GOLD }}>Yıllık Beyanname Tipi</div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <PeriodChip selected={form.incomeTaxType === null} label="Yok" onClick={() => setForm({ ...form, incomeTaxType: null })} />
          <PeriodChip selected={form.incomeTaxType === 'KURUMLAR'} label="Kurumlar V." onClick={() => setForm({ ...form, incomeTaxType: 'KURUMLAR' })} />
          <PeriodChip selected={form.incomeTaxType === 'GELIR'} label="Gelir V." onClick={() => setForm({ ...form, incomeTaxType: 'GELIR' })} />
          <PeriodChip selected={form.incomeTaxType === 'BASIT_USUL'} label="Basit Usul" onClick={() => setForm({ ...form, incomeTaxType: 'BASIT_USUL' })} />
        </div>
      </div>

      {/* KDV Grubu */}
      <BeyanGroup title="KDV Beyannameleri" items={KDV_GRUBU} form={form} setForm={setForm} />

      {/* Geçici Vergi */}
      <BeyanGroup title="Geçici Vergi" items={GECICI_GRUBU} form={form} setForm={setForm} />

      {/* Muhtasar */}
      <BeyanGroup title="Muhtasar" items={MUHTASAR_GRUBU} form={form} setForm={setForm} />

      {/* ÖTV */}
      <BeyanGroup title="Özel Tüketim Vergisi (ÖTV)" items={OTV_GRUBU} form={form} setForm={setForm} />

      {/* Diğer */}
      <BeyanGroup title="Diğer Beyannameler" items={DIGER_GRUBU} form={form} setForm={setForm} />

      {/* Kaydet */}
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-bold disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
        >
          {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Mükellefiyetleri Kaydet
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Beyanname grubu — kategori başlığı + alt liste
// ============================================================
function BeyanGroup({
  title,
  items,
  form,
  setForm,
}: {
  title: string;
  items: BeyannameDef[];
  form: BeyanConfig;
  setForm: React.Dispatch<React.SetStateAction<BeyanConfig>>;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.10em]" style={{ color: GOLD }}>
        {title}
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <BeyanRow key={item.key as string} item={item} form={form} setForm={setForm} />
        ))}
      </div>
    </div>
  );
}

function BeyanRow({
  item,
  form,
  setForm,
}: {
  item: BeyannameDef;
  form: BeyanConfig;
  setForm: React.Dispatch<React.SetStateAction<BeyanConfig>>;
}) {
  const value = (form as any)[item.key];
  const isActive = item.tip === 'toggle' ? !!value : value !== null;

  return (
    <div
      className="rounded-lg border p-3 transition"
      style={{
        background: isActive ? 'rgba(212,184,118,0.08)' : PANEL_LIGHT,
        borderColor: isActive ? LINE_GOLD : LINE,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums" style={{ background: isActive ? GOLD : 'rgba(255,255,255,0.08)', color: isActive ? '#0f0d0b' : MUTED }}>
              {item.kod}
            </span>
            <div className="text-[12.5px] font-semibold" style={{ color: TEXT }}>{item.ad}</div>
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: MUTED }}>{item.desc}</div>
        </div>
        <div className="shrink-0">
          {item.tip === 'toggle' ? (
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => setForm({ ...form, [item.key]: e.target.checked } as BeyanConfig)}
              className="h-5 w-5 cursor-pointer"
              style={{ accentColor: GOLD }}
            />
          ) : null}
        </div>
      </div>

      {(item.tip === 'period' || item.tip === 'period_full' || item.tip === 'period_15gun') && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <PeriodChip selected={value === null} label="Yok" onClick={() => setForm({ ...form, [item.key]: null } as BeyanConfig)} />
          <PeriodChip selected={value === 'AYLIK'} label="Aylık" onClick={() => setForm({ ...form, [item.key]: 'AYLIK' } as BeyanConfig)} />
          <PeriodChip selected={value === 'UCAYLIK'} label="3 Aylık" onClick={() => setForm({ ...form, [item.key]: 'UCAYLIK' } as BeyanConfig)} />
          {item.tip === 'period_15gun' && (
            <PeriodChip selected={value === 'ON_BES_GUNLUK'} label="15 Günlük" onClick={() => setForm({ ...form, [item.key]: 'ON_BES_GUNLUK' } as BeyanConfig)} />
          )}
        </div>
      )}
    </div>
  );
}

function PeriodChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition"
      style={{
        background: selected ? GOLD : 'rgba(255,255,255,0.04)',
        color: selected ? '#0f0d0b' : MUTED,
        border: `1px solid ${selected ? GOLD : LINE}`,
      }}
    >
      {label}
    </button>
  );
}
