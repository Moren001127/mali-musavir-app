-- Akıllı Bildirim: mesajlarda görünecek "Gönderen adı" (tenant adından bağımsız)
ALTER TABLE "smart_dispatch_settings" ADD COLUMN IF NOT EXISTS "senderName" TEXT;
