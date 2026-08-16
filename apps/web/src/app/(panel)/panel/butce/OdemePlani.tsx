'use client';

import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Target, TrendingDown, AlertTriangle, Calculator, Trophy, CalendarCheck,
} from 'lucide-react';
import { butceApi, Strateji, para, donemTR, DefterSecim } from '@/lib/butce';
import {
  Kutu, KPI, Dugme, Girdi, Alan, Bos, Rozet, Yukleniyor, ParaGirdi, paraCoz,
  GOLD, OK, KIRMIZI, TURUNCU, MAVI, MOR, MUTED, TEXT, ROW_SEP, CARD_BORDER,
} from './ui';
import AiKutu from './AiKutu';

export default function OdemePlani({ donem, defter = 'TUMU' }: { donem: string; defter?: DefterSecim }) {
  const [kapasite, setKapasite] = useState<string>('');
  const [strateji, setStrateji] = useState<Strateji | undefined>(undefined);
  const [ekstra, setEkstra] = useState('');

  const { data: plan, isLoading } = useQuery({
    queryKey: ['butce-plan', donem, kapasite, strateji, defter],
    queryFn: () =>
      butceApi.plan({
        donem,
        kapasite: kapasite === '' ? undefined : paraCoz(kapasite),
        strateji,
        defter,
      }),
  });

  const faydaSorgu = useMutation({ mutationFn: (t: number) => butceApi.fayda(t) });

  // Ödeme planı ile Nakit Akışı aynı parayı kullanır. Plan "aylık" bakar,
  // nakit akışı "gün gün" bakar: ay toplamı yetse bile ödeme gününde para
  // olmayabilir. Bu yüzden akıştaki açık günler burada da uyarı olarak çıkar.
  const akis = useQuery({
    queryKey: ['butce-nakit-akis-plan'],
    queryFn: () => butceApi.nakitAkis(30),
    staleTime: 60_000,
  });

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
        aciklama="Her ay tekrar eden kapasite ile bu ay öncesinden devreden bakiye ayrı tutulur."
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
          <Alan etiket="Aylık kapasite" ipucu="Boş bırakırsanız otomatik hesaplanır">
            <ParaGirdi value={kapasite} onChange={setKapasite} placeholder={para(plan.otomatikKapasite)} />
          </Alan>
          <div className="sm:col-span-3 grid gap-3 sm:grid-cols-3">
            <KPI
              etiket="Her ay ayırabilirsiniz"
              deger={`${para(plan.kapasite)} ₺`}
              renk={GOLD}
              vurgu
              altBilgi={
                plan.ortalamaAySayisi > 1
                  ? `Son ${plan.ortalamaAySayisi} ayın ortalaması`
                  : 'Yalnız bu ayın verisi'
              }
            />
            <KPI
              etiket="Devreden bakiye"
              deger={`${para(plan.birikim)} ₺`}
              renk={MAVI}
              altBilgi="Bu ay öncesinden devreden para"
            />
            <KPI etiket="Bu ay toplam" deger={`${para(plan.buAyToplam)} ₺`} renk={OK} />
          </div>
        </div>

      </Kutu>

      {/* Gün bazlı gerçeklik kontrolü — aylık kapasite yetse bile gün tutmayabilir */}
      {(akis.data?.acikGunler?.length ?? 0) > 0 && (
        <div
          className="flex items-start gap-3 rounded-xl px-4 py-3"
          style={{ background: `${TURUNCU}12`, border: `1px solid ${TURUNCU}33` }}
        >
          <AlertTriangle size={16} style={{ color: TURUNCU }} className="mt-0.5" />
          <div>
            <div className="text-[12.5px] font-semibold" style={{ color: TURUNCU }}>
              Nakit akışında {akis.data!.acikGunler.length} gün para yetmiyor
            </div>
            <div className="mt-0.5 text-[11.5px] leading-relaxed" style={{ color: MUTED }}>
              En düşük bakiye {para(akis.data!.enDusuk.tutar)} ₺ ·{' '}
              {new Date(akis.data!.enDusuk.tarih).toLocaleDateString('tr-TR')}. Buradaki plan ayın tamamına
              bakar; ödemelerin düştüğü günlerde para elinizde olmayabilir. Gün gün dökümü ve hangi hesaptan
              nasıl kapatacağınız <strong style={{ color: TEXT }}>Nakit Akışı</strong> sekmesinde.
            </div>
          </div>
        </div>
      )}

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
                  Zorunlu ödemeleriniz aylık kapasitenizi {para(s.acik)} ₺ aşıyor
                </div>
                <div className="mt-0.5 text-[11.5px] leading-relaxed" style={{ color: MUTED }}>
                  {/* Kullanıcı bulgusu: aşağıdaki tabloda her şey ödenmiş görünüyor ama
                      burada "açık" yazıyordu; ikisi farklı şeyi ölçtüğü için çelişik
                      duruyordu. Tablo BU AYI (devreden bakiye dahil), bu uyarı HER AY TEKRAR
                      EDENİ ölçer. */}
                  Bu ay ödemeler tam görünüyor, çünkü{' '}
                  <strong style={{ color: TEXT }}>{para(plan.birikim)} ₺ devreden bakiyeniz</strong> kullanılıyor.
                  Ancak her ay tekrar eden kapasiteniz{' '}
                  <strong style={{ color: TEXT }}>{para(plan.kapasite)} ₺</strong>, şu anki zorunlu ödemeleriniz ise{' '}
                  <strong style={{ color: TEXT }}>{para(plan.kapasite + s.acik)} ₺</strong>. Devreden bakiye
                  tükendikten sonra kredi taksitini tam ödeyemezsiniz — bu gecikme sayılır, gecikme faizi işler ve
                  kredi notunuzu etkiler. Yukarıdaki süre bu gecikmeyi hesaba katmaz. Borçlar kapandıkça fark
                  azalır; kalıcı çözüm için gelir artırmak ya da gideri azaltmak gerekir.
                </div>
              </div>
            </div>
          )}

          {/* Sonuç şeridi */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {/* Zorunlu ödemeler kapasiteyi aşıyorsa süre GÜVENİLİR DEĞİLDİR:
                simülasyon taksiti eksik ödeyerek ilerliyor, gerçekte bu gecikme
                demektir (gecikme faizi + kredi notu). Süreyi düz yeşil "20 ay"
                diye sunmak yanlış güven veriyordu. */}
            <KPI
              etiket="Borçsuz kalma"
              deger={s.kapanmiyor ? 'Kapanmıyor' : s.acik > 0 ? `~${s.ayAdedi} ay` : `${s.ayAdedi} ay`}
              renk={s.kapanmiyor ? KIRMIZI : s.acik > 0 ? TURUNCU : OK}
              ikon={<CalendarCheck size={14} />}
              altBilgi={
                s.kapanmiyor
                  ? 'Bu kapasiteyle borç kapanmıyor'
                  : s.acik > 0
                    ? 'Taksitler eksik ödendiği varsayımıyla'
                    : `Yaklaşık ${bitisAyi(s.ayAdedi!)}`
              }
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
            aciklama={`Bu ay ${para(plan.buAyToplam)} ₺ ile hesaplandı (her ay ${para(plan.kapasite)} ₺ + devreden ${para(plan.birikim)} ₺). Zorunlu tutarlar önce ayrılır; artan para en fazla fayda sağlayan borca gider.`}
            renk={GOLD}
          >
            {/* Sakin liste: sağda TEK hizalı tutar, altında tek stil açıklama.
                Sayıları farklı sütunlara dağıtmak ve her birine ayrı renk vermek
                gözü yoruyordu; burada vurgu yalnız ödenecek tutarda. */}
            <div>
              {s.ilkAy.map((x, i) => {
                const borcOncesi = x.kalanSonra + x.toplam;
                const oran = borcOncesi > 0 ? Math.min((x.toplam / borcOncesi) * 100, 100) : 0;
                const kapandi = x.kalanSonra <= 0.009;

                // Açıklama satırı: tek cümle, tek stil — parça parça renkli sayı yok
                const parcalar: string[] = [x.tip === 'KART' ? 'Kredi kartı' : 'Kredi'];
                if (x.zorunlu > 0 && x.ekstra > 0) {
                  parcalar.push(`zorunlu ${para(x.zorunlu)} + ekstra ${para(x.ekstra)}`);
                } else if (x.ekstra > 0) {
                  parcalar.push(`tamamı ekstra ödeme`);
                } else {
                  parcalar.push(`zorunlu ödeme`);
                }
                if (x.eksik > 0) parcalar.push(`${para(x.eksik)} ₺ eksik kalıyor`);

                return (
                  <div
                    key={x.id}
                    className="py-3.5"
                    style={{ borderTop: i === 0 ? 'none' : `1px solid ${ROW_SEP}` }}
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="min-w-0 truncate text-[13.5px]" style={{ color: TEXT }}>
                        {x.ad}
                      </span>
                      <span className="flex-shrink-0 text-[16px] tabular-nums" style={{ color: TEXT }}>
                        {para(x.toplam)} ₺
                      </span>
                    </div>

                    <div className="mt-1 flex items-baseline justify-between gap-4 text-[11.5px]">
                      <span className="min-w-0 truncate" style={{ color: MUTED }}>
                        {parcalar.join(' · ')}
                      </span>
                      <span className="flex-shrink-0 tabular-nums" style={{ color: kapandi ? OK : MUTED }}>
                        {kapandi ? 'bu ay kapanıyor' : `kalan ${para(x.kalanSonra)} ₺`}
                      </span>
                    </div>

                    {/* Ne kadarı kapandı — ince, tek renk, dikkat çalmayan gösterge */}
                    <div
                      className="mt-2.5 h-[2px] w-full overflow-hidden rounded-full"
                      style={{ background: 'rgba(255,255,255,0.06)' }}
                    >
                      <div
                        style={{ width: `${oran}%`, height: '100%', background: kapandi ? OK : MAVI }}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Toplam — aynı hizada, biraz daha güçlü */}
              <div
                className="flex items-baseline justify-between gap-4 pt-4"
                style={{ borderTop: `1px solid ${CARD_BORDER}` }}
              >
                <span className="text-[11.5px] uppercase tracking-[0.14em]" style={{ color: MUTED }}>
                  Toplam
                </span>
                <span className="text-[16px] tabular-nums" style={{ color: MAVI }}>
                  {para(s.ilkAy.reduce((t, x) => t + x.toplam, 0))} ₺
                </span>
              </div>
            </div>
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
                <Alan etiket="Tutar">
                  <ParaGirdi value={ekstra} onChange={setEkstra} placeholder="10.000" />
                </Alan>
              </div>
              <Dugme
                tur="birincil"
                renk={OK}
                onClick={() => faydaSorgu.mutate(paraCoz(ekstra))}
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
