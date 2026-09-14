'use client';

import { useMemo } from 'react';
import { FileText, Loader2, RefreshCw, Search } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { isOmurgaYok, type Akis, type AkisFiltre, type AkisGun, type AkisSayaclari, type MukellefOzet, type Vaka } from '@/lib/ekip';
import { Anahtar, AvatarV5, CamKart, Dug, DurumSozu, Kapsul, V5 } from './Cam';
import { MukellefSecici } from './MukellefSecici';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { KUTULAR, ajanKisaAd, ajanKisaltma, tarihKisa, vakaSirasi } from './ortak';

/** Durum sözü rengi/metni (kutu + durum). */
function durumSozu(v: Vaka, kosuyor: boolean): { ad: string; renk: string; nabiz: boolean } {
  if (v.kutu === 'onay') return { ad: 'onayınızı bekliyor', renk: V5.amber, nabiz: false };
  if (v.kutu === 'istek') return { ad: 'kararınız bekleniyor', renk: V5.amber, nabiz: false };
  if (v.kutu === 'suruyor' || kosuyor) return { ad: 'sürüyor', renk: V5.mavi, nabiz: true };
  if (v.durum === 'hata') return { ad: 'yarım kaldı', renk: V5.coral, nabiz: false };
  if (v.kimde.ajanId === 'koordinator' && v.adimlar.filter((a) => a.tip === 'is').length === 1) return { ad: 'cevaplandı', renk: '#9cc0ff', nabiz: false };
  return { ad: 'bitti', renk: V5.mint, nabiz: false };
}

/** Günlük iş sayısı (son 7 gün) → küçük çizgi grafik. */
function Sparkline({ vakalar }: { vakalar: Vaka[] }) {
  const noktalar = useMemo(() => {
    const gunler: number[] = Array(7).fill(0);
    const simdi = Date.now();
    for (const v of vakalar) {
      const gun = Math.floor((simdi - new Date(v.olusturuldu).getTime()) / 86_400_000);
      if (gun >= 0 && gun < 7) gunler[6 - gun]++;
    }
    const enCok = Math.max(1, ...gunler);
    return gunler.map((n, i) => `${2 + (i * 116) / 6},${24 - (n / enCok) * 18}`);
  }, [vakalar]);
  const cizgi = noktalar.join(' ');
  return (
    <svg viewBox="0 0 120 26" width={120} height={26} aria-hidden>
      <polyline fill="rgba(110,163,255,0.15)" stroke="none" points={`${cizgi} 118,26 2,26`} />
      <polyline fill="none" stroke={V5.mavi} strokeWidth="2" strokeLinejoin="round" points={cizgi} />
    </svg>
  );
}

