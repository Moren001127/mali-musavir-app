'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Monitor, MonitorOff, ShieldAlert, Activity, Gauge } from 'lucide-react';
import { getKadro, getEkipDurum, isOmurgaYok, type Ajan } from '@/lib/ekip';
import { AjanKarti } from './AjanKarti';
import { GorevPaneli } from './GorevPaneli';
import { IsDosyalari } from './IsDosyalari';
import { DonemPanosu } from './DonemPanosu';
import { OnayBekleyenler } from './OnayBekleyenler';
import { OmurgaYokBilgi } from './OmurgaYokBilgi';
import { EKIP_ACCENT } from './ortak';

/** Başlıktaki durum rozetleri — operatör, bekleyen onay, bugünkü koşu, kota. */
export function DurumRozetleri() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['ekip-durum'],
    queryFn: getEkipDurum,
    refetchInterval: 20_000,
    retry: (n, e) => !isOmurgaYok(e) && n < 2,
  });

  const rozet = (ikon: ReactNode, metin: string, renk: string, title?: string) => (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold"
      style={{ background: `${renk}14`, border: `1px solid ${renk}44`, color: renk }}
      title={title}
    >
      {ikon} {metin}
    </span>
  );

  if (isLoading) return rozet(<Loader2 size={11} className="animate-spin" />, 'Durum alınıyor', 'rgba(250,250,249,0.6)');
  if (error) {
    return rozet(<MonitorOff size={11} />, isOmurgaYok(error) ? 'Omurga yayında değil' : 'Durum alınamadı', '#a3a3a3');
  }
  if (!data) return null;
  return (
    <>
      {data.operator?.acik
        ? rozet(<Monitor size={11} />, `VPS operatör açık${data.operator.cihaz ? ` · ${data.operator.cihaz}` : ''}`, '#4ade80', 'Luca operatörü tarayıcısı açık')
        : rozet(<MonitorOff size={11} />, 'Operatör kapalı', '#f87171', 'Luca operatörü tarayıcısı kapalı')}
      {rozet(<ShieldAlert size={11} />, `${data.bekleyenOnay ?? 0} bekleyen onay`, data.bekleyenOnay ? '#fdba74' : 'rgba(250,250,249,0.6)')}
      {rozet(<Activity size={11} />, `${data.bugunKosu ?? 0} koşu bugün`, EKIP_ACCENT)}
      {data.kota &&
        rozet(
          <Gauge size={11} />,
          data.kota.limit ? `Kota ${data.kota.kullanilan}/${data.kota.limit}` : `Kota ${data.kota.kullanilan}`,
          '#c4b5fd',
        )}
    </>
  );
}

/** Ekranın gövdesi: 13 ajan kartı + görev paneli + iş dosyaları + dönem panosu. */
export function EkipEkrani() {
  const qc = useQueryClient();
  const [seciliId, setSeciliId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: ajanlar = [], isLoading, error } = useQuery({
    queryKey: ['ekip-kadro'],
    queryFn: getKadro,
    staleTime: 5 * 60_000,
    retry: (n, e) => !isOmurgaYok(e) && n < 2,
  });

  const secili: Ajan | undefined = ajanlar.find((a) => a.id === seciliId);

  // Kart seçilince panele kaydır (mobilde panel altta)
  useEffect(() => {
    if (secili && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [secili?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-4">
      {/* Kadro */}
      <section>
        <div className="mb-2 flex items-center gap-2 px-1">
          <h2 className="text-sm font-bold" style={{ color: '#fafaf9' }}>Kadro</h2>
          <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
            {ajanlar.length ? `${ajanlar.length} ajan — karta tıkla, görev ver` : '13 ajan'}
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-8 text-xs" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Loader2 size={12} className="animate-spin" /> Kadro yükleniyor…
          </div>
        ) : error ? (
          isOmurgaYok(error) ? (
            <OmurgaYokBilgi />
          ) : (
            <div
              className="rounded-xl px-4 py-3 text-xs"
              style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#fecaca' }}
            >
              Kadro alınamadı: {(error as any)?.message || 'hata'}
            </div>
          )
        ) : !ajanlar.length ? (
          <div className="py-8 text-center text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>Kadro boş.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {ajanlar.map((a) => (
                <AjanKarti
                  key={a.id}
                  ajan={a}
                  secili={a.id === seciliId}
                  onSec={() => setSeciliId((s) => (s === a.id ? null : a.id))}
                />
              ))}
            </div>
            <div ref={panelRef} className="order-first lg:order-none lg:self-start">
              {secili ? (
                <GorevPaneli
                  ajan={secili}
                  onKapat={() => setSeciliId(null)}
                  onIsBitti={() => {
                    qc.invalidateQueries({ queryKey: ['ekip-isler'] });
                    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
                    qc.invalidateQueries({ queryKey: ['ekip-pano'] });
                  }}
                />
              ) : (
                <div
                  className="hidden items-center justify-center rounded-2xl px-6 py-10 text-center text-xs lg:flex"
                  style={{
                    background: `radial-gradient(120% 120% at 50% 0%, ${EKIP_ACCENT}12, transparent 55%), rgba(255,255,255,0.02)`,
                    border: `1px dashed ${EKIP_ACCENT}44`,
                    color: 'rgba(250,250,249,0.5)',
                  }}
                >
                  <p className="leading-relaxed">
                    Bir ajan kartında <b style={{ color: EKIP_ACCENT }}>Görev ver</b>’e bas; panel burada açılır.
                    <br />
                    Kuru test varsayılan açıktır: mesaj gitmez, Luca’ya yazılmaz.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <OnayBekleyenler />
      <IsDosyalari ajanlar={ajanlar} />
      <DonemPanosu />
    </div>
  );
}
