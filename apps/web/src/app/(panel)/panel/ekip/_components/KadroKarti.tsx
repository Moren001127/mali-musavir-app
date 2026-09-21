'use client';
import './pano-kadro-redesign.css';
import { portalStyle } from '@/lib/portal-theme';


import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Ajan, EkipOnay } from '@/lib/ekip';
import type { Kosu } from './kosular';
import { CARD_BG, GOLD, KIRMIZI, MAVI, TEXT, ajanRengi, ajanTonu } from './Tema';
import { AJAN_UNVAN, ajanKisaAd, ajanKisaltma, saatKisa, sayacMetni, tarihKisa } from './ortak';

const MUTED = '#8a8a93';

function suAn(ajan: Ajan, kosu: Kosu | undefined, mukellefAd: (id?: string | null) => string | undefined, simdi: number): { metin: string; durum: 'calisiyor' | 'hata' | 'bos' } {
  if (kosu && !kosu.bitti) {
    const m = mukellefAd(kosu.taxpayerId);
    return { metin: `${m ? `${m} · ` : ''}${sayacMetni(simdi - kosu.basladi)}`, durum: 'calisiyor' };
  }
  if (ajan.suAn) {
    const m = ajan.suAn.mukellefAd || mukellefAd(ajan.suAn.mukellefId);
    const basladi = new Date(ajan.suAn.basladi).getTime();
    return { metin: `${m ? `${m} · ` : ''}${isNaN(basladi) ? 'çalışıyor' : sayacMetni(simdi - basladi)}`, durum: 'calisiyor' };
  }
  return { metin: '', durum: ajan.sonKosu?.status === 'failed' ? 'hata' : 'bos' };
}

/** Son iş zamanı: bugünse saat, değilse kısa tarih. */
function sonIsEtiketi(iso?: string | null): string {
  if (!iso) return 'henüz iş almadı';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const bugun = new Date();
  const ayni = d.toDateString() === bugun.toDateString();
  return `son iş ${ayni ? saatKisa(iso).slice(0, 5) : tarihKisa(iso)}`;
}

/**
 * Kadro: uyarlanabilir üç sütunlu rol kartları; durum, sorumluluk ve iş sayıları ayrı bölümlerdedir.
 * Uzun sorumluluk metni açılarak okunur; çalışma durumu ve onay sayısı her zaman görünür.
 */
