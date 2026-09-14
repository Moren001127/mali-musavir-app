'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueries, useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/PageHeader';
import { boyutParamOku, sayfaParamOku, type SayfaBoyutu } from '@/components/ui/Sayfalama';
import type { TaxpayerLite } from '@/components/ui/TaxpayerSelect';
import { api } from '@/lib/api';
import { SORGU_TURLERI, genelSorgularApi, sorguTuruMu, type SorguTuru } from '@/lib/genel-sorgular';
import { OzetSeridi } from './_components/OzetSeridi';
import { SonucGrubu } from './_components/SonucTablosu';
import { SuzgecBandi, type Suzgec } from './_components/SuzgecBandi';
import { buAy } from './_components/ortak';

/*
 * Genel Sorgulamalar (2026-09-14) — Dijital Vergi Dairesi sorgu sonuçları tek ekranda.
 * Süzgeç durumu adres çubuğunda: ?mukellef=<id>&tur=VERGI_BORCU,POS&donem=2026-09|tum&boyut=50&s_VERGI_BORCU=2
 * (her türün kendi sayfası var — tablolar tür başına ayrı istek atar).
 */

const VARSAYILAN_BOYUT: SayfaBoyutu = 50;

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
  const buAyDegeri = useMemo(() => buAy(), []);

  // ---- Adres çubuğundan süzgeç ----
  const suzgec: Suzgec = useMemo(() => {
    const turler = (searchParams.get('tur') || '').split(',').filter(sorguTuruMu);
    const donemHam = searchParams.get('donem');
    const donem = donemHam === 'tum' ? '' : donemHam && /^\d{4}-\d{2}$/.test(donemHam) ? donemHam : buAyDegeri;
    return { mukellefId: searchParams.get('mukellef') || '', turler: SORGU_TURLERI.filter((t) => turler.includes(t)), donem };
  }, [searchParams, buAyDegeri]);
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
      if (s.turler.length) q.set('tur', s.turler.join(',')); else q.delete('tur');
      if (s.donem === '') q.set('donem', 'tum'); else if (s.donem !== buAyDegeri) q.set('donem', s.donem); else q.delete('donem');
      // Süzgeç değişince tüm türler 1. sayfaya döner.
      SORGU_TURLERI.forEach((t) => q.delete(`s_${t}`));
    });
  const turDegistir = (t: SorguTuru) => {
    const set = new Set(suzgec.turler);
    if (set.has(t)) set.delete(t); else set.add(t);
    suzgecYaz({ ...suzgec, turler: SORGU_TURLERI.filter((x) => set.has(x)) });
  };
  const sayfaYaz = (t: SorguTuru, n: number) => adresYaz((q) => { if (n > 1) q.set(`s_${t}`, String(n)); else q.delete(`s_${t}`); });
  const boyutYaz = (b: SayfaBoyutu) =>
    adresYaz((q) => {
      if (b !== VARSAYILAN_BOYUT) q.set('boyut', String(b)); else q.delete('boyut');
      SORGU_TURLERI.forEach((t) => q.delete(`s_${t}`));
    });

  // ---- Veri ----
  const { data: mukellefler = [] } = useQuery({
    queryKey: ['taxpayers', 'genel-sorgular'],
    queryFn: () => api.get('/taxpayers').then((r) => (Array.isArray(r.data) ? (r.data as TaxpayerLite[]) : [])),
    staleTime: 5 * 60_000,
  });

  const { data: ozet, isLoading: ozetYukleniyor } = useQuery({
    queryKey: ['genel-sorgular', 'ozet'],
    queryFn: genelSorgularApi.ozet,
    refetchInterval: 60_000,
  });

  const gosterilenTurler = suzgec.turler.length ? suzgec.turler : [...SORGU_TURLERI];
  const sorgular = useQueries({
    queries: gosterilenTurler.map((t) => ({
      queryKey: ['genel-sorgular', 'liste', t, suzgec.mukellefId, suzgec.donem, sayfaOku(t), boyut],
      queryFn: () => genelSorgularApi.liste({ taxpayerId: suzgec.mukellefId || undefined, tur: t, donem: suzgec.donem || undefined, page: sayfaOku(t), pageSize: boyut }),
      placeholderData: (onceki: Awaited<ReturnType<typeof genelSorgularApi.liste>> | undefined) => onceki,
    })),
  });

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="Genel Sorgulamalar"
        subtitle="Dijital Vergi Dairesi'nden mükellef başına yapılan sorguların sonuçları — vergi borcu, e-haciz, yoklama/denetim, POS, gelen e-arşiv."
      />

      <SuzgecBandi suzgec={suzgec} onSuzgec={suzgecYaz} mukellefler={mukellefler} buAy={buAyDegeri} />

      <OzetSeridi ozet={ozet} seciliTurler={suzgec.turler} onTur={turDegistir} yukleniyor={ozetYukleniyor} />

      {gosterilenTurler.map((t, i) => {
        const q = sorgular[i];
        const hata = q.isError ? (q.error as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message || (q.error as Error)?.message || 'Bilinmeyen hata' : null;
        return (
          <SonucGrubu
            key={t}
            tur={t}
            rows={q.data?.rows ?? []}
            total={q.data?.total ?? 0}
            sayfa={sayfaOku(t)}
            sayfaBoyutu={boyut}
            onSayfa={(n) => sayfaYaz(t, n)}
            onSayfaBoyutu={boyutYaz}
            yukleniyor={q.isFetching}
            hata={hata}
          />
        );
      })}
    </div>
  );
}
