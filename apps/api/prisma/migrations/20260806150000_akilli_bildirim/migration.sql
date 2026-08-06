-- Akıllı Bildirim: belge dağıtım motoru tabloları (idempotent)

CREATE TABLE IF NOT EXISTS "smart_dispatch_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kategori" TEXT NOT NULL,
    "whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "sendHour" INTEGER NOT NULL DEFAULT 9,
    "manualInstant" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "testPhone" TEXT,
    "testEmail" TEXT,
    "excludedTaxpayerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "smart_dispatch_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "smart_dispatch_settings_tenantId_kategori_key"
    ON "smart_dispatch_settings"("tenantId", "kategori");

CREATE TABLE IF NOT EXISTS "document_dispatches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "kategori" TEXT NOT NULL,
    "donem" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2),
    "docRefs" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_dispatches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_dispatches_tenantId_dedupeKey_channel_key"
    ON "document_dispatches"("tenantId", "dedupeKey", "channel");
CREATE INDEX IF NOT EXISTS "document_dispatches_tenantId_createdAt_idx"
    ON "document_dispatches"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "document_dispatches_tenantId_taxpayerId_kategori_idx"
    ON "document_dispatches"("tenantId", "taxpayerId", "kategori");
