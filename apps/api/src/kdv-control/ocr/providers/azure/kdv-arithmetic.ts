/**
 * KDV ARİTMETİK SON-UZLAŞTIRMA
 * ────────────────────────────
 * Tek oranlı, tevkifatsız faturada KDV matematiksel olarak ZORUNLUDUR:
 *   KDV = (Vergiler Dahil Toplam) − Matrah   ve aynı zamanda = Matrah × oran.
 *
 * Azure (ve hatta Claude/Max vision) bazen gerçek "Hesaplanan KDV" satırını —
 * OCR onu alt bilgi metniyle böldüğünde ya da parantezini düşürdüğünde —
 * ıskalayıp bir KALEMİN KDV'sini toplam sanıyor (TÜVTÜRK örneği: 685,68 yerine
 * 28,08) ya da hiç okuyamıyor (BAŞBUĞ örneği: 119,03 yerine boş).
 *
 * Bu fonksiyon yalnızca `(toplam − matrah)` TAM olarak `(matrah × geçerli TEK
 * oran)`'a eşitse KDV'yi bu değere çeker. Bu üçlü tutarlılık (matrah + toplam +
 * oran) yanlış değerlerle tesadüfen oluşmadığından; çok-oranlı, tevkifatlı,
 * ek-vergili ve dövizli faturalar KENDİLİĞİNDEN elenir → yanlış pozitif üretmez.
 *
 * crossCheck'ten SONRA çağrılmalıdır (crossCheck'in "açık KDV override" bloğunu
 * ezmemesi için); ardından validate düzeltilmiş sonucu yeniden skorlar.
 */
import type { OcrResult } from '../../types';

export const VALID_KDV_RATES_ARITHMETIC = [1, 8, 10, 18, 20];

export interface KdvArithmeticDeps {
  parseAmount: (s: string) => number;
  formatAmount: (n: number) => string;
  normalizeAzureText: (text: string) => string;
  foldTurkishAscii: (text: string) => string;
  logger?: { warn: (message: string) => void };
}

/**
 * Etiketli tutar: etiketi (Türkçe-katlanmış, büyük harf) bulur; tutarı aynı
 * satırda veya sonraki 3 satırda arar (Azure "Mal Hizmet Toplam / Tutarı /
 * 3.428,40" gibi etiket ve değeri ayrı satırlara bölebiliyor). Değeri HAM
 * satırdan parse eder (rakamlar korunur). İlk bulunan tutar metnini döndürür.
 */
export function extractLabeledAmount(
  normalizedText: string,
  labelRe: RegExp,
  foldTurkishAscii: (s: string) => string,
): string | null {
  const lines = normalizedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const amtIn = (s: string): string[] =>
    [...s.matchAll(/(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:TL|TRY|₺)?/gi)].map((m) => m[1]);
  for (let i = 0; i < lines.length; i++) {
    const folded = foldTurkishAscii(lines[i]).toUpperCase();
    const m = folded.match(labelRe);
    if (!m) continue;
    const rest = lines[i].slice(m.index != null ? m.index + m[0].length : lines[i].length);
    const same = amtIn(rest);
    if (same.length) return same[same.length - 1];
    for (let j = 1; j <= 3 && i + j < lines.length; j++) {
      const b = amtIn(lines[i + j]);
      if (b.length) return b[b.length - 1];
    }
  }
  return null;
}

