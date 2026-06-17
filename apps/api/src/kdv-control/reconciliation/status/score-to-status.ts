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
  // NOT: 0.65 ve 0.45 eşikleri aynı sonucu veriyordu (ölü dal). Davranış
  // korunarak tek eşiğe indirildi — 0.65'i MATCHED yapmak otomatik-kabul riski
  // taşıdığından bilerek yapılmadı; 0.45 altı NEEDS_REVIEW.
  if (score >= 0.45) return 'PARTIAL_MATCH';
  return 'NEEDS_REVIEW';
}
