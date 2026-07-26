-- MaliYorum: Mizan/Bilanço/Gelir Tablosu/İşletme Hesap Özeti için yapay zeka değerlendirmesi
CREATE TABLE "mali_yorum" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "kaynak" TEXT NOT NULL,
    "kaynakId" TEXT NOT NULL,
    "donem" TEXT,
    "ozet" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mali_yorum_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mali_yorum_tenantId_kaynak_kaynakId_key" ON "mali_yorum"("tenantId", "kaynak", "kaynakId");

CREATE INDEX "mali_yorum_tenantId_taxpayerId_kaynak_idx" ON "mali_yorum"("tenantId", "taxpayerId", "kaynak");
