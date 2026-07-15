/**
 * Azure OCR - KDV item rows / Hes. Matrah KDV table extractors.
 *
 * E-fatura/e-arsiv/tablo formatli belgelerde KDV breakdown'unu URUN SATIRLARINDAN
 * (kalemlerden) cikarir. Faz 2B-3 deki extractMultiRateKdv summary satirlarini
 * okur; burasi onun fallback'i — Azure summary satirini kacirirsa tablo
 * hucrelerinden ayrı ayrı toplar.
 *
 * Public API (Faz 4D):
 *   extractMultiRateKdvFromItemRows(text, deps)
 *   extractHesMatrahKdvTable(text, deps)
 *
 * Bu modul `this` kullanmaz; bagimliliklari `deps` ile alir.
 */

import type { KdvBreakdownItem } from '../../types';
import { isValidKdvRate } from './helpers';

export interface KdvItemRowsDeps {
  parseAmount: (s: string) => number;
  normalizeAzureText: (text: string) => string;
  stripMatrahFragments: (text: string) => string;
  isForbiddenKdvAmountLine: (value: string) => boolean;
  isLikelyKdvAmountColumnHeader: (lines: string[], index: number) => boolean;
}

export interface HesMatrahDeps {
  parseAmount: (s: string) => number;
  normalizeAzureText: (text: string) => string;
}

/**
 * Tablo satirlarindaki "% N,NN ... X,XX" pattern'inden oran bazli KDV kirilimi.
 *
 * Iki asamali scan:
 *   1) Once rate markerlari topla (oran + label satir index'i + isSummary + hasMatrahLabel)
 *   2) Her marker icin ayni satir veya sonraki 4 satirdan amount eslestir
 *
 * Summary satiri (HESAPLANAN KDV/TOPKDV/HES. MATRAH KDV) authoritative — varsa
 * o oran icin item row'lar atilir (duplicate toplama bug'i 1006+1006=2012 onlenir).
 *
 * KDV oran filtresi: virgulden sonraki kisim sifirdan farkliysa atla (iskonto orani).
 *
 * 2+ oran bulunmazsa bos array doner (tek oran icin zaten kdvTutari var).
 */
