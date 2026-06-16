'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { FileCheck, Save, Loader2 } from 'lucide-react';

// Kurumsal palet: aktif = yeşil, dönem seçimi = altın, kapalı = nötr.
const GOLD = '#d4b876';
const GOLD_DEEP = '#8b7649';
const GOOD = '#5fcf8e';
const GOOD_BR = '#89e7b1';
const GOOD_SF = 'rgba(95,207,142,0.10)';
const GOOD_LN = 'rgba(95,207,142,0.30)';
const CARD2 = '#0e0f13';
const FIELD = '#0c0d11';
const TEXT = '#f5f5f4';
const MUTED = 'rgba(245,245,244,0.60)';
const LINE = 'rgba(255,255,255,0.08)';

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
  // Eski yapıdan gelen, ekranda gösterilmeyen alanlar
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
];

const GECICI_GRUBU: BeyannameDef[] = [
  { key: 'gelirGeciciPeriod', kod: 'GGECICI', ad: 'Gelir Geçici Vergi (GGEÇİCİ)', desc: '3 aylık — şahıs işletmeleri için',   tip: 'period' },
  { key: 'kurumGeciciPeriod', kod: 'KGECICI', ad: 'Kurum Geçici Vergi (KGEÇİCİ)', desc: '3 aylık — kurumlar vergisi için',     tip: 'period' },
];

const MUHTASAR_GRUBU: BeyannameDef[] = [
  { key: 'muhtasarPeriod',  kod: 'MUHSGK',  ad: 'Muhtasar (MUHSGK)',           desc: 'Aylık veya 3 aylık (mükellef tipine göre)', tip: 'period' },
];

const DIGER_GRUBU: BeyannameDef[] = [
  { key: 'damgaEnabled',      kod: 'DAMGA',     ad: 'Damga Vergisi',          desc: 'Sürekli damga vergisi mükellefiyse',  tip: 'toggle' },
  { key: 'sgkBildirgeEnabled',kod: 'BILDIRGE',  ad: 'SGK Aylık Prim Bildirge',desc: 'Çalışanı olan mükellefler için',      tip: 'toggle' },
  { key: 'posetEnabled',      kod: 'POSET',     ad: 'Poşet Beyannamesi',      desc: '3 aylık — plastik poşet kullananlar', tip: 'toggle' },
  { key: 'konaklamaEnabled',  kod: 'KONAKLAMA', ad: 'Konaklama Vergisi',      desc: 'Otel, pansiyon vb. (aylık)',          tip: 'toggle' },
  { key: 'turizmPeriod',      kod: 'TURIZM',    ad: 'Turizm Payı',            desc: 'Aylık veya 3 aylık',                  tip: 'period' },
  { key: 'eDefterPeriod',     kod: 'EDEFTER',   ad: 'E-Defter / E-Berat',     desc: 'Bilanço usulü için zorunlu',          tip: 'period' },
];

const YILLIK_GRUBU: Array<{ value: Exclude<IncomeTaxType, null>; kod: string; ad: string; desc: string }> = [
  { value: 'KURUMLAR', kod: 'KURUMLAR', ad: 'Kurumlar Vergisi', desc: 'Yıllık kurumlar vergisi beyannamesi' },
  { value: 'GELIR', kod: 'GELIR', ad: 'Gelir Vergisi', desc: 'Yıllık gelir vergisi beyannamesi' },
  { value: 'BASIT_USUL', kod: 'BASIT', ad: 'Basit Usul', desc: 'Basit usul yıllık beyan' },
];

/**
 * v1.37.1: Mükellefiyetler kartı — Hattat tarzı tüm beyanname türleri.
 * Backend: PUT /beyanname-takip/configs/:taxpayerId
 */
