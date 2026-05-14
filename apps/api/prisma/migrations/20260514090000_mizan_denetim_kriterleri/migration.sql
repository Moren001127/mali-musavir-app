CREATE TABLE "mizan_denetim_kriterleri" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ad" TEXT NOT NULL,
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  "hesapPattern" TEXT NOT NULL,
  "kosul" TEXT NOT NULL,
  "esik" DECIMAL(18, 2),
  "seviye" TEXT NOT NULL DEFAULT 'WARN',
  "mesaj" TEXT NOT NULL,
  "taxpayerId" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mizan_denetim_kriterleri_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mizan_denetim_kriterleri_tenantId_aktif_idx"
  ON "mizan_denetim_kriterleri"("tenantId", "aktif");

CREATE INDEX "mizan_denetim_kriterleri_tenantId_taxpayerId_idx"
  ON "mizan_denetim_kriterleri"("tenantId", "taxpayerId");
