'use client';
import { portalStyle } from '@/lib/portal-theme';


import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { AlanGirdi, AlanSecim, Anahtar, DurumCipi, FormAltBilgi, FormGrup, Satir } from '@/components/kayit-formu/KayitFormu';

// v4 (2026-09-25, Muzaffer Bey: "mükellefiyet bilgilerinin kaydedildiği ekran leş gibi; sade, anlaşılır olsun"):
// Tablo KALKTI. İki sütunlu tabloda beyanname adı solda, seçici ~1200px ötede sağ kenarda duruyordu; arası bomboştu.
// Artık ekranın KENDİ form dili: etiket alanın üstünde, üç sütun — Müşteri/İletişim/Defter bölümleriyle aynı.
// Alanlar üçün katına tamamlandı ki hiçbiri tek başına satırda kalmasın (yıllık tür segment yerine seçim kutusu,
// e-Defter başlangıcı ayrı alan). Denenip bırakılanlar: kart ızgarası, gruplu ayar listesi, renkli kart başlıkları.
const GOOD = '#5fcf8e';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.60)';

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
  /** e-Defter mükellefiyetinin başladığı ay "YYYY-MM" (Hattat "Başlangıç"); öncesindeki dönemler takibe düşmez */
  eDefterBaslangic: string | null;
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
  eDefterBaslangic: null,
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
        eDefterBaslangic: /^\d{4}-\d{2}$/.test(String(existingConfig.eDefterBaslangic || '')) ? existingConfig.eDefterBaslangic : null,
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

  // Üç sütunda dört tam satır: hiçbir alan tek başına kalmasın diye sıra elle kuruldu.
  const SIRA: Array<BeyannameDef['key']> = [
    'kdv1Period', 'muhtasarPeriod',
    'gelirGeciciPeriod', 'kurumGeciciPeriod', 'turizmPeriod',
    'damgaEnabled', 'konaklamaEnabled', 'posetEnabled',
    'sgkBildirgeEnabled', 'eDefterPeriod',
  ];
  const KOD: Partial<Record<string, string>> = {
    kdv1Period: 'KDV1', gelirGeciciPeriod: 'GGEÇİCİ', kurumGeciciPeriod: 'KGEÇİCİ', muhtasarPeriod: 'MUHSGK',
  };
  const etiket = (d: BeyannameDef) => {
    const ad = d.ad.replace(/\s*\([^)]*\)\s*$/, '');
    const kod = KOD[d.key as string];
    return kod ? (
      <>
        {ad}
        <span className="text-[9.5px] font-extrabold tracking-[.04em]" style={portalStyle({ color: MUTED })}>{kod}</span>
      </>
    ) : ad;
  };

  return (
    <div className="space-y-4">
      <FormGrup baslik="Beyanname ve dönemler" aciklama="vergi türleri, dönemler ve aç / kapat" sutun={3}>
        <Satir etiket="Yıllık vergi türü">
          <AlanSecim
            value={form.incomeTaxType ?? ''}
            onChange={(e) => setForm((prev) => ({ ...prev, incomeTaxType: (e.target.value || null) as IncomeTaxType }))}
          >
            <option value="">Yok</option>
            <option value="KURUMLAR">Kurumlar</option>
            <option value="GELIR">Gelir</option>
            <option value="BASIT_USUL">Basit usul</option>
          </AlanSecim>
        </Satir>

        {SIRA.map((key) => {
          const item = visibleDefs.find((d) => d.key === key);
          if (!item) return null;
          const value = (form as any)[item.key];
          const isActive = aktifMi(item);
          return (
            <Satir key={item.key as string} etiket={etiket(item)}>
              {item.tip === 'toggle' ? (
                <Anahtar checked={isActive} onChange={() => setForm({ ...form, [item.key]: !value } as BeyanConfig)} />
              ) : (
                <AlanSecim
                  value={value ?? ''}
                  onChange={(e) => {
                    const v = (e.target.value || null) as Period;
                    setForm(item.key === 'eDefterPeriod'
                      ? { ...form, eDefterPeriod: v, eDefterBaslangic: v ? form.eDefterBaslangic : null }
                      : ({ ...form, [item.key]: v } as BeyanConfig));
                  }}
                >
                  <option value="">Yok</option>
                  <option value="AYLIK">Aylık</option>
                  <option value="UCAYLIK">3 Aylık</option>
                  {item.tip === 'period_15gun' && <option value="ON_BES_GUNLUK">15 Gün</option>}
                </AlanSecim>
              )}
            </Satir>
          );
        })}

        {/* e-Defter başlangıcı: kendi alanı — eskiden aynı hücrede sıkışıyor, ay adı kırpılıyordu */}
        <Satir
          etiket="E-Defter başlangıcı"
          ipucu={form.eDefterPeriod ? 'Öncesindeki dönemler takibe düşmez.' : 'E-Defter dönemi seçilince açılır.'}
        >
          <AlanGirdi
            type="month"
            aria-label="E-Defter başlangıç ayı"
            disabled={!form.eDefterPeriod}
            value={form.eDefterBaslangic ?? ''}
            onChange={(e) => setForm({ ...form, eDefterBaslangic: e.target.value || null })}
          />
        </Satir>
      </FormGrup>

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
