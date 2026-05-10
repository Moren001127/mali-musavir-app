CREATE TABLE IF NOT EXISTS "ai_memories" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "taxpayerId" TEXT,
  "scope" TEXT NOT NULL DEFAULT 'office',
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "source" TEXT,
  "importance" INTEGER NOT NULL DEFAULT 3,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_memories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_memories_tenantId_scope_isActive_idx" ON "ai_memories"("tenantId", "scope", "isActive");
CREATE INDEX IF NOT EXISTS "ai_memories_tenantId_taxpayerId_isActive_idx" ON "ai_memories"("tenantId", "taxpayerId", "isActive");
CREATE INDEX IF NOT EXISTS "ai_memories_tenantId_updatedAt_idx" ON "ai_memories"("tenantId", "updatedAt");
