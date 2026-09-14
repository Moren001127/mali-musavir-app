'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, ChevronDown } from 'lucide-react';
import { isOmurgaYok, mukellefAdi, type AkisFiltre, type AkisGun, type PanoDonemOzeti, type Vaka } from '@/lib/ekip';
import { SORGU, useKosular, type Kosu } from './kosular';
import { UstSerit } from './UstSerit';
import { KadroKarti } from './KadroKarti';
import { KararlarKarti } from './KararlarKarti';
import { SabahOzetiKarti } from './SabahOzetiKarti';
import { GorevKarti, type KomutTaslak } from './GorevKarti';
import { IsPaneli } from './IsPaneli';
import { IsGecmisi } from './IsGecmisi';
import { DonemPanosu } from './DonemPanosu';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { CamKart, Etiket, V5 } from './Cam';
import { DEPO, depoOku, depoYaz, donemEtiketi } from './ortak';

const SUZGECLER: AkisFiltre[] = ['tumu', 'suruyor', 'onay', 'istek', 'bitti'];

/** Yerel koşu bu vakaya mı ait: vakaId eşleşir ya da isId vaka kökü / adımlarından biri. */
export function kosuVakayaAitMi(kosu: Kosu, vaka: Vaka): boolean {
  if (kosu.vakaId && kosu.vakaId === vaka.vakaId) return true;
  if (kosu.isId && kosu.isId === vaka.vakaId) return true;
  return !!kosu.isId && vaka.adimlar.some((a) => a.tip === 'is' && a.isId === kosu.isId);
}

