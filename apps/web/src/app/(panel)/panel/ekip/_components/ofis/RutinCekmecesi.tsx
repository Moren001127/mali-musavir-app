'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { rutinGuncelle, rutinOlustur, type Ajan, type MukellefOzet, type Rutin, type RutinGirdi, type RutinKapsam, type RutinZaman, mukellefAdi } from '@/lib/ekip';
import { MukellefSecici } from '../MukellefSecici';
import { AJAN_UNVAN } from '../ortak';
import { Cekmece, KucukTeyit } from './Parcalar';
import { KAPSAM_ETIKETI } from './yardimci';

const GUNLER: Array<{ n: number; ad: string }> = [
  { n: 1, ad: 'Pzt' },
  { n: 2, ad: 'Sal' },
  { n: 3, ad: 'Çar' },
  { n: 4, ad: 'Per' },
  { n: 5, ad: 'Cum' },
  { n: 6, ad: 'Cmt' },
  { n: 7, ad: 'Paz' },
];

/** Yeni rutin / düzenle çekmecesi: ad · personel · şablon ({mukellef} {donem}) · kapsam · zaman (haftalık gün çipleri + saat aralığı VEYA aylık gün+saat) · tavan · kuru/canlı. */
export function RutinCekmecesi({ rutin, ajanlar, mukellefler, onKapat, onKaydedildi }: { rutin: Rutin | null; ajanlar: Ajan[]; mukellefler: MukellefOzet[]; onKapat: () => void; onKaydedildi: () => void }) {
  const [ad, setAd] = useState(rutin?.ad || '');
  const [ajanId, setAjanId] = useState(rutin?.ajanId || 'beyanname');
  const [sablon, setSablon] = useState(rutin?.sablon || '{mukellef} için {donem} KDV kontrolünü yap (R1): oturumları bul/aç, Luca çekimi ve fatura bağlama + OCR, eşleştir, hatalı satırları belge no ile listele. Kilitleme bende.');
  const [kapsam, setKapsam] = useState<RutinKapsam>(rutin?.kapsam || 'pano:kontrol_bekleyen');
  const [taxpayerIds, setTaxpayerIds] = useState<string[]>(rutin?.taxpayerIds || []);
  const [tur, setTur] = useState<'haftalik' | 'aylik'>(rutin?.zaman.tur || 'haftalik');
  const [gunler, setGunler] = useState<number[]>(rutin?.zaman.tur === 'haftalik' ? rutin.zaman.gunler : [1, 2, 3, 4, 5]);
  const [baslangic, setBaslangic] = useState(rutin?.zaman.tur === 'haftalik' ? rutin.zaman.baslangic : '09:30');
  const [bitis, setBitis] = useState(rutin?.zaman.tur === 'haftalik' ? rutin.zaman.bitis : '17:00');
  const [ayGunu, setAyGunu] = useState(rutin?.zaman.tur === 'aylik' ? rutin.zaman.ayGunu : 5);
  const [saat, setSaat] = useState(rutin?.zaman.tur === 'aylik' ? rutin.zaman.saat : '09:30');
  const [tavan, setTavan] = useState(rutin?.gunlukTavan || 8);
  const [dryRun, setDryRun] = useState(rutin ? rutin.dryRun : true);
  const [canliTeyit, setCanliTeyit] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const [secimNonce, setSecimNonce] = useState(0);
  const adaylar = ajanlar.filter((a) => !a.kapali);
  const mukellefHaritasi = useMemo(() => new Map(mukellefler.map((m) => [m.id, m])), [mukellefler]);
  const gecerli = ad.trim().length > 0 && sablon.trim().length > 0 && (tur === 'aylik' || gunler.length > 0) && (kapsam !== 'liste' || taxpayerIds.length > 0);

  const kaydet = async () => {
    if (!gecerli || mesgul) return;
    setMesgul(true);
    const zaman: RutinZaman = tur === 'haftalik' ? { tur: 'haftalik', gunler: [...gunler].sort((a, b) => a - b), baslangic, bitis } : { tur: 'aylik', ayGunu, saat };
    const girdi: RutinGirdi = { ad: ad.trim(), ajanId, sablon: sablon.trim(), kapsam, taxpayerIds: kapsam === 'liste' ? taxpayerIds : undefined, zaman, gunlukTavan: Math.max(1, tavan), dryRun };
    try {
      if (rutin) {
        await rutinGuncelle(rutin.id, girdi);
        toast.success('Rutin güncellendi');
      } else {
        // aktif GÖNDERİLMEZ → backend varsayılanı kapalı; Muzaffer Bey listeden açar.
        await rutinOlustur(girdi);
        toast.success('Rutin kaydedildi', { description: 'Kapalı olarak eklendi; listeden anahtarla açabilirsiniz.' });
      }
      onKaydedildi();
    } catch (e: any) {
      toast.error(rutin ? 'Güncellenemedi' : 'Kaydedilemedi', { description: e?.response?.data?.message || e?.message });
    } finally {
      setMesgul(false);
    }
  };

  return (
    <Cekmece
      acik
      baslik={rutin ? 'Rutini düzenle' : 'Yeni rutin'}
      alt={rutin ? rutin.ad : 'Ekibin kendiliğinden yapacağı bir iş tanımlayın; kapalı eklenir, siz açarsınız.'}
      onKapat={onKapat}
      altBar={
        <>
          <span className="of-cekmece-not">{dryRun ? 'Kuru test: mesaj gönderilmez, Luca’ya yazılmaz.' : 'Canlı: gerçek işlem; dışarı gönderimler onayınıza düşer.'}</span>
          <button type="button" className="of-dugme" data-tur="ikincil" onClick={onKapat} disabled={mesgul}>
            Vazgeç
          </button>
          <button type="button" className="of-dugme" data-tur="birincil" onClick={() => void kaydet()} disabled={!gecerli || mesgul}>
            {mesgul ? <Loader2 size={13} className="animate-spin" /> : null} {rutin ? 'Kaydet' : 'Rutini ekle'}
          </button>
        </>
      }
    >
      <div className="of-form">
        <label className="of-alan">
          <span>Ad</span>
          <input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Örn: KDV kontrolü — kontrol bekleyenler" />
        </label>
        <label className="of-alan">
          <span>Personel</span>
          <select value={ajanId} onChange={(e) => setAjanId(e.target.value)}>
            {adaylar.map((a) => (
              <option key={a.id} value={a.id}>
                {a.ad} — {AJAN_UNVAN[a.id] || a.unvan}
              </option>
            ))}
          </select>
        </label>
        <label className="of-alan">
          <span>Görev şablonu</span>
          <textarea rows={4} value={sablon} onChange={(e) => setSablon(e.target.value)} />
          <small>
            Yer tutucular: <code>{'{mukellef}'}</code> mükellef unvanı · <code>{'{donem}'}</code> dönem (ör. Ağustos 2026). Araç adı yazmayın; personel reçetesini kendisi bilir.
          </small>
        </label>
        <div className="of-alan">
          <span>Kapsam</span>
          <div className="of-secenekler" role="radiogroup" aria-label="Kapsam">
            {(Object.keys(KAPSAM_ETIKETI) as RutinKapsam[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kapsam === k} data-secili={kapsam === k || undefined} onClick={() => setKapsam(k)}>
                {KAPSAM_ETIKETI[k]}
              </button>
            ))}
          </div>
          {kapsam === 'liste' && (
            <div className="of-liste-secim">
              <span className="of-gorev-secici">
                <MukellefSecici sade yerTutucu="Mükellef ekle…" mukellefler={mukellefler.filter((m) => !taxpayerIds.includes(m.id))} value="" onChange={(id) => { if (id && !taxpayerIds.includes(id)) setTaxpayerIds((l) => [...l, id]); setSecimNonce((n) => n + 1); }} renk="#4263eb" escNonce={secimNonce} />
              </span>
              {taxpayerIds.length > 0 && (
                <ul className="of-secim-listesi">
                  {taxpayerIds.map((id) => (
                    <li key={id}>
                      <span className="min-w-0 flex-1 truncate">{mukellefAdi(mukellefHaritasi.get(id)) || id}</span>
                      <button type="button" className="of-cip-kapat" onClick={() => setTaxpayerIds((l) => l.filter((x) => x !== id))} title="Kaldır">
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <small>{kapsam.startsWith('pano:') ? 'Dönem panosunda o aşamada bekleyen mükellefler, zamanı gelince tavana kadar sırayla.' : kapsam === 'liste' ? 'Yalnız seçtiğiniz mükellefler.' : 'Mükellefe bağlı olmayan tek iş (ör. Resmî Gazete taraması).'}</small>
        </div>
        <div className="of-alan">
          <span>Zaman</span>
          <span className="of-mod" role="radiogroup" aria-label="Zaman türü">
            <button type="button" role="radio" aria-checked={tur === 'haftalik'} onClick={() => setTur('haftalik')}>
              Haftalık
            </button>
            <button type="button" role="radio" aria-checked={tur === 'aylik'} onClick={() => setTur('aylik')}>
              Aylık
            </button>
          </span>
          {tur === 'haftalik' ? (
            <div className="of-zaman">
              <div className="of-gun-cipleri" role="group" aria-label="Günler">
                {GUNLER.map((g) => (
                  <button key={g.n} type="button" aria-pressed={gunler.includes(g.n)} data-secili={gunler.includes(g.n) || undefined} onClick={() => setGunler((l) => (l.includes(g.n) ? l.filter((x) => x !== g.n) : [...l, g.n]))}>
                    {g.ad}
                  </button>
                ))}
              </div>
              <div className="of-saat-araligi">
                <input type="time" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} aria-label="Başlangıç saati" />
                <span>–</span>
                <input type="time" value={bitis} onChange={(e) => setBitis(e.target.value)} aria-label="Bitiş saati" />
              </div>
            </div>
          ) : (
            <div className="of-zaman of-saat-araligi">
              <span>Her ayın</span>
              <input type="number" min={1} max={31} value={ayGunu} onChange={(e) => setAyGunu(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} aria-label="Ayın günü" className="of-kisa" />
              <span>. günü</span>
              <input type="time" value={saat} onChange={(e) => setSaat(e.target.value)} aria-label="Saat" />
            </div>
          )}
        </div>
        <label className="of-alan of-alan--yatay">
          <span>Günlük tavan</span>
          <input type="number" min={1} max={200} value={tavan} onChange={(e) => setTavan(Math.max(1, Number(e.target.value) || 1))} className="of-kisa" />
          <small>Bir günde en çok bu kadar mükellef işlenir (Max kotası için).</small>
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
                  <AlertTriangle size={14} /> <b>Canlı rutin</b> — zamanı gelince gerçek işlem yapılır; dışarı gönderimler yine onayınıza düşer.
                </>
              }
              evet="Evet, canlı"
              onEvet={() => { setDryRun(false); setCanliTeyit(false); }}
              onVazgec={() => setCanliTeyit(false)}
            />
          )}
        </div>
      </div>
    </Cekmece>
  );
}
