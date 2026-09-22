'use client';
import './genel-sorgular.css';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScanSearch } from 'lucide-react';
import { toast } from 'sonner';
import { PdfOnizlemeModali, type PdfModalDurumu } from '@/components/portal-automation/belge-ortak';
import { boyutParamOku, sayfaParamOku, type SayfaBoyutu } from '@/components/ui/Sayfalama';
import { SORGU_TURLERI, genelSorgularApi, sorguTuruMu, type SorguKosusu, type SorguTuru } from '@/lib/genel-sorgular';
import { KosuSeridi } from './_components/KosuSeridi';
import { SonucSuzgeci, OzetSatiri, type Suzgec } from './_components/SonucSuzgeci';
import { SonucGrubu } from './_components/SonucTablosu';
import { SorguKurulumu } from './_components/SorguKurulumu';

/*
 * Genel Sorgulamalar (2026-09-22 baştan tasarım) — Hattat "Vergi Dairesi Sorgulamaları" düzeni:
 *   1) Sorgu Kurulumu: mükellef çoklu seçici + sorgu türü onay kutuları + Sorgula (POST /portal-automation/dvd-sorgu)
 *      altında koşu şeridi (GET /portal-automation/jobs, 5 sn) ve son gece koşusu özeti
 *   2) Sorgu Sonuçları: süzgeç (mükellef · tür · dönem) + tek satır özet + tür başına kenarlıklı tablo (+ Excel)
 * Adres çubuğu: ?mukellef=<id>&tur=VERGI_BORCU&donem=2026-09&boyut=50&s_VERGI_BORCU=2&renk=1..4
 * (renk = Muzaffer Bey'in seçeceği vurgu varyantı; yalnız okunur, karar sonrası sabitlenir.)
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
  const qc = useQueryClient();

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
  const { data: sifreliler = null } = useQuery({ queryKey: ['genel-sorgular', 'dvd-sifreler'], queryFn: genelSorgularApi.dvdSifreliMukellefler, staleTime: 5 * 60_000, retry: false });
  const { data: ozet, isLoading: ozetYukleniyor } = useQuery({ queryKey: ['genel-sorgular', 'ozet'], queryFn: genelSorgularApi.ozet, refetchInterval: 60_000 });

  // Koşular: sürmekte olan iş varsa 5 sn, yoksa 30 sn; iş bitince sonuç tabloları yenilenir.
  const kosuSorgusu = useQuery({
    queryKey: ['genel-sorgular', 'kosular'],
    queryFn: () => genelSorgularApi.kosular(50),
    refetchInterval: (q) => ((q.state.data || []).some((k) => k.status === 'pending' || k.status === 'running') ? 5_000 : 30_000),
    retry: false,
  });
  const kosular: SorguKosusu[] = kosuSorgusu.data || [];
  const oncekiDurumlar = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!kosuSorgusu.data) return;
    let biten = 0;
    const yeni = new Map<string, string>();
    for (const k of kosuSorgusu.data) {
      yeni.set(k.id, k.status);
      const onceki = oncekiDurumlar.current.get(k.id);
      if (onceki && (onceki === 'pending' || onceki === 'running') && (k.status === 'done' || k.status === 'failed')) biten++;
    }
    oncekiDurumlar.current = yeni;
    if (biten > 0) {
      qc.invalidateQueries({ queryKey: ['genel-sorgular', 'liste'] });
      qc.invalidateQueries({ queryKey: ['genel-sorgular', 'ozet'] });
      toast.success(`${biten} sorgu koşusu bitti; sonuç tabloları yenilendi.`);
    }
  }, [kosuSorgusu.data, qc]);

  // Süren işlerin geçen süresi için saniyelik saat (yalnız tarayıcıda).
  const [simdi, setSimdi] = useState(0);
  const aktifIsVar = kosular.some((k) => k.status === 'pending' || k.status === 'running');
  useEffect(() => {
    setSimdi(Date.now());
    if (!aktifIsVar) return;
    const t = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(t);
  }, [aktifIsVar]);

  const gosterilenTurler = suzgec.tur ? [suzgec.tur] : [...SORGU_TURLERI];
  const sorgular = useQueries({
    queries: gosterilenTurler.map((t) => ({
      queryKey: ['genel-sorgular', 'liste', t, suzgec.mukellefId, suzgec.donem, sayfaOku(t), boyut],
      queryFn: () => genelSorgularApi.liste({ taxpayerId: suzgec.mukellefId || undefined, tur: t, donem: suzgec.donem || undefined, page: sayfaOku(t), pageSize: boyut }),
      placeholderData: (onceki: Awaited<ReturnType<typeof genelSorgularApi.liste>> | undefined) => onceki,
    })),
  });

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
          <p className="gs-alt">Vergi Dairesi sorgulamaları — mükellef başına Dijital Vergi Dairesi'nden vergi borcu, e-haciz, yoklama / denetim, POS, gelen e-arşiv ve e-Defter sorguları; elle ya da her gece.</p>
        </div>
      </div>

      <section className="gs-kart" data-gs-kart="kurulum">
        <div className="gs-kart-bas">
          <h2 className="gs-kart-adi">Sorgu Kurulumu</h2>
          <p className="gs-kart-aciklama">Mükellefleri ve sorgu türlerini seçin; her mükellef için Dijital Vergi Dairesi'ne tek oturumla girilir.</p>
        </div>
        <SorguKurulumu mukellefler={mukellefler} sifreliler={sifreliler} onKuyruk={() => { void kosuSorgusu.refetch(); }} />
        <div className="gs-kart-govde" style={{ paddingTop: 0 }}>
          <KosuSeridi kosular={kosular} yukleniyor={kosuSorgusu.isLoading} hata={kosuSorgusu.isError ? hataMetni(kosuSorgusu.error) : null} simdi={simdi} />
        </div>
      </section>

      <section className="gs-kart" data-gs-kart="sonuclar">
        <div className="gs-kart-bas">
          <h2 className="gs-kart-adi">Sorgu Sonuçları</h2>
          <div className="gs-kart-sag">
            <SonucSuzgeci suzgec={suzgec} onSuzgec={suzgecYaz} mukellefler={mukellefler} />
          </div>
        </div>
        <OzetSatiri ozet={ozet} yukleniyor={ozetYukleniyor} />
        <div style={{ paddingTop: 16 }}>
          {gosterilenTurler.map((t, i) => {
            const q = sorgular[i];
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
                hata={q.isError ? hataMetni(q.error) : null}
                suzgec={{ taxpayerId: suzgec.mukellefId || undefined, donem: suzgec.donem || undefined }}
                vurgu={RENK_VURGU[renk]}
                onTutanak={tutanakAc}
              />
            );
          })}
        </div>
      </section>

      <PdfOnizlemeModali modal={pdf} onClose={() => setPdf(null)} />
    </div>
  );
}

function hataMetni(e: unknown): string {
  const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const m = err?.response?.data?.message;
  return (Array.isArray(m) ? m.join(', ') : m) || err?.message || 'Bilinmeyen hata';
}
