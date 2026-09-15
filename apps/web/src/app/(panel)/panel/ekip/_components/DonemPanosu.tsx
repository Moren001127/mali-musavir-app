'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, AlertTriangle, CheckCircle2, Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { isOmurgaYok, type Pano, type PanoSatiri } from '@/lib/ekip';
import type { KomutTaslak } from './GorevKarti';
import { Bos, CARD_BORDER, Cip, Dugme, GOLD, Kutu, MAVI, MOR, MUTED, OK, ROW_SEP, Rozet, TEXT, TURUNCU, koyuAlan } from './Tema';
import { ASAMALAR, SABLONLAR, donemEtiketi, sablonDoldur, sonrakiAdim } from './ortak';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';

/** Aşama hücresi: ● tamam (yeşil) · "eksik" (turuncu) · – (yok). */
function AsamaHucresi({ satir, donem, anahtar }: { satir: PanoSatiri; donem: string; anahtar: (typeof ASAMALAR)[number]['key'] }) {
  const d = satir.donemler?.find((x) => x.donem === donem);
  const durum = d?.asamalar?.[anahtar];
  if (durum === 'tamam') return <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: OK, boxShadow: `0 0 8px ${OK}66` }} title="tamam" />;
  if (durum === 'eksik') return <span className="text-[11.5px]" style={{ color: TURUNCU }}>eksik</span>;
  return <span style={{ color: 'rgba(113,113,122,0.55)' }}>–</span>;
}

/** Satırın görev düğmesi etiketi (Muzaffer Bey 2026-09-15: "işlenmemişse İşle, kontrol edilmemişse Kontrol et"). */
function dugmeEtiketi(sira: number): string {
  if (sira === 0) return 'Araştır';
  if (sira === 2) return 'İşle';
  if (sira === 3) return 'Kontrol et';
  if (sira === 4) return 'Hazırla';
  return 'Görev ver';
}

