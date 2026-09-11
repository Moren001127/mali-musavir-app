'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Loader2, Search, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { isOmurgaYok, type Pano, type PanoSatiri } from '@/lib/ekip';
import type { KomutTaslak } from './KomutKutusu';
import { BosDurum } from './Kart';
import { ASAMALAR, RENK, SABLONLAR, ajanKisaltma, ajanRengi, asamaRengi, donemEtiketi, ikonStili, sablonDoldur, sonrakiAdim } from './ortak';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';

const ACCENT = RENK.mor; // dönem panosu — mor

function AsamaNoktalari({ satir, donem }: { satir: PanoSatiri; donem: string }) {
  const d = satir.donemler?.find((x) => x.donem === donem);
  if (!d) return <span className="text-[10px]" style={{ color: RENK.sonuk }}>—</span>;
  return (
    <div className="flex items-center gap-1">
      {ASAMALAR.map((a) => {
        const durum = d.asamalar?.[a.key];
        return (
          <span
            key={a.key}
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              background: asamaRengi(durum),
              boxShadow: durum === 'tamam' ? '0 0 6px rgba(74,222,128,0.6)' : durum === 'eksik' ? '0 0 6px rgba(251,146,60,0.5)' : 'none',
            }}
            title={`${a.ad}: ${durum === 'tamam' ? 'tamam' : durum === 'eksik' ? 'eksik' : 'yok'}`}
          />
        );
      })}
    </div>
  );
}

