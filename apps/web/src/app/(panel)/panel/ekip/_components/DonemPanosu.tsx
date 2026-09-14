'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Loader2, Search, AlertTriangle, CheckCircle2, Play } from 'lucide-react';
import { isOmurgaYok, type Pano, type PanoSatiri } from '@/lib/ekip';
import type { KomutTaslak } from './GorevKarti';
import { CamKart, Dug, Kapsul, V5 } from './Cam';
import { ASAMALAR, SABLONLAR, donemEtiketi, sablonDoldur, sonrakiAdim } from './ortak';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';

function asamaRengiV5(d?: string): string {
  if (d === 'tamam') return V5.mint;
  if (d === 'eksik') return V5.amber;
  return 'rgba(255,255,255,0.16)';
}

function AsamaNoktalari({ satir, donem }: { satir: PanoSatiri; donem: string }) {
  const d = satir.donemler?.find((x) => x.donem === donem);
  if (!d) return <span className="text-[11px]" style={{ color: V5.soluk }}>—</span>;
  return (
    <div className="flex items-center gap-1.5">
      {ASAMALAR.map((a) => {
        const durum = d.asamalar?.[a.key];
        const renk = asamaRengiV5(durum);
        return (
          <span key={a.key} className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[9.5px] font-bold" style={{ background: durum === 'tamam' ? `${renk}26` : 'rgba(0,0,0,0.3)', border: `1px solid ${durum ? renk : V5.cizgi2}`, color: durum === 'tamam' ? renk : durum === 'eksik' ? renk : V5.soluk, boxShadow: durum === 'tamam' ? `0 0 8px ${renk}55` : 'none' }} title={`${a.ad}: ${durum === 'tamam' ? 'tamam' : durum === 'eksik' ? 'eksik' : 'yok'}`}>
            {a.harf}
          </span>
        );
      })}
    </div>
  );
}

/** Satırın görev düğmesi etiketi (Muzaffer Bey 2026-09-15: "işlenmemişse İşle, kontrol edilmemişse Kontrol et"). */
function dugmeEtiketi(sira: number): string {
  if (sira === 0) return 'Araştır';
  if (sira === 2) return 'İşle';
  if (sira === 3) return 'Kontrol et';
  if (sira === 4) return 'Yeniden kontrol et';
  return 'Görev ver';
}

/**
 * Dönem panosu v5 (ana sütun): dönem sekmeleri · sıralama · eksikler · arama; özet satırı; mükellef × aşama tablosu
 * (E İ K H V harfli noktalar) + sonraki adım + görev düğmesi (İşle / Kontrol et — görev kutusunu doldurur, ÇALIŞTIRMAZ).
 */
