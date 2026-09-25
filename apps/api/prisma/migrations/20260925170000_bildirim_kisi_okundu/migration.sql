-- OFİS GENELİ BİLDİRİMDE KİŞİ BAZLI "OKUNDU" (portal denetimi bulgu 32b, 25 Eylül 2026)
--
-- `notifications.isRead` TEK alandı. Ofis geneline (userId = null) gönderilen bir bildirimi
-- personelden biri açınca HERKES için okundu oluyor; diğerleri o bildirimi hiç görmüyordu.
-- Kritik uyarılar da bu yolla kayboluyordu.
--
-- AYRIM: `isRead` artık "HERKES İÇİN KAPANDI" (sistemin kendiliğinden kapatması + kişiye özel
-- bildirimler). Bu tablo "şu kişi okudu". Bildirim X için okunmamıştır:
-- isRead = false VE bu tabloda X için satır YOK.
--
-- YENİ TABLO; mevcut hiçbir satır/veri değişmiyor.
-- GERİ DOLUM GEREKMEZ: eski ofis geneli bildirimlerde kişi bazlı bilgi zaten YOKTU.
-- isRead = true olanlar herkeste kapalı kalır; açık olanlar herkese okunmamış görünür.
CREATE TABLE IF NOT EXISTS "notification_reads" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_reads_notificationId_userId_key"
  ON "notification_reads"("notificationId", "userId");

CREATE INDEX IF NOT EXISTS "notification_reads_userId_readAt_idx"
  ON "notification_reads"("userId", "readAt");

ALTER TABLE "notification_reads"
  DROP CONSTRAINT IF EXISTS "notification_reads_notificationId_fkey";
ALTER TABLE "notification_reads"
  ADD CONSTRAINT "notification_reads_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_reads"
  DROP CONSTRAINT IF EXISTS "notification_reads_userId_fkey";
ALTER TABLE "notification_reads"
  ADD CONSTRAINT "notification_reads_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
