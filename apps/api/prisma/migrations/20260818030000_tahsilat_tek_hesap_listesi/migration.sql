-- TEK HESAP LISTESI.
--
-- Onceden iki ayri hesap tablosu vardi (office_financial_accounts ve
-- butce_banka_hesaplar) ve aralarinda ELLE kurulan bir "baglanti" kavrami
-- vardi. Hesabi Kisisel Butce'de acan kisi onu tahsilat formunda da gormeli;
-- ikinci bir liste ve baglama adimi gereksizdi.
--
-- Artik cari_hareketler.accountId DOGRUDAN butce_banka_hesaplar'i gosteriyor.
-- Hangi hesabin tahsilat formunda cikacagini "tahsilataAcik" belirler: bazi
-- hesaba hic tahsilat gelmiyor, hepsini listelemek kutuyu kalabalik yapardi.
--
-- GUVENLI: bu goc yazilirken cari_hareketler'deki 600 TAHSILAT satirinin
-- TAMAMININ accountId degeri NULL'di ve office_financial_accounts'a bagli tek
-- bir kayit yoktu. FK degisimi dogrulayacak satir bulmuyor.

ALTER TABLE "butce_banka_hesaplar" ADD COLUMN IF NOT EXISTS "tahsilataAcik" BOOLEAN NOT NULL DEFAULT false;

-- Eski baglantidan kalan esleme varsa tahsilat anahtarina cevrilsin
-- (kolon dusurulmeden once calismali).
--
-- DINAMIK SQL SART: duz bir UPDATE'te Postgres cumlenin tamamini calistirmadan
-- ONCE ad cozumlemesinden gecirir; kolon dusurulmusse WHERE EXISTS hic
-- degerlendirilmez, dogrudan 42703 duser. Bu dosya kendi dayandigi kolonu
-- asagida dusurdugu icin ikinci calisma olumcul olurdu: migrate deploy hata
-- verir, package.json'daki "&&" zinciri kirilir ve API hic acilmaz.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'office_financial_accounts'
       AND column_name = 'butceBankaHesapId'
  ) THEN
    EXECUTE '
      UPDATE "butce_banka_hesaplar" b
         SET "tahsilataAcik" = true
       WHERE b.id IN (
         SELECT o."butceBankaHesapId" FROM "office_financial_accounts" o
          WHERE o."butceBankaHesapId" IS NOT NULL
       )';
  END IF;
END $$;

-- cari_hareketler.accountId -> butce_banka_hesaplar
ALTER TABLE "cari_hareketler" DROP CONSTRAINT IF EXISTS "cari_hareketler_accountId_fkey";

-- Yayin aninda eski surum office_financial_accounts.id yazmis olabilir; sahipsiz
-- kimlik FK dogrulamasini dusurur ve API acilmaz. NOT EXISTS kullaniliyor:
-- NOT IN, alt sorgu NULL dondurdugunde sessizce hicbir satiri secmez.
UPDATE "cari_hareketler"
   SET "accountId" = NULL
 WHERE "accountId" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "butce_banka_hesaplar" b WHERE b."id" = "cari_hareketler"."accountId"
   );

ALTER TABLE "cari_hareketler" ADD CONSTRAINT "cari_hareketler_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "butce_banka_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Koprü kolonu artik gereksiz
ALTER TABLE "office_financial_accounts" DROP CONSTRAINT IF EXISTS "office_financial_accounts_butceBankaHesapId_fkey";
DROP INDEX IF EXISTS "office_financial_accounts_butceBankaHesapId_idx";
ALTER TABLE "office_financial_accounts" DROP COLUMN IF EXISTS "butceBankaHesapId";
