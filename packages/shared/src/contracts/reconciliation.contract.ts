/**
 * Reconciliation Sözleşmesi — Engine girdi/çıktı SINIR
 * ====================================================
 * Reconciliation engine'in input/output shape'i. Engine + export + UI
 * üçü buradan referans alır. Birinde değişikliği diğerinin görmesi GARANTİ.
 */

import { z } from 'zod';
import { KdvBreakdownItemSchema } from './ocr.contract';

/** Reconciliation result statüsü */
export const ReconciliationStatusSchema = z.enum([
  'MATCHED',         // Otomatik tam eşleşme (strict)
  'CONFIRMED',       // Kullanıcı "İncele"den onayladı
  'PARTIAL_MATCH',   // Kısmi eşleşme (incele)
  'NEEDS_REVIEW',    // Düşük güvenli eşleşme (incele)
  'UNMATCHED',       // Hiç eşleşme yok (orphan)
  'REJECTED',        // Kullanıcı reddetti
]);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;

/** Status -> kategori haritası — export/render bunu kullanır */
export const RECONCILIATION_STATUS_CATEGORY = {
  MATCHED: 'matched',
  CONFIRMED: 'matched',
  PARTIAL_MATCH: 'review',
  NEEDS_REVIEW: 'review',
  UNMATCHED: 'error',
  REJECTED: 'error',
} as const;

export type ReconciliationStatusCategory = 'matched' | 'review' | 'error';

export function categoryOf(status: ReconciliationStatus): ReconciliationStatusCategory {
  return RECONCILIATION_STATUS_CATEGORY[status];
}

export function isMatchedStatus(s: string | null | undefined): boolean {
  return s === 'MATCHED' || s === 'CONFIRMED';
}

export function isReviewStatus(s: string | null | undefined): boolean {
  return s === 'PARTIAL_MATCH' || s === 'NEEDS_REVIEW';
}

export function isErrorStatus(s: string | null | undefined): boolean {
  return s === 'UNMATCHED' || s === 'REJECTED';
}

/** KDV record — Luca'dan gelen ham satır (DB temsili) */
export const KdvRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  rowIndex: z.number().int().optional(),
  belgeNo: z.string().nullable(),
  belgeDate: z.union([z.string(), z.date()]).nullable(),
  hesapKodu: z.string().nullable().optional(),
  hesapAdi: z.string().nullable().optional(),
  aciklama: z.string().nullable().optional(),
  karsiTaraf: z.string().nullable().optional(),
  vergiNo: z.string().nullable().optional(),
  kdvOrani: z.number().nullable().optional(),
  kdvTutari: z.union([z.string(), z.number()]).nullable(),
  matrah: z.union([z.string(), z.number()]).nullable().optional(),
  toplamTutar: z.union([z.string(), z.number()]).nullable().optional(),
  rawData: z.unknown().optional(),
});
export type KdvRecord = z.infer<typeof KdvRecordSchema>;

/** Reconciliation engine output — tek bir result satırı */
export const ReconciliationResultSchema = z.object({
  sessionId: z.string(),
  kdvRecordId: z.string().nullable(),
  imageId: z.string().nullable(),
  status: ReconciliationStatusSchema,
  matchScore: z.number().min(0).max(1),
  mismatchReasons: z.array(z.string()),
});
export type ReconciliationResult = z.infer<typeof ReconciliationResultSchema>;

/** Engine.runReconciliation() return tipi */
export const ReconciliationStatsSchema = z.object({
  matched: z.number().int().min(0),
  partial: z.number().int().min(0),
  unmatched: z.number().int().min(0),
  needsReview: z.number().int().min(0),
});
export type ReconciliationStats = z.infer<typeof ReconciliationStatsSchema>;

/**
 * Çift-orphan invariant — aynı kayıt için **en fazla 1 result** satırı olmalı.
 * Bu fonksiyon export/test'lerde çağırılır; bir mukellef/donem'in result tablosu
 * üzerinde **aynı (kdvRecordId, image hash) çiftinin hem MATCHED hem UNMATCHED
 * olarak yazılmadığını** garanti eder.
 *
 * Aynı belgeyi hem matched hem orphan görüyorsanız bu invariant ihlal edilmiştir.
 */
export function detectDoubleOrphans(
  results: Array<{
    kdvRecordId: string | null;
    imageId: string | null;
    status: string;
  }>,
): Array<{ kdvRecordId: string | null; imageId: string | null; reason: string }> {
  const issues: Array<{ kdvRecordId: string | null; imageId: string | null; reason: string }> = [];

  // Kural 1: kdvRecordId hem MATCHED hem UNMATCHED yazılmış mı
  const recordStatus = new Map<string, Set<string>>();
  for (const r of results) {
    if (!r.kdvRecordId) continue;
    if (!recordStatus.has(r.kdvRecordId)) recordStatus.set(r.kdvRecordId, new Set());
    recordStatus.get(r.kdvRecordId)!.add(r.status);
  }
  for (const [recId, statuses] of recordStatus) {
    const hasMatch = statuses.has('MATCHED') || statuses.has('CONFIRMED');
    const hasOrphan = statuses.has('UNMATCHED');
    if (hasMatch && hasOrphan) {
      issues.push({
        kdvRecordId: recId,
        imageId: null,
        reason: 'Aynı KDV record hem MATCHED hem UNMATCHED',
      });
    }
  }

  // Kural 2: imageId hem MATCHED hem UNMATCHED yazılmış mı
  const imageStatus = new Map<string, Set<string>>();
  for (const r of results) {
    if (!r.imageId) continue;
    if (!imageStatus.has(r.imageId)) imageStatus.set(r.imageId, new Set());
    imageStatus.get(r.imageId)!.add(r.status);
  }
  for (const [imgId, statuses] of imageStatus) {
    const hasMatch = statuses.has('MATCHED') || statuses.has('CONFIRMED');
    const hasOrphan = statuses.has('UNMATCHED');
    if (hasMatch && hasOrphan) {
      issues.push({
        kdvRecordId: null,
        imageId: imgId,
        reason: 'Aynı image hem MATCHED hem UNMATCHED',
      });
    }
  }

  return issues;
}

export function parseReconciliationResult(
  value: unknown,
  origin: string,
): ReconciliationResult {
  const r = ReconciliationResultSchema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(
      `[contract] ReconciliationResult shape bozulmuş — origin=${origin} — ${issues}`,
    );
  }
  return r.data;
}

// Re-export for convenience
export { KdvBreakdownItemSchema };
