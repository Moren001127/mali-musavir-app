-- Alan-bazlı OCR confidence + review statüsü
-- Her OCR alanı için ayrı güven skoru + kullanıcı teyidi bekleyen kayıtlar için ayrı statü.

-- 1. Enum'a NEEDS_REVIEW ekle (PostgreSQL enum değer ekleme: ADD VALUE IF NOT EXISTS)
DO $$ BEGIN
  ALTER TYPE "OcrStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REVIEW';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. ReceiptImage tablosuna alan-bazlı confidence + engine kolonları
ALTER TABLE "receipt_images"
  ADD COLUMN IF NOT EXISTS "ocrBelgeNoConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "ocrDateConfidence"    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "ocrKdvConfidence"     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "ocrEngine"            TEXT;
