-- SÜRÜM DOSYA BİLGİSİ (portal denetimi bulgu 36b, 25 Eylül 2026)
--
-- `document_versions` tablosunda dosya türü ve özgün ad YOKTU. 25 Eylül'deki ilk
-- düzeltme türü NESNE ANAHTARI UZANTISINDAN çıkarıyor; uzantısız anahtarlarda
-- güncel belgenin türüne düşüyor. Yani v1 JPG, v2 PDF ise v1 "application/pdf"
-- Content-Type'ıyla iniyor ve tarayıcı bozuk gösteriyordu.
--
-- İki sütun da NULLABLE ve EKLEMELİ: mevcut hiçbir satır/veri değişmiyor.
-- GERİ DOLUM YAPILMIYOR: eski satırlarda gerçek tür bilinmiyor. En fazla
-- uzantıdan türetilebilirdi, o da çalışma anında zaten yapılıyor. NULL kalan
-- satırlarda uzantı tabanlı mevcut davranış sürer.
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "mimeType" TEXT;
ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "originalName" TEXT;
