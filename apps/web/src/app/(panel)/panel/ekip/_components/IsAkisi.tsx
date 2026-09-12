'use client';

import { useMemo } from 'react';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { isOmurgaYok, type Akis, type AkisFiltre, type AkisGun, type AkisSayaclari, type MukellefOzet, type Vaka } from '@/lib/ekip';
import type { KomutTaslak } from './KomutKutusu';
import type { Kosu, KosularApi } from './kosular';
import { BosDurum } from './Kart';
import { CanliAkis } from './CanliAkis';
import { MukellefSecici } from './MukellefSecici';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { VakaSatiri, MiniAvatar } from './VakaSatiri';
import { EKIP_ACCENT, KUTULAR, RENK, vakaSirasi } from './ortak';

const GUNLER: Array<{ id: AkisGun; ad: string }> = [
  { id: 1, ad: 'Bugün' },
  { id: 7, ad: '7 gün' },
  { id: 30, ad: '30 gün' },
];

/** Yerel koşu bu vakaya mı ait: vakaId eşleşir ya da isId vaka kökü / adımlarından biri. */
export function kosuVakayaAitMi(kosu: Kosu, vaka: Vaka): boolean {
  if (kosu.vakaId && kosu.vakaId === vaka.vakaId) return true;
  if (kosu.isId && kosu.isId === vaka.vakaId) return true;
  return !!kosu.isId && vaka.adimlar.some((a) => a.tip === 'is' && a.isId === kosu.isId);
}

/**
 * CANLI AKIŞ — ana alan. Üstte beş sayaç-süzgeç hapı (tek seçim) + gün seçici + mükellef süzgeci; altta vaka satırları.
 * Sıralama: onay/istek → sürüyor → bitti; her grupta guncellendi desc. Liste kendi içinde kayar (max-h 70vh).
 * Eşleşmemiş yerel koşu (isId henüz gelmedi / akış henüz tazelenmedi) listenin en üstünde geçici satır olarak akar.
 */
