/**
 * Azure OCR ana orchestrator (runner).
 *
 * Azure Cognitive Vision Read API'sinden ham metni alir, sonra Faz 1+2'de
 * cikartilmis tum extractor + validator modullerini siralayarak calistirir
 * ve OcrResult olusturur.
 *
 * Akis:
 *   1) Azure Read API → fullText
 *   2) Belge tipi tespiti
 *   3) Tarih (preferredInvoiceDate veya generic extractDate)
 *   4) Belge no (Z raporu ise body öncelikli, diğer tipler filename öncelikli)
 *   5) KDV pipeline: zRaporu / okcFis / tevkifatli / invoiceTotals fallback
 *   6) Tevkifat inference (tam KDV bulunamadiysa)
 *   7) KDV/Toplam supheli oran kontrolu
 *   8) Satici/VKN extraction
 *   9) Field confidence hesaplama
 *  10) Breakdown set (zRaporu > tevkifatli > okcFis > invoiceTotals)
 *  11) postProcess → crossCheck → validate (3 katmanli son dogrulama)
 *
 * Public API (Faz 4E):
 *   runAzureOcr(buffer, belgeNoFromFilename, originalName, deps)
 *
 * Bu modul `this` kullanmaz; 21 bagimliligi `deps` ile alir.
 */

import type { OcrResult, KdvBreakdownItem } from '../../types';

export interface AzureRunnerDeps {
  // Pure helpers
  parseAmount: (s: string) => number;
  formatAmount: (n: number) => string;
  normalizeAzureText: (text: string) => string;
  // Azure read
  getAzureRawText: (buffer: Buffer) => Promise<string>;
  // Document type + date + belge no + satici
  detectBelgeTipiFromAzure: (text: string, originalName?: string) => string | null;
  extractPreferredInvoiceDate: (text: string) => string | null;
  extractDate: (text: string) => string | null;
  extractBelgeNo: (text: string) => string | null;
  extractSaticiFromAzure: (text: string) => string | null;
  extractSaticiVknFromAzure: (text: string) => string | null;
  // KDV extractors
  extractZRaporuKdvFromAzure: (text: string) => {
    kdvTutari: string | null;
    breakdown: KdvBreakdownItem[];
    matrahByOran: Record<number, number>;
  };
  extractOkcFisKdvFromAzure: (text: string) => {
    kdvTutari: string | null;
    breakdown: KdvBreakdownItem[];
  } | null;
  extractOkcFisToplamFromAzure: (text: string, kdvNum?: number | null) => string | null;
  extractTevkifatliFaturaFromAzure: (text: string) =>
    { tamKdv: number; tevkifat: number; netKdv: number } | null;
  extractKdvFromInvoiceTotalsAzure: (text: string) =>
    { kdv: number; matrah: null; oran: number | null } | null;
  extractKdvTotal: (text: string) => string | null;
  inferTevkifatFromAzureAmounts: (text: string, tamKdv: number) =>
    { tamKdv: number; tevkifat: number; netKdv: number } | null;
  extractToplam: (text: string) => string | null;
  // Validation pipeline
  postProcessOcrResult: (
    result: OcrResult,
    belgeNoFromFilename: string | null,
    originalName?: string,
  ) => void;
  crossCheckWithAzure: (
    result: OcrResult,
    azureText: string,
    originalName?: string,
    belgeNoFromFilename?: string | null,
  ) => void;
  validateOcrResult: (result: OcrResult, originalName?: string) => void;
  // Logger
  logger: {
    log: (message: string) => void;
    warn: (message: string) => void;
  };
}

/**
 * Azure OCR full pipeline — buffer alir, OcrResult doner.
 *
 * @param buffer               Image/PDF binary
 * @param belgeNoFromFilename  Filename'den cikartilmis belge no (fallback)
 * @param originalName         Log icin orijinal dosya adi
 * @param deps                 21 callback (pure helpers + extractors + validators + logger)
 */
