'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Wallet, TrendingDown, AlertTriangle, CalendarDays, RefreshCw, Lightbulb, LineChart,
} from 'lucide-react';
import { butceApi, AkisGunu, AkisHareketOzet, para, paraKisa, tarihTR } from '@/lib/butce';
import {
  Kutu, KPI, Rozet, Dugme, Bos, Yukleniyor,
  GOLD, OK, KIRMIZI, TURUNCU, MAVI, MOR, TEXT, MUTED, CARD_BG, CARD_BORDER, ROW_SEP,
} from './ui';

const gunKisa = (t: string) =>
  new Date(t).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });

const gunAdi = (t: string) => new Date(t).toLocaleDateString('tr-TR', { weekday: 'short' });

export default function NakitAkis() {
  const qc = useQueryClient();
  const [gunSayisi, setGunSayisi] = useState(30);

  const { data: veri, isLoading, isFetching } = useQuery({
    queryKey: ['butce-nakit-akis', gunSayisi],
    queryFn: () => butceApi.nakitAkis(gunSayisi),
  });

  const yenile = () => {
    qc.invalidateQueries({ queryKey: ['butce-nakit-akis'] });
    toast.success('Nakit akışı yenilendi');
  };

  if (isLoading) return <Yukleniyor />;

  const gunler = veri?.gunler ?? [];
  const hicHareketYok = gunler.length === 0 || gunler.every((g) => g.hareketler.length === 0);

  if (!veri || hicHareketYok) {
    return (
      <div className="space-y-4">
        <Kutu baslik="Gün gün nakit akışı" aciklama="Paranız hangi gün ne kadar olacak, önce onu görelim.">
          <Bos
            metin="Nakit akışı için önce banka hesabı ve beklenen tahsilat girin."
            ikon={<CalendarDays size={18} />}
          />
        </Kutu>
        <NotSatiri />
      </div>
    );
  }

  const enDusukTutar = veri.enDusuk?.tutar ?? 0;
  const acikVar = veri.acikGunler.length > 0;
  const takvimGunleri = gunler.slice(0, 30).filter((g) => g.hareketler.length > 0);

  return (
    <div className="space-y-4">
      {/* ===== KPI şeridi ===== */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KPI
          etiket="Bugünkü nakit"
          deger={`${para(veri.baslangicNakit)} ₺`}
          altBilgi={`${veri.hesaplar.length} banka hesabı`}
          renk={GOLD}
          ikon={<Wallet size={14} />}
          vurgu
        />
        <KPI
          etiket="En düşük bakiye"
          deger={`${para(enDusukTutar)} ₺`}
          altBilgi={veri.enDusuk ? `${tarihTR(veri.enDusuk.tarih)} günü` : undefined}
          renk={enDusukTutar < 0 ? KIRMIZI : enDusukTutar < veri.baslangicNakit * 0.2 ? TURUNCU : OK}
          ikon={<TrendingDown size={14} />}
          vurgu={enDusukTutar < 0}
        />

        <div
          className="relative overflow-hidden rounded-2xl px-4 py-3.5"
          style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, boxShadow: '0 14px 32px rgba(0,0,0,0.20)' }}
        >
          <div className="flex items-center gap-2">
            <span style={{ color: MAVI }}>
              <CalendarDays size={14} />
            </span>
            <span className="text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>
              Ne kadar ileriyi görelim
            </span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {[30, 60, 90].map((s) => {
              const secili = s === gunSayisi;
              return (
                <button
                  key={s}
                  onClick={() => setGunSayisi(s)}
                  className="flex-1 rounded-xl py-1.5 text-[12px] font-medium transition-all hover:brightness-110"
                  style={
                    secili
                      ? { background: `linear-gradient(140deg, ${GOLD}dd, ${GOLD}99)`, color: '#0b0b0d', border: `1px solid ${GOLD}` }
                      : { background: 'rgba(255,255,255,0.03)', color: MUTED, border: `1px solid ${CARD_BORDER}` }
                  }
                >
                  {s} gün
                </button>
              );
            })}
          </div>
        </div>

        <KPI
          etiket="Para yetmeyen gün"
          deger={`${veri.acikGunler.length}`}
          altBilgi={acikVar ? 'Aşağıda gün gün yazılı' : 'Bu sürede para hep yetiyor'}
          renk={acikVar ? KIRMIZI : OK}
          ikon={<AlertTriangle size={14} />}
          vurgu={acikVar}
        />
      </div>

      {/* ===== Bakiye eğrisi ===== */}
      <Kutu
        baslik={`${gunSayisi} günlük bakiye seyri`}
        aciklama={`Bu sürede toplam ${para(veri.toplamGiris)} ₺ giriyor, ${para(veri.toplamCikis)} ₺ çıkıyor. Grafiğin üzerine gelin, o günün bakiyesi çıksın.`}
        renk={GOLD}
        sag={
          <Dugme onClick={yenile} yukleniyor={isFetching}>
            <RefreshCw size={12} /> Yenile
          </Dugme>
        }
      >
        <BakiyeGrafigi gunler={gunler} />
      </Kutu>

      {/* ===== Paranın yetmediği günler ===== */}
      <Kutu
        baslik="Paranın yetmediği günler"
        aciklama={acikVar ? 'O gün hesabınızdan çıkacak paralar bakiyenizi aşıyor.' : undefined}
        renk={acikVar ? KIRMIZI : OK}
      >
        {!acikVar ? (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: OK }}>
            <LineChart size={14} /> Önümüzdeki {gunSayisi} günde bakiyeniz hiç eksiye düşmüyor.
          </div>
        ) : (
          <>
            <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
              {veri.acikGunler.map((g) => (
                <div
                  key={g.tarih}
                  className="rounded-xl px-3.5 py-2.5"
                  style={{ background: `${KIRMIZI}0d`, border: `1px solid ${KIRMIZI}33` }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12.5px] font-medium" style={{ color: TEXT }}>
                      {tarihTR(g.tarih)} · {gunAdi(g.tarih)}
                    </span>
                    <span className="text-[12.5px] font-semibold tabular-nums" style={{ color: KIRMIZI }}>
                      {para(Math.abs(g.acik))} ₺ eksik
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {g.hareketler.map((h, i) => (
                      <HareketEtiketi key={`${g.tarih}-${i}`} hareket={h} />
                    ))}
                  </div>
                  <div className="mt-1.5 text-[10.5px]" style={{ color: MUTED }}>
                    Gün sonu bakiye {para(g.bakiye)} ₺
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed" style={{ color: MUTED }}>
              {veri.kmhIleKarsilanir
                ? `Bu açıklar ${para(veri.kmhLimitToplam)} ₺ ek hesap limitinizin içinde kalıyor; yine de faiz ödersiniz.`
                : `Ek hesap limitiniz (${para(veri.kmhLimitToplam)} ₺) bu açıkları karşılamıyor; aşağıdaki seçeneklerden birini kullanmanız gerekir.`}
            </p>
          </>
        )}
      </Kutu>

      {/* ===== Öneriler ===== */}
      {veri.oneriler.length > 0 && (
        <Kutu
          baslik="Ne yapabilirsiniz"
          aciklama="Her açık gün için seçenekler; ucuz olandan pahalıya doğru sıralı."
          renk={MOR}
        >
          <div className="space-y-3">
            {veri.oneriler.map((o, i) => (
              <div
                key={`${o.tarih}-${i}`}
                className="rounded-xl px-4 py-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${ROW_SEP}` }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: TEXT }}>
                    <Lightbulb size={13} style={{ color: MOR }} />
                    {o.baslik}
                  </span>
                  <span className="text-right text-[12px] tabular-nums" style={{ color: KIRMIZI }}>
                    {para(Math.abs(o.acik))} ₺ ek para
                  </span>
                </div>

                {/* Devreden açık: bir önceki açık gününde kapatıldığı varsayılan tutar.
                    Bu ayrım olmadan aynı açık iki gün üst üste tam tutarıyla isteniyordu. */}
                {!!o.devredenAcik && o.devredenAcik > 0 && (
                  <div className="mt-1 text-[11px] leading-relaxed" style={{ color: MUTED }}>
                    O günkü toplam açık{' '}
                    <span className="tabular-nums" style={{ color: TEXT }}>
                      {para(o.toplamAcik ?? o.acik)} ₺
                    </span>
                    ; bunun{' '}
                    <span className="tabular-nums" style={{ color: TEXT }}>
                      {para(o.devredenAcik)} ₺
                    </span>{' '}
                    kısmı önceki öneriyle kapatılmış sayılır, bu yüzden burada yalnız aradaki fark isteniyor.
                  </div>
                )}

                {!!o.oGunkuOdemeler?.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {o.oGunkuOdemeler.map((h, k) => (
                      <span
                        key={`${o.tarih}-od-${k}`}
                        className="rounded-md px-2 py-0.5 text-[10.5px]"
                        style={{ background: `${KIRMIZI}12`, border: `1px solid ${KIRMIZI}2e`, color: MUTED }}
                      >
                        {h.ad} · {para(h.tutar)} ₺
                      </span>
                    ))}
                  </div>
                )}

                {/* Sıralama sunucudan maliyete göre geliyor; burada yeniden sıralamıyoruz. */}
                <div className="mt-2.5 grid gap-2 md:grid-cols-2">
                  {o.secenekler.map((s, j) => (
                    <div
                      key={`${o.tarih}-${i}-${j}`}
                      className="rounded-xl px-3 py-2.5"
                      style={{
                        background: s.onerilen ? `${OK}0f` : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${s.onerilen ? `${OK}66` : CARD_BORDER}`,
                        boxShadow: s.onerilen ? `0 0 0 1px ${OK}22` : 'none',
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[12.5px] font-medium" style={{ color: TEXT }}>
                          {s.ad}
                        </span>
                        {s.onerilen && <Rozet metin="önerilen" renk={OK} />}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed" style={{ color: MUTED }}>
                        {s.aciklama}
                      </p>
                      <div className="mt-1.5">
                        {/* Faiz oranı girilmemişse maliyet 0 çıkar; bunu "bedava" diye
                            göstermek yanlış yönlendirme olurdu. */}
                        {s.maliyetBilinmiyor ? (
                          <Rozet metin="maliyeti bilinmiyor" renk={TURUNCU} />
                        ) : s.maliyetTahmini ? (
                          <span className="flex items-center gap-1.5">
                            <Rozet metin="tahmini" renk={TURUNCU} />
                            <span className="text-[11.5px] tabular-nums" style={{ color: MUTED }}>
                              ~{para(s.maliyet)} ₺
                            </span>
                          </span>
                        ) : s.maliyet === 0 ? (
                          <Rozet metin="maliyetsiz" renk={OK} />
                        ) : (
                          <span className="text-[11.5px] tabular-nums" style={{ color: TURUNCU }}>
                            Size {para(s.maliyet)} ₺ tutar
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Kutu>
      )}

      {/* ===== Takvim şeridi ===== */}
      <Kutu
        baslik="Önümüzdeki 30 gün"
        aciklama="Hareketi olan günler; yeşil giren, kırmızı çıkan paradır."
        renk={MAVI}
      >
        {takvimGunleri.length === 0 ? (
          <Bos metin="Önümüzdeki 30 günde kayıtlı hareket yok." />
        ) : (
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {takvimGunleri.map((g) => (
              <div
                key={g.tarih}
                className="flex flex-wrap items-start gap-3 rounded-xl px-3 py-2"
                style={{
                  background: g.bakiye < 0 ? `${KIRMIZI}0d` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${g.bakiye < 0 ? `${KIRMIZI}2e` : ROW_SEP}`,
                }}
              >
                <div className="w-[74px] flex-shrink-0">
                  <div className="text-[12.5px] font-medium tabular-nums" style={{ color: TEXT }}>
                    {gunKisa(g.tarih)}
                  </div>
                  <div className="text-[10.5px]" style={{ color: MUTED }}>
                    {gunAdi(g.tarih)}
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {g.hareketler.map((h, i) => (
                    <HareketEtiketi key={`${g.tarih}-t-${i}`} hareket={h} />
                  ))}
                </div>
                <div className="w-[110px] flex-shrink-0 text-right">
                  <div className="text-[10.5px]" style={{ color: MUTED }}>
                    gün sonu
                  </div>
                  <div
                    className="text-[12.5px] font-semibold tabular-nums"
                    style={{ color: g.bakiye < 0 ? KIRMIZI : TEXT }}
                  >
                    {para(g.bakiye)} ₺
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Kutu>

      <NotSatiri />
    </div>
  );
}

/* ===================== BAKİYE EĞRİSİ ===================== */

const GENISLIK = 1000;
const YUKSEKLIK = 200;
const UST_BOSLUK = 12;
const ALT_BOSLUK = 12;

function BakiyeGrafigi({ gunler }: { gunler: AkisGunu[] }) {
  const kapRef = useRef<HTMLDivElement>(null);
  const [imlec, setImlec] = useState<number | null>(null);
  const adet = gunler.length;

  const olcek = useMemo(() => {
    const degerler = gunler.map((g) => g.bakiye);
    const tepe = Math.max(0, ...degerler);
    const dip = Math.min(0, ...degerler);
    const pay = (tepe - dip) * 0.08 || 1;
    const ust = tepe + pay;
    const alt = dip - pay;
    const yer = (v: number) => UST_BOSLUK + (1 - (v - alt) / (ust - alt)) * (YUKSEKLIK - UST_BOSLUK - ALT_BOSLUK);
    return { ust, alt, yer };
  }, [gunler]);

  if (adet === 0) return null;

  const xYer = (i: number) => (adet <= 1 ? GENISLIK / 2 : (i / (adet - 1)) * GENISLIK);
  const sifirY = olcek.yer(0);
  // Eksi eksen etiketi yalnız bakiye gerçekten eksiye düşüyorsa gösterilir
  // (ölçeğin alt sınırı pay yüzünden her zaman sıfırın altında kalır)
  const eksiyeDusuyor = gunler.some((g) => g.bakiye < 0);

  const cizgi = gunler
    .map((g, i) => `${i === 0 ? 'M' : 'L'} ${xYer(i).toFixed(2)} ${olcek.yer(g.bakiye).toFixed(2)}`)
    .join(' ');
  const alanYolu = `${cizgi} L ${xYer(adet - 1).toFixed(2)} ${sifirY.toFixed(2)} L ${xYer(0).toFixed(2)} ${sifirY.toFixed(2)} Z`;

  const adim = Math.max(1, Math.ceil(adet / 6));
  const eksenEtiketleri = gunler
    .map((g, i) => ({ g, i }))
    .filter(({ i }) => i % adim === 0 || i === adet - 1);

  const imlecTasi = (e: React.MouseEvent<HTMLDivElement>) => {
    const kutu = kapRef.current?.getBoundingClientRect();
    if (!kutu || kutu.width === 0) return;
    const oran = Math.min(1, Math.max(0, (e.clientX - kutu.left) / kutu.width));
    setImlec(Math.round(oran * (adet - 1)));
  };

  const secili = imlec !== null ? gunler[imlec] : null;
  const seciliYuzde = imlec === null || adet <= 1 ? 50 : (imlec / (adet - 1)) * 100;

  return (
    <div>
      <div
        ref={kapRef}
        className="relative"
        style={{ height: YUKSEKLIK }}
        onMouseMove={imlecTasi}
        onMouseLeave={() => setImlec(null)}
      >
        {/* Yatayda esneyen çizim; çizgi kalınlığı non-scaling-stroke ile sabit kalır. */}
        <svg
          viewBox={`0 0 ${GENISLIK} ${YUKSEKLIK}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: YUKSEKLIK, display: 'block' }}
        >
          <defs>
            <linearGradient id="nakitArtiDolgu" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD} stopOpacity="0.42" />
              <stop offset="100%" stopColor={GOLD} stopOpacity="0.03" />
            </linearGradient>
            <linearGradient id="nakitEksiDolgu" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={KIRMIZI} stopOpacity="0.05" />
              <stop offset="100%" stopColor={KIRMIZI} stopOpacity="0.5" />
            </linearGradient>
            <clipPath id="nakitUstBolge">
              <rect x="0" y="0" width={GENISLIK} height={Math.max(sifirY, 0)} />
            </clipPath>
            <clipPath id="nakitAltBolge">
              <rect x="0" y={sifirY} width={GENISLIK} height={Math.max(YUKSEKLIK - sifirY, 0)} />
            </clipPath>
          </defs>

          <path d={alanYolu} fill="url(#nakitArtiDolgu)" clipPath="url(#nakitUstBolge)" />
          <path d={alanYolu} fill="url(#nakitEksiDolgu)" clipPath="url(#nakitAltBolge)" />

          <line
            x1="0"
            x2={GENISLIK}
            y1={sifirY}
            y2={sifirY}
            stroke="rgba(255,255,255,0.42)"
            strokeWidth="1"
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />

          <path
            d={cizgi}
            fill="none"
            stroke={GOLD}
            strokeWidth="1.8"
            clipPath="url(#nakitUstBolge)"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={cizgi}
            fill="none"
            stroke={KIRMIZI}
            strokeWidth="1.8"
            clipPath="url(#nakitAltBolge)"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <span className="pointer-events-none absolute left-1 text-[10px]" style={{ top: 0, color: MUTED }}>
          {paraKisa(olcek.ust)} ₺
        </span>
        <span
          className="pointer-events-none absolute right-1 text-[10px]"
          style={{ top: Math.max(0, sifirY - 14), color: 'rgba(255,255,255,0.5)' }}
        >
          0 ₺
        </span>
        {eksiyeDusuyor && (
          <span className="pointer-events-none absolute bottom-0 left-1 text-[10px]" style={{ color: KIRMIZI }}>
            {paraKisa(olcek.alt)} ₺
          </span>
        )}

        {/* İmleç: daire/çizgi SVG içinde esneyeceği için HTML olarak çiziliyor. */}
        {secili && (
          <>
            <div
              className="pointer-events-none absolute top-0 w-px"
              style={{ left: `${seciliYuzde}%`, height: YUKSEKLIK, background: 'rgba(255,255,255,0.22)' }}
            />
            <div
              className="pointer-events-none absolute h-[7px] w-[7px] rounded-full"
              style={{
                left: `${seciliYuzde}%`,
                top: olcek.yer(secili.bakiye) - 3.5,
                marginLeft: -3.5,
                background: secili.bakiye < 0 ? KIRMIZI : GOLD,
                boxShadow: `0 0 8px ${secili.bakiye < 0 ? KIRMIZI : GOLD}`,
              }}
            />
            <div
              className="pointer-events-none absolute z-10 rounded-xl px-3 py-2"
              style={{
                left: `${Math.min(88, Math.max(12, seciliYuzde))}%`,
                top: Math.max(2, Math.min(YUKSEKLIK - 76, olcek.yer(secili.bakiye) - 78)),
                transform: 'translateX(-50%)',
                background: 'rgba(10,10,12,0.94)',
                border: `1px solid ${CARD_BORDER}`,
                boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
                minWidth: 132,
              }}
            >
              <div className="text-[10.5px]" style={{ color: MUTED }}>
                {tarihTR(secili.tarih)} · {gunAdi(secili.tarih)}
              </div>
              <div
                className="text-[14px] font-semibold tabular-nums"
                style={{ color: secili.bakiye < 0 ? KIRMIZI : GOLD }}
              >
                {para(secili.bakiye)} ₺
              </div>
              {(secili.giris > 0 || secili.cikis > 0) && (
                <div className="mt-0.5 text-[10.5px] tabular-nums" style={{ color: MUTED }}>
                  <span style={{ color: OK }}>+{para(secili.giris)}</span>
                  {' · '}
                  <span style={{ color: KIRMIZI }}>−{para(secili.cikis)}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="relative mt-1 h-4">
        {eksenEtiketleri.map(({ g, i }) => {
          const yuzde = adet <= 1 ? 50 : (i / (adet - 1)) * 100;
          return (
            <span
              key={g.tarih}
              className="absolute text-[9.5px] tabular-nums"
              style={{
                left: `${Math.min(97, Math.max(3, yuzde))}%`,
                transform: 'translateX(-50%)',
                color: MUTED,
                whiteSpace: 'nowrap',
              }}
            >
              {gunKisa(g.tarih)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ===================== ORTAK PARÇALAR ===================== */

function HareketEtiketi({ hareket }: { hareket: AkisHareketOzet }) {
  const giris = hareket.tur === 'GELIR';
  const renk = giris ? OK : KIRMIZI;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]"
      style={{
        background: `${renk}0f`,
        border: `1px ${hareket.kesin ? 'solid' : 'dashed'} ${renk}40`,
        color: TEXT,
      }}
    >
      <span className="truncate" style={{ maxWidth: 220 }}>
        {hareket.ad}
      </span>
      <span className="tabular-nums" style={{ color: renk }}>
        {giris ? '+' : '−'}
        {para(Math.abs(hareket.tutar))} ₺
      </span>
      {!hareket.kesin && <Rozet metin="beklenen" renk={MUTED} />}
    </span>
  );
}

function NotSatiri() {
  return (
    <p className="px-1 text-[11px] leading-relaxed" style={{ color: MUTED }}>
      Beklenen tahsilatlarınızı Gelir &amp; Gider ekranından “planlanan” olarak girerseniz bu tablo daha isabetli olur.
    </p>
  );
}
