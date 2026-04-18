-- ReceiptImage: KDV breakdown + belge tipi alanları
-- Z Raporu ve çok-oranlı faturalarda her KDV oranının ayrı tutulması için JSON alanı.

ALTER TABLE "receipt_images"
  ADD COLUMN IF NOT EXISTS "ocrBelgeTipi" TEXT,
  ADD COLUMN IF NOT EXISTS "ocrKdvBreakdown" JSONB,
  ADD COLUMN IF NOT EXISTS "confirmedKdvBreakdown" JSONB;
