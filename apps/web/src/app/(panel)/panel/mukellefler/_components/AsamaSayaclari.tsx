'use client';

import { CheckCircle2, FileCheck2, Inbox, ScanSearch, Settings2, Upload, Users, type LucideIcon } from 'lucide-react';

/*
 * Aylık Takip — aşama sayaçları: DAĞILIM HALKASI + PASTEL GRADYAN SAYAÇLAR
 * (Muzaffer Bey'in seçimi, 2026-09-25 — "pastel gradyan", I taslağı 2 numara).
 *
 * SOLDA yalnız GRAFİK: halka, takipteki bütün mükellefi dilim dilim gösterir (verildi + bekleyen
 *   aşamalar). Üzerinde etiket YOK — dilim renkleri sağdaki sayaçlarla birebir aynı olduğu için
 *   lejant gerekmiyor. Ortada teslim oranı. Halkaya tıklanınca süzgeç sıfırlanır.
 *   "SON GÜN / beyanname adı / tarih / geri sayım" yazıları KALDIRILDI (kullanıcı isteği).
 * SAĞDA yalnız BEKLEYEN aşamalar, yatay düzende: ikon solda, rakamla çubuk yan yana, ad üstte.
 *   Kutu zemini kendi renginin AÇIK tonundan KOYU tonuna geçer (beyaza solmaz) — yazılar koyu.
 *   ÇUBUK toplam payı değil, EN YOĞUN AŞAMAYA göre doludur: yığılmanın nerede olduğu görünsün
 *   ve kutular boş durmasın diye. Toplam payı sağ üstteki yüzde etiketinde yazar.
 *
 * Reddedilenler: dolu gradyan KPI kart · takvim nabzı / geri sayım kartı · iş akışı şeridi ·
 *   dağılım çubuğu + lejant · huni · nokta ızgarası · renkten BEYAZA solan yıkama ·
 *   dolu gradyan (beyaz yazı) · akan tek şerit.
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

/** Halka ölçüleri — SVG 98×98, kalınlık 12. */
const HALKA_R = 38;
const HALKA_CEVRE = 2 * Math.PI * HALKA_R;
const DILIM_BOSLUK = 1.6; // dilimler birbirine girmesin diye

/** tone → halka dilimi için degrade id'si (sayaç renkleriyle birebir aynı aile). */
const TON_GRADYAN: Record<string, string> = {
  green: 'atgVerildi',
  amber: 'atgAmber',
  teal: 'atgTeal',
  blue: 'atgBlue',
  violet: 'atgViolet',
  indigo: 'atgIndigo',
};

export function AsamaSayaclari(p: AsamaSayaclariProps) {
  const [toplamKarti, ...asamalar] = p.kartlar;
  const verildi = asamalar.find((k) => k.key === 'verildi');
  const bekleyenler = asamalar.filter((k) => k.key !== 'verildi');
  const verildiSayi = verildi?.count ?? 0;
  const verildiYuzde = yuzde(verildiSayi, p.toplam);

  // Halka dilimleri: önce verilenler, sonra bitişe en yakın aşamadan başlayarak bekleyenler.
  const dilimVeri = [
    { anahtar: 'verildi' as SayacAnahtari, sayi: verildiSayi },
    ...[...bekleyenler].reverse().map((k) => ({ anahtar: k.key, sayi: k.count })),
  ];
  let yurunen = 0;
  const dilimler = dilimVeri.map((d) => {
    const uzunluk = p.toplam > 0 ? (d.sayi / p.toplam) * HALKA_CEVRE : 0;
    const goster = Math.max(0, uzunluk - DILIM_BOSLUK);
    const kaydir = -(yurunen + DILIM_BOSLUK / 2);
    yurunen += uzunluk;
    return { anahtar: d.anahtar, sayi: d.sayi, goster, kaydir };
  }).filter((d) => d.goster > 0.2);

  // Çubuklar en yoğun aşamaya göre dolar (toplam payı değil).
  const enYogun = Math.max(1, ...bekleyenler.map((k) => k.count));

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
    <div className="at-nabiz" data-at-sayac>
      {/* ── SOL: yalnız grafik — takipteki mükellefin aşama dağılımı ── */}
      <button
        {...ortak(toplamKarti)}
        className="at-grafik"
        title={`Takipteki ${p.toplam} mükellefin ${verildiSayi} tanesi verildi — süzgeci sıfırla`}
      >
        <span className="at-halka">
          <svg width="98" height="98" viewBox="0 0 98 98" aria-hidden>
            <defs>
              <linearGradient id="atgVerildi" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5b8fc7" /><stop offset="1" stopColor="#1b3a5c" /></linearGradient>
              <linearGradient id="atgAmber" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fb923c" /><stop offset="1" stopColor="#c2410c" /></linearGradient>
              <linearGradient id="atgTeal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2dd4bf" /><stop offset="1" stopColor="#0f766e" /></linearGradient>
              <linearGradient id="atgBlue" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#60a5fa" /><stop offset="1" stopColor="#1d4ed8" /></linearGradient>
              <linearGradient id="atgViolet" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#94a3b8" /><stop offset="1" stopColor="#475569" /></linearGradient>
              <linearGradient id="atgIndigo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4ade80" /><stop offset="1" stopColor="#15803d" /></linearGradient>
            </defs>
            <circle cx="49" cy="49" r={HALKA_R} fill="none" stroke="#edf1f6" strokeWidth="12" />
            {dilimler.map((d) => (
              <circle
                key={d.anahtar}
                cx="49" cy="49" r={HALKA_R} fill="none" strokeWidth="12"
                stroke={`url(#${TON_GRADYAN[STAGE_CARD_META[d.anahtar].tone] ?? 'atgVerildi'})`}
                strokeDasharray={`${d.goster.toFixed(1)} ${(HALKA_CEVRE - d.goster).toFixed(1)}`}
                strokeDashoffset={d.kaydir.toFixed(1)}
              />
            ))}
          </svg>
          <b className="at-halka-ic">%{verildiYuzde}</b>
        </span>
      </button>

      {/* ── SAĞ: bekleyen aşamalar — pastel gradyan zemin ── */}
      <div className="at-asamalar">
        {bekleyenler.map((k) => {
          const Icon = STAGE_CARD_META[k.key].icon;
          return (
            <button key={k.key} {...ortak(k)} className="at-asama">
              <span className="at-asama-ik" aria-hidden><Icon size={17} strokeWidth={2} /></span>
              <span className="at-asama-govde">
                <span className="at-asama-ust">
                  <span className="at-asama-ad">{k.label}</span>
                  <small>%{yuzde(k.count, p.toplam)}</small>
                </span>
                <span className="at-asama-alt">
                  <b>{k.count}</b>
                  <span className="at-asama-bar"><i style={{ width: `${Math.round((k.count / enYogun) * 100)}%` }} /></span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
