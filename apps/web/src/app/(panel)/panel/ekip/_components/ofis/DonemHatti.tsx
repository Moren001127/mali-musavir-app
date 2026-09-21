'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarRange, Loader2, Send, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { kuyrukOlustur, type Ajan, type Pano, type PanoDonemOzeti } from '@/lib/ekip';
import { DonemPanosu, ayUzun, ozetSayilari, type PanoSecim } from '../DonemPanosu';
import { SABLONLAR, ajanTamAd, yonelmeEki } from '../ortak';
import type { KomutTaslak } from './GorevKutusu';
import { Cekmece, Cip, KucukTeyit, OfisAvatar, OfisKart } from './Parcalar';

/** Boru düğümleri: sıra · ad · ton (renk yalnız anlam: nötr → mavi → mor → kehribar → yeşil). */
const BORU: Array<{ anahtar: 'evrakBekliyor' | 'islemede' | 'kontrolde' | 'hazir' | 'verildi'; ad: string; alt: string; ton: string }> = [
  { anahtar: 'evrakBekliyor', ad: 'Evrak', alt: 'bekliyor', ton: 'kursuni' },
  { anahtar: 'islemede', ad: 'İşleme', alt: 'işleniyor', ton: 'mavi' },
  { anahtar: 'kontrolde', ad: 'Kontrol', alt: 'kontrolde', ton: 'mor' },
  { anahtar: 'hazir', ad: 'Hazır', alt: 'gönderim sende', ton: 'kehribar' },
  { anahtar: 'verildi', ad: 'Verildi', alt: 'tamam', ton: 'yesil' },
];

