'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, FolderOpen, CalendarRange, ShieldCheck } from 'lucide-react';
import { isOmurgaYok, mukellefAdi } from '@/lib/ekip';
import { SORGU, useKosular } from './kosular';
import { KonsolBaslik } from './KonsolBaslik';
import { AjanSeridi } from './AjanSeridi';
import { KomutKutusu, type KomutTaslak } from './KomutKutusu';
import { CanliAkis } from './CanliAkis';
import { IsDosyalari } from './IsDosyalari';
import { OnayKuyrugu } from './OnayBekleyenler';
import { AjanDetayKarti } from './AjanDetayKarti';
import { DonemPanosu } from './DonemPanosu';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { Kart } from './Kart';
import { EKIP_ACCENT, RENK, ajanYuzeyRengi, bugunMu, depoOku, depoYaz } from './ortak';

const DEPO_AJAN = 'ekip.seciliAjan';
const DEPO_DONEM = 'ekip.donem';
const DEPO_SEKME = 'ekip.sekme';

type Sekme = 'akis' | 'isler' | 'pano' | 'onaylar';
const SEKMELER: Sekme[] = ['akis', 'isler', 'pano', 'onaylar'];

/**
 * "Sakin komuta merkezi" — tek sütun, yukarıdan aşağıya:
 *  1. KonsolBaslik   — serif başlık + tek satır hap rozetler (+ Şimdi üret)
 *  2. AjanSeridi     — 13 avatar tek sıra (dar ekranda yatay kayar)
 *  3. OnayKuyrugu    — yalnız bekleyen onay > 0 ise altın şerit-kart
 *  4. KomutKutusu    — kahraman kart; "bilgi" → AjanDetayKarti altında açılır/kapanır
 *  5. Sekmeler       — Canlı akış · İş dosyaları · Dönem panosu · Onaylar (localStorage 'ekip.sekme')
 *  6. Tek içerik kartı — dört sekme de bağlı kalır (durum/süzgeç kaybolmaz), yalnız biri görünür
 * ORTAK DURUM burada: seçili ajan, dönem, komut taslağı, koşu haritası (useKosular), açık iş, sekme.
 * Yapışkan/fixed öğe YOK; sayfa yatay kaymaz. Kuru/Canlı depoya yazılmaz.
 */
