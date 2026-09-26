'use client';
import { portalStyle } from '@/lib/portal-theme';
import '../portal-automation-white.css';
import './sgk-rapor-white.css';

// SGK Otomasyonu › "Rapor · İş Kazası · Giriş-Çıkış" bölümü (2026-09-26).
// Tek ekran, yukarıdan aşağı: araç çubuğu (mükellef + Şimdi sorgula + tek satır durum) · 3 özet kartı (Hattat) ·
// rapor listesi (Onay bekleyen | Onaylanmış, mükellefe göre gruplu) · iş kazası hastane bildirimleri · işe giriş/çıkış.
// Veri: /sgk-vizite/* (sözleşme packages/shared/src/constants/sgk-vizite.ts).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ambulance, ArrowLeftRight, ClipboardList, Download, Loader2 } from 'lucide-react';
import type { SgkIsKazasiSatiri, SgkRaporSatiri, SgkViziteOzet } from '@mali-musavir/shared';
import { portalAutomationApi } from '@/lib/portal-automation';
import { sgkViziteAnahtar, sgkViziteApi, type SgkRaporListesi } from '@/lib/sgk-vizite';
import { MukellefSecici } from '../belge-ortak';
import {
  DurumSatiri, IkiliSecici, Kart, KartBasligi, SOLUK, bugunIso, gunSirasi, hataMetni, mukellefeGoreGrupla, zamanYaz,
} from './ortak';
import { OzetKartlari } from './OzetKartlari';
import { BekleyenTablosu, IsKazasiTablosu, OnaylananTablosu } from './RaporTablolari';
import { RaporOnayPenceresi } from './RaporOnayPenceresi';
import { PersonelimDegilPenceresi } from './PersonelimDegilPenceresi';
import { SorguHatalariPenceresi, SorguOnayPenceresi } from './SorguPencereleri';

// Bildirgeler sekmesiyle aynı mükellef listesi (aynı sorgu anahtarı → ortak önbellek).
const SGK_BELGE = 'SGK_TAHAKKUK,SGK_HIZMET_LISTESI';
const SURUYOR_ARALIK = 5_000;

// Tek satır durum: sorgu sürüyorsa ilerleme; değilse son sorgu — gece ya da elle, en yenisi (hata varsa tıklanır).
function SorguDurumu({ ozet, onHata }: { ozet: SgkViziteOzet | undefined; onHata: () => void }) {
  if (!ozet) return null;
  if (ozet.sorgu?.suruyor) {
    return (
      <span data-sr-suruyor className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold tabular-nums" style={portalStyle({ color: '#d4b876' })}>
        <Loader2 size={13} className="animate-spin" /> Sorgu sürüyor: {ozet.sorgu.biten}/{ozet.sorgu.toplam}
      </span>
    );
  }
  const g = ozet.sonGeceSorgusu;
  if (!g || !g.tarih) return null;
  return (
    <span data-sr-durum className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] tabular-nums" style={portalStyle({ color: SOLUK })}>
      <span>Son sorgu {zamanYaz(g.tarih)}</span>
      <span aria-hidden>·</span>
      <span>{g.mukellefSayisi} mükellef</span>
      <span aria-hidden>·</span>
      {g.hataSayisi > 0 ? (
        <button type="button" onClick={onHata} data-sr-hata-link title="Ayrıntı için tıklayın"
          className="rounded-md border px-2 py-[1px] font-semibold transition hover:brightness-125"
          style={portalStyle({ background: 'rgba(226,112,111,0.12)', borderColor: 'rgba(226,112,111,0.4)', color: '#e2706f' })}>
          {g.hataSayisi} mükellefte sorgu yapılamadı
        </button>
      ) : (
        <span>hata yok</span>
      )}
    </span>
  );
}

