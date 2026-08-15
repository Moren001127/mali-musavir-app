-- TCMB azami kart faizi degisince kart oranlari otomatik guncellensin mi
ALTER TABLE "butce_ayarlar" ADD COLUMN IF NOT EXISTS "faizOtomatikGuncelle" BOOLEAN NOT NULL DEFAULT true;

-- Kategori bazli aylik harcama siniri
ALTER TABLE "butce_kategoriler" ADD COLUMN IF NOT EXISTS "aylikLimit" DECIMAL(14,2);