export function MukellefiyetlerCard({
  taxpayerId,
  sgkCredentialReady = false,
}: {
  taxpayerId: string;
  sgkCredentialReady?: boolean;
}) {
  const qc = useQueryClient();

  const { data: configData = [], isLoading } = useQuery<any[]>({
    queryKey: ['beyan-config-list'],
    queryFn: () => api.get('/beyanname-takip/configs').then((r) => Array.isArray(r.data) ? r.data : (r.data?.items || [])).catch(() => []),
  });

  const existingConfig = configData.find((i: any) => i.taxpayerId === taxpayerId)?.config;
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
        sgkBildirgeEnabled: !!existingConfig.sgkBildirgeEnabled || sgkCredentialReady,
        konaklamaEnabled: !!existingConfig.konaklamaEnabled,
        oivEnabled: !!existingConfig.oivEnabled,
        gmsiEnabled: !!existingConfig.gmsiEnabled,
        turizmPeriod: existingConfig.turizmPeriod || null,
        eDefterPeriod: existingConfig.eDefterPeriod || null,
      });
    }
  }, [existingConfig, sgkCredentialReady]);

  useEffect(() => {
    if (!sgkCredentialReady) return;
    setForm((prev) => (
      prev.sgkBildirgeEnabled ? prev : { ...prev, sgkBildirgeEnabled: true }
    ));
  }, [sgkCredentialReady]);

  const saveMut = useMutation({
    mutationFn: () => api.put(`/beyanname-takip/configs/${taxpayerId}`, form),
    onSuccess: () => {
      toast.success('Mükellefiyetler kaydedildi');
      qc.invalidateQueries({ queryKey: ['beyan-config-list'] });
      qc.invalidateQueries({ queryKey: ['beyanname-takip'] });
      qc.invalidateQueries({ queryKey: ['beyanname-takip-configs'] });
      qc.invalidateQueries({ queryKey: ['taxpayer-completeness', taxpayerId] });
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || 'Kayıt başarısız');
    },
  });

  const visibleDefs = [...KDV_GRUBU, ...GECICI_GRUBU, ...MUHTASAR_GRUBU, ...DIGER_GRUBU];
  const aktifSayisi = visibleDefs.reduce((n, item) => {
    const value = (form as any)[item.key];
    return n + (item.tip === 'toggle' ? Number(!!value) : Number(value !== null));
  }, form.incomeTaxType ? 1 : 0);

  if (isLoading) return null;

  return (
    <div className="space-y-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border" style={{ borderColor: GOOD_LN, background: GOOD_SF, color: GOOD_BR }}>
            <FileCheck size={18} />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: TEXT }}>Mükellefiyetler & Dönemler</h2>
            <p className="mt-0.5 text-[11.5px]" style={{ color: MUTED }}>Hangi beyannameler, hangi dönemde?</p>
          </div>
        </div>
        <span className="rounded-md border px-2 py-1 text-[11px] font-bold tabular-nums" style={{ background: GOOD_SF, color: GOOD_BR, borderColor: GOOD_LN }}>
          {aktifSayisi} aktif
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {YILLIK_GRUBU.map((item) => (
          <YillikBeyanRow key={item.value} item={item} form={form} setForm={setForm} />
        ))}
        {visibleDefs.map((item) => (
          <BeyanRow key={item.key as string} item={item} form={form} setForm={setForm} />
        ))}
      </div>

      {/* Kaydet */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-bold disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: '#0f0d0b' }}
        >
          {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Mükellefiyetleri Kaydet
        </button>
      </div>
    </div>
  );
}

