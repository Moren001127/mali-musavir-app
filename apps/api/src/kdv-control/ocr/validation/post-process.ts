/**
 * OCR Post-Process + Validation Pipeline.
 *
 * Claude/Azure OCR sonucu uzerinde son rotuslari atar:
 *   - Belge no temizleme/filename override/format kontrol
 *   - Tarih dogrulama (DD.MM.YYYY, yil 2020-2050)
 *   - Tutar normalize (TL/USD/EUR/bosluk temizleme)
 *   - KDV breakdown tutarli mi (matrah × oran ≈ tutar)
 *   - KDV/Toplam orani makul mu (%0.5-%35)
 *
 * Validation skoru ile NEEDS_REVIEW karari verir.
 *
 * Public API (Faz 4C):
 *   postProcessOcrResult(result, belgeNoFromFilename, originalName, deps)
 *   validateOcrResult(result, originalName, deps)
 *
 * Bu modul `this` kullanmaz; bagimliliklari `deps` ile alir.
 */

import type { OcrResult } from '../types';

// E-belge no biçimleri. GİB 3 karakterlik öneki HARF veya RAKAM olabilir:
// "EFA2026...", "GIB2026...", AMA "12A2026..." gibi RAKAMLA başlayan da geçerlidir.
// [A-Z0-9]{3}20\d{2}\d{6,12} bu genel biçimi kapsar; eski alternatifler korunur.
const E_BELGE_NO_REGEX = /^(?:[A-Z]{2,4}\d{12,14}|[A-Z]\d{2}20\d{2}\d{6,12}|[A-Z0-9]{3}20\d{2}\d{6,12}|\d{13,20})$/;

export interface PostProcessDeps {
  parseAmount: (s: string) => number;
  formatIsoToTr: (iso?: string | null) => string | null;
  eBelgeNoDistance: (a: string, b: string) => number;
  extractDateFromText: (text: string) => string | null;
  logger: {
    log: (message: string) => void;
    warn: (message: string) => void;
  };
}

export interface ValidateDeps {
  parseAmount: (s: string) => number;
  formatAmount: (n: number) => string;
  logger: {
    log: (message: string) => void;
    warn: (message: string) => void;
  };
}

/**
 * Claude/Azure'dan gelen OcrResult'u doctor eder:
 *   1) Belge no yasak deger temizleme (TR1.2, UBL, UUID)
 *   2) Filename override (eksik/yanlis OCR icin)
 *   3) Z_RAPORU ozel filename override
 *   4) Belge no format kontrol (EFATURA/EARSIV: ≥13 char)
 *   5) Tarih rawText fallback + DD.MM.YYYY normalize + yil 2020-2050
 *   6) Tutar normalize (TL/USD/EUR/bosluk)
 *   7) KDV breakdown toplam tutarli mi
 *   8) Matrah × oran ≈ tutar capraz dogrulama
 *   9) KDV/Toplam orani makul mu (%0.5-%35)
 *
 * Result objesi mutate edilir.
 */