export async function runAzureOcr(
  buffer: Buffer,
  belgeNoFromFilename: string | null,
  originalName: string | undefined,
  deps: AzureRunnerDeps,
): Promise<OcrResult> {
  const {
    parseAmount,
    formatAmount,
    normalizeAzureText,
    getAzureRawText,
    detectBelgeTipiFromAzure,
    extractPreferredInvoiceDate,
    extractDate,
    extractBelgeNo,
    extractSaticiFromAzure,
    extractSaticiVknFromAzure,
    extractZRaporuKdvFromAzure,
    extractOkcFisKdvFromAzure,
    extractOkcFisToplamFromAzure,
    extractTevkifatliFaturaFromAzure,
    extractKdvFromInvoiceTotalsAzure,
    extractKdvTotal,
    inferTevkifatFromAzureAmounts,
    extractToplam,
    postProcessOcrResult,
    crossCheckWithAzure,
    validateOcrResult,
    logger,
  } = deps;

  const fullText = await getAzureRawText(buffer);

  // Alanlari cikar
  const belgeTipi = detectBelgeTipiFromAzure(fullText, originalName);
  const date = extractPreferredInvoiceDate(fullText) ?? extractDate(fullText);
  const bodyBelgeNo = extractBelgeNo(fullText);
  let belgeNo: string | null;
  if (belgeTipi === 'Z_RAPORU' && bodyBelgeNo) {
    belgeNo = bodyBelgeNo;
    if (belgeNoFromFilename && belgeNoFromFilename !== bodyBelgeNo) {
      logger.log(
        `Z_RAPORU belgeNo override: filename "${belgeNoFromFilename}" yerine body Z NO "${bodyBelgeNo}" kullanildi (${originalName || '-'})`,
      );
    }
  } else {
    const filenameIsShortOkcNo = !!belgeNoFromFilename && /^\d{1,6}$/.test(belgeNoFromFilename);
    const trustFilename =
      !!belgeNoFromFilename &&
      (!filenameIsShortOkcNo || belgeTipi === 'OKC_FIS' || belgeTipi === 'MAKBUZ' || !bodyBelgeNo);
    belgeNo = trustFilename ? belgeNoFromFilename : (bodyBelgeNo ?? belgeNoFromFilename);
  }
  const zRaporu = belgeTipi === 'Z_RAPORU' ? extractZRaporuKdvFromAzure(fullText) : null;
  const okcFis = belgeTipi === 'OKC_FIS' ? extractOkcFisKdvFromAzure(fullText) : null;
  let tevkifatli = extractTevkifatliFaturaFromAzure(fullText);
  let invoiceTotalsKdv = tevkifatli || zRaporu?.kdvTutari || okcFis?.kdvTutari
    ? null
    : extractKdvFromInvoiceTotalsAzure(fullText);
  let kdv = zRaporu?.kdvTutari
    ? zRaporu.kdvTutari
    : tevkifatli
      ? formatAmount(tevkifatli.netKdv)
      : okcFis?.kdvTutari
        ? okcFis.kdvTutari
        : invoiceTotalsKdv
          ? formatAmount(invoiceTotalsKdv.kdv)
          : extractKdvTotal(fullText);
  if (!tevkifatli && kdv) {
    const inferredTevkifat = inferTevkifatFromAzureAmounts(fullText, parseAmount(kdv));
    if (inferredTevkifat) {
      tevkifatli = inferredTevkifat;
      invoiceTotalsKdv = null;
      kdv = formatAmount(inferredTevkifat.netKdv);
      logger.warn(
        `Azure OCR tevkifat fallback: tam=${formatAmount(inferredTevkifat.tamKdv)} tevkifat=${formatAmount(inferredTevkifat.tevkifat)} net=${kdv} (${originalName || '-'})`,
      );
    }
  }
  // OKC fislerinde toplam "*" onekli basilir ("TOPLAM *6.922,80") ve generic
  // extractToplam bunu yakalayamaz → fise ozel cikarici oncelikli.
  const toplam = belgeTipi === 'OKC_FIS'
    ? (extractOkcFisToplamFromAzure(fullText, kdv ? parseAmount(String(kdv)) : null)
        ?? extractToplam(fullText))
    : extractToplam(fullText);
  if (!zRaporu?.kdvTutari && !tevkifatli && kdv && toplam) {
    const kdvNum = parseAmount(String(kdv));
    const toplamNum = parseAmount(String(toplam));
    if (kdvNum > 0 && toplamNum > 0 && kdvNum >= toplamNum * 0.45) {
      logger.warn(
        `Azure OCR KDV tutari supheli: kdv=${kdv} toplam=${toplam} - KDV alani bos birakildi (${originalName || '-'})`,
      );
      kdv = null;
    }
  }
  const satici = extractSaticiFromAzure(fullText);
  const saticiVkn = extractSaticiVknFromAzure(fullText);

  const foundFields = [belgeNo, date, kdv].filter(Boolean).length;
  const confidence = belgeNoFromFilename
    ? 0.3 + (foundFields / 3) * 0.7
    : foundFields / 3;

  logger.log(
    `Azure OCR [${belgeNoFromFilename || 'unknown'}] Alan:${foundFields}/3 Conf:%${Math.round(confidence * 100)}`,
  );

  const azureBaseline = 0.72;
  const fieldConfidence = {
    belgeNo: belgeNo ? (belgeNoFromFilename && belgeNo === belgeNoFromFilename ? 0.95 : azureBaseline) : null,
    date: date ? azureBaseline : null,
    kdvTutari: kdv ? (zRaporu?.kdvTutari || tevkifatli || okcFis?.kdvTutari || invoiceTotalsKdv ? 0.92 : azureBaseline) : null,
  };

  const result: OcrResult = {
    rawText: fullText.slice(0, 3000),
    belgeNo,
    date,
    kdvTutari: kdv,
    kdvTevkifat: tevkifatli ? formatAmount(tevkifatli.tevkifat) : null,
    totalTutari: toplam,
    satici,
    saticiVkn,
    belgeTipi,
    confidence,
    fieldConfidence,
    engine: 'azure-read',
  };

  if (zRaporu?.breakdown?.length) {
    result.kdvBreakdown = zRaporu.breakdown;
  } else if (tevkifatli) {
    const oranMatch = normalizeAzureText(fullText).match(
      /HESAPLANAN\s+KDV\s*\(\s*[%/]?\s*(\d{1,2})/i,
    );
    const oran = oranMatch ? parseInt(oranMatch[1], 10) : null;
    result.kdvBreakdown = [{
      oran: oran && [1, 10, 20].includes(oran) ? oran : 20,
      tutar: tevkifatli.netKdv,
      matrah: null,
    }];
  } else if (okcFis?.breakdown?.length) {
    result.kdvBreakdown = okcFis.breakdown;
  } else if (invoiceTotalsKdv) {
    result.kdvBreakdown = [{
      oran: invoiceTotalsKdv.oran && [1, 10, 20].includes(invoiceTotalsKdv.oran)
        ? invoiceTotalsKdv.oran
        : 20,
      tutar: invoiceTotalsKdv.kdv,
      matrah: invoiceTotalsKdv.matrah,
    }];
  }

  // OKC fis tek-oranli kirilimda matrah = toplam − KDV (toplam KDV-dahildir).
  if (
    belgeTipi === 'OKC_FIS' && toplam && kdv &&
    result.kdvBreakdown?.length === 1 && result.kdvBreakdown[0].matrah == null
  ) {
    const toplamNum = parseAmount(String(toplam));
    const kdvNum = parseAmount(String(kdv));
    if (toplamNum > kdvNum && kdvNum > 0) {
      result.kdvBreakdown[0].matrah = Math.round((toplamNum - kdvNum) * 100) / 100;
    }
  }

  postProcessOcrResult(result, belgeNoFromFilename, originalName);
  crossCheckWithAzure(result, fullText, originalName, belgeNoFromFilename);
  validateOcrResult(result, originalName);

  return result;
}
