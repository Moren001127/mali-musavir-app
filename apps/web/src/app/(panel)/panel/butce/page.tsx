'use client';

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, ArrowLeftRight, CreditCard, Landmark, Target, Settings2,
  ChevronLeft, ChevronRight, Lock, MessageCircleQuestion, Wallet, CalendarClock,
  User, Building2, Layers,
} from 'lucide-react';
import { butceApi, buDonem, donemKaydir, donemTR, pinBileti, DefterSecim } from '@/lib/butce';
import Hesaplar from './Hesaplar';
import NakitAkis from './NakitAkis';
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
  { anahtar: 'hesaplar', etiket: 'Hesaplar', ikon: Wallet },
  { anahtar: 'kartlar', etiket: 'Kredi Kartları', ikon: CreditCard },
  { anahtar: 'borclar', etiket: 'Borçlar', ikon: Landmark },
  { anahtar: 'nakit', etiket: 'Nakit Akışı', ikon: CalendarClock },
  { anahtar: 'plan', etiket: 'Ödeme Planı', ikon: Target },
  { anahtar: 'danisman', etiket: 'Danışman', ikon: MessageCircleQuestion },
  { anahtar: 'ayarlar', etiket: 'Ayarlar', ikon: Settings2 },
] as const;

/** Şahsi / Ofis ayrımı — aynı kart ve hesap iki defterde de kullanılabilir */
const DEFTERLER: Array<{ deger: DefterSecim; etiket: string; ikon: any }> = [
  { deger: 'TUMU', etiket: 'Tümü', ikon: Layers },
  { deger: 'OFIS', etiket: 'Mesleki', ikon: Building2 },
  { deger: 'SAHSI', etiket: 'Kişisel', ikon: User },
];

type Sekme = (typeof SEKMELER)[number]['anahtar'];

export default function ButcePage() {
  const [sekme, setSekme] = useState<Sekme>('genel');
  const [donem, setDonem] = useState(buDonem());
  const [defter, setDefter] = useState<DefterSecim>('TUMU');
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
    queryKey: ['butce-ozet', donem, defter],
    queryFn: () => butceApi.ozet(donem, defter),
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

  const donemSecici = ['genel', 'gelir-gider', 'plan'].includes(sekme);

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

      {/* Araç çubuğu — gider türü süzgeci ve sekmeler tek şeritte */}
      <div
        className="rounded-2xl p-2.5"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(0,0,0,0.25))',
          border: `1px solid ${CARD_BORDER}`,
          boxShadow: '0 12px 32px -22px rgba(0,0,0,0.9)',
        }}
      >
        {/* Gider türü — gelir tek havuz olduğu için yalnız gideri süzer */}
        <div className="flex flex-wrap items-center gap-2 px-1 pb-2.5">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.14em]" style={{ color: MUTED }}>
            Gider türü
          </span>
          <div
            className="flex items-center gap-0.5 rounded-full p-0.5"
            style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${CARD_BORDER}` }}
          >
            {DEFTERLER.map((d) => {
              const Ikon = d.ikon;
              const aktif = defter === d.deger;
              return (
                <button
                  key={d.deger}
                  onClick={() => setDefter(d.deger)}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium transition-all duration-150"
                  style={{
                    background: aktif ? `linear-gradient(180deg, ${GOLD}2e, ${GOLD}16)` : 'transparent',
                    boxShadow: aktif ? `inset 0 0 0 1px ${GOLD}4d` : 'none',
                    color: aktif ? GOLD : MUTED,
                  }}
                >
                  <Ikon size={12} /> {d.etiket}
                </button>
              );
            })}
          </div>
          <span className="text-[10.5px]" style={{ color: 'rgba(113,113,122,0.9)' }}>
            {defter === 'TUMU'
              ? 'Bütün giderler · gelir her zaman tek havuzdur'
              : defter === 'OFIS'
                ? 'Yalnız mesleki giderler — kazançtan indirilenler'
                : 'Yalnız kişisel harcamalar — kazançtan indirilemeyenler'}
          </span>
        </div>

        {/* Sekmeler */}
        <nav
          className="flex flex-wrap gap-1 rounded-xl p-1"
          style={{ background: 'rgba(0,0,0,0.32)', border: `1px solid ${CARD_BORDER}` }}
        >
          {SEKMELER.map((s) => {
            const Ikon = s.ikon;
            const aktif = sekme === s.anahtar;
            return (
              <button
                key={s.anahtar}
                onClick={() => setSekme(s.anahtar)}
                className="group relative flex items-center gap-1.5 rounded-lg px-3 py-[7px] text-[12.5px] font-medium transition-all duration-150"
                style={{
                  background: aktif
                    ? `linear-gradient(180deg, ${GOLD}2b, ${GOLD}12)`
                    : 'transparent',
                  boxShadow: aktif ? `inset 0 0 0 1px ${GOLD}4d, 0 6px 18px -12px ${GOLD}99` : 'none',
                  color: aktif ? GOLD : MUTED,
                }}
                onMouseEnter={(e) => {
                  if (!aktif) e.currentTarget.style.background = 'rgba(255,255,255,0.045)';
                }}
                onMouseLeave={(e) => {
                  if (!aktif) e.currentTarget.style.background = 'transparent';
                }}
              >
                <Ikon size={13} style={{ opacity: aktif ? 1 : 0.75 }} />
                {s.etiket}
                {aktif && (
                  <span
                    className="absolute inset-x-3 -bottom-[1px] h-[2px] rounded-full"
                    style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` }}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* İçerik */}
      {sekme === 'genel' &&
        (ozet.isLoading || !ozet.data ? <Yukleniyor /> : <GenelBakis ozet={ozet.data} donem={donem} />)}
      {sekme === 'gelir-gider' && <GelirGider donem={donem} defter={defter} />}
      {sekme === 'hesaplar' && <Hesaplar />}
      {sekme === 'kartlar' && <Kartlar />}
      {sekme === 'borclar' && <Borclar />}
      {sekme === 'nakit' && <NakitAkis />}
      {sekme === 'plan' && <OdemePlani donem={donem} defter={defter} />}
      {sekme === 'danisman' && <Danisman />}
      {sekme === 'ayarlar' && <Ayarlar />}
    </div>
  );
}