export function IsAkisi({
  akis,
  isLoading,
  error,
  sayaclar,
  suzgec,
  onSuzgec,
  gun,
  onGun,
  taxpayerId,
  onTaxpayerId,
  mukellefler,
  acikVakaId,
  onAcikVakaId,
  kosular,
  ajanAd,
  onTaslak,
}: {
  akis: Akis | undefined;
  isLoading: boolean;
  error: unknown;
  /** durum.akis ?? akis.sayaclar (süzgeçten bağımsız). */
  sayaclar: AkisSayaclari | undefined;
  suzgec: AkisFiltre;
  onSuzgec: (f: AkisFiltre) => void;
  gun: AkisGun;
  onGun: (g: AkisGun) => void;
  taxpayerId: string;
  onTaxpayerId: (id: string) => void;
  mukellefler: MukellefOzet[];
  acikVakaId: string | null;
  onAcikVakaId: (id: string | null) => void;
  kosular: KosularApi;
  ajanAd: (id: string) => string;
  onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void;
}) {
  const qc = useQueryClient();
  const yenileniyor = useIsFetching({ queryKey: ['ekip-akis'] }) > 0;

  const vakalar = useMemo(() => [...(akis?.vakalar || [])].sort(vakaSirasi), [akis?.vakalar]);

  // Yerel koşular → vaka eşlemesi; eşleşmeyenler geçici satır
  const { eslesme, gecici } = useMemo(() => {
    const eslesme = new Map<string, Kosu>();
    const gecici: Kosu[] = [];
    for (const k of kosular.kosular.values()) {
      const v = vakalar.find((x) => kosuVakayaAitMi(k, x));
      if (v) eslesme.set(v.vakaId, k);
      else gecici.push(k);
    }
    return { eslesme, gecici };
  }, [kosular.kosular, vakalar]);

  const omurgaYok = isOmurgaYok(error);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Beş sayaç-süzgeç hapı · gün seçici · mükellef süzgeci */}
      <div className="flex flex-col gap-2 pb-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {KUTULAR.map((k) => {
            const aktif = suzgec === k.id;
            const sayi = k.sayacAnahtari ? sayaclar?.[k.sayacAnahtari] ?? 0 : null;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => onSuzgec(k.id)}
                aria-pressed={aktif}
                className="inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[11.5px] font-semibold transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-px"
                style={
                  aktif
                    ? { background: `linear-gradient(135deg, ${k.renk}, ${k.renk}bb)`, border: '1px solid transparent', color: '#0b1218' }
                    : { background: sayi ? `${k.renk}10` : 'transparent', border: `1px solid ${sayi ? `${k.renk}55` : 'rgba(255,255,255,0.10)'}`, color: sayi ? k.renk : RENK.ikincil }
                }
              >
                {k.ad}
                {sayi != null && (
                  <span className="rounded-full px-1.5 text-[10px] font-bold leading-4 tabular-nums" style={aktif ? { background: 'rgba(0,0,0,0.22)' } : { background: `${k.renk}22` }}>
                    {sayi}
                  </span>
                )}
              </button>
            );
          })}
          {!!sayaclar?.gecikti && (
            <span className="ml-1 flex-shrink-0 whitespace-nowrap text-[10.5px] font-semibold" style={{ color: RENK.kirmizi }} title="2 devirden fazla dolaşan ya da 24 saatte çözülmeyen">
              {sayaclar.gecikti} gecikti
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="inline-flex flex-shrink-0 items-center rounded-full p-[2px]" style={{ background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {GUNLER.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onGun(g.id)}
                aria-pressed={gun === g.id}
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-[background-color,color] duration-150"
                style={gun === g.id ? { background: `${EKIP_ACCENT}22`, color: EKIP_ACCENT } : { background: 'transparent', color: RENK.ikincil }}
              >
                {g.ad}
              </button>
            ))}
          </div>
          <div className="min-w-[180px] max-w-[300px] flex-1">
            <MukellefSecici mukellefler={mukellefler} value={taxpayerId} onChange={onTaxpayerId} renk={EKIP_ACCENT} />
          </div>
          <span className="ml-auto flex items-center gap-2">
            {akis && (
              <span className="text-[11px] tabular-nums" style={{ color: RENK.sonuk }}>
                {vakalar.length} vaka
              </span>
            )}
            <button
              type="button"
              onClick={() => qc.invalidateQueries({ queryKey: ['ekip-akis'] })}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]"
              style={{ color: RENK.ikincil, border: '1px solid rgba(255,255,255,0.10)' }}
              title="Akışı yenile"
            >
              <RefreshCw size={11} className={yenileniyor ? 'animate-spin' : ''} /> Yenile
            </button>
          </span>
        </div>
      </div>

      {/* Liste — kendi içinde kayar */}
      <div className="max-h-[70vh] min-w-0 overflow-y-auto">
        <ul className="flex flex-col gap-1.5">
          {/* Geçici satırlar: eşleşmemiş yerel koşular */}
          {gecici.map((k) => (
            <li key={`gecici-${k.ajanId}-${k.basladi}`} className="overflow-hidden rounded-xl" style={{ background: `${EKIP_ACCENT}0c`, border: `1px solid ${EKIP_ACCENT}44` }}>
              <div className="flex items-center gap-2 px-3 py-2 text-[12px]" style={{ color: RENK.metin }}>
                <MiniAvatar ajanId={k.ajanId} boyut={20} title={ajanAd(k.ajanId)} />
                {!k.bitti ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" style={{ color: EKIP_ACCENT }} /> Koordinatör başlıyor…
                  </span>
                ) : (
                  <span>Koordinatör {k.hata ? 'koşusu bitti (hata)' : 'koşusu bitti'} — akışa işleniyor</span>
                )}
                <span className="ml-auto truncate text-[11px]" style={{ color: RENK.ikincil }} title={k.gorev}>
                  {k.gorev}
                </span>
              </div>
              <div className="px-3 pb-3">
                <CanliAkis
                  kosu={k}
                  kosular={kosular}
                  onCevapla={(metin) => onTaslak({ gorev: `Cevap: ${metin}`, taxpayerId: k.taxpayerId, dryRun: true, kaynak: 'cevap', vakaId: k.vakaId || k.isId })}
                  onKapat={() => kosular.kaldir(k.ajanId)}
                />
              </div>
            </li>
          ))}

          {omurgaYok ? (
            <li>
              <OmurgaYokBilgi kucuk />
            </li>
          ) : error ? (
            <li className="py-4 text-[12.5px]" style={{ color: '#fca5a5' }}>
              Akış alınamadı: {(error as any)?.message || 'hata'}
            </li>
          ) : isLoading && !akis ? (
            <li className="flex items-center justify-center gap-2 py-10 text-[12.5px]" style={{ color: RENK.ikincil }}>
              <Loader2 size={12} className="animate-spin" /> Akış yükleniyor…
            </li>
          ) : !vakalar.length && !gecici.length ? (
            <li>
              <BosDurum ikon={<Activity size={18} />} renk={EKIP_ACCENT} metin={suzgec === 'tumu' ? 'Bu pencerede iş yok — Koordinatör’e yukarıdan görev verin.' : 'Bu kutuda iş yok.'} />
            </li>
          ) : (
            vakalar.map((v) => (
              <VakaSatiri
                key={v.vakaId}
                vaka={v}
                acik={acikVakaId === v.vakaId}
                onToggle={() => onAcikVakaId(acikVakaId === v.vakaId ? null : v.vakaId)}
                kosu={eslesme.get(v.vakaId)}
                kosular={kosular}
                ajanAd={ajanAd}
                onTaslak={onTaslak}
              />
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
