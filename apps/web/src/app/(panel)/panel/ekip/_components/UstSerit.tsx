'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Loader2, AlertOctagon, Sun } from 'lucide-react';
import { isOmurgaYok, type EkipDurum } from '@/lib/ekip';
import { V5 } from './Cam';
import { bugunMu, saatKisa } from './ortak';

/** "Salı, 15 Eylül 2026" — İstanbul takvimi; hidrasyon uyuşmazlığı olmasın diye istemcide hesaplanır. */
function bugunEtiketi(): string {
  const d = new Date();
  const gun = d.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
  const tarih = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
  return `${gun}, ${tarih}`;
}

/** Cam kapsül (üst şerit): simge/nokta + metin. */
function Hap({ children, nokta, altin = false, title }: { children: React.ReactNode; nokta?: string; altin?: boolean; title?: string }) {
  return (
    <span
      className="inline-flex h-9 flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-medium"
      style={
        altin
          ? { color: '#1b1607', background: 'linear-gradient(180deg, #eed48f, #cfa94d)', border: '1px solid #b8933f', fontWeight: 700, boxShadow: '0 8px 24px rgba(227,194,111,0.22)' }
          : { color: V5.ikincil, background: V5.cam, border: `1px solid ${V5.cizgi}`, backdropFilter: 'blur(10px)' }
      }
      title={title}
    >
      {nokta && <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: nokta, boxShadow: `0 0 10px ${nokta}` }} />}
      {children}
    </span>
  );
}

/**
 * Üst şerit v5: altın gradyanlı serif başlık + alt cümle; sağda cam kapsüller (tarih · Luca operatörü · Max · sabah özeti).
 * Sayaç kutusu YOK (Muzaffer Bey'in reddettiği kalıp); sayılar Koordinatör kartında ve sağ sütunda.
 */
export function UstSerit({ durum, durumHata, durumYukleniyor }: { durum: EkipDurum | undefined; durumHata: unknown; durumYukleniyor: boolean }) {
  const [gunMetni, setGunMetni] = useState('');
  useEffect(() => setGunMetni(bugunEtiketi()), []);
  const sonSabah = durum?.sonSabahOzeti?.createdAt || null;
  const sabahBugun = !!sonSabah && bugunMu(sonSabah);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h1
            className="text-[34px] font-bold leading-none tracking-tight"
            style={{ fontFamily: "var(--font-heading, 'Fraunces'), Georgia, serif", background: 'linear-gradient(90deg, #ffffff 0%, #f3e6c2 60%, #e3c26f 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
          >
            Ekip
          </h1>
          <div className="mt-1.5 text-[13.5px]" style={{ color: V5.ikincil }}>
            Yapay çalışan kadronuz — görev verin, ilerlemeyi izleyin, kararı siz verin.
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <Hap>
            <CalendarDays size={14} style={{ color: V5.ikincil }} />
            <span style={{ color: V5.metin, fontWeight: 600 }}>{gunMetni || ' '}</span>
          </Hap>
          {durumYukleniyor ? (
            <Hap>
              <Loader2 size={13} className="animate-spin" /> Durum alınıyor
            </Hap>
          ) : durumHata ? (
            <Hap nokta={V5.soluk}>{isOmurgaYok(durumHata) ? 'Omurga yayında değil' : 'Durum alınamadı'}</Hap>
          ) : durum ? (
            <>
              <Hap nokta={durum.operator?.acik ? V5.mint : V5.coral} title={durum.operator?.cihaz ? `Cihaz: ${durum.operator.cihaz}` : undefined}>
                Luca operatörü{durum.operator?.acik ? '' : ' kapalı'}
              </Hap>
              <Hap nokta={durum.maxBagli === false ? V5.coral : V5.mint}>Max{durum.maxBagli === false ? ' bağlı değil' : ''}</Hap>
              <Hap altin title={sonSabah ? `Son üretim ${saatKisa(sonSabah).slice(0, 5)}` : durum.sabahOzeti ? 'Her sabah 08:30' : 'Sabah özeti kapalı'}>
                <Sun size={14} /> Sabah özeti{sabahBugun ? ' · bugün gitti' : durum.sabahOzeti ? ' · 08:30' : ' · kapalı'}
              </Hap>
            </>
          ) : null}
        </div>
      </div>
      {durum?.maxBagli === false && (
        <div className="flex items-start gap-2 rounded-2xl px-4 py-3 text-[13px]" style={{ background: 'rgba(255,107,122,0.10)', border: '1px solid rgba(255,107,122,0.45)', color: V5.metin }}>
          <AlertOctagon size={15} className="mt-0.5 flex-shrink-0" style={{ color: V5.coral }} />
          <span>
            <b>Max bağlı değil</b> — hiçbir personel çalışamaz. Sunucuda CLAUDE_CODE_OAUTH_TOKEN yok.
          </span>
        </div>
      )}
    </div>
  );
}
