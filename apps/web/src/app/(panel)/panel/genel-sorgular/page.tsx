'use client';
import './genel-sorgular.css';

import { Suspense, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ScanSearch } from 'lucide-react';
import { toast } from 'sonner';
import { PdfOnizlemeModali, type PdfModalDurumu } from '@/components/portal-automation/belge-ortak';
import { boyutParamOku, sayfaParamOku, type SayfaBoyutu } from '@/components/ui/Sayfalama';
import { SORGU_TURLERI, genelSorgularApi, sorguMukellefAdi, sorguTuruMu, type SorguKosusu, type SorguTuru } from '@/lib/genel-sorgular';
import { AracCubugu, type Suzgec } from './_components/AracCubugu';
import { GuncelTablo } from './_components/GuncelTablo';
import { MukellefPanosu } from './_components/MukellefPanosu';
import { TurSekmeleri } from './_components/TurSekmeleri';
import { tarihKisa } from './_lib/bicim';

/*
 * 2026-09-25 YENİDEN DÜZEN (Muzaffer Bey: "tüm mükellefler tek tabloda görünmesin, karışık duruyor;
 * bazı tablolar da taşmış, sığmamış"). Ekran artık İKİ KATMANLI:
 *   1) MÜKELLEF PANOSU — mükellef ve tür seçili değilken. Her mükellef TEK satır, 5 sorgunun güncel özeti
 *      yan yana (borç · haciz · yoklama · POS · e-Arşiv). Uyarısı olan mükellef en üstte.
 *   2) AYRINTI TABLOLARI — pano satırına (ya da bir sorgu hücresine) tıklayınca, veya üstteki tür
 *      sekmesinden. Mükellef seçiliyken künye şeridi + "Mükellef Panosu" dönüş düğmesi çıkar.
 * Taşma: sayfa 1280 → 1560px; tablolardan "Son sorgu" sütunu kalktı (kart başlığında zaten yazıyor),
 * sütun genişlikleri gerçek en-az toplamına çekildi (bkz. GuncelTablo EN_AZ_GENISLIK).
 *
 * Önceki tur (2026-09-22, sade sürüm — Muzaffer Bey: "manuel sorgu için ufak bir ekran yeter";
 * akşam: "görsel olarak yeniden tasarla, profesyonel görüntü olsun").
 *   Başlık + gece sorgusu durum çipi · araç çubuğu (mükellef · dönem · Sorgula · durum satırı) · tür sekmeleri
 *   (Tümü + 5 tür, kayıt sayılı) · tür başına GÜNCEL DURUM tablosu (koşu geçmişi değil: borç mükellef başına,
 *   haciz bildiri başına, yoklama tutanak başına, POS ay+banka, e-Arşiv fatura başına).
 *   Gece sorgusu mükellef kartındaki Otomatik Sorgulama Ayarı'na göre çalışır; burada kurulum/koşu listesi YOK.
 * Adres çubuğu: ?mukellef=<id>&tur=VERGI_BORCU&donem=2026-09&boyut=50&s_VERGI_BORCU=2
 * Vurgu rengi KARAR: deniz yeşili (4 varyant görselinden 3; 2026-09-22) — CSS paydalarında sabit.
 */

const VARSAYILAN_BOYUT: SayfaBoyutu = 50;
/** Sayfalama gibi satır içi renk isteyen ortak bileşenler için vurgu (CSS --gs-vurgu ile aynı). */
const VURGU = '#0ca678';

export default function GenelSorgularPage() {
  // useSearchParams statik ön-derlemede Suspense sınırı ister (Next 15).
  return (
    <Suspense fallback={null}>
      <GenelSorgularIcerik />
    </Suspense>
  );
}

