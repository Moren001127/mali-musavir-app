-- 2026-09-14 Evrak geldi mesajı: başarısız deneme sayacı + son deneme anı (geri çekilme)
ALTER TABLE "taxpayer_monthly_statuses" ADD COLUMN IF NOT EXISTS "evrakGeldiMesajDenemeSayisi" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "taxpayer_monthly_statuses" ADD COLUMN IF NOT EXISTS "evrakGeldiMesajSonDenemeAt" TIMESTAMP(3);
