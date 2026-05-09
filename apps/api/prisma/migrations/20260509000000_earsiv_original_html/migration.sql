-- Luca ZIP'leri PDF yerine XML + HTML olarak gelebiliyor.
-- HTML'i saklayip portal onizleme ve Mihsap PDF uretiminde orijinal gorunumu kullaniriz.

ALTER TABLE "earsiv_faturalar"
  ADD COLUMN IF NOT EXISTS "htmlStorageKey" TEXT;
