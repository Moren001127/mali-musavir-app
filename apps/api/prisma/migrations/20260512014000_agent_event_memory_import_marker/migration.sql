ALTER TABLE "agent_events"
  ADD COLUMN IF NOT EXISTS "memoryImportedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "agent_events_tenantId_memoryImportedAt_idx"
  ON "agent_events"("tenantId", "memoryImportedAt");
