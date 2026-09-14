'use client';

// İletim rozeti (sözleşme §6): `iletim[0]` → SENT: yeşil "WhatsApp · 12 Eyl" / "E-posta · 12 Eyl";
// FAILED: kırmızı "İletilemedi" (title = hata); testMode: rozet ucunda "test"; kayıt yoksa rozet yok.
import { Mail, MessageCircle, Clock3, MinusCircle } from 'lucide-react';
import type { IletimBilgisi } from '@/lib/beyan-kayitlari';
import { fmtKisaTarih } from './beyan-yardimcilar';

const KANAL_AD: Record<IletimBilgisi['channel'], string> = { WHATSAPP: 'WhatsApp', EMAIL: 'E-posta' };

export function IletimRozeti({ iletim }: { iletim?: IletimBilgisi[] | null }) {
  const son = iletim && iletim.length ? iletim[0] : null;
  if (!son) return null;

  const kanal = KANAL_AD[son.channel] || son.channel;
  const Ikon = son.channel === 'EMAIL' ? Mail : MessageCircle;
  const testEki = son.testMode ? <span className="ml-1 rounded-[4px] px-1 text-[9px] font-extrabold uppercase tracking-[0.08em]" style={{ background: 'rgba(251,191,36,0.18)', color: '#fcd34d' }}>test</span> : null;
  const taban = 'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-[7px] px-2 py-[3px] text-[11px] font-semibold';

  if (son.status === 'SENT') {
    const tarih = fmtKisaTarih(son.sentAt);
    return (
      <span className={taban} title={`${kanal} ile iletildi${son.sentAt ? ` · ${new Date(son.sentAt).toLocaleString('tr-TR')}` : ''}${son.testMode ? ' (test modu)' : ''}`}
        style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.28)', color: '#86efac' }}>
        <Ikon size={11} strokeWidth={2.4} /> {kanal}{tarih ? ` · ${tarih}` : ''}{testEki}
      </span>
    );
  }
  if (son.status === 'FAILED') {
    return (
      <span className={taban} title={son.error || `${kanal} gönderimi başarısız`}
        style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.28)', color: '#fda4af' }}>
        <Ikon size={11} strokeWidth={2.4} /> İletilemedi{testEki}
      </span>
    );
  }
  if (son.status === 'PENDING') {
    return (
      <span className={taban} title={`${kanal} gönderimi sırada`}
        style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.28)', color: '#fcd34d' }}>
        <Clock3 size={11} strokeWidth={2.4} /> Sırada{testEki}
      </span>
    );
  }
  // SKIPPED
  return (
    <span className={taban} title={son.error || `${kanal} gönderimi atlandı`}
      style={{ background: 'rgba(148,163,184,0.10)', border: '1px solid rgba(148,163,184,0.22)', color: 'rgba(226,232,240,0.7)' }}>
      <MinusCircle size={11} strokeWidth={2.4} /> Atlandı{testEki}
    </span>
  );
}
