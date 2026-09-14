-- 2026-09-14 Aylık Ödeme Cetveli — otomatik gönderim ayarı (smart_dispatch_settings, kategori ODEME_LISTESI)
--   sendDay       : ayın günü (1-28); NULL = seçilmemiş
--   onayGerekli   : true → koşu gününde sahibe "cetvel hazır" bildirimi gider, gönderim elle yapılır
--   lastRunAt     : son otomatik koşu zamanı (aynı ay ikinci kez koşulmaz)
--   lastRunResult : { month, sonuc, gonderilen }
-- GÜVENLİK: yalnız ADD COLUMN IF NOT EXISTS; mevcut satırlar/değerler değişmez (onayGerekli varsayılanı true).
ALTER TABLE "smart_dispatch_settings" ADD COLUMN IF NOT EXISTS "sendDay" INTEGER;
ALTER TABLE "smart_dispatch_settings" ADD COLUMN IF NOT EXISTS "onayGerekli" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "smart_dispatch_settings" ADD COLUMN IF NOT EXISTS "lastRunAt" TIMESTAMP(3);
ALTER TABLE "smart_dispatch_settings" ADD COLUMN IF NOT EXISTS "lastRunResult" JSONB;
