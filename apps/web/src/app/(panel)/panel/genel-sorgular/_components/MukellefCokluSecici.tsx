'use client';

import { useMemo, useState } from 'react';
import type { TaxpayerLite } from '@/components/ui/TaxpayerSelect';
import { sorguMukellefAdi } from '@/lib/genel-sorgular';
import { kucult } from '../_lib/bicim';

/**
 * Mükellef çoklu seçici — Hattat "Mükellefler" kutusu: arama + onay kutulu liste + seçilenler çip.
 * "Tüm mükellefler (DVD şifresi olan)" işaretliyse liste pasifleşir; sorgu mükellef listesi göndermeden gider.
 */
export function MukellefCokluSecici({
  mukellefler,
  sifreliler,
  secili,
  onSecili,
  tumu,
  onTumu,
}: {
  mukellefler: TaxpayerLite[];
  /** DVD şifresi tanımlı mükellef kimlikleri; bilgi gelmediyse null (herkes gösterilir). */
  sifreliler: Set<string> | null;
  secili: Set<string>;
  onSecili: (s: Set<string>) => void;
  tumu: boolean;
  onTumu: (v: boolean) => void;
}) {
  const [arama, setArama] = useState('');

  const sirali = useMemo(
    () => [...mukellefler].sort((a, b) => sorguMukellefAdi(a).localeCompare(sorguMukellefAdi(b), 'tr-TR')),
    [mukellefler],
  );
  const suzulen = useMemo(() => {
    const q = kucult(arama.trim());
    if (!q) return sirali;
    return sirali.filter((m) => kucult(sorguMukellefAdi(m)).includes(q) || (m.taxNumber || '').includes(q));
  }, [sirali, arama]);

  const adlar = useMemo(() => new Map(mukellefler.map((m) => [m.id, sorguMukellefAdi(m) || m.id])), [mukellefler]);
  const sifreliSayisi = sifreliler ? mukellefler.filter((m) => sifreliler.has(m.id)).length : null;

  const degistir = (id: string) => {
    const s = new Set(secili);
    if (s.has(id)) s.delete(id); else s.add(id);
    onSecili(s);
  };
  const suzulenleriSec = () => {
    const s = new Set(secili);
    suzulen.forEach((m) => s.add(m.id));
    onSecili(s);
  };

  return (
    <div data-gs-secici>
      <div className="gs-bolum-adi">
        Mükellefler
        <span className="gs-bolum-sag">
          <button type="button" className="gs-baglanti" onClick={suzulenleriSec} disabled={tumu || suzulen.length === 0} title="Listede görünen mükelleflerin hepsini seç">
            {arama.trim() ? 'Süzülenleri seç' : 'Tümünü seç'}
          </button>
          <span className="gs-ayrac">·</span>
          <button type="button" className="gs-baglanti" onClick={() => onSecili(new Set())} disabled={tumu || secili.size === 0}>
            Temizle
          </button>
        </span>
      </div>

      <div className="gs-secici-ust">
        <input
          type="text"
          className="gs-girdi"
          value={arama}
          onChange={(e) => setArama(e.target.value)}
          placeholder="Ad, unvan ya da VKN ile ara"
          aria-label="Mükellef ara"
          disabled={tumu}
        />
        <label className="gs-tumu" title="Mükellef seçmeden, Dijital Vergi Dairesi şifresi tanımlı bütün mükellefler için sorgula">
          <input type="checkbox" className="gs-kutu" checked={tumu} onChange={(e) => onTumu(e.target.checked)} />
          <span>
            Tüm mükellefler (DVD şifresi olan{sifreliSayisi !== null ? <>: <b>{sifreliSayisi}</b></> : null})
          </span>
        </label>
      </div>

      <div className="gs-liste" data-pasif={tumu ? 'true' : undefined} role="listbox" aria-multiselectable="true" aria-label="Mükellef listesi">
        {suzulen.length === 0 ? (
          <div className="gs-liste-bos">{mukellefler.length === 0 ? 'Mükellef listesi yükleniyor ya da boş.' : 'Aramaya uyan mükellef yok.'}</div>
        ) : (
          suzulen.map((m) => {
            const isaretli = secili.has(m.id);
            const sifreVar = sifreliler ? sifreliler.has(m.id) : null;
            return (
              <label key={m.id} className="gs-liste-satir" data-secili={isaretli ? 'true' : undefined} role="option" aria-selected={isaretli}>
                <input type="checkbox" className="gs-kutu" checked={isaretli} onChange={() => degistir(m.id)} />
                <span className="gs-ad">{adlar.get(m.id)}</span>
                <span className="gs-vkn">{m.taxNumber || ''}</span>
                <span className="gs-sifre" data-var={sifreVar === null ? undefined : sifreVar ? 'true' : 'false'}>
                  {sifreVar === false ? 'Şifre yok' : sifreVar === true ? 'Şifre var' : ''}
                </span>
              </label>
            );
          })
        )}
      </div>

      <div className="gs-cipler" aria-live="polite">
        {tumu ? (
          <span>DVD şifresi tanımlı bütün mükellefler sorgulanacak.</span>
        ) : secili.size === 0 ? (
          <span>Seçili mükellef yok.</span>
        ) : (
          <>
            <span>Seçilen {secili.size} mükellef:</span>
            {[...secili].map((id) => (
              <span key={id} className="gs-cip" title={adlar.get(id) || id}>
                <span>{adlar.get(id) || id}</span>
                <button type="button" onClick={() => degistir(id)} aria-label={`${adlar.get(id) || id} seçimini kaldır`} title="Kaldır">×</button>
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
