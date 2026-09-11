'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { isOmurgaYok, mukellefAdi } from '@/lib/ekip';
import { SORGU, useKosular } from './kosular';
import { SabahBandi } from './SabahBandi';
import { AjanSeridi } from './AjanSeridi';
import { KomutKutusu, type KomutTaslak } from './KomutKutusu';
import { CanliAkis } from './CanliAkis';
import { IsDosyalari } from './IsDosyalari';
import { OnayKuyrugu } from './OnayBekleyenler';
import { AjanDetayKarti } from './AjanDetayKarti';
import { DonemPanosu } from './DonemPanosu';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { RENK, depoOku, depoYaz } from './ortak';

const DEPO_AJAN = 'ekip.seciliAjan';
const DEPO_DONEM = 'ekip.donem';

/**
 * Yerleşim omurgası + ORTAK DURUM: seçili ajan, seçili dönem, komut taslağı, koşu haritası (useKosular), açık iş.
 * Ortak sorgular burada tek yerde; alt bileşenlere props ile iner. Yapışkan öğe YOK; sayfa yatay kaymaz.
 *
 * Yerleşim:
 *  - xl (≥1280): [AjanSeridi | KomutKutusu→CanliAkis→IsDosyalari | OnayKuyrugu→AjanDetayKarti] + DonemPanosu tam genişlik
 *  - lg (1024–1279): [AjanSeridi | OnayKuyrugu→KomutKutusu→CanliAkis→AjanDetayKarti→IsDosyalari]
 *  - <1024: tek kolon: Onay → Komut → AjanSeridi(yatay) → CanliAkis → IsDosyalari → AjanDetay → Pano
 *  Sağ kolon sarmalayıcı xl altında `contents` olur; öğeler `order-*` ile mobil sıraya girer.
 */
