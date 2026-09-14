-- 2026-09-14 e-Defter MANUEL kontrol kuralları (kullanıcı tanımlı; analizde çalışır, bulgu kodu MANUEL:<id>)
CREATE TABLE IF NOT EXISTS "edefter_manuel_kurallar" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "ad"           TEXT NOT NULL,
  "aciklama"     TEXT,
  "seviye"       TEXT NOT NULL DEFAULT 'WARN',
  "hesap"        TEXT NOT NULL,
  "kaynak"       TEXT NOT NULL DEFAULT 'MIZAN',
  "kosul"        TEXT NOT NULL,
  "esik"         DECIMAL(18,2),
  "herHesapAyri" BOOLEAN NOT NULL DEFAULT false,
  "donemKisiti"  TEXT NOT NULL DEFAULT 'HEPSI',
  "aktif"        BOOLEAN NOT NULL DEFAULT true,
  "createdBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "edefter_manuel_kurallar_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "edefter_manuel_kurallar_tenantId_aktif_idx"
  ON "edefter_manuel_kurallar"("tenantId", "aktif");
