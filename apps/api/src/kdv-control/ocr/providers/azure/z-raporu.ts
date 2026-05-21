/**
 * Azure OCR - Z Raporu pipeline.
 *
 * OKC Z raporundan gunluk KDV toplamlarini cikarir.
 * KUM satirlari kumulatif oldugu icin her zaman atlanir.
 */

import type { KdvBreakdownItem } from '../../types';

type FoldFn = (s: string) => string;

export interface ZRaporuDeps {
  parseAmount: (s: string) => number;
  formatAmount: (n: number) => string;
  foldTurkishAscii: FoldFn;
}

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
  const moneyTokenRe = /[-+]?[\*â‚ºÂ¥]?\s*\d(?:[\d.,:;]|\s(?=\d{2}\b|\d{3}\b))*\d/g;
  let topKdvTotal: number | null = null;

  const detectRate = (raw: string): number | null => {
    const line = foldTurkishAscii(raw);
    const direct = line.match(/[%/]\s*(\d{1,2})(?:[.,]\d+)?\b/) || line.match(/\b(\d{1,2})\s*[%/]\b/);
    if (direct) {
      const rate = parseInt(direct[1], 10);
      return rate > 0 && rate <= 30 ? rate : null;
    }

    if (!topKdvLabel.test(line)) return null;
    const beforeFirstAmount = line.split(/[\*â‚ºÂ¥]|\d+[.,:;]\s*\d{2}/)[0] || '';
    const alias =
      beforeFirstAmount.match(/\bZ\s*(10|20|1)\b/) ||
      beforeFirstAmount.match(/\b7\s*(10|20)\b/) ||
      beforeFirstAmount.match(/\b720\b/);
    if (!alias) return null;

    const rate = alias[0].replace(/[^\d]/g, '') === '720'
      ? 20
      : parseInt(alias[1] || alias[0].replace(/[^\d]/g, ''), 10);
    return rate > 0 && rate <= 30 ? rate : null;
  };

  const normalizeMoneyToken = (raw: string): string => {
    let token = foldTurkishAscii(raw)
      .replace(/(?:TL|TRY|TRL)/gi, '')
      .replace(/[\*â‚ºÂ¥]/g, '')
      .replace(/[:;]\s*(\d{2})(?!\d)/g, ',$1')
      .replace(/\s*([.,])\s*/g, '$1')
      .trim();

    if (!/[.,]/.test(token)) {
      const sign = token.startsWith('-') ? '-' : '';
      const unsigned = token.replace(/^[+-]/, '').trim();
      const parts = unsigned.split(/\s+/).filter(Boolean);
      if (parts.length >= 2 && /^\d{2}$/.test(parts[parts.length - 1])) {
        const decimals = parts.pop();
        token = `${sign}${parts.join('')},${decimals}`;
      }
    }

    return token.replace(/\s/g, '');
  };

  const stripRateEchoes = (raw: string): string => {
    let line = foldTurkishAscii(raw)
      .replace(/[%/]\s*\d{1,2}(?:[.,]\d+)?/g, ' ')
      .replace(/\b\d{1,2}\s*[%/]/g, ' ');
    if (detectRate(raw) != null && topKdvLabel.test(line)) {
      line = line
        .replace(/\bZ\s*(10|20|1)\b/g, ' ')
        .replace(/\b7\s*(10|20)\b/g, ' ')
        .replace(/\b720\b/g, ' ');
    }
    return line;
  };

  const extractMoneyValues = (raw: string): number[] => {
    const line = stripRateEchoes(raw);
    return (line.match(moneyTokenRe) || [])
      .map((token) => parseAmount(normalizeMoneyToken(token)))
      .filter((value) => value > 0 && value < 100_000_000);
  };

  const extractLastMoney = (raw: string): number => {
    const values = extractMoneyValues(raw);
    return values.length > 0 ? values[values.length - 1] : 0;
  };

  const nextLineMoney = (idx: number): number => {
    for (let j = idx + 1; j < Math.min(idx + 7, foldedLines.length); j++) {
      const next = foldedLines[j] || '';
      if (!next || /\bKUM\b/.test(next)) return 0;
      if (topKdvLabel.test(next) || /^\s*T[O0]PLAM\b/.test(next)) return 0;
      if (/\bGENEL\b|\bNAKIT\b|\bKREDI\b|\bKART\b/.test(next)) return 0;
      const values = extractMoneyValues(lines[j]);
      const candidates = values.filter((value) =>
        topKdvTotal == null || value <= topKdvTotal * 1.05 || value < 1000,
      );
      if (candidates.length > 0) return candidates[candidates.length - 1];
    }
    return 0;
  };

  const deriveKdvFromGross = (oran: number): number => {
    const gross = result.matrahByOran[oran];
    if (!gross || gross <= 0) return 0;
    return Math.round((gross * oran / (100 + oran)) * 100) / 100;
  };

  const addBreakdown = (oran: number, tutar: number): void => {
    if (!(oran > 0 && oran <= 30 && tutar > 0)) return;
    const gross = result.matrahByOran[oran] ?? null;
    const matrah = gross != null && gross > tutar
      ? Math.round((gross - tutar) * 100) / 100
      : gross;
    const existing = result.breakdown.find((b) => Math.abs(Number(b.oran) - oran) < 0.5);
    if (existing) {
      existing.tutar = tutar;
      existing.matrah = matrah;
    } else {
      result.breakdown.push({ oran, tutar, matrah });
    }
  };

  for (const line of lines) {
    if (/\bKUM\b/i.test(line)) continue;
    const folded = foldTurkishAscii(line);
    if (!/^\s*T[O0]PLAM\b/.test(folded) || topKdvLabel.test(folded)) continue;
    const oran = detectRate(line);
    if (oran != null) {
      const gross = extractLastMoney(line);
      if (gross > 0) result.matrahByOran[oran] = gross;
    }
  }

  for (let i = 0; i < foldedLines.length; i++) {
    const line = foldedLines[i];
    if (/\bKUM\b/.test(line)) continue;
    if (!topKdvLabel.test(line)) continue;
    if (detectRate(line) != null) continue;
    const tutar = extractLastMoney(lines[i]) || nextLineMoney(i);
    if (tutar > 0) {
      topKdvTotal = tutar;
      break;
    }
  }

  for (let i = 0; i < foldedLines.length; i++) {
    const line = foldedLines[i];
    if (/\bKUM\b/.test(line)) continue;
    if (!topKdvLabel.test(line)) continue;
    const oran = detectRate(line);
    if (oran != null) {
      let tutar = extractLastMoney(lines[i]) || nextLineMoney(i);
      if (topKdvTotal != null && tutar > topKdvTotal * 1.05) tutar = 0;
      if (tutar <= 0) tutar = deriveKdvFromGross(oran);
      addBreakdown(oran, tutar);
    }
  }

  if (topKdvTotal != null) {
    for (const oranText of Object.keys(result.matrahByOran)) {
      const oran = Number(oranText);
      const exists = result.breakdown.some((b) => Math.abs(Number(b.oran) - oran) < 0.5);
      if (!exists) addBreakdown(oran, deriveKdvFromGross(oran));
    }
  }

  if (result.breakdown.length > 0) {
    const sum = result.breakdown.reduce((s, b) => s + b.tutar, 0);
    result.kdvTutari = formatAmount(sum);
  } else if (topKdvTotal != null) {
    result.kdvTutari = formatAmount(topKdvTotal);
  }

  return result;
}
