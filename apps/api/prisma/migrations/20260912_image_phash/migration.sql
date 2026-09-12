-- PLAN/16 §C (Fatura Merkezi mükerrer / görsel benzerlik): algısal hash (dHash 64 bit, hex 16).
-- NULLABLE — mevcut kayıtlar boş kalır; yükleme anında dolar, geçmiş "reprocess-broken {mode:'phash-doldur'}" ile doldurulur.
-- Hamming ≤ 6 → MUKERRER_GORSEL uyarısı (engel değil).

-- AlterTable
ALTER TABLE "invoice_accounting_documents" ADD COLUMN IF NOT EXISTS "imagePhash" VARCHAR(16);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoice_accounting_documents_tenantId_imagePhash_idx" ON "invoice_accounting_documents"("tenantId", "imagePhash");
