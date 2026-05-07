-- System Health Watchdog tablosu
CREATE TABLE "system_health_checks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB,
    "acilTavsiye" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "system_health_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_health_checks_tenantId_severity_resolved_idx" ON "system_health_checks"("tenantId", "severity", "resolved");
CREATE INDEX "system_health_checks_type_createdAt_idx" ON "system_health_checks"("type", "createdAt");
