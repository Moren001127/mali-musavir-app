/**
 * Azure OCR - OKC Fis pipeline.
 *
 * OKC (Odeme Kaydedici Cihaz) fislerinden KDV breakdown cikarir:
 *   - Once "KDV / TOPKDV" satirlarini summary olarak topla
 *   - Eger summary 2+ farkli oran iceriyorsa onu kullan
 *   - Aksi takdirde urun satirlarindaki %01/%10/%20 bruta gore turet
 *
 * Public API (Faz 2B):
 *   extractOkcFisKdv(text, deps)                      - hem summary hem item-rate breakdown
 *   extractOkcFisItemRateBreakdown(text, expectedTotal, deps) - sadece urun satirlarindan oran kirilimi
 *
 * Bu modul `this` kullanmaz; bagimliliklari `deps` ile alir.
 */

import type { KdvBreakdownItem } from '../../types';

export interface OkcFisDeps {
  parseAmount: (s: string) => number;
  formatAmount: (n: number) => string;
  normalizeAzureText: (text: string) => string;
  stripMatrahFragments: (text: string) => string;
  isMatrahOrRateLine: (value: string) => boolean;
  logger: { warn: (m: string) => void };
}

/**
 * OKC fis OCR metninden KDV tutari + breakdown cikarir.
 *
 * Akis:
 *   1) "KDV / TOPKDV" geceн her satir summary'e eklenir (matrah/oran satirlari haric)
 *   2) Ayni satirda tutar yoksa sonraki 2 satira bakar
 *   3) Sonra extractOkcFisItemRateBreakdown ile urun satirlarindan kirilim dener
 *   4) Eger item-rate >=2 oran verirse onu doner; aksi takdirde summary'yi doner
 *
 * Hicbir KDV yakalanamazsa null.
 */
export function extractOkcFisKdv(
  text: string,
  deps: OkcFisDeps,
): { kdvTutari: string | null; breakdown: KdvBreakdownItem[] } | null {
  const { parseAmount, formatAmount, normalizeAzureText, stripMatrahFragments, isMatrahOrRateLine } = deps;

  if (!text) return null;
  const lines = normalizeAzureText(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const breakdown: KdvBreakdownItem[] = [];
  const kdvLineRe = /\bK\.?\s*D\.?\s*V\.?\b(?!\s*(?:MATRAH|ORAN|UYGULANAN))|\bT[O0]P\s*K\s*D\s*V\b|\bT[O0]PKD[UV]\b/i;
  const otherTaxRe = /ÖZEL\s*İLETİŞİM|ÖİV|OIV|TELSİZ|TELSIZ|ÖTV|OTV|DAMGA|BSMV|KKDF|KONAKLAMA|ÇEVRE|STOPAJ/i;
  const amountRe = /[-+]?[\*₺¥]?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*(?:TL|TRY|₺)?/g;

  const parseLastAmount = (raw: string): number => {
    const clean = stripMatrahFragments(raw);
    const values = [...clean.matchAll(amountRe)]
      .map((m) => parseAmount(m[1]))
      .filter((value) => value > 0 && value < 100_000_000);
    return values.length > 0 ? values[values.length - 1] : 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!kdvLineRe.test(line)) continue;
    if (otherTaxRe.test(line) || isMatrahOrRateLine(line)) continue;
    const rateMatch = line.match(/(?:K\.?\s*D\.?\s*V\.?\s*)?[%/]\s*(\d{1,2})(?:[.,]\d+)?/i);
    const oran = rateMatch ? Number(rateMatch[1]) : null;
    let tutar = parseLastAmount(line);
    if (tutar <= 0) {
      for (let j = 1; j <= 2 && i + j < lines.length; j++) {
        const next = lines[i + j];
        if (otherTaxRe.test(next) || /TOPLAM|NAKİT|NAKIT|KART|GENEL/i.test(next)) break;
        tutar = parseLastAmount(next);
        if (tutar > 0) break;
      }
    }
    if (tutar > 0) {
      breakdown.push({
        oran: oran && [1, 10, 20].includes(oran) ? oran : 0,
        tutar,
        matrah: null,
      });
    }
  }

  const summarySum = breakdown.reduce((total, item) => total + item.tutar, 0);
  const itemRateBreakdown = extractOkcFisItemRateBreakdown(text, summarySum, deps);
  if (itemRateBreakdown.length >= 2) {
    const itemSum = itemRateBreakdown.reduce((total, item) => total + item.tutar, 0);
    return {
      kdvTutari: formatAmount(summarySum > 0 ? summarySum : itemSum),
      breakdown: itemRateBreakdown,
    };
  }

  if (breakdown.length === 0) return null;
  return {
    kdvTutari: formatAmount(summarySum),
    breakdown,
  };
}

