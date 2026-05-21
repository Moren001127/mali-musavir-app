-- v1.38: Fatura Isleme Merkezi -> Luca'ya muhasebe fisi aktarimi
-- INVOICE_POST job tipi icin gerekli alanlar ve indexler.

-- 1) InvoiceAccountingDocument'a Luca aktarim izi alanlari
ALTER TABLE "invoice_accounting_documents"
  ADD COLUMN "lucaStatus"       TEXT NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "lucaJobId"        TEXT,
  ADD COLUMN "lucaPostedAt"     TIMESTAMP(3),
  ADD COLUMN "lucaErrorMessage" TEXT,
  ADD COLUMN "lucaAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lucaFisNo"        TEXT;

-- 2) LucaFetchJob'a generic payload ve invoice baglantisi
ALTER TABLE "luca_fetch_jobs"
  ADD COLUMN "payload"           JSONB,
  ADD COLUMN "invoiceDocumentId" TEXT;

-- 3) Yeni index'ler
CREATE INDEX "invoice_accounting_documents_tenantId_lucaStatus_idx"
  ON "invoice_accounting_documents" ("tenantId", "lucaStatus");

CREATE INDEX "luca_fetch_jobs_invoiceDocumentId_idx"
  ON "luca_fetch_jobs" ("invoiceDocumentId");
