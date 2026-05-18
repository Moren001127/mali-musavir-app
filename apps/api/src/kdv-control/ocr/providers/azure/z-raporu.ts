/**
 * Azure OCR - Z Raporu pipeline.
 *
 * OKC Z raporundan (gunluk kapanis ozeti) KDV ozelliklerini cikarir:
 *   - matrahByOran : "TOPLAM %X  140,00" satirlarindan oran-matrah haritasi
 *   - breakdown    : "TOPKDV %X  23,33" satirlarindan oran-tutar (+matrah) kirilimi
 *   - kdvTutari    : breakdown toplami veya tek toplam TOPKDV satiri
 *
 * Z raporlarinda kritik nokta: "KUM" (Kumulatif) iceren satirlar atilir,
 * cunku bunlar acilis itibariyle birikimli degerdir, mevcut gunun toplami degil.
 *
 * Public API (Faz 2B):
 *   extractZRaporuKdv(text, deps)
 *
 * Bu modul `this` kullanmaz; bagimliliklari `deps` ile alir.
 */

import type { KdvBreakdownItem } from '../../types';

type FoldFn = (s: string) => string;

export interface ZRaporuDeps {
  parseAmount: (s: string) => number;
  formatAmount: (n: number) => string;
  foldTurkishAscii: FoldFn;
}

/**
 * Z raporu OCR metninden KDV bilgilerini cikarir.
 *
 * Akis:
 *   1) "TOPLAM %X tutar" satirlarinden matrahByOran haritasini kur
 *   2) "TOPKDV %X tutar" satirlarindan breakdown'u olustur (matrah hash'ten)
 *   3) Toplam: breakdown sum, yoksa sade "TOPKDV tutar" satiri
 *
 * KUM satirlari (kumulatif) her zaman atlanir.
 * KDV oran araligi: 1-30 (gecerli Turk oranlari icin)
 */
export function extractZRaporuKdv(
  text: string,
  deps: ZRaporuDeps,
): { kdvTutari: string | null; breakdown: KdvBreakdownItem[]; matrahByOran: Record<number, number> } {
  const { parseAmount, formatAmount, foldTurkishAscii } = deps;

  const result = {
    kdvTutari: null as string | null,
    breakdown: [] as KdvBreakdownItem[],
    matrahByOran: {} as Record<number, number>,
  };
  if (!text) return result;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const foldedLines = lines.map((line) => foldTurkishAscii(line));
  const topKdvLabel = /\bT[O0]P\s*K\s*D\s*V\b|\bT[O0]PKD[UV]\b|\bKDV\s*T[O0]PLAM\b|\bT[O0]PLAM\s*KDV\b/;
  const moneyTokenRe = /[-+]?[\*₺¥]?\s*\d[\d.,\s]*\d|\d+[,.]\d{2}/g;

  const extractLastMoney = (raw: string): number => {
    const line = foldTurkishAscii(raw)
      .replace(/[%/]\s*\d{1,2}(?:[.,]\d+)?/g, ' ')
      .replace(/\b\d{1,2}\s*[%/]/g, ' ');
    const values = (line.match(moneyTokenRe) || [])
      .map((token) => parseAmount(token))
      .filter((value) => value > 0);
    return values.length > 0 ? values[values.length - 1] : 0;
  };
  const nextLineMoney = (idx: number): number => {
    const next = foldedLines[idx + 1] || '';
    if (!next || /\bKUM\b/.test(next)) return 0;
    if (/\bT[O0]PLAM\b|\bGENEL\b|\bNAKIT\b|\bKREDI\b|\bKART\b/.test(next)) return 0;
    const value = extractLastMoney(next);
    return value > 0 && value < 100_000_000 ? value : 0;
  };

  // 1) TOPLAM %X satirlarindan MATRAH'lari topla
  const matrahRegex = /^TOPLAM\s*[%/]\s*(\d{1,2})\b\s*[\*:]?\s*([\d.,]+)/i;
  for (const line of lines) {
    if (/\bKUM\b/i.test(line)) continue;
    const m = line.match(matrahRegex);
    if (m) {
      const oran = parseInt(m[1], 10);
      const matrah = parseAmount(m[2]);
      if (oran > 0 && oran <= 30 && matrah > 0) {
        result.matrahByOran[oran] = matrah;
      }
    }
  }

  // 2) TOPKDV %X satirlarindan her oran icin KDV tutarini al
  for (let i = 0; i < foldedLines.length; i++) {
    const line = foldedLines[i];
    if (/\bKUM\b/.test(line)) continue;
    if (!topKdvLabel.test(line)) continue;
    const rateMatch = line.match(/[%/]\s*(\d{1,2})\b/);
    if (rateMatch) {
      const oran = parseInt(rateMatch[1], 10);
      const tutar = extractLastMoney(lines[i]) || nextLineMoney(i);
      if (oran > 0 && oran <= 30 && tutar > 0) {
        const matrah = result.matrahByOran[oran] ?? null;
        result.breakdown.push({ oran, tutar, matrah });
      }
    }
  }

  // 3) Toplam TOPKDV
  if (result.breakdown.length > 0) {
    const sum = result.breakdown.reduce((s, b) => s + b.tutar, 0);
    result.kdvTutari = formatAmount(sum);
  } else {
    // Tek toplam TOPKDV satiri
    for (let i = 0; i < foldedLines.length; i++) {
      const line = foldedLines[i];
      if (/\bKUM\b/.test(line)) continue;
      if (/[%/]\s*\d/.test(line)) continue;
      if (!topKdvLabel.test(line)) continue;
      const tutar = extractLastMoney(lines[i]) || nextLineMoney(i);
      if (tutar > 0) {
        result.kdvTutari = formatAmount(tutar);
        break;
      }
    }
  }

  return result;
}
