-- Moren AI Otomasyon Motoru — Faz 1-3 migration'ı
-- Tablolar: automations, automation_runs
-- Enum'lar: AutomationTriggerType, AutomationStatus
-- İlişkiler: Tenant ve User'a FK

-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('CRON', 'EVENT', 'WEBHOOK', 'MANUAL');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ERROR', 'ARCHIVED');

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "triggerType" "AutomationTriggerType" NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "successRuns" INTEGER NOT NULL DEFAULT 0,
    "failureRuns" INTEGER NOT NULL DEFAULT 0,
    "failurePolicy" TEXT NOT NULL DEFAULT 'notify',
    "estimatedCostPerRun" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "triggerPayload" JSONB,
    "stepLogs" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "errorMessage" TEXT,
    "costUsd" DOUBLE PRECISION,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automations_tenantId_status_idx" ON "automations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "automations_tenantId_triggerType_idx" ON "automations"("tenantId", "triggerType");

-- CreateIndex
CREATE INDEX "automations_nextRunAt_idx" ON "automations"("nextRunAt");

-- CreateIndex
CREATE INDEX "automation_runs_automationId_startedAt_idx" ON "automation_runs"("automationId", "startedAt");

-- CreateIndex
CREATE INDEX "automation_runs_status_startedAt_idx" ON "automation_runs"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
