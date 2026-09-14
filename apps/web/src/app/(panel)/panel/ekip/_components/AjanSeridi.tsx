'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Ajan, EkipOnay } from '@/lib/ekip';
import type { Kosu } from './kosular';
import { SAKIN, ajanKisaAd, ajanKisaltma, sakinAvatar, sayacMetni } from './ortak';

/** Ajanın anlık durumu — yalnız GÖSTERİM: kim çalışıyor, ne üzerinde. */
function suAnMetni(
  ajan: Ajan,
  kosu: Kosu | undefined,
  mukellefAd: (id?: string | null) => string | undefined,
  simdi: number,
): { metin: string; tam: string; durum: 'calisiyor' | 'hata' | 'bos' } {
  // 1) Bu oturumda SSE ile koşan (Koordinatör)
  if (kosu && !kosu.bitti) {
    const m = mukellefAd(kosu.taxpayerId);
    const metin = `${m ? `${m} · ` : ''}${kosu.gorev} · ${sayacMetni(simdi - kosu.basladi)}`;
    return { metin, tam: `çalışıyor · ${sayacMetni(simdi - kosu.basladi)}\n${m ? `${m} · ` : ''}${kosu.gorev}`, durum: 'calisiyor' };
  }
  // 2) GET /ekip/kadro `suAn` (sunucuda koşan iş — devir alan ajanlar dahil)
  if (ajan.suAn) {
    const m = ajan.suAn.mukellefAd || mukellefAd(ajan.suAn.mukellefId);
    const basladi = new Date(ajan.suAn.basladi).getTime();
    const sure = isNaN(basladi) ? '' : ` · ${sayacMetni(simdi - basladi)}`;
    const metin = `${m ? `${m} · ` : ''}${ajan.suAn.konu || 'çalışıyor'}${sure}`;
    return { metin, tam: `çalışıyor${sure}\n${m ? `${m} · ` : ''}${ajan.suAn.konu}`, durum: 'calisiyor' };
  }
  // 3) Boşta — son koşu hatalıysa kırmızı halka (kadro[].sonKosu)
  const hata = ajan.sonKosu?.status === 'failed';
  return { metin: '', tam: hata ? 'boşta · son koşu hatalı' : 'boşta', durum: hata ? 'hata' : 'bos' };
}

/**
 * Personel satırı — SAKİN (PLAN/19 §A.3-2): 12 küçük nötr avatar (32px, 2 harf) + ad.
 * Boştakilerde ikinci satır YOK ("boşta" 12 kez yazılmaz). Çalışanda çelik mavi halka + tek satır "Mükellef · konu · 01:12".
 * Hata: kırmızı halka; bekleyen onay: kehribar sayı. TIKLANMAZ (komut yalnız Koordinatör'e). Dar ekranda yatay kayar.
 */
export function AjanSeridi({
  ajanlar,
  onaylar,
  kosular,
  mukellefAd,
  yukleniyor,
}: {
  ajanlar: Ajan[];
  onaylar: EkipOnay[];
  kosular: Map<string, Kosu>;
  mukellefAd: (id?: string | null) => string | undefined;
  yukleniyor?: boolean;
}) {
  const [simdi, setSimdi] = useState(() => Date.now());

  const aktifVar = Array.from(kosular.values()).some((k) => !k.bitti) || ajanlar.some((a) => !!a.suAn);
  useEffect(() => {
    const t = setInterval(() => setSimdi(Date.now()), aktifVar ? 1000 : 60_000);
    return () => clearInterval(t);
  }, [aktifVar]);

  const bekleyenOnay = (a: Ajan) => a.bekleyenOnay ?? onaylar.filter((o) => o.ajanId === a.id).length;

  if (yukleniyor && !ajanlar.length) {
    return (
      <div className="flex items-center gap-2 px-1 text-[11.5px]" style={{ color: SAKIN.ikincil }}>
        <Loader2 size={12} className="animate-spin" /> Kadro yükleniyor…
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-start gap-1 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Personel durumu">
      {ajanlar.map((a) => {
        const d = suAnMetni(a, kosular.get(a.id), mukellefAd, simdi);
        const onay = bekleyenOnay(a);
        const calisiyor = d.durum === 'calisiyor';
        return (
          <div
            key={a.id}
            data-ajan={a.id}
            className="flex min-w-[68px] max-w-[140px] flex-1 flex-shrink-0 cursor-default flex-col items-center gap-1 px-0.5 py-1"
            title={`${a.ad} — ${a.unvan}\nşu an: ${d.tam}`}
          >
            <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold tracking-wide" style={sakinAvatar(d.durum)}>
              {ajanKisaltma(a.id, a.ad)}
              {onay > 0 && (
                <span
                  className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9.5px] font-bold leading-none"
                  style={{ background: SAKIN.kehribar, color: '#1a1410' }}
                  title={`${onay} bekleyen onay`}
                >
                  {onay}
                </span>
              )}
            </span>
            <span className="w-full truncate text-center text-[10.5px] leading-tight" style={{ color: calisiyor ? SAKIN.metin : SAKIN.ikincil }}>
              {ajanKisaAd(a.id, a.ad)}
            </span>
            {calisiyor && (
              <span className="w-full truncate text-center text-[10px] leading-tight" style={{ color: SAKIN.vurguAcik }}>
                {d.metin}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