export function extractMultiRateKdvFromItemRows(text: string, deps: KdvItemRowsDeps): KdvBreakdownItem[] {
  const {
    parseAmount,
    normalizeAzureText,
    stripMatrahFragments,
    isForbiddenKdvAmountLine,
    isLikelyKdvAmountColumnHeader,
  } = deps;

  if (!text) return [];
  const normalized = normalizeAzureText(text);
  const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const sumByOran = new Map<number, number>();

  const rateMarkerRe = /%\s*(\d{1,2})(?:[,.](\d{1,2}))?/gi;
  const amountRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|₺)?/i;
  const skipTaxRe = /ÖZEL\s*İLETİŞİM|ÖIV|OIV|TELSİZ|TELSIZ|ÖTV|OTV|DAMGA|BSMV|KKDF|KONAKLAMA|ÇEVRE|TEVKİFAT|TEVKIFAT|STOPAJ/i;
  const discountRowRe = /İSKONTO|ISKONTO|\bİSK\.?\s*(?:%|Oran|TUTAR|TUTARI|ORANI)|\bISK\.?\s*(?:%|Oran|TUTAR|TUTARI|ORANI)|İNDİRİM|INDIRIM/i;

  type Marker = { oran: number; lineIdx: number; afterLabel: string; isSummary: boolean; hasMatrahLabel: boolean };
  const markers: Marker[] = [];
  // Summary (authoritative) KDV satir kaliplari. "KDV Tutari(MATRAH %ORAN)" e-fatura
  // alt-toplam satiri da buraya dahil: bu satir taninmazsa kalem satirlarindaki ayni
  // oranli KDV ile TOPLANIP iki katina cikiyordu (gercek bug: UKF2026000000235 →
  // %10 1.176 + 1.176 = 2.352, %20 11.184,40 + 11.184,40 = 22.368,80). Bu kalip
  // summary sayilinca oranCoveredBySummary devreye girer, kalem satirlari atilir.
  const summaryLineRe = /HESAPLANAN\s*K\.?\s*D\.?\s*V\.?|TOPKDV|TOP\s*K\.?\s*D\.?\s*V\.?|HES\.?\s*MATRAH\s*[/-]?\s*K\.?\s*D\.?\s*V\.?|MATRAH\s*[/-]?\s*K\.?\s*D\.?\s*V\.?|K\.?\s*D\.?\s*V\.?\s*TUTAR[IİI]?\s*\(/i;
  const matrahLabelRe = /HES\.?\s*MATRAH\s*[/-]?\s*K\.?\s*D\.?\s*V\.?|MATRAH\s*[/-]?\s*K\.?\s*D\.?\s*V\.?/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (skipTaxRe.test(line)) continue;
    if (discountRowRe.test(line) && !/KDV/i.test(line)) continue;
    if (isForbiddenKdvAmountLine(line) || isLikelyKdvAmountColumnHeader(lines, i)) continue;

    let prevHasNonKdvTax = false;
    for (let p = 1; p <= 2 && i - p >= 0; p++) {
      const prev = lines[i - p];
      if (skipTaxRe.test(prev)) { prevHasNonKdvTax = true; break; }
      if (/KATMA\s*DE[ĞG]ER\s*VERG[İI]S[İI]|\bK\.?\s*D\.?\s*V\.?\b/i.test(prev)) break;
    }
    if (prevHasNonKdvTax) continue;

    const isSummary = summaryLineRe.test(line);
    const hasMatrahLabel = matrahLabelRe.test(line);

    rateMarkerRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rateMarkerRe.exec(line)) !== null) {
      const oran = parseInt(m[1], 10);
      // TR'de gecerli KDV orani degilse (or. %23/%26 = iskonto orani sutunu) atla.
      if (!isValidKdvRate(oran)) continue;
      const decimalPart = m[2];
      if (decimalPart && parseInt(decimalPart, 10) > 0) continue;
      const afterLabel = stripMatrahFragments(line.slice(m.index + m[0].length));
      markers.push({ oran, lineIdx: i, afterLabel, isSummary, hasMatrahLabel });
    }
  }

  const oranCoveredBySummary = new Set<number>();
  for (const marker of markers) {
    if (marker.isSummary) oranCoveredBySummary.add(marker.oran);
  }

  // İSKONTO SÜTUNU KORUMASI: Belgede "İskonto Oranı/Tutarı" sütunu varsa, kalem
  // satırlarındaki "%5,00" gibi işaretler İSKONTO oranı olabilir (Azure sütunları
  // ayrı satırlara böler; işaret satırında "İskonto" kelimesi GEÇMEZ). Özet
  // ("Hesaplanan KDV(%X)") satırlarıyla doğrulanmış EN AZ BİR oran varken, hiçbir
  // özette geçmeyen kalem-içi oranlar atılır. (Gerçek vaka: MEZCAR CHS2026000001375
  // — kalem iskonto %5/%10 KDV kırılımı sanılıp toplam 4.710,61 yerine 5.958,88
  // yazıldı; gerçek fatura TEK oran %20.)
  const hasIskontoHeader = lines.some(
    (l) => /[İI]SKONTO\s*(ORAN|TUTAR)|\b[İI]SK\.?\s*(ORAN|TUTAR)|[İI]ND[İI]R[İI]M\s*(ORAN|TUTAR)/i.test(l),
  );

  for (const marker of markers) {
    if (!marker.isSummary && oranCoveredBySummary.has(marker.oran)) continue;
    if (
      !marker.isSummary &&
      hasIskontoHeader &&
      oranCoveredBySummary.size > 0 &&
      !oranCoveredBySummary.has(marker.oran)
    ) continue;

    let tutar: number | null = null;

    if (marker.hasMatrahLabel) {
      const amountReGlobal = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|₺)?/gi;
      const allMatches = Array.from(marker.afterLabel.matchAll(amountReGlobal));
      if (allMatches.length >= 2) {
        const last = allMatches[allMatches.length - 1];
        const parsed = parseAmount(last[1]);
        if (parsed >= 0 && parsed < 10_000_000) tutar = parsed;
      } else if (allMatches.length === 1) {
        const parsed = parseAmount(allMatches[0][1]);
        if (parsed > 0 && parsed < 10_000_000) tutar = parsed;
      }
    } else {
      const afterLabelMatch = marker.afterLabel.match(amountRe);
      if (afterLabelMatch) {
        const parsed = parseAmount(afterLabelMatch[1]);
        if (parsed > 0 && parsed < 10_000_000) tutar = parsed;
      }
    }

    if (tutar == null) {
      const collected: number[] = [];
      for (let j = 1; j <= 4 && marker.lineIdx + j < lines.length; j++) {
        const nextLine = lines[marker.lineIdx + j];
        if (skipTaxRe.test(nextLine)) break;
        if (isForbiddenKdvAmountLine(nextLine)) continue;
        if (j > 1 && isForbiddenKdvAmountLine(lines[marker.lineIdx + j - 1] || '')) continue;
        if (/^%\s*\d{1,2}(?:[,.]\d{1,2})?\s*\)?\s*$/.test(nextLine.trim())) break;
        const cleanedNext = stripMatrahFragments(nextLine);
        if (!cleanedNext) continue;
        const am = cleanedNext.match(amountRe);
        if (am) {
          // İSKONTO guvenligi: tutardan hemen SONRA "İSKONTO/İndirim" geliyorsa,
          // bu bir indirim (iskonto) tutaridir — KDV degil. e-arsiv/e-fatura
          // kalemlerinde indirim orani ("%10") kendi satirinda durup KDV dilimi
          // gibi gorunebiliyor; tutarini almadan atla. (ALB... faturasi gibi)
          const afterAmount1 = lines[marker.lineIdx + j + 1] || '';
          const afterAmount2 = lines[marker.lineIdx + j + 2] || '';
          const followedByDiscount =
            (discountRowRe.test(afterAmount1) && !/KDV/i.test(afterAmount1)) ||
            (discountRowRe.test(afterAmount2) && !/KDV/i.test(afterAmount2));
          if (followedByDiscount) {
            continue;
          }
          const parsed = parseAmount(am[1]);
          if (parsed >= 0 && parsed < 10_000_000) {
            collected.push(parsed);
            if (marker.hasMatrahLabel && collected.length >= 2) break;
            if (!marker.hasMatrahLabel) break;
          }
        }
      }
      if (collected.length > 0) {
        if (marker.hasMatrahLabel && collected.length >= 2) {
          tutar = collected[1];
        } else {
          tutar = collected[0];
        }
      }
    }

    if (tutar != null && tutar > 0) {
      if (marker.isSummary) {
        sumByOran.set(marker.oran, tutar);
      } else {
        sumByOran.set(marker.oran, (sumByOran.get(marker.oran) || 0) + tutar);
      }
    }
  }

  if (sumByOran.size < 2) return [];
  return Array.from(sumByOran.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([oran, tutar]) => ({
      oran,
      tutar: Math.round(tutar * 100) / 100,
      matrah: null,
    }));
}

