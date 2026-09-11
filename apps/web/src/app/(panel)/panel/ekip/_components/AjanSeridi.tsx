'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Loader2 } from 'lucide-react';
import type { Ajan, AjanSonKosu, EkipOnay, IsDosyasi } from '@/lib/ekip';
import type { Kosu } from './kosular';
import { AJAN_RENK, EKIP_ACCENT, RENK, ajanKisaltma, ajanRengi, goreliSaat, ikonStili, kartArkaPlan, modelRengi, sayacMetni, seritStili } from './ortak';

/** Ajan satırının alt bilgi metni + rengi. */
function sonDurum(
  ajan: Ajan,
  isler: IsDosyasi[],
  kosu: Kosu | undefined,
  simdi: number,
): { metin: string; renk: string; nokta: 'calisiyor' | 'hata' | null } {
  if (kosu && !kosu.bitti) {
    return { metin: `çalışıyor · ${sayacMetni(simdi - kosu.basladi)}`, renk: EKIP_ACCENT, nokta: 'calisiyor' };
  }
  // İki kaynak var: backend #3 `kadro[].sonKosu` (30 sn) ve isler(200) (30 sn / koşuda 10 sn).
  // Hangisi daha YENİ ise o kazanır; aynı iş ise status/süre isler'den alınır (kadro takılı 'running' göstermesin).
  const isKaydi = isler.find((i) => i.ajanId === ajan.id) ?? null;
  const kadroKaydi = ajan.sonKosu ?? null;
  let son: AjanSonKosu | null;
  if (isKaydi && kadroKaydi && kadroKaydi.id && kadroKaydi.id === isKaydi.id) {
    son = { ...kadroKaydi, ...isKaydi };
  } else if (isKaydi && (!kadroKaydi?.createdAt || new Date(isKaydi.createdAt).getTime() >= new Date(kadroKaydi.createdAt).getTime())) {
    son = isKaydi;
  } else {
    son = kadroKaydi;
  }
  if (!son || !son.createdAt) {
    return { metin: isler.length >= 200 ? 'son 200 işte yok' : 'hiç koşmadı', renk: RENK.sonuk, nokta: null };
  }
  const mod = son.dryRun === false ? 'CANLI' : 'KURU';
  if (son.status === 'running') {
    const ms = simdi - new Date(son.startedAt || son.createdAt).getTime();
    return { metin: `çalışıyor · ${sayacMetni(ms)}`, renk: EKIP_ACCENT, nokta: 'calisiyor' };
  }
  if (son.status === 'failed') {
    return { metin: `${goreliSaat(son.createdAt)} · ${mod} · Hata`, renk: RENK.kirmizi, nokta: 'hata' };
  }
  const arac = son.toolSayisi != null ? ` · ${son.toolSayisi} araç` : '';
  return { metin: `${goreliSaat(son.createdAt)} · ${mod}${arac} · ${son.status === 'done' ? 'Bitti' : 'Bekliyor'}`, renk: RENK.ikincil, nokta: null };
}