function YillikBeyanRow({
  item,
  form,
  setForm,
}: {
  item: { value: Exclude<IncomeTaxType, null>; kod: string; ad: string; desc: string };
  form: BeyanConfig;
  setForm: React.Dispatch<React.SetStateAction<BeyanConfig>>;
}) {
  const isActive = form.incomeTaxType === item.value;

  return (
    <div
      className="rounded-[8px] border p-3 transition"
      style={{
        background: isActive ? 'rgba(95,207,142,0.085)' : '#111217',
        borderColor: isActive ? GOOD_LN : 'rgba(255,255,255,0.095)',
        boxShadow: isActive ? 'inset 0 1px 0 rgba(255,255,255,0.04)' : 'none',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums" style={{ background: isActive ? GOOD : 'rgba(255,255,255,0.08)', color: isActive ? '#08100c' : MUTED }}>
              {item.kod}
            </span>
            <div className="text-[12.5px] font-semibold" style={{ color: TEXT }}>{item.ad}</div>
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: MUTED }}>{item.desc}</div>
        </div>
        <button
          type="button"
          onClick={() => setForm((prev) => ({ ...prev, incomeTaxType: isActive ? null : item.value }))}
          className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition hover:brightness-110"
          style={isActive
            ? { borderColor: GOOD_LN, background: GOOD_SF, color: GOOD_BR }
            : { borderColor: LINE, background: 'rgba(255,255,255,0.035)', color: MUTED }}
        >
          {isActive ? 'Aktif' : 'Kapalı'}
        </button>
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
      className="rounded-[8px] border p-3 transition"
      style={{
        background: isActive ? 'rgba(95,207,142,0.085)' : '#111217',
        borderColor: isActive ? GOOD_LN : 'rgba(255,255,255,0.095)',
        boxShadow: isActive ? 'inset 0 1px 0 rgba(255,255,255,0.04)' : 'none',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums" style={{ background: isActive ? GOOD : 'rgba(255,255,255,0.08)', color: isActive ? '#08100c' : MUTED }}>
              {item.kod}
            </span>
            <div className="text-[12.5px] font-semibold" style={{ color: TEXT }}>{item.ad}</div>
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: MUTED }}>{item.desc}</div>
        </div>
        <div className="shrink-0">
          {item.tip === 'toggle' ? (
            <button
              type="button"
              onClick={() => setForm({ ...form, [item.key]: !value } as BeyanConfig)}
              className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition hover:brightness-110"
              style={isActive
                ? { borderColor: GOOD_LN, background: GOOD_SF, color: GOOD_BR }
                : { borderColor: LINE, background: 'rgba(255,255,255,0.035)', color: MUTED }}
            >
              {isActive ? 'Aktif' : 'Kapalı'}
            </button>
          ) : null}
        </div>
      </div>

      {(item.tip === 'period' || item.tip === 'period_full' || item.tip === 'period_15gun') && (
        <div className="mt-2.5">
          <PeriodSegment
            value={value}
            full15={item.tip === 'period_15gun'}
            onChange={(v) => setForm({ ...form, [item.key]: v } as BeyanConfig)}
          />
        </div>
      )}
    </div>
  );
}

// Tek parça segment kontrolü — eski 3 ayrı buton dağınık görünüyordu.
function PeriodSegment({ value, full15, onChange }: { value: Period; full15?: boolean; onChange: (v: Period) => void }) {
  const opts: Array<{ v: Period; l: string }> = [
    { v: null, l: 'Yok' },
    { v: 'AYLIK', l: 'Aylık' },
    { v: 'UCAYLIK', l: '3 Aylık' },
    ...(full15 ? [{ v: 'ON_BES_GUNLUK' as Period, l: '15 Gün' }] : []),
  ];
  return (
    <div className="inline-flex rounded-[9px] border p-0.5" style={{ borderColor: LINE, background: FIELD }}>
      {opts.map((o) => {
        const sel = value === o.v;
        const off = o.v === null;
        return (
          <button
            key={String(o.v)}
            type="button"
            onClick={() => onChange(o.v)}
            className="rounded-[7px] px-3 py-1.5 text-[11.5px] font-medium transition"
            style={sel
              ? (off ? { background: 'rgba(255,255,255,0.08)', color: MUTED } : { background: 'rgba(212,184,118,0.18)', color: GOLD })
              : { background: 'transparent', color: 'rgba(245,245,244,0.42)' }}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}
