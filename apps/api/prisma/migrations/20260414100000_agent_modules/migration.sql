-- Taxpayer: otomasyon ajanı alanları
ALTER TABLE "taxpayers"
  ADD COLUMN IF NOT EXISTS "lucaSlug"         TEXT,
  ADD COLUMN IF NOT EXISTS "mihsapId"         TEXT,
  ADD COLUMN IF NOT EXISTS "mihsapDefterTuru" TEXT;

-- agent_events
CREATE TABLE IF NOT EXISTS "agent_events" (
  "id"         TEXT PRIMARY KEY,
  "tenantId"   TEXT NOT NULL,
  "agent"      TEXT NOT NULL,
  "action"     TEXT,
  "status"     TEXT NOT NULL,
  "message"    TEXT,
  "mukellef"   TEXT,
  "firma"      TEXT,
  "fisNo"      TEXT,
  "tutar"      DECIMAL(14,2),
  "hesapKodu"  TEXT,
  "kdv"        TEXT,
  "meta"       JSONB,
  "ts"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "agent_events_tenantId_ts_idx"           ON "agent_events"("tenantId","ts");
CREATE INDEX IF NOT EXISTS "agent_events_tenantId_agent_ts_idx"     ON "agent_events"("tenantId","agent","ts");
CREATE INDEX IF NOT EXISTS "agent_events_tenantId_mukellef_idx"     ON "agent_events"("tenantId","mukellef");

-- agent_rules
CREATE TABLE IF NOT EXISTS "agent_rules" (
  "id"         TEXT PRIMARY KEY,
  "tenantId"   TEXT NOT NULL,
  "mukellef"   TEXT NOT NULL,
  "faaliyet"   TEXT,
  "defterTuru" TEXT,
  "profile"    JSONB NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_rules_tenantId_mukellef_key" ON "agent_rules"("tenantId","mukellef");
CREATE INDEX IF NOT EXISTS "agent_rules_tenantId_idx" ON "agent_rules"("tenantId");

-- agent_status
CREATE TABLE IF NOT EXISTS "agent_status" (
  "id"        TEXT PRIMARY KEY,
  "tenantId"  TEXT NOT NULL,
  "agent"     TEXT NOT NULL,
  "running"   BOOLEAN NOT NULL DEFAULT false,
  "hedefAy"   TEXT,
  "lastPing"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "meta"      JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_status_tenantId_agent_key" ON "agent_status"("tenantId","agent");

-- agent_commands
CREATE TABLE IF NOT EXISTS "agent_commands" (
  "id"         TEXT PRIMARY KEY,
  "tenantId"   TEXT NOT NULL,
  "agent"      TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "payload"    JSONB NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'pending',
  "result"     JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt"  TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdBy"  TEXT
);

CREATE INDEX IF NOT EXISTS "agent_commands_tenantId_status_idx"           ON "agent_commands"("tenantId","status");
CREATE INDEX IF NOT EXISTS "agent_commands_tenantId_agent_createdAt_idx"  ON "agent_commands"("tenantId","agent","createdAt");
