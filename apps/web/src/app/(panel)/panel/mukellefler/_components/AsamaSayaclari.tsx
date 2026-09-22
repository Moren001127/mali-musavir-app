'use client';

import { CheckCircle2, FileCheck2, Inbox, ScanSearch, Settings2, Upload, Users, type LucideIcon } from 'lucide-react';

/*
 * Aylık Takip — aşama sayaçları: DAĞILIM ÇUBUĞU + LEJANT ÇİPLERİ (Muzaffer Bey'in 4 taslaktan seçimi, 2026-09-22).
 * Tek kart: üstte "21 takipteki mükellef" (tıklanır = süzgeç kaldır) ve sağda "%24 verildi"; ortada yığılmış oran
 * çubuğu (aşama renkleri, sayıya orantılı); altında her aşama için tıklanır çip (renk noktası · sayı · etiket · yüzde).
 * Seçili çip aşama tonunda dolar (aria-pressed). Renk yalnız aşamayı söyler; yazı her zaman var. Sıfır aşama soluk.
 * Reddedilenler: dolu gradyan kart (gösterge paneli dili) · iş akışı şeridi · halka sayaçlar · sol şeritli kutular.
 */

export type SayacAnahtari = 'all' | 'evrak-gelmedi' | 'yukleme-bekliyor' | 'islem-bekliyor' | 'kontrol-bekliyor' | 'beyanname-bekliyor' | 'verildi';

export const STAGE_CARD_META: Record<SayacAnahtari, { tone: string; icon: LucideIcon }> = {
  'all':                { tone: 'slate', icon: Users },
  'evrak-gelmedi':      { tone: 'amber', icon: Inbox },
  'yukleme-bekliyor':   { tone: 'teal', icon: Upload },
  'islem-bekliyor':     { tone: 'blue', icon: Settings2 },
  'kontrol-bekliyor':   { tone: 'violet', icon: ScanSearch },
  'beyanname-bekliyor': { tone: 'indigo', icon: FileCheck2 },
  'verildi':            { tone: 'green', icon: CheckCircle2 },
};

export interface SayacKarti { key: SayacAnahtari; label: string; count: number }

export interface AsamaSayaclariProps {
  kartlar: SayacKarti[];
  toplam: number;
  secili: SayacAnahtari;
  onSec: (k: SayacAnahtari) => void;
}

const yuzde = (n: number, toplam: number) => (toplam > 0 ? Math.round((n / toplam) * 100) : 0);

export function AsamaSayaclari(p: AsamaSayaclariProps) {
  const [toplamKarti, ...asamalar] = p.kartlar;
  const verildi = asamalar.find((k) => k.key === 'verildi');
  const ortak = (k: SayacKarti) => {
    const aktif = p.secili === k.key;
    return {
      'data-tone': STAGE_CARD_META[k.key].tone,
      'data-zero': k.count === 0 ? 'true' : undefined,
      'aria-pressed': aktif,
      onClick: () => p.onSec(k.key),
      title: aktif && k.key !== 'all' ? 'Süzgeci kaldır' : `${k.label} olanları göster`,
      type: 'button' as const,
    };
  };
  return (
    <div className="at-dagilim" data-at-sayac>
      <div className="at-dagilim-ust">
        <button {...ortak(toplamKarti)} className="at-dagilim-toplam"><b>{toplamKarti.count}</b> {toplamKarti.label.toLocaleLowerCase('tr-TR')}</button>
        <span className="at-dagilim-not">{verildi ? <><b>%{yuzde(verildi.count, p.toplam)}</b> verildi</> : null}</span>
      </div>
      <div className="at-dagilim-cubuk" role="img" aria-label="Aşama dağılımı">
        {asamalar.filter((k) => k.count > 0).map((k) => (
          <span key={k.key} data-tone={STAGE_CARD_META[k.key].tone} style={{ flexGrow: k.count }} title={`${k.label}: ${k.count}`} />
        ))}
      </div>
      <div className="at-dagilim-lejant">
        {asamalar.map((k) => (
          <button key={k.key} {...ortak(k)} className="at-dagilim-cip">
            <span className="at-dagilim-nokta" aria-hidden />
            <b>{k.count}</b>
            <span>{k.label}</span>
            <small>%{yuzde(k.count, p.toplam)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
