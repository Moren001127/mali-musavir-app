/**
 * Reconciliation Sozlesmesi - Engine girdi/cikti SINIR
 * ====================================================
 * Engine + export + UI ucu buradan referans alir.
 */

import { z } from 'zod';
import { KdvBreakdownItemSchema } from './ocr.contract';

export const ReconciliationStatusSchema = z.enum([
  'MATCHED',
  'CONFIRMED',
  'PARTIAL_MATCH',
  'NEEDS_REVIEW',
  'UNMATCHED',
  'REJECTED',
]);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;

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
  return RECONCILIATION_STATUS_CATEGORY[status as keyof typeof RECONCILIATION_STATUS_CATEGORY];
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

export const ReconciliationResultSchema = z.object({
  sessionId: z.string(),
  kdvRecordId: z.string().nullable(),
  imageId: z.string().nullable(),
  status: ReconciliationStatusSchema,
  matchScore: z.number().min(0).max(1),
  mismatchReasons: z.array(z.string()),
});
export type ReconciliationResult = z.infer<typeof ReconciliationResultSchema>;

export const ReconciliationStatsSchema = z.object({
  matched: z.number().int().min(0),
  partial: z.number().int().min(0),
  unmatched: z.number().int().min(0),
  needsReview: z.number().int().min(0),
});
export type ReconciliationStats = z.infer<typeof ReconciliationStatsSchema>;

/**
 * Cift-orphan invariant - ayni kayit icin en fazla 1 result satiri olmali.
 */
export function detectDoubleOrphans(
  results: Array<{
    kdvRecordId: string | null;
    imageId: string | null;
    status: string;
  }>,
): Array<{ kdvRecordId: string | null; imageId: string | null; reason: string }> {
  const issues: Array<{ kdvRecordId: string | null; imageId: string | null; reason: string }> = [];

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
        reason: 'Ayni KDV record hem MATCHED hem UNMATCHED',
      });
    }
  }

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
        reason: 'Ayni image hem MATCHED hem UNMATCHED',
      });
    }
  }

  return issues;
}

interface IssueLike {
  path: Array<string | number>;
  message: string;
}

export function parseReconciliationResult(value: unknown, origin: string): ReconciliationResult {
  const r = ReconciliationResultSchema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues
      .map((i: IssueLike) => i.path.join('.') + ': ' + i.message)
      .join('; ');
    throw new Error('[contract] ReconciliationResult shape invalid - origin=' + origin + ' - ' + issues);
  }
  return r.data;
}

export { KdvBreakdownItemSchema };
