-- Moren AI konuşma + mesaj tabloları

CREATE TABLE IF NOT EXISTS "ai_conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Yeni Konuşma',
    "taxpayerId" TEXT,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_conversations_tenantId_updatedAt_idx"
  ON "ai_conversations"("tenantId", "updatedAt");

CREATE INDEX IF NOT EXISTS "ai_conversations_tenantId_taxpayerId_idx"
  ON "ai_conversations"("tenantId", "taxpayerId");

CREATE TABLE IF NOT EXISTS "ai_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolResults" JSONB,
    "audioKey" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "model" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_messages_conversationId_createdAt_idx"
  ON "ai_messages"("conversationId", "createdAt");

ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
