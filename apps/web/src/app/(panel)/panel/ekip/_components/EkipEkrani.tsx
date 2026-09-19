'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { iptalEt, isOmurgaYok, isZamanAsimi, mukellefAdi, sabahOzetiUret, type AkisFiltre, type AkisGun, type Vaka } from '@/lib/ekip';
import { SORGU, useKosular, type Kosu } from './kosular';
import { Baslik, type EkipSekme } from './Baslik';
import { GorevKarti, type KomutTaslak } from './GorevKarti';
import { SizdenBeklenenKutu, bekleyenKalemler } from './Kararlar';
import { AkisKutu, onerileriCikar } from './GenelBakis';
import { IsPaneli } from './IsPaneli';
import { IsGecmisi } from './IsGecmisi';
import { DonemPanosu } from './DonemPanosu';
import { KadroKarti } from './KadroKarti';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { Dugme, KIRMIZI, TEXT } from './Tema';
import { DEPO, bugunMu, depoOku, depoYaz } from './ortak';

const SUZGECLER: AkisFiltre[] = ['tumu', 'suruyor', 'onay', 'istek', 'bitti'];
const SEKMELER: EkipSekme[] = ['genel', 'isler', 'pano', 'kadro'];
const DEPO_SEKME = 'ekip.sekme';

/** Yerel koşu bu vakaya mı ait: vakaId eşleşir ya da isId vaka kökü / adımlarından biri. */
export function kosuVakayaAitMi(kosu: Kosu, vaka: Vaka): boolean {
  if (kosu.vakaId && kosu.vakaId === vaka.vakaId) return true;
  if (kosu.isId && kosu.isId === vaka.vakaId) return true;
  return !!kosu.isId && vaka.adimlar.some((a) => a.tip === 'is' && a.isId === kosu.isId);
}

/**
 * EKİP EKRANI — kompakt başlık, görev kutusu ve odaklı çalışma alanı.
 *  Genel bakış : yeni görev, bekleyen kararlar ve kısa iş özeti.
 *  İşler       : süzgeçli liste veya tam genişlikte seçili iş.
 *  Dönem panosu: mükellef × aşama tablosu (İşle / Kontrol et / Hazırla görev kutusunu doldurur)
 *  Kadro       : etkin personel kartları
 * Koşu başlayınca ekran İşler sekmesine geçip paneli açar. Yapışkan öğe YOK; sayfa yatay kaymaz. Kuru/Canlı depoya yazılmaz.
 */
