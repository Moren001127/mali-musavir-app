-- Tevkifat tutarı + OCR validation skoru için yeni alanlar
-- Bug fix: Tevkifatlı faturalarda OCR'dan tam KDV ve tevkifat ayrı geliyor;
-- önceden sadece NET KDV kayıt ediliyordu, tevkifat tutarı kayboluyordu.
-- Bu migration tevkifat tutarını şeffaf saklamak ve OCR multi-pass validation
-- skorunu eklemek için yapıldı.

ALTER TABLE "receipt_images"
  ADD COLUMN IF NOT EXISTS "ocrKdvTevkifat" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmedKdvTevkifat" TEXT,
  ADD COLUMN IF NOT EXISTS "ocrValidationScore" DOUBLE PRECISION;
