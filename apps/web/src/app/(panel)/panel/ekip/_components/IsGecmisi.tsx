'use client';

import { useMemo } from 'react';
import { Activity, Loader2, RefreshCw, ChevronRight } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { isOmurgaYok, type Akis, type AkisFiltre, type AkisGun, type AkisSayaclari, type MukellefOzet, type Vaka } from '@/lib/ekip';
import { Avatar, BosDurum, DurumKelimesi, Kart, Rozet } from './Kart';
import { MukellefSecici } from './MukellefSecici';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { KUTULAR, TEMA, ajanKisaAd, ajanKisaltma, goreliSaat, kutuRozeti, vakaSirasi } from './ortak';

const GUNLER: Array<{ id: AkisGun; ad: string }> = [
  { id: 1, ad: 'Bugün' },
  { id: 7, ad: '7 gün' },
  { id: 30, ad: '30 gün' },
];

/**
 * İş geçmişi v3 — tablo gibi düzenli satırlar: kimde · mükellef · konu · adım · zaman · durum. Tıklanan iş üstteki iş panelinde açılır.
 * Süzgeç: sekmeler (Tümü · Sürüyor · Onayınızı bekleyen · Sizden istenen · Bitti), gün, mükellef.
 */
export function IsGecmisi({ akis, isLoading, error, sayaclar, suzgec, onSuzgec, gun, onGun, taxpayerId, onTaxpayerId, mukellefler, seciliVakaId, onSec, ajanAd }: {
  akis: Akis | undefined;
  isLoading: boolean;
  error: unknown;
  sayaclar: AkisSayaclari | undefined;
  suzgec: AkisFiltre;
  onSuzgec: (f: AkisFiltre) => void;
  gun: AkisGun;
  onGun: (g: AkisGun) => void;
  taxpayerId: string;
  onTaxpayerId: (id: string) => void;
  mukellefler: MukellefOzet[];
  seciliVakaId: string | null;
  onSec: (v: Vaka) => void;
  ajanAd: (id: string) => string;
}) {
  const qc = useQueryClient();
  const yenileniyor = useIsFetching({ queryKey: ['ekip-akis'] }) > 0;
  const vakalar = useMemo(() => [...(akis?.vakalar || [])].sort(vakaSirasi), [akis?.vakalar]);
  const omurgaYok = isOmurgaYok(error);

  return (
    <Kart
      renk={TEMA.mavi}
      baslik="İş geçmişi"
      aciklama="Verilen her görev bir iş zinciridir; satıra tıklayınca yukarıdaki panelde açılır."
      dolguYok
      sag={
        <>
          <div className="inline-flex flex-shrink-0 items-center rounded-lg p-[3px]" style={{ background: TEMA.alanZemin, border: `1px solid ${TEMA.alanKenar}` }}>
            {GUNLER.map((g) => (
              <button key={g.id} type="button" onClick={() => onGun(g.id)} aria-pressed={gun === g.id} className="rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors duration-150" style={gun === g.id ? { background: 'rgba(255,255,255,0.08)', color: TEMA.metin } : { background: 'transparent', color: TEMA.ikincil }}>
                {g.ad}
              </button>
            ))}
          </div>
          <div className="w-[220px] min-w-0">
            <MukellefSecici mukellefler={mukellefler} value={taxpayerId} onChange={onTaxpayerId} renk={TEMA.mavi} />
          </div>
          <button type="button" onClick={() => qc.invalidateQueries({ queryKey: ['ekip-akis'] })} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px]" style={{ color: TEMA.ikincil, border: `1px solid ${TEMA.alanKenar}` }} title="Yenile">
            <RefreshCw size={11} className={yenileniyor ? 'animate-spin' : ''} /> Yenile
          </button>
        </>
      }
    >
      {/* Sekmeler */}
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-5 [scrollbar-width:none]" style={{ borderBottom: `1px solid ${TEMA.satirCizgi}` }} role="tablist">
        {KUTULAR.map((k) => {
          const aktif = suzgec === k.id;
          const sayi = k.sayacAnahtari ? sayaclar?.[k.sayacAnahtari] ?? 0 : null;
          const dikkat = (k.id === 'onay' || k.id === 'istek') && !!sayi;
          const renk = k.id === 'onay' ? TEMA.altin : k.id === 'istek' ? TEMA.turuncu : k.id === 'bitti' ? TEMA.yesil : TEMA.mavi;
          return (
            <button key={k.id} type="button" role="tab" aria-selected={aktif} onClick={() => onSuzgec(k.id)} className="-mb-px inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap px-3 pb-2.5 pt-1 text-[12.5px] transition-colors duration-150" style={{ color: aktif ? TEMA.metin : dikkat ? renk : TEMA.ikincil, fontWeight: aktif ? 600 : 500, borderBottom: `2px solid ${aktif ? renk : 'transparent'}` }}>
              {k.ad}
              {sayi != null && (
                <span className="rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums" style={{ background: dikkat || aktif ? `${renk}22` : 'rgba(255,255,255,0.06)', color: dikkat ? renk : aktif ? TEMA.metin : TEMA.soluk }}>
                  {sayi}
                </span>
              )}
            </button>
          );
        })}
        {!!sayaclar?.gecikti && (
          <span className="ml-2 flex-shrink-0 pb-2.5 text-[11px]" style={{ color: TEMA.kirmizi }} title="2 devirden fazla dolaşan ya da 24 saatte çözülmeyen">
            {sayaclar.gecikti} gecikti
          </span>
        )}
        {akis && (
          <span className="ml-auto flex-shrink-0 pb-2.5 text-[11px] tabular-nums" style={{ color: TEMA.soluk }}>
            {vakalar.length} iş
          </span>
        )}
      </div>

      {/* Satırlar */}
      <div className="max-h-[560px] overflow-y-auto [scrollbar-width:thin]">
        {omurgaYok ? (
          <div className="p-5">
            <OmurgaYokBilgi kucuk />
          </div>
        ) : error ? (
          <div className="px-5 py-4 text-[12.5px]" style={{ color: TEMA.kirmizi }}>
            Geçmiş alınamadı: {(error as any)?.message || 'hata'}
          </div>
        ) : isLoading && !akis ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12.5px]" style={{ color: TEMA.ikincil }}>
            <Loader2 size={12} className="animate-spin" /> Geçmiş yükleniyor…
          </div>
        ) : !vakalar.length ? (
          <BosDurum ikon={<Activity size={18} />} metin={suzgec === 'tumu' ? 'Bu pencerede iş yok — yukarıdan Koordinatör’e görev verin.' : 'Bu kutuda iş yok.'} />
        ) : (
          <ul>
            {vakalar.map((v) => {
              const rozet = kutuRozeti(v);
              const secili = seciliVakaId === v.vakaId;
              const siz = v.kimde.ajanId === 'siz';
              const kosuyor = v.adimlar.some((a) => a.tip === 'is' && a.durum === 'running');
              const adimSayisi = v.adimlar.filter((a) => a.tip === 'is').length;
              return (
                <li key={v.vakaId} style={{ borderTop: `1px solid ${TEMA.satirCizgi}` }}>
                  <button type="button" onClick={() => onSec(v)} className="flex w-full min-w-0 items-center gap-3 px-5 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.03]" style={{ background: secili ? `${TEMA.mavi}12` : 'transparent', boxShadow: secili ? `inset 3px 0 0 ${TEMA.mavi}` : 'none' }} aria-current={secili}>
                    <Avatar kisaltma={siz ? 'MB' : ajanKisaltma(v.kimde.ajanId)} boyut={28} durum={siz ? 'siz' : kosuyor ? 'calisiyor' : v.durum === 'hata' ? 'hata' : 'bos'} title={siz ? 'Muzaffer Bey' : ajanAd(v.kimde.ajanId)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-x-2">
                        <span className="max-w-[40%] truncate text-[12.5px] font-semibold" style={{ color: TEMA.metin }} title={v.mukellef?.ad || 'Ofis geneli'}>
                          {v.mukellef?.ad || 'Ofis geneli'}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: TEMA.ikincil }} title={v.konu}>
                          {v.konu || 'Konu yok'}
                        </span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px]" style={{ color: TEMA.soluk }}>
                        <span>kimde: {siz ? 'Siz' : ajanKisaAd(v.kimde.ajanId, v.kimde.ad)}</span>
                        {adimSayisi > 1 && <span>{adimSayisi} personel adımı</span>}
                        <span className="tabular-nums">{goreliSaat(v.guncellendi)}</span>
                        {!v.kuru && <Rozet renk={TEMA.kirmizi}>canlı</Rozet>}
                        {v.gecikti && <Rozet renk={TEMA.kirmizi}>gecikti</Rozet>}
                      </span>
                    </span>
                    <DurumKelimesi renk={rozet.renk} nabiz={rozet.nabiz && kosuyor}>
                      {rozet.ad}
                    </DurumKelimesi>
                    <ChevronRight size={14} style={{ color: secili ? TEMA.mavi : TEMA.soluk }} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Kart>
  );
}
