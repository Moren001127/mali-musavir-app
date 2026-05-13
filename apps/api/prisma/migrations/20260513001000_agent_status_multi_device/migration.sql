-- Multi-device support for agent_status:
-- Önceden (tenantId, agent) tek satırdı → Chrome uzantısı + lokal Node worker
-- aynı 'luca' agent altına ping atınca biri diğerini eziyor, Sağlık Panosu'nda
-- sadece son ping görünüyor. Yeni model: deviceId column + (tenantId, agent, deviceId) unique.

ALTER TABLE "agent_status"
  ADD COLUMN IF NOT EXISTS "deviceId" TEXT NOT NULL DEFAULT '';

-- Eski unique constraint'i kaldır (Prisma default adıyla)
ALTER TABLE "agent_status"
  DROP CONSTRAINT IF EXISTS "agent_status_tenantId_agent_key";

-- Yeni composite unique
CREATE UNIQUE INDEX IF NOT EXISTS "agent_status_tenantId_agent_deviceId_key"
  ON "agent_status"("tenantId", "agent", "deviceId");

-- Sağlık Panosu son ping sıralaması için index
CREATE INDEX IF NOT EXISTS "agent_status_tenantId_agent_lastPing_idx"
  ON "agent_status"("tenantId", "agent", "lastPing");
