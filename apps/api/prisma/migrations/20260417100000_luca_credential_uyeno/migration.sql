-- Luca credential tablosuna üye numarası sütunu ekle.
-- (İlk migration'da username + password vardı; sonradan uyeNo eklendi
--  ama Prisma aynı isimli migration'ı tekrar çalıştırmadığı için
--  sütun DB'ye yansımadı — bu migration eksik sütunu ekler.)
ALTER TABLE "luca_credentials"
  ADD COLUMN IF NOT EXISTS "uyeNo" TEXT NOT NULL DEFAULT '';
