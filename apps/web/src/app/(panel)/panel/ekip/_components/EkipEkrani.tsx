'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, ChevronDown } from 'lucide-react';
import { isOmurgaYok, mukellefAdi, type AkisFiltre, type AkisGun, type PanoDonemOzeti, type Vaka } from '@/lib/ekip';
import { SORGU, useKosular, type Kosu } from './kosular';
import { UstSerit } from './UstSerit';
import { PersonelSeridi } from './PersonelSeridi';
import { GorevKarti, type KomutTaslak } from './GorevKarti';
import { IsPaneli } from './IsPaneli';
import { IsGecmisi } from './IsGecmisi';
import { DonemPanosu } from './DonemPanosu';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { Kart } from './Kart';
import { DEPO, TEMA, depoOku, depoYaz, donemEtiketi } from './ortak';

const SUZGECLER: AkisFiltre[] = ['tumu', 'suruyor', 'onay', 'istek', 'bitti'];

/** Yerel koşu bu vakaya mı ait: vakaId eşleşir ya da isId vaka kökü / adımlarından biri. */
export function kosuVakayaAitMi(kosu: Kosu, vaka: Vaka): boolean {
  if (kosu.vakaId && kosu.vakaId === vaka.vakaId) return true;
  if (kosu.isId && kosu.isId === vaka.vakaId) return true;
  return !!kosu.isId && vaka.adimlar.some((a) => a.tip === 'is' && a.isId === kosu.isId);
}

/**
 * EKİP EKRANI v3 — "Ekip Konsolu" (baştan tasarım, 2026-09-14 gece; Muzaffer Bey: "aşamaları gösterdiği ekran yarım/karışık, baştan sona yeniden tasarla").
 * Tek sütun, yukarıdan aşağıya:
 *  1. UstSerit      — başlık + tarih + sistem durumu; 4 sayaç kutusu (Personel · Şu an çalışan · Onayınızı bekleyen · Sizden istenen)
 *  2. PersonelSeridi — 12 personel kartı (çalışan vurgulu)
 *  3. GorevKarti    — TEK görev yeri (Koordinatör): metin, hazır görevler, mükellef, Kuru/Canlı, Sesli, Çalıştır
 *  4. IsPaneli      — komut verilen (ya da geçmişten seçilen) işin TAM görünümü: aşama çubuğu → adımlar (insan dili) · sonuç (rapor bölümleri, onay/istek kartları)
 *  5. IsGecmisi     — süzgeçli iş listesi; satır → panelde açılır
 *  6. DonemPanosu   — katlanır
 * Kart dili Bütçe/Cari Kasa ile aynı (Kart.tsx). Yapışkan öğe YOK; sayfa yatay kaymaz. Kuru/Canlı depoya yazılmaz.
 */