/**
 * İş kayıtları v5: kapsül süzgeçler (Tümü · Sürüyor · Onayınızı bekleyen · Sizden istenen · Bitti) + gün anahtarı + mükellef arama;
 * satırlar ayrı cam kartlar gibi: Tarih · Mükellef · Konu · Personel (avatar çipi) · Mod · Durum. Seçili satır mavi.
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
  const toplam = sayaclar ? sayaclar.suruyor + sayaclar.onay + sayaclar.istek + sayaclar.bitti : vakalar.length;
  const bittiN = vakalar.filter((v) => v.kutu === 'bitti' && v.durum !== 'hata').length;
  const hataN = vakalar.filter((v) => v.durum === 'hata').length;

  return (
    <CamKart
      ton="notr"
      etiket="İş kayıtları"
      ikon={<FileText size={17} />}
      baslik="Verilen görevler ve sonuçları"
      dolguYok
      sag={
        <>
          <Anahtar
            secenekler={[
              { id: 1 as AkisGun, etiket: 'Bugün' },
              { id: 7 as AkisGun, etiket: '7 gün' },
              { id: 30 as AkisGun, etiket: '30 gün' },
            ]}
            deger={gun}
            onChange={onGun}
          />
          <span className="inline-flex h-8 min-w-[230px] items-center gap-2 rounded-[10px] px-3 text-[12.5px]" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${V5.cizgi2}` }}>
            <Search size={13} style={{ color: V5.soluk }} />
            <span className="min-w-0 flex-1">
              <MukellefSecici sade yerTutucu="Mükellef ara…" mukellefler={mukellefler} value={taxpayerId} onChange={onTaxpayerId} renk={V5.mavi} />
            </span>
          </span>
          <Dug kucuk onClick={() => qc.invalidateQueries({ queryKey: ['ekip-akis'] })} title="Yenile">
            <RefreshCw size={12} className={yenileniyor ? 'animate-spin' : ''} /> Yenile
          </Dug>
        </>
      }
    >
      {/* Kapsül süzgeçler */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-5 pb-3" role="tablist">
        {KUTULAR.map((k) => {
          const aktif = suzgec === k.id;
          const sayi = k.id === 'tumu' ? toplam : k.sayacAnahtari ? sayaclar?.[k.sayacAnahtari] ?? 0 : null;
          const dikkat = (k.id === 'onay' || k.id === 'istek') && !!sayi;
          return (
            <button
              key={k.id}
              type="button"
              role="tab"
              aria-selected={aktif}
              onClick={() => onSuzgec(k.id)}
              className="inline-flex h-8 flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition-[filter] hover:brightness-125"
              style={
                aktif
                  ? { background: 'linear-gradient(180deg, rgba(110,163,255,0.28), rgba(110,163,255,0.12))', border: '1px solid rgba(110,163,255,0.5)', color: '#fff' }
                  : dikkat
                    ? { background: 'rgba(242,182,77,0.08)', border: '1px solid rgba(242,182,77,0.5)', color: '#ffd27a' }
                    : { background: 'rgba(255,255,255,0.03)', border: `1px solid ${V5.cizgi}`, color: V5.ikincil }
              }
            >
              {k.ad}
              {sayi != null && (
                <span className="rounded-full px-[7px] py-px text-[11px]" style={{ fontFamily: V5.mono, background: 'rgba(0,0,0,0.35)', border: `1px solid ${V5.cizgi}` }}>
                  {sayi}
                </span>
              )}
            </button>
          );
        })}
        {!!sayaclar?.gecikti && (
          <Kapsul tur="hata" nokta title="2 devirden fazla dolaşan ya da 24 saatte çözülmeyen">
            {sayaclar.gecikti} gecikti
          </Kapsul>
        )}
      </div>

      {/* Satırlar */}
      <div className="px-5">
        {omurgaYok ? (
          <div className="pb-5">
            <OmurgaYokBilgi kucuk />
          </div>
        ) : error ? (
          <div className="pb-5 text-[12.5px]" style={{ color: V5.coral }}>
            Geçmiş alınamadı: {(error as any)?.message || 'hata'}
          </div>
        ) : isLoading && !akis ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12.5px]" style={{ color: V5.ikincil }}>
            <Loader2 size={12} className="animate-spin" /> Geçmiş yükleniyor…
          </div>
        ) : !vakalar.length ? (
          <div className="rounded-xl px-4 py-8 text-center text-[13px]" style={{ background: 'rgba(255,255,255,0.03)', border: `1px dashed ${V5.cizgi2}`, color: V5.ikincil }}>
            {suzgec === 'tumu' ? 'Bu pencerede iş yok — yukarıdan Koordinatör’e görev verin.' : 'Bu kutuda iş yok.'}
          </div>
        ) : (
          <div className="overflow-x-auto [scrollbar-width:thin]">
            <table className="w-full min-w-[820px]" style={{ borderCollapse: 'separate', borderSpacing: '0 6px' }}>
              <thead>
                <tr>
                  {['Tarih', 'Mükellef', 'Konu', 'Personel', 'Mod', 'Durum'].map((b) => (
                    <th key={b} className="px-3.5 pb-1.5 pt-1 text-left text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: V5.soluk }}>
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vakalar.map((v) => {
                  const secili = seciliVakaId === v.vakaId;
                  const siz = v.kimde.ajanId === 'siz';
                  const kosuyor = v.adimlar.some((a) => a.tip === 'is' && a.durum === 'running');
                  const d = durumSozu(v, kosuyor);
                  const personelAdimlari = v.adimlar.filter((a) => a.tip === 'is');
                  const sonPersonel = [...personelAdimlari].reverse().find((a) => a.tip === 'is' && a.ajanId !== 'koordinator') as { ajanId: string } | undefined;
                  const personelId = siz ? (sonPersonel?.ajanId || 'koordinator') : v.kimde.ajanId;
                  const hucre: React.CSSProperties = secili
                    ? { background: 'linear-gradient(90deg, rgba(110,163,255,0.18), rgba(110,163,255,0.06))', borderTop: '1px solid rgba(110,163,255,0.45)', borderBottom: '1px solid rgba(110,163,255,0.45)' }
                    : { background: 'rgba(255,255,255,0.035)', borderTop: `1px solid ${V5.cizgi}`, borderBottom: `1px solid ${V5.cizgi}` };
                  const kenarRenk = secili ? 'rgba(110,163,255,0.45)' : V5.cizgi;
                  return (
                    <tr key={v.vakaId} onClick={() => onSec(v)} className="cursor-pointer transition-[filter] hover:brightness-125" aria-current={secili} title="İşi yukarıdaki panelde aç">
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-[11.5px]" style={{ ...hucre, borderLeft: `1px solid ${kenarRenk}`, borderRadius: '12px 0 0 12px', fontFamily: V5.mono, color: V5.soluk }}>
                        {tarihKisa(v.olusturuldu)}
                      </td>
                      <td className="max-w-[220px] truncate px-3.5 py-2.5 text-[12.8px] font-bold" style={{ ...hucre, color: V5.metin }} title={v.mukellef?.ad || 'Ofis geneli'}>
                        {v.mukellef?.ad || 'Ofis geneli'}
                      </td>
                      <td className="max-w-[320px] truncate px-3.5 py-2.5 text-[12.8px]" style={{ ...hucre, color: V5.ikincil }} title={v.konu}>
                        {v.konu || 'Konu yok'}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-[12.5px]" style={{ ...hucre, color: V5.ikincil }}>
                        <span className="inline-flex items-center gap-2">
                          <AvatarV5 kisaltma={ajanKisaltma(personelId)} ton={personelId === 'koordinator' ? 'altin' : 'mavi'} boyut={22} kare />
                          {ajanKisaAd(personelId, ajanAd(personelId))}
                          {siz && <span style={{ color: V5.soluk }}>→ siz</span>}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5" style={hucre}>
                        <Kapsul tur={v.kuru ? 'kuru' : 'canli'}>{v.kuru ? 'kuru' : 'canlı'}</Kapsul>
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5" style={{ ...hucre, borderRight: `1px solid ${kenarRenk}`, borderRadius: '0 12px 12px 0' }}>
                        <DurumSozu renk={d.renk} nabiz={d.nabiz}>
                          {d.ad}
                        </DurumSozu>
                        {v.gecikti && (
                          <Kapsul tur="hata" className="ml-2">
                            gecikti
                          </Kapsul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {akis && vakalar.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-4 pt-3 text-[12px]" style={{ color: V5.soluk }}>
          <span>
            {gun === 1 ? 'Bugün' : `Son ${gun} günde`} {vakalar.length} iş · {bittiN} bitti{hataN ? ` · ${hataN} yarım kaldı` : ''} · satıra tıklayınca iş yukarıdaki panelde açılır
          </span>
          {gun !== 1 && (
            <span className="inline-flex items-center gap-2.5" style={{ color: V5.ikincil }}>
              Günlük iş <Sparkline vakalar={vakalar} />
            </span>
          )}
        </div>
      )}
    </CamKart>
  );
}
