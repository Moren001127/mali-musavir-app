'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { mukellefAdi, type AkisFiltre, type AkisGun } from '@/lib/ekip';
import { IsGecmisi } from '../IsGecmisi';
import { IsPaneli } from '../IsPaneli';
import { SORGU, useKosular } from '../kosular';
import { DEPO, depoOku, depoYaz } from '../ortak';
import { AltSayfa } from './AltSayfa';
import type { KomutTaslak } from './GorevKutusu';
import { Cekmece } from './Parcalar';
import { taslakBirak } from './yardimci';

const SUZGECLER: AkisFiltre[] = ['tumu', 'suruyor', 'onay', 'istek', 'bitti'];

/**
 * /panel/ekip/isler — İş geçmişi: mevcut İşler listesi (süzgeçler · 8'er "Daha fazla göster") + iş paneli (sağdan çekmece).
 * "Tekrar" görev kutusunu doldurur: taslak oturum deposuna bırakılır, ana sayfa açılır. Panelden cevap bu sayfanın kendi koşusuyla gider.
 */
export function IslerSayfasi() {
  const router = useRouter();
  const kosular = useKosular();
  const [akisSuzgec, setAkisSuzgecState] = useState<AkisFiltre>('tumu');
  const [akisGun, setAkisGunState] = useState<AkisGun>(7);
  const [akisTaxpayerId, setAkisTaxpayerId] = useState('');
  const [seciliVakaId, setSeciliVakaId] = useState<string | null>(null);
  const [panelKapali, setPanelKapali] = useState(true);
  useEffect(() => {
    const s = depoOku(DEPO.akisSuzgec) as AkisFiltre | null;
    if (s && SUZGECLER.includes(s)) setAkisSuzgecState(s);
    const g = Number(depoOku(DEPO.akisGun));
    if (g === 1 || g === 7 || g === 30) setAkisGunState(g);
  }, []);
  const setAkisSuzgec = useCallback((f: AkisFiltre) => {
    setAkisSuzgecState(f);
    depoYaz(DEPO.akisSuzgec, f);
  }, []);
  const setAkisGun = useCallback((g: AkisGun) => {
    setAkisGunState(g);
    depoYaz(DEPO.akisGun, String(g));
  }, []);

  const kosuVar = !!kosular.aktifKosu;
  const akisS = useQuery(SORGU.akis(akisSuzgec, akisGun, akisTaxpayerId || undefined, kosuVar));
  const durumS = useQuery(SORGU.durum);
  const kadroS = useQuery(SORGU.kadro);
  const mukelleflerS = useQuery(SORGU.mukellefler);
  const ajanlar = useMemo(() => kadroS.data || [], [kadroS.data]);
  const mukellefler = useMemo(() => mukelleflerS.data || [], [mukelleflerS.data]);
  const mukellefHaritasi = useMemo(() => new Map(mukellefler.map((t) => [t.id, mukellefAdi(t)])), [mukellefler]);
  const mukellefAd = useCallback((id?: string | null) => (id ? mukellefHaritasi.get(id) : undefined), [mukellefHaritasi]);
  const ajanAd = useCallback((id: string) => (id === 'siz' ? 'Muzaffer Bey' : ajanlar.find((a) => a.id === id)?.ad || id), [ajanlar]);
  const sayaclar = durumS.data?.akis ?? akisS.data?.sayaclar;

  const kosuHaritasi = kosular.kosular;
  const sonKosu = useMemo(() => {
    let son: ReturnType<typeof kosuHaritasi.get>;
    for (const k of kosuHaritasi.values()) if (!son || k.basladi > son.basladi) son = k;
    return son;
  }, [kosuHaritasi]);
  useEffect(() => {
    if (!sonKosu) return;
    setSeciliVakaId(sonKosu.vakaId || sonKosu.isId || null);
    setPanelKapali(false);
  }, [sonKosu?.basladi]); // eslint-disable-line react-hooks/exhaustive-deps

  const seciliVaka = useMemo(() => akisS.data?.vakalar.find((v) => v.vakaId === seciliVakaId), [akisS.data, seciliVakaId]);
  const panelKosu = sonKosu && seciliVaka && (sonKosu.vakaId === seciliVaka.vakaId || sonKosu.isId === seciliVaka.vakaId) ? sonKosu : sonKosu && !seciliVaka && seciliVakaId === (sonKosu.vakaId || sonKosu.isId) ? sonKosu : undefined;
  const panelGoster = !panelKapali && (!!seciliVaka || !!panelKosu);

  const onTaslak = useCallback(
    (t: Omit<KomutTaslak, 'nonce'>) => {
      taslakBirak({ gorev: t.gorev, taxpayerId: t.taxpayerId, kaynak: 'tekrar', vakaId: t.vakaId });
      router.push('/panel/ekip');
    },
    [router],
  );

  return (
    <AltSayfa baslik="İş geçmişi" alt="Verilen görevler, sonuç raporları ve bulgular. Satıra tıklayınca iş paneli açılır.">
      <IsGecmisi
        akis={akisS.data}
        isLoading={akisS.isLoading}
        error={akisS.error}
        sayaclar={sayaclar}
        suzgec={akisSuzgec}
        onSuzgec={setAkisSuzgec}
        gun={akisGun}
        onGun={setAkisGun}
        taxpayerId={akisTaxpayerId}
        onTaxpayerId={setAkisTaxpayerId}
        mukellefler={mukellefler}
        seciliVakaId={panelGoster ? seciliVakaId : null}
        ajanAd={ajanAd}
        onSec={(v) => {
          setSeciliVakaId(v.vakaId);
          setPanelKapali(false);
        }}
      />
      <Cekmece
        acik={panelGoster}
        genis
        baslik={seciliVaka?.mukellef?.ad || mukellefAd(panelKosu?.taxpayerId) || 'Ofis geneli'}
        onKapat={() => {
          setPanelKapali(true);
          if (panelKosu?.bitti) kosular.kaldir(panelKosu.ajanId);
        }}
      >
        {panelGoster && (
          <IsPaneli
            kosu={panelKosu}
            vaka={seciliVaka}
            kosular={kosular}
            ajanAd={ajanAd}
            mukellefAd={mukellefAd}
            onTaslak={onTaslak}
            onKapat={() => {
              setPanelKapali(true);
              if (panelKosu?.bitti) kosular.kaldir(panelKosu.ajanId);
            }}
          />
        )}
      </Cekmece>
    </AltSayfa>
  );
}
