-- EVRAK MESAJ DAMGALARI (2026-08-18)
--
-- Damgalar DÖNEM bazına taşınıyor. Önceden tek bir Taxpayer.lastReminderSentAt
-- vardı; ay değişince eski dönemin takibi düşüyor, aynı damga farklı dönemleri
-- kilitliyordu. Ayrıca "evrak geldi" onayı mesai dışında işaretlenince mesaj
-- düşüyordu; artık beklemeye alınıp ilk mesai saatinde gönderilecek.
--
-- IF NOT EXISTS: rolling deploy sırasında iki kez çalışabilir; ikinci çalışmada
-- hata verirse "migrate deploy && start" zinciri kırılır ve API hiç açılmaz.

ALTER TABLE "taxpayer_monthly_statuses"
  ADD COLUMN IF NOT EXISTS "evrakTalepSonGonderimAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "evrakTalepGonderimSayisi" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "evrakGeldiMesajBekliyor" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "evrakGeldiMesajGonderimAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "taxpayer_monthly_statuses_evrakGeldiMesajBekliyor_idx"
  ON "taxpayer_monthly_statuses" ("evrakGeldiMesajBekliyor");
