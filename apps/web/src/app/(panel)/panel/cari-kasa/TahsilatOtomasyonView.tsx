'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck, Clock, PhoneCall, Ban, CalendarClock, Send, Eye, AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api';

/**
 * TAHSİLAT OTOMASYONU — KURU TEST EKRANI.
 *
 * Ofis sahibi sistemi açmadan önce davranışını görmek istedi:
 * "test aşamasında olsun, ben bir yapıyı sistemi göreyim anlayayım,
 *  mükellefe gönderimi sonra otomatikleştiririz."
 *
 * Bu ekran yalnız PLAN gösterir. Gönderim düğmesi YOKTUR; arkasındaki uç da
 * (GET /cari-kasa/tahsilat-otomasyon/plan) hiçbir mesaj göndermez.
 */

const KART = 'rgba(255,255,255,0.022)';
const CIZGI = 'rgba(255,255,255,0.08)';
const METIN = '#e8e8ea';
const SOLUK = '#8b8b93';
const YESIL = '#5ad18a';
const MAVI = '#6aa9e8';
const TURUNCU = '#d9a06c';
const KIRMIZI = '#e0697a';
const MOR = '#a78bfa';

const para = (n: number) =>
  `${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

const KADEME_BILGI: Record<string, { ad: string; aciklama: string; renk: string }> = {
  K0: { ad: 'Bilgilendirme', aciklama: 'Vadesi gelmiş, henüz gecikmemiş', renk: MAVI },
  K1: { ad: 'Hatırlatma', aciklama: '7 gün ve üzeri gecikme', renk: TURUNCU },
  K2: { ad: 'Hesap dökümü', aciklama: '30 gün — ekstre PDF ekli', renk: MOR },
  K3: { ad: 'Görüşme çağrısı', aciklama: '60 gün — sahip onayı şart', renk: KIRMIZI },
  ELLE: { ad: 'Elle görüşme', aciklama: '90 gün — bot susar', renk: KIRMIZI },
};

interface Karar {
  taxpayerId: string;
  ad: string;
  kademe: string | null;
  gonderilebilir: boolean;
  sebep: string | null;
  onayGerekli: boolean;
  mesaj: string | null;
  ekstreEkle: boolean;
}

interface Plan {
  otomasyonAcik: boolean;
  testModu: boolean;
  kuruTest: boolean;
  tarih: string;
  ozet: {
    gonderilecek: number;
    onayBekleyen: number;
    elleGorusulecek: number;
    atlanan: number;
    yarinaKalan: number;
    toplamAday: number;
  };
  gonderilecek: Karar[];
  onayBekleyen: Karar[];
  elleGorusulecek: Karar[];
  atlanan: Karar[];
  yarinaKalan: Karar[];
}

export default function TahsilatOtomasyonView() {
  const { data, isLoading } = useQuery<Plan>({
    queryKey: ['tahsilat-otomasyon-plan'],
    queryFn: () => api.get('/cari-kasa/tahsilat-otomasyon/plan').then((r) => r.data),
    staleTime: 60_000,
  });

  const [acik, setAcik] = React.useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="py-16 text-center text-[13px]" style={{ color: SOLUK }}>
        Plan hazırlanıyor…
      </div>
    );
  }
  if (!data) return null;

  const o = data.ozet;

  return (
    <div className="space-y-5">
      {/* Güvenlik bandı — en üstte, tartışmasız */}
      <div
        className="flex items-start gap-3 rounded-xl px-4 py-3.5"
        style={{ background: `${YESIL}0d`, border: `1px solid ${YESIL}33` }}
      >
        <ShieldCheck size={18} style={{ color: YESIL }} className="mt-0.5 flex-shrink-0" />
        <div>
          <div className="text-[13px] font-medium" style={{ color: YESIL }}>
            Kuru test — mükellefe hiçbir mesaj gönderilmiyor
          </div>
          <div className="mt-1 text-[11.5px] leading-relaxed" style={{ color: SOLUK }}>
            Bu ekran sistemin bugün ne yapacağını gösterir. Otomasyon şu an{' '}
            <strong style={{ color: data.otomasyonAcik ? TURUNCU : METIN }}>
              {data.otomasyonAcik ? 'AÇIK' : 'KAPALI'}
            </strong>
            {!data.otomasyonAcik && ' — açılana kadar hiçbir mesaj gitmez.'} Gönderim düğmesi bilinçli
            olarak yok; hazır olduğunuzda otomatik gönderimi ayrı bir adımda açacağız.
          </div>
        </div>
      </div>

      {/* Kuyruklar */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kutu
          ikon={<Send size={14} />}
          renk={MAVI}
          etiket="Bugün gidecekti"
          sayi={o.gonderilecek}
          alt={o.yarinaKalan > 0 ? `${o.yarinaKalan} kişi yarına kalırdı` : 'Günlük tavan aşılmıyor'}
        />
        <Kutu
          ikon={<Eye size={14} />}
          renk={KIRMIZI}
          etiket="Onayınızı bekler"
          sayi={o.onayBekleyen}
          alt="60 gün — görüşme çağrısı"
        />
        <Kutu
          ikon={<PhoneCall size={14} />}
          renk={TURUNCU}
          etiket="Elle görüşülmeli"
          sayi={o.elleGorusulecek}
          alt="90 gün — bot susar"
        />
        <Kutu
          ikon={<Ban size={14} />}
          renk={SOLUK}
          etiket="Atlanan"
          sayi={o.atlanan}
          alt={`${o.toplamAday} mükellef değerlendirildi`}
        />
      </div>

      {/* Kademe merdiveni — sistemin mantığı tek bakışta */}
      <div className="rounded-xl p-4" style={{ background: KART, border: `1px solid ${CIZGI}` }}>
        <div className="mb-3 text-[12px] font-medium" style={{ color: METIN }}>
          Kademe merdiveni
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {(['K0', 'K1', 'K2', 'K3', 'ELLE'] as const).map((k) => {
            const b = KADEME_BILGI[k];
            return (
              <div
                key={k}
                className="rounded-lg px-3 py-2.5"
                style={{ background: 'rgba(0,0,0,0.22)', border: `1px solid ${CIZGI}` }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: b.renk }} />
                  <span className="text-[12px]" style={{ color: METIN }}>
                    {b.ad}
                  </span>
                </div>
                <div className="mt-1 text-[10.5px] leading-relaxed" style={{ color: SOLUK }}>
                  {b.aciklama}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[10.5px] leading-relaxed" style={{ color: 'rgba(139,139,147,0.85)' }}>
          Kademe atlanmaz: 60 gündür açık ama hiç yazılmamış bir mükellefe ilk mesaj görüşme çağrısı
          değil, bilgilendirme olarak gider. Aynı kişiye 14 günden sık yazılmaz; ödeme geldiğinde,
          mükellef mesaj yazdığında ya da susturulduğunda zincir durur.
        </p>
      </div>

      {/* Listeler */}
      <Liste
        baslik="Bugün gidecek mesajlar"
        aciklama="Otomasyon açık olsaydı bugün bunlar gönderilecekti"
        renk={MAVI}
        kayitlar={data.gonderilecek}
        acik={acik}
        setAcik={setAcik}
      />

      {data.onayBekleyen.length > 0 && (
        <Liste
          baslik="Onayınızı bekleyenler"
          aciklama="60 gün ve üzeri — görüşme çağrısı, sizin onayınız olmadan gitmez"
          renk={KIRMIZI}
          kayitlar={data.onayBekleyen}
          acik={acik}
          setAcik={setAcik}
        />
      )}

      {data.elleGorusulecek.length > 0 && (
        <Liste
          baslik="Elle görüşülmesi gerekenler"
          aciklama="90 günü geçmiş — otomatik mesaj durur, bu kişilerle siz konuşmalısınız"
          renk={TURUNCU}
          kayitlar={data.elleGorusulecek}
          acik={acik}
          setAcik={setAcik}
          sebepGoster
        />
      )}

      <Liste
        baslik="Atlananlar ve sebepleri"
        aciklama="Hiçbir eleme sessiz değildir — kime neden yazılmadığı burada"
        renk={SOLUK}
        kayitlar={data.atlanan}
        acik={acik}
        setAcik={setAcik}
        sebepGoster
      />
    </div>
  );
}

function Kutu({
  ikon, renk, etiket, sayi, alt,
}: { ikon: React.ReactNode; renk: string; etiket: string; sayi: number; alt: string }) {
  return (
    <div className="rounded-xl px-4 py-3.5" style={{ background: KART, border: `1px solid ${CIZGI}` }}>
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.12em]" style={{ color: SOLUK }}>
        <span style={{ color: renk }}>{ikon}</span> {etiket}
      </div>
      <div className="mt-1.5 text-[24px] tabular-nums" style={{ color: renk }}>
        {sayi}
      </div>
      <div className="mt-0.5 text-[10.5px]" style={{ color: SOLUK }}>
        {alt}
      </div>
    </div>
  );
}

function Liste({
  baslik, aciklama, renk, kayitlar, acik, setAcik, sebepGoster,
}: {
  baslik: string;
  aciklama: string;
  renk: string;
  kayitlar: Karar[];
  acik: string | null;
  setAcik: (v: string | null) => void;
  sebepGoster?: boolean;
}) {
  if (!kayitlar.length) {
    return (
      <div className="rounded-xl p-4" style={{ background: KART, border: `1px solid ${CIZGI}` }}>
        <div className="text-[12.5px]" style={{ color: METIN }}>{baslik}</div>
        <div className="mt-2 text-[11.5px]" style={{ color: SOLUK }}>Bu grupta kimse yok.</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4" style={{ background: KART, border: `1px solid ${CIZGI}` }}>
      <div className="mb-0.5 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: renk }} />
        <span className="text-[12.5px]" style={{ color: METIN }}>{baslik}</span>
        <span className="text-[11px] tabular-nums" style={{ color: SOLUK }}>({kayitlar.length})</span>
      </div>
      <div className="mb-3 text-[11px]" style={{ color: SOLUK }}>{aciklama}</div>

      <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
        {kayitlar.map((k) => {
          const b = k.kademe ? KADEME_BILGI[k.kademe] : null;
          const secili = acik === k.taxpayerId;
          return (
            <div key={k.taxpayerId} className="rounded-lg" style={{ border: `1px solid ${CIZGI}` }}>
              <button
                onClick={() => setAcik(secili ? null : k.taxpayerId)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[12.5px]" style={{ color: METIN }}>{k.ad}</span>
                  {b && (
                    <span
                      className="flex-shrink-0 rounded px-1.5 py-[1px] text-[9.5px] uppercase tracking-wider"
                      style={{ background: `${b.renk}1c`, color: b.renk }}
                    >
                      {b.ad}
                    </span>
                  )}
                  {k.ekstreEkle && (
                    <span className="flex-shrink-0 text-[10px]" style={{ color: SOLUK }}>ekstre ekli</span>
                  )}
                </span>
                <span className="flex-shrink-0 text-[11px]" style={{ color: SOLUK }}>
                  {sebepGoster && k.sebep ? k.sebep : k.mesaj ? 'mesajı gör' : ''}
                </span>
              </button>

              {secili && k.mesaj && (
                <pre
                  className="mx-3 mb-3 whitespace-pre-wrap rounded-lg px-3 py-2.5 text-[11.5px] leading-relaxed"
                  style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CIZGI}`, color: METIN, fontFamily: 'inherit' }}
                >
                  {k.mesaj}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