export default function SgkRaporBolumu() {
  const qc = useQueryClient();
  const [taxpayerId, setTaxpayerId] = useState('');
  const [liste, setListe] = useState<SgkRaporListesi>('bekleyen');
  const [onayRapor, setOnayRapor] = useState<SgkRaporSatiri | null>(null);
  const [personelRapor, setPersonelRapor] = useState<SgkRaporSatiri | null>(null);
  const [hataAcik, setHataAcik] = useState(false);
  const [sorguOnayAcik, setSorguOnayAcik] = useState(false);
  const raporKartRef = useRef<HTMLDivElement>(null);
  const kazaKartRef = useRef<HTMLDivElement>(null);

  // ── Veri ──
  const ozetQ = useQuery({
    queryKey: sgkViziteAnahtar.ozet(taxpayerId),
    queryFn: () => sgkViziteApi.ozet(taxpayerId || undefined),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.sorgu?.suruyor ? SURUYOR_ARALIK : 60_000),
  });
  const ozet = ozetQ.data;
  const suruyor = !!ozet?.sorgu?.suruyor;
  const listeAraligi = suruyor ? SURUYOR_ARALIK : false;

  // Onay bekleyenler tüm mükellefler için tek seferde gelir (mükellef seçicideki sayılar buradan); süzme istemcide.
  const bekleyenQ = useQuery({
    queryKey: sgkViziteAnahtar.raporlar('bekleyen', ''),
    queryFn: () => sgkViziteApi.raporlar('bekleyen'),
    refetchInterval: listeAraligi,
  });
  const onaylananQ = useQuery({
    queryKey: sgkViziteAnahtar.raporlar('onaylanan', taxpayerId),
    queryFn: () => sgkViziteApi.raporlar('onaylanan', taxpayerId || undefined),
    enabled: liste === 'onaylanan',
    placeholderData: keepPreviousData,
    refetchInterval: listeAraligi,
  });
  const kazaQ = useQuery({
    queryKey: sgkViziteAnahtar.isKazalari(taxpayerId),
    queryFn: () => sgkViziteApi.isKazalari(taxpayerId || undefined),
    placeholderData: keepPreviousData,
    refetchInterval: listeAraligi,
  });
  const mukellefQ = useQuery({
    queryKey: ['sgk-mukellefler'],
    queryFn: () => portalAutomationApi.documentsMukellefler({ belgeTuru: SGK_BELGE }),
    staleTime: 5 * 60_000,
  });

  // Sorgu bitince (sürüyor → bitti) her şeyi bir kez tazele.
  const oncekiSuruyor = useRef(suruyor);
  useEffect(() => {
    if (oncekiSuruyor.current && !suruyor) qc.invalidateQueries({ queryKey: sgkViziteAnahtar.hepsi });
    oncekiSuruyor.current = suruyor;
  }, [suruyor, qc]);

  const yenile = useCallback(() => {
    qc.invalidateQueries({ queryKey: sgkViziteAnahtar.hepsi });
  }, [qc]);

  // ── Türetilen ──
  const bekleyenTum = useMemo(() => bekleyenQ.data?.satirlar ?? [], [bekleyenQ.data]);
  const bekleyenGruplar = useMemo(
    () => mukellefeGoreGrupla(taxpayerId ? bekleyenTum.filter((r) => r.taxpayerId === taxpayerId) : bekleyenTum, (a, b) => gunSirasi(a.raporBaslangic, b.raporBaslangic)),
    [bekleyenTum, taxpayerId],
  );
  const onaylananGruplar = useMemo(
    () => mukellefeGoreGrupla<SgkRaporSatiri>(onaylananQ.data?.satirlar ?? [], (a, b) => gunSirasi(b.raporBaslangic, a.raporBaslangic)),
    [onaylananQ.data],
  );
  const kazaGruplar = useMemo(
    () => mukellefeGoreGrupla<SgkIsKazasiSatiri>(kazaQ.data?.satirlar ?? [], (a, b) => gunSirasi(b.isKazasiTarihi, a.isKazasiTarihi)),
    [kazaQ.data],
  );
  // Mükellef seçicide parantez içi sayı = o mükellefin onay bekleyen raporu (liste gelene kadar seçici "yükleniyor").
  const seciciSatirlari = useMemo(() => {
    if (!mukellefQ.data || bekleyenQ.isLoading) return [];
    const sayac = new Map<string, number>();
    for (const r of bekleyenTum) sayac.set(r.taxpayerId, (sayac.get(r.taxpayerId) || 0) + 1);
    return mukellefQ.data.rows.map((m) => ({ ...m, belgeSayisi: sayac.get(m.id) || 0 }));
  }, [bekleyenQ.isLoading, mukellefQ.data, bekleyenTum]);
  const bugun = bugunIso();

  // ── Sorgu ──
  const sorgulaMut = useMutation({
    mutationFn: (ids: string[] | undefined) => sgkViziteApi.sorgula(ids),
    onSuccess: (d) => {
      if (d.baslatildi) toast.success(d.mesaj || `${d.mukellefSayisi} mükellef için sorgu başlatıldı.`);
      else toast.info(d.mesaj || 'Sorgu başlatılamadı.');
      qc.invalidateQueries({ queryKey: sgkViziteAnahtar.ozetKok });
    },
    onError: (e) => toast.error(hataMetni(e, 'Sorgu başlatılamadı')),
  });
  const sorgula = () => {
    if (taxpayerId) sorgulaMut.mutate([taxpayerId]);
    else setSorguOnayAcik(true);
  };

  const onayKapat = useCallback(() => setOnayRapor(null), []);
  const personelKapat = useCallback(() => setPersonelRapor(null), []);
  const git = (ref: React.RefObject<HTMLDivElement>) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // "Onay bekleyen / Onaylanmış" sayıları özetten; özet yoksa listeden; ikisi de yoksa sayı yazılmaz (bilinmeyen "0" değildir).
  const bekleyenSayisi = ozet?.onayBekleyen ?? (bekleyenQ.data ? bekleyenGruplar.reduce((t, g) => t + g.satirlar.length, 0) : null);
  const onaylananSayisi = ozet?.onaylanan ?? onaylananQ.data?.satirlar.length ?? null;
  const sayili = (ad: string, n: number | null) => (n === null ? ad : `${ad} (${n})`);
  const listeQ = liste === 'bekleyen' ? bekleyenQ : onaylananQ;
  const listeGruplar = liste === 'bekleyen' ? bekleyenGruplar : onaylananGruplar;

  return (
    <div data-pa-module="sgk-rapor" data-sr-bolum className="space-y-4">
      {/* ── Araç çubuğu: mükellef · durum · Şimdi sorgula ── */}
      <div data-pa-toolbar data-sr-arac className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl border px-4 py-3"
        style={portalStyle({ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' })}>
        <MukellefSecici
          value={taxpayerId}
          onChange={setTaxpayerId}
          rows={seciciSatirlari}
          yukleniyor={mukellefQ.isLoading || bekleyenQ.isLoading}
          className="w-[300px] max-w-full"
        />
        <SorguDurumu ozet={ozet} onHata={() => setHataAcik(true)} />
        <button
          type="button"
          onClick={sorgula}
          disabled={sorgulaMut.isPending || suruyor}
          title={suruyor ? 'Sorgu sürüyor' : taxpayerId ? 'Bu mükellefin raporlarını ve iş kazası bildirimlerini SGK\'dan çek' : 'SGK şifresi olan tüm mükellefleri sorgula'}
          data-pa-btn="birincil"
          className="ml-auto flex h-9 items-center gap-2 rounded-[10px] px-3.5 text-[12.5px] font-bold transition hover:brightness-110 disabled:opacity-50"
          style={portalStyle({ background: 'linear-gradient(135deg, #d4b876, #b8a06f)', color: '#1a1410' })}
        >
          {sorgulaMut.isPending || suruyor ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {taxpayerId ? 'Bu mükellefi sorgula' : 'Şimdi sorgula'}
        </button>
      </div>

      {/* ── Özet kartları (Hattat üst sırası) ── */}
      <OzetKartlari ozet={ozet} onRaporaGit={() => git(raporKartRef)} onKazayaGit={() => git(kazaKartRef)} />

      {/* ── Rapor listesi ── */}
      <Kart ref={raporKartRef} tur="rapor">
        <KartBasligi
          ton="mavi"
          ikon={<ClipboardList size={16} />}
          baslik="Rapor Listesi"
          sag={
            <IkiliSecici<SgkRaporListesi>
              etiket="Rapor listesi"
              deger={liste}
              onSec={setListe}
              secenekler={[
                { deger: 'bekleyen', ad: sayili('Onay bekleyen', bekleyenSayisi) },
                { deger: 'onaylanan', ad: sayili('Onaylanmış', onaylananSayisi) },
              ]}
            />
          }
        />
        {listeQ.isLoading ? (
          <DurumSatiri>Yükleniyor…</DurumSatiri>
        ) : listeQ.isError && !listeQ.data ? (
          <DurumSatiri ton="hata">Liste alınamadı. Sayfayı yenileyip tekrar deneyin.</DurumSatiri>
        ) : listeGruplar.length === 0 ? (
          <DurumSatiri>
            {liste === 'bekleyen'
              ? (taxpayerId ? 'Bu mükellefte onay bekleyen rapor yok.' : 'Onay bekleyen rapor yok.')
              : (taxpayerId ? 'Bu mükellefte son 180 günde onaylanmış rapor yok.' : 'Son 180 günde onaylanmış rapor yok.')}
          </DurumSatiri>
        ) : liste === 'bekleyen' ? (
          <BekleyenTablosu gruplar={bekleyenGruplar} onOnayla={setOnayRapor} onPersonelDegil={setPersonelRapor} />
        ) : (
          <OnaylananTablosu gruplar={onaylananGruplar} soluk={onaylananQ.isPlaceholderData} />
        )}
      </Kart>

      {/* ── İş kazası — hastane bildirimleri ── */}
      <Kart ref={kazaKartRef} tur="kaza">
        <KartBasligi
          ton={ozet && ozet.isKazasi > 0 ? 'kirmizi' : 'notr'}
          ikon={<Ambulance size={16} />}
          baslik="İş Kazası — Hastane Bildirimleri"
        />
        {kazaQ.isLoading ? (
          <DurumSatiri>Yükleniyor…</DurumSatiri>
        ) : kazaQ.isError && !kazaQ.data ? (
          <DurumSatiri ton="hata">Liste alınamadı. Sayfayı yenileyip tekrar deneyin.</DurumSatiri>
        ) : kazaGruplar.length === 0 ? (
          <DurumSatiri>Son 90 günde hastane iş kazası bildirimi yok.</DurumSatiri>
        ) : (
          <IsKazasiTablosu gruplar={kazaGruplar} bugun={bugun} soluk={kazaQ.isPlaceholderData} />
        )}
      </Kart>

      {/* ── İşe giriş / işten çıkış (ikinci aşama) ── */}
      <Kart tur="giris-cikis">
        <KartBasligi ton="notr" ikon={<ArrowLeftRight size={16} />} baslik="İşe Giriş / İşten Çıkış" />
        <DurumSatiri>İkinci aşamada bağlanacak — SGK&apos;nın işe giriş/çıkış ekranı incelendikten sonra bu tabloya düşecek.</DurumSatiri>
      </Kart>

      {/* ── Pencereler ── */}
      <RaporOnayPenceresi key={`onay-${onayRapor?.id ?? 'yok'}`} rapor={onayRapor} onKapat={onayKapat} onIslendi={yenile} />
      <PersonelimDegilPenceresi key={`personel-${personelRapor?.id ?? 'yok'}`} rapor={personelRapor} onKapat={personelKapat} onIslendi={yenile} />
      <SorguHatalariPenceresi acik={hataAcik} onKapat={() => setHataAcik(false)} />
      <SorguOnayPenceresi
        acik={sorguOnayAcik}
        mukellefSayisi={ozet ? ozet.sgkSifreliMukellef : null}
        onKapat={() => setSorguOnayAcik(false)}
        onOnay={() => { setSorguOnayAcik(false); sorgulaMut.mutate(undefined); }}
      />
    </div>
  );
}
