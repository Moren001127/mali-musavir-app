ALTER TABLE "invoice_accounting_documents"
  ADD COLUMN IF NOT EXISTS "duplicateOfId" TEXT,
  ADD COLUMN IF NOT EXISTS "duplicateReason" TEXT,
  ADD COLUMN IF NOT EXISTS "duplicateSeverity" TEXT;

CREATE INDEX IF NOT EXISTS "invoice_accounting_documents_tenantId_duplicateOfId_idx"
  ON "invoice_accounting_documents"("tenantId", "duplicateOfId");

CREATE TABLE IF NOT EXISTS "luca_account_plan_snapshots" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "taxpayerId" TEXT NOT NULL,
  "sourceJobId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "accountCount" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "luca_account_plan_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "luca_account_plan_lines" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "accountCode" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "level" INTEGER NOT NULL DEFAULT 0,
  "debitBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "creditBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "luca_account_plan_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "luca_account_plan_snapshots_tenantId_taxpayerId_createdAt_idx"
  ON "luca_account_plan_snapshots"("tenantId", "taxpayerId", "createdAt");

CREATE INDEX IF NOT EXISTS "luca_account_plan_snapshots_sourceJobId_idx"
  ON "luca_account_plan_snapshots"("sourceJobId");

CREATE INDEX IF NOT EXISTS "luca_account_plan_lines_snapshotId_accountCode_idx"
  ON "luca_account_plan_lines"("snapshotId", "accountCode");

DO $$
BEGIN
  ALTER TABLE "luca_account_plan_lines"
    ADD CONSTRAINT "luca_account_plan_lines_snapshotId_fkey"
    FOREIGN KEY ("snapshotId")
    REFERENCES "luca_account_plan_snapshots"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