export function postProcessOcrResult(
  result: OcrResult,
  belgeNoFromFilename: string | null,
  originalName: string | undefined,
  deps: PostProcessDeps,
): void {
  const { parseAmount, formatIsoToTr, eBelgeNoDistance, extractDateFromText, logger } = deps;

  // ─── 1. BELGE NO — Yasak değerleri temizle ───
  if (result.belgeNo) {
    const cleaned = result.belgeNo.trim().toUpperCase();
    const forbidden = [
      /^TR[\d.\-_]+$/,
      /^UBL[\d.\-_]*$/,
      /^(TEMELFATURA|TICARIFATURA|EARSIVFATURA)$/,
      /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i,
    ];
    if (forbidden.some((p) => p.test(cleaned))) {
      logger.warn(`OCR yasak belge no değeri: "${cleaned}" → null (${originalName})`);
      result.belgeNo = null;
      if (result.fieldConfidence) result.fieldConfidence.belgeNo = null;
    }
  }

  // ─── 2. BELGE NO — Filename override ───
  if (belgeNoFromFilename) {
    const fnClean = belgeNoFromFilename.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const ocrClean = (result.belgeNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const fnLooksLikeOkcNo = /^\d{1,6}$/.test(fnClean);
    const ocrLooksLikeOkcNo = !ocrClean || /^\d{1,8}$/.test(ocrClean);
    if (result.belgeTipi === 'OKC_FIS' && fnLooksLikeOkcNo && ocrLooksLikeOkcNo && fnClean !== ocrClean) {
      logger.warn(`OKC belge no filename override: "${ocrClean}" -> "${fnClean}" (${originalName})`);
      result.belgeNo = belgeNoFromFilename;
      if (result.fieldConfidence) result.fieldConfidence.belgeNo = 0.95;
    }

    const editDist =
      fnClean.length >= 10 && ocrClean.length >= 10
        ? eBelgeNoDistance(fnClean, ocrClean)
        : Infinity;
    const filenameMatchesOcr =
      fnClean.length >= 10 &&
      (fnClean === ocrClean || editDist <= 2);
    const fnLooksLikeEInvoice = E_BELGE_NO_REGEX.test(fnClean);
    const lowBelgeNoConfidence = (result.fieldConfidence?.belgeNo ?? 0) < 0.85;
    const shouldOverride =
      !ocrClean ||
      (ocrClean.length < 10 && fnClean.length >= 10) ||
      (fnClean.length > ocrClean.length && fnClean.startsWith(ocrClean.slice(0, 3))) ||
      (fnClean.length >= 10 && editDist <= 2) ||
      (fnLooksLikeEInvoice && lowBelgeNoConfidence && editDist <= 4);

    if (shouldOverride && fnClean !== ocrClean) {
      logger.warn(
        `Belge no filename override: "${ocrClean}" → "${fnClean}" (editDist=${editDist === Infinity ? 'n/a' : editDist}, ${originalName})`,
      );
      result.belgeNo = belgeNoFromFilename;
      if (result.fieldConfidence) result.fieldConfidence.belgeNo = fnLooksLikeEInvoice ? 0.96 : 0.9;
    }

    if (filenameMatchesOcr && result.fieldConfidence) {
      result.fieldConfidence.belgeNo = Math.max(
        result.fieldConfidence.belgeNo ?? 0,
        fnLooksLikeEInvoice ? 0.96 : 0.9,
      );
    }
  }

  // ─── 2b. Z_RAPORU ozel filename override ───
  if (result.belgeTipi === 'Z_RAPORU' && originalName) {
    const fnBase = originalName.replace(/\.[^/.]+$/, '').trim();
    const zMatch = fnBase.match(/^Z?(\d{1,8})$/i);
    if (zMatch) {
      const zNoFromFilename = zMatch[1];
      const ocrBn = (result.belgeNo || '').replace(/\D/g, '');
      if (ocrBn !== zNoFromFilename) {
        logger.warn(
          `Z_RAPORU filename override: OCR="${result.belgeNo}" → "${zNoFromFilename}" (${originalName})`,
        );
        result.belgeNo = zNoFromFilename;
        if (result.fieldConfidence) result.fieldConfidence.belgeNo = 0.95;
      }
    }
  }

  // ─── 3. BELGE NO — Pattern/uzunluk kontrolu ───
  if (result.belgeNo) {
    const bn = result.belgeNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const tipi = result.belgeTipi;
    if ((tipi === 'EFATURA' || tipi === 'EARSIV') && bn.length < 13) {
      logger.warn(`Belge tipi ${tipi} için belge no kısa (${bn.length} char): ${bn}`);
      if (result.fieldConfidence && (result.fieldConfidence.belgeNo ?? 0) > 0.5) {
        result.fieldConfidence.belgeNo = 0.5;
      }
    }
  }

  // ─── 3b. TARIH — rawText fallback ───
  if (!result.date && result.rawText) {
    const trDate = extractDateFromText(result.rawText);
    if (trDate) {
      logger.warn(
        `Tarih Claude'tan boş geldi, rawText'ten yakalandı: ${trDate} (${originalName})`,
      );
      result.date = trDate;
      if (result.fieldConfidence) result.fieldConfidence.date = 0.7;
    }
  }

  // ─── 4. TARIH — Ay/gun/yil gecerlilik ───
  if (result.date) {
    const m = result.date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) {
      const normalized = formatIsoToTr(result.date);
      if (normalized) {
        result.date = normalized;
      } else {
        logger.warn(`Tarih format bozuk: "${result.date}" (${originalName})`);
        result.date = null;
        if (result.fieldConfidence) result.fieldConfidence.date = 0;
      }
    }

    if (result.date) {
      const m2 = result.date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (m2) {
        const dd = +m2[1], mo = +m2[2], yy = +m2[3];
        if (mo < 1 || mo > 12 || dd < 1 || dd > 31) {
          logger.warn(`Tarih geçersiz: ${result.date}`);
          result.date = null;
          if (result.fieldConfidence) result.fieldConfidence.date = 0;
        } else if (yy < 2000 || yy > 2050) {
          logger.warn(`Yıl makul dışı: ${yy}`);
          if (result.fieldConfidence) {
            result.fieldConfidence.date = Math.min(result.fieldConfidence.date ?? 1, 0.3);
          }
        }
      }
    }
  }

  // ─── 5. TUTAR NORMALIZE — ₺, TL, bosluk temizle ───
  const normalizeAmount = (s: string | null | undefined): string | null => {
    if (!s) return null as any;
    return s
      .replace(/₺|TL|USD|EUR/gi, '')
      .replace(/\s+/g, '')
      .trim() || null;
  };
  result.kdvTutari = normalizeAmount(result.kdvTutari);
  result.totalTutari = normalizeAmount(result.totalTutari);
  if (!result.kdvTutari || parseAmount(result.kdvTutari) <= 0) {
    result.kdvTutari = null;
    if (result.fieldConfidence) result.fieldConfidence.kdvTutari = null;
  }

  // ─── 5b. SALT-RATE GUARD — KDV oran echo'su tutar olarak okunamaz ───
  // BUG FIX (WASH faturasi v1.37.76): Hangi extractor'dan gelirse gelsin, eger
  // kdvTutari salt rakam (0/1/8/10/18/20 — KDV oranlari) ise bu kesinlikle
  // "%20" gibi bir oran echo'sudur, KDV tutari degil. Gerçek KDV tutari her
  // zaman ondaliklidir (824,00 / 1.330,00) — 20 / 10 gibi tam sayi olamaz.
  if (result.kdvTutari) {
    const kdvNum = parseAmount(result.kdvTutari);
    const cleanedKdv = result.kdvTutari.replace(/[^\d,.\-]/g, '').trim();
    const isJustRate = /^(0|1|8|10|18|20)(?:[,.]00?)?$/.test(cleanedKdv);
    if (isJustRate && kdvNum <= 30) {
      logger.warn(
        `KDV salt-rate guard: "${result.kdvTutari}" oran echo'su gibi gorunuyor (KDV oranlari: 0/1/8/10/18/20) — null'a cekildi (${originalName})`,
      );
      result.kdvTutari = null;
      if (result.fieldConfidence) result.fieldConfidence.kdvTutari = null;
      if (result.kdvBreakdown && result.kdvBreakdown.length === 1) {
        const breakdownTutar = Number(result.kdvBreakdown[0].tutar);
        if (Math.abs(breakdownTutar - kdvNum) < 0.01) {
          result.kdvBreakdown = null;
        }
      }
    }
  }

  // ─── 6. KDV BREAKDOWN — Toplam kontrolu ───
  let breakdownInconsistent = false;
  if (result.kdvBreakdown && result.kdvBreakdown.length > 0 && result.kdvTutari) {
    const breakdownSum = result.kdvBreakdown.reduce((s, b) => s + (Number(b.tutar) || 0), 0);
    const declaredTotal = parseAmount(result.kdvTutari);
    const normalizedTevkifat = result.kdvTevkifat ? parseAmount(result.kdvTevkifat) : 0;
    if (normalizedTevkifat > 0 && Math.abs(breakdownSum - declaredTotal) > 0.05) {
      const oran = Number(result.kdvBreakdown.find((b) => Number(b.oran) > 0)?.oran || 0);
      result.kdvBreakdown = [{ oran, tutar: declaredTotal, matrah: null }];
      logger.warn(
        `Tevkifatli fatura breakdown net KDV'ye indirildi: breakdown=${breakdownSum.toFixed(2)} net=${declaredTotal.toFixed(2)}`,
      );
    } else if (Math.abs(breakdownSum - declaredTotal) > 0.05) {
      logger.warn(
        `KDV breakdown tutarsız: breakdown=${breakdownSum.toFixed(2)} vs kdvTutari=${declaredTotal.toFixed(2)} — breakdown toplamını kullan`,
      );
      breakdownInconsistent = true;
      if (result.fieldConfidence) {
        result.fieldConfidence.kdvTutari = Math.min(
          result.fieldConfidence.kdvTutari ?? 0.5,
          0.5,
        );
      }
    }

    // 7. Matrah × oran ≈ tutar capraz dogrulama (ESKIDEN OLU KODDU: expectedNet=actual,
    //    bestDiff=0 → hic tetiklenmiyordu; OCR icindeki matrah/KDV tutarsizligi sessizce
    //    geciyordu). Artik gercek beklenti hesaplanir. OCR matrah'i NET taban da olabilir
    //    BRUT (KDV dahil) da; iki yorumun YAKIN olanini al, sadece BARIZ sapmada bayrakla
    //    (yuvarlama/gurultu tetiklemesin: hem >%5 oransal HEM >1 TL mutlak sart). Bayrak
    //    yalniz confidence dusurur + breakdown'i NEEDS_REVIEW'a tasir — sessiz yanlis kabul YOK.
    for (const b of result.kdvBreakdown!) {
      if (b.matrah && b.oran > 0) {
        const matrah = Number(b.matrah);
        const actual = Number(b.tutar);
        const rate = Number(b.oran);
        const expectedNet = matrah * rate / 100;            // matrah = NET taban
        const expectedBrut = matrah * rate / (100 + rate);  // matrah = BRUT (KDV dahil)
        const bestAbs = Math.min(Math.abs(expectedNet - actual), Math.abs(expectedBrut - actual));
        const bestPct = bestAbs / (actual || 1);
        if (bestPct > 0.05 && bestAbs > 1) {
          logger.warn(
            `KDV %${rate}: matrah=${matrah.toFixed(2)} tutar=${actual.toFixed(2)} · beklenti NET=${expectedNet.toFixed(2)} / BRUT=${expectedBrut.toFixed(2)} (en yakin sapma %${Math.round(bestPct * 100)}) — tutarsiz, confidence dusuruluyor`,
          );
          breakdownInconsistent = true;
        }
      }
    }

    if (breakdownInconsistent) {
      result.kdvBreakdown = null;
      if (result.fieldConfidence) {
        result.fieldConfidence.kdvTutari = Math.min(
          result.fieldConfidence.kdvTutari ?? 0.4,
          0.4,
        );
      }
    }
  }

  // ─── 8. Z_RAPORU breakdown — sadece LOG ───
  if (result.belgeTipi === 'Z_RAPORU' && (!result.kdvBreakdown || result.kdvBreakdown.length === 0)) {
    if (result.kdvTutari) {
      logger.log(
        `Z_RAPORU single-rate varsayımı: kdvTutari=${result.kdvTutari} breakdown yok (${originalName})`,
      );
    }
  }

  // ─── 9. KDV TUTARI — makul aralik kontrolu ───
  if (result.kdvTutari && result.totalTutari) {
    const kdvNum = parseAmount(result.kdvTutari);
    const totalNum = parseAmount(result.totalTutari);
    if (totalNum > 0 && kdvNum > 0) {
      const ratio = kdvNum / totalNum;
      if (ratio > 0.35 || ratio < 0.005) {
        logger.warn(
          `KDV/Toplam oranı şüpheli: kdv=${kdvNum} toplam=${totalNum} oran=%${(ratio * 100).toFixed(1)} (${originalName})`,
        );
        if (result.fieldConfidence) {
          result.fieldConfidence.kdvTutari = Math.min(
            result.fieldConfidence.kdvTutari ?? 0.5,
            0.5,
          );
        }
      }
    }
  }
}

