'use client';

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, ArrowLeftRight, CreditCard, Landmark, Target, Settings2,
  ChevronLeft, ChevronRight, Lock, MessageCircleQuestion,
} from 'lucide-react';
import { butceApi, buDonem, donemKaydir, donemTR, pinBileti } from '@/lib/butce';
import PinEkrani from './PinEkrani';
import GenelBakis from './GenelBakis';
import GelirGider from './GelirGider';
import Kartlar from './Kartlar';
import Borclar from './Borclar';
import OdemePlani from './OdemePlani';
import Ayarlar from './Ayarlar';
import Danisman from './Danisman';
import { Yukleniyor, GOLD, MUTED, TEXT, CARD_BORDER } from './ui';

const SEKMELER = [
  { anahtar: 'genel', etiket: 'Genel Bakış', ikon: LayoutDashboard },
  { anahtar: 'gelir-gider', etiket: 'Gelir & Gider', ikon: ArrowLeftRight },
  { anahtar: 'kartlar', etiket: 'Kredi Kartları', ikon: CreditCard },
  { anahtar: 'borclar', etiket: 'Borçlar', ikon: Landmark },
  { anahtar: 'plan', etiket: 'Ödeme Planı', ikon: Target },
  { anahtar: 'danisman', etiket: 'Danışman', ikon: MessageCircleQuestion },
  { anahtar: 'ayarlar', etiket: 'Ayarlar', ikon: Settings2 },
] as const;

type Sekme = (typeof SEKMELER)[number]['anahtar'];

export default function ButcePage() {
  const [sekme, setSekme] = useState<Sekme>('genel');
  const [donem, setDonem] = useState(buDonem());
  // PIN bileti sekme belleğinde: sayfa yenilense de sekme açık kaldıkça sorulmaz.
  const [kilitAcik, setKilitAcik] = useState(false);

  useEffect(() => {
    setKilitAcik(!!pinBileti.al());
    const kilitle = () => setKilitAcik(false);
    window.addEventListener('butce-pin-gerekli', kilitle);
    return () => window.removeEventListener('butce-pin-gerekli', kilitle);
  }, []);

  const erisim = useQuery({ queryKey: ['butce-erisim'], queryFn: butceApi.erisim, retry: false });
  const ozet = useQuery({
    queryKey: ['butce-ozet', donem],
    queryFn: () => butceApi.ozet(donem),
    enabled: erisim.isSuccess && kilitAcik,
  });

  if (erisim.isLoading) return <Yukleniyor metin="Yetki kontrol ediliyor…" />;

  if (erisim.isError) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <Lock size={28} className="mx-auto mb-3" style={{ color: MUTED }} />
        <h1 className="text-[15px] font-semibold" style={{ color: TEXT }}>
          Sayfa bulunamadı
        </h1>
        <p className="mt-1 text-[12px]" style={{ color: MUTED }}>
          Bu adres için görüntüleme yetkiniz yok.
        </p>
      </div>
    );
  }

  if (!kilitAcik) return <PinEkrani acildi={() => setKilitAcik(true)} />;

  const donemSecici = sekme !== 'ayarlar' && sekme !== 'kartlar' && sekme !== 'borclar' && sekme !== 'danisman';

  return (
    <div className="space-y-4 pb-10">
      {/* Başlık */}
      <header className="relative overflow-hidden rounded-2xl px-5 py-4"
        style={{
          background: 'linear-gradient(140deg, rgba(230,200,120,0.09), rgba(255,255,255,0.01) 58%)',
          border: `1px solid ${CARD_BORDER}`,
        }}
      >
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-25"
          style={{ background: `radial-gradient(circle, ${GOLD}, transparent 66%)` }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-[17px] font-semibold" style={{ color: TEXT }}>
              Kişisel Bütçe & Borç Yönetimi
              <button
                onClick={() => {
                  pinBileti.sil();
                  setKilitAcik(false);
                }}
                title="Modülü kilitle"
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition hover:brightness-125"
                style={{ background: 'rgba(255,255,255,0.05)', color: MUTED, border: `1px solid ${CARD_BORDER}` }}
              >
                <Lock size={9} /> yalnız size özel · kilitle
              </button>
            </h1>
            <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
              Gelir–gider takibi, kredi kartı ekstre yönetimi ve en verimli borç kapatma planı
            </p>
          </div>

          {donemSecici && (
            <div
              className="flex items-center gap-1 rounded-xl px-1.5 py-1"
              style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CARD_BORDER}` }}
            >
              <button
                onClick={() => setDonem(donemKaydir(donem, -1))}
                className="rounded-lg p-1 transition hover:bg-white/[0.06]"
                style={{ color: MUTED }}
              >
                <ChevronLeft size={15} />
              </button>
              <span className="min-w-[110px] text-center text-[12.5px] font-medium" style={{ color: GOLD }}>
                {donemTR(donem)}
              </span>
              <button
                onClick={() => setDonem(donemKaydir(donem, 1))}
                className="rounded-lg p-1 transition hover:bg-white/[0.06]"
                style={{ color: MUTED }}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Sekmeler */}
      <nav className="flex flex-wrap gap-1.5">
        {SEKMELER.map((s) => {
          const Ikon = s.ikon;
          const aktif = sekme === s.anahtar;
          return (
            <button
              key={s.anahtar}
              onClick={() => setSekme(s.anahtar)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] transition"
              style={{
                background: aktif ? `${GOLD}18` : 'rgba(255,255,255,0.02)',
                border: `1px solid ${aktif ? `${GOLD}44` : CARD_BORDER}`,
                color: aktif ? GOLD : MUTED,
              }}
            >
              <Ikon size={13} />
              {s.etiket}
            </button>
          );
        })}
      </nav>

      {/* İçerik */}
      {sekme === 'genel' &&
        (ozet.isLoading || !ozet.data ? <Yukleniyor /> : <GenelBakis ozet={ozet.data} donem={donem} />)}
      {sekme === 'gelir-gider' && <GelirGider donem={donem} />}
      {sekme === 'kartlar' && <Kartlar />}
      {sekme === 'borclar' && <Borclar />}
      {sekme === 'plan' && <OdemePlani donem={donem} />}
      {sekme === 'danisman' && <Danisman />}
      {sekme === 'ayarlar' && <Ayarlar />}
    </div>
  );
}
