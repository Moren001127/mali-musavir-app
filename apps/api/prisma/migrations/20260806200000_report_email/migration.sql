-- Akıllı Bildirim: günlük iletim raporu e-postası (müşavire)
ALTER TABLE "smart_dispatch_settings" ADD COLUMN IF NOT EXISTS "reportEmail" TEXT;
