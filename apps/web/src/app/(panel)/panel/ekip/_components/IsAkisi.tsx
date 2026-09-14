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
import { KUTULAR, SAKIN, vakaSirasi } from './ortak';

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
 * CANLI AKIŞ — ana alan. SAKİN (PLAN/19 §A.3-4): alt çizgili sade sekmeler (sayı gri; onay/istek >0 ise kehribar) + sağda gün ve mükellef süzgeci.
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
      {/* Sekmeler (alt çizgi) · gün · mükellef · yenile */}
      <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-end md:justify-between" style={{ borderBottom: `1px solid ${SAKIN.kilcal}` }}>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
          {KUTULAR.map((k) => {
            const aktif = suzgec === k.id;
            const sayi = k.sayacAnahtari ? sayaclar?.[k.sayacAnahtari] ?? 0 : null;
            const dikkat = (k.id === 'onay' || k.id === 'istek') && !!sayi;
            return (
              <button
                key={k.id}
                type="button"
                role="tab"
                onClick={() => onSuzgec(k.id)}
                aria-selected={aktif}
                className="-mb-px inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 pb-2 pt-1 text-[12.5px] transition-colors duration-150"
                style={{
                  color: aktif ? SAKIN.metin : dikkat ? SAKIN.kehribar : SAKIN.ikincil,
                  fontWeight: aktif ? 600 : 500,
                  borderBottom: `2px solid ${aktif ? SAKIN.vurgu : 'transparent'}`,
                }}
              >
                {k.ad}
                {sayi != null && (
                  <span className="tabular-nums text-[11px]" style={{ color: dikkat ? SAKIN.kehribar : aktif ? SAKIN.ikincil : SAKIN.soluk }}>
                    {sayi}
                  </span>
                )}
              </button>
            );
          })}
          {!!sayaclar?.gecikti && (
            <span className="ml-2 flex-shrink-0 whitespace-nowrap pb-2 text-[11px]" style={{ color: SAKIN.kirmiziAcik }} title="2 devirden fazla dolaşan ya da 24 saatte çözülmeyen">
              {sayaclar.gecikti} gecikti
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 pb-2">
          <div className="inline-flex flex-shrink-0 items-center rounded-md p-[2px]" style={{ background: SAKIN.alan, border: `1px solid ${SAKIN.cizgi}` }}>
            {GUNLER.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onGun(g.id)}
                aria-pressed={gun === g.id}
                className="rounded px-2 py-0.5 text-[11px] font-semibold transition-colors duration-150"
                style={gun === g.id ? { background: SAKIN.zeminAcik, color: SAKIN.metin } : { background: 'transparent', color: SAKIN.ikincil }}
              >
                {g.ad}
              </button>
            ))}
          </div>
          <div className="w-[220px] min-w-0">
            <MukellefSecici mukellefler={mukellefler} value={taxpayerId} onChange={onTaxpayerId} renk={SAKIN.vurgu} />
          </div>
          {akis && (
            <span className="text-[11px] tabular-nums" style={{ color: SAKIN.soluk }}>
              {vakalar.length} vaka
            </span>
          )}
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: ['ekip-akis'] })}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
            style={{ color: SAKIN.ikincil, border: `1px solid ${SAKIN.cizgi}` }}
            title="Akışı yenile"
          >
            <RefreshCw size={11} className={yenileniyor ? 'animate-spin' : ''} /> Yenile
          </button>
        </div>
      </div>

      {/* Liste — kendi içinde kayar */}
      <div className="max-h-[70vh] min-w-0 overflow-y-auto">
        <ul className="flex flex-col gap-1">
          {/* Geçici satırlar: eşleşmemiş yerel koşular */}
          {gecici.map((k) => (
            <li key={`gecici-${k.ajanId}-${k.basladi}`} className="overflow-hidden rounded-lg" style={{ background: SAKIN.zemin, border: `1px solid ${SAKIN.vurgu}55` }}>
              <div className="flex items-center gap-2 px-3 py-2 text-[12px]" style={{ color: SAKIN.metin }}>
                <MiniAvatar ajanId={k.ajanId} boyut={20} title={ajanAd(k.ajanId)} durum={!k.bitti ? 'calisiyor' : 'bos'} />
                {!k.bitti ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" style={{ color: SAKIN.vurguAcik }} /> Koordinatör başlıyor…
                  </span>
                ) : (
                  <span>Koordinatör {k.hata ? 'koşusu bitti (hata)' : 'koşusu bitti'} — akışa işleniyor</span>
                )}
                <span className="ml-auto truncate text-[11px]" style={{ color: SAKIN.ikincil }} title={k.gorev}>
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
            <li className="py-4 text-[12.5px]" style={{ color: SAKIN.kirmiziAcik }}>
              Akış alınamadı: {(error as any)?.message || 'hata'}
            </li>
          ) : isLoading && !akis ? (
            <li className="flex items-center justify-center gap-2 py-10 text-[12.5px]" style={{ color: SAKIN.ikincil }}>
              <Loader2 size={12} className="animate-spin" /> Akış yükleniyor…
            </li>
          ) : !vakalar.length && !gecici.length ? (
            <li>
              <BosDurum ikon={<Activity size={18} />} metin={suzgec === 'tumu' ? 'Bu pencerede iş yok — Koordinatör’e yukarıdan görev verin.' : 'Bu kutuda iş yok.'} />
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