/**
 * OKC fislerde bazen sadece TOPKDV toplam yazilir; oran bazli KDV ise urun
 * satirlarindaki %01/%10/%20 brut tutarlardan turetilmelidir.
 *
 * Her urun satirindaki son tutari "brut" kabul eder, oran ile KDV'yi
 * tutar = gross * oran / (100 + oran) formulu ile hesaplar.
 *
 * En az 2 farkli oran yakalanmadiysa veya beklenen toplamla uyumsuzsa
 * (tolerans: max(0.08, expectedTotal * 0.03)) bos array doner.
 */
export function extractOkcFisItemRateBreakdown(
  text: string,
  expectedTotal: number | null | undefined,
  deps: OkcFisDeps,
): KdvBreakdownItem[] {
  const { parseAmount, formatAmount, normalizeAzureText, logger } = deps;

  if (!text) return [];
  const lines = normalizeAzureText(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const grossByRate = new Map<number, number>();
  const rateRe = /%\s*0?(1|8|10|18|20)(?:[,.]00)?\b/i;
  const amountRe = /[-+]?[*]?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*(?:TL|TRY)?/g;
  const skipRe = /TOPKDV|TOPLAM|KDV\s*TUTARI|KDV\s*TOPLAM|NAK[Iİ]T|KRED[Iİ]|KART|PARA\s*[UÜ]ST[UÜ]|KAS[Iİ]YER|MERS[Iİ]S|EKU|Z\s*NO|F[Iİ][SŞ]\s*NO|TAR[Iİ]H|SAAT|VERG[Iİ]|V\.?D\.?|T\.?C\.?|TE[SŞ]EKK[UÜ]R|M[UÜ][SŞ]TER[Iİ]/i;

  const parseLastAmount = (raw: string): number => {
    const values = [...raw.matchAll(amountRe)]
      .map((m) => parseAmount(m[1]))
      .filter((value) => value > 0 && value < 100_000_000);
    return values.length > 0 ? values[values.length - 1] : 0;
  };

  for (const line of lines) {
    if (skipRe.test(line)) continue;
    const rateMatch = line.match(rateRe);
    if (!rateMatch || rateMatch.index == null) continue;
    const oran = Number(rateMatch[1]);
    const afterRate = line.slice(rateMatch.index + rateMatch[0].length);
    const gross = parseLastAmount(afterRate) || parseLastAmount(line);
    if (!(gross > 0)) continue;
    grossByRate.set(oran, (grossByRate.get(oran) || 0) + gross);
  }

  if (grossByRate.size < 2) return [];
  const breakdown = Array.from(grossByRate.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([oran, gross]) => ({
      oran,
      tutar: Math.round((gross * oran / (100 + oran)) * 100) / 100,
      matrah: null as number | null,
    }))
    .filter((item) => item.tutar > 0);

  if (breakdown.length < 2) return [];
  const sum = breakdown.reduce((total, item) => total + item.tutar, 0);
  if (expectedTotal && expectedTotal > 0) {
    const tolerance = Math.max(0.08, expectedTotal * 0.03);
    if (Math.abs(sum - expectedTotal) > tolerance) {
      logger.warn(
        `OKC item-rate breakdown toplamla uyumsuz: item=${formatAmount(sum)} topkdv=${formatAmount(expectedTotal)} - breakdown kullanilmadi`,
      );
      return [];
    }
  }
  return breakdown;
}
