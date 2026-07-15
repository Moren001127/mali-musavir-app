/**
 * Azure OCR - KDV Breakdown pipeline.
 *
 * Iki yontem:
 *   extractMultiRateKdv          - "Hesaplanan KDV (%X)" label'lari + tutarlardan
 *                                  cok oranli kirilim (1/8/10/18/20)
 *   extractKdvFromInvoiceTotals  - tek toplam KDV degeri: 4 farkli strateji ile arar
 *                                  (electricity adapter, summary math line,
 *                                  table header layout, explicit "HESAPLANAN" label)
 *
 * Bu modul `this` kullanmaz; bagimliliklari `deps` ile alir.
 */

import type { KdvBreakdownItem } from '../../types';

type FoldFn = (s: string) => string;

/**
 * Tarih parçaları tutar sanılmasın: "01.06.2026 - 01.07.2026" (hizmet dönemi)
 * satırında amountRe "01.06"yı yakalayıp KDV=1,06 üretiyordu (gerçek vaka:
 * lifebox e-Arşiv, LB32026007893564 — gerçek KDV 5,83). dd.mm.yyyy / dd-mm-yy /
 * dd/mm/yyyy kalıplarını tutar aramadan ÖNCE sil. Tutarlara dokunmaz:
 * "1.234,56" deseninde ardışık iki [sep]+1-2 hane grubu yoktur.
 */
export function stripDateFragments(s: string): string {
  return String(s || '').replace(/\b\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\b/g, ' ');
}

export interface KdvBreakdownDeps {
  parseAmount: (s: string) => number;
  normalizeAzureText: (text: string) => string;
  foldTurkishAscii: FoldFn;
  stripMatrahFragments: (text: string) => string;
  isMatrahOrRateLine: (value: string) => boolean;
  isForbiddenKdvAmountLine: (value: string) => boolean;
  isLikelyKdvAmountColumnHeader: (lines: string[], index: number) => boolean;
  isLikelyStandaloneTaxRate: (value: string) => boolean;
  extractElectricityKdvFromAzure: (text: string) => number | null;
}

/**
 * Multi-rate KDV breakdown ekstraksiyonu.
 *
 * Pattern: "(Hesaplanan) KDV (%X)" label'i — strict parantezli format.
 * Her label icin tutari ariyor (3 strateji):
 *   1) Ayni satirda label'den SONRA tutar
 *   2) Sonraki 1-8 satir (Azure'un parantez içeren label'lari uzatabildigi tablolar)
 *   3) Onceki 1-2 satir (label'in altinda olabilir)
 *
 * Rate echo filtreleme: "% 20  20,00" gibi tutarsiz tekrari atlar.
 * KDV-disi vergi label'lari (OIV/Telsiz/OTV/Damga/BSMV/KKDF/Konaklama/Cevre) atlanir.
 */