function GenelSorgularIcerik() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ---- Adres çubuğundan süzgeç ----
  const suzgec: Suzgec = useMemo(() => {
    const turHam = (searchParams.get('tur') || '').split(',').find(sorguTuruMu) || null;
    const donemHam = searchParams.get('donem') || '';
    return {
      mukellefId: searchParams.get('mukellef') || '',
      tur: turHam,
      donem: /^\d{4}-\d{2}$/.test(donemHam) ? donemHam : '',
    };
  }, [searchParams]);
  const boyut = boyutParamOku(searchParams.get('boyut'), VARSAYILAN_BOYUT);
  const sayfaOku = useCallback((t: SorguTuru) => sayfaParamOku(searchParams.get(`s_${t}`)), [searchParams]);

  const adresYaz = useCallback(
    (degistir: (q: URLSearchParams) => void) => {
      const q = new URLSearchParams(searchParams.toString());
      degistir(q);
      const hedef = q.toString() ? `${pathname}?${q.toString()}` : pathname;
      const simdiki = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;
      if (hedef !== simdiki) router.replace(hedef, { scroll: false });
    },
    [router, pathname, searchParams],
  );
  const suzgecYaz = (s: Suzgec) =>
    adresYaz((q) => {
      if (s.mukellefId) q.set('mukellef', s.mukellefId); else q.delete('mukellef');
      if (s.tur) q.set('tur', s.tur); else q.delete('tur');
      if (s.donem) q.set('donem', s.donem); else q.delete('donem');
      SORGU_TURLERI.forEach((t) => q.delete(`s_${t}`)); // süzgeç değişince 1. sayfa
      q.delete('s_PANO');
    });
  const sayfaYaz = (t: SorguTuru, n: number) => adresYaz((q) => { if (n > 1) q.set(`s_${t}`, String(n)); else q.delete(`s_${t}`); });
  const panoSayfaYaz = (n: number) => adresYaz((q) => { if (n > 1) q.set('s_PANO', String(n)); else q.delete('s_PANO'); });
  const boyutYaz = (b: SayfaBoyutu) =>
    adresYaz((q) => {
      if (b !== VARSAYILAN_BOYUT) q.set('boyut', String(b)); else q.delete('boyut');
      SORGU_TURLERI.forEach((t) => q.delete(`s_${t}`));
      q.delete('s_PANO');
    });

  // ---- Veri ----
  const { data: mukellefler = [] } = useQuery({ queryKey: ['taxpayers', 'genel-sorgular'], queryFn: genelSorgularApi.mukellefler, staleTime: 5 * 60_000 });
  // Gece sorgusu tek satır notu: en son gece koşusu (kaç mükellef, kaç hata).
  const { data: sonKosular = [] } = useQuery({ queryKey: ['genel-sorgular', 'kosular'], queryFn: () => genelSorgularApi.kosular(50), staleTime: 60_000, retry: false });
  const gece = useMemo(() => geceOzeti(sonKosular), [sonKosular]);

  const gosterilenTurler = suzgec.tur ? [suzgec.tur] : [...SORGU_TURLERI];
  /** Ne mükellef ne tür seçiliyse ekranın ana görünümü MÜKELLEF PANOSU'dur (tür tabloları değil). */
  const panoGorunsun = !suzgec.mukellefId && !suzgec.tur;

  // Yoklama tutanağı PDF'i — sayfa içi pencere (e-Tebligat kalıbı).
  const [pdf, setPdf] = useState<PdfModalDurumu>(null);
  const tutanakAc = async (documentId: string, baslik: string) => {
    try {
      const { url } = await genelSorgularApi.tutanakAdresi(documentId);
      if (!url) throw new Error('Belge adresi alınamadı');
      setPdf({ url, title: baslik });
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      toast.error(err?.response?.data?.message || err?.message || 'Tutanak açılamadı');
    }
  };

  const seciliMukellef = useMemo(() => mukellefler.find((m) => m.id === suzgec.mukellefId) || null, [mukellefler, suzgec.mukellefId]);

  return (
    <div className="gs mx-auto w-full max-w-[1560px]" data-gs-kok>
      <div className="gs-baslik">
        <span className="gs-baslik-simge"><ScanSearch size={18} /></span>
        <div className="min-w-0">
          <h1 className="gs-h1">Genel Sorgulamalar</h1>
          <p className="gs-alt">Dijital Vergi Dairesi güncel durumu: vergi borcu, e-haciz, yoklama / denetim, POS ve gelen e-arşiv. Gece sorgusu mükellef kartındaki Otomatik Sorgulama Ayarı'na göre çalışır.</p>
        </div>
        <span className="gs-gece" title="Son gece koşusu">
          <span className="gs-nokta" data-ton={gece ? (gece.hata ? 'uyari' : 'tamam') : undefined} aria-hidden />
          {gece ? <>Gece sorgusu <b>{gece.tarih}</b> · <b>{gece.mukellef}</b> mükellef · <b>{gece.hata}</b> hata</> : 'Gece sorgusu henüz koşmadı'}
        </span>
      </div>

      <AracCubugu suzgec={suzgec} onSuzgec={suzgecYaz} mukellefler={mukellefler} />

      {/* Mükellef seçiliyken: panoya dönüş + kimin ekranında olduğumuzu söyleyen künye şeridi */}
      {suzgec.mukellefId && (
        <div className="gs-kunye">
          <button type="button" className="gs-geri" onClick={() => suzgecYaz({ ...suzgec, mukellefId: '', tur: null })}>
            <ArrowLeft size={14} strokeWidth={2.2} aria-hidden />
            Mükellef Panosu
          </button>
          <span className="gs-kunye-ad">{sorguMukellefAdi(seciliMukellef) || 'Seçili mükellef'}</span>
          {seciliMukellef?.taxNumber && <span className="gs-kunye-vkn gs-sayi">{seciliMukellef.taxNumber}</span>}
          <Link href={`/panel/mukellefler/${suzgec.mukellefId}`} className="gs-baglanti gs-kunye-kart">Mükellef kartı</Link>
        </div>
      )}

      <TurSekmeleri
        secili={suzgec.tur}
        onSec={(t) => suzgecYaz({ ...suzgec, tur: t })}
        suzgec={{ taxpayerId: suzgec.mukellefId || undefined, donem: suzgec.donem || undefined }}
        ilkSekme={suzgec.mukellefId ? 'Tümü' : 'Mükellef Panosu'}
      />

      {panoGorunsun ? (
        <MukellefPanosu
          donem={suzgec.donem}
          sayfa={sayfaParamOku(searchParams.get('s_PANO'))}
          sayfaBoyutu={boyut}
          onSayfa={panoSayfaYaz}
          onSayfaBoyutu={boyutYaz}
          onAc={(id, tur) => suzgecYaz({ ...suzgec, mukellefId: id, tur: tur ?? null })}
          vurgu={VURGU}
        />
      ) : (
        <div className="gs-gruplar">
          {gosterilenTurler.map((t) => (
            <GuncelTablo
              key={t}
              tur={t}
              suzgec={{ taxpayerId: suzgec.mukellefId || undefined, donem: suzgec.donem || undefined }}
              sayfa={sayfaOku(t)}
              sayfaBoyutu={boyut}
              onSayfa={(n) => sayfaYaz(t, n)}
              onSayfaBoyutu={boyutYaz}
              vurgu={VURGU}
              onTutanak={tutanakAc}
            />
          ))}
        </div>
      )}

      <PdfOnizlemeModali modal={pdf} onClose={() => setPdf(null)} />
    </div>
  );
}

/** En son gece (source=nightly) koşusu: tarih, mükellef sayısı, hata sayısı. */
function geceOzeti(kosular: SorguKosusu[]): { tarih: string; mukellef: number; hata: number } | null {
  const gece = kosular.filter((k) => k.source === 'nightly');
  if (gece.length === 0) return null;
  const sonGun = tarihKisa(gece[0].createdAt);
  const sonGece = gece.filter((k) => tarihKisa(k.createdAt) === sonGun);
  return {
    tarih: sonGun,
    mukellef: new Set(sonGece.map((k) => k.taxpayerId || k.id)).size,
    hata: sonGece.filter((k) => k.status === 'failed' || (k.result?.sorguHatalari?.length ?? 0) > 0).length,
  };
}

