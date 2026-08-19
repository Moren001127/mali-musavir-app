-- EARSIV MUKERRER ANAHTARI: satici VKN'si eklendi.
-- SEBEP (canli bulgu 2026-08-20): GIB belge numarasi KURESEL BENZERSIZ DEGIL; farkli saticilar
--   ayni numarayi kullanabiliyor. Eski anahtar saticiyi icermedigi icin ikinci fatura "ayni kayit"
--   sanilip SESSIZCE eleniyordu (YORGUN NAKLIYAT Temmuz: Luca'da 30, portalda 25 fatura; 5 cift).
-- Anahtar GENISLETILIYOR (daha az kisitlayici) -> mevcut satirlarda ihlal olusturamaz.

DROP INDEX IF EXISTS "earsiv_faturalar_tenantId_taxpayerId_tip_belgeKaynak_faturaNo_k";
DROP INDEX IF EXISTS "earsiv_faturalar_tenant_taxpayer_tip_kaynak_no_key";

CREATE UNIQUE INDEX "earsiv_faturalar_tenant_taxpayer_tip_kaynak_no_satici_key"
  ON "earsiv_faturalar" ("tenantId", "taxpayerId", "tip", "belgeKaynak", "faturaNo", "saticiVergiNo");
