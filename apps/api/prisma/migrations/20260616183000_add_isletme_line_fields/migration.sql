-- AlterTable: InvoiceAccountingLine — isletme defteri alanları (v3.0)
ALTER TABLE "invoice_accounting_lines"
  ADD COLUMN IF NOT EXISTS "isletmeYon"       TEXT,
  ADD COLUMN IF NOT EXISTS "isletmeGiderTuru" TEXT,
  ADD COLUMN IF NOT EXISTS "isletmeMatrah"    DECIMAL(14,2);
