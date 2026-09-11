'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Ajan, AjanSonKosu, EkipOnay, IsDosyasi } from '@/lib/ekip';
import type { Kosu } from './kosular';
import { EKIP_ACCENT, RENK, ajanKisaAd, ajanKisaltma, ajanRengi, avatarHalkaStili, goreliSaat, sayacMetni } from './ortak';

/** Ajanın anlık durumu: nokta türü + araç ipucu metni. */
function sonDurum(ajan: Ajan, isler: IsDosyasi[], kosu: Kosu | undefined, simdi: number): { metin: string; nokta: 'calisiyor' | 'hata' | null } {
  if (kosu && !kosu.bitti) return { metin: `çalışıyor · ${sayacMetni(simdi - kosu.basladi)}`, nokta: 'calisiyor' };
  // İki kaynak: backend #3 `kadro[].sonKosu` (30 sn) ve isler(200). Daha YENİ olan kazanır; aynı işse status isler'den.
  const isKaydi = isler.find((i) => i.ajanId === ajan.id) ?? null;
  const kadroKaydi = ajan.sonKosu ?? null;
  let son: AjanSonKosu | null;
  if (isKaydi && kadroKaydi && kadroKaydi.id && kadroKaydi.id === isKaydi.id) son = { ...kadroKaydi, ...isKaydi };
  else if (isKaydi && (!kadroKaydi?.createdAt || new Date(isKaydi.createdAt).getTime() >= new Date(kadroKaydi.createdAt).getTime())) son = isKaydi;
  else son = kadroKaydi;
  if (!son || !son.createdAt) return { metin: isler.length >= 200 ? 'son 200 işte yok' : 'hiç koşmadı', nokta: null };
  const mod = son.dryRun === false ? 'CANLI' : 'KURU';
  if (son.status === 'running') return { metin: `çalışıyor · ${sayacMetni(simdi - new Date(son.startedAt || son.createdAt).getTime())}`, nokta: 'calisiyor' };
  if (son.status === 'failed') return { metin: `${goreliSaat(son.createdAt)} · ${mod} · Hata`, nokta: 'hata' };
  const arac = son.toolSayisi != null ? ` · ${son.toolSayisi} araç` : '';
  return { metin: `${goreliSaat(son.createdAt)} · ${mod}${arac} · ${son.status === 'done' ? 'Bitti' : 'Bekliyor'}`, nokta: null };
}

/**
 * Kadro — 13 ajan TEK SIRA avatar (48px gradyan halka + kısaltma; altında tek kelime ad).
 * Sarmalanmaz; dar ekranda yatay kayar (sayfa gövdesi kaymaz). Tık → seçili ajan; KOŞU KESİLMEZ.
 * Durum noktası: çalışıyor (nabızlı gök mavi) · hata (kırmızı) · bekleyen onay (turuncu sayı).
 */
export function AjanSeridi({
  ajanlar,
  isler,
  onaylar,
  kosular,
  seciliAjanId,
  onSec,
  yukleniyor,
}: {
  ajanlar: Ajan[];
  isler: IsDosyasi[];
  onaylar: EkipOnay[];
  kosular: Map<string, Kosu>;
  seciliAjanId: string;
  onSec: (id: string) => void;
  yukleniyor?: boolean;
}) {
  const [simdi, setSimdi] = useState(() => Date.now());
  const seritRef = useRef<HTMLDivElement>(null);

  const aktifVar = Array.from(kosular.values()).some((k) => !k.bitti) || isler.some((i) => i.status === 'running');
  useEffect(() => {
    const t = setInterval(() => setSimdi(Date.now()), aktifVar ? 1000 : 60_000);
    return () => clearInterval(t);
  }, [aktifVar]);

  // Seçili avatarı görünür tut (yatay kayan sırada)
  useEffect(() => {
    const kap = seritRef.current;
    if (!kap || kap.scrollWidth <= kap.clientWidth) return;
    kap.querySelector<HTMLElement>(`[data-ajan="${seciliAjanId}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [seciliAjanId]);

  const bekleyenOnay = (a: Ajan) => a.bekleyenOnay ?? onaylar.filter((o) => o.ajanId === a.id).length;

  if (yukleniyor && !ajanlar.length) {
    return (
      <div className="flex items-center gap-2 px-1 text-[11.5px]" style={{ color: RENK.ikincil }}>
        <Loader2 size={12} className="animate-spin" /> Kadro yükleniyor…
      </div>
    );
  }

  return (
    <div ref={seritRef} className="flex min-w-0 items-start gap-1.5 overflow-x-auto px-0.5 pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ajanlar.map((a) => {
        const renk = ajanRengi(a.id);
        const secili = a.id === seciliAjanId;
        const d = sonDurum(a, isler, kosular.get(a.id), simdi);
        const onay = bekleyenOnay(a);
        return (
          <button
            key={a.id}
            type="button"
            data-ajan={a.id}
            onClick={() => onSec(a.id)}
            className="group flex min-w-[66px] max-w-[112px] flex-1 flex-shrink-0 flex-col items-center gap-1.5 rounded-xl px-0.5 py-1.5 transition-[transform,opacity] duration-150 hover:-translate-y-px"
            style={{ opacity: secili ? 1 : 0.65 }}
            title={`${a.ad} — ${a.unvan}\n${d.metin}`}
            aria-pressed={secili}
          >
            <span className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full p-[2px] transition-[box-shadow] duration-150" style={avatarHalkaStili(renk, secili)}>
              <span
                className="flex h-full w-full items-center justify-center rounded-full text-[12px] font-black tracking-wide"
                style={{ background: 'linear-gradient(160deg, #1a1815, #0b0a08)', color: renk }}
              >
                {ajanKisaltma(a.id, a.ad)}
              </span>
              {/* Durum noktası */}
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
            <span className="w-full truncate text-center text-[10.5px] font-semibold leading-tight" style={{ color: secili ? RENK.metin : 'rgba(250,250,249,0.8)' }}>
              {ajanKisaAd(a.id, a.ad)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
