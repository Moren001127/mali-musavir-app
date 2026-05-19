/**
 * OCR Cross-Check Validation Pipeline.
 *
 * Claude Vision OCR sonucunu Azure ham metniyle dogrular ve gerektiginde
 * Azure'in regex bazli extractor'larini "ikinci tanik" olarak kullanir.
 *
 * Public API (Faz 4B):
 *   crossCheckWithAzure(result, azureText, originalName, belgeNoFromFilename, deps)
 *
 * Bu modul `this` kullanmaz. Tum bagimliliklar `deps` ile alinir (14 callback).
 * Result objesi mutate edilir (in-place update).
 *
 * Akis:
 *   1. Belge no filename match → cross-check atla
 *   2. E-fatura format + Claude conf ≥ %85 → trust guard
 *   3. Z_RAPORU auto-correct (extractZRaporuKdvFromAzure)
 *   4. Tevkifatli fatura auto-correct (extractTevkifatliFaturaFromAzure)
 *   5. Defansif fallback: Tevkifat var ama extract edilemediyse confidence siflar
 *   6. Telekom fatura KDV-only override (extractKdvOnlyFromTelekomAzure)
 *   7. Acik KDV satiri override (extractKdvFromInvoiceTotalsAzure)
 *   8. Multi-rate auto-fill (extractMultiRateKdvFromAzure + ItemRows + HesMatrah)
 *   9. Generic field cross-check (isFieldInAzureText) — son katman
 *  10. Confidence yeniden hesabi (alan-bazli ortalama)
 */

import type { KdvBreakdownItem, OcrResult } from '../types';

/** E-belge no genel format: 2-4 harf + 12-14 rakam veya alfanumerik 13-20 hane. */
const E_BELGE_NO_REGEX = /^(?:[A-Z]{2,4}\d{12,14}|[A-Z]\d{2}20\d{2}\d{6,12}|\d{13,20})$/;

export interface CrossCheckDeps {
  // Pure helpers
  parseAmount: (s: string) => number;
  formatAmount: (n: number) => string;
  foldTurkishAscii: (s: string) => string;
  normalizeAzureText: (text: string) => string;
  // Modul cagirilari (Faz 1+2'de cikarilmis)
  eBelgeNoDistance: (a: string, b: string) => number;
  extractZRaporuKdvFromAzure: (text: string) => {
    kdvTutari: string | null;
    breakdown: KdvBreakdownItem[];
    matrahByOran: Record<number, number>;
  };
  extractTevkifatliFaturaFromAzure: (text: string) => {
    tamKdv: number;
    tevkifat: number;
    netKdv: number;
  } | null;
  extractKdvOnlyFromTelekomAzure: (text: string) => number | null;
  extractKdvFromInvoiceTotalsAzure: (text: string) =>
    { kdv: number; matrah: null; oran: number | null } | null;
  extractMultiRateKdvFromAzure: (text: string) => KdvBreakdownItem[];
  extractMultiRateKdvFromItemRows: (text: string) => KdvBreakdownItem[];
  extractHesMatrahKdvTable: (text: string) =>
    { breakdown: KdvBreakdownItem[]; totalKdv: number | null };
  isFieldInAzureText: (
    value: string,
    field: 'belgeNo' | 'date' | 'amount',
    azureText: string,
  ) => boolean;
  // Logger
  logger: {
    log: (message: string) => void;
    warn: (message: string) => void;
  };
}

/**
 * Claude OCR sonucunu Azure ham metniyle cross-check eder, gerektiginde
 * Azure regex extractor'lariyla override eder. Mutate eder (result.* direkt yazilir).
 */
