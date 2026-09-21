'use client';
import './ofis/ofis.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isOmurgaYok, isZamanAsimi, kuyrukDevam, kuyrukDurdur, mukellefAdi, sabahOzetiUret, type Vaka } from '@/lib/ekip';
import { SORGU, useKosular, type Kosu } from './kosular';
import { bekleyenKalemler } from './Kararlar';
import { IsPaneli } from './IsPaneli';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { bugunMu, donemEtiketi } from './ortak';
import { ozetSayilari } from './DonemPanosu';
import { UstSatir } from './ofis/UstSatir';
import { GorevKutusu, type KomutTaslak } from './ofis/GorevKutusu';
import { Bugun } from './ofis/Bugun';
import { Kadro } from './ofis/Kadro';
import { Cekmece } from './ofis/Parcalar';
import { taslakAl } from './ofis/yardimci';

/** Yerel koşu bu vakaya mı ait: vakaId eşleşir ya da isId vaka kökü / adımlarından biri. */
export function kosuVakayaAitMi(kosu: Kosu, vaka: Vaka): boolean {
  if (kosu.vakaId && kosu.vakaId === vaka.vakaId) return true;
  if (kosu.isId && kosu.isId === vaka.vakaId) return true;
  return !!kosu.isId && vaka.adimlar.some((a) => a.tip === 'is' && a.isId === kosu.isId);
}

/**
 * EKİP — tek ekran, ÜÇ parça (2026-09-22, sadeleştirilmiş "Dijital Ofis"):
 *  1 Üst satır (beyaz; Ekip · tarih · sabah özeti satırı · üç sayı çipi · durum noktaları · Görev ver · alt bağlantılar)
 *  2 Bugün (sol ~2/3): tek satırlık görev kutusu + tek liste — Sizden beklenen → Şu an → Sırada → Bitti
 *  3 Kadro (sağ ~1/3): 11 satır; satır → personel çekmecesi
 * İş paneli sağdan geniş çekmecede açılır; koşu başlayınca kendiliğinden açılır. Dönem tablosu · İş geçmişi · Düzenli işler ayrı sayfalar.
 * Korunan davranışlar (işlev envanteri §6): tek aktif koşu kilidi (kosular.aktifKosu) · SSE kopunca koşu sunucuda sürer (kosular.ts) ·
 * ajan başına koşu haritası · Durdur = önce iptalEt · kuru varsayılan, depoya yazılmaz · PRV onayı ONAYLIYORUM #id (lib/ekip.onayla) ·
 * sabah özeti gonder:false · test:true gönderilmez · kuyruğa alınan cevap · kadro 404 → OmurgaYokBilgi · pano düğmeleri yalnız
 * görev kutusunu doldurur (oturum deposu devri) · koşu başlayınca panel · Esc durdurmaz, `/` odaklar. Yapışkan öğe YOK; sayfa yatay kaymaz.
 */
