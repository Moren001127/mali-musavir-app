'use client';
import { portalStyle } from '@/lib/portal-theme';


// Gerçek gönderim öncesi küçük onay kutusu (WhatsApp / e-posta).
//   "N kaydı M mükellefe WhatsApp ile gönder — PDF'ler tek dosyada birleşir, kısa linkle gider."
//   Akıllı Bildirim VERGI ayarında testMode açıksa sarı uyarı satırı + ayar bağlantısı.
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Mail, MessageCircle, AlertTriangle, Loader2, X as IconX, Send } from 'lucide-react';
import { BeyanKaydi, IletimKanal, beyanKaydiMukellefAdi } from '@/lib/beyan-kayitlari';
import { gonderimEngeli } from './beyan-yardimcilar';

/** Akıllı Bildirim ayar sayfası (test modu burada açılıp kapanır). */
export const ILETIM_AYAR_YOLU = '/panel/ayarlar/akilli-bildirim';

const KANAL_AD: Record<IletimKanal, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'e-posta' };

export function GonderimOnayKutusu({
  channel,
  kayitlar,
  testMode,
  gonderiliyor,
  onKapat,
  onOnayla,
}: {
  channel: IletimKanal;
  kayitlar: BeyanKaydi[];
  /** null → ayar okunamadı (uyarı gösterilmez, sunucu yine test moduna göre davranır). */
  testMode: boolean | null;
  gonderiliyor: boolean;
  onKapat: () => void;
  onOnayla: (ids: string[]) => void;
}) {
  const ozet = useMemo(() => {
    const gonderilebilir: BeyanKaydi[] = [];
    const engeller = new Map<string, number>();
    for (const k of kayitlar) {
      const engel = gonderimEngeli(k, channel);
      if (engel) engeller.set(engel, (engeller.get(engel) || 0) + 1);
      else gonderilebilir.push(k);
    }
    const mukellefler = new Map<string, { ad: string; sayi: number }>();
    for (const k of gonderilebilir) {
      const m = mukellefler.get(k.taxpayerId) || { ad: beyanKaydiMukellefAdi(k), sayi: 0 };
      m.sayi += 1;
      mukellefler.set(k.taxpayerId, m);
    }
    return {
      gonderilebilir,
      engeller: [...engeller.entries()],
      mukellefler: [...mukellefler.values()].sort((a, b) => a.ad.localeCompare(b.ad, 'tr')),
    };
  }, [kayitlar, channel]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !gonderiliyor) onKapat(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onKapat, gonderiliyor]);

  if (typeof document === 'undefined') return null;

  const kanal = KANAL_AD[channel];
  const Ikon = channel === 'EMAIL' ? Mail : MessageCircle;
  const n = ozet.gonderilebilir.length;
  const m = ozet.mukellefler.length;
  const gosterilen = ozet.mukellefler.slice(0, 8);
  const kalan = ozet.mukellefler.length - gosterilen.length;

  return createPortal((
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={portalStyle({ background: 'rgba(0,0,0,0.66)' })} onClick={() => { if (!gonderiliyor) onKapat(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${kanal} ile gönderim onayı`}
        data-beyan-onay
        className="relative w-full max-w-[520px] overflow-hidden rounded-[14px]"
        style={portalStyle({ background: 'linear-gradient(160deg, #17140f, #100e0b)', border: '1px solid rgba(212,184,118,0.28)', boxShadow: '0 28px 70px -30px rgba(0,0,0,0.9)' })}
        onClick={(e) => e.stopPropagation()}
      >
        <div data-beyan-dekor className="absolute inset-x-0 top-0 h-[2px]" style={portalStyle({ background: 'linear-gradient(90deg, transparent, #d4b876, transparent)', opacity: 0.8 })} />
        <div className="flex items-start gap-3 px-5 pt-5">
          <div data-beyan-onay-icon={channel === 'EMAIL' ? 'mail' : 'whatsapp'} className="grid flex-none place-items-center" style={portalStyle({ width: 40, height: 40, borderRadius: 11, background: channel === 'EMAIL' ? 'rgba(56,189,248,0.14)' : 'rgba(34,197,94,0.14)', border: `1px solid ${channel === 'EMAIL' ? 'rgba(56,189,248,0.3)' : 'rgba(34,197,94,0.3)'}` })}>
            <Ikon size={19} style={portalStyle({ color: channel === 'EMAIL' ? '#7dd3fc' : '#86efac' })} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold" style={portalStyle({ color: '#fafaf9' })}>
              {n > 0
                ? <>{n} kaydı {m} mükellefe {kanal} ile gönder</>
                : <>Gönderilebilecek kayıt yok</>}
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed" style={portalStyle({ color: 'rgba(250,250,249,0.55)' })}>
              {n > 0
                ? 'PDF\'ler tek dosyada birleşir, kısa linkle gider. Aynı mükellefin kayıtları tek mesajda toplanır.'
                : 'Seçili kayıtların PDF\'i ya da mükellefin iletişim bilgisi eksik.'}
            </p>
          </div>
          <button type="button" onClick={onKapat} disabled={gonderiliyor} title="Kapat" data-beyan-btn="ikincil" className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-[8px]" style={portalStyle({ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.6)' })}>
            <IconX size={15} />
          </button>
        </div>

        {n > 0 && (
          <div data-beyan-onay-liste className="mx-5 mt-4 rounded-[10px] px-3 py-2.5" style={portalStyle({ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' })}>
            <ul className="space-y-1 text-[12.5px]">
              {gosterilen.map((mk) => (
                <li key={mk.ad} className="flex items-center justify-between gap-3">
                  <span className="truncate" style={portalStyle({ color: '#fafaf9' })}>{mk.ad}</span>
                  <span className="shrink-0 tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>{mk.sayi} kayıt</span>
                </li>
              ))}
              {kalan > 0 && <li className="text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>+ {kalan} mükellef daha</li>}
            </ul>
          </div>
        )}

        {ozet.engeller.length > 0 && (
          <div className="mx-5 mt-3 text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
            Atlanacak: {ozet.engeller.map(([neden, sayi]) => `${sayi} kayıt (${neden.toLocaleLowerCase('tr-TR')})`).join(' · ')}
          </div>
        )}

        {testMode === true && (
          <div data-beyan-onay-uyari className="mx-5 mt-3 flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px]" style={portalStyle({ background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.35)', color: '#fde68a' })}>
            <AlertTriangle size={15} className="mt-[1px] shrink-0" />
            <div>
              İletim ayarlarında <b>TEST MODU</b> açık: mesaj mükellefe değil {channel === 'EMAIL' ? 'test e-posta adresine' : 'test numarasına'} gider.{' '}
              <Link href={ILETIM_AYAR_YOLU} className="underline underline-offset-2" style={portalStyle({ color: '#fcd34d' })}>İletim ayarları</Link>
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2 px-5 pb-5">
          <button type="button" onClick={onKapat} disabled={gonderiliyor} data-beyan-btn="ikincil" className="inline-flex h-9 items-center rounded-[9px] px-3.5 text-[12.5px] font-semibold disabled:opacity-50" style={portalStyle({ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(250,250,249,0.72)' })}>
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => onOnayla(ozet.gonderilebilir.map((k) => k.id))}
            disabled={n === 0 || gonderiliyor}
            data-beyan-btn="birincil"
            className="inline-flex h-9 items-center gap-2 rounded-[9px] px-4 text-[12.5px] font-bold disabled:opacity-50"
            style={portalStyle({ background: 'linear-gradient(135deg, #f4c451, #e0a93c)', color: '#1a1407', boxShadow: '0 10px 22px -12px rgba(244,196,81,0.6)' })}
          >
            {gonderiliyor ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {gonderiliyor ? 'Gönderiliyor…' : `${kanal === 'e-posta' ? 'E-posta' : kanal} ile gönder`}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
