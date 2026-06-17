-- Galeri HGS ihlal sorgu sonuc ozetinin gonderilecegi WhatsApp numaralari (ofis bazli).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "galeriHgsPhones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
