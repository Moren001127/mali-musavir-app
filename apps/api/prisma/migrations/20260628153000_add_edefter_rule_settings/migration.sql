CREATE TABLE "edefter_control_rule_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edefter_control_rule_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "edefter_control_rule_settings_tenantId_code_key" ON "edefter_control_rule_settings"("tenantId", "code");
CREATE INDEX "edefter_control_rule_settings_tenantId_active_idx" ON "edefter_control_rule_settings"("tenantId", "active");