export function extractMultiRateKdv(text: string, deps: KdvBreakdownDeps): KdvBreakdownItem[] {
  const {
    parseAmount,
    normalizeAzureText,
    stripMatrahFragments,
    isForbiddenKdvAmountLine,
    isLikelyKdvAmountColumnHeader,
    isLikelyStandaloneTaxRate,
  } = deps;

  if (!text) return [];
  const normalized = normalizeAzureText(text);
  const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const breakdown: KdvBreakdownItem[] = [];
  const seen = new Set<number>();

  // Kapanış parantezi OPSİYONEL: Azure bazen "Hesaplanan KDV(%20" şeklinde ")" yi
  // kaçırıyor (gerçek örnek: A101 e-Arşiv %20 satırı) → o oran komple düşüyordu.
  const labelRe = /(?:HESAPLANAN\s*)?K\.?\s*D\.?\s*V\.?\s*\(\s*%\s*(\d{1,2})(?:[,.]\d{1,2})?\s*\)?/i;
  const amountRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|₺)?/i;
  const skipTaxRe = /ÖZEL\s*İLETİŞİM|ÖIV|OIV|TELSİZ|TELSIZ|ÖTV|OTV|DAMGA|BSMV|KKDF|KONAKLAMA|ÇEVRE/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (skipTaxRe.test(line)) continue;
    if (isForbiddenKdvAmountLine(line) || isLikelyKdvAmountColumnHeader(lines, i)) continue;

    const labelMatch = line.match(labelRe);
    if (!labelMatch) continue;

    const oran = parseInt(labelMatch[1], 10);
    if (!(oran > 0 && oran <= 30) || seen.has(oran)) continue;

    // 1) Ayni satirda label'den SONRA amount ara
    let tutar: number | null = null;
    const afterLabel = stripMatrahFragments(stripDateFragments(line.slice(labelMatch.index! + labelMatch[0].length)));
    const inlineAmountMatch = afterLabel.match(amountRe);
    if (inlineAmountMatch) {
      const parsed = parseAmount(inlineAmountMatch[1]);
      const isRateEcho = isLikelyStandaloneTaxRate(inlineAmountMatch[1]) && Math.abs(parsed - oran) < 0.01;
      if (!isRateEcho && parsed > 0 && parsed < 10_000_000) tutar = parsed;
    }

    // 2) Sonraki 1-8 satira bak (tablo layout)
    if (tutar == null) {
      for (let j = 1; j <= 8 && i + j < lines.length; j++) {
        const nextLine = lines[i + j];
        if (labelRe.test(nextLine)) break;
        if (skipTaxRe.test(nextLine)) break;
        if (isForbiddenKdvAmountLine(nextLine)) continue;
        if (j > 1 && isForbiddenKdvAmountLine(lines[i + j - 1] || '')) continue;
        if (/^[\(\)%\s]*$/.test(nextLine)) continue;
        if (/^%\s*\d{1,2}(?:[,.]\d{1,2})?\s*\)?$/.test(nextLine)) continue;
        const cleanedNext = stripMatrahFragments(stripDateFragments(nextLine));
        if (!cleanedNext) continue;
        const m = cleanedNext.match(amountRe);
        if (m) {
          const parsed = parseAmount(m[1]);
          const isRateEcho = isLikelyStandaloneTaxRate(cleanedNext) && Math.abs(parsed - oran) < 0.01;
          if (!isRateEcho && parsed > 0 && parsed < 10_000_000) {
            tutar = parsed;
            break;
          }
        }
      }
    }

    // 3) Onceki 1-2 satira bak
    if (tutar == null) {
      for (let j = 1; j <= 2 && i - j >= 0; j++) {
        const prevLine = lines[i - j];
        if (labelRe.test(prevLine)) break;
        if (/ÖZEL\s*İLETİŞİM|ÖIV|OIV|TELSİZ|TELSIZ|ÖTV|OTV|DAMGA|BSMV|KKDF/i.test(prevLine)) break;
        if (isForbiddenKdvAmountLine(prevLine)) continue;
        const cleanedPrev = stripMatrahFragments(stripDateFragments(prevLine));
        if (!cleanedPrev) continue;
        const m = cleanedPrev.match(amountRe);
        if (m) {
          const parsed = parseAmount(m[1]);
          const isRateEcho = isLikelyStandaloneTaxRate(cleanedPrev) && Math.abs(parsed - oran) < 0.01;
          if (!isRateEcho && parsed > 0 && parsed < 10_000_000) {
            tutar = parsed;
            break;
          }
        }
      }
    }

    if (tutar != null) {
      breakdown.push({ oran, tutar, matrah: null });
      seen.add(oran);
    }
  }

  return breakdown;
}

/**
 * Tek toplam KDV ekstraksiyonu — 4 strateji sirayla.
 *
 *   0) Electricity adapter (callback) — elektrik faturalari icin ozel
 *   1) Summary math line — "KDV(%X) matrah tutar" bir satirda hepsi varsa
 *   2) Table header layout — "KDV TUTARI | MAL HIZMET" basligi + alt satir
 *   3) Explicit "HESAPLANAN KDV(%X)" label + value
 *
 * En guvenilirden en zayifa siralanmis fallback.
 *
 * Return:
 *   { kdv, matrah: null, oran }  - oran KDV yakinindaki "%X" ifadesinden
 *   null  - hicbir strateji yakalamadi
 */