export function EkipEkrani() {
  const qc = useQueryClient();
  const [sekme, setSekmeState] = useState<EkipSekme>('genel');
  const [seciliDonem, setSeciliDonemState] = useState<string | null>(null);
  const [komutTaslak, setKomutTaslak] = useState<KomutTaslak | null>(null);
  const [akisSuzgec, setAkisSuzgecState] = useState<AkisFiltre>('tumu');
  const [akisGun, setAkisGunState] = useState<AkisGun>(7);
  const [akisTaxpayerId, setAkisTaxpayerId] = useState('');
  const [seciliVakaId, setSeciliVakaId] = useState<string | null>(null);
  const [panelKapali, setPanelKapali] = useState(false);
  const [odakNonce, setOdakNonce] = useState(0);
  const [escNonce, setEscNonce] = useState(0);
  const [sabahUretiliyor, setSabahUretiliyor] = useState(false);

  const komutRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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
    const t = depoOku(DEPO_SEKME) as EkipSekme | null;
    if (t && SEKMELER.includes(t)) setSekmeState(t);
  }, []);
  const setSekme = useCallback((s: EkipSekme) => {
    setSekmeState(s);
    depoYaz(DEPO_SEKME, s);
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

  const kadroS = useQuery(SORGU.kadro);
  const durumS = useQuery(SORGU.durum);
  const akisS = useQuery(SORGU.akis(akisSuzgec, akisGun, akisTaxpayerId || undefined, kosuVar));
  /** Genel bakış: süzgeçten bağımsız 7 günlük tam liste (kararlar, şu an, bugün). Varsayılan süzgeçte aynı sorgu → tek istek. */
  const genelS = useQuery(SORGU.akis('tumu', 7, undefined, kosuVar));
  const onaylarS = useQuery(SORGU.onaylarBekleyen);
  const panoS = useQuery(SORGU.pano);
  const mukelleflerS = useQuery(SORGU.mukellefler);

  const ajanlar = kadroS.data || [];
  const onaylar = useMemo(() => onaylarS.data || [], [onaylarS.data]);
  const mukellefler = useMemo(() => mukelleflerS.data || [], [mukelleflerS.data]);

  const mukellefHaritasi = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of mukellefler) m.set(t.id, mukellefAdi(t));
    return m;
  }, [mukellefler]);
  const mukellefAd = useCallback((id?: string | null) => (id ? mukellefHaritasi.get(id) : undefined), [mukellefHaritasi]);
  const ajanAd = useCallback((id: string) => (id === 'siz' ? 'Muzaffer Bey' : ajanlar.find((a) => a.id === id)?.ad || id), [ajanlar]);

  const genelVakalar = genelS.data?.vakalar;
  const sayaclar = durumS.data?.akis ?? genelS.data?.sayaclar ?? akisS.data?.sayaclar;
  const calisan = useMemo(() => Math.max(durumS.data?.calisan ?? ajanlar.filter((a) => !!a.suAn).length, kosular.aktifKosu ? 1 : 0), [durumS.data?.calisan, ajanlar, kosular.aktifKosu]);
  const bekleyenler = useMemo(() => bekleyenKalemler(genelVakalar), [genelVakalar]);
  const kararSayisi = bekleyenler.length || (sayaclar?.onay ?? 0) + (sayaclar?.istek ?? 0);
  const bugunBiten = useMemo(() => (genelVakalar || []).filter((v) => v.kutu === 'bitti' && v.durum !== 'hata' && bugunMu(v.guncellendi)).length, [genelVakalar]);
  const bugunYarim = useMemo(() => (genelVakalar || []).filter((v) => v.durum === 'hata' && bugunMu(v.guncellendi)).length, [genelVakalar]);
  const isSayisi = sayaclar ? sayaclar.suruyor + sayaclar.onay + sayaclar.istek + sayaclar.bitti : genelVakalar?.length || 0;

  // Personel başına 7 günlük iş sayısı (kadro kartları) — akıştaki 'is' adımlarından
  const haftalikIs = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of genelVakalar || []) for (const a of v.adimlar) if (a.tip === 'is') m.set(a.ajanId, (m.get(a.ajanId) || 0) + 1);
    return m;
  }, [genelVakalar]);

  // Dönem panosu: seçili dönem + özet + Koordinatör önerileri (bugün işi olan mükellefler atlanır)
  const panoDonem = useMemo(() => {
    const s = new Set<string>();
    for (const o of panoS.data?.donemOzetleri || []) if (o.donem) s.add(o.donem);
    const liste = [...s].sort().reverse();
    return seciliDonem && liste.includes(seciliDonem) ? seciliDonem : liste[0] || null;
  }, [panoS.data, seciliDonem]);
  const panoOzet = useMemo(() => panoS.data?.donemOzetleri.find((o) => o.donem === panoDonem), [panoS.data, panoDonem]);
  const oneriler = useMemo(() => {
    const mesgul = new Set<string>();
    for (const v of genelVakalar || []) if (v.mukellef?.id && (v.kutu !== 'bitti' || bugunMu(v.guncellendi))) mesgul.add(v.mukellef.id);
    return onerileriCikar(panoS.data, panoDonem, mesgul, 4);
  }, [panoS.data, panoDonem, genelVakalar]);

  const kaydir = useCallback((ref: React.RefObject<HTMLElement | HTMLDivElement>) => {
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, []);

  const taslakVer = useCallback(
    (t: Omit<KomutTaslak, 'nonce'>) => {
      setSekme('genel');
      setKomutTaslak({ ...t, ajanId: 'koordinator', nonce: Date.now() });
      kaydir(komutRef);
    },
    [kaydir, setSekme],
  );

  const isiAc = useCallback(
    (vakaId: string | null) => {
      setSekme('isler');
      setSeciliVakaId(vakaId);
      setPanelKapali(false);
      kaydir(panelRef);
    },
    [kaydir, setSekme],
  );

  // Koşu başlayınca İşler sekmesine geç, paneli o işle aç.
  const sonKosu = kosular.kosular.get('koordinator');
  const sonKosuVakaId = sonKosu?.vakaId || sonKosu?.isId;
  useEffect(() => {
    if (!sonKosu) return;
    setPanelKapali(false);
    setSeciliVakaId(sonKosuVakaId || null);
    if (akisSuzgec === 'bitti') setAkisSuzgec('tumu');
    if (!sonKosu.bitti) {
      setSekme('isler');
      kaydir(panelRef);
    }
  }, [sonKosu?.basladi, sonKosuVakaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const akisVakalar = akisS.data?.vakalar;
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
        setSekme('genel');
        setOdakNonce((n) => n + 1);
        komutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (e.key === 'Escape') setEscNonce((n) => n + 1);
    };
    window.addEventListener('keydown', dinle);
    return () => window.removeEventListener('keydown', dinle);
  }, [setSekme]);

  const seciliVaka = useMemo(() => {
    if (!seciliVakaId) return undefined;
    return akisVakalar?.find((v) => v.vakaId === seciliVakaId) || genelVakalar?.find((v) => v.vakaId === seciliVakaId);
  }, [akisVakalar, genelVakalar, seciliVakaId]);
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
    if (kosular.aktifKosu) return kosular.aktifKosu.kaynak === 'sabahOzeti' ? 'Sabah özetini topluyorum; bitince İşler sekmesinde açılır.' : 'Görevinizi aldım; ilerlemeyi İşler sekmesindeki panelden izleyebilirsiniz.';
    if (seciliVakaCalisiyor && seciliVaka) {
      const kosan = seciliVaka.adimlar.find((a) => a.tip === 'is' && a.durum === 'running');
      return `${seciliVaka.mukellef?.ad ? `${seciliVaka.mukellef.ad} işi` : 'İş'} ${kosan && kosan.tip === 'is' ? ajanAd(kosan.ajanId) : 'personel'}’de; bitince buraya ve WhatsApp’a yazacağım.`;
    }
    if (kararSayisi > 0) return `${kararSayisi} konuda kararınızı bekliyorum — aşağıdaki "Sizden beklenen" kutusunda.`;
    const bugun = durumS.data?.bugunKosu ?? 0;
    const hata = durumS.data?.bugunHata ?? 0;
    if (bugun > 0) return `Bugün ${bugun} iş koştu${hata ? `, ${hata} tanesi yarım kaldı` : ', hepsi tamamlandı'}. Yeni görev için kutuya yazın ya da söyleyin.`;
    return 'Bugün henüz iş verilmedi. Kutuya yazın ya da söyleyin; işi doğru uzmana veririm.';
  }, [durumS.data, kosular.aktifKosu, seciliVakaCalisiyor, seciliVaka, kararSayisi, ajanAd]);

  const tazele = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ekip-akis'] });
    qc.invalidateQueries({ queryKey: ['ekip-kadro'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
    qc.invalidateQueries({ queryKey: ['ekip-onaylar'] });
  }, [qc]);

  /** Genel bakıştaki karar kartından cevap → aynı iş zincirinde Koordinatör koşusu (kuru/canlı vakadan). */
  const vakayaCevapla = useCallback(
    (vaka: Vaka, metin: string) => {
      if (kosular.aktifKosu) {
        toast.info('Koşu sürüyor', { description: 'Cevabınızı İşler sekmesindeki panelden "Bitince gönder" ile kuyruğa alabilirsiniz.' });
        return false;
      }
      void kosular.baslat('koordinator', { gorev: `Cevap: ${metin}`, taxpayerId: vaka.mukellef?.id || undefined, dryRun: vaka.kuru, vakaId: vaka.vakaId });
      return true;
    },
    [kosular],
  );

  /** Şu an kutusundan Durdur: yerel koşu → SSE + sunucu iptal; sunucu vakası → koşan işi iptal. */
  const durdur = useCallback(
    async (hedef: { kosu?: Kosu; vaka?: Vaka }) => {
      if (hedef.kosu) {
        await kosular.durdur(hedef.kosu.ajanId);
        return;
      }
      const kosan = hedef.vaka?.adimlar.find((a) => a.tip === 'is' && a.durum === 'running');
      if (!kosan || kosan.tip !== 'is') return;
      const r = await iptalEt(kosan.isId).catch((e) => ({ ok: false as const, isId: kosan.isId, error: e?.message }));
      if (r.ok) toast.success('Durduruldu', { description: 'İş "iptal edildi (Muzaffer Bey)" olarak kapandı.' });
      else toast.error('Durdurulamadı', { description: (r as any).error });
      tazele();
    },
    [kosular, tazele],
  );

  /** Sabah özetini şimdi üret (yalnız üretir, GÖNDERMEZ; gönderim iş panelinde ayrı teyit). */
  const sabahOzetiUretSimdi = useCallback(async () => {
    if (sabahUretiliyor || kosular.aktifKosu) {
      if (kosular.aktifKosu) toast.info('Koşu sürüyor; bitince deneyin.');
      return;
    }
    setSabahUretiliyor(true);
    const basladi = Date.now();
    kosular.ayarla('koordinator', { ajanId: 'koordinator', gorev: 'Sabah özeti — üretiliyor (gönderme yok)', dryRun: true, cevap: '', adimlar: [], bitti: false, basladi, kaynak: 'sabahOzeti' });
    try {
      const r = await sabahOzetiUret({ gonder: false });
      kosular.ayarla('koordinator', {
        ajanId: 'koordinator',
        gorev: 'Sabah özeti (şimdi üretildi)',
        dryRun: true,
        isId: r.isId,
        vakaId: r.isId,
        model: r.model,
        cevap: r.rapor || '',
        adimlar: (r.toolUses || []).map((t) => ({ tip: 'arac' as const, ad: t.name, args: t.args, zaman: Date.now(), durum: 'bitti' as const })),
        bitti: true,
        hata: r.hata,
        durationMs: r.durationMs ?? Date.now() - basladi,
        basladi,
        kaynak: 'sabahOzeti',
        gonderildi: 0,
      });
      toast.success('Sabah özeti üretildi', { description: 'İşler sekmesinde açıldı.' });
    } catch (e: any) {
      const zamanAsimi = isZamanAsimi(e);
      const hata = zamanAsimi ? 'Sürüyor — iş kayıtlarında görünecek' : e?.message || 'Sabah özeti üretilemedi';
      kosular.guncelle('koordinator', (k) => ({ ...k, bitti: true, hata, durationMs: Date.now() - basladi }));
      if (zamanAsimi) toast.info(hata);
      else toast.error(hata);
    } finally {
      setSabahUretiliyor(false);
      tazele();
      qc.invalidateQueries({ queryKey: ['ekip-akis'] });
    }
  }, [sabahUretiliyor, kosular, tazele, qc]);

  const omurgaYok = isOmurgaYok(kadroS.error);

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-10">
      <Baslik
        durum={durumS.data}
        pano={panoS.data}
        ozet={panoOzet}
        ajanSayisi={ajanlar.length}
        kararSayisi={kararSayisi}
        calisan={calisan}
        bugunBiten={bugunBiten}
        bugunYarim={bugunYarim}
        isSayisi={isSayisi}
        sekme={sekme}
        onSekme={setSekme}
        onSabahOzeti={() => void sabahOzetiUretSimdi()}
        sabahOzetiMesgul={sabahUretiliyor || (!!kosular.aktifKosu && kosular.aktifKosu.kaynak === 'sabahOzeti')}
      />

      {kosular.bekleyenCevap && (sekme !== 'isler' || !panelGoster) && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200/15 bg-amber-200/5 px-4 py-2 text-xs text-stone-300">
          <span className="flex-1">Cevabınız ilgili işin tamamlanmasını bekliyor.</span>
          <Dugme tur="sade" onClick={() => isiAc(kosular.bekleyenCevap!.vakaId)}>İşi aç</Dugme>
          <Dugme tur="sade" onClick={() => kosular.setBekleyenCevap(null)}>Cevabı iptal et</Dugme>
        </div>
      )}

      {omurgaYok && <OmurgaYokBilgi />}
      {!!kadroS.error && !omurgaYok && (
        <div className="rounded-2xl px-4 py-3 text-[12.5px]" style={{ background: `${KIRMIZI}12`, border: `1px solid ${KIRMIZI}59`, color: TEXT }}>
          Kadro alınamadı: {(kadroS.error as any)?.message || 'hata'}
        </div>
      )}

      {/* Genel bakış: görev ve karar tek kart; sağda tek akış, altta kadro. */}
      {sekme === 'genel' && (
        <>
          <div className="grid min-w-0 items-start gap-[18px] xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <GorevKarti ref={komutRef} ajanlar={ajanlar} mukellefler={mukellefler} komutTaslak={komutTaslak} kosular={kosular} odakNonce={odakNonce} escNonce={escNonce} maxBagli={durumS.data?.maxBagli} koordinatorNotu={koordinatorNotu}>
              <SizdenBeklenenKutu kalemler={bekleyenler} onaylar={onaylar} ajanAd={ajanAd} mukellefAd={mukellefAd} onBitti={tazele} onCevapla={vakayaCevapla} calisiyor={!!kosular.aktifKosu} yukleniyor={genelS.isLoading && !genelS.data} hata={genelS.error} />
            </GorevKarti>
            <AkisKutu kosu={sonKosu} vakalar={genelVakalar} oneriler={oneriler} ajanAd={ajanAd} mukellefAd={mukellefAd} onIzle={isiAc} onDurdur={(h) => void durdur(h)} onSec={isiAc} onTumu={() => setSekme('isler')} onTaslak={taslakVer} onPano={() => setSekme('pano')} yukleniyor={genelS.isLoading && !genelS.data} hata={genelS.error} panoYukleniyor={panoS.isLoading && !panoS.data} panoHata={panoS.error} />
          </div>
        </>
      )}

      {sekme === 'isler' && (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {panelGoster ? (
              <Dugme tur="sade" onClick={() => setPanelKapali(true)}>← İş listesine dön</Dugme>
            ) : <p className="text-sm text-stone-400">Görevlerinizi izleyin, incelemek için bir iş açın.</p>}
            <Dugme tur="birincil" onClick={() => { setSekme('genel'); setOdakNonce(Date.now()); }}>+ Yeni görev</Dugme>
          </div>
          <div hidden={panelGoster}>
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
          </div>
          <div ref={panelRef} className="min-w-0" style={{ scrollMarginTop: 16 }}>
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
            ) : null}
          </div>
        </div>
      )}

      {sekme === 'pano' && <DonemPanosu pano={panoS.data} isLoading={panoS.isLoading} error={panoS.error} seciliDonem={seciliDonem} onDonemSec={setSeciliDonem} onTaslak={taslakVer} eksiklerNonce={0} />}

      {sekme === 'kadro' && <KadroKarti ajanlar={ajanlar} onaylar={onaylar} kosular={kosular.kosular} mukellefAd={mukellefAd} yukleniyor={kadroS.isLoading} haftalikIs={haftalikIs} bugunKosu={durumS.data?.bugunKosu ?? 0} />}
    </div>
  );
}
