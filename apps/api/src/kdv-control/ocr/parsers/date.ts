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

/**
 * OCR rakam-karışması onarımlı tarih çıkarma (Z raporu / ÖKC termal baskı).
 *
 * Termal fişlerde "0" sık sık "8"/"9" okunur: "01.96.2826" (gerçek 01.06.2026,
 * vaka: ASEL ELEKTRONİK Z raporu) → ay 96 + yıl 2826 geçersiz → extractDate null
 * dönüyor, belge "tarih okunamadı" ile teyit kuyruğunda kalıyordu.
 *
 * İkinci geçiş: alan GEÇERSİZKEN baştaki 8/9 rakamını 0'a çevirip yeniden
 * doğrular. Yalnız extractDate null döndüğünde çağrılır ve onarılmış tarih dar
 * yıl penceresinde (2020-2035) doğrulanır — geçerli okunan tarihleri asla
 * değiştiremez, uydurma tarih üretemez (onarım geçerli tarih vermezse null).
 */
export function extractDateWithOcrRepair(text: string): string | null {
  const direct = extractDate(text);
  if (direct) return direct;

  const fixDay = (d: string) => (+d > 31 && /^[89]/.test(d) ? '0' + d.slice(1) : d);
  const fixMonth = (mo: string) => (+mo > 12 && /^[89]/.test(mo) ? '0' + mo.slice(1) : mo);
  const fixYear = (y: string) => (y.length === 4 && /^2[89]/.test(y) ? '20' + y.slice(2) : y);

  for (const m of text.matchAll(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{2}|\d{4})\b/g)) {
    const d = fixDay(m[1]);
    const mo = fixMonth(m[2]);
    const yy = normalizeOcrYear(fixYear(m[3]));
    // En az bir alan onarılmış olmalı (aksi halde ilk geçişte dönerdi) ve sonuç
    // tam geçerli olmalı; yıl dar pencerede.
    const repaired = d !== m[1] || mo !== m[2] || fixYear(m[3]) !== m[3];
    if (!repaired) continue;
    if (+d >= 1 && +d <= 31 && +mo >= 1 && +mo <= 12 && yy != null && yy >= 2020 && yy <= 2035) {
      return `${d.padStart(2, '0')}.${mo.padStart(2, '0')}.${yy}`;
    }
  }
  return null;
}
