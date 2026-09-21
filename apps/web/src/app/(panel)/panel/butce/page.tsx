'use client';
import './butce-white.css';
import { portalStyle, portalPaint } from '@/lib/portal-theme';


import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, ArrowLeftRight, CreditCard, Landmark, Target, Settings2,
  ChevronLeft, ChevronRight, Lock, MessageCircleQuestion, Wallet, CalendarClock,
} from 'lucide-react';
import { butceApi, buDonem, donemKaydir, donemTR, pinBileti, DefterSecim } from '@/lib/butce';
import Hesaplar from './Hesaplar';
import NakitAkis from './NakitAkis';
import PinEkrani from './PinEkrani';
import HataSiniri from './HataSiniri';
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
    queryFn: () => butceApi.ozet(donem, 'TUMU'),
    enabled: erisim.isSuccess && kilitAcik,
  });

  if (erisim.isLoading) return <Yukleniyor metin="Yetki kontrol ediliyor…" />;

  if (erisim.isError) {
    return (
      <div data-butce data-butce-bulunamadi className="mx-auto max-w-md py-24 text-center">
        <Lock size={28} className="mx-auto mb-3" style={portalStyle({ color: MUTED })} />
        <h1 className="text-[15px] font-semibold" style={portalStyle({ color: TEXT })}>
          Sayfa bulunamadı
        </h1>
        <p className="mt-1 text-[12px]" style={portalStyle({ color: MUTED })}>
          Bu adres için görüntüleme yetkiniz yok.
        </p>
      </div>
    );
  }

  if (!kilitAcik) return <PinEkrani acildi={() => setKilitAcik(true)} />;

  const donemSecici = ['genel', 'gelir-gider', 'plan'].includes(sekme);
  // Genel "gider türü" süzgeci KALDIRILDI (kullanıcı kararı 2026-08-16).
  // Ekranlar arası rakam oynamasının kaynağı oydu; mesleki/kişisel ayrımı artık
  // giderin kendi kartında ve kategori kırılımında görünüyor.

  return (
    <div data-butce className="space-y-4 pb-10">
      {/* Başlık — beyaz temada rehber kalıbı: simge kutusu + başlık + açıklama; bant/parıltı yok */}
      <header data-butce-baslik className="relative overflow-hidden rounded-2xl px-5 py-4"
        style={portalStyle({
          background: 'linear-gradient(140deg, rgba(230,200,120,0.09), rgba(255,255,255,0.01) 58%)',
          border: `1px solid ${CARD_BORDER}`,
        })}
      >
        <div data-butce-parilti
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-25"
          style={portalStyle({ background: `radial-gradient(circle, ${GOLD}, transparent 66%)` })}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              data-butce-baslik-ikon
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
              style={portalStyle({ background: `${GOLD}1a`, border: `1px solid ${GOLD}44`, color: GOLD })}
            >
              <Wallet size={18} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[17px] font-semibold" style={portalStyle({ color: TEXT })}>
                Kişisel Bütçe & Borç Yönetimi
              </h1>
              <p className="mt-0.5 text-[12px]" style={portalStyle({ color: MUTED })}>
                Gelir–gider takibi, kredi kartı ekstre yönetimi ve en verimli borç kapatma planı
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                pinBileti.sil();
                setKilitAcik(false);
              }}
              title="Modülü kilitle"
              data-butce-kilit
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] transition hover:brightness-125"
              style={portalStyle({ background: 'rgba(255,255,255,0.05)', color: MUTED, border: `1px solid ${CARD_BORDER}` })}
            >
              <Lock size={10} /> yalnız size özel · kilitle
            </button>

            {donemSecici && (
              <div
                data-butce-donem
                className="flex items-center gap-1 rounded-xl px-1.5 py-1"
                style={portalStyle({ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CARD_BORDER}` })}
              >
                <button
                  onClick={() => setDonem(donemKaydir(donem, -1))}
                  data-butce-ikon-dugme
                  className="rounded-lg p-1 transition hover:bg-white/[0.06]"
                  style={portalStyle({ color: MUTED })}
                  aria-label="Önceki ay"
                >
                  <ChevronLeft size={15} />
                </button>
                <span data-butce-donem-etiket className="min-w-[110px] text-center text-[12.5px] font-medium" style={portalStyle({ color: GOLD })}>
                  {donemTR(donem)}
                </span>
                <button
                  onClick={() => setDonem(donemKaydir(donem, 1))}
                  data-butce-ikon-dugme
                  className="rounded-lg p-1 transition hover:bg-white/[0.06]"
                  style={portalStyle({ color: MUTED })}
                  aria-label="Sonraki ay"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Araç çubuğu — sekmeler tek şeritte */}
      <div
        data-butce-sekme-serit
        className="rounded-2xl p-2.5"
        style={portalStyle({
          background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(0,0,0,0.25))',
          border: `1px solid ${CARD_BORDER}`,
          boxShadow: '0 12px 32px -22px rgba(0,0,0,0.9)',
        })}
      >
        {/* Sekmeler */}
        <nav
          data-butce-sekmeler
          className="flex flex-wrap gap-1 rounded-xl p-1"
          style={portalStyle({ background: 'rgba(0,0,0,0.32)', border: `1px solid ${CARD_BORDER}` })}
        >
          {SEKMELER.map((s) => {
            const Ikon = s.ikon;
            const aktif = sekme === s.anahtar;
            return (
              <button
                key={s.anahtar}
                onClick={() => setSekme(s.anahtar)}
                data-butce-sekme
                aria-current={aktif ? 'page' : undefined}
                className="group relative flex items-center gap-1.5 rounded-lg px-3 py-[7px] text-[12.5px] font-medium transition-all duration-150"
                style={portalStyle({
                  background: aktif
                    ? `linear-gradient(180deg, ${GOLD}2b, ${GOLD}12)`
                    : 'transparent',
                  boxShadow: aktif ? `inset 0 0 0 1px ${GOLD}4d, 0 6px 18px -12px ${GOLD}99` : 'none',
                  color: aktif ? GOLD : MUTED,
                })}
                onMouseEnter={(e) => {
                  if (!aktif) e.currentTarget.style.background = portalPaint('rgba(255,255,255,0.045)', 'background');
                }}
                onMouseLeave={(e) => {
                  if (!aktif) e.currentTarget.style.background = portalPaint('transparent', 'background');
                }}
              >
                <Ikon size={13} style={portalStyle({ opacity: aktif ? 1 : 0.75 })} />
                {s.etiket}
                {aktif && (
                  <span
                    data-butce-sekme-cizgi
                    className="absolute inset-x-3 -bottom-[1px] h-[2px] rounded-full"
                    style={portalStyle({ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)` })}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* İçerik — her sekme kendi hata sınırında: biri çökerse diğerleri açılmaya devam eder */}
      <HataSiniri ad={SEKMELER.find((x) => x.anahtar === sekme)?.etiket} key={sekme}>
        {sekme === 'genel' &&
          (ozet.isLoading || !ozet.data ? <Yukleniyor /> : <GenelBakis ozet={ozet.data} donem={donem} />)}
        {sekme === 'gelir-gider' && <GelirGider donem={donem} defter="TUMU" />}
        {sekme === 'hesaplar' && <Hesaplar />}
        {sekme === 'kartlar' && <Kartlar />}
        {sekme === 'borclar' && <Borclar />}
        {sekme === 'nakit' && <NakitAkis />}
        {sekme === 'plan' && <OdemePlani donem={donem} defter="TUMU" />}
        {sekme === 'danisman' && <Danisman />}
        {sekme === 'ayarlar' && <Ayarlar />}
      </HataSiniri>
    </div>
  );
}
