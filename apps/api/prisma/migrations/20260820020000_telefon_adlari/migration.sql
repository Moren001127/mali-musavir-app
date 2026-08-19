-- TELEFON REHBERI (2026-08-20)
--
-- Her telefon numarasinin yanina kullanicinin yazdigi ad. WhatsApp Mesajlar
-- ekraninda firma adi yerine bu ad gosterilir; numara -> mukellef eslestirmesi
-- DEGISMEZ.
--
-- Bicim: {"905339233674": "Umut Balcik", "905079270870": "Muhasebeci Ayse"}
-- Anahtar NORMALIZE numara. Paralel dizi kullanilmadi: phones dizisi arka
-- planda yeniden yaziliyor, sira kayinca ad yanlis numaraya yapisirdi.

ALTER TABLE "taxpayers" ADD COLUMN IF NOT EXISTS "telefonAdlari" JSONB;
