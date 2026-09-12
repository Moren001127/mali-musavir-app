'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, ChevronDown } from 'lucide-react';
import { isOmurgaYok, mukellefAdi, type AkisFiltre, type AkisGun } from '@/lib/ekip';
import { SORGU, useKosular } from './kosular';
import { KonsolBaslik } from './KonsolBaslik';
import { AjanSeridi } from './AjanSeridi';
import { KomutKutusu, type KomutTaslak } from './KomutKutusu';
import { IsAkisi, kosuVakayaAitMi } from './IsAkisi';
import { DonemPanosu } from './DonemPanosu';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { Kart } from './Kart';
import { DEPO, EKIP_ACCENT, RENK, depoOku, depoYaz } from './ortak';

const SUZGECLER: AkisFiltre[] = ['tumu', 'suruyor', 'onay', 'istek', 'bitti'];

/**
 * "Sakin komuta merkezi" v2 — tek sütun, yukarıdan aşağıya (Muzaffer Bey, 2026-09-13):
 *  1. KonsolBaslik  — İNCE şerit (≤56px): Moren Ekip · tarih · 13 çalışan · N çalışıyor · Onay N · Beyanname x/64 · Operatör · Max · Sabah özeti [Şimdi üret]
 *  2. AjanSeridi    — 13 avatar tek sıra, TIKLANMAZ; yalnız durum (kim çalışıyor, ne üzerinde)
 *  3. KomutKutusu   — TEK komut yeri: Koordinatör (işi kendisi yönlendirir)
 *  4. IsAkisi       — CANLI AKIŞ: Tümü · Sürüyor · Onayınızı bekleyen · Sizden istenen · Bitti; satır = iş dosyası zinciri (vaka)
 *  5. DonemPanosu   — en altta katlanır (varsayılan kapalı)
 * Sekmeler, ajan seçimi, AjanDetayKarti, IsDosyalari, OnayKuyrugu KALKTI. Yapışkan öğe YOK; sayfa yatay kaymaz. Kuru/Canlı depoya yazılmaz.
 */
