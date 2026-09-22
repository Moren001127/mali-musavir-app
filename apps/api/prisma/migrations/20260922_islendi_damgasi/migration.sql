-- 2026-09-22: "Evraklar işlendi" DAMGASI — Ekip KDV kontrol rutini, işaretten hemen sonra başlamasın.
-- Muzaffer Bey: "işlendi işaretledikten sonra kontrole geçince hemen başlatmasın, 5 dk beklesin;
--   çünkü faturalar Drive'a indirilip yedekleniyor."
-- updatedAt KULLANILAMAZ: başka bir alan güncellenince tazelenir ve bekleme sürekli ertelenir
--   (aynı ders evrakGeldiMesajKuyrukAt için de yaşanmıştı). Bu yüzden ayrı damga kolonu.
ALTER TABLE "taxpayer_monthly_statuses" ADD COLUMN IF NOT EXISTS "evraklarIslendiAt" TIMESTAMP(3);