export function EkipEkrani() {
  const [seciliAjanId, setSeciliAjanIdState] = useState('koordinator');
  const [seciliDonem, setSeciliDonemState] = useState<string | null>(null);
  const [komutTaslak, setKomutTaslak] = useState<KomutTaslak | null>(null);
  const [acikIsId, setAcikIsId] = useState<string | null>(null);
  const [odakNonce, setOdakNonce] = useState(0);
  const [escNonce, setEscNonce] = useState(0);
  const [isSuzgec, setIsSuzgec] = useState<{ nonce: number; gun?: 'bugun' | '7' | 'tumu' } | null>(null);
  const [eksiklerNonce, setEksiklerNonce] = useState(0);

  const komutRef = useRef<HTMLElement>(null);
  const onayRef = useRef<HTMLElement>(null);
  const isRef = useRef<HTMLElement>(null);
  const panoRef = useRef<HTMLElement>(null);

  const kosular = useKosular();
  const kosuVar = !!kosular.aktifKosu;

  // Hatırlanan seçimler (Kuru/Canlı ASLA depoya yazılmaz)
  useEffect(() => {
    const a = depoOku(DEPO_AJAN);
    if (a) setSeciliAjanIdState(a);
    const d = depoOku(DEPO_DONEM);
    if (d) setSeciliDonemState(d);
  }, []);
  const setSeciliAjanId = useCallback((id: string) => {
    setSeciliAjanIdState(id);
    depoYaz(DEPO_AJAN, id);
  }, []);
  const setSeciliDonem = useCallback((d: string) => {
    setSeciliDonemState(d);
    depoYaz(DEPO_DONEM, d);
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

  // Mükellef haritası — her yerde ad çözümü
  const mukellefHaritasi = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of mukellefler) m.set(t.id, mukellefAdi(t));
    return m;
  }, [mukellefler]);
  const mukellefAd = useCallback((id?: string | null) => (id ? mukellefHaritasi.get(id) : undefined), [mukellefHaritasi]);
  const ajanAd = useCallback((id: string) => ajanlar.find((a) => a.id === id)?.ad || id, [ajanlar]);

  const taslakVer = useCallback((t: Omit<KomutTaslak, 'nonce'>) => {
    setKomutTaslak({ ...t, nonce: Date.now() });
  }, []);

  const isAc = useCallback((isId: string) => {
    setAcikIsId(isId);
    setTimeout(() => isRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }, []);

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

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {omurgaYok && <OmurgaYokBilgi />}
      {!!kadroS.error && !omurgaYok && (
        <div className="rounded-xl px-4 py-3 text-xs" style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#fecaca' }}>
          Kadro alınamadı: {(kadroS.error as any)?.message || 'hata'}
        </div>
      )}
      {kadroS.isLoading && (
        <div className="flex items-center gap-2 text-xs" style={{ color: RENK.ikincil }}>
          <Loader2 size={12} className="animate-spin" /> Kadro yükleniyor…
        </div>
      )}

      <SabahBandi
        durum={durumS.data}
        onaylar={onaylar}
        isler={isler}
        pano={panoS.data}
        panoYukleniyor={panoS.isLoading}
        ajanAd={ajanAd}
        mukellefAd={mukellefAd}
        kosular={kosular}
        onOnayaGit={() => onayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        onBugunKosulara={() => {
          setIsSuzgec({ nonce: Date.now(), gun: 'bugun' });
          isRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        onPanoyaGit={() => {
          setEksiklerNonce((n) => n + 1);
          panoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        onKomutOdak={() => {
          setOdakNonce((n) => n + 1);
          komutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }}
      />

      {/* Kolonlar — bkz. yerleşim notu */}
      <div className="flex min-w-0 flex-col gap-3 lg:grid lg:grid-cols-[212px_minmax(0,1fr)] lg:grid-rows-[auto_auto_auto_auto_1fr] lg:items-start xl:grid-cols-[236px_minmax(0,1fr)_340px] xl:grid-rows-[auto_auto_1fr] 2xl:grid-cols-[260px_minmax(0,1fr)_380px]">
        {/* SOL */}
        <div className="order-3 min-w-0 lg:order-none lg:col-start-1 lg:row-start-1 lg:row-span-5 xl:row-span-3">
          <AjanSeridi ajanlar={ajanlar} isler={isler} onaylar={onaylar} kosular={kosular.kosular} seciliAjanId={seciliAjanId} onSec={setSeciliAjanId} yukleniyor={kadroS.isLoading} />
        </div>

        {/* ORTA */}
        <div className="order-2 min-w-0 lg:order-none lg:col-start-2 lg:row-start-2 xl:row-start-1">
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
          />
        </div>
        <div className="order-4 min-w-0 lg:order-none lg:col-start-2 lg:row-start-3 xl:row-start-2">
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
        <div className="order-5 min-w-0 lg:order-none lg:col-start-2 lg:row-start-5 xl:row-start-3">
          <IsDosyalari
            ref={isRef}
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

        {/* SAĞ — xl'de kolon; altında `contents` (öğeler kendi sıralarına girer) */}
        <div className="contents xl:col-start-3 xl:row-start-1 xl:row-span-3 xl:flex xl:min-w-0 xl:flex-col xl:gap-3">
          <div className="order-1 min-w-0 lg:order-none lg:col-start-2 lg:row-start-1">
            <OnayKuyrugu ref={onayRef} onaylar={onaylar} isLoading={onaylarS.isLoading} error={onaylarS.error} mukellefAd={mukellefAd} onIsAc={isAc} />
          </div>
          <div className="order-6 min-w-0 lg:order-none lg:col-start-2 lg:row-start-4">
            <AjanDetayKarti ajan={seciliAjan} isler={isler} onIsAc={isAc} />
          </div>
        </div>
      </div>

      <DonemPanosu ref={panoRef} pano={panoS.data} isLoading={panoS.isLoading} error={panoS.error} seciliDonem={seciliDonem} onDonemSec={setSeciliDonem} onTaslak={taslakVer} eksiklerNonce={eksiklerNonce} />
    </div>
  );
}