/**
 * Kadro şeridi — masaüstünde 13 satırlık ince liste, mobilde yatay avatar şeridi.
 * Tık → seçili ajan değişir; KOŞU KESİLMEZ. Açıklama / onay noktası / "Görev ver" satırda YOK.
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

  // Canlı sayaç (çalışan koşu varken saniyede bir; yoksa dakikada bir "12 dk önce" tazelenir)
  const aktifVar = Array.from(kosular.values()).some((k) => !k.bitti) || isler.some((i) => i.status === 'running');
  useEffect(() => {
    const t = setInterval(() => setSimdi(Date.now()), aktifVar ? 1000 : 60_000);
    return () => clearInterval(t);
  }, [aktifVar]);

  // Mobil şeritte seçili avatarı ortala
  useEffect(() => {
    const kap = seritRef.current;
    if (!kap || kap.offsetParent === null) return;
    const el = kap.querySelector<HTMLElement>(`[data-ajan="${seciliAjanId}"]`);
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [seciliAjanId]);

  const bekleyenOnay = (a: Ajan) => a.bekleyenOnay ?? onaylar.filter((o) => o.ajanId === a.id).length;

  return (
    <section className="relative min-w-0 overflow-hidden rounded-2xl" style={kartArkaPlan(EKIP_ACCENT)}>
      <div className="h-1 w-full" style={seritStili(EKIP_ACCENT)} />
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-xs font-bold" style={{ color: RENK.metin }}>
          Kadro · {ajanlar.length || 13}
        </span>
        {yukleniyor && <Loader2 size={11} className="animate-spin" style={{ color: RENK.ikincil }} />}
      </div>

      {/* Masaüstü / tablet: 13 satır */}
      <div className="hidden flex-col pb-1 lg:flex">
        {ajanlar.map((a) => {
          const renk = ajanRengi(a.id);
          const secili = a.id === seciliAjanId;
          const d = sonDurum(a, isler, kosular.get(a.id), simdi);
          const onay = bekleyenOnay(a);
          const koordinator = a.id === 'koordinator';
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSec(a.id)}
              className="flex h-12 w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-white/[0.03]"
              style={secili ? { background: kartArkaPlan(renk, true).background, borderLeft: `3px solid ${renk}` } : { borderLeft: '3px solid transparent' }}
              title={a.unvan}
            >
              <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[10px] font-black" style={{ ...ikonStili(renk), ...(koordinator ? { boxShadow: `0 0 0 2px ${AJAN_RENK.koordinator}88` } : {}) }}>
                {ajanKisaltma(a.id, a.ad)}
                {koordinator && (
                  <Mic size={10} className="absolute -bottom-1 -right-1 rounded-full p-[1px]" style={{ background: '#0f0d0b', color: renk }} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-bold leading-tight" style={{ color: RENK.metin }}>{a.ad}</span>
                  <span className="flex-shrink-0 rounded px-1 text-[9px] font-bold leading-4" style={{ background: `${modelRengi(a.model)}1a`, color: modelRengi(a.model) }}>
                    {a.model}
                  </span>
                </span>
                <span className="block truncate text-[11px] leading-tight" style={{ color: d.renk }}>{d.metin}</span>
              </span>
              <span className="flex flex-shrink-0 items-center gap-1.5">
                {onay > 0 && (
                  <span className="rounded-full px-1.5 text-[10px] font-bold leading-4" style={{ background: `${RENK.turuncu}22`, border: `1px solid ${RENK.turuncu}66`, color: RENK.turuncu }} title={`${onay} bekleyen onay`}>
                    {onay}
                  </span>
                )}
                {d.nokta === 'calisiyor' && <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: EKIP_ACCENT, boxShadow: `0 0 8px ${EKIP_ACCENT}` }} />}
                {d.nokta === 'hata' && <span className="h-2 w-2 rounded-full" style={{ background: RENK.kirmizi }} />}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mobil: yatay avatar şeridi */}
      <div ref={seritRef} className="flex snap-x gap-3 overflow-x-auto px-3 pb-3 pt-1 lg:hidden">
        {ajanlar.map((a) => {
          const renk = ajanRengi(a.id);
          const secili = a.id === seciliAjanId;
          const d = sonDurum(a, isler, kosular.get(a.id), simdi);
          const onay = bekleyenOnay(a);
          const koordinator = a.id === 'koordinator';
          return (
            <button
              key={a.id}
              type="button"
              data-ajan={a.id}
              onClick={() => onSec(a.id)}
              className="flex w-16 flex-shrink-0 snap-center flex-col items-center gap-1"
              title={`${a.ad} — ${d.metin}`}
            >
              <span
                className={`relative flex h-14 w-14 items-center justify-center rounded-full text-[13px] font-black ${d.nokta === 'calisiyor' ? 'animate-pulse' : ''}`}
                style={{
                  ...ikonStili(renk),
                  boxShadow: secili
                    ? `0 0 0 3px ${renk}, 0 0 0 5px rgba(0,0,0,0.6)`
                    : koordinator
                      ? `0 0 0 2px ${AJAN_RENK.koordinator}88`
                      : d.nokta === 'calisiyor'
                        ? `0 0 0 2px ${EKIP_ACCENT}`
                        : d.nokta === 'hata'
                          ? `0 0 0 2px ${RENK.kirmizi}`
                          : 'none',
                }}
              >
                {ajanKisaltma(a.id, a.ad)}
                {onay > 0 && (
                  <span className="absolute -right-1 -top-1 rounded-full px-1.5 text-[10px] font-bold leading-4" style={{ background: RENK.turuncu, color: '#0f0d0b' }}>
                    {onay}
                  </span>
                )}
              </span>
              <span className="w-full truncate text-center text-[10px] font-semibold" style={{ color: secili ? RENK.metin : RENK.ikincil }}>
                {a.ad.split(' ')[0]}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
