'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Ajan, EkipOnay } from '@/lib/ekip';
import type { Kosu } from './kosular';
import { EKIP_ACCENT, RENK, ajanKisaAd, ajanKisaltma, ajanRengi, avatarHalkaStili, sayacMetni } from './ortak';

/** Ajanın anlık durumu — yalnız GÖSTERİM: kim çalışıyor, ne üzerinde. */
function suAnMetni(
  ajan: Ajan,
  kosu: Kosu | undefined,
  mukellefAd: (id?: string | null) => string | undefined,
  simdi: number,
): { metin: string; tam: string; nokta: 'calisiyor' | 'hata' | null } {
  // 1) Bu oturumda SSE ile koşan (Koordinatör)
  if (kosu && !kosu.bitti) {
    const m = mukellefAd(kosu.taxpayerId);
    const metin = m ? `${m} · ${kosu.gorev}` : kosu.gorev;
    return { metin, tam: `çalışıyor · ${sayacMetni(simdi - kosu.basladi)}\n${metin}`, nokta: 'calisiyor' };
  }
  // 2) GET /ekip/kadro `suAn` (sunucuda koşan iş — devir alan ajanlar dahil)
  if (ajan.suAn) {
    const m = ajan.suAn.mukellefAd || mukellefAd(ajan.suAn.mukellefId);
    const metin = m ? `${m} · ${ajan.suAn.konu}` : ajan.suAn.konu || 'çalışıyor';
    const basladi = new Date(ajan.suAn.basladi).getTime();
    const sure = isNaN(basladi) ? '' : ` · ${sayacMetni(simdi - basladi)}`;
    return { metin, tam: `çalışıyor${sure}\n${metin}`, nokta: 'calisiyor' };
  }
  // 3) Boşta — son koşu hatalıysa kırmızı nokta (kadro[].sonKosu)
  const hata = ajan.sonKosu?.status === 'failed';
  return { metin: 'boşta', tam: hata ? 'boşta · son koşu hatalı' : 'boşta', nokta: hata ? 'hata' : null };
}

/**
 * Personel sırası — 13 ajan TEK SIRA avatar (48px gradyan halka + kısaltma; altında tek kelime ad + "şu an" satırı).
 * TIKLANMAZ (Muzaffer Bey: komut yalnız Koordinatör'e; ajana tıklayınca ayrı ekran YOK). Sarmalanmaz; dar ekranda yatay kayar.
 * Durum noktası: çalışıyor (nabızlı gök mavi) · hata (kırmızı) · bekleyen onay (turuncu sayı).
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
      <div className="flex items-center gap-2 px-1 text-[11.5px]" style={{ color: RENK.ikincil }}>
        <Loader2 size={12} className="animate-spin" /> Kadro yükleniyor…
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-start gap-1.5 overflow-x-auto px-0.5 pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Personel durumu">
      {ajanlar.map((a) => {
        const renk = ajanRengi(a.id);
        const d = suAnMetni(a, kosular.get(a.id), mukellefAd, simdi);
        const onay = bekleyenOnay(a);
        const calisiyor = d.nokta === 'calisiyor';
        return (
          <div
            key={a.id}
            data-ajan={a.id}
            className="flex min-w-[72px] max-w-[118px] flex-1 flex-shrink-0 cursor-default flex-col items-center gap-1 rounded-xl px-0.5 py-1.5"
            style={{ opacity: calisiyor ? 1 : 0.7 }}
            title={`${a.ad} — ${a.unvan}\nşu an: ${d.tam}`}
          >
            <span className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full p-[2px]" style={avatarHalkaStili(renk, calisiyor)}>
              <span
                className="flex h-full w-full items-center justify-center rounded-full text-[12px] font-black tracking-wide"
                style={{ background: 'linear-gradient(160deg, #1a1815, #0b0a08)', color: renk }}
              >
                {ajanKisaltma(a.id, a.ad)}
              </span>
              {d.nokta === 'calisiyor' && (
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 animate-pulse rounded-full" style={{ background: EKIP_ACCENT, boxShadow: `0 0 0 2px #0b0a08, 0 0 10px ${EKIP_ACCENT}` }} title="çalışıyor" />
              )}
              {d.nokta === 'hata' && (
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full" style={{ background: RENK.kirmizi, boxShadow: '0 0 0 2px #0b0a08' }} title="son koşu hatalı" />
              )}
              {onay > 0 && (
                <span
                  className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black leading-none"
                  style={{ background: RENK.turuncu, color: '#0f0d0b', boxShadow: '0 0 0 2px #0b0a08' }}
                  title={`${onay} bekleyen onay`}
                >
                  {onay}
                </span>
              )}
            </span>
            <span className="w-full truncate text-center text-[10.5px] font-semibold leading-tight" style={{ color: calisiyor ? RENK.metin : 'rgba(250,250,249,0.8)' }}>
              {ajanKisaAd(a.id, a.ad)}
            </span>
            {/* İkinci satır: şu an ne üzerinde (1 satır kırpılır) */}
            <span className="w-full truncate text-center text-[10.5px] leading-tight" style={{ color: calisiyor ? EKIP_ACCENT : RENK.sonuk }}>
              {d.metin}
            </span>
          </div>
        );
      })}
    </div>
  );
}
