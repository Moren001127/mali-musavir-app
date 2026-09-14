'use client';

import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import type { Ajan, EkipOnay } from '@/lib/ekip';
import type { Kosu } from './kosular';
import { AvatarV5, CamKart, Kapsul, MetrikKutu, V5, Yuk } from './Cam';
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
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const bugun = new Date();
  const ayni = d.toDateString() === bugun.toDateString();
  return ayni ? saatKisa(iso).slice(0, 5) : tarihKisa(iso).slice(0, 5);
}

/**
 * Kadro kartı v5 (sağ sütun): 3 metrik (çalışan · bugün · 7 gün) + 12 personel satırı
 * (gradyan avatar, ad, unvan, durum kelimesi, son iş saati, 7 günlük yük çubuğu). Çalışan satır mavi parlar.
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
  const enCok = Math.max(1, ...Array.from(haftalikIs.values()));
  const haftaToplam = Array.from(haftalikIs.values()).reduce((t, n) => t + n, 0);

  return (
    <CamKart
      ton="mor"
      etiket="Kadro"
      ikon={<Users size={17} />}
      baslik={`${ajanlar.length || 12} yapay çalışan`}
      sag={
        <Kapsul tur={calisanSayisi ? 'calisiyor' : 'notr'} nokta nabiz={calisanSayisi > 0}>
          {calisanSayisi ? `${calisanSayisi} çalışıyor` : 'hepsi boşta'}
        </Kapsul>
      }
      dolguYok
    >
      <div className="grid grid-cols-3 gap-2 px-4 pb-4">
        <MetrikKutu deger={calisanSayisi} etiket="çalışan" renk={calisanSayisi ? V5.mavi : undefined} ortala />
        <MetrikKutu deger={bugunKosu} etiket="bugün koşu" renk={V5.mint} ortala />
        <MetrikKutu deger={haftaToplam} etiket="7 günde iş" ortala />
      </div>
      {yukleniyor && !ajanlar.length ? (
        <div className="flex items-center gap-2 px-4 pb-4 text-[12px]" style={{ color: V5.ikincil }}>
          <Loader2 size={12} className="animate-spin" /> Kadro yükleniyor…
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pb-4" aria-label="Personel durumu">
          {ajanlar.map((a, i) => {
            const d = durumlar[i];
            const onay = bekleyenOnay(a);
            const calisiyor = d.durum === 'calisiyor';
            const yuk = haftalikIs.get(a.id) || 0;
            return (
              <div
                key={a.id}
                data-ajan={a.id}
                className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl px-3 py-2.5"
                style={
                  calisiyor
                    ? { background: 'linear-gradient(90deg, rgba(110,163,255,0.2), rgba(110,163,255,0.06))', border: '1px solid rgba(110,163,255,0.5)', boxShadow: '0 10px 26px rgba(110,163,255,0.14)' }
                    : { background: 'rgba(255,255,255,0.035)', border: `1px solid ${V5.cizgi}` }
                }
                title={`${a.ad} — ${a.unvan}${d.metin ? `\nşu an: ${d.metin}` : '\nboşta'}`}
              >
                <span className="relative">
                  <AvatarV5 kisaltma={ajanKisaltma(a.id, a.ad)} ton={a.id === 'koordinator' ? 'altin' : calisiyor ? 'mavi' : 'gri'} boyut={40} nokta={calisiyor} />
                  {onay > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9.5px] font-bold" style={{ background: V5.altin, color: '#1a1410', boxShadow: `0 0 10px ${V5.altin}` }} title={`${onay} bekleyen onay`}>
                      {onay}
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-bold leading-tight" style={{ color: V5.metin }}>
                    {ajanKisaAd(a.id, a.ad)}
                  </span>
                  <span className="block truncate text-[11.5px] leading-tight" style={{ color: calisiyor ? '#9cc0ff' : V5.soluk }}>
                    {calisiyor ? d.metin : AJAN_UNVAN[a.id] || a.unvan}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block whitespace-nowrap text-[11.5px] font-bold leading-tight" style={{ color: calisiyor ? '#9cc0ff' : d.durum === 'hata' ? V5.coral : V5.soluk }}>
                    {calisiyor ? 'çalışıyor' : d.durum === 'hata' ? 'son iş hatalı' : 'boşta'}
                  </span>
                  <span className="block text-[11px] leading-tight" style={{ fontFamily: V5.mono, color: V5.soluk }}>
                    {calisiyor ? '' : sonIsEtiketi(a.sonKosu?.createdAt)}
                  </span>
                </span>
                {yuk > 0 && <Yuk yuzde={(yuk / enCok) * 100} className="col-span-2 col-start-2 mt-2" />}
              </div>
            );
          })}
        </div>
      )}
    </CamKart>
  );
}
