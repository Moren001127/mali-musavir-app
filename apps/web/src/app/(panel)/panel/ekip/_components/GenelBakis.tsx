'use client';

import { useEffect, useMemo, useState } from 'react';
import { Eye, Play, RotateCcw, Square } from 'lucide-react';
import type { Pano, Vaka, VakaAdimIs } from '@/lib/ekip';
import type { KomutTaslak } from './GorevKarti';
import type { Kosu } from './kosular';
import { Avatar, Bos, Dugme, GOLD, Ilerleme, KIRMIZI, Kutu, MAVI, MUTED, OK, ROW_SEP, Rozet, TEXT } from './Tema';
import { ASAMALAR, SABLONLAR, adimAciklamasi, ajanKisaAd, ajanKisaltma, ajanTamAd, bugunMu, konuKisalt, sablonDoldur, saatKisa, sayacMetni, sonrakiAdim, sureKisa } from './ortak';

/* ─────────────────────────── Şu an ─────────────────────────── */

type CalisanIs = {
  anahtar: string;
  vaka?: Vaka;
  kosu?: Kosu;
  mukellef: string;
  konu: string;
  ajanId: string;
  basladi: number;
  kuru: boolean;
  asama: { ad: string; no: number };
  suAn: string;
};

/**
 * Şu an çalışan işler: yerel SSE koşusu (Koordinatör) + sunucuda süren vakalar (personel).
 * Her satır: avatar (mavi halka) · mükellef — konu · personel · süre · kuru/canlı · ilerleme çubuğu · "Şu an: …" · İzle / Durdur.
 */
