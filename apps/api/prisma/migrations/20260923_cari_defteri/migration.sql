-- Cari defteri: VKN -> unvan + vergi dairesi + adres (kaynak: elimizdeki UBL XML arsivi)
ALTER TABLE "vendor_memory" ADD COLUMN IF NOT EXISTS "vergiDairesi" TEXT;
ALTER TABLE "vendor_memory" ADD COLUMN IF NOT EXISTS "adres" TEXT;
ALTER TABLE "vendor_memory" ADD COLUMN IF NOT EXISTS "cariKaynak" TEXT;
