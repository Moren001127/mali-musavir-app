'use client';

/**
 * Gösterge paneli üst alanı renk paletleri (A: İş Listesi, B: Mükellef Masası ortak).
 * Muzaffer Bey (2026-09-18): "renk olarak da alternatif tasarım yap" → üç palet, tek yerden.
 *   nane  : nane yeşili + altın (mevcut)
 *   gece  : gece mavisi + altın + gök mavisi (Bütçe/Cari Kasa ailesi)
 *   bakir : bordo-siyah + şampanya + bakır
 * KARAR (2026-09-18, Muzaffer Bey): "ilk hali ile kalsın" → A tasarımı + NANE paleti varsayılan.
 * Diğer paletler görsel karşılaştırma için duruyor; TemaSaglayici kullanılmıyorsa nane gelir.
 */

import { createContext, useContext } from 'react';

export type Palet = {
  ad: string;
  a: string;        // birincil vurgu (başlık noktaları, ilerleme, "tamam")
  b: string;        // ikincil vurgu (altın/şampanya: motivasyon, "Aç", rozet)
  c: string;        // üçüncül (grafik/aşama)
  d: string;        // dördüncül (aşama şeridi)
  acil: string;     // kırmızı aile
  arka: string;     // kart zemini (gradyanlar)
  kenar: string;    // kart kenarı
  cizgi: string;    // üst ince çizgi gradyanı
  serit: string;    // sol dikey şerit gradyanı
  glow: string;     // sol şerit ışıması
  metin: string;    // en açık metin
};

export const PALETLER: Record<string, Palet> = {
  nane: {
    ad: 'Nane · Altın',
    a: '#8fd7bd', b: '#d8bd86', c: '#8cc8ff', d: '#b0a0e0', acil: '#ef8a8a',
    arka: 'radial-gradient(circle at 7% 0%, rgba(143,215,189,0.12), transparent 34%), radial-gradient(circle at 95% 8%, rgba(216,189,134,0.10), transparent 32%), linear-gradient(180deg, rgba(8,14,13,0.96), rgba(5,7,7,0.94))',
    kenar: 'rgba(143,215,189,0.14)',
    cizgi: 'linear-gradient(90deg, transparent, rgba(143,215,189,0.65), rgba(216,189,134,0.38), transparent)',
    serit: 'linear-gradient(180deg, #8fd7bd, #d8bd86)',
    glow: 'rgba(143,215,189,0.22)',
    metin: '#f6f1e7',
  },
  gece: {
    ad: 'Gece Mavisi · Altın',
    a: '#8cbde8', b: '#e6c878', c: '#5ad18a', d: '#b0a0e0', acil: '#e0697a',
    arka: 'radial-gradient(circle at 7% 0%, rgba(140,189,232,0.14), transparent 36%), radial-gradient(circle at 95% 8%, rgba(230,200,120,0.10), transparent 32%), linear-gradient(180deg, rgba(10,16,30,0.97), rgba(6,9,18,0.95))',
    kenar: 'rgba(140,189,232,0.18)',
    cizgi: 'linear-gradient(90deg, transparent, rgba(140,189,232,0.7), rgba(230,200,120,0.45), transparent)',
    serit: 'linear-gradient(180deg, #8cbde8, #e6c878)',
    glow: 'rgba(140,189,232,0.25)',
    metin: '#f2f4f8',
  },
  bakir: {
    ad: 'Bordo · Şampanya · Bakır',
    a: '#e8c9a0', b: '#d08c6a', c: '#c98896', d: '#9cc8a6', acil: '#ff7a8c',
    arka: 'radial-gradient(circle at 7% 0%, rgba(232,201,160,0.12), transparent 34%), radial-gradient(circle at 95% 8%, rgba(208,140,106,0.12), transparent 32%), linear-gradient(180deg, rgba(24,14,16,0.97), rgba(12,8,9,0.95))',
    kenar: 'rgba(232,201,160,0.16)',
    cizgi: 'linear-gradient(90deg, transparent, rgba(232,201,160,0.7), rgba(208,140,106,0.45), transparent)',
    serit: 'linear-gradient(180deg, #e8c9a0, #d08c6a)',
    glow: 'rgba(232,201,160,0.22)',
    metin: '#f8f1ea',
  },
};

const TemaContext = createContext<Palet>(PALETLER.nane);

export function TemaSaglayici({ tema, children }: { tema?: string; children: React.ReactNode }) {
  return <TemaContext.Provider value={PALETLER[tema || 'nane'] || PALETLER.nane}>{children}</TemaContext.Provider>;
}

export function useTema(): Palet {
  return useContext(TemaContext);
}

/** "#8fd7bd" + alfa → rgba() — rozet/zemin tonları için */
export function rgba(hex: string, alfa: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`;
}
