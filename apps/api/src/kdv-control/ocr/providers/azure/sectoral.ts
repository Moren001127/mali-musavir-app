/**
 * Azure OCR - Sektorel KDV adapter'lari.
 *
 * Telekom (Turkcell/Vodafone/Turk Telekom) ve elektrik faturalarinin kendine ozgu
 * KDV yerleşimi var. Genel adapter'lar bu desenleri kacirabiliyor; bu adapter'lar
 * sadece kendi sektorlerinde calisir, baska faturalarda null doner (fallback).
 *
 * Public API (Faz 2B son toparlama):
 *   extractKdvOnlyFromTelekom(text, deps)
 *   extractElectricityKdv(text, deps)
 *
 * Bu modul `this` kullanmaz; bagimliliklari `deps` ile alir.
 */

import { stripDateFragments } from './kdv-breakdown';

type FoldFn = (s: string) => string;

export interface TelekomDeps {
  parseAmount: (s: string) => number;
  foldTurkishAscii: FoldFn;
  stripMatrahFragments: (text: string) => string;
  isMatrahOrRateLine: (value: string) => boolean;
  isLikelyStandaloneTaxRate: (value: string) => boolean;
}

export interface ElectricityDeps {
  parseAmount: (s: string) => number;
  foldTurkishAscii: FoldFn;
  stripMatrahFragments: (text: string) => string;
}

/**
 * Telekom faturalarindan (Turkcell/Vodafone/Turk Telekom) tek KDV tutarini cikarir.
 *
 * KDV label varyasyonlari:
 *   "Katma Değer Vergisi"       — Turkcell, Vodafone
 *   "KDV (20%)"                 — Türk Telekom (rate parantez disinda %)
 *   "KDV (%20)", "K.D.V. (%20)" — E-fatura / E-arsiv standart
 *
 * Otomatik atla: "Özel İletişim Vergisi", "OIV", "Telsiz Kullanım", "OTV",
 * "Damga", "BSMV", "KKDF", "Konaklama" — bunlar KDV degil.
 */
export function extractKdvOnlyFromTelekom(text: string, deps: TelekomDeps): number | null {
  const { parseAmount, foldTurkishAscii: foldFn, stripMatrahFragments, isMatrahOrRateLine, isLikelyStandaloneTaxRate } = deps;

  if (!text) return null;
  const normalized = foldFn(text);
  const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const amountRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|₺)?/i;
  const kdvLabelRe =
    /KATMA\s*DE.?ER\s*VERGISI|\bK\.?\s*D\.?\s*V\.?\s*\(?\s*%?\s*\d/i;
  const otherTaxRe = /[O?]ZEL\s*[I?]LET[I?]S[I?]M|OIV\b|TELSIZ\s*KULLAN|OTV\b|DAMGA|BSMV|KKDF|KONAKLAMA/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!kdvLabelRe.test(line)) continue;
    if (isMatrahOrRateLine(line)) continue;

    // 1) Ayni satirda label'den sonra
    // stripDateFragments: "01.06.2026 - 01.07.2026" gibi hizmet donemi
    // tarihleri "1,06" tutari sanilmasin (lifebox vakasi).
    const afterLabel = line.replace(kdvLabelRe, '');
    const noMatrah = stripMatrahFragments(stripDateFragments(afterLabel));
    const inlineAmount = noMatrah.match(amountRe);
    if (inlineAmount) {
      const val = parseAmount(inlineAmount[1]);
      if (val > 0 && val < 10_000_000) return val;
    }

    // 2) Sonraki 1-5 satira bak, baska vergi gelene kadar
    for (let j = 1; j <= 5 && i + j < lines.length; j++) {
      const nextLine = lines[i + j];
      if (kdvLabelRe.test(nextLine)) break;
      if (otherTaxRe.test(nextLine)) break;
      if (/MAL\s*HIZMET|GENEL\s*TOPLAM|FATURA\s*TUTARI|ODENECEK\s*TUTAR|TOPLAM\s+TUTAR/i.test(nextLine)) break;
      if (isMatrahOrRateLine(nextLine)) continue;
      const cleaned = stripMatrahFragments(stripDateFragments(nextLine));
      if (!cleaned) continue;
      if (/^[%]\s*\d/.test(cleaned) || isLikelyStandaloneTaxRate(cleaned)) continue;
      const m = cleaned.match(amountRe);
      if (m) {
        const val = parseAmount(m[1]);
        if (val > 0 && val < 10_000_000) return val;
      }
    }
  }

  return null;
}

