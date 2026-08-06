-- Aylık takip: "Yüklendi" aşaması (evrak geldi → sisteme yüklendi → işlem bekliyor)
ALTER TABLE "taxpayer_monthly_statuses" ADD COLUMN "yuklendi" BOOLEAN NOT NULL DEFAULT false;
