/**
 * Text classifiers — KDV satirlarini siniflamak icin boolean helper'lar.
 *
 * Public API (Faz 1 modul izolasyon):
 *   isLikelyStandaloneTaxRate(value, foldFn)     - "20" / "%18" gibi salt KDV oranlari mi
 *   isMatrahOrRateLine(value, foldFn)            - "KDV MATRAH" / "KDV ORAN" satiri mi
 *   isKdvTableHeaderLine(value, foldFn)          - "KDV TUTARI" + "KDV ORANI" iceren tablo basligi mi
 *   isForbiddenKdvAmountLine(value, foldFn)      - KDV tutari ayiklamada bakilmamasi gereken satir mi
 *   isLikelyKdvAmountColumnHeader(lines, index, foldFn) - "TUTAR" sutun basligi KDV tablosu icindeki mi
 *
 * Bu helper'lar `this` kullanmaz - saf fonksiyonlar.
 * `foldFn` parametresi caller tarafindan saglanan Turkce-ASCII katlama
 * fonksiyonudur (genellikle OcrService.foldTurkishAscii).
 */

type FoldFn = (s: string) => string;

/** "0", "1", "8", "10", "18", "20" (opsiyonel ",0" / ",00" / "%" ile) — salt KDV orani mi?
 *
 * BUG FIX (WASH faturasi v1.37.78): Eski regex `[,.]00` SADECE iki sifirli formati
 * yakaliyordu (20,00 / 20.00). Azure "%20.0" (tek sifir) yaziyor satirlarda. O yuzden
 * "20.0" tutar sanildi -> KDV=20 bug'i. Yeni regex `[,.]0{1,2}` her iki formati da
 * yakalar ama "10.000" (1000 TL tutari) eslesmesin diye max 2 sifir sinirli.
 */
export function isLikelyStandaloneTaxRate(value: string, foldFn: FoldFn): boolean {
  const folded = foldFn(value || '')
    .replace(/\b(?:TL|TRY)\b|₺/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cleaned = folded
    .replace(/^%/, '')
    .replace(/%$/, '')
    .trim();
  return /^(0|1|8|10|18|20)(?:[,.]0{1,2})?$/.test(cleaned);
}

/** "KDV MATRAH" / "KDV ORAN" / "MATRAH" / "ORAN" basliklarini iceren satir mi? */
export function isMatrahOrRateLine(value: string, foldFn: FoldFn): boolean {
  const folded = foldFn(value || '');
  const withoutMatrahParen = folded.replace(/\([^)]*MATRAH[^)]*\)/g, ' ');
  return /\bKDV\s*(?:MATRAH|ORAN[II]?|UYGULANAN\s+TUTAR)\b|^\s*(?:MATRAH|ORAN)\b/.test(withoutMatrahParen);
}

/** "KDV TUTARI" + ("KDV ORANI" | "DIGER VERGILER" | "MAL HIZMET") iceren tablo basligi mi? */
export function isKdvTableHeaderLine(value: string, foldFn: FoldFn): boolean {
  const folded = foldFn(value || '');
  return /\bKDV\s*TUTAR[II]?\b/.test(folded)
    && /\b(?:KDV\s*ORAN[II]?|DIGER\s+VERGILER|MAL\s+HIZMET)\b/.test(folded);
}

/**
 * KDV tutari ayiklamada hatalı kaynak olabilecek satirlar:
 *   - matrah/oran satiri
 *   - tablo basligi
 *   - GENEL/ARA/MAL HIZMET TOPLAM satirlari (KDV labelı yoksa)
 */
export function isForbiddenKdvAmountLine(value: string, foldFn: FoldFn): boolean {
  const folded = foldFn(value || '');
  if (!folded) return false;
  if (isMatrahOrRateLine(folded, foldFn) || isKdvTableHeaderLine(folded, foldFn)) return true;

  const explicitKdvLabel =
    /\bHESAPLANAN\s+K\.?\s*D\.?\s*V\.?\b|\bKATMA\s+DEGER\s+VERGISI\b|\bK\.?\s*D\.?\s*V\.?\s*TUTAR[II]?\b|\bTOP\s*K\.?\s*D\.?\s*V\.?\b|\bTOPKDV\b|\bODENECEK\s+K\.?\s*D\.?\s*V\.?\b/.test(folded);
  const totalOrBaseLine =
    /\bMAL\s+HIZMET\b|\bVERGILER\s+(?:DAHIL|HARIC)\b|\bODENECEK\s+TUTAR\b|\bFATURA\s+TUTAR[II]?\b|\bTOPLAM\s+ISKONTO\b|\bGENEL\s+TOPLAM\b|\bARA\s+TOPLAM\b|\bTOPLAM\s+TUTAR\b/.test(folded);

  return totalOrBaseLine && !explicitKdvLabel;
}

/**
 * `lines[index]` "TUTAR" / "KDV TUTARI" gibi salt baslik mi, ve cevre baglam
 * (KDV ORAN, DIGER VERGILER, MAL HIZMET, SIRA NO) KDV tablosu mu gosteriyor?
 */
export function isLikelyKdvAmountColumnHeader(lines: string[], index: number, foldFn: FoldFn): boolean {
  const foldedLine = foldFn(lines[index] || '').replace(/\s+/g, ' ').trim();
  const isPlainKdvAmountHeader =
    /^(?:K\.?\s*D\.?\s*V\.?\s*)?TUTAR[II]?$/.test(foldedLine) ||
    /^K\.?\s*D\.?\s*V\.?\s*TUTAR[II]?$/.test(foldedLine);
  if (!isPlainKdvAmountHeader) return false;

  const context = foldFn(
    lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 4)).join(' '),
  );
  return /\bKDV\s*ORAN[II]?\b|\bDIGER\s+VERGILER\b|\bMAL\s+HIZMET\b|\bSIRA\s*NO\b/.test(context);
}
