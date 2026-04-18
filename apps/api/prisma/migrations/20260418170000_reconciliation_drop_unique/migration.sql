-- Çok oranlı KDV faturaları için reconciliation unique constraint'i kaldır
-- Aynı Mihsap/OCR fatura görseli birden fazla Luca satırı ile eşleşebilir
-- (ör. fatura içinde hem %20 hem %10 kalemler varsa Luca'da 2 satır olur)
-- Eski @unique kısıtı bu eşleşmede "Unique constraint failed on imageId" hatası
-- fırlatıyordu. Kısıtı kaldırıyoruz, uygulama katmanında duplicate önleniyor.

DROP INDEX IF EXISTS "reconciliation_results_imageId_key";
DROP INDEX IF EXISTS "reconciliation_results_kdvRecordId_key";

-- Performans için non-unique index ekle (hâlâ bu alanlardan sorgu yapılıyor)
CREATE INDEX IF NOT EXISTS "reconciliation_results_imageId_idx"
  ON "reconciliation_results"("imageId");
CREATE INDEX IF NOT EXISTS "reconciliation_results_kdvRecordId_idx"
  ON "reconciliation_results"("kdvRecordId");
