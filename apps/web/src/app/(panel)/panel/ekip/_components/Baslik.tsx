'use client';

import { Bell, CalendarDays, CheckCircle2, Clock3, LayoutGrid, ListChecks, Sun, Users } from 'lucide-react';
import type { EkipDurum, PanoDonemOzeti } from '@/lib/ekip';
import { CARD_BORDER, GOLD, KPI, MAVI, MOR, MUTED, OK, Rozet, Sekmeler, TEXT } from './Tema';
import { bugunMu, donemEtiketi, saatKisa } from './ortak';

export type EkipSekme = 'genel' | 'isler' | 'pano' | 'kadro';

/** Koyu kapsül (Bütçe başlığındaki dönem seçici görünümü): nokta/simge + metin. */
function Kapsul({ children, nokta, title }: { children: React.ReactNode; nokta?: string; title?: string }) {
  return (
    <span className="inline-flex h-8 flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-[12px]" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CARD_BORDER}`, color: MUTED }} title={title}>
      {nokta && <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: nokta, boxShadow: `0 0 8px ${nokta}66` }} />}
      {children}
    </span>
  );
}

/**
 * Başlık kartı (altın parıltı) + 4 sayaç kutusu + altın sekme şeridi — Bütçe sayfasının iskeleti.
 * Sayılar: Sizden beklenen (onay+istek) · Şu an çalışan · Bugün biten (yarım kalan alt bilgi) · Dönem (verildi / toplam).
 */
export function Baslik({
  durum,
  ozet,
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
  const donemAd = ozet ? donemEtiketi(ozet.beyannameDonem || ozet.donem) : null;
  const verildi = ozet?.ozet.beyanname ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* Başlık kartı */}
      <header
        className="relative overflow-hidden rounded-2xl px-5 py-4"
        style={{ background: `linear-gradient(140deg, ${GOLD}17, rgba(255,255,255,0.01) 58%)`, border: `1px solid ${CARD_BORDER}` }}
      >
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-25" style={{ background: `radial-gradient(circle, ${GOLD}, transparent 66%)` }} />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-[17px] font-semibold" style={{ color: TEXT }}>
              Ekip
              <Rozet metin={`${ajanSayisi || 12} personel`} />
            </h1>
            <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
              Yapay çalışan kadronuz — görev verin, ilerlemeyi izleyin, kararı siz verin.
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {donemAd && (
              <Kapsul title={ozet?.donem && ozet.beyannameDonem && ozet.beyannameDonem !== ozet.donem ? `İşlem ayı ${donemEtiketi(ozet.donem)}` : undefined}>
                <CalendarDays size={13} style={{ color: GOLD }} />
                <b className="font-medium" style={{ color: GOLD }}>
                  {donemAd}
                </b>
                beyannameleri
              </Kapsul>
            )}
            <Kapsul nokta={durum?.operator?.acik ? OK : MUTED} title={durum?.operator?.cihaz ? `Cihaz: ${durum.operator.cihaz}` : undefined}>
              Luca operatörü{durum?.operator?.acik ? ' açık' : ' kapalı'}
            </Kapsul>
            <Kapsul nokta={durum?.maxBagli === false ? '#e0697a' : OK}>Max{durum?.maxBagli === false ? ' bağlı değil' : ' bağlı'}</Kapsul>
            <button
              type="button"
              onClick={onSabahOzeti}
              disabled={sabahOzetiMesgul}
              title="Sabah özetini şimdi üret (yalnız üretir, göndermez)"
              className="inline-flex h-8 flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-[12px] transition hover:brightness-125 disabled:opacity-60"
              style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CARD_BORDER}`, color: MUTED }}
            >
              <Sun size={13} style={{ color: GOLD }} />
              Sabah özeti
              <b className="font-medium" style={{ color: GOLD }}>
                {sabahOzetiMesgul ? 'üretiliyor…' : sabahBugun ? `${saatKisa(sonSabah!).slice(0, 5)} gitti` : durum?.sabahOzeti ? '08:30' : 'kapalı'}
              </b>
            </button>
          </div>
        </div>
      </header>

      {/* Sayaç kutuları */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KPI etiket="Sizden beklenen" deger={String(kararSayisi)} altBilgi={kararSayisi ? 'onay ve istekler — Genel bakış > Sizden beklenen' : 'bekleyen karar yok'} renk={GOLD} ikon={<Bell size={13} />} vurgu={kararSayisi > 0} />
        <KPI etiket="Şu an çalışan" deger={String(calisan)} altBilgi={calisan ? 'personel iş başında' : 'kadro boşta'} renk={MAVI} ikon={<Clock3 size={13} />} vurgu={calisan > 0} />
        <KPI etiket="Bugün biten" deger={String(bugunBiten)} altBilgi={bugunYarim ? `${bugunYarim} yarım kaldı` : bugunBiten ? 'hepsi tamamlandı' : 'henüz iş bitmedi'} renk={OK} ikon={<CheckCircle2 size={13} />} />
        <KPI
          etiket="Dönem"
          deger={ozet ? `${verildi ?? 0} / ${ozet.toplam}` : '—'}
          altBilgi={ozet ? `verildi · hazır ${ozet.ozet.beyannameHazir} · kontrol ${ozet.ozet.kontrol} · işleme ${ozet.ozet.isleme}` : 'pano yükleniyor'}
          renk={MOR}
          ikon={<CalendarDays size={13} />}
        />
      </div>

      {/* Sekmeler */}
      <Sekmeler<EkipSekme>
        secili={sekme}
        onSec={onSekme}
        sekmeler={[
          { id: 'genel', etiket: 'Genel bakış', ikon: <LayoutGrid size={13} /> },
          { id: 'isler', etiket: 'İşler', ikon: <ListChecks size={13} />, rozet: isSayisi || null },
          { id: 'pano', etiket: 'Dönem panosu', ikon: <CalendarDays size={13} /> },
          { id: 'kadro', etiket: 'Kadro', ikon: <Users size={13} /> },
        ]}
      />
    </div>
  );
}
