-- GIB / SGK portal otomasyonu: sifre kasasi, is kuyrugu ve indirilen belge arsivi.

CREATE TABLE IF NOT EXISTS "portal_credentials" (
  "id"                         TEXT NOT NULL,
  "tenantId"                   TEXT NOT NULL,
  "provider"                   TEXT NOT NULL,
  "ownerType"                  TEXT NOT NULL,
  "ownerId"                    TEXT NOT NULL,
  "taxpayerId"                 TEXT,
  "username"                   TEXT,
  "userCode"                   TEXT,
  "officeCode"                 TEXT,
  "workplaceCode"              TEXT,
  "encryptedPassword"          TEXT,
  "encryptedSecondaryPassword" TEXT,
  "isActive"                   BOOLEAN NOT NULL DEFAULT true,
  "lastCheckedAt"              TIMESTAMP(3),
  "lastSuccessAt"              TIMESTAMP(3),
  "lastError"                  TEXT,
  "notes"                      TEXT,
  "updatedBy"                  TEXT,
  "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "portal_automation_jobs" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "taxpayerId"     TEXT,
  "jobType"        TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "source"         TEXT NOT NULL DEFAULT 'manual',
  "periodStart"    TIMESTAMP(3),
  "periodEnd"      TIMESTAMP(3),
  "donem"          TEXT,
  "payload"        JSONB,
  "result"         JSONB,
  "errorMessage"   TEXT,
  "recordCount"    INTEGER NOT NULL DEFAULT 0,
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "priority"       INTEGER NOT NULL DEFAULT 0,
  "targetDeviceId" TEXT,
  "createdBy"      TEXT,
  "scheduledAt"    TIMESTAMP(3),
  "startedAt"      TIMESTAMP(3),
  "finishedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_automation_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "portal_documents" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "taxpayerId"     TEXT,
  "jobId"          TEXT,
  "belgeTuru"      TEXT NOT NULL,
  "sourceProvider" TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "referenceNo"    TEXT,
  "period"         TEXT,
  "issuedAt"       TIMESTAMP(3),
  "receivedAt"     TIMESTAMP(3),
  "mimeType"       TEXT,
  "sizeBytes"      INTEGER,
  "storageKey"     TEXT,
  "documentId"     TEXT,
  "raw"            JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "portal_credentials_unique"
  ON "portal_credentials" ("tenantId", "provider", "ownerType", "ownerId");
CREATE INDEX IF NOT EXISTS "portal_credentials_tenant_provider_active_idx"
  ON "portal_credentials" ("tenantId", "provider", "isActive");
CREATE INDEX IF NOT EXISTS "portal_credentials_taxpayerId_idx"
  ON "portal_credentials" ("taxpayerId");

CREATE INDEX IF NOT EXISTS "portal_automation_jobs_tenant_status_created_idx"
  ON "portal_automation_jobs" ("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "portal_automation_jobs_tenant_type_created_idx"
  ON "portal_automation_jobs" ("tenantId", "jobType", "createdAt");
CREATE INDEX IF NOT EXISTS "portal_automation_jobs_tenant_source_scheduled_idx"
  ON "portal_automation_jobs" ("tenantId", "source", "scheduledAt");
CREATE INDEX IF NOT EXISTS "portal_automation_jobs_taxpayer_type_created_idx"
  ON "portal_automation_jobs" ("taxpayerId", "jobType", "createdAt");

CREATE INDEX IF NOT EXISTS "portal_documents_tenant_tur_created_idx"
  ON "portal_documents" ("tenantId", "belgeTuru", "createdAt");
CREATE INDEX IF NOT EXISTS "portal_documents_tenant_provider_created_idx"
  ON "portal_documents" ("tenantId", "sourceProvider", "createdAt");
CREATE INDEX IF NOT EXISTS "portal_documents_taxpayer_tur_created_idx"
  ON "portal_documents" ("taxpayerId", "belgeTuru", "createdAt");
CREATE INDEX IF NOT EXISTS "portal_documents_jobId_idx"
  ON "portal_documents" ("jobId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'portal_credentials_tenantId_fkey'
  ) THEN
    ALTER TABLE "portal_credentials"
      ADD CONSTRAINT "portal_credentials_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'portal_credentials_taxpayerId_fkey'
  ) THEN
    ALTER TABLE "portal_credentials"
      ADD CONSTRAINT "portal_credentials_taxpayerId_fkey"
      FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'portal_automation_jobs_tenantId_fkey'
  ) THEN
    ALTER TABLE "portal_automation_jobs"
      ADD CONSTRAINT "portal_automation_jobs_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'portal_automation_jobs_taxpayerId_fkey'
  ) THEN
    ALTER TABLE "portal_automation_jobs"
      ADD CONSTRAINT "portal_automation_jobs_taxpayerId_fkey"
      FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'portal_documents_tenantId_fkey'
  ) THEN
    ALTER TABLE "portal_documents"
      ADD CONSTRAINT "portal_documents_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'portal_documents_taxpayerId_fkey'
  ) THEN
    ALTER TABLE "portal_documents"
      ADD CONSTRAINT "portal_documents_taxpayerId_fkey"
      FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'portal_documents_jobId_fkey'
  ) THEN
    ALTER TABLE "portal_documents"
      ADD CONSTRAINT "portal_documents_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "portal_automation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
