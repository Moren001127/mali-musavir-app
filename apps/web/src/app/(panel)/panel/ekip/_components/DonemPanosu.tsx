'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Search } from 'lucide-react';
import { isOmurgaYok, type AsamaAdi, type AsamaDurumu, type Pano, type PanoDonemOzeti } from '@/lib/ekip';
import type { KomutTaslak } from './ofis/GorevKutusu';
import { BosDurum } from './ofis/Parcalar';
import { ASAMALAR, SABLONLAR, donemEtiketi, sablonDoldur, sonrakiAdim } from './ortak';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
/** '2026-08' → 'Ağustos 2026' (uzun ay adı; kısa 'Ağu 2026' ortak.donemEtiketi'nde). */
export function ayUzun(donem: string): string {
  const [y, m] = donem.split('-');
  const ay = AYLAR[Number(m) - 1];
  return ay ? `${ay} ${y}` : donemEtiketi(donem);
}

/** Sütun başlıkları — büyük harf elle yazıldı (CSS uppercase "i → I" tuzağına düşmesin). */
const ASAMA_BASLIK: Record<AsamaAdi, string> = { evrak: 'EVRAK', isleme: 'İŞLEME', kontrol: 'KONTROL', beyanname: 'HAZIR', gonderim: 'VERİLDİ' };

/** 'BILANCO_ESASI' → 'Bilanco esası'. */
function defterEtiketi(t: string): string {
  const s = t.replace(/_/g, ' ').toLocaleLowerCase('tr-TR');
  return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
}

/**
 * Özet sayıları: arka uçtaki sayılar birikimli bayraklardır (evrak = evrakı gelen, isleme = işlenen, kontrol = kontrol edilen,
 * beyannameHazir = hazır ama verilmemiş, beyanname = verilen); birbirini dışlayan dilimler farklardan çıkar, eksiye düşmez,
 * kalan "evrak bekliyor"a yazılır. Dönem hattı borusu ve Ofis bandı bu sayıları kullanır.
 */
