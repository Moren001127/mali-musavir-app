-- MihsapInvoice.kaynak: kaydin hangi MIHSAP kaynagindan geldigi
--   "arsiv"    = Arsivim (Islenen Faturalar modulunun "Hepsini Cek"i)
--   "bekleyen" = Gelen Evraklar (Fatura Isleme Merkezi'nin "Mihsap'tan Cek"i)
ALTER TABLE "mihsap_invoices" ADD COLUMN IF NOT EXISTS "kaynak" TEXT;

-- Backfill: Fatura Isleme Merkezi'nden cekilen (bekleyen) kayitlar,
-- invoice_accounting_documents'ta source='mihsap' ile eslesen mihsapId'lerdir.
-- Bunlari "bekleyen" isaretle ki Islenen Faturalar modulu artik gizlesin.
-- (Arsivden cekilenlerin muhasebe belgesi olmadigi icin kaynak NULL kalir = gorunur.)
UPDATE "mihsap_invoices" mi
SET "kaynak" = 'bekleyen'
WHERE mi."kaynak" IS NULL
  AND EXISTS (
    SELECT 1 FROM "invoice_accounting_documents" d
    WHERE d."source" = 'mihsap' AND d."sourceRefId" = mi."mihsapId"
  );
