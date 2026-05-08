-- v1.36.74 Faz 1: Görevler & Hatırlatmalar modülü
-- Mali müşavirlik iş akışı için merkezi görev sistemi

-- TaskPriority enum
DO $$ BEGIN
  CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- TaskStatus enum
DO $$ BEGIN
  CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'SNOOZED', 'MISSED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tasks tablosu
CREATE TABLE IF NOT EXISTS "tasks" (
  "id"              TEXT PRIMARY KEY,
  "tenantId"        TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "description"     TEXT,
  "category"        TEXT,
  "priority"        "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "color"           TEXT,
  "tags"            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "taxpayerId"      TEXT,
  "createdById"     TEXT NOT NULL,
  "dueDate"         TIMESTAMP(3),
  "dueTime"         TEXT,
  "allDay"          BOOLEAN NOT NULL DEFAULT TRUE,
  "recurrence"      JSONB,
  "parentTaskId"    TEXT,
  "isTemplate"      BOOLEAN NOT NULL DEFAULT FALSE,
  "nextOccurrence"  TIMESTAMP(3),
  "reminderConfig"  JSONB,
  "notifyInApp"     BOOLEAN NOT NULL DEFAULT TRUE,
  "notifyEmail"     BOOLEAN NOT NULL DEFAULT FALSE,
  "notifyBrowser"   BOOLEAN NOT NULL DEFAULT TRUE,
  "notifySound"     BOOLEAN NOT NULL DEFAULT FALSE,
  "status"          "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "completedAt"     TIMESTAMP(3),
  "completedById"   TEXT,
  "snoozedUntil"    TIMESTAMP(3),
  "escalationLevel" INTEGER NOT NULL DEFAULT 0,
  "lastReminderAt"  TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "tasks_tenantId_status_dueDate_idx" ON "tasks"("tenantId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "tasks_tenantId_taxpayerId_idx" ON "tasks"("tenantId", "taxpayerId");
CREATE INDEX IF NOT EXISTS "tasks_tenantId_parentTaskId_idx" ON "tasks"("tenantId", "parentTaskId");
CREATE INDEX IF NOT EXISTS "tasks_tenantId_isTemplate_idx" ON "tasks"("tenantId", "isTemplate");
CREATE INDEX IF NOT EXISTS "tasks_nextOccurrence_idx" ON "tasks"("nextOccurrence");

-- Foreign keys (idempotent)
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_taxpayerId_fkey"
    FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentTaskId_fkey"
    FOREIGN KEY ("parentTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- task_notes
CREATE TABLE IF NOT EXISTS "task_notes" (
  "id"        TEXT PRIMARY KEY,
  "taskId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "task_notes_taskId_idx" ON "task_notes"("taskId");

DO $$ BEGIN
  ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- task_attachments
CREATE TABLE IF NOT EXISTS "task_attachments" (
  "id"            TEXT PRIMARY KEY,
  "taskId"        TEXT NOT NULL,
  "filename"      TEXT NOT NULL,
  "s3Key"         TEXT NOT NULL,
  "size"          INTEGER NOT NULL,
  "mimeType"      TEXT,
  "uploadedById"  TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "task_attachments_taskId_idx" ON "task_attachments"("taskId");

DO $$ BEGIN
  ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- task_reminder_logs
CREATE TABLE IF NOT EXISTS "task_reminder_logs" (
  "id"            TEXT PRIMARY KEY,
  "taskId"        TEXT NOT NULL,
  "scheduledFor"  TIMESTAMP(3) NOT NULL,
  "sentAt"        TIMESTAMP(3),
  "channel"       TEXT NOT NULL,
  "status"        TEXT NOT NULL,
  "recipientId"   TEXT,
  "errorMsg"      TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "task_reminder_logs_taskId_status_idx" ON "task_reminder_logs"("taskId", "status");
CREATE INDEX IF NOT EXISTS "task_reminder_logs_scheduledFor_status_idx" ON "task_reminder_logs"("scheduledFor", "status");

DO $$ BEGIN
  ALTER TABLE "task_reminder_logs" ADD CONSTRAINT "task_reminder_logs_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- push_subscriptions (Browser push notifications için)
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "endpoint"    TEXT NOT NULL UNIQUE,
  "p256dh"      TEXT NOT NULL,
  "auth"        TEXT NOT NULL,
  "userAgent"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "push_subscriptions_tenantId_userId_idx" ON "push_subscriptions"("tenantId", "userId");

DO $$ BEGIN
  ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
