-- EVRAK ONAY BEKLEME SURESI (2026-08-20)
--
-- "Evrak geldi" isaretlenince mesaj ANINDA gidiyordu; yanlis isaretleme fark
-- edilse bile mesaj coktan gitmis oluyordu. Artik isaretleme kuyruga alinir ve
-- bekleme suresi dolunca gonderilir; bu sure icinde isaret kaldirilirsa mesaj
-- HIC gitmez.
--
-- Kuyruga alinma ani ayri alanda tutulur: updatedAt kullanilsaydi, baska bir
-- durum alani guncellendiginde sure sifirlanir ve mesaj surekli ertelenirdi.

ALTER TABLE "taxpayer_monthly_statuses"
  ADD COLUMN IF NOT EXISTS "evrakGeldiMesajKuyrukAt" TIMESTAMP(3);
