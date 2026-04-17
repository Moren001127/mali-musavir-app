-- Mizan snapshot
CREATE TABLE "mizanlar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "donem" TEXT NOT NULL,
    "donemTipi" TEXT NOT NULL DEFAULT 'AYLIK',
    "kaynak" TEXT NOT NULL DEFAULT 'LUCA',
    "status" TEXT NOT NULL DEFAULT 'READY',
    "notes" TEXT,
    "rawExcelKey" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mizanlar_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mizanlar_tenantId_taxpayerId_donem_idx" ON "mizanlar"("tenantId", "taxpayerId", "donem");
CREATE INDEX "mizanlar_tenantId_createdAt_idx" ON "mizanlar"("tenantId", "createdAt");

-- Mizan hesap satırları
CREATE TABLE "mizan_hesaplar" (
    "id" TEXT NOT NULL,
    "mizanId" TEXT NOT NULL,
    "hesapKodu" TEXT NOT NULL,
    "hesapAdi" TEXT NOT NULL,
    "seviye" INTEGER NOT NULL DEFAULT 0,
    "borcToplami" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "alacakToplami" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "borcBakiye" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "alacakBakiye" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rowIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "mizan_hesaplar_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mizan_hesaplar_mizanId_hesapKodu_idx" ON "mizan_hesaplar"("mizanId", "hesapKodu");

ALTER TABLE "mizan_hesaplar" ADD CONSTRAINT "mizan_hesaplar_mizanId_fkey"
    FOREIGN KEY ("mizanId") REFERENCES "mizanlar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mizan denetim anomalileri
CREATE TABLE "mizan_anomaliler" (
    "id" TEXT NOT NULL,
    "mizanId" TEXT NOT NULL,
    "hesapKodu" TEXT,
    "tip" TEXT NOT NULL,
    "seviye" TEXT NOT NULL DEFAULT 'WARN',
    "mesaj" TEXT NOT NULL,
    "detay" JSONB,

    CONSTRAINT "mizan_anomaliler_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mizan_anomaliler_mizanId_idx" ON "mizan_anomaliler"("mizanId");

ALTER TABLE "mizan_anomaliler" ADD CONSTRAINT "mizan_anomaliler_mizanId_fkey"
    FOREIGN KEY ("mizanId") REFERENCES "mizanlar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Gelir Tablosu
CREATE TABLE "gelir_tablolari" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "mizanId" TEXT,
    "donem" TEXT NOT NULL,
    "donemTipi" TEXT NOT NULL DEFAULT 'GECICI_Q1',
    "donemBaslangic" TIMESTAMP(3),
    "donemBitis" TIMESTAMP(3),
    "brutSatislar" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "satisIndirimleri" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netSatislar" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "satisMaliyeti" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "brutSatisKari" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "faaliyetGiderleri" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "faaliyetKari" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "digerGelirler" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "digerGiderler" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "finansmanGiderleri" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "olaganKar" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "olaganDisiGelir" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "olaganDisiGider" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "donemKari" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vergiKarsiligi" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "donemNetKari" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "detay" JSONB,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gelir_tablolari_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gelir_tablolari_tenantId_taxpayerId_donem_idx" ON "gelir_tablolari"("tenantId", "taxpayerId", "donem");
CREATE INDEX "gelir_tablolari_tenantId_createdAt_idx" ON "gelir_tablolari"("tenantId", "createdAt");

ALTER TABLE "gelir_tablolari" ADD CONSTRAINT "gelir_tablolari_mizanId_fkey"
    FOREIGN KEY ("mizanId") REFERENCES "mizanlar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bilanço
CREATE TABLE "bilancolar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "mizanId" TEXT,
    "donem" TEXT NOT NULL,
    "donemTipi" TEXT NOT NULL DEFAULT 'AYLIK',
    "tarih" TIMESTAMP(3),
    "donenVarliklar" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "duranVarliklar" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aktifToplami" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "kvYabanciKaynak" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "uvYabanciKaynak" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ozkaynaklar" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pasifToplami" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aktif" JSONB NOT NULL,
    "pasif" JSONB NOT NULL,
    "detay" JSONB,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bilancolar_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bilancolar_tenantId_taxpayerId_donem_idx" ON "bilancolar"("tenantId", "taxpayerId", "donem");
CREATE INDEX "bilancolar_tenantId_createdAt_idx" ON "bilancolar"("tenantId", "createdAt");

ALTER TABLE "bilancolar" ADD CONSTRAINT "bilancolar_mizanId_fkey"
    FOREIGN KEY ("mizanId") REFERENCES "mizanlar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
