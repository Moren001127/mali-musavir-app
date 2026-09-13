-- e-DEFTER KONTROL — KAPSAM RAPORU (2026-09-13)
--
-- edefter_control_sessions.kontrolOzeti : JSON — analiz sonunda her kuralin durumu (TEMIZ/BULGU/UYGULANMAZ/VERI_YOK/PASIF)
--   ve her yaprak hesabin donem karti (borc/alacak/acilis/kapanis). "Kontrol edildi, sorun yok" ile "calismadi"
--   ayrimini ekranda gostermek icin.
--
-- GUVENLIK: yalnizca YENI, NULL kabul eden bir kolon eklenir; mevcut veri/indeks DEGISMEZ.

ALTER TABLE "edefter_control_sessions" ADD COLUMN IF NOT EXISTS "kontrolOzeti" JSONB;
