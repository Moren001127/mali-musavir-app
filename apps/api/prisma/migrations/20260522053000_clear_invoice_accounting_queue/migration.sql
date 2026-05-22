-- One-time cleanup requested for retesting Fatura Isleme Merkezi e-Arsiv import.
-- This clears only the processing-center queue, not the source e-Arsiv archive.
UPDATE "luca_fetch_jobs"
SET "invoiceDocumentId" = NULL
WHERE "invoiceDocumentId" IS NOT NULL;

DELETE FROM "invoice_accounting_lines";
DELETE FROM "invoice_accounting_documents";
