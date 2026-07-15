/**
 * Azure OCR - Genel yardimcilar.
 *
 * Text normalization + amount extraction + belge tipi tespit + tevkifat inference.
 *
 * Public API (Faz 2B son toparlama):
 *   normalizeAzureText(text)                      - NBSP/figure-space normalize, tr-TR uppercase
 *   stripMatrahFragments(text)                    - "(MATRAH 100,00)" parantezlerini sil
 *   foldTurkishAscii(text)                        - Turkce karakterleri ASCII'ye katla (normalize sonra)
 *   detectBelgeTipi(text, originalName)           - FIS/Z RAPORU/EFATURA/EARSIV tipini cikar
 *   extractMoneyAmounts(text, parseAmount)        - Metinden tum para tutarlarini cikar (deduped)
 *   inferTevkifatFromAzureAmounts(text, tamKdv, deps) - tevkifat tutarini metin desenlerinden cikar
 *
 * Bu modul `this` kullanmaz. normalizeAzureText/stripMatrahFragments/foldTurkishAscii/detectBelgeTipi
 * tamamen saf. extractMoneyAmounts ve inferTevkifat parseAmount callback'i alir.
 */

type FoldFn = (s: string) => string;

/**
 * Turkiye'de GECERLI KDV oranlari. Guncel: %0, %1, %10, %20; eski/gecis: %8, %18.
 * Bunlarin DISINDA bir oran ( or. %23, %26) KDV orani DEGILDIR — cogu zaman
 * fatura kalemindeki "Iskonto Orani" sutunu KDV orani sanildiginda ortaya cikar
 * (gercek vaka: OZH2026000003080 tevkifatli alis — %23/%26 iskonto oranlari KDV
 * kirilimina girip tam KDV'yi 3.647,46 yerine 6.297,05'e sisirdi). breakdown'a
 * yalniz bu set icindeki oranlar alinir.
 */
export const VALID_KDV_RATES = [1, 8, 10, 18, 20];
export function isValidKdvRate(oran: number): boolean {
  return VALID_KDV_RATES.includes(oran);
}

/** NBSP, figure-space, narrow no-break, full-width % normalize + tr-TR uppercase. */
export function normalizeAzureText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\u00A0/g, ' ') // NBSP
    .replace(/\u2007/g, ' ') // figure space
    .replace(/\u202F/g, ' ') // narrow no-break space
    .replace(/\uFF05/g, '%') // full-width %
    .toLocaleUpperCase('tr-TR');
}