export function EkipEkrani() {
  const [seciliDonem, setSeciliDonemState] = useState<string | null>(null);
  const [komutTaslak, setKomutTaslak] = useState<KomutTaslak | null>(null);
  const [akisSuzgec, setAkisSuzgecState] = useState<AkisFiltre>('tumu');
  const [akisGun, setAkisGunState] = useState<AkisGun>(7);
  const [akisTaxpayerId, setAkisTaxpayerId] = useState('');
  const [acikVakaId, setAcikVakaId] = useState<string | null>(null);
  const [panoAcik, setPanoAcikState] = useState(false);
  const [odakNonce, setOdakNonce] = useState(0);
  const [escNonce, setEscNonce] = useState(0);
  const [eksiklerNonce, setEksiklerNonce] = useState(0);

  const komutRef = useRef<HTMLElement>(null);
  const akisRef = useRef<HTMLElement>(null);
  const panoRef = useRef<HTMLElement>(null);

  const kosular = useKosular();
  const kosuVar = !!kosular.aktifKosu;

  // Hatırlanan seçimler (Kuru/Canlı ve açık vaka ASLA depoya yazılmaz)
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

  // Ortak sorgular
  const kadroS = useQuery(SORGU.kadro);
  const durumS = useQuery(SORGU.durum);
  const akisS = useQuery(SORGU.akis(akisSuzgec, akisGun, akisTaxpayerId || undefined, kosuVar));
  const onaylarS = useQuery(SORGU.onaylarBekleyen);
  const panoS = useQuery(SORGU.pano); // başlık hapı "Beyanname x/64" için hep açık (pano kapalıyken de)
  const mukelleflerS = useQuery(SORGU.mukellefler);

  const ajanlar = kadroS.data || [];
  const onaylar = useMemo(() => onaylarS.data || [], [onaylarS.data]);
  const mukellefler = useMemo(() => mukelleflerS.data || [], [mukelleflerS.data]);

  // Mükellef haritası — her yerde ad çözümü
  const mukellefHaritasi = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of mukellefler) m.set(t.id, mukellefAdi(t));
    return m;
  }, [mukellefler]);
  const mukellefAd = useCallback((id?: string | null) => (id ? mukellefHaritasi.get(id) : undefined), [mukellefHaritasi]);
  const ajanAd = useCallback((id: string) => (id === 'siz' ? 'Muzaffer Bey' : ajanlar.find((a) => a.id === id)?.ad || id), [ajanlar]);

  // Sayaçlar: durum.akis (tek istek) ?? akis.sayaclar; çalışan: durum.calisan ?? kadro suAn sayısı (+ yerel koşu)
  const sayaclar = durumS.data?.akis ?? akisS.data?.sayaclar;
  const calisan = useMemo(() => {
    const sunucu = durumS.data?.calisan ?? ajanlar.filter((a) => !!a.suAn).length;
    // Yerel koşu sunucuya henüz yansımadıysa en az 1 göster
    return Math.max(sunucu, kosular.aktifKosu ? 1 : 0);
  }, [durumS.data?.calisan, ajanlar, kosular.aktifKosu]);

  const kaydir = useCallback((ref: React.RefObject<HTMLElement>) => {
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, []);

  const taslakVer = useCallback((t: Omit<KomutTaslak, 'nonce'>) => {
    // Hep Koordinatör'e gider (ajanId yok sayılır)
    setKomutTaslak({ ...t, ajanId: 'koordinator', nonce: Date.now() });
  }, []);

  // Koşu başlayınca (ya da sabah özeti bitince isId gelince) eşleşen vaka satırı kendiliğinden açılır; vakaId gelmeden geçici satır üstte
  const sonKosu = kosular.kosular.get('koordinator');
  const sonKosuVakaId = sonKosu?.vakaId || sonKosu?.isId;
  useEffect(() => {
    if (!sonKosuVakaId) return;
    setAcikVakaId(sonKosuVakaId);
    if (akisSuzgec === 'bitti') setAkisSuzgec('tumu');
  }, [sonKosuVakaId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Akış tazelenince aynı vaka açık kalsın (koşu bir devir zincirine bağlandıysa kök vakaId farklı olabilir → eşleşeni bul)
  const akisVakalar = akisS.data?.vakalar;
  useEffect(() => {
    if (!sonKosu || !akisVakalar || !acikVakaId) return;
    if (akisVakalar.some((v) => v.vakaId === acikVakaId)) return;
    const es = akisVakalar.find((v) => kosuVakayaAitMi(sonKosu, v));
    if (es) setAcikVakaId(es.vakaId);
  }, [akisVakalar, sonKosu, acikVakaId]);

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

  const omurgaYok = isOmurgaYok(kadroS.error);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {/* 1. İnce başlık şeridi */}
      <KonsolBaslik
        durum={durumS.data}
        durumHata={durumS.error}
        durumYukleniyor={durumS.isLoading}
        kadroSayisi={ajanlar.length}
        calisan={calisan}
        sayaclar={sayaclar}
        pano={panoS.data}
        panoYukleniyor={panoS.isLoading}
        kosular={kosular}
        onSuzgec={(f) => {
          setAkisSuzgec(f);
          kaydir(akisRef);
        }}
        onPanoAc={() => {
          setPanoAcik(true);
          setEksiklerNonce((n) => n + 1);
          kaydir(panoRef);
        }}
      />

      {omurgaYok && <OmurgaYokBilgi />}
      {!!kadroS.error && !omurgaYok && (
        <div className="rounded-xl px-4 py-3 text-[12.5px]" style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#fecaca' }}>
          Kadro alınamadı: {(kadroS.error as any)?.message || 'hata'}
        </div>
      )}

      {/* 2. Personel sırası — yalnız durum */}
      <AjanSeridi ajanlar={ajanlar} onaylar={onaylar} kosular={kosular.kosular} mukellefAd={mukellefAd} yukleniyor={kadroS.isLoading} />

      {/* 3. TEK komut kutusu — Koordinatör */}
      <KomutKutusu
        ref={komutRef}
        ajanlar={ajanlar}
        mukellefler={mukellefler}
        mukellefAd={mukellefAd}
        seciliDonem={seciliDonem}
        komutTaslak={komutTaslak}
        kosular={kosular}
        odakNonce={odakNonce}
        escNonce={escNonce}
        maxBagli={durumS.data?.maxBagli}
      />

      {/* 4. CANLI AKIŞ — ana alan */}
      <Kart ref={akisRef} renk={EKIP_ACCENT} serit className="p-5">
        <IsAkisi
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
          acikVakaId={acikVakaId}
          onAcikVakaId={setAcikVakaId}
          kosular={kosular}
          ajanAd={ajanAd}
          onTaslak={taslakVer}
        />
      </Kart>

      {/* 5. Dönem panosu — katlanır (varsayılan kapalı) */}
      <Kart ref={panoRef} renk={RENK.mor} className={panoAcik ? 'p-5' : ''}>
        <button
          type="button"
          onClick={() => setPanoAcik(!panoAcik)}
          aria-expanded={panoAcik}
          className={`flex w-full items-center gap-2 text-left ${panoAcik ? 'mb-3' : 'px-5 py-3.5'}`}
        >
          <CalendarRange size={14} style={{ color: RENK.mor }} />
          <span className="text-[13px] font-bold" style={{ color: RENK.metin }}>
            Dönem panosu
          </span>
          <span className="text-[11px]" style={{ color: RENK.ikincil }}>
            {panoAcik ? '' : '— mükellef × dönem aşamaları; "Görev ver" Koordinatör’e gider'}
          </span>
          <ChevronDown size={14} className="ml-auto transition-transform" style={{ color: RENK.sonuk, transform: panoAcik ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
        </button>
        {panoAcik && (
          <DonemPanosu pano={panoS.data} isLoading={panoS.isLoading} error={panoS.error} seciliDonem={seciliDonem} onDonemSec={setSeciliDonem} onTaslak={taslakVer} eksiklerNonce={eksiklerNonce} />
        )}
      </Kart>
    </div>
  );
}