export function SuAnKutu({
  kosu,
  vakalar,
  ajanAd,
  mukellefAd,
  onIzle,
  onDurdur,
}: {
  kosu: Kosu | undefined;
  vakalar: Vaka[] | undefined;
  ajanAd: (id: string) => string;
  mukellefAd: (id?: string | null) => string | undefined;
  onIzle: (vakaId: string | null) => void;
  onDurdur: (hedef: { kosu?: Kosu; vaka?: Vaka }) => void;
}) {
  const [simdi, setSimdi] = useState(() => Date.now());
  const isler = useMemo<CalisanIs[]>(() => {
    const out: CalisanIs[] = [];
    const yerelVakaId = kosu && !kosu.bitti ? kosu.vakaId || kosu.isId : undefined;
    if (kosu && !kosu.bitti) {
      const calisanAdim = kosu.adimlar.find((a) => a.tip === 'arac' && a.durum === 'calisiyor');
      const devir = kosu.adimlar.some((a) => a.tip === 'arac' && a.ad === 'ekip_ajan_baslat');
      out.push({
        anahtar: 'yerel',
        kosu,
        mukellef: kosu.kaynak === 'sabahOzeti' ? 'Sabah özeti' : mukellefAd(kosu.taxpayerId) || 'Ofis geneli',
        konu: kosu.kaynak === 'sabahOzeti' ? 'Koordinatör bugünü topluyor' : konuKisalt(kosu.gorev, 80),
        ajanId: 'koordinator',
        basladi: kosu.basladi,
        kuru: kosu.dryRun,
        asama: devir ? { ad: 'Personelde', no: 3 } : kosu.adimlar.length ? { ad: 'Bilgi toplanıyor', no: 2 } : { ad: 'Görev alındı', no: 1 },
        suAn: calisanAdim ? `Koordinatör: ${adimAciklamasi(calisanAdim.ad, calisanAdim.args, mukellefAd, ajanAd).baslik}` : kosu.isId ? 'Koordinatör düşünüyor' : 'Koordinatör göreve başlıyor',
      });
    }
    for (const v of vakalar || []) {
      if (v.kutu !== 'suruyor') continue;
      if (yerelVakaId && (v.vakaId === yerelVakaId || v.adimlar.some((a) => a.tip === 'is' && a.isId === yerelVakaId))) continue;
      const isAdimlari = v.adimlar.filter((a): a is VakaAdimIs => a.tip === 'is');
      const kosan = isAdimlari.find((a) => a.durum === 'running') || isAdimlari.find((a) => a.durum === 'pending');
      const ajanId = kosan?.ajanId || v.kimde.ajanId;
      const personelde = !!kosan && kosan.ajanId !== 'koordinator';
      out.push({
        anahtar: v.vakaId,
        vaka: v,
        mukellef: v.mukellef?.ad || 'Ofis geneli',
        konu: v.konu,
        ajanId,
        basladi: new Date(kosan?.baslangic || v.olusturuldu).getTime(),
        kuru: v.kuru,
        asama: personelde ? { ad: 'Personelde', no: 3 } : { ad: 'Bilgi toplanıyor', no: 2 },
        suAn: kosan ? `${ajanTamAd(kosan.ajanId, ajanAd(kosan.ajanId))} çalışıyor — ${kosan.baslik}` : 'Sırada',
      });
    }
    return out;
  }, [kosu, vakalar, ajanAd, mukellefAd]);

  useEffect(() => {
    if (!isler.length) return;
    const t = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isler.length]);

  return (
    <Kutu baslik="Şu an" aciklama="Çalışan işler" renk={MAVI} sag={isler.length ? <Rozet metin={`${isler.length} sürüyor`} renk={MAVI} /> : <Rozet metin="boşta" renk={MUTED} />}>
      {!isler.length ? (
        <Bos metin="Şu an çalışan iş yok. Görev verdiğinizde ilerleme burada görünür." />
      ) : (
        <div className="-mt-1 flex flex-col">
          {isler.map((is, i) => (
            <div key={is.anahtar} className="py-3" style={i ? { borderTop: `1px solid ${ROW_SEP}` } : undefined}>
              <div className="flex items-start gap-2.5">
                <Avatar kisaltma={ajanKisaltma(is.ajanId)} ton="mavi" boyut={28} nabiz title={ajanTamAd(is.ajanId, ajanAd(is.ajanId))} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.8px] font-semibold" style={{ color: TEXT }} title={`${is.mukellef} — ${is.konu}`}>
                    {is.mukellef} — {is.konu}
                  </div>
                  <div className="text-[11.5px]" style={{ color: MUTED }}>
                    {ajanKisaAd(is.ajanId, ajanAd(is.ajanId))} · <span className="tabular-nums" style={{ color: MAVI }}>{sayacMetni(Math.max(0, simdi - is.basladi))}</span> · {is.kuru ? 'kuru test' : <span style={{ color: KIRMIZI }}>canlı</span>}
                  </div>
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-2 text-[11px]" style={{ color: MUTED }}>
                <span className="w-24 flex-shrink-0">{is.asama.ad}</span>
                <Ilerleme yuzde={(is.asama.no / 4) * 100} />
                <span className="tabular-nums">{is.asama.no}/4</span>
              </div>
              <div className="mt-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: `${MAVI}0f`, border: `1px solid ${MAVI}2e`, color: TEXT }}>
                <b className="font-semibold" style={{ color: MAVI }}>
                  Şu an:
                </b>{' '}
                {is.suAn}
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <Dugme renk={MAVI} onClick={() => onIzle(is.vaka?.vakaId || is.kosu?.vakaId || is.kosu?.isId || null)}>
                  <Eye size={12} /> İzle
                </Dugme>
                {!(is.kosu && is.kosu.kaynak === 'sabahOzeti') && (
                  <Dugme tur="tehlike" onClick={() => onDurdur({ kosu: is.kosu, vaka: is.vaka })}>
                    <Square size={11} /> Durdur
                  </Dugme>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Kutu>
  );
}

/* ─────────────────────────── Bugün ─────────────────────────── */

export interface Oneri {
  taxpayerId: string;
  unvan: string;
  ajanId: string;
  sablonId: string;
  metin: string;
  neden: string;
  donem: string;
}

/**
 * Koordinatör'ün önerileri — dönem panosundaki sıradaki adımlardan (kontrol → hazırla → işle sırasıyla);
 * bugün zaten işi olan mükellefler atlanır. Düğme görev kutusunu doldurur, ÇALIŞTIRMAZ (pano ile aynı kural).
 */
export function onerileriCikar(pano: Pano | undefined, donem: string | null, mesgulTaxpayerIds: Set<string>, tavan = 4): Oneri[] {
  if (!pano || !donem) return [];
  const oncelik: Record<number, number> = { 3: 0, 4: 1, 2: 2, 0: 3 };
  const out: Array<Oneri & { sira: number }> = [];
  for (const s of pano.satirlar) {
    if (mesgulTaxpayerIds.has(s.taxpayerId)) continue;
    const d = s.donemler.find((x) => x.donem === donem);
    const kayitVar = s.kayitVar?.[donem] ?? !!d;
    const adim = sonrakiAdim(d?.asamalar, kayitVar);
    if (!adim.sablonId || !adim.ajanId || !(adim.sira in oncelik)) continue;
    const tamam = ASAMALAR.filter((a) => d?.asamalar?.[a.key] === 'tamam').map((a) => a.ad.toLocaleLowerCase('tr-TR'));
    const neden = adim.sira === 0 ? 'Aylık takip kaydı açılmamış' : tamam.length ? `${tamam.join(', ')} tamam` : 'Henüz aşama tamamlanmadı';
    out.push({ taxpayerId: s.taxpayerId, unvan: s.unvan, ajanId: adim.ajanId, sablonId: adim.sablonId, metin: adim.metin.replace(/^(.*?)\s*\(.*\)$/, '$1'), neden, donem, sira: oncelik[adim.sira] });
  }
  return out.sort((a, b) => a.sira - b.sira || a.unvan.localeCompare(b.unvan, 'tr')).slice(0, tavan);
}

function bitisRozeti(v: Vaka): { ad: string; renk: string } {
  if (v.durum === 'hata') return { ad: 'yarım', renk: KIRMIZI };
  if (v.kimde.ajanId === 'koordinator' && v.adimlar.filter((a) => a.tip === 'is').length === 1) return { ad: 'cevaplandı', renk: MUTED };
  return { ad: 'bitti', renk: OK };
}

export function BugunKutu({
  vakalar,
  oneriler,
  ajanAd,
  onSec,
  onTumu,
  onTaslak,
  onPano,
}: {
  vakalar: Vaka[] | undefined;
  oneriler: Oneri[];
  ajanAd: (id: string) => string;
  onSec: (vakaId: string) => void;
  onTumu: () => void;
  onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void;
  onPano: () => void;
}) {
  const bitenler = useMemo(() => (vakalar || []).filter((v) => v.kutu === 'bitti' && bugunMu(v.guncellendi)).sort((a, b) => new Date(b.guncellendi).getTime() - new Date(a.guncellendi).getTime()).slice(0, 5), [vakalar]);
  return (
    <Kutu
      baslik="Bugün"
      aciklama="Bitenler ve Koordinatör’ün önerdiği sıradaki işler"
      renk={OK}
      sag={
        <Dugme tur="sade" onClick={onTumu}>
          Tümü →
        </Dugme>
      }
    >
      <div className="-mt-1 flex flex-col">
        {!bitenler.length ? (
          <div className="py-2 text-[12px]" style={{ color: MUTED }}>
            Bugün henüz biten iş yok.
          </div>
        ) : (
          bitenler.map((v, i) => {
            const isAdimlari = v.adimlar.filter((a): a is VakaAdimIs => a.tip === 'is');
            const sonPersonel = [...isAdimlari].reverse().find((a) => a.ajanId !== 'koordinator');
            const ajanId = sonPersonel?.ajanId || 'koordinator';
            const r = bitisRozeti(v);
            const sonIs = isAdimlari[isAdimlari.length - 1];
            const sure = sonIs?.baslangic && sonIs?.bitis ? sureKisa(new Date(sonIs.bitis).getTime() - new Date(sonIs.baslangic).getTime()) : '';
            const ozet = sonIs?.raporOzet ? konuKisalt(sonIs.raporOzet, 70) : v.durum === 'hata' ? sonIs?.hata || 'yarım kaldı' : '';
            return (
              <button
                key={v.vakaId}
                type="button"
                onClick={() => onSec(v.vakaId)}
                className="flex w-full items-center gap-2.5 py-2.5 text-left transition hover:bg-white/[0.02]"
                style={i ? { borderTop: `1px solid ${ROW_SEP}` } : undefined}
                title="Raporu aç"
              >
                <Avatar kisaltma={ajanKisaltma(ajanId)} ton={ajanId === 'koordinator' ? 'gold' : 'gri'} boyut={26} title={ajanTamAd(ajanId, ajanAd(ajanId))} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold" style={{ color: TEXT }}>
                    {v.mukellef?.ad || (v.konu ? v.konu : 'Ofis geneli')}
                    {v.mukellef?.ad ? ` — ${v.konu}` : ''}
                  </span>
                  <span className="block truncate text-[11.5px]" style={{ color: MUTED }}>
                    {saatKisa(v.guncellendi).slice(0, 5)}
                    {ozet ? ` · ${ozet}` : ''}
                    {sure ? ` · ${sure}` : ''}
                  </span>
                </span>
                <Rozet metin={r.ad} renk={r.renk} />
              </button>
            );
          })
        )}

        <div className="mt-3 flex items-center justify-between gap-2 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ borderTop: `1px solid ${ROW_SEP}`, color: MUTED }}>
          <span>Koordinatör öneriyor</span>
          <button type="button" onClick={onPano} className="normal-case tracking-normal transition hover:brightness-125" style={{ color: GOLD, fontWeight: 500 }}>
            Dönem panosu →
          </button>
        </div>
        {!oneriler.length ? (
          <div className="py-2 text-[12px]" style={{ color: MUTED }}>
            Panoya göre sırada bekleyen adım yok.
          </div>
        ) : (
          oneriler.map((o, i) => {
            const sablon = SABLONLAR.find((s) => s.id === o.sablonId);
            return (
              <div key={o.taxpayerId} className="flex items-center gap-2.5 py-2.5" style={i ? { borderTop: `1px solid ${ROW_SEP}` } : undefined}>
                <Avatar kisaltma={ajanKisaltma(o.ajanId)} boyut={26} title={ajanTamAd(o.ajanId, ajanAd(o.ajanId))} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold" style={{ color: TEXT }}>
                    {o.unvan} — {o.metin.toLocaleLowerCase('tr-TR')}
                  </span>
                  <span className="block truncate text-[11.5px]" style={{ color: MUTED }}>
                    {o.neden}
                  </span>
                </span>
                {sablon && (
                  <Dugme onClick={() => onTaslak({ ajanId: o.ajanId, gorev: sablonDoldur(sablon.gorev, o.unvan, o.donem), taxpayerId: o.taxpayerId, dryRun: true, kaynak: 'oneri' })} className="flex-shrink-0">
                    <Play size={11} /> Hazırla
                  </Dugme>
                )}
              </div>
            );
          })
        )}
        {!!oneriler.length && (
          <div className="pt-2 text-[10.5px]" style={{ color: 'rgba(113,113,122,0.9)' }}>
            <RotateCcw size={10} className="mr-1 inline" />
            “Hazırla” görev kutusunu o mükellefle doldurur; siz Çalıştır’a basarsınız (kuru test).
          </div>
        )}
      </div>
    </Kutu>
  );
}
