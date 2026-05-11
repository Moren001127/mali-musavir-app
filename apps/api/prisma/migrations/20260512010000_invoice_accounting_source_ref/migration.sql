ALTER TABLE "invoice_accounting_documents"
  ADD COLUMN IF NOT EXISTS "sourceRefId" TEXT;

CREATE INDEX IF NOT EXISTS "invoice_accounting_documents_tenantId_source_sourceRefId_idx"
  ON "invoice_accounting_documents"("tenantId", "source", "sourceRefId");