/**
 * Dönem Panosu — tek dönem sekmesi; özet satırı; "Sadece eksikler"; her satırda sonraki adım + görev düğmesi
 * (KomutKutusu'nu doldurur, ÇALIŞTIRMAZ). Tablo kendi içinde kayar; sayfa yatay kaymaz.
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

  // Varsayılan: en yeni dönem (hatırlanan dönem listede yoksa da en yeni)
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

  const cip = (aktif: boolean, onClick: () => void, metin: string, renk: string = ACCENT, title?: string) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-[background-color,border-color,color] duration-150"
      style={aktif ? { background: `${renk}22`, border: `1px solid ${renk}66`, color: renk } : { background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: RENK.ikincil }}
    >
      {metin}
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Araç çubuğu: dönem sekmeleri · sıralama · eksikler · arama (sekme adı zaten "Dönem panosu" → ikinci başlık yok) */}
      <div className="flex flex-wrap items-center gap-2 pb-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <CalendarRange size={13} style={{ color: ACCENT }} />
        {/* Dönem sekmeleri */}
        <div className="flex items-center gap-1">
          {donemler.map((d) => {
            const v = verilmemis(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => onDonemSec(d)}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-[background-color,border-color,color] duration-150"
                style={d === donem ? { background: `${ACCENT}22`, border: `1px solid ${ACCENT}66`, color: ACCENT } : { background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: RENK.ikincil }}
              >
                {d === donem ? donemEtiketi(d) : donemEtiketi(d).split(' ')[0]}
                {v > 0 && (
                  <span className="rounded-full px-1 text-[9px] leading-4" style={{ background: `${RENK.turuncu}22`, color: RENK.turuncu }} title={`${v} verilmemiş`}>
                    {v}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {cip(siralama === 'acil', () => setSiralama('acil'), 'Acil önce')}
        {cip(siralama === 'ad', () => setSiralama('ad'), 'Ada göre')}
        {cip(sadeceEksik, () => setSadeceEksik((e) => !e), 'Sadece eksikler', RENK.turuncu, 'Beyannamesi verilmemiş mükellefler')}
        <div className="relative ml-auto flex min-w-[140px] items-center">
          <Search size={11} className="pointer-events-none absolute left-2" style={{ color: RENK.ikincil }} />
          <input
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            placeholder="Unvan ara…"
            className="w-full rounded-full py-1 pl-6 pr-2 text-[11px] outline-none"
            style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${ACCENT}3a`, color: RENK.metin }}
          />
        </div>
      </div>

      {/* Özet satırı */}
      {ozet && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]" style={{ color: RENK.ikincil }}>
          <span>kayıt <b style={{ color: RENK.metin }}>{ozet.ozet.kayitVar}/{ozet.toplam}</b></span>
          <span>evrak <b style={{ color: RENK.metin }}>{ozet.ozet.evrak}</b></span>
          <span>işleme <b style={{ color: RENK.metin }}>{ozet.ozet.isleme}</b></span>
          <span>kontrol <b style={{ color: RENK.metin }}>{ozet.ozet.kontrol}</b></span>
          <span>hazır <b style={{ color: RENK.metin }}>{ozet.ozet.beyannameHazir}</b></span>
          <span>verildi <b style={{ color: RENK.yesil }}>{ozet.ozet.beyanname}</b></span>
          <span className="ml-auto flex items-center gap-2 text-[10px]">
            {ASAMALAR.map((a) => (
              <span key={a.key} title={a.ad}>
                <b style={{ color: RENK.metin }}>{a.harf}</b> {a.kisa}
              </span>
            ))}
          </span>
        </div>
      )}
      {ozet?.hata && (
        <div className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11.5px]" style={{ background: `${RENK.turuncu}12`, border: `1px solid ${RENK.turuncu}55`, color: RENK.turuncu }}>
          <AlertTriangle size={12} /> Bu dönem verisi alınamadı: {ozet.hata}
        </div>
      )}
      {ozet?.bosDonemFallback && donem && (
        <div className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11.5px]" style={{ background: `${RENK.turuncu}12`, border: `1px solid ${RENK.turuncu}55`, color: RENK.turuncu }}>
          <AlertTriangle size={12} /> {donemEtiketi(donem)} boştu, önceki ay gösteriliyor
        </div>
      )}

      <div>
        {isLoading ? (
          <div className="space-y-1.5 py-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded-lg" style={{ background: `${ACCENT}0f` }} />
            ))}
            <div className="flex items-center gap-2 text-xs" style={{ color: RENK.ikincil }}>
              <Loader2 size={12} className="animate-spin" /> Pano yükleniyor (ilk açılış yavaş olabilir)…
            </div>
          </div>
        ) : error ? (
          isOmurgaYok(error) ? (
            <OmurgaYokBilgi kucuk />
          ) : (
            <div className="py-4 text-xs" style={{ color: '#fca5a5' }}>Pano alınamadı: {(error as any)?.message || 'hata'}</div>
          )
        ) : !pano?.satirlar.length ? (
          <BosDurum ikon={<CalendarRange size={18} />} renk={ACCENT} metin="Pano boş — koordinatör ilk koşusunda dönemleri dolduracak." />
        ) : !satirlar.length ? (
          sadeceEksik ? (
            <BosDurum ikon={<CheckCircle2 size={18} />} renk={RENK.yesil} metin="Bu dönemde eksik yok — hepsi verildi." />
          ) : (
            <BosDurum ikon={<Search size={18} />} renk={ACCENT} metin="Eşleşen mükellef yok." />
          )
        ) : (
          <div className="max-h-[480px] overflow-auto rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.35)', color: 'rgba(250,250,249,0.6)' }}>
                  <th className="px-3 py-2 text-left font-semibold">Mükellef</th>
                  <th className="px-3 py-2 text-left font-semibold">
                    <span className="inline-flex gap-1.5">
                      {ASAMALAR.map((a) => (
                        <span key={a.key} title={a.ad} className="w-2.5 text-center">{a.harf}</span>
                      ))}
                    </span>
                  </th>
                  <th className="px-2 py-2 text-left font-semibold" />
                  <th className="px-3 py-2 text-left font-semibold">Sonraki adım</th>
                  <th className="px-3 py-2 text-left font-semibold" />
                </tr>
              </thead>
              <tbody>
                {satirlar.map(({ s, adim, tamam }, i) => {
                  const sablon = adim.sablonId ? SABLONLAR.find((x) => x.id === adim.sablonId) : undefined;
                  const ajanId = adim.ajanId;
                  const renk = ajanId ? ajanRengi(ajanId) : ACCENT;
                  return (
                    <tr key={s.taxpayerId} style={{ background: i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td className="max-w-[240px] px-3 py-1.5">
                        <div className="truncate font-medium" style={{ color: RENK.metin }} title={s.unvan}>{s.unvan}</div>
                        {s.defterTuru && <div className="truncate text-[10px]" style={{ color: RENK.sonuk }}>{s.defterTuru}</div>}
                      </td>
                      <td className="px-3 py-1.5">{donem && <AsamaNoktalari satir={s} donem={donem} />}</td>
                      <td className="px-2 py-1.5 tabular-nums" style={{ color: RENK.ikincil }}>{tamam}/{ASAMALAR.length}</td>
                      <td className="px-3 py-1.5" style={{ color: adim.sira >= 5 ? RENK.yesil : RENK.metin }} title={`Panoya göre: ${adim.metin}`}>
                        {adim.metin}
                      </td>
                      <td className="px-3 py-1.5">
                        {sablon && ajanId && (
                          <button
                            type="button"
                            onClick={() =>
                              onTaslak({
                                ajanId,
                                gorev: sablonDoldur(sablon.gorev, s.unvan, donem),
                                taxpayerId: s.taxpayerId,
                                dryRun: true,
                                kaynak: 'pano',
                              })
                            }
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold transition-[transform] duration-150 hover:-translate-y-px"
                            style={{ background: `${renk}14`, border: `1px solid ${renk}55`, color: RENK.metin }}
                            title="Komut kutusunu doldurur; çalıştırmaz"
                          >
                            <span className="flex h-4 w-4 items-center justify-center rounded text-[8px] font-black" style={ikonStili(renk)}>{ajanKisaltma(ajanId)}</span>
                            {sablon.ad}
                          </button>
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
    </div>
  );
}