export function EkipEkrani() {
  const [seciliAjanId, setSeciliAjanIdState] = useState('koordinator');
  const [seciliDonem, setSeciliDonemState] = useState<string | null>(null);
  const [sekme, setSekmeState] = useState<Sekme>('akis');
  const [detayAcik, setDetayAcik] = useState(false);
  const [komutTaslak, setKomutTaslak] = useState<KomutTaslak | null>(null);
  const [acikIsId, setAcikIsId] = useState<string | null>(null);
  const [odakNonce, setOdakNonce] = useState(0);
  const [escNonce, setEscNonce] = useState(0);
  const [isSuzgec, setIsSuzgec] = useState<{ nonce: number; gun?: 'bugun' | '7' | 'tumu' } | null>(null);
  const [eksiklerNonce, setEksiklerNonce] = useState(0);

  const komutRef = useRef<HTMLElement>(null);
  const onayRef = useRef<HTMLElement>(null);
  const icerikRef = useRef<HTMLElement>(null);

  const kosular = useKosular();
  const kosuVar = !!kosular.aktifKosu;

  // Hatırlanan seçimler (Kuru/Canlı ASLA depoya yazılmaz)
  useEffect(() => {
    const a = depoOku(DEPO_AJAN);
    if (a) setSeciliAjanIdState(a);
    const d = depoOku(DEPO_DONEM);
    if (d) setSeciliDonemState(d);
    const s = depoOku(DEPO_SEKME) as Sekme | null;
    if (s && SEKMELER.includes(s)) setSekmeState(s);
  }, []);
  const setSeciliAjanId = useCallback((id: string) => {
    setSeciliAjanIdState(id);
    depoYaz(DEPO_AJAN, id);
  }, []);
  const setSeciliDonem = useCallback((d: string) => {
    setSeciliDonemState(d);
    depoYaz(DEPO_DONEM, d);
  }, []);
  const setSekme = useCallback((s: Sekme) => {
    setSekmeState(s);
    depoYaz(DEPO_SEKME, s);
  }, []);

  // Ortak sorgular
  const kadroS = useQuery(SORGU.kadro);
  const durumS = useQuery(SORGU.durum);
  const islerS = useQuery(SORGU.isler(kosuVar));
  const onaylarS = useQuery(SORGU.onaylarBekleyen);
  const panoS = useQuery(SORGU.pano);
  const mukelleflerS = useQuery(SORGU.mukellefler);

  const ajanlar = kadroS.data || [];
  const isler = useMemo(() => islerS.data || [], [islerS.data]);
  const onaylar = useMemo(() => onaylarS.data || [], [onaylarS.data]);
  const mukellefler = useMemo(() => mukelleflerS.data || [], [mukelleflerS.data]);
  const bugunSayisi = useMemo(() => isler.filter((i) => bugunMu(i.createdAt)).length, [isler]);

  // Mükellef haritası — her yerde ad çözümü
  const mukellefHaritasi = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of mukellefler) m.set(t.id, mukellefAdi(t));
    return m;
  }, [mukellefler]);
  const mukellefAd = useCallback((id?: string | null) => (id ? mukellefHaritasi.get(id) : undefined), [mukellefHaritasi]);
  const ajanAd = useCallback((id: string) => ajanlar.find((a) => a.id === id)?.ad || id, [ajanlar]);

  const icerigeKaydir = useCallback(() => {
    setTimeout(() => icerikRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }, []);

  const taslakVer = useCallback((t: Omit<KomutTaslak, 'nonce'>) => {
    setKomutTaslak({ ...t, nonce: Date.now() });
  }, []);

  const isAc = useCallback(
    (isId: string) => {
      setAcikIsId(isId);
      setSekme('isler');
      icerigeKaydir();
    },
    [setSekme, icerigeKaydir],
  );

  // Koşu başlayınca otomatik "Canlı akış" sekmesi + koşan ajan seçilir (sabah özeti → Koordinatör; sonra istenirse başka ajana geçilebilir, koşu kesilmez)
  const aktifBasladi = kosular.aktifKosu?.basladi;
  const aktifAjanId = kosular.aktifKosu?.ajanId;
  useEffect(() => {
    if (!aktifBasladi) return;
    setSekme('akis');
    if (aktifAjanId) setSeciliAjanId(aktifAjanId);
  }, [aktifBasladi]); // eslint-disable-line react-hooks/exhaustive-deps

  // Klavye — tek dinleyici: '/' komut kutusuna odak (input dışındaysa); Esc teyit/listeyi kapatır (KOŞUYU DURDURMAZ)
  useEffect(() => {
    const dinle = (e: KeyboardEvent) => {
      const hedef = e.target as HTMLElement | null;
      const girisIcinde = !!hedef && (hedef.tagName === 'INPUT' || hedef.tagName === 'TEXTAREA' || hedef.tagName === 'SELECT' || hedef.isContentEditable);
      if (e.key === '/' && !girisIcinde) {
        e.preventDefault();
        setOdakNonce((n) => n + 1);
        komutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (e.key === 'Escape') {
        setEscNonce((n) => n + 1);
      }
    };
    window.addEventListener('keydown', dinle);
    return () => window.removeEventListener('keydown', dinle);
  }, []);

  const seciliAjan = ajanlar.find((a) => a.id === seciliAjanId);
  const omurgaYok = isOmurgaYok(kadroS.error);
  const bekleyenSayisi = onaylar.length;

  const sekmeTanim: Array<{ id: Sekme; ad: string; ikon: ReactNode; sayac?: number; sayacRenk?: string }> = [
    { id: 'akis', ad: 'Canlı akış', ikon: <Activity size={13} /> },
    { id: 'isler', ad: 'İş dosyaları', ikon: <FolderOpen size={13} />, sayac: bugunSayisi, sayacRenk: EKIP_ACCENT },
    { id: 'pano', ad: 'Dönem panosu', ikon: <CalendarRange size={13} /> },
    { id: 'onaylar', ad: 'Onaylar', ikon: <ShieldCheck size={13} />, sayac: bekleyenSayisi, sayacRenk: RENK.altin },
  ];
  const icerikRenk = sekme === 'akis' ? ajanYuzeyRengi(seciliAjanId) : sekme === 'pano' ? RENK.mor : EKIP_ACCENT;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <KonsolBaslik
        durum={durumS.data}
        durumHata={durumS.error}
        durumYukleniyor={durumS.isLoading}
        kadroSayisi={ajanlar.length}
        onaylar={onaylar}
        isler={isler}
        pano={panoS.data}
        panoYukleniyor={panoS.isLoading}
        kosular={kosular}
        onOnayaGit={() => {
          if (bekleyenSayisi > 0 && onayRef.current) onayRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
          else {
            setSekme('onaylar');
            icerigeKaydir();
          }
        }}
        onBugunKosulara={() => {
          setIsSuzgec({ nonce: Date.now(), gun: 'bugun' });
          setSekme('isler');
          icerigeKaydir();
        }}
        onPanoyaGit={() => {
          setEksiklerNonce((n) => n + 1);
          setSekme('pano');
          icerigeKaydir();
        }}
      />

      {omurgaYok && <OmurgaYokBilgi />}
      {!!kadroS.error && !omurgaYok && (
        <div className="rounded-xl px-4 py-3 text-[12.5px]" style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#fecaca' }}>
          Kadro alınamadı: {(kadroS.error as any)?.message || 'hata'}
        </div>
      )}

      {/* 2. Avatar sırası */}
      <AjanSeridi ajanlar={ajanlar} isler={isler} onaylar={onaylar} kosular={kosular.kosular} seciliAjanId={seciliAjanId} onSec={setSeciliAjanId} yukleniyor={kadroS.isLoading} />

      {/* 3. Onay şeridi — yalnız bekleyen > 0 */}
      <OnayKuyrugu ref={onayRef} mod="serit" onaylar={onaylar} isLoading={onaylarS.isLoading} error={onaylarS.error} mukellefAd={mukellefAd} onIsAc={isAc} />

      {/* 4. Kahraman komut kartı (+ bilgi kartı) */}
      <KomutKutusu
        ref={komutRef}
        ajanlar={ajanlar}
        seciliAjanId={seciliAjanId}
        onAjanSec={setSeciliAjanId}
        mukellefler={mukellefler}
        mukellefAd={mukellefAd}
        seciliDonem={seciliDonem}
        komutTaslak={komutTaslak}
        kosular={kosular}
        odakNonce={odakNonce}
        escNonce={escNonce}
        maxBagli={durumS.data?.maxBagli}
        detayAcik={detayAcik}
        onDetayToggle={() => setDetayAcik((a) => !a)}
      />
      {detayAcik && <AjanDetayKarti ajan={seciliAjan} isler={isler} onIsAc={isAc} onKapat={() => setDetayAcik(false)} />}

      {/* 5. Sekmeler — hap segment; dar ekranda yatay kayar */}
      <div className="flex min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex flex-shrink-0 items-center gap-1 rounded-full p-1" style={{ background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(255,255,255,0.08)' }} role="tablist">
          {sekmeTanim.map((t) => {
            const aktif = sekme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={aktif}
                onClick={() => setSekme(t.id)}
                className="inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-[background-color,color,transform] duration-150 hover:-translate-y-px"
                style={aktif ? { background: `linear-gradient(135deg, ${EKIP_ACCENT}, #5b9fd1)`, color: '#0b1218', boxShadow: `0 6px 18px ${EKIP_ACCENT}33` } : { background: 'transparent', color: RENK.ikincil }}
              >
                {t.ikon} {t.ad}
                {t.sayac != null && t.sayac > 0 && (
                  <span
                    className="rounded-full px-1.5 text-[10px] font-bold leading-4 tabular-nums"
                    style={aktif ? { background: 'rgba(0,0,0,0.25)', color: '#0b1218' } : { background: `${t.sayacRenk}1f`, border: `1px solid ${t.sayacRenk}55`, color: t.sayacRenk }}
                  >
                    {t.sayac}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 6. Tek içerik kartı — dört sekme de bağlı kalır; yalnız biri görünür */}
      <Kart ref={icerikRef} renk={icerikRenk} className="p-5">
        <div hidden={sekme !== 'akis'}>
          <CanliAkis
            kosu={kosular.kosular.get(seciliAjanId)}
            ajanId={seciliAjanId}
            ajanAd={ajanAd}
            sonIs={isler[0]}
            onIsAc={isAc}
            onCevapla={(metin) => taslakVer({ ajanId: seciliAjanId, gorev: `Cevap: ${metin}`, taxpayerId: kosular.kosular.get(seciliAjanId)?.taxpayerId, dryRun: true, kaynak: 'cevap' })}
            kosular={kosular}
          />
        </div>
        <div hidden={sekme !== 'isler'}>
          <IsDosyalari
            isler={isler}
            isLoading={islerS.isLoading}
            error={islerS.error}
            ajanlar={ajanlar}
            seciliAjanId={seciliAjanId}
            mukellefAd={mukellefAd}
            acikIsId={acikIsId}
            onAcikIsId={setAcikIsId}
            onTaslak={taslakVer}
            disSuzgec={isSuzgec}
          />
        </div>
        <div hidden={sekme !== 'pano'}>
          <DonemPanosu pano={panoS.data} isLoading={panoS.isLoading} error={panoS.error} seciliDonem={seciliDonem} onDonemSec={setSeciliDonem} onTaslak={taslakVer} eksiklerNonce={eksiklerNonce} />
        </div>
        <div hidden={sekme !== 'onaylar'}>
          <OnayKuyrugu mod="sekme" onaylar={onaylar} isLoading={onaylarS.isLoading} error={onaylarS.error} mukellefAd={mukellefAd} onIsAc={isAc} />
        </div>
      </Kart>
    </div>
  );
}
