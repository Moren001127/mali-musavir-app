-- Otomatik yazdirma altyapisi: fis_yazdirma_outputs tablosuna print alanlari ekle.
-- Lokal agent bu alanlari kullanarak Word ciktilarini Windows yazicisina otomatik gonderir.

ALTER TABLE "fis_yazdirma_outputs"
  ADD COLUMN "printStatus" TEXT,
  ADD COLUMN "printedAt" TIMESTAMP(3),
  ADD COLUMN "printError" TEXT,
  ADD COLUMN "printDeviceId" TEXT;

CREATE INDEX "fis_yazdirma_outputs_printStatus_idx" ON "fis_yazdirma_outputs"("printStatus");
