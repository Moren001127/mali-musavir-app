type ReceiptImageStatusLike = {
  ocrStatus?: string | null;
  isManuallyConfirmed?: boolean | null;
};

export function scoreToStatus(
  score: number,
  image: ReceiptImageStatusLike,
  strictMatch: boolean,
  forcePartial = false,
): string {
  if (image.ocrStatus === 'FAILED' && !image.isManuallyConfirmed) return 'NEEDS_REVIEW';
  if (strictMatch) return 'MATCHED';
  if (forcePartial) return 'PARTIAL_MATCH';
  if (score >= 0.65) return 'PARTIAL_MATCH';
  if (score >= 0.45) return 'PARTIAL_MATCH';
  return 'NEEDS_REVIEW';
}
