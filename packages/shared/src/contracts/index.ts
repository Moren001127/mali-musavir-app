/**
 * Modüller arası kontrat katmanı — public export.
 *
 * Bu paket, modüller arası geçen TÜM data shape'lerini Zod schema olarak
 * kilitler. OCR ↔ Reconciliation ↔ Export ↔ Agent runtime — hepsi buradan
 * referans alır. Bir tarafta shape değişirse diğer taraftaki `.parse()`
 * RUNTIME'da net hata fırlatır, "sessiz bozulma" mümkün değildir.
 *
 * Kullanım pattern'i:
 *   import { parseOcrResult } from '@mali-musavir/shared';
 *
 *   // OCR servisi çıkışta:
 *   return parseOcrResult(result, 'OcrService.extract');
 *
 *   // Reconciliation girişte:
 *   const validated = parseOcrResult(image.ocrData, 'reconciliation.engine');
 *
 * Schema değişikliği şu sırayla yapılır:
 *   1. Burayı güncelle
 *   2. Üreten modülün testi koş (regression)
 *   3. Tüketen modüller `Schema.parse()` çağrılarını güncelle
 *   4. End-to-end fixture regression koş
 */

export * from './ocr.contract';
export * from './luca.contract';
export * from './reconciliation.contract';