/**
 * "Hes. Matrah / KDV(%N)" tablosundan oran bazli KDV + Toplam KDV.
 *
 * E-arsiv fatura alti standart format:
 *   "Hes. Matrah / KDV(%1)     771,70    7,72"
 *   "Hes. Matrah / KDV(%20)   500,00   100,00"
 *   "Hes. Matrah / KDV Toplam 1271,70   107,72"
 *
 * Bu format varsa AUTHORITATIVE (cross-check'te diger extractor'lar atlanir).
 * Cunku oran satirinda 1. amount MATRAH (KDV degil) — diger extractor'lar
 * matrah'i KDV sanip yanlis hesap yapabilir.
 *
 * Don: { totalKdv, breakdown[] }
 *   - totalKdv: "Hes. Matrah / KDV Toplam" satirindaki KDV
 *   - breakdown: her oran icin (oran, tutar=KDV) — matrah saklanmaz
 */
export function extractHesMatrahKdvTable(
  text: string,
  deps: HesMatrahDeps,
): { totalKdv: number | null; breakdown: KdvBreakdownItem[] } {
  const { parseAmount, normalizeAzureText } = deps;

  if (!text) return { totalKdv: null, breakdown: [] };

  const labelRe = /HES\.?\s*MATRAH\s*[/-]?\s*K\.?\s*D\.?\s*V\.?\s*(?:TOPLAM|\(?\s*%\s*(\d{1,2})\s*\)?)/i;
  if (!labelRe.test(text)) return { totalKdv: null, breakdown: [] };

  const normalized = normalizeAzureText(text);
  const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const amountRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|₺)?/i;
  const allAmountRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|₺)?/gi;

  let totalKdv: number | null = null;
  const breakdown = new Map<number, number>();

  const collectAmountsAfterLine = (startIdx: number, maxLines = 4): number[] => {
    const amts: number[] = [];
    const startLine = lines[startIdx];
    const labelMatch = startLine.match(labelRe);
    if (labelMatch) {
      const after = startLine.slice(labelMatch.index! + labelMatch[0].length);
      for (const m of after.matchAll(allAmountRe)) {
        const v = parseAmount(m[1]);
        if (v >= 0 && v < 100_000_000) amts.push(v);
      }
    }
    for (let j = 1; j <= maxLines && startIdx + j < lines.length; j++) {
      const nl = lines[startIdx + j];
      if (labelRe.test(nl)) break;
      if (/^%\s*\d{1,2}\s*\)?\s*$/.test(nl.trim())) break;
      const am = nl.match(amountRe);
      if (am) {
        const v = parseAmount(am[1]);
        if (v >= 0 && v < 100_000_000) amts.push(v);
      }
    }
    return amts;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(labelRe);
    if (!m) continue;

    const isToplam = /TOPLAM/i.test(line);
    const oran = m[1] ? parseInt(m[1], 10) : null;

    const amts = collectAmountsAfterLine(i, 4);
    if (amts.length === 0) continue;
    const kdvAmount = amts.length >= 2 ? amts[1] : amts[0];

    if (isToplam) {
      if (kdvAmount > 0) totalKdv = kdvAmount;
    } else if (oran && isValidKdvRate(oran)) {
      if (kdvAmount > 0) breakdown.set(oran, kdvAmount);
    }
  }

  return {
    totalKdv,
    breakdown: Array.from(breakdown.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([oran, tutar]) => ({ oran, tutar: Math.round(tutar * 100) / 100, matrah: null })),
  };
}
