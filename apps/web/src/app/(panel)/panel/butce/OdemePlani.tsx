'use client';

import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Target, TrendingDown, AlertTriangle, Calculator, Trophy, CalendarCheck,
} from 'lucide-react';
import { butceApi, Strateji, para, donemTR } from '@/lib/butce';
import {
  Kutu, KPI, Dugme, Girdi, Alan, Bos, Rozet, Yukleniyor,
  GOLD, OK, KIRMIZI, TURUNCU, MAVI, MOR, MUTED, TEXT, ROW_SEP,
} from './ui';
import AiKutu from './AiKutu';

export default function OdemePlani({ donem }: { donem: string }) {
  const [kapasite, setKapasite] = useState<string>('');
  const [strateji, setStrateji] = useState<Strateji | undefined>(undefined);
  const [ekstra, setEkstra] = useState('');

  const { data: plan, isLoading } = useQuery({
    queryKey: ['butce-plan', donem, kapasite, strateji],
    queryFn: () =>
      butceApi.plan({
        donem,
        kapasite: kapasite === '' ? undefined : Number(kapasite.replace(',', '.')),
        strateji,
      }),
  });

  const faydaSorgu = useMutation({ mutationFn: (t: number) => butceApi.fayda(t) });

  const aiSorgu = useQuery({
    queryKey: ['butce-ai-plan'],
    queryFn: () => butceApi.aiPlan(false),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const aiYenile = useMutation({ mutationFn: () => butceApi.aiPlan(true), onSuccess: () => aiSorgu.refetch() });

  if (isLoading || !plan) return <Yukleniyor metin="Plan hesaplanıyor…" />;

  const s = plan.secilen;
  const k = plan.karsilastirma;
  const aktifStrateji = plan.strateji;

  return (
    <div className="space-y-4">
      {/* Kapasite ve strateji */}
      <Kutu
        baslik="Ödeme kapasitesi"
        aciklama="Bu ay borçlara ayırabileceğiniz para. Boş bırakırsanız gelir − gider − nakit yastığı olarak hesaplanır."
        sag={
          <div className="flex items-center gap-1.5">
            {(['CIG', 'KARTOPU'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStrateji(st)}
                className="rounded-lg px-2.5 py-1 text-[11px] transition"
                style={{
                  background: aktifStrateji === st ? `${GOLD}1f` : 'transparent',
                  border: `1px solid ${aktifStrateji === st ? `${GOLD}44` : 'transparent'}`,
                  color: aktifStrateji === st ? GOLD : MUTED,
                }}
              >
                {st === 'CIG' ? 'Çığ (en pahalı önce)' : 'Kartopu (en küçük önce)'}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Alan etiket="Aylık kapasite (₺)">
            <Girdi
              value={kapasite}
              onChange={(e) => setKapasite(e.target.value)}
              placeholder={String(plan.otomatikKapasite)}
              inputMode="decimal"
            />
          </Alan>
          <div className="sm:col-span-3 grid gap-3 sm:grid-cols-3">
            <KPI etiket="Gelir" deger={`${para(plan.gelir)} ₺`} renk={OK} />
            <KPI etiket="Gider (nakit)" deger={`${para(plan.gider)} ₺`} renk={KIRMIZI} />
            <KPI etiket="Borca ayrılan" deger={`${para(plan.kapasite)} ₺`} renk={GOLD} vurgu />
          </div>
        </div>
      </Kutu>

      {plan.kalemler.length === 0 ? (
        <Bos metin="Kayıtlı borç yok. Kart ve kredi ekledikçe plan burada oluşur." ikon={<Target size={18} />} />
      ) : (
        <>
          {/* Uyarılar */}
          {s.acik > 0 && (
            <div
              className="flex items-start gap-3 rounded-xl px-4 py-3"
              style={{ background: `${KIRMIZI}12`, border: `1px solid ${KIRMIZI}33` }}
            >
              <AlertTriangle size={16} style={{ color: KIRMIZI }} className="mt-0.5" />
              <div>
                <div className="text-[12.5px] font-semibold" style={{ color: KIRMIZI }}>
                  Aylık açık: {para(s.acik)} ₺
                </div>
                <div className="mt-0.5 text-[11.5px]" style={{ color: MUTED }}>
                  Kapasiteniz zorunlu ödemeleri (kart asgarileri + kredi taksitleri) karşılamıyor. Bu tutar kadar
                  ek gelir bulmak ya da gideri kısmak gerekiyor; aksi hâlde borç faizle büyür.
                </div>
              </div>
            </div>
          )}

          {/* Sonuç şeridi */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KPI
              etiket="Borçsuz kalma"
              deger={s.ayAdedi ? `${s.ayAdedi} ay` : 'Kapanmıyor'}
              renk={s.kapanmiyor ? KIRMIZI : OK}
              ikon={<CalendarCheck size={14} />}
              altBilgi={s.ayAdedi ? `Yaklaşık ${bitisAyi(s.ayAdedi)}` : 'Kapasite yetersiz'}
              vurgu
            />
            <KPI etiket="Toplam ödenecek faiz" deger={`${para(s.toplamFaiz)} ₺`} renk={TURUNCU} ikon={<TrendingDown size={14} />} />
            <KPI etiket="Toplam ödeme" deger={`${para(s.toplamOdeme)} ₺`} renk={MAVI} />
            <KPI
              etiket="Önerilen yöntem"
              deger={k.onerilen === 'CIG' ? 'Çığ' : 'Kartopu'}
              renk={GOLD}
              ikon={<Trophy size={14} />}
              altBilgi={
                k.faizFarki !== 0
                  ? `${para(Math.abs(k.faizFarki))} ₺ fark`
                  : 'İki yöntem eşit'
              }
            />
          </div>

          {/* Bu ay ne ödeyeceğim */}
          <Kutu
            baslik={`${donemTR(donem)} — bu ay hangi borca ne kadar`}
            aciklama="Zorunlu tutarlar önce ayrılır; artan para en fazla fayda sağlayan borca gider."
            renk={GOLD}
          >
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: MUTED }}>
                  <th className="pb-2 font-medium">Borç</th>
                  <th className="pb-2 text-right font-medium">Zorunlu</th>
                  <th className="pb-2 text-right font-medium">Ekstra</th>
                  <th className="pb-2 text-right font-medium">Toplam ödeme</th>
                  <th className="pb-2 text-right font-medium">Sonraki kalan</th>
                </tr>
              </thead>
              <tbody>
                {s.ilkAy.map((x) => (
                  <tr key={x.id} className="border-t" style={{ borderColor: ROW_SEP }}>
                    <td className="py-2" style={{ color: TEXT }}>
                      <span className="flex items-center gap-2">
                        {x.ad}
                        <Rozet metin={x.tip === 'KART' ? 'kart' : 'kredi'} renk={x.tip === 'KART' ? TURUNCU : MAVI} />
                        {x.ekstra > 0 && <Rozet metin="hedef" renk={GOLD} />}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums" style={{ color: MUTED }}>
                      {para(x.zorunlu)} ₺
                    </td>
                    <td className="py-2 text-right tabular-nums" style={{ color: x.ekstra > 0 ? GOLD : MUTED }}>
                      {para(x.ekstra)} ₺
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums" style={{ color: TEXT }}>
                      {para(x.toplam)} ₺
                    </td>
                    <td className="py-2 text-right tabular-nums" style={{ color: MUTED }}>
                      {para(x.kalanSonra)} ₺
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[10.5px]" style={{ color: 'rgba(113,113,122,0.85)' }}>
              {plan.not}
            </p>
          </Kutu>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* Strateji karşılaştırma */}
            <Kutu baslik="İki yöntemin karşılaştırması" aciklama="Aynı parayla farklı sıralama, farklı sonuç" renk={MOR}>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['CIG', 'KARTOPU'] as const).map((st) => {
                  const r = st === 'CIG' ? k.cig : k.kartopu;
                  const kazanan = k.onerilen === st;
                  return (
                    <div
                      key={st}
                      className="rounded-xl px-4 py-3"
                      style={{
                        background: kazanan ? `${OK}10` : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${kazanan ? `${OK}38` : ROW_SEP}`,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[12.5px] font-medium" style={{ color: TEXT }}>
                          {st === 'CIG' ? 'Çığ yöntemi' : 'Kartopu yöntemi'}
                        </span>
                        {kazanan && <Rozet metin="daha ucuz" renk={OK} />}
                      </div>
                      <div className="mt-1 text-[10.5px]" style={{ color: MUTED }}>
                        {st === 'CIG' ? 'En yüksek faizli borç önce kapanır' : 'En küçük borç önce kapanır (motivasyon)'}
                      </div>
                      <div className="mt-2 space-y-1 text-[12px]">
                        <div className="flex justify-between">
                          <span style={{ color: MUTED }}>Süre</span>
                          <span className="tabular-nums" style={{ color: TEXT }}>
                            {r.ayAdedi ? `${r.ayAdedi} ay` : 'kapanmıyor'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: MUTED }}>Toplam faiz</span>
                          <span className="tabular-nums" style={{ color: TURUNCU }}>
                            {para(r.toplamFaiz)} ₺
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {k.faizFarki !== 0 && (
                <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: MUTED }}>
                  {k.onerilen === 'CIG' ? 'Çığ' : 'Kartopu'} yöntemi{' '}
                  <b style={{ color: OK }}>{para(Math.abs(k.faizFarki))} ₺</b> daha az faiz ödetiyor
                  {k.ayFarki !== 0 && (
                    <>
                      {' '}
                      ve borcu <b style={{ color: OK }}>{Math.abs(k.ayFarki)} ay</b> önce bitiriyor
                    </>
                  )}
                  .
                </p>
              )}
            </Kutu>

            {/* Kapanış sırası */}
            <Kutu baslik="Kapanış sırası" aciklama="Hangi borç kaçıncı ayda biter" renk={MAVI}>
              {s.kapanisSirasi.length === 0 ? (
                <Bos metin="Bu kapasiteyle borçlar kapanmıyor." />
              ) : (
                <div className="space-y-2">
                  {s.kapanisSirasi.map((x, i) => (
                    <div key={x.id} className="flex items-center gap-3">
                      <span
                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                        style={{ background: `${MAVI}1f`, color: MAVI, border: `1px solid ${MAVI}44` }}
                      >
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate text-[12.5px]" style={{ color: TEXT }}>
                        {x.ad}
                      </span>
                      <span className="text-[11.5px] tabular-nums" style={{ color: MUTED }}>
                        {x.ay}. ay · {bitisAyi(x.ay)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Kutu>
          </div>

          {/* Elimde X TL var */}
          <Kutu
            baslik="Elime fazladan para geçti — nereye koyayım?"
            aciklama="Tutarı yazın; hangi borca konursa ne kadar faiz kazandırdığını hesaplayalım."
            renk={OK}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <Alan etiket="Tutar (₺)">
                  <Girdi value={ekstra} onChange={(e) => setEkstra(e.target.value)} inputMode="decimal" placeholder="10.000" />
                </Alan>
              </div>
              <Dugme
                tur="birincil"
                renk={OK}
                onClick={() => faydaSorgu.mutate(Number(ekstra.replace('.', '').replace(',', '.')))}
                disabled={!ekstra}
                yukleniyor={faydaSorgu.isPending}
              >
                <Calculator size={13} /> Hesapla
              </Dugme>
            </div>

            {faydaSorgu.data && (
              <div className="mt-3 space-y-1.5">
                {faydaSorgu.data.siralama.map((f, i) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5"
                    style={{
                      background: i === 0 ? `${OK}10` : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${i === 0 ? `${OK}33` : ROW_SEP}`,
                    }}
                  >
                    <span className="flex items-center gap-2 text-[12.5px]" style={{ color: TEXT }}>
                      {i === 0 && <Trophy size={13} style={{ color: OK }} />}
                      {f.ad}
                    </span>
                    <span className="text-[12px] tabular-nums" style={{ color: i === 0 ? OK : MUTED }}>
                      {para(f.kazanc)} ₺ faiz kazancı · {f.ay} ay
                    </span>
                  </div>
                ))}
                <p className="pt-1 text-[10.5px]" style={{ color: 'rgba(113,113,122,0.85)' }}>
                  Kazanç: bu tutar bugün kapatılırsa o borcun kalan ömrü boyunca işlemeyecek faiz.
                </p>
              </div>
            )}
          </Kutu>

          <AiKutu
            baslik="Planın yorumu"
            aciklama="Rakamlar hesaplandı; yapay zekâ neden böyle olduğunu anlatıyor"
            rapor={aiSorgu.data}
            yukleniyor={aiSorgu.isLoading || aiYenile.isPending}
            yenile={() => aiYenile.mutate()}
          />
        </>
      )}
    </div>
  );
}

function bitisAyi(ay: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + ay);
  return d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}
