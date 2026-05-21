-- v2.1 Fatura Merkezi — Veri kalite kontrolü + çoklu KDV oranı desteği
--
-- 1) EarsivFatura.kdvBreakdown — UBL TaxSubtotal'lardan çıkarılmış oran-bazlı detay.
--    Şekil: [{ rate, base, amount }, ...]
--
-- 2) InvoiceAccountingDocument validation alanları:
--    validationStatus: OK | INCOMPLETE | INVALID
--    validationIssues: [{ code, severity, message, expected?, actual? }]
--    validationCheckedAt: Son ne zaman kontrol edildi
--    Codes: INCOMPLETE_AMOUNTS, BALANCE_MISMATCH, TOTAL_MISMATCH, OWNERSHIP_MISMATCH

-- AlterTable: e-Arşiv kayıtlarına çoklu KDV breakdown (idempotent)
ALTER TABLE "earsiv_faturalar"
  ADD COLUMN IF NOT EXISTS "kdvBreakdown" JSONB;

-- AlterTable: Muhasebe belgelerine validation kolonları (idempotent)
ALTER TABLE "invoice_accounting_documents"
  ADD COLUMN IF NOT EXISTS "validationStatus"    TEXT,
  ADD COLUMN IF NOT EXISTS "validationIssues"    JSONB,
  ADD COLUMN IF NOT EXISTS "validationCheckedAt" TIMESTAMP(3);

-- CreateIndex: Validation durumuna göre hızlı filtreleme (idempotent)
CREATE INDEX IF NOT EXISTS "invoice_accounting_documents_tenantId_validationStatus_idx"
  ON "invoice_accounting_documents"("tenantId", "validationStatus");
