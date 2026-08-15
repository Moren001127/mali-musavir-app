-- Butce modulu: 6 haneli giris PIN'i (argon2 hash) + brute-force koruması
ALTER TABLE "butce_ayarlar" ADD COLUMN IF NOT EXISTS "pinHash" TEXT;
ALTER TABLE "butce_ayarlar" ADD COLUMN IF NOT EXISTS "pinDenemeSayisi" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "butce_ayarlar" ADD COLUMN IF NOT EXISTS "pinKilitBitis" TIMESTAMP(3);
