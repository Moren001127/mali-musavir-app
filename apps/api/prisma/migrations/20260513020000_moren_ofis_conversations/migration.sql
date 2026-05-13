-- Moren Ofis: 6 ajanlık AI ekip konuşma geçmişi tablosu.
-- Her conversation bir sohbet oturumu, messages JSONB içinde ajan/kullanıcı mesajları.

CREATE TABLE IF NOT EXISTS "moren_ofis_conversations" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "title" TEXT,
  "messages" JSONB NOT NULL DEFAULT '[]',
  "totalCostUsd" DECIMAL(10, 6) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moren_ofis_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "moren_ofis_conversations_tenantId_lastActivityAt_idx"
  ON "moren_ofis_conversations"("tenantId", "lastActivityAt");
