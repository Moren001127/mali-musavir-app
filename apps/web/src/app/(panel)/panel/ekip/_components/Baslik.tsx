'use client';

import type { ReactNode } from 'react';
import type { EkipDurum, Pano, PanoDonemOzeti } from '@/lib/ekip';
import { CARD_BORDER, GOLD, KIRMIZI, MAVI, MOR, MUTED, OK, TEXT } from './Tema';
import { bugunMu, donemEtiketi, saatKisa } from './ortak';

export type EkipSekme = 'genel' | 'isler' | 'pano' | 'kadro';

/** Koyu zeminde okunabilir, ikincil dönem etiketi. */
const SOLUK = '#a49b88';
/** Kart içi ince ayraç (sekme şeridinin üst çizgisi). */
const AYRAC = 'rgba(255,255,255,0.055)';
/** Şeritteki "evrak bekliyor" dilimi — nötr açık ton. */
const BEKLIYOR = 'rgba(250,250,249,0.22)';
/** Koyu zemin üzerinde hafif altın ışık. */
const KART_ZEMIN =
  'radial-gradient(ellipse at 0% 0%, rgba(230,200,120,0.08), transparent 55%), linear-gradient(135deg, #191917, #111214)';

/** 6px durum noktası; `parilti` açıkken hafif ışıma. */
function Nokta({ renk, parilti }: { renk: string; parilti?: boolean }) {
  return <span aria-hidden className="inline-block h-[6px] w-[6px] flex-shrink-0 rounded-full" style={{ background: renk, boxShadow: parilti ? `0 0 6px ${renk}99` : 'none' }} />;
}

/** Üst satırdaki düz metin durum: nokta + metin (kutu yok). */
function Durum({ nokta, parilti, title, children }: { nokta: string; parilti?: boolean; title?: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px]" style={{ color: MUTED }} title={title}>
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

/** Başlığı büyütmeyen, tek satırlık küçük özet. */
function Sayi({ deger, etiket, renk = TEXT, not }: { deger: number; etiket: string; renk?: string; not?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: MUTED }}>
      <b className="font-medium tabular-nums" style={{ color: renk }}>
        {deger}
      </b>
      {etiket}
      {not && (
        <span style={{ color: KIRMIZI }}>· {not}</span>
      )}
    </span>
  );
}

/**
 * Sade sekmeler: seçili bölümde hafif altın zemin ve ince çerçeve.
 * Erişilebilirlik: sarmalayıcı role="tablist", her sekme role="tab" + aria-selected; erişilebilir ad = metnin kendisi.
 */
function SadeSekmeler<T extends string>({ sekmeler, secili, onSec }: { sekmeler: Array<{ id: T; etiket: string; rozet?: number | null }>; secili: T; onSec: (id: T) => void }) {
  return (
    <nav role="tablist" aria-label="Ekip bölümleri" className="flex flex-wrap gap-1 p-2 sm:px-4" style={{ borderTop: `1px solid ${AYRAC}`, background: 'rgba(0,0,0,0.12)' }}>
      {sekmeler.map((s) => {
        const aktif = s.id === secili;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={aktif}
            onClick={() => onSec(s.id)}
            className={`relative flex min-h-10 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[12px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6c878] ${aktif ? 'font-semibold' : 'hover:bg-white/[0.04] hover:text-white'}`}
            style={{ color: aktif ? GOLD : MUTED, background: aktif ? 'rgba(230,200,120,0.09)' : undefined, boxShadow: aktif ? 'inset 0 0 0 1px rgba(230,200,120,0.16)' : undefined }}
          >
            {s.etiket}
            {!!s.rozet && (
              <span className="rounded-full px-[7px] py-px text-[10px]" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${CARD_BORDER}`, color: MUTED }}>
                {s.rozet}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/** Kompakt başlık ve sekmeler; ayrıntılı dönem özeti yalnızca panoda görünür. */
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
      className="relative overflow-hidden rounded-2xl"
      style={{ background: KART_ZEMIN, border: '1px solid rgba(230,200,120,0.14)', boxShadow: '0 8px 24px rgba(0,0,0,0.16)' }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(230,200,120,0.4), transparent)' }} />

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[19px] font-semibold leading-tight tracking-tight" style={{ color: TEXT }}>Ekip</h1>
            <span className="text-[11px]" style={{ color: MUTED }}>{ajanSayisi} personel</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Sayi deger={kararSayisi} etiket="karar bekliyor" renk={kararSayisi > 0 ? GOLD : TEXT} />
            <Sayi deger={calisan} etiket="çalışan" />
            <Sayi deger={bugunBiten} etiket="bugün biten" not={bugunYarim > 0 ? `${bugunYarim} yarım kaldı` : undefined} />
          </div>
        </div>
        <button
          type="button"
          onClick={onSabahOzeti}
          disabled={sabahOzetiMesgul}
          aria-busy={sabahOzetiMesgul}
          title="Sabah özetini şimdi üret (yalnız üretir, göndermez)"
          className="inline-flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-[12px] transition hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e6c878] disabled:cursor-wait disabled:opacity-60"
          style={{ color: GOLD, background: 'rgba(230,200,120,0.07)', border: '1px solid rgba(230,200,120,0.2)' }}
        >
          <span className="font-medium">Sabah özeti</span>
          <span className="text-[11px]" style={{ color: MUTED }}>{sabahDurum}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-3 sm:px-5">
        {donemAd && (
          <span className="text-[11px]" style={{ color: MUTED }} title={donemNotu}>
            {donemAd} beyannameleri
          </span>
        )}
        <Durum nokta={operatorAcik ? OK : MUTED} title={durum?.operator?.cihaz ? `Cihaz: ${durum.operator.cihaz}` : undefined}>
          Luca operatörü {operatorAcik ? 'açık' : 'kapalı'}
        </Durum>
        <Durum nokta={!durum ? MUTED : maxKopuk ? KIRMIZI : OK}>
          Max {!durum ? 'kontrol ediliyor' : maxKopuk ? 'bağlı değil' : 'bağlı'}
        </Durum>
      </div>

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

      {sekme === 'pano' && (
        <div className="px-4 py-3 sm:px-5" style={{ borderTop: `1px solid ${AYRAC}` }}>
          {nabiz ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[11px]">
                <span style={{ color: SOLUK }}>Dönem ilerlemesi · {nabiz.toplam} mükellef</span>
                <span className="tabular-nums" style={{ color: MUTED }}>{nabiz.verildi} / {nabiz.toplam} verildi</span>
              </div>
              <AsamaSeridi dilimler={nabiz.dilimler} toplam={nabiz.toplam} />
            </>
          ) : (
            <p role="status" className="text-[11px]" style={{ color: MUTED }}>Dönem panosu yükleniyor…</p>
          )}
        </div>
      )}
    </header>
  );
}