export function EkipEkrani() {
  const qc = useQueryClient();
  const [komutTaslak, setKomutTaslak] = useState<KomutTaslak | null>(null);
  const [seciliVakaId, setSeciliVakaId] = useState<string | null>(null);
  const [panelKapali, setPanelKapali] = useState(true);
  const [odakNonce, setOdakNonce] = useState(0);
  const [escNonce, setEscNonce] = useState(0);
  const [sabahUretiliyor, setSabahUretiliyor] = useState(false);
  const [kuyrukMesgul, setKuyrukMesgul] = useState(false);

  const komutRef = useRef<HTMLDivElement>(null);
  const kosular = useKosular();
  const [panelCalisiyor, setPanelCalisiyor] = useState(false);
  const kosuVar = !!kosular.aktifKosu || panelCalisiyor;

  const kadroS = useQuery(SORGU.kadro);
  const durumS = useQuery(SORGU.durum);
  /** Süzgeçten bağımsız 7 günlük tam liste (bugün listesi, kararlar, kadro). */
  const genelS = useQuery(SORGU.akis('tumu', 7, undefined, kosuVar));
  const onaylarS = useQuery(SORGU.onaylarBekleyen);
  const panoS = useQuery(SORGU.pano);
  const mukelleflerS = useQuery(SORGU.mukellefler);
  const rutinlerS = useQuery(SORGU.rutinler);
  const kuyrukCanli = !!durumS.data?.kuyruk?.aktif;
  const kuyrukS = useQuery(SORGU.kuyruk(kuyrukCanli));

  const ajanlar = useMemo(() => kadroS.data || [], [kadroS.data]);
  const onaylar = useMemo(() => onaylarS.data || [], [onaylarS.data]);
  const mukellefler = useMemo(() => mukelleflerS.data || [], [mukelleflerS.data]);
  const rutinler = useMemo(() => rutinlerS.data?.rutinler || [], [rutinlerS.data]);
  const kuyruklar = useMemo(() => kuyrukS.data?.kuyruklar || [], [kuyrukS.data]);

  const mukellefHaritasi = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of mukellefler) m.set(t.id, mukellefAdi(t));
    return m;
  }, [mukellefler]);
  const mukellefAd = useCallback((id?: string | null) => (id ? mukellefHaritasi.get(id) : undefined), [mukellefHaritasi]);
  const ajanAd = useCallback((id: string) => (id === 'siz' ? 'Muzaffer Bey' : ajanlar.find((a) => a.id === id)?.ad || id), [ajanlar]);

  const genelVakalar = genelS.data?.vakalar;
  const sayaclar = durumS.data?.akis ?? genelS.data?.sayaclar;
  const calisan = useMemo(() => Math.max(durumS.data?.calisan ?? ajanlar.filter((a) => !!a.suAn).length, kosular.aktifKosu ? 1 : 0), [durumS.data?.calisan, ajanlar, kosular.aktifKosu]);
  const bekleyenler = useMemo(() => bekleyenKalemler(genelVakalar), [genelVakalar]);
  const kararSayisi = bekleyenler.length || (sayaclar?.onay ?? 0) + (sayaclar?.istek ?? 0);
  const bugunBiten = useMemo(() => (genelVakalar || []).filter((v) => v.kutu === 'bitti' && v.durum !== 'hata' && bugunMu(v.guncellendi)).length, [genelVakalar]);
  const bugunYarim = useMemo(() => (genelVakalar || []).filter((v) => v.durum === 'hata' && bugunMu(v.guncellendi)).length, [genelVakalar]);

  /** Üst satır sayısı: sunucu `bugunPlan` varsa o; yoksa akıştan türetilir. */
  const bugun = useMemo(() => {
    const p = durumS.data?.bugunPlan;
    if (p) return { biten: p.biten, planlanan: Math.max(p.planlanan, p.biten + p.suruyor) };
    return { biten: bugunBiten, planlanan: bugunBiten + calisan + bugunYarim };
  }, [durumS.data?.bugunPlan, bugunBiten, calisan, bugunYarim]);

  const panoOzet = useMemo(() => {
    const liste = [...(panoS.data?.donemOzetleri || [])].sort((a, b) => b.donem.localeCompare(a.donem));
    return liste[0];
  }, [panoS.data]);
  const donemGosterge = useMemo(() => {
    if (!panoOzet) return null;
    const s = ozetSayilari(panoOzet);
    return { etiket: donemEtiketi(panoOzet.beyannameDonem || panoOzet.donem), verildi: s.verildi, toplam: s.toplam };
  }, [panoOzet]);

  const taslakVer = useCallback((t: Omit<KomutTaslak, 'nonce'>) => {
    setKomutTaslak({ ...t, ajanId: 'koordinator', nonce: Date.now() });
    setTimeout(() => komutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  }, []);

  // Alt sayfalardan (dönem tablosu / iş geçmişi) bırakılan taslak: kutuyu doldurur, ÇALIŞTIRMAZ.
  useEffect(() => {
    const t = taslakAl();
    if (t) taslakVer({ gorev: t.gorev, taxpayerId: t.taxpayerId, dryRun: true, kaynak: t.kaynak === 'tekrar' ? 'tekrar' : 'pano', vakaId: t.vakaId });
  }, [taslakVer]);

  const isiAc = useCallback((vakaId: string | null) => {
    setSeciliVakaId(vakaId);
    setPanelKapali(false);
  }, []);

  // En son başlayan yerel koşu (ajan başına harita; Koordinatör ya da doğrudan personel)
  const sonKosu = useMemo(() => {
    let son: Kosu | undefined;
    for (const k of kosular.kosular.values()) if (!son || k.basladi > son.basladi) son = k;
    return son;
  }, [kosular.kosular]);
  const sonKosuVakaId = sonKosu?.vakaId || sonKosu?.isId;

  const isiIsIdIleAc = useCallback(
    (isId: string) => {
      const v = (genelVakalar || []).find((x) => x.vakaId === isId || x.adimlar.some((a) => a.tip === 'is' && a.isId === isId));
      if (v) isiAc(v.vakaId);
      else if (sonKosu && (sonKosu.isId === isId || sonKosu.vakaId === isId)) isiAc(sonKosuVakaId || null);
      else toast.info('İş kaydı henüz akışta görünmüyor; birkaç saniye sonra yeniden deneyin.');
    },
    [genelVakalar, isiAc, sonKosu, sonKosuVakaId],
  );

  // Koşu başlayınca paneli o işle aç.
  useEffect(() => {
    if (!sonKosu) return;
    setPanelKapali(false);
    setSeciliVakaId(sonKosuVakaId || null);
  }, [sonKosu?.basladi, sonKosuVakaId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sonKosu || !genelVakalar || !seciliVakaId) return;
    if (genelVakalar.some((v) => v.vakaId === seciliVakaId)) return;
    const es = genelVakalar.find((v) => kosuVakayaAitMi(sonKosu, v));
    if (es) setSeciliVakaId(es.vakaId);
  }, [genelVakalar, sonKosu, seciliVakaId]);

  // Klavye — '/' görev kutusuna odak; Esc teyit/menü/çekmeceyi kapatır (KOŞUYU DURDURMAZ)
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

  const seciliVaka = useMemo(() => (seciliVakaId ? genelVakalar?.find((v) => v.vakaId === seciliVakaId) : undefined), [genelVakalar, seciliVakaId]);
  const panelKosu = useMemo(() => {
    if (sonKosu && seciliVaka && kosuVakayaAitMi(sonKosu, seciliVaka)) return sonKosu;
    if (sonKosu && !seciliVaka && (!seciliVakaId || seciliVakaId === sonKosuVakaId)) return sonKosu;
    return undefined;
  }, [sonKosu, seciliVaka, seciliVakaId, sonKosuVakaId]);
  const panelGoster = !panelKapali && (!!panelKosu || !!seciliVaka);
  const seciliVakaCalisiyor = !!seciliVaka && seciliVaka.adimlar.some((a) => a.tip === 'is' && (a.durum === 'running' || a.durum === 'pending'));
  useEffect(() => setPanelCalisiyor(seciliVakaCalisiyor), [seciliVakaCalisiyor]);

  const tazele = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ekip-akis'] });
    qc.invalidateQueries({ queryKey: ['ekip-kadro'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
    qc.invalidateQueries({ queryKey: ['ekip-onaylar'] });
  }, [qc]);
  const kuyrukTazele = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ekip-kuyruk'] });
    qc.invalidateQueries({ queryKey: ['ekip-rutinler'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
    qc.invalidateQueries({ queryKey: ['ekip-akis'] });
  }, [qc]);

  const kuyrukIslem = useCallback(
    async (id: string, tur: 'durdur' | 'devam') => {
      if (kuyrukMesgul) return;
      setKuyrukMesgul(true);
      try {
        const k = tur === 'durdur' ? await kuyrukDurdur(id) : await kuyrukDevam(id);
        toast.success(tur === 'durdur' ? 'Kuyruk durduruldu' : 'Kuyruk sürüyor', { description: k ? `${k.biten}/${k.toplam} · ${k.ad}` : undefined });
      } catch (e: any) {
        toast.error(tur === 'durdur' ? 'Kuyruk durdurulamadı' : 'Kuyruk devam ettirilemedi', { description: e?.response?.data?.message || e?.message });
      } finally {
        setKuyrukMesgul(false);
        kuyrukTazele();
      }
    },
    [kuyrukMesgul, kuyrukTazele],
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
      toast.success('Sabah özeti üretildi', { description: 'İş panelinde açıldı; WhatsApp gönderimi oradaki teyitle.' });
    } catch (e: any) {
      const zamanAsimi = isZamanAsimi(e);
      const hata = zamanAsimi ? 'Sürüyor — iş kayıtlarında görünecek' : e?.message || 'Sabah özeti üretilemedi';
      kosular.guncelle('koordinator', (k) => ({ ...k, bitti: true, hata, durationMs: Date.now() - basladi }));
      if (zamanAsimi) toast.info(hata);
      else toast.error(hata);
    } finally {
      setSabahUretiliyor(false);
      tazele();
    }
  }, [sabahUretiliyor, kosular, tazele]);

  const omurgaYok = isOmurgaYok(kadroS.error);
  const panelBaslik = seciliVaka?.mukellef?.ad || (panelKosu?.kaynak === 'sabahOzeti' ? 'Sabah özeti' : mukellefAd(panelKosu?.taxpayerId) || 'Ofis geneli');

  return (
    <div className="ekip-ofis">
      <UstSatir
        durum={durumS.data}
        kararSayisi={kararSayisi}
        bugun={bugun}
        donem={donemGosterge}
        onGorevVer={() => {
          setOdakNonce(Date.now());
          setTimeout(() => komutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 40);
        }}
        onSabahOzeti={() => void sabahOzetiUretSimdi()}
        sabahMesgul={sabahUretiliyor || (!!kosular.aktifKosu && kosular.aktifKosu.kaynak === 'sabahOzeti')}
      />

      {kosular.bekleyenCevap && !panelGoster && (
        <div role="status" className="of-uyari-satiri">
          <span className="min-w-0 flex-1">Cevabınız ilgili işin tamamlanmasını bekliyor.</span>
          <button type="button" className="of-dugme" data-tur="ikincil" onClick={() => isiAc(kosular.bekleyenCevap!.vakaId)}>
            İşi aç
          </button>
          <button type="button" className="of-dugme" data-tur="sade" onClick={() => kosular.setBekleyenCevap(null)}>
            Cevabı iptal et
          </button>
        </div>
      )}

      {omurgaYok && <OmurgaYokBilgi />}
      {!!kadroS.error && !omurgaYok && <div className="of-hata-kutu">Kadro alınamadı: {(kadroS.error as any)?.message || 'hata'}</div>}

      <div className="of-govde">
        <section className="of-kart of-bugun-kart" id="bugun" aria-label="Bugün">
          <GorevKutusu ref={komutRef} ajanlar={ajanlar} mukellefler={mukellefler} komutTaslak={komutTaslak} kosular={kosular} odakNonce={odakNonce} escNonce={escNonce} maxBagli={durumS.data?.maxBagli} />
          <Bugun
            kosu={sonKosu}
            vakalar={genelVakalar}
            bekleyenler={bekleyenler}
            onaylar={onaylar}
            kuyruklar={kuyruklar}
            rutinler={rutinler}
            ajanAd={ajanAd}
            mukellefAd={mukellefAd}
            onAc={isiAc}
            onIsAc={isiIsIdIleAc}
            onKuyrukDurdur={(id) => void kuyrukIslem(id, 'durdur')}
            onKuyrukDevam={(id) => void kuyrukIslem(id, 'devam')}
            kuyrukMesgul={kuyrukMesgul}
            onBitti={tazele}
            yukleniyor={genelS.isLoading && !genelS.data}
            hata={genelS.error}
          />
        </section>
        <Kadro ajanlar={ajanlar} kosular={kosular.kosular} vakalar={genelVakalar} mukellefAd={mukellefAd} yukleniyor={kadroS.isLoading} onGorevVer={taslakVer} onIsAc={isiAc} />
      </div>

      <Cekmece
        acik={panelGoster}
        genis
        baslik={panelBaslik}
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
            onTaslak={(t) => {
              setPanelKapali(true);
              taslakVer(t);
            }}
            onKapat={() => {
              setPanelKapali(true);
              if (panelKosu?.bitti) kosular.kaldir(panelKosu.ajanId);
            }}
          />
        )}
      </Cekmece>
    </div>
  );
}
