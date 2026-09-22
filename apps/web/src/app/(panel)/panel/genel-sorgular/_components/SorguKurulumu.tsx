'use client';

import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { DvdSorguTuru } from '@mali-musavir/shared';
import type { TaxpayerLite } from '@/components/ui/TaxpayerSelect';
import { DVD_SORGULARI, DVD_SORGU_ADI, genelSorgularApi, type SorguBaslatmaSonucu } from '@/lib/genel-sorgular';
import { MukellefCokluSecici } from './MukellefCokluSecici';

/** Sorgu türü satırının kısa açıklaması (onay kutusunun sağında, soluk). */
const TUR_NOTU: Record<DvdSorguTuru, string> = {
  vergiBorcu: 'Vadesi geçmiş / gelmemiş borç dökümü',
  eHaciz: 'Banka ve araç e-haciz bildirileri',
  yoklama: 'e-Yoklamalarım listesi ve tutanak PDF\'i',
  pos: 'Banka / ödeme kuruluşu POS tutarları (ay)',
  gelenEArsiv: 'Mükellefe kesilen e-Arşiv faturaları',
  eDefter: 'Berat yüklemeleri (e-Defter mükellefinde)',
};

type Mesaj = { ton: 'tamam' | 'uyari' | 'hata'; icerik: ReactNode };

/**
 * Sorgu Kurulumu kartı gövdesi — mükellefler (çoklu) · sorgu türleri (onay kutuları) · Sorgula.
 * POST /portal-automation/dvd-sorgu { taxpayerIds?, sorgular } → "N mükellef için sorgu kuyruğa alındı, M atlandı (neden)".
 */
export function SorguKurulumu({
  mukellefler,
  sifreliler,
  onKuyruk,
}: {
  mukellefler: TaxpayerLite[];
  sifreliler: Set<string> | null;
  /** Kuyruğa alındıktan sonra (koşu şeridi hemen yenilensin diye). */
  onKuyruk: () => void;
}) {
  const [secili, setSecili] = useState<Set<string>>(() => new Set());
  const [tumu, setTumu] = useState(false);
  const [turler, setTurler] = useState<Set<DvdSorguTuru>>(() => new Set());
  const [mesaj, setMesaj] = useState<Mesaj | null>(null);

  const turDegistir = (t: DvdSorguTuru) => {
    const s = new Set(turler);
    if (s.has(t)) s.delete(t); else s.add(t);
    setTurler(s);
  };

  const mukellefHazir = tumu || secili.size > 0;
  const hazir = mukellefHazir && turler.size > 0;

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      genelSorgularApi.sorguBaslat({
        taxpayerIds: tumu ? undefined : [...secili],
        sorgular: DVD_SORGULARI.filter((t) => turler.has(t)),
      }),
    onSuccess: (d) => {
      setMesaj(kuyrukMesaji(d));
      onKuyruk();
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
      const m = err?.response?.data?.message;
      setMesaj({ ton: 'hata', icerik: `Sorgu başlatılamadı: ${Array.isArray(m) ? m.join(', ') : m || err?.message || 'bilinmeyen hata'}` });
    },
  });

  return (
    <div className="gs-kart-govde" data-gs-kurulum>
      <div className="gs-kurulum">
        <MukellefCokluSecici mukellefler={mukellefler} sifreliler={sifreliler} secili={secili} onSecili={setSecili} tumu={tumu} onTumu={setTumu} />

        <div data-gs-turler>
          <div className="gs-bolum-adi">
            Sorgu Türleri
            <span className="gs-bolum-sag">
              <button type="button" className="gs-baglanti" onClick={() => setTurler(new Set(DVD_SORGULARI))} disabled={turler.size === DVD_SORGULARI.length}>Tümünü seç</button>
              <span className="gs-ayrac">·</span>
              <button type="button" className="gs-baglanti" onClick={() => setTurler(new Set())} disabled={turler.size === 0}>Temizle</button>
            </span>
          </div>
          <div className="gs-onaylar" role="group" aria-label="Sorgu türleri">
            {DVD_SORGULARI.map((t) => {
              const isaretli = turler.has(t);
              return (
                <label key={t} className="gs-onay" data-secili={isaretli ? 'true' : undefined}>
                  <input type="checkbox" className="gs-kutu" checked={isaretli} onChange={() => turDegistir(t)} />
                  <span>{DVD_SORGU_ADI[t]}</span>
                  <small>{TUR_NOTU[t]}</small>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="gs-kurulum-alt">
        <p className="gs-not">
          {hazir ? (
            <>
              <b>{tumu ? 'DVD şifresi olan tüm mükellefler' : `${secili.size} mükellef`}</b> için <b>{turler.size} sorgu türü</b> kuyruğa alınacak; her mükellef Dijital Vergi Dairesi'ne tek oturumla girer.
            </>
          ) : (
            <>Mükellef ve en az bir sorgu türü seçtiğinizde <b>Sorgula</b> etkinleşir.</>
          )}
        </p>
        <button type="button" className="gs-dugme" disabled={!hazir || isPending} onClick={() => { setMesaj(null); mutate(); }} data-gs-sorgula>
          {isPending ? 'Kuyruğa alınıyor…' : 'Sorgula'}
        </button>
      </div>

      {mesaj && (
        <div className="gs-sonuc-mesaj" data-ton={mesaj.ton} role="status">
          {mesaj.icerik}
        </div>
      )}
    </div>
  );
}

/** "N mükellef için sorgu kuyruğa alındı, M atlandı (şifre yok: 2 · zaten kuyrukta: 1)". */
function kuyrukMesaji(d: SorguBaslatmaSonucu): Mesaj {
  const mukellefSayisi = new Set(d.created.map((c) => c.taxpayerId || c.id)).size;
  const atlanan = d.skipped.length;
  const nedenler = new Map<string, number>();
  for (const s of d.skipped) nedenler.set(s.reason || 'neden belirtilmedi', (nedenler.get(s.reason || 'neden belirtilmedi') || 0) + 1);
  const nedenMetni = [...nedenler.entries()].map(([n, k]) => `${n}: ${k}`).join(' · ');

  if (mukellefSayisi === 0) {
    return { ton: 'uyari', icerik: atlanan ? `Sorgu kuyruğa alınmadı; ${atlanan} mükellef atlandı (${nedenMetni}).` : d.message || 'Kuyruğa alınacak mükellef bulunamadı.' };
  }
  return {
    ton: atlanan ? 'uyari' : 'tamam',
    icerik: (
      <>
        <b>{mukellefSayisi} mükellef</b> için sorgu kuyruğa alındı{atlanan ? <>, <b>{atlanan} atlandı</b> ({nedenMetni})</> : null}. Koşu durumu aşağıda; iş bitince sonuç tabloları kendiliğinden yenilenir.
      </>
    ),
  };
}
