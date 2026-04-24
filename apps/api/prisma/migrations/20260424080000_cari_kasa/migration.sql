-- CariHizmet: Mükellefe tanımlanan tekrar eden hizmetler
CREATE TABLE "cari_hizmetler" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "hizmetAdi" TEXT NOT NULL,
    "tutar" DECIMAL(14,2) NOT NULL,
    "periyot" TEXT NOT NULL,
    "baslangicAy" TEXT NOT NULL,
    "bitisAy" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "sonTahakkukAy" TEXT,
    "notlar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cari_hizmetler_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cari_hizmetler_tenantId_taxpayerId_idx" ON "cari_hizmetler"("tenantId", "taxpayerId");
CREATE INDEX "cari_hizmetler_tenantId_aktif_idx" ON "cari_hizmetler"("tenantId", "aktif");

ALTER TABLE "cari_hizmetler" ADD CONSTRAINT "cari_hizmetler_taxpayerId_fkey"
  FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CariHareket: Tahakkuk ve tahsilat hareketleri
CREATE TABLE "cari_hareketler" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "hizmetId" TEXT,
    "tarih" TIMESTAMP(3) NOT NULL,
    "tip" TEXT NOT NULL,
    "tutar" DECIMAL(14,2) NOT NULL,
    "aciklama" TEXT,
    "odemeYontemi" TEXT,
    "belgeNo" TEXT,
    "donem" TEXT,
    "otoOlusturuldu" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "cari_hareketler_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cari_hareketler_tenantId_taxpayerId_tarih_idx" ON "cari_hareketler"("tenantId", "taxpayerId", "tarih");
CREATE INDEX "cari_hareketler_tenantId_tarih_idx" ON "cari_hareketler"("tenantId", "tarih");
CREATE INDEX "cari_hareketler_tenantId_tip_idx" ON "cari_hareketler"("tenantId", "tip");

ALTER TABLE "cari_hareketler" ADD CONSTRAINT "cari_hareketler_taxpayerId_fkey"
  FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cari_hareketler" ADD CONSTRAINT "cari_hareketler_hizmetId_fkey"
  FOREIGN KEY ("hizmetId") REFERENCES "cari_hizmetler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