/**
 * EKİP EKRANI v5 — "premium komuta merkezi" (2026-09-15; Muzaffer Bey'in onayladığı görsel: _previews/ekip-v5).
 * Üst şerit (başlık + cam kapsüller) · iki sütun:
 *  SOL  : Görev merkezi (Koordinatör kartıyla) → Aktif iş (komut verilen ya da geçmişten seçilen iş) → İş kayıtları
 *  SAĞ  : Kadro (12 personel) → Sizden beklenen (kararlar) → Sabah özeti → Dönem panosu (katlanır)
 * Dar ekranda tek sütun. Yapışkan öğe YOK; sayfa yatay kaymaz. Kuru/Canlı depoya yazılmaz.
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
  const kararSayisi = (sayaclar?.onay ?? 0) + (sayaclar?.istek ?? 0);

  // Personel başına 7 günlük iş sayısı (kadro yük çubukları) — akıştaki 'is' adımlarından
  const akisVakalar = akisS.data?.vakalar;
  const haftalikIs = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of akisVakalar || []) for (const a of v.adimlar) if (a.tip === 'is') m.set(a.ajanId, (m.get(a.ajanId) || 0) + 1);
    return m;
  }, [akisVakalar]);

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
    setSeciliVakaId(sonKosuVakaId || null);
    if (akisSuzgec === 'bitti') setAkisSuzgec('tumu');
    if (!sonKosu.bitti) kaydir(panelRef);
  }, [sonKosu?.basladi, sonKosuVakaId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sonKosu || !akisVakalar || !seciliVakaId) return;
    if (akisVakalar.some((v) => v.vakaId === seciliVakaId)) return;
    const es = akisVakalar.find((v) => kosuVakayaAitMi(sonKosu, v));
    if (es) setSeciliVakaId(es.vakaId);
  }, [akisVakalar, sonKosu, seciliVakaId]);

  // Klavye — '/' görev kutusuna odak; Esc teyit/listeyi kapatır (KOŞUYU DURDURMAZ)
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

  const seciliVaka = useMemo(() => (seciliVakaId ? akisVakalar?.find((v) => v.vakaId === seciliVakaId) : undefined), [akisVakalar, seciliVakaId]);
  const panelKosu = useMemo(() => {
    if (sonKosu && seciliVaka && kosuVakayaAitMi(sonKosu, seciliVaka)) return sonKosu;
    if (sonKosu && !seciliVaka && (!seciliVakaId || seciliVakaId === sonKosuVakaId)) return sonKosu;
    return undefined;
  }, [sonKosu, seciliVaka, seciliVakaId, sonKosuVakaId]);
  const panelGoster = !panelKapali && (!!panelKosu || !!seciliVaka);
  const seciliVakaCalisiyor = !!seciliVaka && seciliVaka.adimlar.some((a) => a.tip === 'is' && (a.durum === 'running' || a.durum === 'pending'));
  useEffect(() => setPanelCalisiyor(seciliVakaCalisiyor), [seciliVakaCalisiyor]);

  // Koordinatör kartındaki tek cümle durum notu
  const koordinatorNotu = useMemo(() => {
    if (durumS.data?.maxBagli === false) return 'Max bağlı değil — kadro çalışamıyor.';
    if (kosular.aktifKosu) return kosular.aktifKosu.kaynak === 'sabahOzeti' ? 'Sabah özetini topluyorum; bitince iş panelinde açılır.' : 'Görevinizi aldım; ilerlemeyi aşağıdaki iş panelinden izleyebilirsiniz.';
    if (seciliVakaCalisiyor && seciliVaka) {
      const kosan = seciliVaka.adimlar.find((a) => a.tip === 'is' && a.durum === 'running');
      return `${seciliVaka.mukellef?.ad ? `${seciliVaka.mukellef.ad} işi` : 'İş'} ${kosan && kosan.tip === 'is' ? ajanAd(kosan.ajanId) : 'personel'}’de; bitince buraya ve WhatsApp’a yazacağım.`;
    }
    if (kararSayisi > 0) return `${kararSayisi} konuda kararınızı bekliyorum — sağdaki "Sizden beklenen" kutusunda.`;
    const bugun = durumS.data?.bugunKosu ?? 0;
    const hata = durumS.data?.bugunHata ?? 0;
    if (bugun > 0) return `Bugün ${bugun} iş koştu${hata ? `, ${hata} tanesi yarım kaldı` : ', hepsi tamamlandı'}. Yeni görev için kutuya yazın ya da söyleyin.`;
    return 'Bugün henüz iş verilmedi. Kutuya yazın ya da söyleyin; işi doğru uzmana veririm.';
  }, [durumS.data, kosular.aktifKosu, seciliVakaCalisiyor, seciliVaka, kararSayisi, ajanAd]);

  const omurgaYok = isOmurgaYok(kadroS.error);
  const suzgecVeKaydir = (f: AkisFiltre) => {
    setAkisSuzgec(f);
    kaydir(gecmisRef);
  };

  return (
    <div className="flex min-w-0 flex-col gap-[22px]">
      <UstSerit durum={durumS.data} durumHata={durumS.error} durumYukleniyor={durumS.isLoading} />

      {omurgaYok && <OmurgaYokBilgi />}
      {!!kadroS.error && !omurgaYok && (
        <div className="rounded-2xl px-4 py-3 text-[12.5px]" style={{ background: 'rgba(255,107,122,0.10)', border: '1px solid rgba(255,107,122,0.45)', color: V5.metin }}>
          Kadro alınamadı: {(kadroS.error as any)?.message || 'hata'}
        </div>
      )}

      <div className="grid min-w-0 items-start gap-[22px] xl:grid-cols-[minmax(0,1fr)_392px]">
        {/* SOL SÜTUN */}
        <div className="flex min-w-0 flex-col gap-[22px]">
          <GorevKarti ref={komutRef} ajanlar={ajanlar} mukellefler={mukellefler} mukellefAd={mukellefAd} komutTaslak={komutTaslak} kosular={kosular} odakNonce={odakNonce} escNonce={escNonce} maxBagli={durumS.data?.maxBagli} calisan={calisan} kararSayisi={kararSayisi} koordinatorNotu={koordinatorNotu} />

          <div ref={panelRef}>
            {panelGoster ? (
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
            ) : (
              <CamKart ton="mavi" etiket="Aktif iş" baslik="Şu an çalışan iş yok">
                <div className="flex items-center gap-4">
                  <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-[18px]" style={{ background: 'linear-gradient(160deg, rgba(110,163,255,0.25), rgba(110,163,255,0.06))', border: '1px solid rgba(110,163,255,0.35)', color: '#cfe0ff' }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <b className="block text-[15px]" style={{ color: V5.metin }}>
                      Görev verdiğinizde canlı ilerleme burada açılır
                    </b>
                    <span className="text-[12.8px]" style={{ color: V5.ikincil }}>
                      Aşamalar, personelin her adımı, şu an ne yaptığı, sonuç tablosu ve sizden beklenen karar — tek panelde. Geçmiş bir işi görmek için aşağıdaki kayıtlardan satıra tıklayın.
                    </span>
                  </div>
                </div>
              </CamKart>
            )}
          </div>

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
        </div>

        {/* SAĞ SÜTUN */}
        <div className="flex min-w-0 flex-col gap-[22px]">
          <KadroKarti ajanlar={ajanlar} onaylar={onaylar} kosular={kosular.kosular} mukellefAd={mukellefAd} yukleniyor={kadroS.isLoading} haftalikIs={haftalikIs} bugunKosu={durumS.data?.bugunKosu ?? 0} />
          <KararlarKarti sayaclar={sayaclar} onSuzgec={suzgecVeKaydir} />
          <SabahOzetiKarti durum={durumS.data} kosular={kosular} />
          <CamKart ton="notr" dolguYok>
            <button type="button" onClick={() => setPanoAcik(!panoAcik)} aria-expanded={panoAcik} className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4 text-left">
              <Etiket ton="notr">Dönem panosu</Etiket>
              <span className="inline-flex min-w-0 items-center gap-2 text-[13px] font-bold" style={{ color: V5.metin }}>
                <CalendarRange size={14} style={{ color: V5.ikincil }} />
                {panoOzet ? `${donemEtiketi(panoOzet.beyannameDonem || panoOzet.donem)} beyannameleri` : 'Mükellef × dönem aşamaları'}
              </span>
              {panoOzet && (
                <span className="min-w-0 truncate text-[11.5px]" style={{ color: V5.soluk }}>
                  KDV kontrol {panoOzet.ozet.kontrol}/{panoOzet.toplam} · hazır {panoOzet.ozet.beyannameHazir} · verildi {panoOzet.ozet.beyanname}
                </span>
              )}
              <ChevronDown size={14} className="ml-auto transition-transform" style={{ color: V5.soluk, transform: panoAcik ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </button>
            {panoAcik && (
              <div className="px-5 pb-5">
                <DonemPanosu pano={panoS.data} isLoading={panoS.isLoading} error={panoS.error} seciliDonem={seciliDonem} onDonemSec={setSeciliDonem} onTaslak={taslakVer} eksiklerNonce={0} />
              </div>
            )}
          </CamKart>
        </div>
      </div>
    </div>
  );
}
