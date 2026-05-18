/**
 * Date parsers - OCR ham metninden Türk fatura tarih formatlarını çıkarır.
 *
 * Public API (Faz 1 modul izolasyon):
 *   normalizeOcrYear(raw) - 2 veya 4 haneli yılı normalize eder
 *   extractDate(text)     - ham metinden ilk gecerli tarihi DD.MM.YYYY formatında doner
 *
 * Bu helper'lar `this` kullanmaz - saf fonksiyonlar. Test edilebilir, baska
 * provider'larin (Azure/Claude/UBL) ortak kullanimina acik.
 */

/**
 * 2 haneli yili (26 -> 2026) veya 4 haneli yili (2026) normalize eder.
 * Sadece 2000-2050 araligindaki yillar gecerli sayilir.
 */
export function normalizeOcrYear(raw: string): number | null {
  if (!/^\d{2}$|^\d{4}$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  const year = raw.length === 2 ? 2000 + n : n;
  return year >= 2000 && year <= 2050 ? year : null;
}

/**
 * OCR ham metninden Turk fatura tarih formatlarini cikarir.
 * Destekledigi formatlar:
 *   DD - MM - YYYY  (boslukli tire)
 *   DD.MM.YYYY / DD/MM/YYYY
 *   YYYY-MM-DD
 * Tum cikislari DD.MM.YYYY formatinda doner.
 */
export function extractDate(text: string): string | null {
  // DD - MM - YYYY (boslukli tire)
  for (const m of text.matchAll(/\b(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{2}|\d{4})\b/g)) {
    const [, d, mo, y] = m;
    const yy = normalizeOcrYear(y);
    if (+d <= 31 && +mo <= 12 && yy != null)
      return `${d.padStart(2, '0')}.${mo.padStart(2, '0')}.${yy}`;
  }
  // DD.MM.YYYY / DD/MM/YYYY
  for (const m of text.matchAll(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{2}|\d{4})\b/g)) {
    const [, d, mo, y] = m;
    const yy = normalizeOcrYear(y);
    if (+d <= 31 && +mo <= 12 && yy != null)
      return `${d.padStart(2, '0')}.${mo.padStart(2, '0')}.${yy}`;
  }
  // YYYY-MM-DD
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const [, y, mo, d] = m;
    if (+d <= 31 && +mo <= 12) return `${d}.${mo}.${y}`;
  }
  return null;
}
