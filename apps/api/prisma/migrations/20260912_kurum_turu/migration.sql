-- Faz 2 (PLAN/15 Uyarı katmanı): KDV kısmi tevkifat "belirlenmiş alıcı" ayrımı için kurum türü.
-- NULLABLE — mevcut kayıtlar bilinmiyor (null) kalır; ekrandan / ünvan tahmini + sahip onayıyla dolar.
-- Değerler: kamu | banka | belediye | universite | kit | diger | NULL

-- AlterTable
ALTER TABLE "taxpayers" ADD COLUMN "kurumTuru" TEXT;

-- AlterTable
ALTER TABLE "vendor_memory" ADD COLUMN "kurumTuru" TEXT;
