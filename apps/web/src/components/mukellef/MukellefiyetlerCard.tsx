'use client';
import { portalStyle } from '@/lib/portal-theme';


import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { DurumCipi, FormAltBilgi, Salter, Secici } from '@/components/kayit-formu/KayitFormu';

// v3 (2026-09-14, Muzaffer Bey: "beyanname | dönem — bu kadar; tablo düzeni belli olsun, profesyonel"):
// İKİ sütunlu, TAM ÇİZGİLİ tablo. Açıklama/kod/durum sütunu YOK, GRUP SATIRI YOK — başlığın altında düz liste. Altın yok.
const GOOD = '#5fcf8e';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.60)';
const CIZGI = 'rgba(255,255,255,0.13)';
const HUCRE: React.CSSProperties = { border: `1px solid ${CIZGI}`, padding: '0 14px', height: 48, verticalAlign: 'middle', fontSize: 14 };
const BASLIK_HUCRE: React.CSSProperties = { ...HUCRE, height: 40, fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(250,250,249,0.62)', background: 'rgba(255,255,255,0.055)', textAlign: 'left' };

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

  // ÖNEMLI: config'i TEK mükellef ucundan (filtresiz) oku. Eski liste ucu
  // "işi bırakmış" (endDate geçmiş) mükellefi gizliyordu → kapanan firmada
  // ayarlar kaydedildiği halde geri gelmiyor, "silinmiş" görünüyordu.
  const { data: cfgResp, isLoading } = useQuery<any>({
    queryKey: ['beyan-config', taxpayerId],
    queryFn: () => api.get(`/beyanname-takip/configs/${taxpayerId}`).then((r) => r.data).catch(() => null),
    enabled: !!taxpayerId,
  });

  const existingConfig = cfgResp?.config;
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
      qc.invalidateQueries({ queryKey: ['beyan-config', taxpayerId] });
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

  const gruplar: Array<{ baslik: string; defs: BeyannameDef[] }> = [
    { baslik: 'KDV', defs: KDV_GRUBU },
    { baslik: 'Geçici vergi', defs: GECICI_GRUBU },
    { baslik: 'Muhtasar', defs: MUHTASAR_GRUBU },
    { baslik: 'Diğer beyan ve bildirimler', defs: DIGER_GRUBU },
  ];
  const aktifMi = (d: BeyannameDef) => (d.tip === 'toggle' ? !!(form as any)[d.key] : (form as any)[d.key] !== null);
  // Ekranda ad: kod parantezi zaten adın içinde; KDV1 için okunur biçim.
  const gosterAd = (d: BeyannameDef) => (d.kod === 'KDV1' ? 'KDV (KDV1)' : d.ad);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto" style={portalStyle({ border: `1px solid ${CIZGI}`, borderRadius: 8 })}>
        <table className="w-full border-collapse" style={portalStyle({ minWidth: 640 })}>
          <colgroup>
            <col />
            <col style={portalStyle({ width: 360 })} />
          </colgroup>
          <thead>
            <tr>
              <th style={portalStyle(BASLIK_HUCRE)}>Beyanname</th>
              <th style={portalStyle(BASLIK_HUCRE)}>Dönem</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={portalStyle({ ...HUCRE, color: form.incomeTaxType ? TEXT : MUTED, fontWeight: form.incomeTaxType ? 600 : 500 })}>Yıllık vergi türü</td>
              <td style={portalStyle(HUCRE)}>
                <Secici
                  boy="kucuk"
                  value={form.incomeTaxType ?? 'YOK'}
                  onChange={(v) => setForm((prev) => ({ ...prev, incomeTaxType: v === 'YOK' ? null : (v as IncomeTaxType) }))}
                  options={[
                    { value: 'YOK', label: 'Yok', pasif: true },
                    { value: 'KURUMLAR', label: 'Kurumlar' },
                    { value: 'GELIR', label: 'Gelir' },
                    { value: 'BASIT_USUL', label: 'Basit usul' },
                  ]}
                />
              </td>
            </tr>

            {gruplar.map((g) => (
              <React.Fragment key={g.baslik}>
                {g.defs.map((item) => {
                  const value = (form as any)[item.key];
                  const isActive = aktifMi(item);
                  return (
                    <tr key={item.key as string}>
                      <td style={portalStyle({ ...HUCRE, color: isActive ? TEXT : MUTED, fontWeight: isActive ? 600 : 500 })}>{gosterAd(item)}</td>
                      <td style={portalStyle(HUCRE)}>
                        {item.tip === 'toggle' ? (
                          <label className="flex cursor-pointer items-center gap-2.5">
                            <input type="checkbox" className="sr-only" checked={isActive} onChange={() => setForm({ ...form, [item.key]: !value } as BeyanConfig)} />
                            <Salter checked={isActive} />
                            <span className="text-[13.5px] font-medium" style={portalStyle({ color: isActive ? GOOD : MUTED })}>{isActive ? 'Açık' : 'Kapalı'}</span>
                          </label>
                        ) : (
                          <PeriodSegment value={value} full15={item.tip === 'period_15gun'} onChange={(v) => setForm({ ...form, [item.key]: v } as BeyanConfig)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <FormAltBilgi
        onSave={() => saveMut.mutate()}
        saving={saveMut.isPending}
        vurgulu
        dugmeYazi="Mükellefiyetleri Kaydet"
        not={
          <>
            <DurumCipi ton={aktifSayisi ? 'yesil' : 'notr'}>{aktifSayisi} aktif mükellefiyet</DurumCipi>
            <span className="ml-2">Bu bölümün kendi kaydı vardır; üstteki Kaydet'ten bağımsızdır.</span>
          </>
        }
      />
    </div>
  );
}

// Dönem seçici — nötr, küçük (Yok / Aylık / 3 Aylık / 15 Gün).
function PeriodSegment({ value, full15, onChange }: { value: Period; full15?: boolean; onChange: (v: Period) => void }) {
  const opts: Array<{ v: Period; l: string }> = [
    { v: null, l: 'Yok' },
    { v: 'AYLIK', l: 'Aylık' },
    { v: 'UCAYLIK', l: '3 Aylık' },
    ...(full15 ? [{ v: 'ON_BES_GUNLUK' as Period, l: '15 Gün' }] : []),
  ];
  return (
    <Secici
      boy="kucuk"
      value={value ?? 'YOK'}
      onChange={(v) => onChange(v === 'YOK' ? null : (v as Period))}
      options={opts.map((o) => ({ value: o.v ?? 'YOK', label: o.l, pasif: o.v === null }))}
    />
  );
}
