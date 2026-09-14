'use client';

// İletim göstergesi — YALNIZ İKON (Muzaffer Bey 2026-09-14): kanal başına küçük yuvarlak simge.
//   WhatsApp: yeşil · E-posta: mavi · iletilemedi: kırmızı · sırada: sarı saat · test modu: altın nokta.
//   Ayrıntı (tarih, hata) simgenin ipucunda. Hiç kayıt yoksa soluk "—".
import { Clock3, Mail, MessageCircle } from 'lucide-react';
import type { IletimBilgisi } from '@/lib/beyan-kayitlari';

const KANAL_AD: Record<IletimBilgisi['channel'], string> = { WHATSAPP: 'WhatsApp', EMAIL: 'E-posta' };

/** Kanal başına en yeni kaydı (liste zaten en yeni önce) döner; WhatsApp önce, e-posta sonra. */
export function kanalBasinaSon(iletim?: IletimBilgisi[] | null): IletimBilgisi[] {
  const map = new Map<IletimBilgisi['channel'], IletimBilgisi>();
  for (const i of iletim || []) if (!map.has(i.channel)) map.set(i.channel, i);
  return (['WHATSAPP', 'EMAIL'] as const).map((k) => map.get(k)).filter((x): x is IletimBilgisi => !!x);
}

export function IletimSimgesi({ kayit }: { kayit: IletimBilgisi }) {
  const kanal = KANAL_AD[kayit.channel] || kayit.channel;
  const Ikon = kayit.status === 'PENDING' ? Clock3 : kayit.channel === 'EMAIL' ? Mail : MessageCircle;
  const tarih = kayit.sentAt ? new Date(kayit.sentAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const ipucu = kayit.status === 'SENT'
    ? `${kanal} ile iletildi${tarih ? ` · ${tarih}` : ''}${kayit.testMode ? ' (test modu)' : ''}`
    : kayit.status === 'FAILED'
      ? `${kanal}: iletilemedi${kayit.error ? ` — ${kayit.error}` : ''}`
      : kayit.status === 'PENDING' ? `${kanal} gönderimi sırada` : `${kanal} gönderimi atlandı`;
  const renk = kayit.status === 'SENT'
    ? (kayit.channel === 'EMAIL' ? { bg: 'rgba(127,166,221,0.16)', bd: 'rgba(127,166,221,0.5)', fg: '#9cc0ee' } : { bg: 'rgba(92,191,138,0.16)', bd: 'rgba(92,191,138,0.5)', fg: '#5cbf8a' })
    : kayit.status === 'FAILED'
      ? { bg: 'rgba(226,112,111,0.16)', bd: 'rgba(226,112,111,0.5)', fg: '#e2706f' }
      : kayit.status === 'PENDING'
        ? { bg: 'rgba(212,168,95,0.16)', bd: 'rgba(212,168,95,0.5)', fg: '#d4a85f' }
        : { bg: 'rgba(255,255,255,0.05)', bd: 'rgba(255,255,255,0.14)', fg: 'rgba(250,250,249,0.45)' };
  return (
    <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full" title={ipucu} aria-label={ipucu}
      style={{ background: renk.bg, border: `1px solid ${renk.bd}`, color: renk.fg }}>
      <Ikon size={13} strokeWidth={2.3} />
      {kayit.testMode && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" title="test modu" style={{ background: '#d4b876', boxShadow: '0 0 0 2px #0f0d0b' }} />}
    </span>
  );
}

export function IletimRozeti({ iletim }: { iletim?: IletimBilgisi[] | null }) {
  const kayitlar = kanalBasinaSon(iletim);
  if (!kayitlar.length) return <span className="text-[11.5px]" style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {kayitlar.map((k) => <IletimSimgesi key={k.channel} kayit={k} />)}
    </span>
  );
}
