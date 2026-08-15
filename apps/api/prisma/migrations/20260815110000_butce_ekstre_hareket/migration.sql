-- Bütçe: kredi kartı ekstre hareketleri (PDF içe aktarma) + satıcı öğrenme hafızası

CREATE TABLE IF NOT EXISTS "butce_kart_hareketler" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ekstreId" TEXT NOT NULL,
    "tarih" TIMESTAMP(3) NOT NULL,
    "aciklama" TEXT NOT NULL,
    "satici" TEXT,
    "tutar" DECIMAL(14,2) NOT NULL,
    "taksitBilgi" TEXT,
    "kategoriId" TEXT,
    "kategoriKaynak" TEXT NOT NULL DEFAULT 'AI',
    "onaylandi" BOOLEAN NOT NULL DEFAULT false,
    "islemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "butce_kart_hareketler_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "butce_kart_hareketler_tenantId_userId_ekstreId_idx" ON "butce_kart_hareketler"("tenantId", "userId", "ekstreId");

CREATE TABLE IF NOT EXISTS "butce_satici_hafiza" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "satici" TEXT NOT NULL,
    "kategoriId" TEXT NOT NULL,
    "sayac" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "butce_satici_hafiza_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "butce_satici_hafiza_tenantId_userId_satici_key" ON "butce_satici_hafiza"("tenantId", "userId", "satici");

ALTER TABLE "butce_kart_hareketler" ADD CONSTRAINT "butce_kart_hareketler_ekstreId_fkey" FOREIGN KEY ("ekstreId") REFERENCES "butce_kart_ekstreler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "butce_kart_hareketler" ADD CONSTRAINT "butce_kart_hareketler_kategoriId_fkey" FOREIGN KEY ("kategoriId") REFERENCES "butce_kategoriler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "butce_satici_hafiza" ADD CONSTRAINT "butce_satici_hafiza_kategoriId_fkey" FOREIGN KEY ("kategoriId") REFERENCES "butce_kategoriler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
