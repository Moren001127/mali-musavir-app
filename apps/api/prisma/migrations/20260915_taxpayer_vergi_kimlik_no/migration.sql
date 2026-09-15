-- 2026-09-15 Mükellef kartı: şahıs firmasında TCKN yanında ikinci kimlik (vergi kimlik no, 10 hane)
-- KADİR CEYLAN KORKMAZ: Z raporlarında VKN 5780978427 yazıyor, kartta TCKN → OWNERSHIP_MISMATCH. İkinci kimlik eşleşmede kabul edilir.
ALTER TABLE "taxpayers" ADD COLUMN IF NOT EXISTS "vergiKimlikNo" TEXT;
