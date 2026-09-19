'use client';
import { portalStyle } from '@/lib/portal-theme';


import type { ReactNode } from 'react';
import type { EkipDurum, Pano, PanoDonemOzeti } from '@/lib/ekip';
import { GOLD, KIRMIZI, MAVI, MOR, MUTED, OK, TEXT } from './Tema';
import { bugunMu, donemEtiketi, saatKisa } from './ortak';

export type EkipSekme = 'genel' | 'isler' | 'pano' | 'kadro';

/** Şeritteki "evrak bekliyor" dilimi — nötr açık ton. */
const BEKLIYOR = 'rgba(250,250,249,0.22)';

/** 6px durum noktası; `parilti` açıkken hafif ışıma. */
function Nokta({ renk, parilti }: { renk: string; parilti?: boolean }) {
  return <span aria-hidden className="inline-block h-[6px] w-[6px] flex-shrink-0 rounded-full" style={portalStyle({ background: renk, boxShadow: parilti ? `0 0 6px ${renk}99` : 'none' })} />;
}

/** Üst satırdaki düz metin durum: nokta + metin (kutu yok). */
function Durum({ nokta, parilti, title, children }: { nokta: string; parilti?: boolean; title?: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px]" style={portalStyle({ color: MUTED })} title={title}>
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
      <div role="img" aria-label={aciklama} className="mt-2 flex h-[9px] overflow-hidden rounded-full" style={portalStyle({ background: 'rgba(255,255,255,0.05)' })}>
        {dilimler
          .filter((d) => d.sayi > 0)
          .map((d) => (
            <span
              key={d.ad}
              className="block h-full"
              style={portalStyle({ width: `${(d.sayi / payda) * 100}%`, background: d.renk, boxShadow: d.parilti ? '0 0 10px rgba(90,209,138,0.45)' : undefined })}
              title={`${d.sayi} ${d.ad}`}
            />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px]" style={portalStyle({ color: MUTED })}>
        {dilimler.map((d) => (
          <span key={d.ad} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden className="inline-block h-2 w-2 flex-shrink-0 rounded-[2px]" style={portalStyle({ background: d.renk })} />
            <b className="font-semibold" style={portalStyle({ color: TEXT })}>
              {d.sayi}
            </b>
            {d.ad}
          </span>
        ))}
      </div>
    </>
  );
}

interface BaslikProps {
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
  onYeniGorev: () => void;
  sabahOzetiMesgul: boolean;
}

export function Baslik({ durum, ozet, pano, ajanSayisi, kararSayisi, calisan, bugunBiten, bugunYarim, isSayisi, sekme, onSekme, onSabahOzeti, onYeniGorev, sabahOzetiMesgul }: BaslikProps) {
  const sonSabah = durum?.sonSabahOzeti?.createdAt || null;
  const sabahBugun = !!sonSabah && bugunMu(sonSabah);
  const sabahDurum = sabahOzetiMesgul ? 'üretiliyor…' : sabahBugun ? `${saatKisa(sonSabah!).slice(0, 5)} gitti` : durum?.sabahOzeti ? '08:30' : 'kapalı';
  const donemAd = ozet ? donemEtiketi(ozet.beyannameDonem || ozet.donem) : null;
  const donemNotu = ozet?.donem && ozet.beyannameDonem && ozet.beyannameDonem !== ozet.donem ? `İşlem ayı ${donemEtiketi(ozet.donem)}` : undefined;
  const nabiz = ozet ? dilimleriCikar(ozet, pano) : null;
  const operatorAcik = !!durum?.operator?.acik;
  const maxKopuk = durum?.maxBagli === false;
  const ozetler = [
    { etiket: 'Çalışan', sayi: calisan, not: 'Devam eden işler', ton: 'petrol' },
    { etiket: 'Sizden beklenen', sayi: kararSayisi, not: 'Karar ve yanıtlar', ton: 'amber' },
    { etiket: 'Bugün tamamlanan', sayi: bugunBiten, not: 'Sonuçlanan işler', ton: 'yesil' },
    { etiket: 'Yarım kalan', sayi: bugunYarim, not: 'Bugün yeniden incelenecek', ton: 'gul' },
  ];
  const sekmeler: Array<{id: EkipSekme; etiket: string}> = [
    {id:'genel',etiket:'Genel bakış'}, {id:'isler',etiket:'İşler'}, {id:'pano',etiket:'Dönem panosu'}, {id:'kadro',etiket:'Kadro'},
  ];
  return (
    <header className="ekip-heading">
      <div className="ekip-heading-top">
        <div>
          <div className="ekip-eyebrow">OFİS OPERASYONLARI</div>
          <div className="ekip-heading-title"><h1>Ekip</h1><span>{ajanSayisi} personel</span></div>
          <p className="ekip-heading-description">Görevleri yönetin, ilerlemeyi izleyin, sonuçları inceleyin.</p>
        </div>
        <div className="ekip-heading-tools">
          <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="ekip-summary-button" onClick={onSabahOzeti} disabled={sabahOzetiMesgul} aria-busy={sabahOzetiMesgul} title="Sabah özetini şimdi üret (yalnız üretir, göndermez)">
            <span>Sabah özeti</span><small>{sabahDurum}</small>
          </button>
          <button type="button" className="ekip-new-task" onClick={onYeniGorev}>+ Yeni görev</button>
          </div>
          <div className="ekip-connections">
            <Durum nokta={operatorAcik ? OK : MUTED} title={durum?.operator?.cihaz ? `Cihaz: ${durum.operator.cihaz}` : undefined}>Luca {operatorAcik ? 'açık' : 'kapalı'}</Durum>
            <Durum nokta={!durum ? MUTED : maxKopuk ? KIRMIZI : OK}>Max {!durum ? 'kontrol ediliyor' : maxKopuk ? 'bağlı değil' : 'bağlı'}</Durum>
          </div>
        </div>
      </div>
      <div className="ekip-summary-grid">
        {ozetler.map((o)=><div key={o.ton} className="ekip-summary-item" data-tone={o.ton}>
          <span className="ekip-summary-label">{o.etiket}</span><strong>{o.sayi}</strong><small>{o.not}</small>
        </div>)}
      </div>
      <div className="ekip-navigation-line">
        <nav role="tablist" aria-label="Ekip bölümleri" className="ekip-navigation">
          {sekmeler.map(s=><button key={s.id} type="button" role="tab" aria-selected={sekme===s.id} onClick={()=>onSekme(s.id)}>{s.etiket}{s.id==='isler' && isSayisi>0 && <span>{isSayisi}</span>}</button>)}
        </nav>
        {donemAd && <span className="ekip-period-label" title={donemNotu}>{donemAd} beyannameleri</span>}
      </div>
      {sekme==='pano' && <div className="ekip-period-progress">
        {nabiz ? <><div className="flex items-center justify-between gap-3 text-xs"><span>Dönem ilerlemesi · {nabiz.toplam} mükellef</span><strong>{nabiz.verildi} / {nabiz.toplam} verildi</strong></div><AsamaSeridi dilimler={nabiz.dilimler} toplam={nabiz.toplam}/></> : <p role="status">Dönem panosu yükleniyor…</p>}
      </div>}
    </header>
  );
}
