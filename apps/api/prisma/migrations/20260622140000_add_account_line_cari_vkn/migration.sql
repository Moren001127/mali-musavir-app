-- Mihsap modeli: yeni hesap açma — cari işareti + VKN/TCKN (Luca formuna girilir)
ALTER TABLE "luca_account_plan_lines" ADD COLUMN "isCari" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "luca_account_plan_lines" ADD COLUMN "vkn" TEXT;
