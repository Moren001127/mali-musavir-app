-- ANLIK BİLDİRİM (push) — mobil cihaz belirteçleri (2026-09-13)
--
-- Mobil uygulama (Expo) girişte cihazın push belirtecini POST /notifications/push-token ile kaydeder;
-- portala düşen her bildirim (notifications tablosu) PushService üzerinden bu cihazlara iletilir.
--   userId / taxpayerId : ikisinden biri dolu (müşavir kullanıcısı ya da mükellef portalı)
--   token               : ExponentPushToken[...] — cihaz başına tek (UNIQUE)
--   platform            : ios | android      persona : adv | tax
--   disabledAt          : Expo "DeviceNotRegistered" dedi → bir daha gönderilmez
--
-- GÜVENLİK: yalnızca YENİ TABLO oluşturulur; mevcut hiçbir tabloya/indekse DOKUNULMAZ (yalnız CREATE ... IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "push_tokens" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "userId"     TEXT,
  "taxpayerId" TEXT,
  "token"      TEXT NOT NULL,
  "platform"   TEXT NOT NULL,
  "persona"    TEXT NOT NULL,
  "deviceName" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt" TIMESTAMP(3),
  CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_tokens_token_key"
  ON "push_tokens" ("token");

CREATE INDEX IF NOT EXISTS "push_tokens_tenantId_userId_idx"
  ON "push_tokens" ("tenantId", "userId");

CREATE INDEX IF NOT EXISTS "push_tokens_tenantId_taxpayerId_idx"
  ON "push_tokens" ("tenantId", "taxpayerId");
