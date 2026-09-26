-- SGK e-Rapor (vizite) + hastane iş kazası — WS_Vizite web servisi (2026-09-26)
-- CreateTable
CREATE TABLE "sgk_raporlar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "medulaRaporId" TEXT NOT NULL,
    "tcKimlikNo" TEXT NOT NULL,
    "adSoyad" TEXT NOT NULL,
    "vaka" TEXT,
    "vakaAdi" TEXT,
    "raporTakipNo" TEXT,
    "raporSiraNo" TEXT,
    "poliklinikTarihi" TEXT,
    "raporBaslangic" TEXT,
    "raporBitis" TEXT,
    "isbasiKontrolTarihi" TEXT,
    "isKazasiTarihi" TEXT,
    "raporDurumuKodu" TEXT,
    "durum" TEXT NOT NULL,
    "bekleyenListede" BOOLEAN NOT NULL DEFAULT false,
    "onayliListede" BOOLEAN NOT NULL DEFAULT false,
    "onayParcalari" JSONB,
    "detayAt" TIMESTAMP(3),
    "ilkGorulme" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sonGorulme" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sgk_raporlar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sgk_is_kazalari" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "bildirimId" TEXT NOT NULL,
    "tcKimlikNo" TEXT NOT NULL,
    "adSoyad" TEXT,
    "cinsiyet" TEXT,
    "isKazasiTarihi" TEXT,
    "provizyonTarihi" TEXT,
    "provizyonTipi" TEXT,
    "tesisAdi" TEXT,
    "unvani" TEXT,
    "islemTuru" TEXT,
    "sgkBildirimSonGun" TEXT,
    "ilkGorulme" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sonGorulme" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sgk_is_kazalari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sgk_rapor_islemleri" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "raporId" TEXT NOT NULL,
    "medulaRaporId" TEXT NOT NULL,
    "islem" TEXT NOT NULL,
    "istek" JSONB NOT NULL,
    "basarili" BOOLEAN NOT NULL DEFAULT false,
    "sonucKod" INTEGER,
    "sonucAciklama" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sgk_rapor_islemleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sgk_vizite_durumlari" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "ilkBasariAt" TIMESTAMP(3),
    "sonSorguAt" TIMESTAMP(3),
    "sonBasariAt" TIMESTAMP(3),
    "sonHata" TEXT,
    "sonHataKod" INTEGER,
    "sonKaynak" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sgk_vizite_durumlari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sgk_raporlar_tenantId_durum_idx" ON "sgk_raporlar"("tenantId", "durum");

-- CreateIndex
CREATE UNIQUE INDEX "sgk_raporlar_tenantId_taxpayerId_medulaRaporId_key" ON "sgk_raporlar"("tenantId", "taxpayerId", "medulaRaporId");

-- CreateIndex
CREATE INDEX "sgk_is_kazalari_tenantId_isKazasiTarihi_idx" ON "sgk_is_kazalari"("tenantId", "isKazasiTarihi");

-- CreateIndex
CREATE UNIQUE INDEX "sgk_is_kazalari_tenantId_taxpayerId_bildirimId_key" ON "sgk_is_kazalari"("tenantId", "taxpayerId", "bildirimId");

-- CreateIndex
CREATE INDEX "sgk_rapor_islemleri_tenantId_raporId_idx" ON "sgk_rapor_islemleri"("tenantId", "raporId");

-- CreateIndex
CREATE UNIQUE INDEX "sgk_vizite_durumlari_taxpayerId_key" ON "sgk_vizite_durumlari"("taxpayerId");

-- CreateIndex
CREATE INDEX "sgk_vizite_durumlari_tenantId_idx" ON "sgk_vizite_durumlari"("tenantId");

-- AddForeignKey
ALTER TABLE "sgk_raporlar" ADD CONSTRAINT "sgk_raporlar_taxpayerId_fkey" FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sgk_is_kazalari" ADD CONSTRAINT "sgk_is_kazalari_taxpayerId_fkey" FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sgk_vizite_durumlari" ADD CONSTRAINT "sgk_vizite_durumlari_taxpayerId_fkey" FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