/** "(MATRAH 100,00)" / "MATRAH: 100,00" parantezlerini metinden temizler. */
export function stripMatrahFragments(text: string): string {
  if (!text) return '';
  return text
    .replace(/\([^)]*MATRAH[^)]*\)/gi, ' ')
    .replace(/\b(?:KDV\s*)?MATRAH[Iİıi]?\s*[:=]?\s*[-\d.,]+\s*(?:TL|TRY|[^\s\d.,])?/gi, ' ')
    .replace(/\bMATRAH\s*[:=]?\s*[-\d.,]+\s*(?:TL|TRY|₺)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Turkce karakterleri ASCII'ye katlar (Azure normalize sonra). */
export function foldTurkishAscii(text: string): string {
  return normalizeAzureText(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ş/g, 'S')
    .replace(/İ/g, 'I')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C');
}

/**
 * Belge tipini tespit eder. OCR ham metni + opsiyonel dosya adi.
 * Sirayla bakar: OKC_FIS > Z_RAPORU > EARSIV > EFATURA > (fallback) OKC_FIS.
 * Hicbirine uymazsa null.
 */
export function detectBelgeTipi(text: string, originalName?: string): string | null {
  const folded = foldTurkishAscii(`${originalName || ''}\n${text || ''}`);
  // GÜÇLÜ e-belge sinyali ("EARSIVFATURA"/"e-Arşiv Fatura"/"TEMEL/TİCARİ FATURA")
  // bir Z raporunda veya yazarkasa fişinde BULUNMAZ. e-Arşiv faturasının notlarında
  // mağazanın "Gün Sonu No"/"Fiş No" bilgisi geçebildiğinden, bu güçlü sinyaller
  // OKC/Z_RAPORU sınıflamasından ÖNCE değerlendirilir — yoksa e-Arşiv yanlışlıkla
  // Z_RAPORU sayılıp KDV kırılımı (ör. %20 oranı) eksik okunuyordu.
  if (/\bEARSIVFATURA\b|\bE[-\s]?AR[SŞ]IV\s*FATURA\b/.test(folded)) return 'EARSIV';
  if (/\bTEMELFATURA\b|\bTICARIFATURA\b/.test(folded)) return 'EFATURA';
  const looksOkcFis = /\bFIS\s*NO\b|\bEKU\s*NO\b|\bOKC\b|\bOD[EA]ME\s+KAYDEDICI\b/.test(folded);
  // Z raporu imzalari — yazarkasa fisinde BULUNMAZ:
  //   "Z (GUNLUK) RAPORU", "GUN SONU", "Z SAYAC", kumulatif "KUM TOP/KDV".
  //   Onemli: "Z GUNLUK RAPORU"nda araya GUNLUK girdigi icin "Z RAPORU"
  //   birebir eslesmesi yetmez; ayrica "KUM TOPLAM" yerine "KUM TOP" kisaltmasi
  //   da kullanilir. Bu fisler "FIS NO"/"EKU NO" tasisa bile Z raporudur.
  const explicitZRapor =
    /\bZ\s*(?:G[UÜ]N\w*\s*)?RAPORU?\b/.test(folded) ||
    /\bG[UÜ]N\s*SONU\b/.test(folded) ||
    /\bZ\s*SAYAC\b/.test(folded) ||
    /\bKUM\s*(?:T[O0]P|KDV|[UÜ]LAT[I1]F)/.test(folded) ||
    /\bKUM\s+T[O0]PLAM\b/.test(folded);
  if (looksOkcFis && !explicitZRapor) return 'OKC_FIS';
  // "TOPKDV" OCR varyantlarına toleranslı (ilk harf T↔1↔I↔7, D↔O↔0, V↔U↔Y):
  // "TOPKOV"/"1OPKDV" gibi bozuk okumalarda da yazarkasa fişi sınıflanabilsin.
  if (explicitZRapor || /\b[T1I7][O0]\s*P\s*K\s*[D0O]\s*[VUY]\b/.test(folded)) return 'Z_RAPORU';
  if (/\bE[-\s]?ARSIV\b|\bEARSIVFATURA\b/.test(folded)) return 'EARSIV';
  if (/\bE[-\s]?FATURA\b|\bTEMELFATURA\b|\bTICARIFATURA\b/.test(folded)) return 'EFATURA';
  if (looksOkcFis) return 'OKC_FIS';
  return null;
}

/**
 * Metinden tum para tutarlarini cikarir (deduped, geçerli aralikta).
 * Format: "1.330,00" / "665,00" / "28.400,00"
 * Filtreler: 0 < value < 100_000_000, key=value.toFixed(2) ile dedupe.
 */
export function extractMoneyAmounts(text: string, parseAmount: (s: string) => number): number[] {
  const amountRe = /(\d{1,3}(?:[.,]\d{3})+[.,]\d{1,2}|\d{4,},\d{1,2}|\d{1,3},\d{1,2})\s*(?:TL|TRY|₺)?/gi;
  const values: number[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(amountRe)) {
    const value = Math.round(parseAmount(m[1]) * 100) / 100;
    if (value <= 0 || value >= 100_000_000) continue;
    const key = value.toFixed(2);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values;
}

export interface InferTevkifatDeps {
  parseAmount: (s: string) => number;
  formatAmount: (n: number) => string;
  foldTurkishAscii: FoldFn;
  parseTevkifatRate: (text: string) => number;
  logger: {
    log: (message: string) => void;
    warn: (message: string) => void;
  };
}

/**
 * Tevkifat tutarini Azure OCR metni icinden cikarsama yontemiyle bulur.
 * 4 strateji:
 *   1) TEVKIFAT gecen satirda hemen yanindaki tutar
 *   2) Tevkifat orani okunuyorsa tamKdv * oran / 100
 *   3) "Vergiler dahil toplam" - "Odenecek tutar" farki
 *   4) tamKdv / 2 (cogu fatura %50 tevkifat)
 *
 * Onceki adimda: KDV adayi yanlislikla "matrah" olduysa, KDV orani ile expected tax'i hesaplar
 * ve amounts listesinde bulduysa effectiveTamKdv'yi duzeltir.
 */
export function inferTevkifatFromAzureAmounts(
  text: string,
  tamKdv: number,
  deps: InferTevkifatDeps,
): { tamKdv: number; tevkifat: number; netKdv: number } | null {
  const { parseAmount, formatAmount, foldTurkishAscii: foldFn, parseTevkifatRate, logger } = deps;

  if (!text || !(tamKdv > 0)) return null;
  const folded = foldFn(text);
  if (!/TEVK/.test(folded)) return null;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const isClose = (a: number, b: number, tolerance = 0.05) => Math.abs(a - b) <= tolerance;
  const amounts = extractMoneyAmounts(folded, parseAmount);
  let effectiveTamKdv = round2(tamKdv);
  const kdvRateMatch = folded.match(
    /HESAPLANAN\s+K\.?\s*D\.?\s*V\.?(?!\s*TEVK)[^\d%]{0,20}\(\s*%?\s*(\d{1,2})(?:[.,]\d+)?\s*\)/,
  );
  const kdvRate = kdvRateMatch ? Number(kdvRateMatch[1]) : 0;
  if ([1, 10, 20].includes(kdvRate)) {
    const expectedTax = round2(effectiveTamKdv * kdvRate / 100);
    const taxAmount = amounts.find((n) =>
      n > 0 &&
      n < effectiveTamKdv - 0.05 &&
      isClose(n, expectedTax, Math.max(0.05, expectedTax * 0.01)),
    );
    if (taxAmount) {
      logger.warn(
        `Tevkifat fallback: gelen KDV adayi matrah gibi gorundu, tam KDV ${formatAmount(taxAmount)} olarak duzeltildi (matrah=${formatAmount(effectiveTamKdv)}, oran=%${kdvRate})`,
      );
      effectiveTamKdv = round2(taxAmount);
    }
  }
  const validTevkifat = (n: number) => n > 0 && n < effectiveTamKdv - 0.05;
  const lines = folded.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const accept = (candidate: number | null | undefined, reason: string) => {
    const tevkifat = round2(candidate || 0);
    if (!validTevkifat(tevkifat)) return null;
    const netKdv = round2(effectiveTamKdv - tevkifat);
    if (netKdv <= 0) return null;
    logger.log(`Tevkifat fallback OK (${reason}): tam=${effectiveTamKdv} tevkifat=${tevkifat} net=${netKdv}`);
    return { tamKdv: effectiveTamKdv, tevkifat, netKdv };
  };

  // 1) TEVKIFAT geçen satırda hemen yanindaki tutar
  for (let i = 0; i < lines.length; i++) {
    if (!/TEVK/.test(lines[i])) continue;
    const window = [lines[i], lines[i + 1] || '', lines[i + 2] || ''].join(' ');
    const candidates = extractMoneyAmounts(window, parseAmount)
      .filter(validTevkifat)
      .sort((a, b) => b - a);
    if (candidates.length > 0) {
      return accept(candidates[0], 'tevkifat-satiri');
    }
  }

  // 2) Tevkifat orani okunuyorsa tamKdv * oran
  const rate = parseTevkifatRate(folded);
  if (rate > 0 && rate <= 100) {
    const expected = round2(effectiveTamKdv * rate / 100);
    const explicit = amounts.find((n) => validTevkifat(n) && isClose(n, expected, Math.max(0.05, expected * 0.01)));
    return accept(explicit ?? expected, `oran-%${rate}`);
  }

  // 3) "Vergiler dahil toplam" - "Odenecek tutar" farki
  const hasTotalsLabels = /VERGILER\s+DAHIL/.test(folded) && /ODENECEK\s+TUTAR/.test(folded);
  if (hasTotalsLabels && amounts.length >= 2) {
    for (const high of amounts) {
      for (const low of amounts) {
        const diff = round2(high - low);
        if (!validTevkifat(diff)) continue;
        if (amounts.some((n) => isClose(n, diff))) {
          return accept(diff, 'toplam-farki');
        }
      }
    }
  }

  // 4) Son savunma: tamKdv / 2 (%50 tevkifat tipik)
  const half = round2(effectiveTamKdv / 2);
  const halfMatch = amounts.find((n) => validTevkifat(n) && isClose(n, half, Math.max(0.05, half * 0.01)));
  return accept(halfMatch, 'yarim-kdv');
}
