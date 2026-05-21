-- v2 Fatura Merkezi — Hesap planı senkronizasyonu
-- Yerelde açılan hesapları Luca'da olanlardan ayırt etmek için source + syncedToLuca alanları
-- AlterTable
ALTER TABLE "luca_account_plan_lines"
  ADD COLUMN     "source"        TEXT,
  ADD COLUMN     "syncedToLuca"  BOOLEAN NOT NULL DEFAULT true;
