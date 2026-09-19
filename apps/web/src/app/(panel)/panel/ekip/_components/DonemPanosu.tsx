'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Search, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { isOmurgaYok, type AsamaAdi, type AsamaDurumu, type Pano, type PanoDonemOzeti } from '@/lib/ekip';
import type { KomutTaslak } from './GorevKarti';
import { Bos, GOLD, Kutu, MAVI, OK, TEXT, TURUNCU } from './Tema';
import { ASAMALAR, SABLONLAR, donemEtiketi, sablonDoldur, sonrakiAdim } from './ortak';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';

/* ── Onaylı sade taslak sabitleri (_previews/ekip-sade: .ay, table.pano, .n, .tb, .hint) ── */
/** Soluk etiket rengi (sütun başlıkları, defter türü, lejant). */
const SOLUK = '#62626b';
const MUTED = '#8a8a93';
/** Kapsül / arama / başlık altı çizgi kenarı. */
const KENAR = 'rgba(255,255,255,0.065)';
/** Satırlar arası ince çizgi. */
const CIZGI = 'rgba(255,255,255,0.055)';
/** Ay kapsülü zemini. */
const KOYU = 'rgba(0,0,0,0.3)';

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
/** '2026-08' → 'Ağustos 2026' (kapsül ve özet için uzun ay adı; kısa 'Ağu 2026' ortak.donemEtiketi'nde kalır). */
function ayUzun(donem: string): string {
  const [y, m] = donem.split('-');
  const ay = AYLAR[Number(m) - 1];
  return ay ? `${ay} ${y}` : donemEtiketi(donem);
}

/** Sütun başlıkları — büyük harf elle yazıldı (CSS uppercase "i → I" tuzağına düşmesin). */
const ASAMA_BASLIK: Record<AsamaAdi, string> = { evrak: 'EVRAK', isleme: 'İŞLEME', kontrol: 'KONTROL', beyanname: 'HAZIR', gonderim: 'VERİLDİ' };

/** 'BILANCO_ESASI' → 'Bilanco esası' (küçük harf, baş harf büyük). */
function defterEtiketi(t: string): string {
  const s = t.replace(/_/g, ' ').toLocaleLowerCase('tr-TR');
  return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
}

/**
 * Özet sayıları — Baslik.tsx'teki şeritle AYNI türetme: arka uçtaki sayılar birikimli bayraklardır
 * (evrak = evrakı gelen, isleme = işlenen, kontrol = kontrol edilen, beyannameHazir = hazır ama verilmemiş, beyanname = verilen);
 * birbirini dışlayan dilimler farklardan çıkar, hiçbiri eksiye düşmez, kalan "evrak bekliyor"a yazılır.
 */
function ozetSayilari(o: PanoDonemOzeti): { toplam: number; verildi: number; hazir: number; kontrolde: number; islemede: number; evrakBekliyor: number } {
  const { evrak, isleme, kontrol, beyannameHazir, beyanname } = o.ozet;
  const toplam = Math.max(0, o.toplam);
  const sifirAlti = (n: number) => Math.max(0, n);
  const verildi = Math.min(toplam, sifirAlti(beyanname));
  const hazir = Math.min(toplam - verildi, sifirAlti(beyannameHazir));
  const kontrolde = Math.min(toplam - verildi - hazir, sifirAlti(isleme - kontrol));
  const islemede = Math.min(toplam - verildi - hazir - kontrolde, sifirAlti(evrak - isleme));
  const evrakBekliyor = sifirAlti(toplam - (verildi + hazir + kontrolde + islemede));
  return { toplam, verildi, hazir, kontrolde, islemede, evrakBekliyor };
}

/** Nokta durumu: pano aşaması + "sürüyor" (lejantta var; veri kaynağı bağlanınca mavi yanar). */
type NoktaDurumu = AsamaDurumu | 'suruyor';
const NOKTA_ADI: Record<NoktaDurumu, string> = { tamam: 'tamam', eksik: 'eksik', suruyor: 'sürüyor', yok: 'yok' };

