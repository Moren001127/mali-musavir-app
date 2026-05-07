-- AgentStatus pause/resume kontrolu
ALTER TABLE "agent_status" ADD COLUMN "controlState" TEXT DEFAULT 'RUNNING';
ALTER TABLE "agent_status" ADD COLUMN "controlSetBy" TEXT;
ALTER TABLE "agent_status" ADD COLUMN "controlSetAt" TIMESTAMP(3);
