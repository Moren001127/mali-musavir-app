'use client';
import './pano-kadro-redesign.css';
import { portalStyle } from '@/lib/portal-theme';


import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Search, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { isOmurgaYok, type AsamaAdi, type AsamaDurumu, type Pano, type PanoDonemOzeti } from '@/lib/ekip';
import type { KomutTaslak } from './GorevKarti';
import { Bos, GOLD, MAVI, MOR, OK, TEXT, TURUNCU, type Ton } from './Tema';
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

/** Eş genişlikte aşama rozeti; durum renk yanında metinle de okunur. */
function Nokta({ durum, title }: { durum: NoktaDurumu; title?: string }) {
  const renk = durum === 'tamam' ? OK : durum === 'eksik' ? TURUNCU : durum === 'suruyor' ? MAVI : MUTED;
  return <span className="epk-stage" data-durum={durum} aria-label={title || NOKTA_ADI[durum]} title={title} style={portalStyle({ color: renk, background: 'rgba(255,255,255,0.04)', border: `1px solid ${KENAR}` })}>
    <span aria-hidden="true" className="epk-stage-dot" style={{ background: 'currentColor' }} />{NOKTA_ADI[durum]}
  </span>;
}

/** Süzgeç hapı: seçili altın (ince altın kenar + hafif zemin), seçili değilse düz soluk metin. */
function Hap({ aktif, onClick, title, children, anahtar = false }: { aktif: boolean; onClick: () => void; title?: string; children: ReactNode; anahtar?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={aktif}
      data-anahtar={anahtar || undefined}
      className="epk-filter"
      style={portalStyle(aktif ? { color: GOLD, border: '1px solid rgba(230,200,120,0.3)', background: 'rgba(230,200,120,0.08)' } : { color: MUTED, border: '1px solid transparent', background: 'transparent' })}
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
      className="epk-action"
      style={portalStyle({ color: GOLD, border: '1px solid rgba(230,200,120,0.28)', background: 'rgba(230,200,120,0.07)' })}
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
 * Dönem panosu: başlık ve sayısal özet; ayrı araç satırında dönem, süzgeçler ve arama.
 * Sabit sütunlu tabloda mükellef, aşama rozetleri, sonraki adım ve görev düğmesi bulunur.
 * Görev düğmesi yalnız taslağı doldurur; işi başlatmaz.
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
    <section className="epk-panel" aria-label="Dönem panosu" style={portalStyle({ background: 'rgba(255,255,255,0.018)', border: `1px solid ${KENAR}`, color: TEXT })}>
      <header className="epk-panel-heading">
        <div>
          <h2>Dönem panosu</h2>
          <p className="epk-muted" style={portalStyle({ color: MUTED })}>{donem ? ayUzun(donem) : 'Mükellef × dönem aşamaları'} · {sayilar?.toplam ?? pano?.satirlar.length ?? 0} mükellef</p>
        </div>
        {sayilar && <dl className="epk-overview" aria-label={aciklama}>
          {([
            ['Verildi', sayilar.verildi, 'yesil'], ['Hazır', sayilar.hazir, 'kehribar'], ['Kontrol', sayilar.kontrolde, 'mor'],
            ['İşleme', sayilar.islemede, 'mavi'], ['Evrak bekliyor', sayilar.evrakBekliyor, 'kursuni'],
          ] as Array<[string, number, string]>).map(([ad, sayi, ton]) => <div key={ad} data-ton={ton}><dt className="epk-muted" style={portalStyle({ color: MUTED })}><i className="epk-overview-nokta" aria-hidden="true" />{ad}</dt><dd data-sifir={sayi === 0 || undefined}>{sayi}</dd></div>)}
        </dl>}
        {sayilar && sayilar.toplam > 0 && (
          /* Aşama şeridi: mükellefler aşamalara göre (evrak bekliyor → işleme → kontrol → hazır → verildi); sayılar üstteki lejantta. */
          <div className="epk-serit" role="img" aria-label={aciklama} style={portalStyle({ background: 'rgba(255,255,255,0.05)' })}>
            {(
              [
                ['kursuni', sayilar.evrakBekliyor, 'evrak bekliyor', 'rgba(250,250,249,0.22)'],
                ['mavi', sayilar.islemede, 'işleme', MAVI],
                ['mor', sayilar.kontrolde, 'kontrol', MOR],
                ['kehribar', sayilar.hazir, 'hazır', GOLD],
                ['yesil', sayilar.verildi, 'verildi', OK],
              ] as Array<[Ton, number, string, string]>
            )
              .filter(([, n]) => n > 0)
              .map(([ton, n, ad, renk]) => (
                <span key={ton} data-ton={ton} className="epk-serit-dilim" style={portalStyle({ width: `${(n / sayilar.toplam) * 100}%`, background: renk })} title={`${n} ${ad}`} />
              ))}
          </div>
        )}
      </header>
      <div className="epk-toolbar" style={portalStyle({ borderTop: `1px solid ${KENAR}`, borderBottom: `1px solid ${KENAR}` })}>
          {/* Ay gezinme kapsülü: ‹ Ağustos 2026 › */}
          <span
            className="epk-month"
            style={portalStyle({ background: KOYU, border: `1px solid ${KENAR}`, color: MUTED })}
            title={donem && verilmemis(donem) > 0 ? `${verilmemis(donem)} mükellefin beyannamesi verilmedi` : undefined}
          >
            <button
              type="button"
              disabled={!oncekiDonem}
              onClick={() => oncekiDonem && onDonemSec(oncekiDonem)}
              className="rounded-md px-1.5 text-[15px] leading-none transition hover:bg-white/[0.06] disabled:opacity-30"
              style={portalStyle({ color: MUTED })}
              title="Önceki dönem"
              aria-label="Önceki dönem"
            >
              ‹
            </button>
            <b className="mx-1 whitespace-nowrap font-semibold" style={portalStyle({ color: GOLD })}>
              {donem ? ayUzun(donem) : '—'}
            </b>
            <button
              type="button"
              disabled={!sonrakiDonem}
              onClick={() => sonrakiDonem && onDonemSec(sonrakiDonem)}
              className="rounded-md px-1.5 text-[15px] leading-none transition hover:bg-white/[0.06] disabled:opacity-30"
              style={portalStyle({ color: MUTED })}
              title="Sonraki dönem"
              aria-label="Sonraki dönem"
            >
              ›
            </button>
          </span>
          {/* Sıralama kapsül grubu + "Sadece eksikler" anahtar çipi */}
          <span className="epk-filters" role="group" aria-label="Sıralama">
            <Hap aktif={siralama === 'acil'} onClick={() => setSiralama('acil')} title="Sıradaki adımı en acil olan üstte">
              Acil önce
            </Hap>
            <Hap aktif={siralama === 'ad'} onClick={() => setSiralama('ad')} title="Ada göre alfabetik">
              Ada göre
            </Hap>
          </span>
          <Hap aktif={sadeceEksik} onClick={() => setSadeceEksik((e) => !e)} title="Beyannamesi verilmemiş mükellefler" anahtar>
            Sadece eksikler
          </Hap>
          {/* Sade arama alanı */}
          <label className="epk-search" style={portalStyle({ background: 'rgba(255,255,255,0.025)', border: `1px solid ${KENAR}` })}>
            <Search size={14} aria-hidden="true" />
            <input
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              placeholder="Mükellef ara…"
              aria-label="Mükellef ara"
              className="w-full min-w-0 bg-transparent text-[12px] outline-none placeholder:text-[#62626b]"
              style={portalStyle({ color: TEXT })}
            />
          </label>
      </div>
      <div className="epk-panel-body">
      {ozet?.beyannameDonem && ozet.beyannameDonem !== ozet.donem && (
        <div className="epk-donem-notu mb-2 text-[12px]" style={portalStyle({ color: MUTED })}>
          İşlem ayı <b style={portalStyle({ color: TEXT })}>{ayUzun(ozet.donem)}</b> · beyanname dönemi <b style={portalStyle({ color: TEXT })}>{ayUzun(ozet.beyannameDonem)}</b>
        </div>
      )}
      {ozet?.hata && (
        <div className="epk-uyari mb-3 flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px]" style={portalStyle({ background: `${TURUNCU}12`, border: `1px solid ${TURUNCU}59`, color: TEXT })}>
          <AlertTriangle size={12} style={portalStyle({ color: TURUNCU })} /> Bu dönem verisi alınamadı: {ozet.hata}
        </div>
      )}
      {ozet?.bosDonemFallback && donem && (
        <div className="epk-uyari mb-3 flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px]" style={portalStyle({ background: `${TURUNCU}12`, border: `1px solid ${TURUNCU}59`, color: TEXT })}>
          <AlertTriangle size={12} style={portalStyle({ color: TURUNCU })} /> {ayUzun(donem)} boştu, önceki ay gösteriliyor
        </div>
      )}

      {isLoading ? (
        <div className="ekip-yukleniyor flex items-center gap-2 py-8 text-[12px]" style={portalStyle({ color: MUTED })}>
          <Loader2 size={13} className="animate-spin" /> Pano yükleniyor (ilk açılış yavaş olabilir)…
        </div>
      ) : error ? (
        isOmurgaYok(error) ? (
          <OmurgaYokBilgi kucuk />
        ) : (
          <div className="eg-hata-yazi py-4 text-[12.5px]" style={portalStyle({ color: '#e0697a' })}>
            Pano alınamadı: {(error as any)?.message || 'hata'}
          </div>
        )
      ) : !pano?.satirlar.length ? (
        <Bos metin="Pano boş — Koordinatör ilk koşusunda dönemleri dolduracak." />
      ) : !satirlar.length ? (
        <Bos metin={sadeceEksik && !arama.trim() ? 'Bu dönemde eksik yok — hepsi verildi.' : 'Eşleşen mükellef yok.'} ikon={sadeceEksik && !arama.trim() ? <CheckCircle2 size={16} style={portalStyle({ color: OK })} /> : <Search size={16} />} />
      ) : (
        /* Telefon genişliğinde tablo bu sarmalayıcı içinde yatay kayar; sayfa taşmaz. Yapışkan öğe yok. */
        <div className="epk-table-scroll" role="region" aria-label="Mükellef aşamaları tablosu" tabIndex={0}>
          <table className="epk-table" style={portalStyle({ borderCollapse: 'collapse' })}>
            <caption className="sr-only">{donem ? ayUzun(donem) : 'Dönem'} mükellef aşamaları</caption>
            <colgroup><col className="epk-col-name" />{ASAMALAR.map((a) => <col key={a.key} className="epk-col-stage" />)}<col className="epk-col-next" /><col className="epk-col-action" /></colgroup>
            <thead>
              <tr>
                <th scope="col" className={`${th} text-left`} style={portalStyle(thStil)}>
                  MÜKELLEF
                </th>
                {ASAMALAR.map((a) => (
                  <th scope="col" key={a.key} className={`${th} text-center`} style={portalStyle(thStil)} title={a.ad}>
                    {ASAMA_BASLIK[a.key]}
                  </th>
                ))}
                <th scope="col" className={`${th} text-left`} style={portalStyle(thStil)}>
                  SONRAKİ ADIM
                </th>
                <th scope="col" className={`${th} text-center`} style={portalStyle(thStil)}>
                  İŞLEM
                </th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map(({ s, d, adim }) => {
                const sablon = adim.sablonId ? SABLONLAR.find((x) => x.id === adim.sablonId) : undefined;
                const ajanId = adim.ajanId;
                return (
                  <tr key={s.taxpayerId} className="transition-colors hover:bg-white/[0.02]">
                    <td className="max-w-[300px] px-2.5 py-[9px] align-middle" style={portalStyle(tdStil)}>
                      <div className="epk-unvan truncate text-[12.5px] font-semibold" style={portalStyle({ color: TEXT })} title={s.unvan}>
                        {s.unvan}
                      </div>
                      {s.defterTuru && (
                        <div className="epk-defter truncate text-[11px]" style={portalStyle({ color: SOLUK })}>
                          {defterEtiketi(s.defterTuru)}
                        </div>
                      )}
                    </td>
                    {ASAMALAR.map((a) => {
                      const durum: NoktaDurumu = d?.asamalar?.[a.key] || 'yok';
                      return (
                        <td key={a.key} className="px-2.5 py-[9px] text-center align-middle" style={portalStyle(tdStil)}>
                          <Nokta durum={durum} title={`${a.ad} · ${NOKTA_ADI[durum]}`} />
                        </td>
                      );
                    })}
                    <td className="epk-sonraki px-2.5 py-[9px] text-[12.5px] align-middle" style={portalStyle({ ...tdStil, color: MUTED })}>
                      {adim.metin}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-[9px] text-center align-middle" style={portalStyle(tdStil)}>
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
        <div className="epk-legend epk-muted" style={portalStyle({ color: SOLUK })}>
          {(['tamam', 'eksik', 'suruyor', 'yok'] as NoktaDurumu[]).map((durum) => (
            <span key={durum} className="inline-flex items-center gap-1.5">
              <Nokta durum={durum} />
            </span>
          ))}
          <span className="ml-auto">İşlem, görev kutusunu o mükellef ve dönemle doldurur; çalıştırmaz.</span>
        </div>
      )}
      </div>
    </section>
  );
}
