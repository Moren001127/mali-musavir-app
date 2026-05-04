-- Mihsap Fatura İşleyici iyileştirmeleri
-- 1. ReceiptImage'a imageHash (mükerrer OCR engellemek için SHA-256 cache)
-- 2. ReceiptImage'a ocrKategori (otomatik gider kategorisi: yakit/yemek/...)
-- 3. AiUsageLog'a taxpayerId (mükellef bazlı AI maliyet izleme)
-- 4. AiUsageLog'a cacheHit (bu çağrı cache'den mi geldi, gerçek API çağrısı mı)

-- ReceiptImage
ALTER TABLE "receipt_images"
  ADD COLUMN IF NOT EXISTS "imageHash"     VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "ocrKategori"   TEXT,
  ADD COLUMN IF NOT EXISTS "ocrSaticiVkn"  TEXT;

CREATE INDEX IF NOT EXISTS "receipt_images_imageHash_idx" ON "receipt_images"("imageHash");

-- AiUsageLog
ALTER TABLE "ai_usage_logs"
  ADD COLUMN IF NOT EXISTS "taxpayerId" TEXT,
  ADD COLUMN IF NOT EXISTS "cacheHit"   BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "ai_usage_logs_tenantId_taxpayerId_createdAt_idx"
  ON "ai_usage_logs"("tenantId", "taxpayerId", "createdAt");