export function crossCheckWithAzure(
  result: OcrResult,
  azureText: string,
  originalName: string | undefined,
  belgeNoFromFilename: string | null | undefined,
  deps: CrossCheckDeps,
): void {
  const {
    parseAmount,
    formatAmount,
    foldTurkishAscii,
    normalizeAzureText,
    eBelgeNoDistance,
    extractZRaporuKdvFromAzure,
    extractTevkifatliFaturaFromAzure,
    extractKdvOnlyFromTelekomAzure,
    extractKdvFromInvoiceTotalsAzure,
    extractMultiRateKdvFromAzure,
    extractMultiRateKdvFromItemRows,
    extractHesMatrahKdvTable,
    isFieldInAzureText,
    logger,
  } = deps;

  if (!azureText || azureText.length < 10) return;

  const kdvAlreadyVerifiedByAutoFill = { value: false };

  // ─── SALT-RATE GUARD ────────────────────────────────────────────────
  // BUG FIX (WASH faturasi v1.37.77): Azure'in re-extract'inden gelen kdvTutari
  // "20" / "20,00" / "10" gibi salt KDV oranlari olabilir (Azure ham metnindeki
  // "%20.0" gibi rate echo'larini tutar sanip donduruyor). Bu degerler postProcess
  // tarafindan zaten null'a cekilmis olabilir, ama cross-check overwrite ediyor.
  // Her override oncesi bu helper'la "salt rate" mi kontrol et.
  const isLikelyRateEcho = (n: number): boolean => {
    if (n > 30) return false;
    const rounded = Math.round(n * 100) / 100;
    return [0, 1, 8, 10, 18, 20].some((r) => Math.abs(rounded - r) < 0.01);
  };

  const buildTelekomKdvBreakdown = (kdvOnlyAmount: number): KdvBreakdownItem[] => {
    const normalizedLines = foldTurkishAscii(azureText)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const kdvLabelRe = /KATMA\s*DE.?ER\s*VERGISI|\bK\.?\s*D\.?\s*V\.?\b/i;
    const otherTaxRe = /[O?]ZEL\s*[I?]LET[I?]S[I?]M|OIV\b|TELSIZ|OTV\b|DAMGA|BSMV|KKDF|KONAKLAMA/i;

    for (const line of normalizedLines) {
      if (!kdvLabelRe.test(line) || otherTaxRe.test(line)) continue;
      const oranMatch = line.match(/%\s*(\d{1,2})(?:[,.]\d{1,2})?/);
      const matrahMatch = line.match(/\bMATRAH[II]?\s*[:=]?\s*([-\d.,]+)/i);
      const oran = oranMatch ? parseInt(oranMatch[1], 10) : 20;
      const matrah = matrahMatch ? parseAmount(matrahMatch[1]) : null;
      return [{
        oran: [1, 10, 20].includes(oran) ? oran : 20,
        tutar: kdvOnlyAmount,
        matrah: matrah && matrah > 0 ? matrah : null,
      }];
    }

    return [{ oran: 20, tutar: kdvOnlyAmount, matrah: null }];
  };

  // ─── Filename match → belge no cross-check skip ───
  let skipBelgeNoCheck = false;
  if (belgeNoFromFilename && result.belgeNo) {
    const fn = belgeNoFromFilename.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const ocr = result.belgeNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const exactMatch = fn === ocr && fn.length >= 4;
    const nearMatch = fn.length >= 10 && eBelgeNoDistance(fn, ocr) <= 3;
    if (exactMatch || nearMatch) {
      skipBelgeNoCheck = true;
      if (nearMatch && !exactMatch) {
        logger.warn(
          `Belge no Levenshtein override: OCR="${ocr}" → filename="${fn}" (edit distance ≤ 2, ${originalName})`,
        );
        result.belgeNo = belgeNoFromFilename;
      }
      if (result.fieldConfidence.belgeNo != null) {
        result.fieldConfidence.belgeNo = Math.max(
          result.fieldConfidence.belgeNo ?? 0,
          0.95,
        );
      } else {
        result.fieldConfidence.belgeNo = 0.95;
      }
    }
  }

  // ─── E-fatura/E-arsiv trust guard ───
  if (!skipBelgeNoCheck && result.belgeNo && result.fieldConfidence.belgeNo != null) {
    const bn = result.belgeNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isValidEFaturaFormat = /^[A-Z]{3}\d{13}$/.test(bn);
    const claudeBelgeNoConf = result.fieldConfidence.belgeNo ?? 0;
    if ((isValidEFaturaFormat || E_BELGE_NO_REGEX.test(bn)) && claudeBelgeNoConf >= 0.85) {
      logger.log(
        `E-fatura trust guard: belge no "${bn}" geçerli format + Claude conf ${Math.round(claudeBelgeNoConf * 100)}% → cross-check skip (${originalName})`,
      );
      skipBelgeNoCheck = true;
    }
  }

  // ─── Z RAPORU auto-correct ───
  if (result.belgeTipi === 'Z_RAPORU') {
    const zParsed = extractZRaporuKdvFromAzure(azureText);
    if (zParsed.kdvTutari) {
      const claudeKdv = result.kdvTutari ? parseAmount(result.kdvTutari) : 0;
      const azureKdv = parseAmount(zParsed.kdvTutari);
      if (Math.abs(claudeKdv - azureKdv) > 0.05) {
        logger.warn(
          `Z_RAPORU KDV auto-correct: Claude=${result.kdvTutari} → Azure=${zParsed.kdvTutari} (${originalName})`,
        );
        result.kdvTutari = zParsed.kdvTutari;
        result.fieldConfidence.kdvTutari = 0.92;
        kdvAlreadyVerifiedByAutoFill.value = true;
      } else {
        result.fieldConfidence.kdvTutari = Math.max(
          result.fieldConfidence.kdvTutari ?? 0,
          0.95,
        );
        kdvAlreadyVerifiedByAutoFill.value = true;
      }
    }
    if (zParsed.breakdown.length > 0) {
      const claudeBreakdownCount = result.kdvBreakdown?.length || 0;
      if (claudeBreakdownCount === 0 || claudeBreakdownCount !== zParsed.breakdown.length) {
        logger.warn(
          `Z_RAPORU breakdown auto-fill: Claude=${claudeBreakdownCount} oran → Azure=${zParsed.breakdown.length} oran (${originalName})`,
        );
        result.kdvBreakdown = zParsed.breakdown;
      }
    }
  }

  // ─── TEVKIFATLI FATURA auto-correct ───
  const azureTextNorm = normalizeAzureText(azureText);
  const azureMentionsTevkifat = /TEVK[İI]FAT/i.test(azureTextNorm);
  let tevkifatExtracted = false;
  {
    const tevkifatli = extractTevkifatliFaturaFromAzure(azureText);
    if (tevkifatli) {
      tevkifatExtracted = true;
      const claudeKdv = result.kdvTutari ? parseAmount(result.kdvTutari) : 0;
      const claudeTevkifat = result.kdvTevkifat ? parseAmount(result.kdvTevkifat) : 0;
      const azureNet = tevkifatli.netKdv;
      const azureTevkifat = tevkifatli.tevkifat;

      const tevkifatMissing = claudeTevkifat === 0 && azureTevkifat > 0;
      const kdvMismatch = Math.abs(claudeKdv - azureNet) > 0.05;

      if (tevkifatMissing || kdvMismatch) {
        logger.warn(
          `Tevkifatlı fatura auto-correct: Claude kdv=${result.kdvTutari} tevk=${result.kdvTevkifat ?? '0'} → Azure tamKdv=${formatAmount(tevkifatli.tamKdv)} tevk=${formatAmount(azureTevkifat)} net=${formatAmount(azureNet)} (${originalName})`,
        );
        result.kdvTutari = formatAmount(azureNet);
        result.kdvTevkifat = formatAmount(azureTevkifat);
        result.fieldConfidence.kdvTutari = 0.92;
        if (result.kdvBreakdown && result.kdvBreakdown.length === 1) {
          result.kdvBreakdown[0].tutar = azureNet;
        } else if (!result.kdvBreakdown || result.kdvBreakdown.length === 0) {
          const oranMatch = azureTextNorm.match(
            /HESAPLANAN\s+KDV\s*\(\s*[%/]?\s*(\d{1,2})\s*\)(?!\s*TEVK)/i,
          );
          if (oranMatch) {
            const oran = parseInt(oranMatch[1], 10);
            if ([1, 10, 20].includes(oran)) {
              result.kdvBreakdown = [{ oran, tutar: azureNet, matrah: null }];
            }
          }
        }
        kdvAlreadyVerifiedByAutoFill.value = true;
      }
    }
  }

  // ─── DEFANSIF FALLBACK: Tevkifat var ama extract edilemediyse ───
  if (azureMentionsTevkifat && !tevkifatExtracted && result.kdvTutari) {
    const claudeKdv = parseAmount(result.kdvTutari);
    const claudeTotal = result.totalTutari ? parseAmount(result.totalTutari) : 0;

    let suspiciousMath = false;
    if (claudeTotal > 0 && claudeKdv > 0) {
      const ratio11 = Math.abs(claudeKdv - claudeTotal / 11) / claudeKdv;
      const ratio6 = Math.abs(claudeKdv - claudeTotal / 6) / claudeKdv;
      if (ratio11 < 0.02 || ratio6 < 0.02) {
        suspiciousMath = true;
      }
    }

    const tevkifatEmpty = !result.kdvTevkifat || parseAmount(result.kdvTevkifat) === 0;

    if (suspiciousMath || tevkifatEmpty) {
      logger.warn(
        `Tevkifatlı fatura DEFANSİF FALLBACK (${originalName}): Azure'da TEVKIFAT var ama extract edemedik. Claude kdv=${result.kdvTutari} total=${result.totalTutari} tevk=${result.kdvTevkifat ?? '0'}. Confidence sıfırlanıp NEEDS_REVIEW'a gidiyor.`,
      );
      result.fieldConfidence.kdvTutari = 0.3;
      if (suspiciousMath) {
        result.kdvTutari = null;
        result.kdvBreakdown = null;
      }
    }
  }

  // ─── TELEKOM faturasi KDV-only override ───
  const normalizedAzureText = foldTurkishAscii(azureText);
  const isTelekomFatura =
    /TURK\s*TELEKOM|TTNET|TURKCELL|VODAFONE|[O?]ZEL\s*[I?]LET[I?]S[I?]M|OIV\b|TELSIZ\s*KULLAN/i
      .test(normalizedAzureText);
  let telekomKdvLocked = false;
  if (isTelekomFatura) {
    const kdvOnlyAmount = extractKdvOnlyFromTelekomAzure(azureText);
    if (kdvOnlyAmount != null && kdvOnlyAmount > 0) {
      if (isLikelyRateEcho(kdvOnlyAmount)) {
        logger.warn(
          `Telekom KDV override iptal: ${kdvOnlyAmount} salt KDV orani gibi gorunuyor (rate echo, ${originalName})`,
        );
      } else {
        const claudeKdv = result.kdvTutari ? parseAmount(result.kdvTutari) : 0;
        const breakdownSum = result.kdvBreakdown?.reduce((s, b) => s + (Number(b.tutar) || 0), 0) ?? 0;
        const breakdownHasNonKdvTelekomRate = (result.kdvBreakdown || []).some((b) =>
          ![1, 10, 20].includes(Number(b.oran)) ||
          Math.abs(Number(b.tutar) - kdvOnlyAmount) > 0.05,
        );
        if (
          Math.abs(claudeKdv - kdvOnlyAmount) > 0.05 ||
          Math.abs(breakdownSum - kdvOnlyAmount) > 0.05 ||
          breakdownHasNonKdvTelekomRate
        ) {
          logger.warn(
            `Telekom fatura KDV override: Claude=${result.kdvTutari} breakdown=${JSON.stringify(result.kdvBreakdown || [])} -> Azure KDV-only=${formatAmount(kdvOnlyAmount)} (${originalName})`,
          );
        } else {
          logger.log(
            `Telekom fatura KDV-only dogrulandi: ${formatAmount(kdvOnlyAmount)} (${originalName})`,
          );
        }
        result.kdvTutari = formatAmount(kdvOnlyAmount);
        result.fieldConfidence.kdvTutari = 0.95;
        result.kdvBreakdown = buildTelekomKdvBreakdown(kdvOnlyAmount);
        kdvAlreadyVerifiedByAutoFill.value = true;
        telekomKdvLocked = true;
      }
    }
  }

  // ─── ACIK KDV satiri override (extractKdvFromInvoiceTotals) ───
  const invoiceTotalsKdv = azureMentionsTevkifat || telekomKdvLocked
    ? null
    : extractKdvFromInvoiceTotalsAzure(azureText);
  if (invoiceTotalsKdv && invoiceTotalsKdv.kdv > 0) {
    if (isLikelyRateEcho(invoiceTotalsKdv.kdv)) {
      logger.warn(
        `Acik KDV satiri override iptal: ${invoiceTotalsKdv.kdv} salt KDV orani gibi gorunuyor (rate echo - "%20" tutar sanildi, ${originalName})`,
      );
    } else {
      const claudeKdv = result.kdvTutari ? parseAmount(result.kdvTutari) : 0;
      const diff = Math.abs(claudeKdv - invoiceTotalsKdv.kdv);
      if (diff > 0.05) {
        logger.warn(
          `Açık KDV satırı override: Claude=${result.kdvTutari} → Azure=${formatAmount(invoiceTotalsKdv.kdv)} (${originalName})`,
        );
        result.kdvTutari = formatAmount(invoiceTotalsKdv.kdv);
        result.fieldConfidence.kdvTutari = 0.92;
        result.kdvBreakdown = [{
          oran: invoiceTotalsKdv.oran && invoiceTotalsKdv.oran > 0 ? invoiceTotalsKdv.oran : 20,
          tutar: invoiceTotalsKdv.kdv,
          matrah: invoiceTotalsKdv.matrah,
        }];
        kdvAlreadyVerifiedByAutoFill.value = true;
      } else if (diff <= 0.05 && result.fieldConfidence.kdvTutari != null) {
        result.fieldConfidence.kdvTutari = Math.max(result.fieldConfidence.kdvTutari, 0.92);
      }
    }
  }

  // ─── E-FATURA / E-ARSIV COK ORANLI KDV auto-fill ───
  if (telekomKdvLocked || (isTelekomFatura && kdvAlreadyVerifiedByAutoFill.value)) {
    logger.log(
      `Multi-rate auto-fill SKIP: telekom KDV-only kilidi aktif (${originalName})`,
    );
  } else if (kdvAlreadyVerifiedByAutoFill.value && azureMentionsTevkifat) {
    logger.log(
      `Multi-rate auto-fill SKIP: tevkifatlı fatura (auto-correct çalıştı, ${originalName})`,
    );
  } else {
    const hesMatrah = extractHesMatrahKdvTable(azureText);
    const multiA = extractMultiRateKdvFromAzure(azureText);
    const multiB = extractMultiRateKdvFromItemRows(azureText);
    let azureBreakdown =
      hesMatrah.breakdown.length >= 2 ? hesMatrah.breakdown :
      multiA.length >= 2 ? multiA :
      multiB.length >= 2 ? multiB :
      multiA;
    if (hesMatrah.totalKdv !== null && hesMatrah.totalKdv > 0) {
      if (isLikelyRateEcho(hesMatrah.totalKdv)) {
        logger.warn(
          `Hes. Matrah KDV override iptal: ${hesMatrah.totalKdv} salt KDV orani gibi gorunuyor (rate echo, ${originalName})`,
        );
      } else {
        result.kdvTutari = hesMatrah.totalKdv.toFixed(2);
        logger.log(
          `Hes. Matrah / KDV Toplam tablosundan KDV override: ${hesMatrah.totalKdv.toFixed(2)} (${originalName})`,
        );
      }
    }

    const claudeBreakdownCount = result.kdvBreakdown?.length || 0;
    const mentionsKdvOran =
      /HESAPLANAN\s+K\.?\s*D\.?\s*V\.?|%\s*\d{1,2}/i.test(
        normalizeAzureText(azureText),
      );
    if (azureBreakdown.length < 2 && claudeBreakdownCount < 2 && mentionsKdvOran) {
      const snippet = (azureText || '').slice(0, 1500).replace(/\s+/g, ' ');
      logger.warn(
        `Multi-rate DEBUG (${originalName}): Claude=${claudeBreakdownCount} A=${multiA.length} B=${multiB.length} | azure[0..1500]="${snippet}"`,
      );
    } else if (multiB.length >= 2 && multiA.length < 2) {
      logger.log(
        `Multi-rate item-row fallback devreye girdi: ${multiB.length} oran (${originalName})`,
      );
    }

    if (azureBreakdown.length >= 2) {
      const rateEchoCount = azureBreakdown.filter((b) =>
        [1, 10, 20].some((r) => Math.abs((Number(b.tutar) || 0) - r) < 0.01),
      ).length;
      const looksLikeRatesAsAmounts =
        rateEchoCount >= Math.ceil(azureBreakdown.length * 0.6);
      if (looksLikeRatesAsAmounts) {
        logger.warn(
          `Multi-rate breakdown reddedildi: KDV tutarlari oran gibi gorunuyor (${azureBreakdown.map((b) => `%${b.oran}:${formatAmount(b.tutar)}`).join(', ')}, ${originalName})`,
        );
        result.kdvTutari = null;
        result.kdvBreakdown = null;
        result.fieldConfidence.kdvTutari = null;
        kdvAlreadyVerifiedByAutoFill.value = false;
      } else {
        logger.warn(
          `E-fatura breakdown auto-fill: Claude=${claudeBreakdownCount} oran → Azure=${azureBreakdown.length} oran (${originalName})`,
        );
        result.kdvBreakdown = azureBreakdown;
        const sum = azureBreakdown.reduce((s, b) => s + b.tutar, 0);
        const claudeTotal = result.kdvTutari ? parseAmount(result.kdvTutari) : 0;
        if (!result.kdvTutari || claudeTotal <= 0) {
          logger.warn(
            `E-fatura KDV toplamı Azure açık KDV satırlarından dolduruldu: ${formatAmount(sum)} (${originalName})`,
          );
          result.kdvTutari = formatAmount(sum);
        } else if (Math.abs(sum - claudeTotal) > 0.05) {
          logger.warn(
            `E-fatura ana KDV tek oran kalmis: ana=${result.kdvTutari} breakdown toplam=${formatAmount(sum)} (${originalName}) - ana KDV breakdown toplamiyla duzeltildi`,
          );
          result.kdvTutari = formatAmount(sum);
          result.fieldConfidence.kdvTutari = Math.max(
            result.fieldConfidence.kdvTutari ?? 0,
            0.92,
          );
        } else {
          result.fieldConfidence.kdvTutari = Math.max(
            result.fieldConfidence.kdvTutari ?? 0,
            0.92,
          );
        }
        kdvAlreadyVerifiedByAutoFill.value = true;
      }
    }
  }

  // ─── Generic field cross-check ───
  const checks: { field: 'belgeNo' | 'date' | 'amount'; value: string | null; key: 'belgeNo' | 'date' | 'kdvTutari' }[] = [
    { field: 'belgeNo', value: result.belgeNo, key: 'belgeNo' },
    { field: 'date', value: result.date, key: 'date' },
    { field: 'amount', value: result.kdvTutari, key: 'kdvTutari' },
  ];

  let matched = 0;
  let mismatched = 0;
  const mismatches: string[] = [];

  for (const c of checks) {
    if (!c.value) continue;
    if (c.key === 'belgeNo' && skipBelgeNoCheck) {
      matched++;
      continue;
    }
    if (c.key === 'kdvTutari' && kdvAlreadyVerifiedByAutoFill.value) {
      matched++;
      continue;
    }
    if (
      c.key === 'kdvTutari' &&
      (result.belgeTipi === 'Z_RAPORU' || result.belgeTipi === 'OKC_FIS')
    ) {
      matched++;
      continue;
    }
    const found = isFieldInAzureText(c.value, c.field, azureText);
    if (found) {
      matched++;
      if (result.fieldConfidence[c.key] != null) {
        result.fieldConfidence[c.key] = Math.max(
          result.fieldConfidence[c.key] ?? 0,
          0.9,
        );
      }
    } else {
      mismatched++;
      mismatches.push(`${c.key}=${c.value}`);
      logger.warn(
        `Cross-check FAIL: ${c.key}="${c.value}" Azure metninde yok (${originalName})`,
      );
      const isShortBelgeNo =
        c.key === 'belgeNo' &&
        c.value.replace(/[^A-Z0-9]/gi, '').length <= 3;
      result.fieldConfidence[c.key] = isShortBelgeNo ? 0.6 : 0.2;
    }
  }

  // Genel confidence yeniden hesabi
  const scores = [
    result.fieldConfidence.belgeNo,
    result.fieldConfidence.date,
    result.fieldConfidence.kdvTutari,
  ].filter((v): v is number => typeof v === 'number');
  if (scores.length > 0) {
    result.confidence = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  logger.log(
    `Cross-check: ${matched}/${matched + mismatched} eşleşti ` +
      (mismatches.length > 0 ? `· mismatch: [${mismatches.join(', ')}]` : ''),
  );
}
