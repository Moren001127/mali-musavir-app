-- Ofis ici chat: genel kanal, birebir mesajlar ve okunmamis takipleri.

CREATE TABLE IF NOT EXISTS "office_chat_threads" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "kind"        TEXT NOT NULL DEFAULT 'GENERAL',
  "title"       TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "office_chat_threads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "office_chat_threads_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "office_chat_threads_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "office_chat_participants" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "threadId"   TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3),
  "muted"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "office_chat_participants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "office_chat_participants_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "office_chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "office_chat_participants_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "office_chat_messages" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "threadId"  TEXT NOT NULL,
  "senderId"  TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "editedAt"  TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "office_chat_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "office_chat_messages_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "office_chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "office_chat_messages_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "office_chat_participants_threadId_userId_key"
  ON "office_chat_participants"("threadId", "userId");

CREATE INDEX IF NOT EXISTS "office_chat_threads_tenantId_updatedAt_idx"
  ON "office_chat_threads"("tenantId", "updatedAt");

CREATE INDEX IF NOT EXISTS "office_chat_threads_tenantId_kind_idx"
  ON "office_chat_threads"("tenantId", "kind");

CREATE INDEX IF NOT EXISTS "office_chat_participants_tenantId_userId_idx"
  ON "office_chat_participants"("tenantId", "userId");

CREATE INDEX IF NOT EXISTS "office_chat_messages_threadId_createdAt_idx"
  ON "office_chat_messages"("threadId", "createdAt");

CREATE INDEX IF NOT EXISTS "office_chat_messages_tenantId_createdAt_idx"
  ON "office_chat_messages"("tenantId", "createdAt");
