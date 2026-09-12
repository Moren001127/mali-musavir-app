-- PLAN/16 F (Mukellefler listesi - faaliyet tanimi): kisa sektor etiketi.
-- NULLABLE - mevcut kayitlar bos kalir; Fatura Merkezi > Mukellefler listesinden / "NACE oner" ile dolar.

-- AlterTable
ALTER TABLE "taxpayers" ADD COLUMN "sektorEtiketi" TEXT;
