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

    if (!topKdvLabel.test(line) && !/^\s*T[O0]PLAM\b/.test(line)) return null;
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

    if (/[.,]/.test(token)) {
      token = token.replace(/\s/g, '');
    }

    const sign = token.startsWith('-') ? '-' : '';
    let unsigned = token.replace(/^[+-]/, '').trim();

    if (!unsigned.includes(',')) {
      const dotCount = (unsigned.match(/\./g) || []).length;
      if (dotCount >= 2) {
        const lastDot = unsigned.lastIndexOf('.');
        const decimals = unsigned.slice(lastDot + 1);
        if (/^\d{2}$/.test(decimals)) {
          unsigned = `${unsigned.slice(0, lastDot).replace(/\./g, '')},${decimals}`;
          token = `${sign}${unsigned}`;
        }
      } else if (dotCount === 1) {
        const [head, tail] = unsigned.split('.');
        if (/^\d+$/.test(head) && /^\d{4,}$/.test(tail)) {
          unsigned = `${head}${tail.slice(0, -2)},${tail.slice(-2)}`;
          token = `${sign}${unsigned}`;
        }
      }
    }

    if (!/[.,]/.test(token)) {
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
    if (detectRate(raw) != null && (topKdvLabel.test(line) || /^\s*T[O0]PLAM\b/.test(line))) {
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

  const pendingLabels: Array<{ kind: 'gross' | 'kdv'; oran: number | null }> = [];
  const assignLabel = (label: { kind: 'gross' | 'kdv'; oran: number | null }, amount: number): void => {
    if (!amount || amount <= 0) return;
    if (label.kind === 'gross' && label.oran != null) {
      result.matrahByOran[label.oran] = amount;
      return;
    }
    if (label.kind === 'kdv' && label.oran != null) {
      addBreakdown(label.oran, amount);
      return;
    }
    if (label.kind === 'kdv' && label.oran == null) {
      topKdvTotal = amount;
    }
  };

  for (let i = 0; i < foldedLines.length; i++) {
    const line = foldedLines[i];
    if (/\bKUM\b/.test(line)) break;

    const isKdvLabel = topKdvLabel.test(line);
    const isCounterTotalLine =
      /\bFIS\s+SAYISI\b|\bMALI\s+FIS\b|\bSLIP\s+FIS\b|\bGECERLI\s+SATIS\s+FIS\b|\bIPTAL\s+FIS\b/.test(line);
    const isGrossLabel = /^\s*T[O0]PLAM\b/.test(line) && !isKdvLabel && !isCounterTotalLine;
    const values = extractMoneyValues(lines[i]);

    if (isKdvLabel || isGrossLabel) {
      const label = {
        kind: isKdvLabel ? 'kdv' as const : 'gross' as const,
        oran: detectRate(line),
      };
      if (values.length > 0) {
        assignLabel(label, values[values.length - 1]);
      } else {
        pendingLabels.push(label);
      }
      continue;
    }

    if (values.length > 0 && pendingLabels.length > 0) {
      for (const value of values) {
        const label = pendingLabels.shift();
        if (!label) break;
        assignLabel(label, value);
      }
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

  // ── FALLBACK: "VERGI DOKUMU / MALI VERI" duzenli OKC Z raporu ──
  // Bazi yazarkasalar (or. BEREKET AVM) Z raporunu su sekilde basar:
  //   VERGI DOKUMU
  //   %10 TOPLAM        ($10 TOPLAM — OCR % yerine $ okuyabilir)
  //   *10.605,00        (brut, ETIKETIN ALT SATIRINDA)
  //   KDV               (duz "KDV", "TOPKDV" degil)
  //   *964,07           (o oranin KDV'si, alt satirda)
  //   ...
  //   MALI VERI
  //   TOP
  //   *10.605,00
  //   KDV
  //   *964,07           (genel toplam KDV)
  // Genel mantik "TOPKDV/KDV TOPLAM" etiketi aradigi icin bu duzeni kaciriyor.
  // Yalnizca yukaridaki generic akis KDV bulamadiysa devreye girer (regresyon yok).
  if (!result.kdvTutari) {
    const startIdx = foldedLines.findIndex((l) => /\bVERG[I1]\s*D[O0]KUMU\b/.test(l));
    if (startIdx !== -1) {
      const perRateKdv: Record<number, number> = {};
      let grandKdv: number | null = null;
      let currentRate: number | null = null;
      let inGrandTotal = false;

      const rateOfToplam = (l: string): number | null => {
        const m = l.match(/[%$/]\s*0?(\d{1,2})/) || l.match(/\b0?(\d{1,2})\s*[%$/]/);
        if (m) {
          const r = parseInt(m[1], 10);
          if (r > 0 && r <= 30) return r;
        }
        return null;
      };
      // Tutar DAIMA etiketin alt satirinda; etiket satirini (idx) atla,
      // boylece "$10 TOPLAM" icindeki "10" yanlislikla tutar sayilmaz.
      const amountBelow = (idx: number): number => {
        for (let j = idx + 1; j < Math.min(idx + 4, foldedLines.length); j++) {
          if (/\bKUM\b/.test(foldedLines[j])) break;
          const vals = extractMoneyValues(lines[j] ?? foldedLines[j]);
          if (vals.length > 0) return vals[vals.length - 1];
        }
        return 0;
      };

      for (let i = startIdx + 1; i < foldedLines.length; i++) {
        const l = foldedLines[i];
        if (/\bKUM\b/.test(l)) break;
        if (/\bMALI\s*[VY]ER[I1]\b/.test(l) || /^\s*T[O0]P\s*$/.test(l)) {
          inGrandTotal = true;
          currentRate = null;
          continue;
        }
        const isToplam = /\bT[O0]PLAM\b/.test(l) && !/F[I1][SŞ]\s*SAY|SAYISI/.test(l);
        const isKdv = /^\s*KDV\b/.test(l) && !/ORAN|MATRAH|DAH[I1]L/.test(l);
        if (isToplam) {
          const r = rateOfToplam(l);
          currentRate = r;
          if (r != null) {
            const g = amountBelow(i);
            if (g > 0) result.matrahByOran[r] = g;
          }
          continue;
        }
        if (isKdv) {
          const amt = amountBelow(i);
          if (amt > 0) {
            if (!inGrandTotal && currentRate != null) {
              perRateKdv[currentRate] = amt;
            } else if (grandKdv == null) {
              grandKdv = amt;
            }
          }
        }
      }

      for (const oranText of Object.keys(perRateKdv)) {
        addBreakdown(Number(oranText), perRateKdv[Number(oranText)]);
      }
      if (result.breakdown.length > 0) {
        const sum = result.breakdown.reduce((s, b) => s + b.tutar, 0);
        result.kdvTutari = formatAmount(sum);
      } else if (grandKdv != null && grandKdv > 0) {
        for (const oranText of Object.keys(result.matrahByOran)) {
          const oran = Number(oranText);
          if (!result.breakdown.some((b) => Math.abs(Number(b.oran) - oran) < 0.5)) {
            addBreakdown(oran, deriveKdvFromGross(oran));
          }
        }
        result.kdvTutari =
          result.breakdown.length > 0
            ? formatAmount(result.breakdown.reduce((s, b) => s + b.tutar, 0))
            : formatAmount(grandKdv);
      }
    }
  }

  return result;
}
