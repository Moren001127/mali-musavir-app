-- AŞAMA DAMGALARI (portal denetimi bulgu 46b, 25 Eylül 2026)
--
-- Elde yalnız `evraklarIslendiAt` vardı; kalan aşamaların bekleme süresi genel
-- `updatedAt`'ten ölçülüyordu. `updatedAt` satırdaki HERHANGİ bir alan değişince
-- tazelendiği için 208 gündür evrak bekleyen bir mükellefte alakasız bir kutu
-- işaretlenince GECİKME SIFIRLANIYORDU.
--
-- Dört sütun da NULLABLE ve EKLEMELİ: mevcut hiçbir satır/veri değişmiyor.
-- GERİ DOLUM YAPILMIYOR: geçmiş geçişlerin anı hiçbir yerde tutulmuyor. Eski
-- satırlarda NULL kalır ve okuyan taraf `updatedAt` yedeğine düşer. Uydurma
-- tarih yazılmaz — yanlış gecikme, hiç gecikme göstermemekten kötüdür.
ALTER TABLE "taxpayer_monthly_statuses" ADD COLUMN IF NOT EXISTS "evraklarGeldiAt" TIMESTAMP(3);
ALTER TABLE "taxpayer_monthly_statuses" ADD COLUMN IF NOT EXISTS "yuklendiAt" TIMESTAMP(3);
ALTER TABLE "taxpayer_monthly_statuses" ADD COLUMN IF NOT EXISTS "kontrolEdildiAt" TIMESTAMP(3);
ALTER TABLE "taxpayer_monthly_statuses" ADD COLUMN IF NOT EXISTS "beyannameVerildiAt" TIMESTAMP(3);
