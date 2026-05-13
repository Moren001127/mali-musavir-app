-- FAZ 4 — Portal Geliştirme ekibi: görev kartları + ajan mesajları
-- SEDA kod yazmaz, sadece PR planı/diff önerisi üretir.

CREATE TABLE "portal_dev_tasks" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "description"       TEXT NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'backlog',
  "priority"          TEXT NOT NULL DEFAULT 'medium',
  "type"              TEXT NOT NULL DEFAULT 'feature',
  "riskLevel"         TEXT NOT NULL DEFAULT 'medium',
  "assignee"          TEXT,
  "createdByUserId"   TEXT NOT NULL,
  "acceptance"        TEXT,
  "proposedFiles"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "proposedDiff"      TEXT,
  "estimateHrs"       DOUBLE PRECISION,
  "sourceProposalId"  TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "portal_dev_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "portal_dev_tasks_tenantId_status_idx" ON "portal_dev_tasks"("tenantId", "status");
CREATE INDEX "portal_dev_tasks_assignee_status_idx" ON "portal_dev_tasks"("assignee", "status");

CREATE TABLE "portal_dev_messages" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "taskId"    TEXT,
  "agent"     TEXT NOT NULL,
  "userId"    TEXT,
  "content"   TEXT NOT NULL,
  "ts"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "portal_dev_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "portal_dev_messages_tenantId_taskId_idx" ON "portal_dev_messages"("tenantId", "taskId");

ALTER TABLE "portal_dev_messages"
  ADD CONSTRAINT "portal_dev_messages_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "portal_dev_tasks"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
