'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Loader2, Monitor, MonitorOff, Plug, PlugZap, Sunrise, AlertOctagon } from 'lucide-react';
import { isOmurgaYok } from '@/lib/ekip';
import { SORGU } from './kosular';
import { EKIP_ACCENT, RENK, kartArkaPlan } from './ortak';

/** "Cuma 12 Eylül" — İstanbul takvimi; hidrasyon uyuşmazlığı olmasın diye istemcide hesaplanır. */
function bugunEtiketi(): string {
  const d = new Date();
  const gun = d.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
  const tarih = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' });
  return `${gun} ${tarih}`;
}

/**
 * Konsol başlığı: ikon · "Moren Ekip" · alt satır (gün · çalışan · çalışıyor) · sistem rozetleri.
 * Kota / bekleyen onay / bugün koşu rozetleri YOK (SabahBandi'na indi). Yapışkan değil.
 */
export function KonsolBaslik() {
  const [gunMetni, setGunMetni] = useState('');
  useEffect(() => setGunMetni(bugunEtiketi()), []);

  const { data: durum, error: durumHata, isLoading: durumYukleniyor } = useQuery(SORGU.durum);
  const { data: kadro = [] } = useQuery(SORGU.kadro);
  const { data: isler = [] } = useQuery(SORGU.isler(false));

  // FE yedeği: backend #2 `durum.calisan` gelene kadar isler(200)'de running sayısı.
  const calisan = durum?.calisan ?? isler.filter((i) => i.status === 'running').length;

  const rozet = (ikon: ReactNode, metin: string, renk: string, title?: string) => (
    <span
      className="inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold"
      style={{ background: `${renk}14`, border: `1px solid ${renk}44`, color: renk }}
      title={title}
    >
      {ikon} {metin}
    </span>
  );

  const rozetler = () => {
    if (durumYukleniyor) return rozet(<Loader2 size={11} className="animate-spin" />, 'Durum alınıyor', 'rgba(250,250,249,0.6)');
    if (durumHata) return rozet(<MonitorOff size={11} />, isOmurgaYok(durumHata) ? 'Omurga yayında değil' : 'Durum alınamadı', RENK.gri);
    if (!durum) return null;
    return (
      <>
        {durum.operator?.acik
          ? rozet(<Monitor size={11} />, `Operatör açık${durum.operator.cihaz ? ` · ${durum.operator.cihaz}` : ''}`, RENK.yesil, 'Luca operatörü tarayıcısı açık')
          : rozet(<MonitorOff size={11} />, 'Operatör kapalı', RENK.kirmizi, 'Luca operatörü tarayıcısı kapalı')}
        {durum.maxBagli === false
          ? rozet(<Plug size={11} />, 'Max bağlı değil', RENK.kirmizi, 'Sunucuda CLAUDE_CODE_OAUTH_TOKEN yok')
          : rozet(<PlugZap size={11} />, 'Max bağlı', RENK.yesil, 'Claude Max hesabı bağlı')}
        {durum.sabahOzeti
          ? rozet(<Sunrise size={11} />, 'Sabah özeti 08:30 AÇIK', EKIP_ACCENT, 'Koordinatör her sabah 08:30 özet üretir')
          : rozet(<Sunrise size={11} />, 'Sabah özeti KAPALI', 'rgba(250,250,249,0.6)', 'EKIP_SABAH_OZETI=on değil')}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <header
        className="relative overflow-hidden rounded-2xl px-4 py-2.5"
        style={{
          background: 'linear-gradient(135deg, rgba(14,20,26,0.94), rgba(7,8,10,0.94))',
          border: `1px solid ${EKIP_ACCENT}29`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 40px rgba(0,0,0,0.28)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background: `radial-gradient(circle at 8% 0%, ${EKIP_ACCENT}26, transparent 40%), radial-gradient(circle at 100% 120%, ${RENK.mor}18, transparent 42%)`,
          }}
        />
        <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${EKIP_ACCENT}, #5b9fd1)`,
              color: '#0b1218',
              boxShadow: `0 0 22px ${EKIP_ACCENT}33, inset 0 1px 0 rgba(255,255,255,0.25)`,
            }}
          >
            <Users size={20} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight" style={{ color: RENK.metin }}>
              Moren Ekip
            </h1>
            <p className="truncate text-xs" style={{ color: RENK.ikincil }}>
              {gunMetni ? `${gunMetni} · ` : ''}
              {kadro.length || 13} çalışan · {calisan} çalışıyor
            </p>
          </div>
          {/* Rozetler: mobilde yatay kayar (sayfa gövdesi kaymaz) */}
          <div className="flex min-w-0 basis-full items-center gap-1.5 overflow-x-auto pb-0.5 sm:basis-auto sm:flex-wrap sm:overflow-visible sm:pb-0">
            {rozetler()}
          </div>
        </div>
      </header>

      {durum?.maxBagli === false && (
        <div className="flex items-start gap-2 rounded-xl px-4 py-2.5 text-xs" style={{ ...kartArkaPlan(RENK.kirmizi), color: '#fecaca' }}>
          <AlertOctagon size={15} className="mt-0.5 flex-shrink-0" style={{ color: RENK.kirmizi }} />
          <span>
            <b>Max bağlı değil</b> — hiçbir ajan koşamaz. Sunucuda CLAUDE_CODE_OAUTH_TOKEN yok.
          </span>
        </div>
      )}
    </div>
  );
}