/** Şablonu seçili mükellef/dönem yer tutucusuyla bırakır — kuyruk her mükellef için kendisi doldurur. */
function varsayilanSablon(secimler: PanoSecim[]): { ajanId: string; sablonId: string; metin: string } {
  const sayim = new Map<string, number>();
  for (const s of secimler) if (s.sablonId) sayim.set(s.sablonId, (sayim.get(s.sablonId) || 0) + 1);
  const enCok = [...sayim.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'kdv-kontrol';
  const sablon = SABLONLAR.find((s) => s.id === enCok) || SABLONLAR.find((s) => s.id === 'kdv-kontrol')!;
  return { ajanId: sablon.ajanId, sablonId: sablon.id, metin: sablon.gorev.replace(/\{mükellef\}/g, '{mukellef}').replace(/\{dönem\}/g, '{donem}') };
}

/**
 * DÖNEM HATTI — tam genişlik kart: "Ağustos 2026 beyannameleri · 64 mükellef"; 5 aşamalı boru (Evrak→İşleme→Kontrol→Hazır→Verildi)
 * her düğümde sayı, dolu kısım gradyan; altında dönem panosu tablosu + çoklu seçim → "Personele ver" çekmecesi (POST /ekip/kuyruk).
 */
export function DonemHatti({
  pano,
  ozet,
  isLoading,
  error,
  seciliDonem,
  onDonemSec,
  onTaslak,
  ajanlar,
  kuyrukDestek,
  onKuyrukOlustu,
}: {
  pano: Pano | undefined;
  ozet: PanoDonemOzeti | undefined;
  isLoading: boolean;
  error: unknown;
  seciliDonem: string | null;
  onDonemSec: (d: string) => void;
  onTaslak: (t: Omit<KomutTaslak, 'nonce'>) => void;
  ajanlar: Ajan[];
  kuyrukDestek: boolean;
  onKuyrukOlustu: () => void;
}) {
  const [secili, setSecili] = useState<Map<string, PanoSecim>>(() => new Map());
  const [cekmece, setCekmece] = useState(false);
  useEffect(() => setSecili(new Map()), [seciliDonem]);
  const sayilar = ozet ? ozetSayilari(ozet) : null;
  const donemAd = ozet ? ayUzun(ozet.beyannameDonem || ozet.donem) : seciliDonem ? ayUzun(seciliDonem) : null;
  const yuzde = sayilar && sayilar.toplam > 0 ? Math.round((sayilar.verildi / sayilar.toplam) * 100) : 0;
  const secimler = useMemo(() => [...secili.values()], [secili]);

  return (
    <OfisKart
      id="donem-hatti"
      baslik={donemAd ? `${donemAd} beyannameleri` : 'Dönem hattı'}
      alt={sayilar ? `${sayilar.toplam} mükellef · ${sayilar.verildi} verildi · %${yuzde} tamamlandı${ozet?.donem && ozet.beyannameDonem && ozet.beyannameDonem !== ozet.donem ? ` · işlem ayı ${ayUzun(ozet.donem)}` : ''}` : 'Mükellef × aşama'}
      simge={<CalendarRange size={15} />}
      sag={
        secimler.length > 0 ? (
          <span className="of-secim-cubugu">
            <span>
              Seçili <b>{secimler.length}</b> mükellef
            </span>
            <button type="button" className="of-dugme" data-tur="birincil" onClick={() => setCekmece(true)} disabled={!kuyrukDestek} title={kuyrukDestek ? 'Seçili mükellefleri sırayla personele ver (kuyruk)' : 'Kuyruk ucu sunucuda henüz yayında değil'}>
              <Users size={13} /> Personele ver
            </button>
            <button type="button" className="of-dugme" data-tur="sade" onClick={() => setSecili(new Map())} title="Seçimi temizle">
              <X size={13} />
            </button>
          </span>
        ) : undefined
      }
    >
      {sayilar && sayilar.toplam > 0 && (
        <div className="of-boru" role="img" aria-label={BORU.map((b) => `${b.ad} ${sayilar[b.anahtar]}`).join(', ')}>
          <div className="of-boru-hat" aria-hidden="true">
            <i style={{ width: `${yuzde}%` }} />
          </div>
          <ol className="of-boru-dugumler">
            {BORU.map((b) => {
              const n = sayilar[b.anahtar];
              return (
                <li key={b.anahtar} className="of-boru-dugum" data-ton={b.ton} data-sifir={n === 0 || undefined}>
                  <span className="of-boru-daire">{n}</span>
                  <b>{b.ad}</b>
                  <span className="of-boru-alt">{b.alt}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <DonemPanosu pano={pano} isLoading={isLoading} error={error} seciliDonem={seciliDonem} onDonemSec={onDonemSec} onTaslak={onTaslak} secili={secili} onSecim={setSecili} />

      {cekmece && (
        <PersoneleVerCekmecesi
          secimler={secimler}
          donem={ozet?.beyannameDonem || seciliDonem}
          ajanlar={ajanlar}
          onKapat={() => setCekmece(false)}
          onOlustu={() => {
            setCekmece(false);
            setSecili(new Map());
            onKuyrukOlustu();
          }}
        />
      )}
    </OfisKart>
  );
}

/** "Personele ver" çekmecesi: personel (sıradaki adıma göre) · şablon · kuru/canlı (canlı → 6 sn teyit) → POST /ekip/kuyruk. */
function PersoneleVerCekmecesi({ secimler, donem, ajanlar, onKapat, onOlustu }: { secimler: PanoSecim[]; donem: string | null; ajanlar: Ajan[]; onKapat: () => void; onOlustu: () => void }) {
  const varsayilan = useMemo(() => varsayilanSablon(secimler), [secimler]);
  const [ajanId, setAjanId] = useState(varsayilan.ajanId);
  const [sablon, setSablon] = useState(varsayilan.metin);
  const [dryRun, setDryRun] = useState(true);
  const [canliTeyit, setCanliTeyit] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const adaylar = ajanlar.filter((a) => a.id !== 'koordinator' && !a.kapali);
  const gonder = async () => {
    if (mesgul || !secimler.length || !sablon.trim()) return;
    setMesgul(true);
    try {
      const k = await kuyrukOlustur({ ad: `${SABLONLAR.find((s) => s.id === varsayilan.sablonId)?.ad || 'Toplu görev'} — ${secimler.length} mükellef${donem ? ` · ${ayUzun(donem)}` : ''}`, ajanId, sablon: sablon.trim(), taxpayerIds: secimler.map((s) => s.taxpayerId), dryRun });
      const personel = ajanTamAd(ajanId, ajanlar.find((a) => a.id === ajanId)?.ad);
      toast.success('Kuyruğa alındı', { description: `${k.toplam} mükellef ${personel}${yonelmeEki(personel)} sırayla verilecek (${dryRun ? 'kuru test' : 'canlı'}).` });
      onOlustu();
    } catch (e: any) {
      toast.error('Kuyruk oluşturulamadı', { description: e?.response?.data?.message || e?.message || 'Sunucu hatası' });
    } finally {
      setMesgul(false);
    }
  };
  return (
    <Cekmece
      acik
      baslik="Personele ver"
      alt={`${secimler.length} mükellef sırayla işlenecek${donem ? ` · ${ayUzun(donem)}` : ''}`}
      onKapat={onKapat}
      altBar={
        <>
          <span className="of-cekmece-not">{dryRun ? 'Kuru test: mesaj gönderilmez, Luca’ya yazılmaz.' : 'Canlı: gerçek işlem; dışarı gönderimler onayınıza düşer.'}</span>
          <button type="button" className="of-dugme" data-tur="ikincil" onClick={onKapat} disabled={mesgul}>
            Vazgeç
          </button>
          <button type="button" className="of-dugme" data-tur={dryRun ? 'birincil' : 'tehlike-dolu'} onClick={() => void gonder()} disabled={mesgul || !sablon.trim()}>
            {mesgul ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Kuyruğa ekle
          </button>
        </>
      }
    >
      <div className="of-form">
        <label className="of-alan">
          <span>Personel</span>
          <select value={ajanId} onChange={(e) => setAjanId(e.target.value)}>
            {adaylar.map((a) => (
              <option key={a.id} value={a.id}>
                {a.ad}
              </option>
            ))}
          </select>
          <small>Varsayılan, seçili mükelleflerin sıradaki adımına göre: kontrol → Beyanname Uzmanı, işleme → Fatura Muhasebecisi.</small>
        </label>
        <label className="of-alan">
          <span>Görev şablonu</span>
          <textarea rows={5} value={sablon} onChange={(e) => setSablon(e.target.value)} />
          <small>
            Her mükellef için <code>{'{mukellef}'}</code> ve <code>{'{donem}'}</code> yer tutucuları doldurulur.
          </small>
        </label>
        <div className="of-alan">
          <span>Çalışma modu</span>
          <span className="of-mod" role="radiogroup" aria-label="Çalışma modu">
            <button type="button" role="radio" aria-checked={dryRun} data-mod="kuru" onClick={() => { setDryRun(true); setCanliTeyit(false); }}>
              Kuru test
            </button>
            <button type="button" role="radio" aria-checked={!dryRun} data-mod="canli" onClick={() => { if (dryRun) setCanliTeyit(true); }}>
              Canlı
            </button>
          </span>
          {canliTeyit && dryRun && (
            <KucukTeyit
              tehlike
              metin={
                <>
                  <AlertTriangle size={14} /> <b>Canlı moda geçiliyor</b> — {secimler.length} mükellefte gerçek işlem yapılır; dışarı gönderimler yine onayınıza düşer.
                </>
              }
              evet="Evet, canlı"
              onEvet={() => { setDryRun(false); setCanliTeyit(false); }}
              onVazgec={() => setCanliTeyit(false)}
            />
          )}
        </div>
        <div className="of-alan">
          <span>Seçili mükellefler</span>
          <ul className="of-secim-listesi">
            {secimler.map((s) => (
              <li key={s.taxpayerId}>
                <OfisAvatar ajanId={s.ajanId || ajanId} boyut={22} />
                <span className="min-w-0 flex-1 truncate" title={s.unvan}>
                  {s.unvan}
                </span>
                <Cip ton="kursuni">{s.metin}</Cip>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Cekmece>
  );
}
