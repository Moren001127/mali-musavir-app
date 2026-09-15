'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Ajan, EkipOnay } from '@/lib/ekip';
import type { Kosu } from './kosular';
import { Avatar, GOLD, KIRMIZI, MAVI, MUTED, Nokta, Rozet, TEXT, ajanRengi } from './Tema';
import { AJAN_UNVAN, ajanKisaAd, ajanKisaltma, saatKisa, sayacMetni, tarihKisa } from './ortak';

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
 * Kadro sekmesi — 12 personel kartı (4 sütun): avatar · ad · unvan · ne yapar · şu an / son iş · bugün · 7 gün.
 * Her kart personelin kendi tonunda (Tema.AJAN_RENK): üst şerit + köşe parıltısı + gradyan zemin + avatar halkası (Bütçe KPI vurgu kalıbı).
 * Çalışan kart daha parlak (koyu gradyan, nabızlı avatar, "çalışıyor" rozeti); boşta olan sakin.
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
      <div className="flex items-center gap-2 py-8 text-[12px]" style={{ color: MUTED }}>
        <Loader2 size={13} className="animate-spin" /> Kadro yükleniyor…
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px]" style={{ color: MUTED }}>
        <span>
          <b style={{ color: TEXT }}>{ajanlar.length}</b> personel
        </span>
        <span>
          · <b style={{ color: calisanSayisi ? MAVI : TEXT }}>{calisanSayisi}</b> çalışıyor
        </span>
        <span>
          · bugün <b style={{ color: TEXT }}>{bugunKosu}</b> koşu
        </span>
        <span>
          · 7 günde <b style={{ color: TEXT }}>{haftaToplam}</b> iş
        </span>
        <span className="ml-auto">Personel işi kendi başlatmaz; görevi Koordinatör verir. Mükellefe giden her mesaj ve Luca’ya her yazım onayınıza düşer.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Personel durumu">
        {ajanlar.map((a, i) => {
          const d = durumlar[i];
          const onay = bekleyenOnay(a);
          const calisiyor = d.durum === 'calisiyor';
          const renk = ajanRengi(a.id);
          return (
            <div
              key={a.id}
              data-ajan={a.id}
              className="relative overflow-hidden rounded-2xl px-4 py-3.5"
              style={{
                background: `linear-gradient(140deg, ${renk}${calisiyor ? '30' : '1c'}, rgba(255,255,255,0.012) ${calisiyor ? '70%' : '62%'})`,
                border: `1px solid ${renk}${calisiyor ? '66' : '3a'}`,
                boxShadow: calisiyor ? `0 14px 32px rgba(0,0,0,0.22), 0 0 0 1px ${renk}22` : '0 14px 32px rgba(0,0,0,0.20)',
              }}
              title={`${a.ad} — ${a.unvan}${d.metin ? `\nşu an: ${d.metin}` : '\nboşta'}`}
            >
              {/* Üst renk şeridi (Kutu kalıbı) + köşe parıltısı (KPI kalıbı) */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, ${renk}b3, ${renk}33 60%, transparent)` }} />
              <div className={`pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full ${calisiyor ? 'opacity-[0.30] animate-pulse' : 'opacity-[0.16]'}`} style={{ background: `radial-gradient(circle, ${renk}, transparent 68%)` }} />
              <div className="relative flex items-center gap-2.5">
                <Avatar kisaltma={ajanKisaltma(a.id, a.ad)} renk={renk} boyut={34} nabiz={calisiyor} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold" style={{ color: TEXT }}>
                    {ajanKisaAd(a.id, a.ad)}
                  </div>
                  <div className="truncate text-[11px] font-medium" style={{ color: renk }}>
                    {AJAN_UNVAN[a.id] || a.unvan}
                  </div>
                </div>
                {calisiyor && <Rozet metin="çalışıyor" renk={MAVI} />}
                {onay > 0 && <Rozet metin={`${onay} onay`} renk={GOLD} />}
              </div>
              <div className="relative mt-2.5 min-h-[34px] text-[11.5px] leading-relaxed" style={{ color: MUTED }}>
                {a.aciklama || AJAN_UNVAN[a.id] || a.unvan}
              </div>
              <div className="relative mt-2.5 flex items-center justify-between gap-2 text-[11px]" style={{ color: MUTED }}>
                <span className="inline-flex min-w-0 items-center gap-1.5" style={{ color: calisiyor ? TEXT : d.durum === 'hata' ? KIRMIZI : MUTED }}>
                  {calisiyor && <Nokta renk={MAVI} nabiz />}
                  <span className="truncate">{calisiyor ? d.metin : d.durum === 'hata' ? 'son iş yarım kaldı' : sonIsEtiketi(a.sonKosu?.createdAt)}</span>
                </span>
                <span className="flex-shrink-0 tabular-nums">
                  bugün <b style={{ color: TEXT }}>{a.bugunKosu ?? 0}</b> · 7 gün <b style={{ color: TEXT }}>{haftalikIs.get(a.id) || 0}</b>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