/** 9px durum noktası: tamam yeşil + hafif parıltı · eksik turuncu · sürüyor mavi + parıltı · yok soluk. */
function Nokta({ durum, title }: { durum: NoktaDurumu; title?: string }) {
  const stil =
    durum === 'tamam'
      ? { background: OK, boxShadow: '0 0 6px rgba(90,209,138,0.45)' }
      : durum === 'eksik'
        ? { background: TURUNCU }
        : durum === 'suruyor'
          ? { background: MAVI, boxShadow: '0 0 6px rgba(140,189,232,0.5)' }
          : { background: 'rgba(255,255,255,0.08)' };
  return <span role="img" aria-label={title || NOKTA_ADI[durum]} title={title} className="inline-block h-[9px] w-[9px] flex-shrink-0 rounded-full align-middle" style={stil} />;
}

/** Süzgeç hapı: seçili altın (ince altın kenar + hafif zemin), seçili değilse düz soluk metin. */
function Hap({ aktif, onClick, title, children }: { aktif: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={aktif}
      className="inline-flex h-7 flex-shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-medium transition hover:bg-white/[0.04]"
      style={aktif ? { color: GOLD, border: '1px solid rgba(230,200,120,0.3)', background: 'rgba(230,200,120,0.08)' } : { color: MUTED, border: '1px solid transparent', background: 'transparent' }}
    >
      {children}
    </button>
  );
}

