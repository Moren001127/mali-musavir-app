/**
 * UBL Provider — Turk e-Fatura / e-Arsiv UBL 2.1 XML belgelerinden
 * yapilandirilmis OcrResult uretir.
 *
 * Public API (Faz 2 provider izolasyon):
 *   parseUblXml(xml, deps) - tum UBL pipeline (belge no + tarih + KDV breakdown
 *                            + tevkifat + satici + belge tipi)
 *
 * Bu modul `this` kullanmaz. Bagimliliklarini `deps` objesi ile alir:
 *   - parseAmount, formatAmount, normalizeTaxText: pure string/number helpers
 *   - logger: Nest Logger (log + warn)
 *
 * xml-helpers (decodeXmlText, getXmlBlocks, getXmlTagValue, stripXmlBlocks,
 * parseXmlAmount) dogrudan import edilir; saf modul.
 */

import {
  getXmlBlocks,
  getXmlTagValue,
  parseXmlAmount,
  stripXmlBlocks,
} from '../parsers/xml-helpers';
import type { KdvBreakdownItem, OcrResult } from '../types';

export interface UblParseDeps {
  parseAmount: (s: string) => number;
  formatAmount: (n: number) => string;
  normalizeTaxText: (value: string | null | undefined) => string;
  logger: {
    log: (message: string) => void;
    warn: (message: string) => void;
  };
}

/**
 * UBL e-Fatura / e-Arsiv XML'ini parse eder.
 *
 * Pipeline:
 *   1. Belge No   - ProfileID sonrasi cbc:ID (fallback: Invoice root cbc:ID)
 *   2. Tarih      - cbc:IssueDate (YYYY-MM-DD)
 *   3. KDV ve breakdown:
 *      - cac:InvoiceLine bloklari maskelenir (per-line tax tekrarini onler)
 *      - WithholdingTaxTotal ayrilir (tevkifat ayri toplanir)
 *      - Her TaxSubtotal'da TaxScheme kontrolu: sadece KDV (Name=KDV veya Code=0015)
 *      - KDV disi vergiler atlanir (OIV, Telsiz, OTV, Damga, BSMV, KKDF, Konaklama, Stopaj)
 *   4. Tevkifat   - WithholdingTaxTotal veya tax-inclusive farkindan
 *   5. Toplam     - cbc:PayableAmount
 *   6. Satici     - cac:AccountingSupplierParty > Party > PartyName > Name
 *   7. VKN/TCKN   - schemeID="VKN|TCKN" ya da ilk 10-11 haneli cbc:ID
 *
 * Don: structured OcrResult (engine='ubl-xml-direct', confidence 0.85-0.99)
 *      veya XML cok kisa / hicbir veri yoksa null.
 */
