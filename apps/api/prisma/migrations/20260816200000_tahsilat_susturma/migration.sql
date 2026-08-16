-- Tahsilat otomasyonunda gecici susturma
CREATE TABLE "TahsilatSusturma" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "sebep" TEXT NOT NULL,
    "not" TEXT,
    "bitis" TIMESTAMP(3) NOT NULL,
    "kaynak" TEXT NOT NULL DEFAULT 'KULLANICI',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TahsilatSusturma_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TahsilatSusturma_tenantId_taxpayerId_idx" ON "TahsilatSusturma"("tenantId", "taxpayerId");
CREATE INDEX "TahsilatSusturma_tenantId_bitis_idx" ON "TahsilatSusturma"("tenantId", "bitis");
