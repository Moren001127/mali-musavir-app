'use client';

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { CARD_BORDER, KIRMIZI, MUTED, TEXT } from './ui';

/**
 * Modül genelinde hata sınırı.
 *
 * Tek bir ekrandaki beklenmeyen veri (sunucu ile arayüzün farklı sürümde
 * olması, eksik alan, bozuk kayıt) bütün sayfayı boş beyaz "Application error"
 * ekranına çeviriyordu. Kullanıcı ne olduğunu göremiyor, modüle hiç
 * giremiyordu. Artık hata yakalanır, sebebi ekranda yazılır ve diğer sekmeler
 * çalışmaya devam eder.
 */
export default class HataSiniri extends React.Component<
  { children: React.ReactNode; ad?: string },
  { hata: Error | null }
> {
  constructor(props: { children: React.ReactNode; ad?: string }) {
    super(props);
    this.state = { hata: null };
  }

  static getDerivedStateFromError(hata: Error) {
    return { hata };
  }

  componentDidCatch(hata: Error, bilgi: React.ErrorInfo) {
    // Tarayıcı konsoluna tam ayrıntı: teşhis için gerekli
    // eslint-disable-next-line no-console
    console.error('[butce] ekran hatası', this.props.ad, hata, bilgi?.componentStack);
  }

  render() {
    const { hata } = this.state;
    if (!hata) return this.props.children;

    return (
      <div
        className="rounded-2xl px-5 py-4"
        style={{ background: `${KIRMIZI}0d`, border: `1px solid ${KIRMIZI}33` }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} style={{ color: KIRMIZI }} className="mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold" style={{ color: KIRMIZI }}>
              {this.props.ad ? `${this.props.ad} ekranı açılamadı` : 'Ekran açılamadı'}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: MUTED }}>
              Diğer sekmeler çalışmaya devam ediyor. Sunucu yeni sürüme geçerken bu ekran geçici olarak
              hata verebilir; birkaç dakika sonra yenilemeyi deneyin.
            </p>
            <pre
              className="mt-2 max-h-[160px] overflow-auto whitespace-pre-wrap rounded-lg px-3 py-2 text-[11px]"
              style={{ background: 'rgba(0,0,0,0.35)', border: `1px solid ${CARD_BORDER}`, color: TEXT }}
            >
              {String(hata?.message || hata)}
            </pre>
            <button
              onClick={() => this.setState({ hata: null })}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] transition hover:brightness-110"
              style={{ background: `${KIRMIZI}16`, border: `1px solid ${KIRMIZI}3d`, color: KIRMIZI }}
            >
              <RotateCcw size={12} /> Tekrar dene
            </button>
          </div>
        </div>
      </div>
    );
  }
}