export function DonemPanosu({
  pano,
  isLoading,
  error,
  seciliDonem,
  onDonemSec,
  onTaslak,
  eksiklerNonce,
}: {
  pano: Pano | undefined;
  isLoading: boolean;
  error: unknown;
  seciliDonem: string | null;
  onDonemSec: (d: string) => void;
  onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void;
  /** Başlık rozeti "beyanname hazır" → "Sadece eksikler" açılır. */
  eksiklerNonce: number;
}) {
  const [sadeceEksik, setSadeceEksik] = useState(false);
  const [arama, setArama] = useState('');
  const [siralama, setSiralama] = useState<'acil' | 'ad'>('acil');

  useEffect(() => {
    if (eksiklerNonce) setSadeceEksik(true);
  }, [eksiklerNonce]);

  const donemler = useMemo(() => {
    const s = new Set<string>();
    for (const o of pano?.donemOzetleri || []) if (o.donem) s.add(o.donem);
    for (const r of pano?.satirlar || []) for (const d of r.donemler || []) if (d.donem) s.add(d.donem);
    return [...s].sort().reverse().slice(0, 3);
  }, [pano]);

  const donem = seciliDonem && donemler.includes(seciliDonem) ? seciliDonem : donemler[0] || null;
  useEffect(() => {
    if (donem && donem !== seciliDonem) onDonemSec(donem);
  }, [donem]); // eslint-disable-line react-hooks/exhaustive-deps

  const ozet = pano?.donemOzetleri.find((o) => o.donem === donem);

  const satirlar = useMemo(() => {
    if (!pano || !donem) return [];
    const q = arama.trim().toLocaleLowerCase('tr-TR');
    const liste = pano.satirlar
      .map((s) => {
        const d = s.donemler.find((x) => x.donem === donem);
        const kayitVar = s.kayitVar?.[donem] ?? !!d;
        const adim = sonrakiAdim(d?.asamalar, kayitVar);
        const tamam = ASAMALAR.filter((a) => d?.asamalar?.[a.key] === 'tamam').length;
        return { s, d, kayitVar, adim, tamam };
      })
      .filter((r) => (!sadeceEksik || r.d?.asamalar?.gonderim !== 'tamam') && (!q || r.s.unvan.toLocaleLowerCase('tr-TR').includes(q)));
    if (siralama === 'acil') liste.sort((a, b) => a.adim.sira - b.adim.sira || a.s.unvan.localeCompare(b.s.unvan, 'tr'));
    else liste.sort((a, b) => a.s.unvan.localeCompare(b.s.unvan, 'tr'));
    return liste;
  }, [pano, donem, sadeceEksik, arama, siralama]);

  const verilmemis = (d: string) => {
    const o = pano?.donemOzetleri.find((x) => x.donem === d);
    if (!o) return 0;
    return Math.max(0, o.toplam - o.ozet.beyanname);
  };

  const cip = (aktif: boolean, onClick: () => void, metin: React.ReactNode, dikkat = false, title?: string, key?: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition-[filter] hover:brightness-125"
      style={
        aktif
          ? { background: dikkat ? 'rgba(242,182,77,0.16)' : 'linear-gradient(180deg, rgba(77,214,230,0.26), rgba(77,214,230,0.10))', border: `1px solid ${dikkat ? 'rgba(242,182,77,0.55)' : 'rgba(77,214,230,0.5)'}`, color: '#fff' }
          : { background: 'rgba(255,255,255,0.03)', border: `1px solid ${V5.cizgi}`, color: V5.ikincil }
      }
    >
      {metin}
    </button>
  );

  const baslik = ozet ? `${donemEtiketi(ozet.beyannameDonem || ozet.donem)} beyannameleri` : 'Mükellef × dönem aşamaları';

  return (
    <CamKart
      ton="cyan"
      etiket="Dönem panosu"
      ikon={<CalendarRange size={17} />}
      baslik={baslik}
      dolguYok
      sag={
        <>
          {donemler.map((d) => {
            const v = verilmemis(d);
            return cip(
              d === donem,
              () => onDonemSec(d),
              <>
                {d === donem ? donemEtiketi(d) : donemEtiketi(d).split(' ')[0]}
                {v > 0 && (
                  <span className="rounded-full px-[7px] py-px text-[11px]" style={{ fontFamily: V5.mono, background: 'rgba(0,0,0,0.35)', border: `1px solid ${V5.cizgi}`, color: '#ffd27a' }} title={`${v} verilmemiş`}>
                    {v}
                  </span>
                )}
              </>,
              false,
              undefined,
              d,
            );
          })}
          <span className="mx-1 h-5 w-px" style={{ background: V5.cizgi2 }} />
          {cip(siralama === 'acil', () => setSiralama('acil'), 'Acil önce')}
          {cip(siralama === 'ad', () => setSiralama('ad'), 'Ada göre')}
          {cip(sadeceEksik, () => setSadeceEksik((e) => !e), 'Sadece eksikler', true, 'Beyannamesi verilmemiş mükellefler')}
          <span className="inline-flex h-8 min-w-[190px] items-center gap-2 rounded-[10px] px-3 text-[12.5px]" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${V5.cizgi2}` }}>
            <Search size={13} style={{ color: V5.soluk }} />
            <input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Unvan ara…" className="w-full min-w-0 bg-transparent text-[12.5px] outline-none" style={{ color: V5.metin }} />
          </span>
        </>
      }
    >
      {/* Özet satırı */}
      {ozet && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 pb-3 text-[12px]" style={{ color: V5.ikincil }}>
          {ozet.beyannameDonem && ozet.beyannameDonem !== ozet.donem && (
            <span>
              beyanname dönemi <b style={{ color: V5.metin }}>{donemEtiketi(ozet.beyannameDonem)}</b>
            </span>
          )}
          {(
            [
              ['kayıt', `${ozet.ozet.kayitVar}/${ozet.toplam}`, V5.metin],
              ['evrak', ozet.ozet.evrak, V5.metin],
              ['işlendi', ozet.ozet.isleme, V5.metin],
              ['kontrol', ozet.ozet.kontrol, V5.metin],
              ['hazır', ozet.ozet.beyannameHazir, V5.metin],
              ['verildi', ozet.ozet.beyanname, V5.mint],
            ] as Array<[string, React.ReactNode, string]>
          ).map(([k, v, renk]) => (
            <span key={k} className="inline-flex items-baseline gap-1.5">
              {k}
              <b style={{ fontFamily: V5.mono, color: renk }}>{v}</b>
            </span>
          ))}
          <span className="ml-auto inline-flex items-center gap-3 text-[11px]" style={{ color: V5.soluk }}>
            {ASAMALAR.map((a) => (
              <span key={a.key} title={a.ad}>
                <b style={{ color: V5.ikincil }}>{a.harf}</b> {a.kisa}
              </span>
            ))}
          </span>
        </div>
      )}
      {ozet?.hata && (
        <div className="mx-5 mb-3 flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px]" style={{ background: 'rgba(242,182,77,0.08)', border: '1px solid rgba(242,182,77,0.45)', color: '#ffd27a' }}>
          <AlertTriangle size={12} /> Bu dönem verisi alınamadı: {ozet.hata}
        </div>
      )}
      {ozet?.bosDonemFallback && donem && (
        <div className="mx-5 mb-3 flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px]" style={{ background: 'rgba(242,182,77,0.08)', border: '1px solid rgba(242,182,77,0.45)', color: '#ffd27a' }}>
          <AlertTriangle size={12} /> {donemEtiketi(donem)} boştu, önceki ay gösteriliyor
        </div>
      )}

      <div className="px-5 pb-5">
        {isLoading ? (
          <div className="space-y-1.5 py-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded-xl" style={{ background: 'rgba(255,255,255,0.05)' }} />
            ))}
            <div className="flex items-center gap-2 text-[12px]" style={{ color: V5.ikincil }}>
              <Loader2 size={12} className="animate-spin" /> Pano yükleniyor (ilk açılış yavaş olabilir)…
            </div>
          </div>
        ) : error ? (
          isOmurgaYok(error) ? (
            <OmurgaYokBilgi kucuk />
          ) : (
            <div className="py-4 text-[12.5px]" style={{ color: V5.coral }}>
              Pano alınamadı: {(error as any)?.message || 'hata'}
            </div>
          )
        ) : !pano?.satirlar.length ? (
          <div className="rounded-xl px-4 py-8 text-center text-[13px]" style={{ background: 'rgba(255,255,255,0.03)', border: `1px dashed ${V5.cizgi2}`, color: V5.ikincil }}>
            Pano boş — Koordinatör ilk koşusunda dönemleri dolduracak.
          </div>
        ) : !satirlar.length ? (
          <div className="flex items-center justify-center gap-2 rounded-xl px-4 py-8 text-[13px]" style={{ background: 'rgba(255,255,255,0.03)', border: `1px dashed ${V5.cizgi2}`, color: V5.ikincil }}>
            {sadeceEksik ? <><CheckCircle2 size={16} style={{ color: V5.mint }} /> Bu dönemde eksik yok — hepsi verildi.</> : <><Search size={16} /> Eşleşen mükellef yok.</>}
          </div>
        ) : (
          <div className="max-h-[520px] overflow-auto rounded-xl [scrollbar-width:thin]" style={{ border: `1px solid ${V5.cizgi}`, background: 'rgba(0,0,0,0.22)' }}>
            <table className="w-full min-w-[720px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  {['Mükellef', 'Aşamalar', '', 'Sonraki adım', 'Görev'].map((b, i) => (
                    <th key={i} className="px-3.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: V5.soluk, borderBottom: `1px solid ${V5.cizgi}`, position: 'sticky', top: 0, background: '#11151f' }}>
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {satirlar.map(({ s, adim, tamam }) => {
                  const sablon = adim.sablonId ? SABLONLAR.find((x) => x.id === adim.sablonId) : undefined;
                  const ajanId = adim.ajanId;
                  const tamamMi = adim.sira >= 5;
                  return (
                    <tr key={s.taxpayerId} className="transition-colors hover:bg-white/[0.03]">
                      <td className="max-w-[300px] px-3.5 py-2" style={{ borderBottom: `1px solid ${V5.cizgi}` }}>
                        <div className="truncate text-[12.8px] font-bold" style={{ color: V5.metin }} title={s.unvan}>
                          {s.unvan}
                        </div>
                        {s.defterTuru && (
                          <div className="truncate text-[10.5px] uppercase tracking-wide" style={{ color: V5.soluk }}>
                            {s.defterTuru.replace(/_/g, ' ')}
                          </div>
                        )}
                      </td>
                      <td className="px-3.5 py-2" style={{ borderBottom: `1px solid ${V5.cizgi}` }}>{donem && <AsamaNoktalari satir={s} donem={donem} />}</td>
                      <td className="px-2 py-2 text-[11.5px]" style={{ fontFamily: V5.mono, color: V5.soluk, borderBottom: `1px solid ${V5.cizgi}` }}>
                        {tamam}/{ASAMALAR.length}
                      </td>
                      <td className="px-3.5 py-2 text-[12.5px]" style={{ color: tamamMi ? V5.mint : adim.sira <= 1 ? V5.ikincil : V5.metin, borderBottom: `1px solid ${V5.cizgi}` }} title={`Panoya göre: ${adim.metin}`}>
                        {tamamMi && adim.sira === 6 ? <Kapsul tur="bitti" nokta>tamam</Kapsul> : adim.metin}
                      </td>
                      <td className="px-3.5 py-2" style={{ borderBottom: `1px solid ${V5.cizgi}` }}>
                        {sablon && ajanId && (
                          <Dug
                            kucuk
                            tur={adim.sira === 3 ? 'mavi' : 'cam'}
                            onClick={() =>
                              onTaslak({
                                ajanId,
                                gorev: sablonDoldur(sablon.gorev, s.unvan, donem),
                                taxpayerId: s.taxpayerId,
                                dryRun: true,
                                kaynak: 'pano',
                              })
                            }
                            title={`Görev kutusunu doldurur; çalıştırmaz — ${sablon.ad}`}
                          >
                            <Play size={11} /> {dugmeEtiketi(adim.sira)}
                          </Dug>
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
    </CamKart>
  );
}
