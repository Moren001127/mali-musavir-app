-- İçerik-bazlı öğrenme: satıcı-geneli hafızaya kalem-içerik imzası ekle (geriye-uyumlu, nullable).
-- Eski kayıtlar icerikImza=NULL kalır → satıcı-geneli davranış aynen korunur.
ALTER TABLE "vendor_memory_decisions" ADD COLUMN IF NOT EXISTS "icerikImza" TEXT;

CREATE INDEX IF NOT EXISTS "vendor_memory_decisions_vendorMemoryId_icerikImza_idx"
  ON "vendor_memory_decisions" ("vendorMemoryId", "icerikImza");
