-- Mükellef Banka Takip modülü
-- 1) Taxpayer.defterTuru genel alan
-- 2) BankaHesap (banka_hesaplari)
-- 3) BankaEkstreKaydi (banka_ekstre_kayitlari)

ALTER TABLE "taxpayers"
  ADD COLUMN IF NOT EXISTS "defterTuru" TEXT;

CREATE TABLE IF NOT EXISTS "banka_hesaplari" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "taxpayerId" TEXT NOT NULL,
  "bankaAdi" TEXT NOT NULL,
  "hesapNo" TEXT,
  "iban" TEXT,
  "sube" TEXT,
  "paraBirimi" TEXT NOT NULL DEFAULT 'TRY',
  "aciklama" TEXT,
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  "sira" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "banka_hesaplari_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "banka_hesaplari_tenantId_idx" ON "banka_hesaplari"("tenantId");
CREATE INDEX IF NOT EXISTS "banka_hesaplari_taxpayerId_idx" ON "banka_hesaplari"("taxpayerId");

ALTER TABLE "banka_hesaplari"
  ADD CONSTRAINT "banka_hesaplari_taxpayerId_fkey"
  FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "banka_ekstre_kayitlari" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "taxpayerId" TEXT NOT NULL,
  "bankaHesapId" TEXT,
  "donem" TEXT NOT NULL,
  "ekstreGeldi" BOOLEAN NOT NULL DEFAULT false,
  "geldiTarihi" TIMESTAMP(3),
  "ekstreIslendi" BOOLEAN NOT NULL DEFAULT false,
  "islenmeTarihi" TIMESTAMP(3),
  "islenmeNotu" TEXT,
  "notlar" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "banka_ekstre_kayitlari_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "banka_ekstre_kayitlari_unique"
  ON "banka_ekstre_kayitlari"("tenantId", "taxpayerId", "bankaHesapId", "donem");
CREATE INDEX IF NOT EXISTS "banka_ekstre_kayitlari_donem_idx" ON "banka_ekstre_kayitlari"("tenantId", "donem");
CREATE INDEX IF NOT EXISTS "banka_ekstre_kayitlari_tax_donem_idx" ON "banka_ekstre_kayitlari"("taxpayerId", "donem");

ALTER TABLE "banka_ekstre_kayitlari"
  ADD CONSTRAINT "banka_ekstre_kayitlari_taxpayerId_fkey"
  FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "banka_ekstre_kayitlari"
  ADD CONSTRAINT "banka_ekstre_kayitlari_bankaHesapId_fkey"
  FOREIGN KEY ("bankaHesapId") REFERENCES "banka_hesaplari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