/**
 * OcrResult uzerinde son validation skoru hesaplar (0-1):
 *   1) Breakdown toplami = kdvTutari (±5 kurus VEYA ±%2)
 *   2) Her breakdown satiri: matrah × oran/100 ≈ tutar
 *   3) Gecerli KDV oranlari [0,1,10,20]
 *   4) Tevkifat tutari NET KDV'den 5x fazla degil
 *   5) KDV var ama tum oranlar %0 → uyari
 *   6) Belge no format (tipe gore)
 *   7) Satici VKN/TCKN format (10 veya 11 hane)
 *
 * Sonuc result.validationScore + result.validationIssues alanlarina yazilir.
 * Skor <0.7 ise kdvTutari confidence'i da bu skora cekilir → NEEDS_REVIEW.
 * Skor ≥0.95 + issues yok → confidence boost (en az %92).
 */
export function validateOcrResult(
  result: OcrResult,
  originalName: string | undefined,
  deps: ValidateDeps,
): void {
  const { parseAmount, formatAmount, logger } = deps;

  const issues: string[] = [];
  let score = 1.0;

  const kdvNum = result.kdvTutari ? parseAmount(result.kdvTutari) : 0;
  const tevkifatNum = result.kdvTevkifat ? parseAmount(result.kdvTevkifat) : 0;
  const breakdown = result.kdvBreakdown || [];

  // 1) Breakdown toplami
  if (breakdown.length > 0 && kdvNum > 0) {
    const sum = breakdown.reduce((s, b) => s + (b.tutar || 0), 0);
    const diff = Math.abs(sum - kdvNum);
    const tol = Math.max(0.05, kdvNum * 0.02);
    if (diff > tol) {
      issues.push(
        `Breakdown toplamı KDV ile uyumsuz: ${formatAmount(sum)} ≠ ${formatAmount(kdvNum)} (fark ${formatAmount(diff)})`,
      );
      score -= 0.3;
    }
  }

  // 2) Her satir matrah × oran/100
  for (const b of breakdown) {
    if (!b.matrah || !b.oran || b.oran <= 0) continue;
    const expectedTutar = b.tutar || 0;
    const diff = Math.abs(expectedTutar - (b.tutar || 0));
    const tol = Math.max(0.05, expectedTutar * 0.02);
    if (diff > tol) {
      issues.push(
        `KDV hesabı uyumsuz: %${b.oran} matrah=${formatAmount(b.matrah)} → beklenen=${formatAmount(expectedTutar)}, bulunan=${formatAmount(b.tutar)}`,
      );
      score -= 0.15;
    }
  }

  // 3) Gecerli oranlar
  const validRates = [0, 1, 10, 20];
  for (const b of breakdown) {
    if (b.oran == null) continue;
    const closest = validRates.find((r) => Math.abs(r - b.oran) < 0.5);
    if (!closest && b.oran !== 0) {
      issues.push(`Geçersiz KDV oranı: %${b.oran} (beklenen: ${validRates.join(', ')})`);
      score -= 0.2;
    }
  }

  // 4) Tevkifat mantik
  if (tevkifatNum > 0 && kdvNum > 0 && tevkifatNum > kdvNum * 5) {
    issues.push(
      `Tevkifat tutarı mantıksız: tevkifat=${formatAmount(tevkifatNum)} >> NET KDV=${formatAmount(kdvNum)}`,
    );
    score -= 0.25;
  }

  // 4b) Tevkifat ORANI standart mı? KDV tevkifat oranları yasal SABİTtir
  // (2/10, 3/10, 4/10, 5/10, 7/10, 9/10, 10/10). kdvTutari = NET KDV (tam − tevkifat)
  // olduğundan tam KDV = net + tevkifat; tevkifat/tamKDV mutlaka bu oranlardan biri
  // olmalı. Azure bazı tevkifatlı e-faturalarda tam KDV'yi doğru okuyup tevkifatı
  // YANLIŞ böldü (ör. %50 yerine %27,6) → net KDV şişti, Luca ile eşleşmedi. Oran
  // hiçbir standarda yakın değilse: güveni düşür → NEEDS_REVIEW → Max-vision yeniden-okuma
  // (sessiz yanlış net KABUL EDİLMEZ). Yuvarlama gürültüsü için küçük tutarlar atlanır.
  if (tevkifatNum > 0 && kdvNum > 0) {
    const fullKdv = kdvNum + tevkifatNum;
    if (fullKdv > 50) {
      const impliedRatio = tevkifatNum / fullKdv;
      const STD_TEVKIFAT = [0.2, 0.3, 0.4, 0.5, 0.7, 0.9, 1.0];
      const nearest = STD_TEVKIFAT.reduce((a, b) =>
        Math.abs(b - impliedRatio) < Math.abs(a - impliedRatio) ? b : a,
      );
      if (Math.abs(impliedRatio - nearest) > 0.015) {
        issues.push(
          `Tevkifat oranı standart değil: tevkifat=${formatAmount(tevkifatNum)} / tam KDV=${formatAmount(fullKdv)} = %${(impliedRatio * 100).toFixed(1)} (yasal: 2/10..10/10) — tevkifat/net KDV yanlış okunmuş olabilir`,
        );
        score -= 0.4;
      }
    }
  }

  // 5) KDV var ama oran 0
  if (kdvNum > 0 && breakdown.length > 0) {
    const allZeroRate = breakdown.every((b) => !b.oran || b.oran === 0);
    if (allZeroRate) {
      issues.push('KDV tutarı var ama tüm oranlar %0 — okuma hatası olabilir');
      score -= 0.15;
    }
  }

  // 6) Belge no format
  if (result.belgeNo && result.belgeTipi) {
    const bn = result.belgeNo.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const tipi = String(result.belgeTipi).toUpperCase();

    if (tipi === 'EFATURA' || tipi === 'EARSIV') {
      if (!E_BELGE_NO_REGEX.test(bn)) {
        issues.push(
          `${tipi} belge no formatı uyumsuz: "${result.belgeNo}" (beklenen: e-belge seri + yıl + sıra no, örn. EFA2026000000093)`,
        );
        score -= 0.3;
        if (result.fieldConfidence.belgeNo != null) {
          result.fieldConfidence.belgeNo = Math.max(0, result.fieldConfidence.belgeNo - 0.3);
        }
      } else {
        const yilMatch = bn.match(/^[A-Z]{2,4}(\d{4})/) ?? bn.match(/(20\d{2})/);
        const yil = yilMatch ? parseInt(yilMatch[1], 10) : NaN;
        if (yil < 2020 || yil > 2050) {
          issues.push(`E-fatura belge no'sundaki yıl mantıksız: ${yil} (beklenen: 2020-2050)`);
          score -= 0.15;
        }
      }
    } else if (tipi === 'Z_RAPORU') {
      if (!/^\d{1,6}$/.test(bn)) {
        issues.push(`Z raporu belge no formatı: "${result.belgeNo}" (beklenen 1-6 hane sayı)`);
        score -= 0.2;
      }
    } else if (tipi === 'OKC_FIS') {
      if (!/^\d{1,12}$/.test(bn)) {
        issues.push(`OKC fişi belge no formatı: "${result.belgeNo}" (beklenen sayı)`);
        score -= 0.15;
      }
    }
  }

  // 7) Satici VKN/TCKN format
  if ((result as any).saticiVkn) {
    const vkn = String((result as any).saticiVkn).replace(/\D/g, '');
    if (vkn.length !== 10 && vkn.length !== 11) {
      issues.push(`Satıcı VKN/TCKN format hatası: "${vkn}" (beklenen 10 veya 11 hane)`);
      score -= 0.1;
      (result as any).saticiVkn = null;
    }
  }

  // Skor 0-1
  score = Math.max(0, Math.min(1, score));
  result.validationScore = score;
  result.validationIssues = issues.length > 0 ? issues : undefined;

  if (score < 0.7 && result.fieldConfidence.kdvTutari != null) {
    const oldConf = result.fieldConfidence.kdvTutari;
    const newConf = Math.min(oldConf, score);
    if (newConf < oldConf) {
      result.fieldConfidence.kdvTutari = newConf;
      logger.warn(
        `Validation skoru düşük (${score.toFixed(2)}): ${originalName || ''} · kdv conf %${Math.round(oldConf * 100)} → %${Math.round(newConf * 100)} · sorunlar: ${issues.join('; ')}`,
      );
    }
  } else if (score >= 0.95 && issues.length === 0 && result.fieldConfidence.kdvTutari != null) {
    result.fieldConfidence.kdvTutari = Math.max(result.fieldConfidence.kdvTutari, 0.92);
  }
}