export function KadroKarti({ ajanlar, onaylar, kosular, mukellefAd, yukleniyor, haftalikIs, bugunKosu }: { ajanlar: Ajan[]; onaylar: EkipOnay[]; kosular: Map<string, Kosu>; mukellefAd: (id?: string | null) => string | undefined; yukleniyor?: boolean; haftalikIs: Map<string, number>; bugunKosu: number }) {
  const [simdi, setSimdi] = useState(() => Date.now());
  const aktifVar = Array.from(kosular.values()).some((k) => !k.bitti) || ajanlar.some((a) => !!a.suAn);
  useEffect(() => {
    const t = setInterval(() => setSimdi(Date.now()), aktifVar ? 1000 : 60_000);
    return () => clearInterval(t);
  }, [aktifVar]);
  const bekleyenOnay = (a: Ajan) => a.bekleyenOnay ?? onaylar.filter((o) => o.ajanId === a.id).length;
  const durumlar = ajanlar.map((a) => suAn(a, kosular.get(a.id), mukellefAd, simdi));
  const calisanSayisi = durumlar.filter((d) => d.durum === 'calisiyor').length;
  const haftaToplam = Array.from(haftalikIs.values()).reduce((t, n) => t + n, 0);

  if (yukleniyor && !ajanlar.length)
    return (
      <div className="ekip-yukleniyor flex items-center gap-2 py-8 text-[12px]" style={portalStyle({ color: MUTED })}>
        <Loader2 size={13} className="animate-spin" /> Kadro yükleniyor…
      </div>
    );

  return (
    <section className="epk-roster" aria-label="Kadro" style={portalStyle({ color: TEXT })}>
      <header className="epk-roster-heading">
        <div><h2>Kadro</h2><p className="epk-muted" style={portalStyle({ color: MUTED })}>Roller, çalışma durumu ve iş sayıları</p></div>
        <dl className="epk-overview">
          {[
            ['Personel', ajanlar.length], ['Çalışıyor', calisanSayisi], ['Bugün koşu', bugunKosu], ['7 günde iş', haftaToplam],
          ].map(([ad, sayi]) => <div key={ad}><dt className="epk-muted" style={portalStyle({ color: MUTED })}>{ad}</dt><dd data-sifir={sayi === 0 || undefined}>{sayi}</dd></div>)}
        </dl>
      </header>
      <div className="epk-roster-grid" aria-label="Personel durumu">
        {ajanlar.map((a, i) => {
          const d = durumlar[i];
          const onay = bekleyenOnay(a);
          const calisiyor = d.durum === 'calisiyor';
          const renk = ajanRengi(a.id);
          return (
            <article
              key={a.id}
              data-ajan={a.id}
              className="epk-person"
              data-durum={d.durum}
              style={portalStyle({
                background: CARD_BG,
                border: `1px solid ${calisiyor ? 'rgba(140,189,232,0.3)' : 'rgba(255,255,255,0.065)'}`,
              })}
              title={`${a.ad} — ${a.unvan}\n${calisiyor ? `şu an: ${d.metin}` : d.durum === 'hata' ? 'son iş yarım kaldı' : 'boşta'}${onay > 0 ? `\n${onay} onay bekliyor` : ''}`}
            >
              <header className="epk-person-heading">
                <span
                  aria-hidden="true"
                  className="epk-avatar"
                  data-ton={ajanTonu(a.id)}
                  data-calisiyor={calisiyor || undefined}
                  style={portalStyle({
                    color: renk,
                    background: `${renk}14`,
                    border: `1px solid ${renk}40`,
                  })}
                >
                  {ajanKisaltma(a.id, a.ad)}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="epk-person-name" style={portalStyle({ color: TEXT })}>
                    {ajanKisaAd(a.id, a.ad)}
                  </h3>
                  <p className="epk-role epk-muted" style={portalStyle({ color: MUTED })}>
                    {AJAN_UNVAN[a.id] || a.unvan}
                  </p>
                </div>
              </header>
              <div className="epk-person-state">
                <span className="epk-status" data-durum={d.durum} style={portalStyle({ color: calisiyor ? MAVI : d.durum === 'hata' ? KIRMIZI : MUTED, border: '1px solid rgba(255,255,255,0.1)' })}>
                  {calisiyor ? 'Çalışıyor' : d.durum === 'hata' ? 'Yarım kaldı' : 'Boşta'}
                </span>
                {onay > 0 && <span className="epk-status" data-durum="onay" style={portalStyle({ color: GOLD, border: `1px solid ${GOLD}40` })}>{onay} onay bekliyor</span>}
              </div>
              <details className="epk-responsibility" open={!a.aciklama || a.aciklama.length <= 150}>
                <summary className="epk-muted" style={portalStyle({ color: MUTED })}>Sorumluluk</summary>
                <p className="epk-muted" style={portalStyle({ color: MUTED })}>{a.aciklama || AJAN_UNVAN[a.id] || a.unvan}</p>
              </details>
              <p className="epk-current" style={portalStyle({ color: calisiyor ? MAVI : d.durum === 'hata' ? KIRMIZI : MUTED })}>
                {calisiyor ? d.metin : d.durum === 'hata' ? 'son iş yarım kaldı' : `${a.sonKosu?.createdAt ? 'boşta · ' : ''}${sonIsEtiketi(a.sonKosu?.createdAt)}`}
              </p>
              <dl className="epk-person-counts" style={portalStyle({ borderTop: '1px solid rgba(255,255,255,0.065)' })}>
                <div><dt className="epk-muted" style={portalStyle({ color: MUTED })}>Bugün</dt><dd data-sifir={!(a.bugunKosu ?? 0) || undefined}>{a.bugunKosu ?? 0}</dd></div>
                <div><dt className="epk-muted" style={portalStyle({ color: MUTED })}>Son 7 gün</dt><dd data-sifir={!haftalikIs.get(a.id) || undefined}>{haftalikIs.get(a.id) || 0}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
      <p className="epk-roster-note epk-muted" style={portalStyle({ color: MUTED })}>Personel işi kendi başlatmaz; görevi Koordinatör verir. Mükellefe giden her mesaj ve Luca’ya her yazım onayınıza düşer.</p>
    </section>
  );
}