/** Altın kenarlı metin düğme (İşle / Kontrol et / Hazırla / Araştır). */
function MetinDugme({ onClick, title, children }: { onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center whitespace-nowrap rounded-[9px] px-2.5 py-[5px] text-[11.5px] font-semibold transition hover:brightness-125"
      style={{ color: GOLD, border: '1px solid rgba(230,200,120,0.28)', background: 'rgba(230,200,120,0.07)' }}
    >
      {children}
    </button>
  );
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
 * Dönem panosu (kendi sekmesi, onaylı sade taslak): tek kart — başlık "Dönem panosu" + soluk özet satırı; sağda ay kapsülü,
 * süzgeç hapları (Acil önce / Ada göre / Sadece eksikler) ve arama. Tablo: mükellef × aşama NOKTALARI (Evrak / İşleme / Kontrol /
 * Hazır / Verildi) + sonraki adım + gerektiğinde altın metin düğme (görev kutusunu doldurur, ÇALIŞTIRMAZ). Altta lejant.
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

  /* Özet satırı: "Ağustos 2026 · 64 mükellef · verildi 30 · hazır 3 · kontrol 6 · işleme 12 · evrak bekliyor 17" */
  const sayilar = ozet ? ozetSayilari(ozet) : null;
  const aciklama =
    ozet && sayilar && donem
      ? `${ayUzun(donem)} · ${sayilar.toplam} mükellef · verildi ${sayilar.verildi} · hazır ${sayilar.hazir} · kontrol ${sayilar.kontrolde} · işleme ${sayilar.islemede} · evrak bekliyor ${sayilar.evrakBekliyor}`
      : donem
        ? `${ayUzun(donem)} · ${pano?.satirlar.length ?? 0} mükellef`
        : 'Mükellef × dönem aşamaları';

  const th = 'px-2.5 py-2 text-[10.5px] font-bold tracking-[0.14em]';
  const thStil = { color: SOLUK, borderBottom: `1px solid ${KENAR}` } as const;
  const tdStil = { borderBottom: `1px solid ${CIZGI}` } as const;
  const tabloVar = !isLoading && !error && !!satirlar.length;

  return (
    <Kutu
      baslik="Dönem panosu"
      aciklama={aciklama}
      renk={GOLD}
      className="min-w-0 [&>header]:flex-wrap [&>header]:px-6 [&>header]:pt-[18px] [&>header]:pb-1.5 [&>header>div:first-child]:min-w-0 [&>header_h3]:text-[14px] [&>header_h3]:tracking-normal [&>div:last-child]:px-6 [&>div:last-child]:pt-2 [&>div:first-child]:inset-x-6"
      style={{ borderRadius: 18, borderColor: KENAR }}
      sag={
        <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5 self-center">
          {/* Ay gezinme kapsülü: ‹ Ağustos 2026 › */}
          <span
            className="inline-flex h-7 flex-shrink-0 items-center rounded-[10px] px-1 text-[12px]"
            style={{ background: KOYU, border: `1px solid ${KENAR}`, color: MUTED }}
            title={donem && verilmemis(donem) > 0 ? `${verilmemis(donem)} mükellefin beyannamesi verilmedi` : undefined}
          >
            <button
              type="button"
              disabled={!oncekiDonem}
              onClick={() => oncekiDonem && onDonemSec(oncekiDonem)}
              className="rounded-md px-1.5 text-[15px] leading-none transition hover:bg-white/[0.06] disabled:opacity-30"
              style={{ color: MUTED }}
              title="Önceki dönem"
              aria-label="Önceki dönem"
            >
              ‹
            </button>
            <b className="mx-1 whitespace-nowrap font-semibold" style={{ color: GOLD }}>
              {donem ? ayUzun(donem) : '—'}
            </b>
            <button
              type="button"
              disabled={!sonrakiDonem}
              onClick={() => sonrakiDonem && onDonemSec(sonrakiDonem)}
              className="rounded-md px-1.5 text-[15px] leading-none transition hover:bg-white/[0.06] disabled:opacity-30"
              style={{ color: MUTED }}
              title="Sonraki dönem"
              aria-label="Sonraki dönem"
            >
              ›
            </button>
          </span>
          {/* Süzgeç hapları */}
          <span className="inline-flex flex-wrap items-center gap-0.5">
            <Hap aktif={siralama === 'acil'} onClick={() => setSiralama('acil')} title="Sıradaki adımı en acil olan üstte">
              Acil önce
            </Hap>
            <Hap aktif={siralama === 'ad'} onClick={() => setSiralama('ad')} title="Ada göre alfabetik">
              Ada göre
            </Hap>
            <Hap aktif={sadeceEksik} onClick={() => setSadeceEksik((e) => !e)} title="Beyannamesi verilmemiş mükellefler">
              Sadece eksikler
            </Hap>
          </span>
          {/* Sade arama alanı */}
          <label className="inline-flex h-7 w-[150px] flex-shrink-0 items-center rounded-[10px] px-2.5 text-[12px]" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${KENAR}` }}>
            <input
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              placeholder="Mükellef ara…"
              aria-label="Mükellef ara"
              className="w-full min-w-0 bg-transparent text-[12px] outline-none placeholder:text-[#62626b]"
              style={{ color: TEXT }}
            />
          </label>
        </div>
      }
    >
      {ozet?.beyannameDonem && ozet.beyannameDonem !== ozet.donem && (
        <div className="mb-2 text-[11.5px]" style={{ color: MUTED }}>
          İşlem ayı <b style={{ color: TEXT }}>{ayUzun(ozet.donem)}</b> · beyanname dönemi <b style={{ color: TEXT }}>{ayUzun(ozet.beyannameDonem)}</b>
        </div>
      )}
      {ozet?.hata && (
        <div className="mb-3 flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px]" style={{ background: `${TURUNCU}12`, border: `1px solid ${TURUNCU}59`, color: TEXT }}>
          <AlertTriangle size={12} style={{ color: TURUNCU }} /> Bu dönem verisi alınamadı: {ozet.hata}
        </div>
      )}
      {ozet?.bosDonemFallback && donem && (
        <div className="mb-3 flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px]" style={{ background: `${TURUNCU}12`, border: `1px solid ${TURUNCU}59`, color: TEXT }}>
          <AlertTriangle size={12} style={{ color: TURUNCU }} /> {ayUzun(donem)} boştu, önceki ay gösteriliyor
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
        <Bos metin={sadeceEksik && !arama.trim() ? 'Bu dönemde eksik yok — hepsi verildi.' : 'Eşleşen mükellef yok.'} ikon={sadeceEksik && !arama.trim() ? <CheckCircle2 size={16} style={{ color: OK }} /> : <Search size={16} />} />
      ) : (
        /* Telefon genişliğinde tablo bu sarmalayıcı içinde yatay kayar; sayfa taşmaz. Yapışkan öğe yok. */
        <div className="max-w-full overflow-x-auto [scrollbar-width:thin]">
          <table className="w-full min-w-[720px]" style={{ borderCollapse: 'collapse' }}>
            <caption className="sr-only">{donem ? ayUzun(donem) : 'Dönem'} mükellef aşamaları</caption>
            <thead>
              <tr>
                <th scope="col" className={`${th} text-left`} style={thStil}>
                  MÜKELLEF
                </th>
                {ASAMALAR.map((a) => (
                  <th scope="col" key={a.key} className={`${th} text-center`} style={{ ...thStil, width: 72 }} title={a.ad}>
                    {ASAMA_BASLIK[a.key]}
                  </th>
                ))}
                <th scope="col" className={`${th} text-left`} style={thStil}>
                  SONRAKİ ADIM
                </th>
                <th scope="col" className={`${th} text-center`} style={{ ...thStil, width: '1%' }}>
                  <span className="sr-only">İşlem</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map(({ s, d, adim }) => {
                const sablon = adim.sablonId ? SABLONLAR.find((x) => x.id === adim.sablonId) : undefined;
                const ajanId = adim.ajanId;
                return (
                  <tr key={s.taxpayerId} className="transition-colors hover:bg-white/[0.02]">
                    <td className="max-w-[300px] px-2.5 py-[9px] align-middle" style={tdStil}>
                      <div className="truncate text-[12.5px] font-semibold" style={{ color: TEXT }} title={s.unvan}>
                        {s.unvan}
                      </div>
                      {s.defterTuru && (
                        <div className="truncate text-[11px]" style={{ color: SOLUK }}>
                          {defterEtiketi(s.defterTuru)}
                        </div>
                      )}
                    </td>
                    {ASAMALAR.map((a) => {
                      const durum: NoktaDurumu = d?.asamalar?.[a.key] || 'yok';
                      return (
                        <td key={a.key} className="px-2.5 py-[9px] text-center align-middle" style={tdStil}>
                          <Nokta durum={durum} title={`${a.ad} · ${NOKTA_ADI[durum]}`} />
                        </td>
                      );
                    })}
                    <td className="px-2.5 py-[9px] text-[12.5px] align-middle" style={{ ...tdStil, color: MUTED }}>
                      {adim.metin}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-[9px] text-center align-middle" style={tdStil}>
                      {sablon && ajanId && (
                        <MetinDugme
                          title={`${sablon.ad} — görev kutusunu doldurur, çalıştırmaz`}
                          onClick={() => onTaslak({ ajanId, gorev: sablonDoldur(sablon.gorev, s.unvan, donem), taxpayerId: s.taxpayerId, dryRun: true, kaynak: 'pano' })}
                        >
                          {dugmeEtiketi(adim.sira)}
                        </MetinDugme>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tabloVar && (
        /* Lejant + sağda soluk not */
        <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px]" style={{ color: SOLUK }}>
          {(['tamam', 'eksik', 'suruyor', 'yok'] as NoktaDurumu[]).map((durum) => (
            <span key={durum} className="inline-flex items-center gap-1.5">
              <Nokta durum={durum} /> {NOKTA_ADI[durum]}
            </span>
          ))}
          <span className="ml-auto">İşlem, görev kutusunu o mükellef ve dönemle doldurur; çalıştırmaz.</span>
        </div>
      )}
    </Kutu>
  );
}
