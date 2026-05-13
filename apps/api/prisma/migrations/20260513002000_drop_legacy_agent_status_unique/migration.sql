-- Multi-device AgentStatus needs (tenantId, agent, deviceId), but the legacy
-- (tenantId, agent) unique was created as an index, not a table constraint.
DROP INDEX IF EXISTS "agent_status_tenantId_agent_key";
