'use client';

import type { ReactNode } from 'react';
import type { EkipDurum, Pano, PanoDonemOzeti } from '@/lib/ekip';
import { CARD_BORDER, GOLD, KIRMIZI, MAVI, MOR, MUTED, OK, TEXT } from './Tema';
import { bugunMu, donemEtiketi, saatKisa } from './ortak';

export type EkipSekme = 'genel' | 'isler' | 'pano' | 'kadro';

/** Soluk etiket rengi — büyük harfli küçük başlıklar (onaylı sade taslak, _previews/ekip-sade). */
const SOLUK = '#62626b';
/** Kart içi ince ayraç (sekme şeridinin üst çizgisi). */
const AYRAC = 'rgba(255,255,255,0.055)';
/** Şeritteki "evrak bekliyor" dilimi — nötr açık ton. */
const BEKLIYOR = 'rgba(250,250,249,0.22)';
/** Cam kart zemini: sol üstte altın, sağ üstte mavi parıltı + hafif dikey geçiş. */
const KART_ZEMIN =
  'radial-gradient(circle at 4% 0%, rgba(230,200,120,0.11), transparent 36%), radial-gradient(circle at 96% 10%, rgba(140,189,232,0.07), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.012))';

/** 6px durum noktası; `parilti` açıkken hafif ışıma. */
function Nokta({ renk, parilti }: { renk: string; parilti?: boolean }) {
  return <span aria-hidden className="inline-block h-[6px] w-[6px] flex-shrink-0 rounded-full" style={{ background: renk, boxShadow: parilti ? `0 0 6px ${renk}99` : 'none' }} />;
}

/** Üst satırdaki düz metin durum: nokta + metin (kutu yok). */
function Durum({ nokta, parilti, title, children }: { nokta: string; parilti?: boolean; title?: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]" style={{ color: MUTED }} title={title}>
      <Nokta renk={nokta} parilti={parilti} />
      {children}
    </span>
  );
}

/** Aşama şeridindeki bir dilim. */
interface Dilim {
  ad: string;
  sayi: number;
  renk: string;
  parilti?: boolean;
}

/**
 * Pano özetinden birbirini dışlayan aşama dilimleri.
 * Arka uçtaki sayılar BİRİKİMLİ bayraklardır (ekip-runner panoUret): evrak = evrakı gelen, isleme = işlenen,
 * kontrol = kontrol edilen, beyannameHazir = kontrolü bitmiş ama verilmemiş, beyanname = verilen.
 * Dilimler farklardan türetilir; kalan "evrak bekliyor"a yazılır, hiçbir dilim eksiye düşmez, toplam mükellef sayısını aşmaz.
 */
function dilimleriCikar(o: PanoDonemOzeti, pano?: Pano): { toplam: number; verildi: number; dilimler: Dilim[] } {
  const satirlar = pano?.satirlar.flatMap((s) => {
    const d = s.donemler.find((d) => d.donem === o.donem);
    return d ? [d.asamalar] : [];
  });
  if (satirlar && satirlar.length === o.toplam) {
    const sayilar = [0, 0, 0, 0, 0];
    for (const a of satirlar) {
      const index = a.gonderim === 'tamam' ? 4 : a.evrak !== 'tamam' ? 0 : a.isleme !== 'tamam' ? 1 : a.kontrol !== 'tamam' ? 2 : 3;
      sayilar[index]++;
    }
    return { toplam: satirlar.length, verildi: sayilar[4], dilimler: [
      { ad: 'evrak bekliyor', sayi: sayilar[0], renk: BEKLIYOR },
      { ad: 'işleniyor', sayi: sayilar[1], renk: MAVI },
      { ad: 'kontrol', sayi: sayilar[2], renk: MOR },
      { ad: 'hazır', sayi: sayilar[3], renk: GOLD },
      { ad: 'verildi', sayi: sayilar[4], renk: OK, parilti: true },
    ] };
  }
  const { evrak, isleme, kontrol, beyannameHazir, beyanname } = o.ozet;
  const toplam = Math.max(0, o.toplam);
  const sifirAlti = (n: number) => Math.max(0, n);
  const verildi = Math.min(toplam, sifirAlti(beyanname));
  const hazir = Math.min(toplam - verildi, sifirAlti(beyannameHazir));
  const kontrolde = Math.min(toplam - verildi - hazir, sifirAlti(isleme - kontrol)); // işlendi, kontrol sırada
  const islemede = Math.min(toplam - verildi - hazir - kontrolde, sifirAlti(evrak - isleme)); // evrak geldi, işleme sırada
  const evrakBekliyor = sifirAlti(toplam - (verildi + hazir + kontrolde + islemede)); // evrak gelmedi ya da kayıt yok
  return {
    toplam,
    verildi,
    dilimler: [
      { ad: 'evrak bekliyor', sayi: evrakBekliyor, renk: BEKLIYOR },
      { ad: 'işleniyor', sayi: islemede, renk: MAVI },
      { ad: 'kontrol', sayi: kontrolde, renk: MOR },
      { ad: 'hazır', sayi: hazir, renk: GOLD },
      { ad: 'verildi', sayi: verildi, renk: OK, parilti: true },
    ],
  };
}

