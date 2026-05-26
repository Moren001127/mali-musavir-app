CREATE TABLE "owner_approval_requests" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "previewId" TEXT NOT NULL,
  "userId" TEXT,
  "ownerPhone" TEXT,
  "aiConversationId" TEXT,
  "agent" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "impact" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "responseText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "owner_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_approval_requests_previewId_key"
  ON "owner_approval_requests"("previewId");

CREATE INDEX "owner_approval_requests_tenantId_status_expiresAt_idx"
  ON "owner_approval_requests"("tenantId", "status", "expiresAt");

CREATE INDEX "owner_approval_requests_tenantId_createdAt_idx"
  ON "owner_approval_requests"("tenantId", "createdAt");
