-- Moren Ofis — Hafıza katmanı
-- 1) Conversation'a summary + entities (long-term recall için)
-- 2) MorenOfisFact tablosu — subject-predicate-object kalıcı gerçekler

ALTER TABLE "moren_ofis_conversations"
  ADD COLUMN IF NOT EXISTS "summary" TEXT;

ALTER TABLE "moren_ofis_conversations"
  ADD COLUMN IF NOT EXISTS "entities" TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "moren_ofis_facts" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdByAgent" TEXT,
  "subject" TEXT NOT NULL,
  "predicate" TEXT NOT NULL,
  "object" TEXT NOT NULL,
  "importance" INTEGER NOT NULL DEFAULT 5,
  "sourceConvId" TEXT,
  "accessCount" INTEGER NOT NULL DEFAULT 0,
  "lastAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "moren_ofis_facts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "moren_ofis_facts_tenantId_subject_predicate_key"
  ON "moren_ofis_facts"("tenantId", "subject", "predicate");

CREATE INDEX IF NOT EXISTS "moren_ofis_facts_tenantId_subject_idx"
  ON "moren_ofis_facts"("tenantId", "subject");

CREATE INDEX IF NOT EXISTS "moren_ofis_facts_tenantId_importance_lastAccessedAt_idx"
  ON "moren_ofis_facts"("tenantId", "importance", "lastAccessedAt");
