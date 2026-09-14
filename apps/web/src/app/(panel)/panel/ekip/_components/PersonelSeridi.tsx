'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Ajan, EkipOnay } from '@/lib/ekip';
import type { Kosu } from './kosular';
import { Avatar, Kart } from './Kart';
import { AJAN_UNVAN, TEMA, ajanKisaAd, ajanKisaltma, sayacMetni } from './ortak';

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

/**
 * Personel şeridi v3 — 12 küçük kart tek satır (dar ekranda kayar): avatar + ad + unvan; çalışanda mavi halka + mükellef/süre satırı.
 * Tıklanmaz (komut yalnız Koordinatör'e).
 */
export function PersonelSeridi({ ajanlar, onaylar, kosular, mukellefAd, yukleniyor }: { ajanlar: Ajan[]; onaylar: EkipOnay[]; kosular: Map<string, Kosu>; mukellefAd: (id?: string | null) => string | undefined; yukleniyor?: boolean }) {
  const [simdi, setSimdi] = useState(() => Date.now());
  const aktifVar = Array.from(kosular.values()).some((k) => !k.bitti) || ajanlar.some((a) => !!a.suAn);
  useEffect(() => {
    const t = setInterval(() => setSimdi(Date.now()), aktifVar ? 1000 : 60_000);
    return () => clearInterval(t);
  }, [aktifVar]);
  const bekleyenOnay = (a: Ajan) => a.bekleyenOnay ?? onaylar.filter((o) => o.ajanId === a.id).length;
  const calisanSayisi = ajanlar.filter((a) => suAn(a, kosular.get(a.id), mukellefAd, simdi).durum === 'calisiyor').length;

  return (
    <Kart renk={TEMA.mavi} baslik="Personel" aciklama={calisanSayisi > 0 ? `${calisanSayisi} personel çalışıyor` : 'Herkes boşta — görev kutusundan iş verin'} dolguYok>
      {yukleniyor && !ajanlar.length ? (
        <div className="flex items-center gap-2 px-5 pb-5 text-[12px]" style={{ color: TEMA.ikincil }}>
          <Loader2 size={12} className="animate-spin" /> Kadro yükleniyor…
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 px-5 pb-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-label="Personel durumu">
          {ajanlar.map((a) => {
            const d = suAn(a, kosular.get(a.id), mukellefAd, simdi);
            const onay = bekleyenOnay(a);
            const calisiyor = d.durum === 'calisiyor';
            return (
              <div
                key={a.id}
                data-ajan={a.id}
                className="flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5"
                style={{
                  background: calisiyor ? `${TEMA.mavi}14` : 'rgba(255,255,255,0.025)',
                  border: `1px solid ${calisiyor ? `${TEMA.mavi}55` : TEMA.kartKenar}`,
                }}
                title={`${a.ad} — ${a.unvan}${d.metin ? `\nşu an: ${d.metin}` : '\nboşta'}`}
              >
                <span className="relative">
                  <Avatar kisaltma={ajanKisaltma(a.id, a.ad)} boyut={32} durum={d.durum} />
                  {onay > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9.5px] font-bold" style={{ background: TEMA.altin, color: '#1a1410' }} title={`${onay} bekleyen onay`}>
                      {onay}
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold leading-tight" style={{ color: TEMA.metin }}>
                    {ajanKisaAd(a.id, a.ad)}
                  </span>
                  <span className="block truncate text-[10.5px] leading-tight" style={{ color: calisiyor ? TEMA.mavi : TEMA.soluk }}>
                    {calisiyor ? d.metin : d.durum === 'hata' ? 'son iş hatalı' : AJAN_UNVAN[a.id] || a.unvan}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Kart>
  );
}
