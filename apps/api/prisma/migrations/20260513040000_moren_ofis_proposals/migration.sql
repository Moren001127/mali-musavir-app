-- DENİZ'in önerileri ve gece raporu kuyruğu
CREATE TABLE IF NOT EXISTS "moren_ofis_proposals" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "category" TEXT NOT NULL DEFAULT 'feature',
  "status" TEXT NOT NULL DEFAULT 'open',
  "patronNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "moren_ofis_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "moren_ofis_proposals_tenantId_status_createdAt_idx"
  ON "moren_ofis_proposals"("tenantId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "moren_ofis_proposals_tenantId_category_idx"
  ON "moren_ofis_proposals"("tenantId", "category");
