'use client';
import { portalStyle } from '@/lib/portal-theme';

// "Personelim Değil" onay penceresi — SGK'ya işveren beyanı; sonuç Rapor Onayı penceresiyle aynı dilde gösterilir.
import React, { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';
import type { SgkRaporSatiri } from '@mali-musavir/shared';
import { sgkViziteApi } from '@/lib/sgk-vizite';
import { METIN } from '../belge-ortak';
import { Pencere, PencereDugmesi, SonucSatiri, hataMetni, type IslemSonucu } from './ortak';
import { IsverenBeyaniUyarisi } from './RaporOnayPenceresi';

const KAPANMA_MS = 2500;

/** Çağıran taraf `key={rapor?.id}` verir: her rapor için temiz pencere. */
export function PersonelimDegilPenceresi({ rapor, onKapat, onIslendi }: {
  rapor: SgkRaporSatiri | null;
  onKapat: () => void;
  onIslendi: () => void;
}) {
  const [sonuc, setSonuc] = useState<IslemSonucu>(null);
  const mut = useMutation({
    mutationFn: (id: string) => sgkViziteApi.personelimDegil(id),
    onSuccess: (d) => {
      setSonuc(d.basarili
        ? { basarili: true, metin: `SGK: ${d.sonucAciklama || 'İşlem başarılı.'}`, kod: d.sonucKod }
        : { basarili: false, metin: `SGK reddetti: ${d.sonucAciklama || 'sebep belirtilmedi.'}`, kod: d.sonucKod });
      onIslendi();
    },
    onError: (e) => setSonuc({ basarili: false, metin: hataMetni(e, "SGK'ya ulaşılamadı; biraz sonra tekrar deneyin.") }),
  });

  useEffect(() => {
    if (!sonuc?.basarili) return;
    const t = setTimeout(onKapat, KAPANMA_MS);
    return () => clearTimeout(t);
  }, [sonuc, onKapat]);

  const bitti = !!sonuc?.basarili;
  return (
    <Pencere
      acik={!!rapor}
      onKapat={onKapat}
      baslik="Personelim Değil — SGK'ya bildirim"
      tur="sgk-personel"
      genislik={540}
      kilitli={mut.isPending}
      alt={
        <>
          <PencereDugmesi tur="ikincil" onClick={onKapat} disabled={mut.isPending}>{bitti ? 'Kapat' : 'Vazgeç'}</PencereDugmesi>
          {!bitti && (
            <PencereDugmesi tur="birincil" onClick={() => { if (rapor) { setSonuc(null); mut.mutate(rapor.id); } }} disabled={mut.isPending}>
              {mut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />} SGK&apos;ya Bildir
            </PencereDugmesi>
          )}
        </>
      }
    >
      {rapor && (
        <>
          <p data-sr-cumle className="text-[14px] leading-relaxed" style={portalStyle({ color: 'rgba(250,250,249,0.85)' })}>
            <b className="font-semibold" style={portalStyle({ color: METIN })}>{rapor.adSoyad}</b>{' '}
            (<span className="tabular-nums">{rapor.tcKimlikNo}</span>) —{' '}
            <b className="font-semibold" style={portalStyle({ color: METIN })}>{rapor.mukellefAdi}</b> işyerinin personeli değil
            olarak SGK&apos;ya bildirilecek.
          </p>
          <IsverenBeyaniUyarisi />
          <SonucSatiri sonuc={sonuc} />
        </>
      )}
    </Pencere>
  );
}
