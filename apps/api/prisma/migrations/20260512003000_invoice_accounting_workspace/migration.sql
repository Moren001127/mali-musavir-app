CREATE TABLE IF NOT EXISTS "invoice_accounting_documents" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "taxpayerId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual-web',
  "documentType" TEXT NOT NULL DEFAULT 'OKC_FIS',
  "invoiceKind" TEXT NOT NULL DEFAULT 'ALIS',
  "status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "s3Key" TEXT NOT NULL,
  "imageHash" VARCHAR(64),
  "currency" TEXT NOT NULL DEFAULT 'TL',
  "exchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1,
  "belgeNo" TEXT,
  "seriNo" TEXT,
  "faturaTarihi" TIMESTAMP(3),
  "sellerVkn" TEXT,
  "buyerVkn" TEXT,
  "vendorName" TEXT,
  "customerName" TEXT,
  "totalAmount" DECIMAL(14,2),
  "ocrStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "ocrEngine" TEXT,
  "ocrRawText" TEXT,
  "ocrConfidence" DOUBLE PRECISION,
  "ocrData" JSONB,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_accounting_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invoice_accounting_lines" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "group" TEXT NOT NULL DEFAULT 'matrah',
  "accountCode" TEXT,
  "description" TEXT,
  "rate" TEXT,
  "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "orderNo" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_accounting_lines_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "invoice_accounting_lines"
    ADD CONSTRAINT "invoice_accounting_lines_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "invoice_accounting_documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "invoice_accounting_documents_tenantId_status_createdAt_idx"
  ON "invoice_accounting_documents"("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "invoice_accounting_documents_tenantId_taxpayerId_createdAt_idx"
  ON "invoice_accounting_documents"("tenantId", "taxpayerId", "createdAt");
CREATE INDEX IF NOT EXISTS "invoice_accounting_documents_tenantId_documentType_createdAt_idx"
  ON "invoice_accounting_documents"("tenantId", "documentType", "createdAt");
CREATE INDEX IF NOT EXISTS "invoice_accounting_documents_imageHash_idx"
  ON "invoice_accounting_documents"("imageHash");
CREATE INDEX IF NOT EXISTS "invoice_accounting_lines_documentId_orderNo_idx"
  ON "invoice_accounting_lines"("documentId", "orderNo");
