'use client';
import './genel-sorgular.css';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ScanSearch } from 'lucide-react';
import { toast } from 'sonner';
import { PdfOnizlemeModali, type PdfModalDurumu } from '@/components/portal-automation/belge-ortak';
import { boyutParamOku, sayfaParamOku, type SayfaBoyutu } from '@/components/ui/Sayfalama';
import { SORGU_TURLERI, genelSorgularApi, sorguTuruMu, type SorguKosusu, type SorguTuru } from '@/lib/genel-sorgular';
import { AracCubugu, type Suzgec } from './_components/AracCubugu';
import { GuncelTablo } from './_components/GuncelTablo';
import { tarihKisa } from './_lib/bicim';

/*
 * Genel Sorgulamalar (2026-09-22, sade sürüm — Muzaffer Bey: "manuel sorgu için ufak bir ekran yeter").
 *   Başlık + gece sorgusu tek satır not · tek araç çubuğu (mükellef · tür · dönem · Sorgula) · tür başına GÜNCEL DURUM tablosu
 *   (koşu geçmişi değil: borç mükellef başına, haciz bildiri başına, yoklama tutanak başına, POS ay+banka, e-Arşiv fatura başına).
 *   Gece sorgusu mükellef kartındaki Otomatik Sorgulama Ayarı'na göre çalışır; burada kurulum/koşu listesi YOK.
 * Adres çubuğu: ?mukellef=<id>&tur=VERGI_BORCU&donem=2026-09&boyut=50&s_VERGI_BORCU=2&renk=1..4
 * (renk = Muzaffer Bey'in seçeceği vurgu varyantı; karar sonrası sabitlenir.)
 */

const VARSAYILAN_BOYUT: SayfaBoyutu = 50;
const RENK_VURGU: Record<string, string> = { '1': '#4263eb', '2': '#5c6b7f', '3': '#0ca678', '4': '#1971c2' };

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
  const renk = RENK_VURGU[searchParams.get('renk') || ''] ? (searchParams.get('renk') as string) : '1';
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
    });
  const sayfaYaz = (t: SorguTuru, n: number) => adresYaz((q) => { if (n > 1) q.set(`s_${t}`, String(n)); else q.delete(`s_${t}`); });
  const boyutYaz = (b: SayfaBoyutu) =>
    adresYaz((q) => {
      if (b !== VARSAYILAN_BOYUT) q.set('boyut', String(b)); else q.delete('boyut');
      SORGU_TURLERI.forEach((t) => q.delete(`s_${t}`));
    });

  // ---- Veri ----
  const { data: mukellefler = [] } = useQuery({ queryKey: ['taxpayers', 'genel-sorgular'], queryFn: genelSorgularApi.mukellefler, staleTime: 5 * 60_000 });
  // Gece sorgusu tek satır notu: en son gece koşusu (kaç mükellef, kaç hata).
  const { data: sonKosular = [] } = useQuery({ queryKey: ['genel-sorgular', 'kosular'], queryFn: () => genelSorgularApi.kosular(50), staleTime: 60_000, retry: false });
  const gece = useMemo(() => geceOzeti(sonKosular), [sonKosular]);

  const gosterilenTurler = suzgec.tur ? [suzgec.tur] : [...SORGU_TURLERI];

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

  return (
    <div className="gs mx-auto w-full max-w-[1280px]" data-renk={renk} data-gs-kok>
      <div className="gs-baslik">
        <span className="gs-baslik-simge"><ScanSearch size={18} /></span>
        <div className="min-w-0">
          <h1 className="gs-h1">Genel Sorgulamalar</h1>
          <p className="gs-alt">Dijital Vergi Dairesi sorgu sonuçları — vergi borcu, e-haciz, yoklama / denetim, POS, gelen e-arşiv. Gece sorgusu mükellef kartındaki Otomatik Sorgulama Ayarı'na göre çalışır.</p>
        </div>
        <span className="gs-gece" title="Son gece koşusu">
          {gece ? <>Gece sorgusu <b>{gece.tarih}</b> · <b>{gece.mukellef}</b> mükellef · <b>{gece.hata}</b> hata</> : 'Gece sorgusu henüz koşmadı'}
        </span>
      </div>

      <AracCubugu suzgec={suzgec} onSuzgec={suzgecYaz} mukellefler={mukellefler} />

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
            vurgu={RENK_VURGU[renk]}
            onTutanak={tutanakAc}
          />
        ))}
      </div>

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