export function extractKdvFromInvoiceTotals(
  text: string,
  deps: KdvBreakdownDeps,
): { kdv: number; matrah: number | null; oran: number | null } | null {
  const {
    parseAmount,
    normalizeAzureText,
    foldTurkishAscii,
    stripMatrahFragments,
    isMatrahOrRateLine,
    isForbiddenKdvAmountLine,
    isLikelyKdvAmountColumnHeader,
    isLikelyStandaloneTaxRate,
    extractElectricityKdvFromAzure,
  } = deps;

  if (!text) return null;
  const electricityKdv = extractElectricityKdvFromAzure(text);
  if (electricityKdv != null && electricityKdv > 0) {
    return { kdv: electricityKdv, matrah: null, oran: null };
  }

  const normalized = normalizeAzureText(text);
  const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const amountRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|₺)?/i;
  const amountGlobalRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|₺)?/gi;

  const parseLineAmount = (line: string, opts: { allowMatrah?: boolean } = {}): number | null => {
    if (!opts.allowMatrah && isMatrahOrRateLine(line)) return null;
    if (!opts.allowMatrah && isForbiddenKdvAmountLine(line)) return null;
    const m = stripDateFragments(line).match(amountRe);
    if (!m) return null;
    if (!opts.allowMatrah && isLikelyStandaloneTaxRate(m[1]) && /%|ORAN|KDV\s*ORAN/i.test(foldTurkishAscii(line))) {
      return null;
    }
    const n = parseAmount(m[1]);
    return n > 0 && n < 100_000_000 ? n : null;
  };
  const parseLastAmount = (line: string, opts: { allowMatrah?: boolean } = {}): number | null => {
    if (!opts.allowMatrah && isMatrahOrRateLine(line)) return null;
    if (!opts.allowMatrah && isForbiddenKdvAmountLine(line)) return null;
    const matches = [...stripDateFragments(line).matchAll(amountGlobalRe)];
    if (matches.length === 0) return null;
    if (!opts.allowMatrah && matches.length === 1 && isLikelyStandaloneTaxRate(matches[0][1]) && /%|ORAN|KDV\s*ORAN/i.test(foldTurkishAscii(line))) {
      return null;
    }
    const n = parseAmount(matches[matches.length - 1][1]);
    return n > 0 && n < 100_000_000 ? n : null;
  };
  const extractAmounts = (line: string): number[] =>
    [...stripDateFragments(line).matchAll(amountGlobalRe)]
      .map((m) => parseAmount(m[1]))
      .filter((n) => n > 0 && n < 100_000_000);

  const findKdvFromSummaryMathLine = (): number | null => {
    for (const line of lines) {
      const folded = foldTurkishAscii(line);
      if (!/\bHESAPLANAN\s+K\.?\s*D\.?\s*V\.?\b|\bK\.?\s*D\.?\s*V\.?\b/.test(folded)) continue;
      if (/TEVKIFAT/.test(folded) || isForbiddenKdvAmountLine(line)) continue;
      const rateMatch = folded.match(/%\s*(\d{1,2})(?:[.,]\d{1,2})?/);
      const rate = rateMatch ? parseInt(rateMatch[1], 10) : null;
      const amounts = extractAmounts(line).filter((n) => !isLikelyStandaloneTaxRate(String(n)));
      if (!rate || ![1, 10, 20].includes(rate) || amounts.length < 2) continue;
      for (const candidate of amounts) {
        const hasMatchingBase = amounts.some((base) =>
          base > candidate && Math.abs((base * rate / 100) - candidate) <= Math.max(0.05, candidate * 0.03),
        );
        if (hasMatchingBase) return candidate;
      }
      return amounts[amounts.length - 1] ?? null;
    }
    return null;
  };

  const findKdvFromTableHeader = (): number | null => {
    for (let i = 0; i < lines.length; i++) {
      const folded = foldTurkishAscii(lines[i]).replace(/\s+/g, ' ');
      const kdvIdx = folded.search(/\bKDV\s*TUTAR[II]?\b/);
      let malIdx = folded.search(/\bMAL\s+HIZMET\b/);
      let kdvFirst = kdvIdx >= 0 && malIdx >= 0 && kdvIdx < malIdx;
      if (kdvIdx < 0) continue;
      if (malIdx < 0) {
        for (let h = 1; h <= 3 && i + h < lines.length; h++) {
          const nearbyHeader = foldTurkishAscii(lines[i + h]).replace(/\s+/g, ' ');
          if (/\bMAL\s+HIZMET\b/.test(nearbyHeader)) {
            malIdx = 0;
            kdvFirst = true;
            break;
          }
        }
      }
      if (malIdx < 0) continue;

      for (let j = 0; j <= 4 && i + j < lines.length; j++) {
        const row = lines[i + j];
        if (j > 0 && /\b(?:HESAPLANAN|VERGILER|ODENECEK|TOPLAM\s+ISKONTO)\b/i.test(foldTurkishAscii(row))) {
          break;
        }
        const amounts = extractAmounts(row);
        if (amounts.length >= 2) return kdvFirst ? amounts[0] : amounts[amounts.length - 1];
        if (j > 0 && amounts.length === 1) return amounts[0];
      }
    }
    return null;
  };

  const findExplicitKdvAmount = (): number | null => {
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (/TEVK[İI]FAT/i.test(line)) continue;
      if (isForbiddenKdvAmountLine(line)) continue;
      const label = line.match(/HESAPLANAN\s+K\.?\s*D\.?\s*V\.?\s*\(\s*%?\s*\d{1,2}(?:[.,]\d{1,2})?\s*\)/i);
      if (!label) continue;
      const valuePart = stripMatrahFragments(line.slice((label.index ?? 0) + label[0].length));
      const sameLine = parseLastAmount(valuePart);
      if (sameLine != null) return sameLine;
      // Tutar yoksa sonraki 2 satıra bak — Azure "Hesaplanan KDV (%20)" ile tutarını
      // ("546,00 TL") ayrı satırlara bölebiliyor (ör. SAM TEKNİK / samixir e-Arşiv).
      for (let j = 1; j <= 2 && idx + j < lines.length; j++) {
        const next = lines[idx + j];
        if (/HESAPLANAN|TOPLAM|MATRAH|[ÖO]DENECEK/i.test(foldTurkishAscii(next))) break;
        const v = parseLineAmount(next);
        if (v != null) return v;
      }
    }
    return null;
  };

  const findAmountNear = (labelRe: RegExp, options: { skipMatrah?: boolean; preferFirst?: boolean } = {}): number | null => {
    for (let i = 0; i < lines.length; i++) {
      if (!labelRe.test(lines[i])) continue;
      if (options.skipMatrah && isMatrahOrRateLine(lines[i])) continue;
      if (options.skipMatrah && isForbiddenKdvAmountLine(lines[i])) continue;
      if (options.skipMatrah && isLikelyKdvAmountColumnHeader(lines, i)) continue;
      const allowMatrah = !options.skipMatrah;
      const sameSource = lines[i].replace(labelRe, '');
      const cleanedSame = options.skipMatrah ? stripMatrahFragments(sameSource) : sameSource;
      const same = options.preferFirst
        ? parseLineAmount(cleanedSame, { allowMatrah })
        : parseLastAmount(cleanedSame, { allowMatrah });
      const sameAmounts = extractAmounts(cleanedSame);
      const firstAmountIndex = cleanedSame.search(/\d{1,3}(?:[.,]\d{3})*[.,]\d{1,2}/);
      const percentIndex = cleanedSame.indexOf('%');
      const sameLooksLikeMatrahInRateParen =
        options.skipMatrah &&
        sameAmounts.length === 1 &&
        firstAmountIndex >= 0 &&
        percentIndex > firstAmountIndex;
      if (same != null && !sameLooksLikeMatrahInRateParen) return same;
      for (let j = 1; j <= 3 && i + j < lines.length; j++) {
        const next = lines[i + j];
        if (/KDV|TOPLAM|TUTAR|ISKONTO|ÖDENECEK|ODENECEK/i.test(next) && j > 1) break;
        if (options.skipMatrah && isMatrahOrRateLine(next)) continue;
        if (options.skipMatrah && isForbiddenKdvAmountLine(next)) continue;
        if (options.skipMatrah && j > 1 && isForbiddenKdvAmountLine(lines[i + j - 1] || '')) continue;
        const nearby = foldTurkishAscii(
          [
            lines[i - 2] || '',
            lines[i - 1] || '',
            lines[i],
            lines[i + j - 1] || '',
            next,
            lines[i + j + 1] || '',
          ].join('\n'),
        );
        if (options.skipMatrah && isLikelyStandaloneTaxRate(next) && /%|ORAN/.test(nearby)) continue;
        const val = parseLineAmount(options.skipMatrah ? stripMatrahFragments(next) : next, { allowMatrah });
        if (val != null) return val;
      }
    }
    return null;
  };

  // Tek-oranli e-Arsivde acik KDV bulunamazsa: KDV Matrahi (veya Mal/Hizmet Toplam)
  // × TEK oran. Birden fazla farkli oran varsa devreye GIRMEZ (multi-rate baska
  // stratejilerin isi). Truncate olmus/totali kesik tek-oranli faturalarda calisir.
  const findKdvFromMatrahTimesRate = (): number | null => {
    const rates = new Set<number>();
    const hasKdvOranLabel = lines.some((l) => /K\.?\s*D\.?\s*V\.?\s*ORAN/i.test(foldTurkishAscii(l)));
    for (const line of lines) {
      const f = foldTurkishAscii(line);
      const m =
        f.match(/K\.?\s*D\.?\s*V\.?[^%\n]{0,20}\(\s*%\s*(\d{1,2})(?:[.,]\d{1,2})?\s*\)/) ||
        f.match(/K\.?\s*D\.?\s*V\.?\s*ORAN[II]?[^%\n]{0,12}%\s*(\d{1,2})/);
      if (m) {
        rates.add(parseInt(m[1], 10));
        continue;
      }
      // "KDV Orani" etiketli belgede (cok kalemli, totali kesik fatura) kalem-ici
      // "% 20,00" oranlarini da topla — HEPSI ayni olmali (tek oran sarti korunur).
      if (hasKdvOranLabel) {
        const mm = f.match(/^%\s*(\d{1,2})(?:[.,]\d{1,2})?\b/);
        if (mm) rates.add(parseInt(mm[1], 10));
      }
    }
    if (rates.size !== 1) return null;
    const rate = [...rates][0];
    if (!(rate >= 1 && rate <= 30)) return null; // %0/muaf burada cozulmez
    const baseLabels = [/K\.?\s*D\.?\s*V\.?\s*MATRAH/i, /MAL\s*[/ ]?\s*H[İI]ZMET\s*TOPLAM\s*TUTAR/i];
    for (const lab of baseLabels) {
      for (let i = 0; i < lines.length; i++) {
        if (!lab.test(foldTurkishAscii(lines[i]))) continue;
        for (let j = 0; j <= 3 && i + j < lines.length; j++) {
          const base = extractAmounts(lines[i + j]).find((a) => a > rate);
          if (base != null) return Math.round(((base * rate) / 100) * 100) / 100;
        }
      }
    }
    return null;
  };

  // Sütun-başlıklı tablolarda (lifebox: "Fiyat / KDV (%20.0) / Toplam Fiyat"
  // başlıkları AYRI satırlar, değerler aşağıda ayrı satırlarda) "etikete yakın
  // ilk tutar" yanlış sütunu (Fiyat=29,16) veya tarihi verir. Güçlü matematik
  // kanıtı ara: KDV(%X) etiketinden sonraki pencerede tek-tutarlı satırlar
  // a,b,c olarak birikirken a+b=c (±0,02) ve b<a sağlanırsa KDV=b, matrah=a
  // (29,16 + 5,83 = 34,99 → KDV 5,83). Kanıt matematiksel olduğundan yanlış
  // pozitif üretmez; bulunamazsa zincir eski stratejilerle devam eder.
  const findKdvFromConsecutiveMathTriple = (): { kdv: number; matrah: number } | null => {
    for (let i = 0; i < lines.length; i++) {
      if (!/K\.?\s*D\.?\s*V\.?\s*\(\s*%\s*\d{1,2}(?:[.,]\d{1,2})?\s*\)?/i.test(lines[i])) continue;
      const seq: number[] = [];
      for (let j = 1; j <= 10 && i + j < lines.length; j++) {
        const vals = extractAmounts(lines[i + j]);
        if (vals.length > 1) break; // çok-sütunlu okuma — bu strateji tek-sütun akışı için
        if (vals.length === 1) {
          seq.push(vals[0]);
          if (seq.length >= 3) {
            const [a, b, c] = seq.slice(-3);
            if (b < a && Math.abs(a + b - c) <= 0.02) return { kdv: b, matrah: a };
          }
        }
      }
    }
    return null;
  };

  let mathTripleMatrah: number | null = null;
  const explicitKdv =
    // "Hesaplanan KDV(%NN)" en güvenilir toplam KDV etiketi — önce o (table-header
    // ürün satırından "1,0 Adet" miktarını KDV sanıp 1 dönmesin diye öne alındı).
    findExplicitKdvAmount() ??
    findKdvFromSummaryMathLine() ??
    findKdvFromTableHeader() ??
    (() => {
      const t = findKdvFromConsecutiveMathTriple();
      if (t) { mathTripleMatrah = t.matrah; return t.kdv; }
      return null;
    })() ??
    findAmountNear(
      /HESAPLANAN\s+K\.?\s*D\.?\s*V\.?|KATMA\s*DE[ĞG]ER\s*VERG[İI]S[İI]|KDV\s*TUTARI|K\.?\s*D\.?\s*V\.?(?:\s*[-/]?\s*VAT)?\s*\(\s*%?\s*\d{1,2}(?:[.,]\d{1,2})?\s*\)/i,
      { skipMatrah: true },
    ) ??
    findKdvFromMatrahTimesRate();
  const oranMatch =
    normalized.match(/K\.?\s*D\.?\s*V\.?[^\n%]{0,120}%\s*(\d{1,2})(?:[.,]\d{1,2})?/i)
    ?? normalized.match(/%\s*(\d{1,2})(?:[.,]\d{1,2})?\s*K\.?\s*D\.?\s*V\.?/i);
  const oran = oranMatch ? parseInt(oranMatch[1], 10) : null;

  if (explicitKdv != null && explicitKdv > 0) {
    return { kdv: explicitKdv, matrah: mathTripleMatrah, oran };
  }
  return null;
}