export function ozetSayilari(o: PanoDonemOzeti): { toplam: number; verildi: number; hazir: number; kontrolde: number; islemede: number; evrakBekliyor: number } {
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

type NoktaDurumu = AsamaDurumu | 'suruyor';
const NOKTA_ADI: Record<NoktaDurumu, string> = { tamam: 'tamam', eksik: 'eksik', suruyor: 'sürüyor', yok: 'yok' };

/** Eş genişlikte aşama rozeti; durum renk yanında metinle de okunur. */
function Nokta({ durum, title }: { durum: NoktaDurumu; title?: string }) {
  return (
    <span className="epk-stage" data-durum={durum} aria-label={title || NOKTA_ADI[durum]} title={title}>
      <span aria-hidden="true" className="epk-stage-dot" />
      {NOKTA_ADI[durum]}
    </span>
  );
}

function Hap({ aktif, onClick, title, children, anahtar = false }: { aktif: boolean; onClick: () => void; title?: string; children: ReactNode; anahtar?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={aktif} data-anahtar={anahtar || undefined} className="epk-filter">
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

/** Seçilebilir satır (Personele ver çekmecesi bunu alır). */
export interface PanoSecim {
  taxpayerId: string;
  unvan: string;
  /** Sıradaki adım (kontrol → beyanname, işleme → fatura). */
  ajanId?: string;
  sablonId?: string;
  metin: string;
  sira: number;
}

/**
 * Dönem panosu tablosu: ‹›ay · Acil önce/Ada göre · Sadece eksikler · arama; satırda mükellef, 5 aşama rozeti, sıradaki adım, İşlem düğmesi.
 * İşlem düğmesi YALNIZ görev kutusunu doldurur; çalıştırmaz. Onay kutusu sütunu (2026-09-22) → "Personele ver" (kuyruk).
 * Başlık ve boru DonemHatti'nde; bu bileşen araç çubuğu + tablo + lejant.
 */
export function DonemPanosu({
  pano,
  isLoading,
  error,
  seciliDonem,
  onDonemSec,
  onTaslak,
  secili,
  onSecim,
}: {
  pano: Pano | undefined;
  isLoading: boolean;
  error: unknown;
  seciliDonem: string | null;
  onDonemSec: (d: string) => void;
  onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void;
  secili: Map<string, PanoSecim>;
  onSecim: (yeni: Map<string, PanoSecim>) => void;
}) {
  const [sadeceEksik, setSadeceEksik] = useState(false);
  const [arama, setArama] = useState('');
  const [siralama, setSiralama] = useState<'acil' | 'ad'>('acil');

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

  const secilebilir = satirlar.filter((r) => !!r.adim.sablonId && !!r.adim.ajanId);
  const hepsiSecili = secilebilir.length > 0 && secilebilir.every((r) => secili.has(r.s.taxpayerId));
  const secimDegistir = (r: (typeof satirlar)[number], v: boolean) => {
    const m = new Map(secili);
    if (v) m.set(r.s.taxpayerId, { taxpayerId: r.s.taxpayerId, unvan: r.s.unvan, ajanId: r.adim.ajanId, sablonId: r.adim.sablonId, metin: r.adim.metin, sira: r.adim.sira });
    else m.delete(r.s.taxpayerId);
    onSecim(m);
  };
  const hepsiniSec = (v: boolean) => {
    const m = new Map(secili);
    for (const r of secilebilir) {
      if (v) m.set(r.s.taxpayerId, { taxpayerId: r.s.taxpayerId, unvan: r.s.unvan, ajanId: r.adim.ajanId, sablonId: r.adim.sablonId, metin: r.adim.metin, sira: r.adim.sira });
      else m.delete(r.s.taxpayerId);
    }
    onSecim(m);
  };

  const verilmemis = (d: string) => {
    const o = pano?.donemOzetleri.find((x) => x.donem === d);
    return o ? Math.max(0, o.toplam - o.ozet.beyanname) : 0;
  };
  const tabloVar = !isLoading && !error && !!satirlar.length;

  return (
    <div className="epk-panel" aria-label="Dönem panosu">
      <div className="epk-toolbar">
        <span className="epk-month" title={donem && verilmemis(donem) > 0 ? `${verilmemis(donem)} mükellefin beyannamesi verilmedi` : undefined}>
          <button type="button" disabled={!oncekiDonem} onClick={() => oncekiDonem && onDonemSec(oncekiDonem)} title="Önceki dönem" aria-label="Önceki dönem">
            ‹
          </button>
          <b>{donem ? ayUzun(donem) : '—'}</b>
          <button type="button" disabled={!sonrakiDonem} onClick={() => sonrakiDonem && onDonemSec(sonrakiDonem)} title="Sonraki dönem" aria-label="Sonraki dönem">
            ›
          </button>
        </span>
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
        <label className="epk-search">
          <Search size={14} aria-hidden="true" />
          <input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Mükellef ara…" aria-label="Mükellef ara" />
        </label>
      </div>

      {ozet?.beyannameDonem && ozet.beyannameDonem !== ozet.donem && (
        <div className="epk-donem-notu">
          İşlem ayı <b>{ayUzun(ozet.donem)}</b> · beyanname dönemi <b>{ayUzun(ozet.beyannameDonem)}</b>
        </div>
      )}
      {ozet?.hata && (
        <div className="epk-uyari">
          <AlertTriangle size={12} /> Bu dönem verisi alınamadı: {ozet.hata}
        </div>
      )}
      {ozet?.bosDonemFallback && donem && (
        <div className="epk-uyari">
          <AlertTriangle size={12} /> {ayUzun(donem)} boştu, önceki ay gösteriliyor
        </div>
      )}

      {isLoading ? (
        <div className="of-soluk-satir of-yukleniyor">
          <Loader2 size={13} className="animate-spin" /> Pano yükleniyor (ilk açılış yavaş olabilir)…
        </div>
      ) : error ? (
        isOmurgaYok(error) ? (
          <OmurgaYokBilgi kucuk />
        ) : (
          <div className="of-hata-yazi">Pano alınamadı: {(error as any)?.message || 'hata'}</div>
        )
      ) : !pano?.satirlar.length ? (
        <BosDurum>Pano boş — Koordinatör ilk koşusunda dönemleri dolduracak.</BosDurum>
      ) : !satirlar.length ? (
        <BosDurum simge={sadeceEksik && !arama.trim() ? <CheckCircle2 size={16} /> : <Search size={16} />}>{sadeceEksik && !arama.trim() ? 'Bu dönemde eksik yok — hepsi verildi.' : 'Eşleşen mükellef yok.'}</BosDurum>
      ) : (
        /* Telefon genişliğinde tablo bu sarmalayıcı içinde yatay kayar; sayfa taşmaz. Yapışkan öğe yok. */
        <div className="epk-table-scroll" role="region" aria-label="Mükellef aşamaları tablosu" tabIndex={0}>
          <table className="epk-table">
            <caption className="sr-only">{donem ? ayUzun(donem) : 'Dönem'} mükellef aşamaları</caption>
            <colgroup>
              <col className="epk-col-sec" />
              <col className="epk-col-name" />
              {ASAMALAR.map((a) => (
                <col key={a.key} className="epk-col-stage" />
              ))}
              <col className="epk-col-next" />
              <col className="epk-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="epk-th-sec">
                  <input type="checkbox" className="of-onay-kutusu" aria-label="Tümünü seç" checked={hepsiSecili} disabled={!secilebilir.length} onChange={(e) => hepsiniSec(e.target.checked)} />
                </th>
                <th scope="col">MÜKELLEF</th>
                {ASAMALAR.map((a) => (
                  <th scope="col" key={a.key} className="text-center" title={a.ad}>
                    {ASAMA_BASLIK[a.key]}
                  </th>
                ))}
                <th scope="col">SONRAKİ ADIM</th>
                <th scope="col" className="text-center">
                  İŞLEM
                </th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map((r) => {
                const { s, d, adim } = r;
                const sablon = adim.sablonId ? SABLONLAR.find((x) => x.id === adim.sablonId) : undefined;
                const ajanId = adim.ajanId;
                const secilebilirSatir = !!sablon && !!ajanId;
                const isaretli = secili.has(s.taxpayerId);
                return (
                  <tr key={s.taxpayerId} data-secili={isaretli || undefined}>
                    <td className="epk-td-sec">
                      <input type="checkbox" className="of-onay-kutusu" aria-label={`${s.unvan} seç`} checked={isaretli} disabled={!secilebilirSatir} onChange={(e) => secimDegistir(r, e.target.checked)} />
                    </td>
                    <td className="epk-td-ad">
                      <div className="epk-unvan" title={s.unvan}>
                        {s.unvan}
                      </div>
                      {s.defterTuru && <div className="epk-defter">{defterEtiketi(s.defterTuru)}</div>}
                    </td>
                    {ASAMALAR.map((a) => {
                      const durum: NoktaDurumu = d?.asamalar?.[a.key] || 'yok';
                      return (
                        <td key={a.key} className="text-center epk-td-asama" data-etiket={ASAMA_BASLIK[a.key]}>
                          <Nokta durum={durum} title={`${a.ad} · ${NOKTA_ADI[durum]}`} />
                        </td>
                      );
                    })}
                    <td className="epk-sonraki" data-etiket="SIRADAKİ">{adim.metin}</td>
                    <td className="text-center epk-td-islem">
                      {sablon && ajanId && (
                        <button type="button" className="epk-action" title={`${sablon.ad} — görev kutusunu doldurur, çalıştırmaz`} onClick={() => onTaslak({ ajanId, gorev: sablonDoldur(sablon.gorev, s.unvan, donem), taxpayerId: s.taxpayerId, dryRun: true, kaynak: 'pano' })}>
                          {dugmeEtiketi(adim.sira)}
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

      {tabloVar && (
        <div className="epk-legend">
          {(['tamam', 'eksik', 'suruyor', 'yok'] as NoktaDurumu[]).map((durum) => (
            <Nokta key={durum} durum={durum} />
          ))}
          <span className="epk-legend-not">İşlem, görev kutusunu o mükellef ve dönemle doldurur; çalıştırmaz. Seçim → Personele ver (kuyruk).</span>
        </div>
      )}
    </div>
  );
}
