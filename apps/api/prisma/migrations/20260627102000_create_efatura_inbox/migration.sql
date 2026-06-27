CREATE TABLE IF NOT EXISTS "efatura_inbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "taxpayerId" TEXT NOT NULL,
  "entegrator" TEXT NOT NULL,
  "uuid" TEXT NOT NULL,
  "ettn" TEXT,
  "senderVkn" TEXT,
  "senderTitle" TEXT,
  "receiverVkn" TEXT,
  "faturaNo" TEXT,
  "faturaDate" TIMESTAMP(3),
  "matrah" DECIMAL(14,2),
  "kdv" DECIMAL(14,2),
  "toplam" DECIMAL(14,2),
  "paraBirimi" TEXT NOT NULL DEFAULT 'TRY',
  "direction" TEXT NOT NULL DEFAULT 'IN',
  "invoiceProfile" TEXT,
  "ublXmlKey" TEXT,
  "ublXmlRaw" TEXT,
  "rawJson" JSONB,
  "isTransferred" BOOLEAN NOT NULL DEFAULT false,
  "documentId" TEXT,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "markedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),

  CONSTRAINT "efatura_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "efatura_inbox_tenantId_taxpayerId_entegrator_uuid_key"
  ON "efatura_inbox"("tenantId", "taxpayerId", "entegrator", "uuid");

CREATE INDEX IF NOT EXISTS "efatura_inbox_tenantId_taxpayerId_faturaDate_idx"
  ON "efatura_inbox"("tenantId", "taxpayerId", "faturaDate");

CREATE INDEX IF NOT EXISTS "efatura_inbox_tenantId_isTransferred_idx"
  ON "efatura_inbox"("tenantId", "isTransferred");

CREATE INDEX IF NOT EXISTS "efatura_inbox_tenantId_entegrator_syncedAt_idx"
  ON "efatura_inbox"("tenantId", "entegrator", "syncedAt");