/**
 * Elektrik faturalarindan KDV tutarini cikarir.
 *
 * Once "elektrik faturasi" marker'lari (ELEKTRIK FATURASI, KWH, TUKETIM (KWH),
 * TESISAT, ENERJI BEDELI, ELEKTRIK) ile bu faturanin elektrik oldugu dogrulanir.
 * Marker yoksa null (bu adapter calismaz).
 *
 * Sonra KDV label'i geçen satirda son tutar, yoksa sonraki 1-2 satirda.
 * hardStop: FATURA TUTARI, ODENECEK TUTAR, vb.
 */
export function extractElectricityKdv(text: string, deps: ElectricityDeps): number | null {
  const { parseAmount, foldTurkishAscii: foldFn, stripMatrahFragments } = deps;

  if (!text) return null;
  const normalized = foldFn(text);
  // Ciplak "ELEKTRIK" kelimesi YETMEZ: araba servis faturasindaki "ELEKTRIK
  // ISCILIGI" kalemi bile bu adapteri tetikleyip yanlis satirdan KDV okutuyordu
  // (MEZCAR CHS2026000001375: "Fatura Kdv Matrahi" 23.553,13 KDV sanildi).
  // Gercek elektrik faturasi belirtileri sart: kWh / tesisat / enerji bedeli.
  const looksElectricityInvoice =
    /\bELEKTRIK\s+FATURASI\b|\bKWH\b|\bTUKETIM\s*\(KWH\)|\bTESISAT\b|\bENERJI\s+BEDELI\b/.test(normalized);
  if (!looksElectricityInvoice) return null;

  const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const amountGlobalRe = /([\d]{1,3}(?:[.,]\d{3})*[.,]\d{1,2})\s*(?:TL|TRY|₺)?/gi;
  const hardStopRe =
    /FATURA\s+TUTARI|ODENECEK\s+TUTAR|VERGI\s+VE\s+FONLAR|TOPLAM\s+ENERJI|GUNCEL\s+YUVARLAMA|ONCEKI\s+YUVARLAMA|ELEKT\s+VER|TUKETIM|BEDEL|SON\s+ODEME/i;

  const parseLastKdvAmount = (source: string): number | null => {
    const withoutMatrah = stripMatrahFragments(source);
    amountGlobalRe.lastIndex = 0;
    const matches = [...withoutMatrah.matchAll(amountGlobalRe)];
    if (matches.length === 0) return null;
    const value = parseAmount(matches[matches.length - 1][1]);
    return value > 0 && value < 10_000_000 ? value : null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\bK\.?\s*D\.?\s*V\.?\b/.test(line)) continue;
    // MATRAH: "Fatura Kdv Matrahi" satirinin altindaki tutar KDV DEGIL, matrahtir.
    if (/TEVKIFAT|MATRAH/.test(line)) continue;

    const sameLine = parseLastKdvAmount(line.replace(/\bK\.?\s*D\.?\s*V\.?\b/, ' '));
    if (sameLine != null) return sameLine;

    for (let j = 1; j <= 2 && i + j < lines.length; j++) {
      const next = lines[i + j];
      if (hardStopRe.test(next) || /\bK\.?\s*D\.?\s*V\.?\b/.test(next)) break;
      const nearby = parseLastKdvAmount(next);
      if (nearby != null) return nearby;
    }
  }

  return null;
}