export function EkipEkrani() {
  const [seciliDonem, setSeciliDonemState] = useState<string | null>(null);
  const [komutTaslak, setKomutTaslak] = useState<KomutTaslak | null>(null);
  const [akisSuzgec, setAkisSuzgecState] = useState<AkisFiltre>('tumu');
  const [akisGun, setAkisGunState] = useState<AkisGun>(7);
  const [akisTaxpayerId, setAkisTaxpayerId] = useState('');
  const [seciliVakaId, setSeciliVakaId] = useState<string | null>(null);
  const [panelKapali, setPanelKapali] = useState(false);
  const [panoAcik, setPanoAcikState] = useState(false);
  const [odakNonce, setOdakNonce] = useState(0);
  const [escNonce, setEscNonce] = useState(0);

  const komutRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const gecmisRef = useRef<HTMLDivElement>(null);
  const panoRef = useRef<HTMLElement>(null);

  const kosular = useKosular();
  const [panelCalisiyor, setPanelCalisiyor] = useState(false);
  const kosuVar = !!kosular.aktifKosu || panelCalisiyor;

  useEffect(() => {
    const d = depoOku(DEPO.donem);
    if (d) setSeciliDonemState(d);
    const s = depoOku(DEPO.akisSuzgec) as AkisFiltre | null;
    if (s && SUZGECLER.includes(s)) setAkisSuzgecState(s);
    const g = Number(depoOku(DEPO.akisGun));
    if (g === 1 || g === 7 || g === 30) setAkisGunState(g);
    if (depoOku(DEPO.panoAcik) === '1') setPanoAcikState(true);
  }, []);
  const setSeciliDonem = useCallback((d: string) => {
    setSeciliDonemState(d);
    depoYaz(DEPO.donem, d);
  }, []);
  const setAkisSuzgec = useCallback((f: AkisFiltre) => {
    setAkisSuzgecState(f);
    depoYaz(DEPO.akisSuzgec, f);
  }, []);
  const setAkisGun = useCallback((g: AkisGun) => {
    setAkisGunState(g);
    depoYaz(DEPO.akisGun, String(g));
  }, []);
  const setPanoAcik = useCallback((a: boolean) => {
    setPanoAcikState(a);
    depoYaz(DEPO.panoAcik, a ? '1' : '0');
  }, []);

  const kadroS = useQuery(SORGU.kadro);
  const durumS = useQuery(SORGU.durum);
  const akisS = useQuery(SORGU.akis(akisSuzgec, akisGun, akisTaxpayerId || undefined, kosuVar));
  const onaylarS = useQuery(SORGU.onaylarBekleyen);
  const panoS = useQuery(SORGU.pano);
  const mukelleflerS = useQuery(SORGU.mukellefler);

  const ajanlar = kadroS.data || [];
  const onaylar = useMemo(() => onaylarS.data || [], [onaylarS.data]);
  const mukellefler = useMemo(() => mukelleflerS.data || [], [mukelleflerS.data]);
  const panoOzet = useMemo(() => (panoS.data?.donemOzetleri || []).reduce<PanoDonemOzeti | undefined>((en, o) => (!en || o.donem > en.donem ? o : en), undefined), [panoS.data]);

  const mukellefHaritasi = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of mukellefler) m.set(t.id, mukellefAdi(t));
    return m;
  }, [mukellefler]);
  const mukellefAd = useCallback((id?: string | null) => (id ? mukellefHaritasi.get(id) : undefined), [mukellefHaritasi]);
  const ajanAd = useCallback((id: string) => (id === 'siz' ? 'Muzaffer Bey' : ajanlar.find((a) => a.id === id)?.ad || id), [ajanlar]);

  const sayaclar = durumS.data?.akis ?? akisS.data?.sayaclar;
  const calisan = useMemo(() => Math.max(durumS.data?.calisan ?? ajanlar.filter((a) => !!a.suAn).length, kosular.aktifKosu ? 1 : 0), [durumS.data?.calisan, ajanlar, kosular.aktifKosu]);

  const kaydir = useCallback((ref: React.RefObject<HTMLElement | HTMLDivElement>) => {
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, []);

  const taslakVer = useCallback(
    (t: Omit<KomutTaslak, 'nonce'>) => {
      setKomutTaslak({ ...t, ajanId: 'koordinator', nonce: Date.now() });
      kaydir(komutRef);
    },
    [kaydir],
  );

  // Koşu başlayınca panel o işi gösterir ve açılır.
  const sonKosu = kosular.kosular.get('koordinator');
  const sonKosuVakaId = sonKosu?.vakaId || sonKosu?.isId;
  useEffect(() => {
    if (!sonKosu) return;
    setPanelKapali(false);
    // Koşu başlarken isId henüz yok → seçim boşalır (eski iş panelde kalmasın); isId gelince o iş seçilir.
    setSeciliVakaId(sonKosuVakaId || null);
    if (akisSuzgec === 'bitti') setAkisSuzgec('tumu');
    if (!sonKosu.bitti) kaydir(panelRef);
  }, [sonKosu?.basladi, sonKosuVakaId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Akış tazelenince seçili vaka eşleşmesi (koşu bir devir zincirine bağlandıysa kök vakaId farklı olabilir)
  const akisVakalar = akisS.data?.vakalar;
  useEffect(() => {
    if (!sonKosu || !akisVakalar || !seciliVakaId) return;
    if (akisVakalar.some((v) => v.vakaId === seciliVakaId)) return;
    const es = akisVakalar.find((v) => kosuVakayaAitMi(sonKosu, v));
    if (es) setSeciliVakaId(es.vakaId);
  }, [akisVakalar, sonKosu, seciliVakaId]);

  // Klavye — tek dinleyici: '/' görev kutusuna odak; Esc teyit/listeyi kapatır (KOŞUYU DURDURMAZ)
  useEffect(() => {
    const dinle = (e: KeyboardEvent) => {
      const hedef = e.target as HTMLElement | null;
      const girisIcinde = !!hedef && (hedef.tagName === 'INPUT' || hedef.tagName === 'TEXTAREA' || hedef.tagName === 'SELECT' || hedef.isContentEditable);
      if (e.key === '/' && !girisIcinde) {
        e.preventDefault();
        setOdakNonce((n) => n + 1);
        komutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (e.key === 'Escape') setEscNonce((n) => n + 1);
    };
    window.addEventListener('keydown', dinle);
    return () => window.removeEventListener('keydown', dinle);
  }, []);

  // Panelde gösterilecek iş: seçili vaka (sunucu) + eşleşen yerel koşu
  const seciliVaka = useMemo(() => (seciliVakaId ? akisVakalar?.find((v) => v.vakaId === seciliVakaId) : undefined), [akisVakalar, seciliVakaId]);
  const panelKosu = useMemo(() => {
    if (sonKosu && seciliVaka && kosuVakayaAitMi(sonKosu, seciliVaka)) return sonKosu;
    if (sonKosu && !seciliVaka && (!seciliVakaId || seciliVakaId === sonKosuVakaId)) return sonKosu;
    return undefined;
  }, [sonKosu, seciliVaka, seciliVakaId, sonKosuVakaId]);
  const panelGoster = !panelKapali && (!!panelKosu || !!seciliVaka);
  // Panelde personel çalışıyorsa akış daha sık tazelenir (personel adımı bitince sonuç gecikmesin)
  const seciliVakaCalisiyor = !!seciliVaka && seciliVaka.adimlar.some((a) => a.tip === 'is' && (a.durum === 'running' || a.durum === 'pending'));
  useEffect(() => setPanelCalisiyor(seciliVakaCalisiyor), [seciliVakaCalisiyor]);

  const omurgaYok = isOmurgaYok(kadroS.error);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <UstSerit
        durum={durumS.data}
        durumHata={durumS.error}
        durumYukleniyor={durumS.isLoading}
        kadroSayisi={ajanlar.length}
        calisan={calisan}
        sayaclar={sayaclar}
        kosular={kosular}
        onSuzgec={(f) => {
          setAkisSuzgec(f);
          kaydir(gecmisRef);
        }}
      />

      {omurgaYok && <OmurgaYokBilgi />}
      {!!kadroS.error && !omurgaYok && (
        <div className="rounded-xl px-4 py-3 text-[12.5px]" style={{ background: `${TEMA.kirmizi}14`, border: `1px solid ${TEMA.kirmizi}55`, color: TEMA.metin }}>
          Kadro alınamadı: {(kadroS.error as any)?.message || 'hata'}
        </div>
      )}

      <PersonelSeridi ajanlar={ajanlar} onaylar={onaylar} kosular={kosular.kosular} mukellefAd={mukellefAd} yukleniyor={kadroS.isLoading} />

      <GorevKarti ref={komutRef} ajanlar={ajanlar} mukellefler={mukellefler} mukellefAd={mukellefAd} seciliDonem={seciliDonem} komutTaslak={komutTaslak} kosular={kosular} odakNonce={odakNonce} escNonce={escNonce} maxBagli={durumS.data?.maxBagli} />

      {panelGoster && (
        <div ref={panelRef}>
          <IsPaneli
            kosu={panelKosu}
            vaka={seciliVaka}
            kosular={kosular}
            ajanAd={ajanAd}
            mukellefAd={mukellefAd}
            onTaslak={taslakVer}
            onKapat={() => {
              setPanelKapali(true);
              if (panelKosu?.bitti) kosular.kaldir(panelKosu.ajanId);
            }}
          />
        </div>
      )}

      <div ref={gecmisRef}>
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
            kaydir(panelRef);
          }}
        />
      </div>

      <Kart ref={panoRef} renk={TEMA.mor} ton="mor" dolguYok>
        <button type="button" onClick={() => setPanoAcik(!panoAcik)} aria-expanded={panoAcik} className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4 text-left">
          <span className="inline-flex items-center gap-2">
            <CalendarRange size={14} style={{ color: TEMA.mor }} />
            <span className="text-[13.5px] font-semibold tracking-wide" style={{ color: TEMA.metin }}>
              Dönem panosu
            </span>
          </span>
          <span className="min-w-0 truncate text-[11.5px]" style={{ color: TEMA.ikincil }}>
            {panoOzet ? `${donemEtiketi(panoOzet.beyannameDonem || panoOzet.donem)} beyannameleri · KDV kontrol ${panoOzet.ozet.kontrol}/${panoOzet.toplam} · hazır ${panoOzet.ozet.beyannameHazir} · verildi işaretli ${panoOzet.ozet.beyanname}` : 'mükellef × dönem aşamaları'}
          </span>
          <ChevronDown size={14} className="ml-auto transition-transform" style={{ color: TEMA.soluk, transform: panoAcik ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
        </button>
        {panoAcik && (
          <div className="px-5 pb-5">
            <DonemPanosu pano={panoS.data} isLoading={panoS.isLoading} error={panoS.error} seciliDonem={seciliDonem} onDonemSec={setSeciliDonem} onTaslak={taslakVer} eksiklerNonce={0} />
          </div>
        )}
      </Kart>
    </div>
  );
}