export function parseUblXml(xml: string, deps: UblParseDeps): OcrResult | null {
  const { parseAmount, formatAmount, normalizeTaxText, logger } = deps;

  if (!xml || xml.length < 50) return null;

  // ─── BELGE NO ─────────────────────────────────────
  let belgeNo: string | null = null;
  const afterProfile = xml.match(/<cbc:ProfileID>[^<]*<\/cbc:ProfileID>\s*<cbc:ID>([^<]+)<\/cbc:ID>/i);
  if (afterProfile) belgeNo = afterProfile[1].trim();
  if (!belgeNo) {
    const rootId = xml.match(/<(?:Invoice|ArchiveInvoice)[^>]*>[\s\S]*?<cbc:ID>([^<]+)<\/cbc:ID>/i);
    if (rootId) {
      const candidate = rootId[1].trim();
      if (!/^(TR|UBL)[\d.\-]+$/i.test(candidate) && candidate.length >= 5) {
        belgeNo = candidate;
      }
    }
  }

  // ─── TARİH ─────────────────────────────────────────
  let date: string | null = null;
  const issueDate = xml.match(/<cbc:IssueDate>([^<]+)<\/cbc:IssueDate>/i);
  if (issueDate) {
    const d = issueDate[1].trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) date = d;
  }

  // ─── KDV TUTARI + BREAKDOWN ────────────────────────
  // InvoiceLine maskele (per-line tax tekrarini onler), withholding ayri tut.
  const xmlInvoiceLevelOnly = stripXmlBlocks(xml, 'InvoiceLine');
  const xmlTaxForKdv = stripXmlBlocks(xmlInvoiceLevelOnly, 'WithholdingTaxTotal');

  const getTaxInfo = (block: string) => {
    const taxScheme = getXmlBlocks(block, 'TaxScheme')[0] || '';
    const taxSchemeName =
      getXmlTagValue(taxScheme, 'Name') ||
      getXmlTagValue(block, 'Name') ||
      '';
    const taxSchemeId =
      getXmlTagValue(block, 'TaxTypeCode') ||
      getXmlTagValue(taxScheme, 'ID') ||
      '';
    return {
      name: taxSchemeName.trim(),
      normalizedName: normalizeTaxText(taxSchemeName),
      id: taxSchemeId.trim(),
    };
  };

  const isTevkifatTax = (normalizedName: string, taxSchemeId: string) =>
    (normalizedName.includes('KDV') && normalizedName.includes('TEVK') && normalizedName.includes('FAT')) ||
    /^9\d{3}$/.test(taxSchemeId);

  const kdvBreakdown: KdvBreakdownItem[] = [];
  let tevkifatFromSubtotals = 0;
  const subtotalBlocks = getXmlBlocks(xmlTaxForKdv, 'TaxSubtotal');
  for (const block of subtotalBlocks) {
    const { name: taxSchemeName, normalizedName, id: taxSchemeId } = getTaxInfo(block);
    const isTevkifat = isTevkifatTax(normalizedName, taxSchemeId);
    if (isTevkifat) {
      const tutar = parseXmlAmount(block, 'TaxAmount', parseAmount);
      if (tutar > 0) {
        tevkifatFromSubtotals += tutar;
        logger.log(
          `XML parser: KDV tevkifati TaxSubtotal yakalandi - Name="${taxSchemeName}" Code="${taxSchemeId}" tutar=${tutar}`,
        );
      }
      continue;
    }
    const isNotKdv =
      /OZEL\s*ILETISIM|OIV/.test(normalizedName) ||
      /TELSIZ/.test(normalizedName) ||
      /OTV|OZEL\s*TUKETIM/.test(normalizedName) ||
      /DAMGA/.test(normalizedName) ||
      /BSMV/.test(normalizedName) ||
      /KKDF/.test(normalizedName) ||
      /KONAKLAMA/.test(normalizedName) ||
      /STOPAJ/.test(normalizedName) ||
      ['0003', '0059', '0061', '0071', '0072', '0073', '0074', '0075', '0076', '0077', '4080', '9040', '9077'].includes(taxSchemeId);
    const isKdv =
      normalizedName === 'KDV' ||
      normalizedName.includes('KATMA DEGER') ||
      taxSchemeId === '0015';
    if (isNotKdv) {
      logger.log(`XML parser: KDV dışı vergi atlandı — Name="${taxSchemeName}" Code="${taxSchemeId}"`);
      continue;
    }
    if (!isKdv && (taxSchemeName || taxSchemeId)) {
      logger.warn(`XML parser: bilinmeyen vergi türü atlandı — Name="${taxSchemeName}" Code="${taxSchemeId}"`);
      continue;
    }

    const tutar = parseXmlAmount(block, 'TaxAmount', parseAmount);
    const matrahRaw = getXmlTagValue(block, 'TaxableAmount');
    const matrah = matrahRaw ? parseAmount(matrahRaw) : null;
    const percentRaw = getXmlTagValue(block, 'Percent');
    const oran = percentRaw ? parseAmount(percentRaw) : 0;
    if (tutar > 0 || (oran === 0 && matrah && matrah > 0)) {
      kdvBreakdown.push({ oran, tutar, matrah });
    }
  }

  const sumWithholdingTax = (fragment: string) => {
    let total = 0;
    for (const block of getXmlBlocks(fragment, 'WithholdingTaxTotal')) {
      const directAmount = parseXmlAmount(block, 'TaxAmount', parseAmount);
      if (directAmount > 0) {
        total += directAmount;
        continue;
      }
      for (const sub of getXmlBlocks(block, 'TaxSubtotal')) {
        const { normalizedName, id: taxSchemeId } = getTaxInfo(sub);
        if (isTevkifatTax(normalizedName, taxSchemeId)) {
          total += parseXmlAmount(sub, 'TaxAmount', parseAmount);
        }
      }
    }
    return total;
  };

  const invoiceWithholding = sumWithholdingTax(xmlInvoiceLevelOnly);
  const lineWithholding = invoiceWithholding > 0 ? 0 : sumWithholdingTax(xml);
  let kdvTevkifat = Math.max(tevkifatFromSubtotals, invoiceWithholding, lineWithholding);
  if (kdvTevkifat > 0) {
    logger.log(`XML parser: KDV tevkifati yakalandi - tutar=${kdvTevkifat}`);
  }

  const kdvToplam = kdvBreakdown.reduce((s, b) => s + (b.tutar || 0), 0);
  if (kdvTevkifat <= 0 && kdvToplam > 0) {
    // BUG FIX (WASH faturasi): Eski heuristic `includes('TEVK') && includes('FAT')`
    // her faturada false-positive verdi cunku "FATURA" kelimesi "FAT" substring'ini
    // tasiyor. Tax-inclusive vs payable farki da iskonto/allowance/yuvarlama olabilir.
    // Yeni kural: sadece XML'de gercek tevkifat XML tag'i (WithholdingTaxTotal,
    // veya 9xxx tax code) varsa fallback inference yapilir.
    const hasWithholdingTag = /<(?:[\w.-]+:)?WithholdingTaxTotal\b/i.test(xml);
    const hasTevkifatCode = /<(?:[\w.-]+:)?(?:TaxTypeCode|ID)[^>]*>\s*9\d{3}\s*</i.test(xml);
    // Ayrica gercek TEVKIFAT kelimesi gec - "FATURA" eslesmesini engelle.
    // /i flag ile I/i/İ buyuk-kucuk eslesir; \bTEVK[Iİ]?F ile TEVKIF / TEVKİF / TEVKFAT (rare).
    const hasTevkifatKeyword = /\bTEVK[Iİ]?F/i.test(xml);
    const tevkifatStrongSignal = hasWithholdingTag || hasTevkifatCode || hasTevkifatKeyword;
    if (tevkifatStrongSignal) {
      const taxInclusive = parseXmlAmount(xmlInvoiceLevelOnly, 'TaxInclusiveAmount', parseAmount);
      const payable = parseXmlAmount(xmlInvoiceLevelOnly, 'PayableAmount', parseAmount);
      const inferred = Math.round((taxInclusive - payable) * 100) / 100;
      // Inferred tevkifat 'in mantik kontrolu: 0 < inferred <= kdvToplam VE
      // standart tevkifat orani (1/10, 2/10, ..., 9/10) ile uyumlu olmali.
      const inferredRate = inferred / kdvToplam;
      const validTevkifatRates = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9];
      const isValidRate = validTevkifatRates.some((r) => Math.abs(inferredRate - r) < 0.03);
      if (inferred > 0 && inferred <= kdvToplam + 0.05 && isValidRate) {
        kdvTevkifat = inferred;
        logger.warn(
          `XML parser: tevkifat toplam farkindan cikarildi - taxInclusive=${taxInclusive} payable=${payable} tevkifat=${kdvTevkifat} oran=${(inferredRate * 100).toFixed(0)}/100`,
        );
      } else if (inferred > 0) {
        logger.warn(
          `XML parser: tevkifat inference reddedildi - inferred=${inferred} kdvToplam=${kdvToplam} oran=${(inferredRate * 100).toFixed(1)}% (standart tevkifat oranlarina uymuyor - allowance/iskonto olabilir)`,
        );
      }
    }
  }
  const kdvNet = kdvTevkifat > 0 ? Math.max(0, kdvToplam - kdvTevkifat) : kdvToplam;
  if (kdvTevkifat > 0) {
    logger.log(`XML parser: Tevkifat hesabı — tam KDV=${kdvToplam}, tevkifat=${kdvTevkifat}, net KDV=${kdvNet}`);
    if (kdvBreakdown.length === 1) {
      kdvBreakdown[0].tutar = kdvNet;
    }
  }
  const kdvTutari = kdvNet > 0 ? formatAmount(kdvNet) : null;

  // ─── TOPLAM ÖDENECEK ─────────────────────────────
  let totalTutari: string | null = null;
  const payable = xml.match(/<cbc:PayableAmount[^>]*>([^<]+)<\/cbc:PayableAmount>/i);
  if (payable) {
    const t = parseFloat(payable[1]) || 0;
    if (t > 0) totalTutari = formatAmount(t);
  }

  // ─── SATICI / BELGE TİPİ ─────────────────────────
  const isArchive = /<ArchiveInvoice|InvoiceTypeCode[^>]*>EARSIV/i.test(xml);
  const belgeTipi = isArchive ? 'EARSIV' : 'EFATURA';

  let satici: string | null = null;
  let saticiVkn: string | null = null;
  const supplierBlock = xml.match(/<cac:AccountingSupplierParty>([\s\S]*?)<\/cac:AccountingSupplierParty>/i);
  if (supplierBlock) {
    const nameMatch = supplierBlock[1].match(/<cbc:Name>([^<]+)<\/cbc:Name>/i);
    if (nameMatch) {
      satici = nameMatch[1].trim().slice(0, 200);
    }
    const supplierText = supplierBlock[1];
    const vknMatch =
      supplierText.match(/<cbc:ID[^>]*schemeID=["'](?:VKN|TCKN)["'][^>]*>(\d{10,11})<\/cbc:ID>/i) ||
      supplierText.match(/<cbc:ID[^>]*>(\d{10,11})<\/cbc:ID>/i);
    if (vknMatch?.[1]) saticiVkn = vknMatch[1];
  }

  if (!belgeNo && !date && !kdvTutari) return null;

  return {
    rawText: '',
    belgeNo,
    date,
    kdvTutari,
    kdvTevkifat: kdvTevkifat > 0 ? formatAmount(kdvTevkifat) : null,
    totalTutari,
    satici,
    saticiVkn,
    belgeTipi,
    kdvBreakdown: kdvBreakdown.length > 0 ? kdvBreakdown : null,
    confidence: belgeNo && date && kdvTutari ? 0.99 : 0.85,
    fieldConfidence: {
      belgeNo: belgeNo ? 0.99 : null,
      date: date ? 0.99 : null,
      kdvTutari: kdvTutari ? 0.99 : null,
    },
    validationScore: 1.0,
    engine: 'ubl-xml-direct',
  };
}