/** 9px yuvarlak uçlu aşama şeridi + altında lejant (renkli kare · kalın sayı · ad). */
function AsamaSeridi({ dilimler, toplam }: { dilimler: Dilim[]; toplam: number }) {
  const payda = Math.max(toplam, dilimler.reduce((t, d) => t + d.sayi, 0), 1);
  const aciklama = dilimler.map((d) => `${d.sayi} ${d.ad}`).join(', ');
  return (
    <>
      <div role="img" aria-label={aciklama} className="mt-2 flex h-[9px] overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
        {dilimler
          .filter((d) => d.sayi > 0)
          .map((d) => (
            <span
              key={d.ad}
              className="block h-full"
              style={{ width: `${(d.sayi / payda) * 100}%`, background: d.renk, boxShadow: d.parilti ? '0 0 10px rgba(90,209,138,0.45)' : undefined }}
              title={`${d.sayi} ${d.ad}`}
            />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px]" style={{ color: MUTED }}>
        {dilimler.map((d) => (
          <span key={d.ad} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden className="inline-block h-2 w-2 flex-shrink-0 rounded-[2px]" style={{ background: d.renk }} />
            <b className="font-semibold" style={{ color: TEXT }}>
              {d.sayi}
            </b>
            {d.ad}
          </span>
        ))}
      </div>
    </>
  );
}

/** Sade sayı: 22px rakam + altında büyük harfli aralıklı etiket; kutu yok. */
function Sayi({ deger, etiket, renk = TEXT, not }: { deger: number; etiket: string; renk?: string; not?: string }) {
  return (
    <div className="text-right">
      <div className="text-[22px] font-semibold leading-none tabular-nums" style={{ color: renk }}>
        {deger}
      </div>
      <div className="mt-1.5 text-[10.5px] font-bold tracking-[0.14em]" style={{ color: SOLUK }}>
        {etiket}
      </div>
      {not && (
        <div className="mt-0.5 text-[10.5px]" style={{ color: KIRMIZI }}>
          {not}
        </div>
      )}
    </div>
  );
}

/**
 * Sade sekmeler: ince üst çizgi üzerinde düz metin; seçili olan altın + altında 2px altın gradyan çizgi.
 * Erişilebilirlik: sarmalayıcı role="tablist", her sekme role="tab" + aria-selected; erişilebilir ad = metnin kendisi.
 */
function SadeSekmeler<T extends string>({ sekmeler, secili, onSec }: { sekmeler: Array<{ id: T; etiket: string; rozet?: number | null }>; secili: T; onSec: (id: T) => void }) {
  return (
    <nav role="tablist" aria-label="Ekip bölümleri" className="flex flex-wrap gap-1 px-2 sm:px-4" style={{ borderTop: `1px solid ${AYRAC}` }}>
      {sekmeler.map((s) => {
        const aktif = s.id === secili;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={aktif}
            onClick={() => onSec(s.id)}
            className={`relative flex items-center gap-2 whitespace-nowrap px-3 pb-[11px] pt-3 text-[12.5px] transition ${aktif ? 'font-medium' : 'hover:brightness-150'}`}
            style={{ color: aktif ? GOLD : MUTED }}
          >
            {s.etiket}
            {!!s.rozet && (
              <span className="rounded-full px-[7px] py-px text-[10px]" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${CARD_BORDER}`, color: MUTED }}>
                {s.rozet}
              </span>
            )}
            {aktif && <span aria-hidden className="absolute bottom-0 left-3 right-3 h-[2px] rounded-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }} />}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Başlık bandı — onaylı SADE taslak (_previews/ekip-sade, 2026-09-19): TEK cam kart.
 *  1) Üst satır: "Ekip" + personel sayısı + tek cümle; sağda düz metin durumlar (dönem · Luca operatörü · Max · Sabah özeti düğmesi).
 *  2) Nabız: dönem aşama şeridi (evrak bekliyor · işleniyor · kontrol · hazır · verildi) + üç sade sayı (sizden beklenen · çalışan · bugün biten).
 *  3) Sade sekmeler (Genel bakış · İşler · Dönem panosu · Kadro).
 * Yapışkan öğe yok; dar ekranda satırlar sarar, yatay taşma olmaz.
 */
export function Baslik({
  durum,
  ozet,
  pano,
  ajanSayisi,
  kararSayisi,
  calisan,
  bugunBiten,
  bugunYarim,
  isSayisi,
  sekme,
  onSekme,
  onSabahOzeti,
  sabahOzetiMesgul,
}: {
  durum: EkipDurum | undefined;
  ozet: PanoDonemOzeti | undefined;
  pano?: Pano;
  ajanSayisi: number;
  kararSayisi: number;
  calisan: number;
  bugunBiten: number;
  bugunYarim: number;
  isSayisi: number;
  sekme: EkipSekme;
  onSekme: (s: EkipSekme) => void;
  onSabahOzeti: () => void;
  sabahOzetiMesgul: boolean;
}) {
  const sonSabah = durum?.sonSabahOzeti?.createdAt || null;
  const sabahBugun = !!sonSabah && bugunMu(sonSabah);
  const sabahDurum = sabahOzetiMesgul ? 'üretiliyor…' : sabahBugun ? `${saatKisa(sonSabah!).slice(0, 5)} gitti` : durum?.sabahOzeti ? '08:30' : 'kapalı';
  const donemAd = ozet ? donemEtiketi(ozet.beyannameDonem || ozet.donem) : null;
  const donemNotu = ozet?.donem && ozet.beyannameDonem && ozet.beyannameDonem !== ozet.donem ? `İşlem ayı ${donemEtiketi(ozet.donem)}` : undefined;
  const nabiz = ozet ? dilimleriCikar(ozet, pano) : null;
  const operatorAcik = !!durum?.operator?.acik;
  const maxKopuk = durum?.maxBagli === false;

  return (
    <header
      className="relative overflow-hidden rounded-[18px]"
      style={{ background: KART_ZEMIN, border: `1px solid ${CARD_BORDER}`, boxShadow: '0 18px 44px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.035)' }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(230,200,120,0.6), rgba(140,189,232,0.35), transparent)' }} />

      {/* 1) Üst satır: başlık + düz metin durumlar */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 pb-3.5 pt-5 sm:px-6">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-baseline gap-2.5 text-[22px] font-semibold leading-tight tracking-[-0.01em]" style={{ color: TEXT }}>
            Ekip
            <small className="text-[12px] font-medium" style={{ color: MUTED }}>
              {ajanSayisi || 12} personel
            </small>
          </h1>
          <p className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
            Görev verin, ilerlemeyi izleyin, kararı siz verin.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 pt-1.5">
          {donemAd && (
            <Durum nokta={GOLD} title={donemNotu}>
              <b className="font-medium" style={{ color: TEXT }}>
                {donemAd}
              </b>
              beyannameleri
            </Durum>
          )}
          <Durum nokta={operatorAcik ? OK : MUTED} parilti={operatorAcik} title={durum?.operator?.cihaz ? `Cihaz: ${durum.operator.cihaz}` : undefined}>
            Luca operatörü {operatorAcik ? 'açık' : 'kapalı'}
          </Durum>
          <Durum nokta={!durum ? MUTED : maxKopuk ? KIRMIZI : OK} parilti={!!durum && !maxKopuk}>
            Max {!durum ? 'kontrol ediliyor' : maxKopuk ? 'bağlı değil' : 'bağlı'}
          </Durum>
          <button
            type="button"
            onClick={onSabahOzeti}
            disabled={sabahOzetiMesgul}
            title="Sabah özetini şimdi üret (yalnız üretir, göndermez)"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md text-[12px] transition hover:brightness-125 disabled:opacity-60"
            style={{ color: MUTED }}
          >
            <Nokta renk={MAVI} />
            Sabah özeti
            <b className="font-medium" style={{ color: TEXT }}>
              {sabahDurum}
            </b>
          </button>
        </div>
      </div>

      {/* 2) Nabız: dönem aşama şeridi + üç sade sayı */}
      <div className="grid items-center gap-x-6 gap-y-4 px-4 pb-4 pt-1.5 sm:px-6 md:grid-cols-[minmax(0,1.6fr)_auto]">
        <div className="min-w-0">
          {nabiz ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[10.5px] font-bold tracking-[0.2em]" style={{ color: SOLUK }}>
                  DÖNEM · {nabiz.toplam} MÜKELLEF
                </span>
                <b className="text-[12px] font-semibold tabular-nums" style={{ color: TEXT }}>
                  {nabiz.verildi} / {nabiz.toplam} verildi
                </b>
              </div>
              <AsamaSeridi dilimler={nabiz.dilimler} toplam={nabiz.toplam} />
            </>
          ) : (
            <>
              <div className="text-[10.5px] font-bold tracking-[0.2em]" style={{ color: SOLUK }}>
                DÖNEM
              </div>
              <div className="mt-2 text-[12px]" style={{ color: MUTED }}>
                pano yükleniyor
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-end justify-end gap-x-6 gap-y-3">
          <Sayi deger={kararSayisi} etiket="SİZDEN BEKLENEN" />
          <Sayi deger={calisan} etiket="ÇALIŞAN" />
          <Sayi deger={bugunBiten} etiket="BUGÜN BİTEN" renk={OK} not={bugunYarim > 0 ? `${bugunYarim} yarım kaldı` : undefined} />
        </div>
      </div>

      {/* 3) Sekmeler */}
      <SadeSekmeler<EkipSekme>
        secili={sekme}
        onSec={onSekme}
        sekmeler={[
          { id: 'genel', etiket: 'Genel bakış' },
          { id: 'isler', etiket: 'İşler', rozet: isSayisi || null },
          { id: 'pano', etiket: 'Dönem panosu' },
          { id: 'kadro', etiket: 'Kadro' },
        ]}
      />
    </header>
  );
}