/** Matrah: "KDV Matrahı" öncelikli; yoksa iskonto=0 ise "Mal/Hizmet Toplam Tutarı". */
export function extractInvoiceMatrah(
  normalizedText: string,
  deps: Pick<KdvArithmeticDeps, 'parseAmount' | 'foldTurkishAscii'>,
): number | null {
  const { parseAmount, foldTurkishAscii } = deps;
  const kdvMatrah = extractLabeledAmount(normalizedText, /K\.?\s*D\.?\s*V\.?\s*MATRAH/, foldTurkishAscii);
  if (kdvMatrah != null) return parseAmount(String(kdvMatrah));
  const iskonto = extractLabeledAmount(normalizedText, /TOPLAM\s*ISKONTO/, foldTurkishAscii);
  const iskontoNum = iskonto != null ? parseAmount(String(iskonto)) : 0;
  if (!iskontoNum || iskontoNum === 0) {
    const mh = extractLabeledAmount(normalizedText, /MAL\s*[\/ ]?\s*HIZMET\s*TOPLAM/, foldTurkishAscii);
    if (mh != null) return parseAmount(String(mh));
  }
  return null;
}

/**
 * KDV'yi fatura aritmetiğinden uzlaştırır. Düzeltme yaptıysa `result`'ı yerinde
 * günceller ve `true` döner; koşullar tutmazsa dokunmaz ve `false` döner.
 */
export function reconcileKdvByArithmetic(
  result: OcrResult,
  text: string,
  deps: KdvArithmeticDeps,
): boolean {
  if (!text) return false;
  const { parseAmount, formatAmount, normalizeAzureText, foldTurkishAscii } = deps;

  const tip = result.belgeTipi;
  if (tip === 'Z_RAPORU' || tip === 'OKC_FIS' || tip === 'MAKBUZ') return false;
  if (result.kdvTevkifat) return false; // tevkifat: Ödenecek net'i verir → hariç

  const folded = foldTurkishAscii(text).toUpperCase();
  if (/TEVK[İI]?FAT|STOPAJ|SERBEST\s+MESLEK/.test(folded)) return false;
  // Döviz: oran matematiği para biriminden bağımsız → yanlış pozitif riski
  if (/\b(?:USD|EUR|GBP|CHF|JPY)\b|DOVIZ\s*KURU|[$€£]/.test(folded)) return false;
  // Ek vergiler toplamı şişirir (matrah×oran çoğunlukla tutmaz; yine de net olalım)
  if (/\b(?:OIV|OTV|BSMV|KKDF|DAMGA|KONAKLAMA|CEVRE)\b|OZEL\s*ILETISIM/.test(folded)) return false;

  const norm = normalizeAzureText(text);
  const matrah = extractInvoiceMatrah(norm, { parseAmount, foldTurkishAscii });
  if (matrah == null || matrah <= 0) return false;

  const toplamStr =
    extractLabeledAmount(norm, /VERG[İI]?LER\s*DAHIL\s*TOPLAM/, foldTurkishAscii) ?? result.totalTutari;
  const toplam = toplamStr != null ? parseAmount(String(toplamStr)) : NaN;
  if (!Number.isFinite(toplam) || toplam <= matrah) return false;

  const kdvExpected = Math.round((toplam - matrah) * 100) / 100;
  if (kdvExpected <= 0) return false;
  const tol = Math.max(0.02, matrah * 0.005);
  const matched = VALID_KDV_RATES_ARITHMETIC.filter(
    (o) => Math.abs((matrah * o) / 100 - kdvExpected) <= tol,
  );
  if (matched.length !== 1) return false; // tek geçerli oran şart → çok-oran/çöp elenir
  const oran = matched[0];

  const cur = result.kdvTutari != null ? parseAmount(String(result.kdvTutari)) : null;
  if (cur != null && Math.abs(cur - kdvExpected) <= 0.02) return false; // zaten doğru

  deps.logger?.warn(
    `KDV aritmetik uzlastirma: okunan=${result.kdvTutari ?? 'yok'} -> ${formatAmount(kdvExpected)} ` +
      `(matrah ${formatAmount(matrah)} x %${oran} = toplam ${formatAmount(toplam)} - matrah)`,
  );
  result.kdvTutari = formatAmount(kdvExpected);
  result.kdvBreakdown = [{ oran, tutar: kdvExpected, matrah }];
  result.fieldConfidence.kdvTutari = 0.92;
  return true;
}
