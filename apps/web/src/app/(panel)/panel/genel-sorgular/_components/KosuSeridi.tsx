'use client';

import { useMemo, useState } from 'react';
import { KOSU_DURUM_ADI, kosuSorgulari, sorguMukellefAdi, type KosuDurumu, type SorguKosusu } from '@/lib/genel-sorgular';
import { sure, tarihKisa, tarihSaat } from '../_lib/bicim';

const KISA_LISTE = 8;

function durumTonu(d: string): 'tamam' | 'uyari' | 'hata' | 'vurgu' | undefined {
  if (d === 'done') return 'tamam';
  if (d === 'failed') return 'hata';
  if (d === 'running') return 'vurgu';
  return undefined; // pending / cancelled → nötr kurşuni
}

/** Gece koşusu özeti: en son gece (source=nightly) — mükellef sayısı ve hata sayısı. */
export function geceOzeti(kosular: SorguKosusu[]): { tarih: string; mukellef: number; hata: number } | null {
  const gece = kosular.filter((k) => k.source === 'nightly');
  if (gece.length === 0) return null;
  const gunAnahtari = (iso: string) => tarihKisa(iso);
  const sonGun = gunAnahtari(gece[0].createdAt);
  const sonGece = gece.filter((k) => gunAnahtari(k.createdAt) === sonGun);
  return {
    tarih: sonGun,
    mukellef: new Set(sonGece.map((k) => k.taxpayerId || k.id)).size,
    hata: sonGece.filter((k) => k.status === 'failed' || (k.result?.sorguHatalari?.length ?? 0) > 0).length,
  };
}

/**
 * Koşu şeridi — sürmekte olan / bitmiş DVD sorgu işleri (mükellef · sorgular · durum kelimesi · ilerleme · süre).
 * Üst bileşen 5 sn'de bir yeniler; `simdi` süren işlerin geçen süresini yürütür.
 */
export function KosuSeridi({ kosular, yukleniyor, hata, simdi }: { kosular: SorguKosusu[]; yukleniyor: boolean; hata?: string | null; simdi: number }) {
  const [hepsi, setHepsi] = useState(false);
  const gece = useMemo(() => geceOzeti(kosular), [kosular]);
  const aktif = kosular.filter((k) => k.status === 'pending' || k.status === 'running').length;
  const gosterilen = hepsi ? kosular : kosular.slice(0, KISA_LISTE);

  return (
    <div className="gs-kosu" data-gs-kosu>
      <div className="gs-kosu-bas">
        <div className="gs-bolum-adi">
          Koşular
          {aktif > 0 && <span className="gs-rozet" data-ton="vurgu">{aktif} iş sürüyor</span>}
          {yukleniyor && kosular.length === 0 && <span className="gs-ilerleme">yükleniyor…</span>}
        </div>
        <span className="gs-gece" style={{ marginLeft: 'auto' }}>
          Son gece koşusu:{' '}
          {gece ? (
            <>
              <b>{gece.tarih}</b> — <b>{gece.mukellef}</b> mükellef, <b>{gece.hata}</b> hata
            </>
          ) : (
            <b>henüz yok</b>
          )}
        </span>
      </div>

      {hata ? (
        <div className="gs-hata-metni">Koşu listesi alınamadı: {hata}</div>
      ) : kosular.length === 0 ? (
        <div className="gs-kosu-bos">{yukleniyor ? 'Koşular yükleniyor…' : 'Henüz koşu yok. Sorgula\'ya bastığınızda işler burada görünür.'}</div>
      ) : (
        <>
          <div className="gs-tablo-sar">
            <table className="gs-tablo" data-gs-kosu-tablo style={{ minWidth: 960 }}>
              <colgroup>
                <col style={{ width: 260 }} />
                <col />
                <col style={{ width: 120 }} />
                <col style={{ width: 300 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: 140 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Mükellef</th>
                  <th>Sorgular</th>
                  <th>Durum</th>
                  <th>İlerleme</th>
                  <th className="sag">Süre</th>
                  <th>Başlangıç</th>
                </tr>
              </thead>
              <tbody>
                {gosterilen.map((k) => {
                  const durum = k.status as KosuDurumu;
                  const ilerleme = k.status === 'failed'
                    ? k.errorMessage || k.payload?.progress?.message || 'Hata (sebep belirtilmedi)'
                    : k.payload?.progress?.message || (k.status === 'done' ? sorguHatasiMetni(k) : k.status === 'pending' ? 'Sırada bekliyor' : '');
                  const bitis = k.finishedAt ? k.finishedAt : k.status === 'running' ? simdi : null;
                  return (
                    <tr key={k.id} data-durum={k.status}>
                      <td title={sorguMukellefAdi(k.taxpayer) || k.taxpayerId || ''}>
                        <span className="gs-mukellef" style={{ textDecoration: 'none' }}>{sorguMukellefAdi(k.taxpayer) || k.taxpayerId || '—'}</span>
                      </td>
                      <td title={kosuSorgulari(k).join(', ')}>{kosuSorgulari(k).join(', ') || '—'}</td>
                      <td><span className="gs-rozet" data-ton={durumTonu(k.status)}>{KOSU_DURUM_ADI[durum] || k.status}</span></td>
                      <td className={k.status === 'failed' ? 'gs-hata-metni' : 'gs-ilerleme'} title={ilerleme}>{ilerleme || '—'}</td>
                      <td className="sag gs-sayi">{sure(k.startedAt || k.createdAt, bitis)}</td>
                      <td className="gs-soluk gs-sayi">{tarihSaat(k.startedAt || k.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {kosular.length > KISA_LISTE && (
            <div style={{ padding: '8px 2px 0' }}>
              <button type="button" className="gs-baglanti" onClick={() => setHepsi((v) => !v)}>
                {hepsi ? 'Daha az göster' : `Tümünü göster (${kosular.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Bitmiş işte sorgu bazında hata varsa: "e-Haciz: oturum düştü" gibi kısa metin; yoksa "Tamamlandı". */
function sorguHatasiMetni(k: SorguKosusu): string {
  const h = k.result?.sorguHatalari;
  if (!Array.isArray(h) || h.length === 0) return 'Tamamlandı';
  return `${h.length} sorguda hata: ${h.map((x) => `${x.sorgu} — ${x.hata}`).join('; ')}`;
}