/**
 * Dönem panosu (kendi sekmesi): dönem seçici · sıralama · eksikler · arama; özet; mükellef × aşama tablosu
 * (Evrak / İşleme / Kontrol / Hazır / Verildi) + sonraki adım + görev düğmesi (görev kutusunu doldurur, ÇALIŞTIRMAZ).
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
  /** Artınca "Sadece eksikler" açılır. */
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
  const donemSira = donem ? donemler.indexOf(donem) : -1;
  const oncekiDonem = donemSira >= 0 && donemSira < donemler.length - 1 ? donemler[donemSira + 1] : null; // liste yeni→eski
  const sonrakiDonem = donemSira > 0 ? donemler[donemSira - 1] : null;

  const satirlar = useMemo(() => {
    if (!pano || !donem) return [];
    const q = arama.trim().toLocaleLowerCase('tr-TR');
    const liste = pano.satirlar
      .map((s) => {
        const d = s.donemler.find((x) => x.donem === donem);
        const kayitVar = s.kayitVar?.[donem] ?? !!d;
        const adim = sonrakiAdim(d?.asamalar, kayitVar);
        return { s, d, kayitVar, adim };
      })
      .filter((r) => (!sadeceEksik || r.d?.asamalar?.gonderim !== 'tamam') && (!q || r.s.unvan.toLocaleLowerCase('tr-TR').includes(q)));
    if (siralama === 'acil') liste.sort((a, b) => a.adim.sira - b.adim.sira || a.s.unvan.localeCompare(b.s.unvan, 'tr'));
    else liste.sort((a, b) => a.s.unvan.localeCompare(b.s.unvan, 'tr'));
    return liste;
  }, [pano, donem, sadeceEksik, arama, siralama]);

  const verilmemis = (d: string) => {
    const o = pano?.donemOzetleri.find((x) => x.donem === d);
    return o ? Math.max(0, o.toplam - o.ozet.beyanname) : 0;
  };

  const th = 'px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em]';
  const thStil = { color: MUTED, borderBottom: `1px solid ${CARD_BORDER}` } as const;
  const baslik = ozet ? `${donemEtiketi(ozet.beyannameDonem || ozet.donem)} beyannameleri` : 'Dönem panosu';
  const aciklama = ozet
    ? `${ozet.toplam} mükellef · verildi ${ozet.ozet.beyanname} · hazır ${ozet.ozet.beyannameHazir} · kontrol ${ozet.ozet.kontrol} · işleme ${ozet.ozet.isleme} · evrak ${ozet.ozet.evrak} · kayıt ${ozet.ozet.kayitVar}`
    : 'Mükellef × dönem aşamaları';

  return (
    <Kutu
      baslik={baslik}
      aciklama={aciklama}
      renk={MOR}
      sag={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <span className="inline-flex h-8 items-center gap-1 rounded-xl px-1.5" style={koyuAlan}>
            <button type="button" disabled={!oncekiDonem} onClick={() => oncekiDonem && onDonemSec(oncekiDonem)} className="rounded-lg p-1 transition hover:bg-white/[0.06] disabled:opacity-30" style={{ color: MUTED }} title="Önceki dönem">
              <ChevronLeft size={14} />
            </button>
            <span className="min-w-[96px] text-center text-[12px] font-medium" style={{ color: GOLD }}>
              {donem ? donemEtiketi(donem) : '—'}
              {donem && verilmemis(donem) > 0 && <span className="ml-1.5 text-[10.5px]" style={{ color: MUTED }} title={`${verilmemis(donem)} verilmemiş`}>({verilmemis(donem)})</span>}
            </span>
            <button type="button" disabled={!sonrakiDonem} onClick={() => sonrakiDonem && onDonemSec(sonrakiDonem)} className="rounded-lg p-1 transition hover:bg-white/[0.06] disabled:opacity-30" style={{ color: MUTED }} title="Sonraki dönem">
              <ChevronRight size={14} />
            </button>
          </span>
          <Cip aktif={siralama === 'acil'} onClick={() => setSiralama('acil')}>Acil önce</Cip>
          <Cip aktif={siralama === 'ad'} onClick={() => setSiralama('ad')}>Ada göre</Cip>
          <Cip aktif={sadeceEksik} onClick={() => setSadeceEksik((e) => !e)} title="Beyannamesi verilmemiş mükellefler">Sadece eksikler</Cip>
          <span className="inline-flex h-8 min-w-[180px] items-center gap-2 rounded-xl px-3 text-[12px]" style={koyuAlan}>
            <Search size={12} style={{ color: MUTED }} />
            <input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Mükellef ara…" className="w-full min-w-0 bg-transparent text-[12px] outline-none" style={{ color: TEXT }} />
          </span>
        </div>
      }
    >
      {ozet?.beyannameDonem && ozet.beyannameDonem !== ozet.donem && (
        <div className="mb-2 text-[11.5px]" style={{ color: MUTED }}>
          İşlem ayı <b style={{ color: TEXT }}>{donemEtiketi(ozet.donem)}</b> · beyanname dönemi <b style={{ color: TEXT }}>{donemEtiketi(ozet.beyannameDonem)}</b>
        </div>
      )}
      {ozet?.hata && (
        <div className="mb-3 flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px]" style={{ background: `${TURUNCU}12`, border: `1px solid ${TURUNCU}59`, color: TEXT }}>
          <AlertTriangle size={12} style={{ color: TURUNCU }} /> Bu dönem verisi alınamadı: {ozet.hata}
        </div>
      )}
      {ozet?.bosDonemFallback && donem && (
        <div className="mb-3 flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px]" style={{ background: `${TURUNCU}12`, border: `1px solid ${TURUNCU}59`, color: TEXT }}>
          <AlertTriangle size={12} style={{ color: TURUNCU }} /> {donemEtiketi(donem)} boştu, önceki ay gösteriliyor
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-[12px]" style={{ color: MUTED }}>
          <Loader2 size={13} className="animate-spin" /> Pano yükleniyor (ilk açılış yavaş olabilir)…
        </div>
      ) : error ? (
        isOmurgaYok(error) ? (
          <OmurgaYokBilgi kucuk />
        ) : (
          <div className="py-4 text-[12.5px]" style={{ color: '#e0697a' }}>
            Pano alınamadı: {(error as any)?.message || 'hata'}
          </div>
        )
      ) : !pano?.satirlar.length ? (
        <Bos metin="Pano boş — Koordinatör ilk koşusunda dönemleri dolduracak." />
      ) : !satirlar.length ? (
        <Bos metin={sadeceEksik ? 'Bu dönemde eksik yok — hepsi verildi.' : 'Eşleşen mükellef yok.'} ikon={sadeceEksik ? <CheckCircle2 size={16} style={{ color: OK }} /> : <Search size={16} />} />
      ) : (
        <div className="max-h-[560px] overflow-auto rounded-xl [scrollbar-width:thin]" style={{ border: `1px solid ${CARD_BORDER}` }}>
          <table className="w-full min-w-[760px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th className={th} style={thStil}>Mükellef</th>
                {ASAMALAR.map((a) => (
                  <th key={a.key} className={`${th} text-center`} style={{ ...thStil, width: 84 }} title={a.ad}>
                    {a.kisa}
                  </th>
                ))}
                <th className={th} style={thStil}>Sonraki adım</th>
                <th className={`${th} text-center`} style={{ ...thStil, width: 120 }}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map(({ s, adim }) => {
                const sablon = adim.sablonId ? SABLONLAR.find((x) => x.id === adim.sablonId) : undefined;
                const ajanId = adim.ajanId;
                return (
                  <tr key={s.taxpayerId} className="transition-colors hover:bg-white/[0.02]">
                    <td className="max-w-[300px] px-3 py-2" style={{ borderBottom: `1px solid ${ROW_SEP}` }}>
                      <div className="truncate text-[12.5px] font-semibold" style={{ color: TEXT }} title={s.unvan}>
                        {s.unvan}
                      </div>
                      {s.defterTuru && (
                        <div className="truncate text-[10.5px]" style={{ color: MUTED }}>
                          {s.defterTuru.replace(/_/g, ' ').toLocaleLowerCase('tr-TR')}
                        </div>
                      )}
                    </td>
                    {ASAMALAR.map((a) => (
                      <td key={a.key} className="px-3 py-2 text-center" style={{ borderBottom: `1px solid ${ROW_SEP}` }}>
                        {donem && <AsamaHucresi satir={s} donem={donem} anahtar={a.key} />}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-[12px]" style={{ color: adim.sira >= 6 ? OK : adim.sira === 5 ? MUTED : TEXT, borderBottom: `1px solid ${ROW_SEP}` }}>
                      {adim.sira >= 6 ? <Rozet metin="tamam" renk={OK} /> : adim.metin}
                    </td>
                    <td className="px-3 py-2 text-center" style={{ borderBottom: `1px solid ${ROW_SEP}` }}>
                      {sablon && ajanId ? (
                        <Dugme
                          renk={adim.sira === 3 ? MAVI : GOLD}
                          onClick={() => onTaslak({ ajanId, gorev: sablonDoldur(sablon.gorev, s.unvan, donem), taxpayerId: s.taxpayerId, dryRun: true, kaynak: 'pano' })}
                        >
                          <Play size={11} /> {dugmeEtiketi(adim.sira)}
                        </Dugme>
                      ) : adim.sira === 5 ? (
                        <span className="text-[11.5px]" style={{ color: MUTED }}>
                          GİB gönderimi sizde
                        </span>
                      ) : (
                        <span style={{ color: 'rgba(113,113,122,0.55)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 text-[10.5px]" style={{ color: 'rgba(113,113,122,0.9)' }}>
        İşlem düğmesi görev kutusunu o mükellef ve dönemle doldurur; çalıştırmaz. Dönem verisi Aylık Takip Listesi’nden gelir.
      </div>
    </Kutu>
  );
}
