-- e-Defter on kontrol: Luca Detay Fis Listesi snapshotlari

CREATE TABLE "edefter_control_sessions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "taxpayerId" TEXT NOT NULL,
  "donem" TEXT NOT NULL,
  "donemTipi" TEXT NOT NULL DEFAULT 'GECICI_Q1',
  "donemBaslangic" TIMESTAMP(3),
  "donemBitis" TIMESTAMP(3),
  "kaynak" TEXT NOT NULL DEFAULT 'LUCA',
  "status" TEXT NOT NULL DEFAULT 'READY',
  "totalLines" INTEGER NOT NULL DEFAULT 0,
  "totalVouchers" INTEGER NOT NULL DEFAULT 0,
  "findingCount" INTEGER NOT NULL DEFAULT 0,
  "rawExcelBytes" BYTEA,
  "rawExcelSize" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "edefter_control_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "edefter_voucher_lines" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "rowIndex" INTEGER NOT NULL DEFAULT 0,
  "voucherKey" TEXT NOT NULL,
  "fisNo" TEXT,
  "yevmiyeNo" TEXT,
  "fisTarihi" TIMESTAMP(3),
  "fisTipi" TEXT,
  "evrakNo" TEXT,
  "evrakTarihi" TIMESTAMP(3),
  "belgeTuru" TEXT,
  "hesapKodu" TEXT,
  "hesapAdi" TEXT,
  "aciklama" TEXT,
  "karsiHesap" TEXT,
  "vknTckn" TEXT,
  "borc" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "alacak" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "rawData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edefter_voucher_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "edefter_findings" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'WARN',
  "category" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "voucherKey" TEXT,
  "rowIndex" INTEGER,
  "hesapKodu" TEXT,
  "detail" JSONB,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edefter_findings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "edefter_control_sessions_tenantId_taxpayerId_donem_idx"
  ON "edefter_control_sessions"("tenantId", "taxpayerId", "donem");

CREATE INDEX "edefter_control_sessions_tenantId_createdAt_idx"
  ON "edefter_control_sessions"("tenantId", "createdAt");

CREATE INDEX "edefter_voucher_lines_sessionId_voucherKey_idx"
  ON "edefter_voucher_lines"("sessionId", "voucherKey");

CREATE INDEX "edefter_voucher_lines_sessionId_hesapKodu_idx"
  ON "edefter_voucher_lines"("sessionId", "hesapKodu");

CREATE INDEX "edefter_findings_sessionId_severity_idx"
  ON "edefter_findings"("sessionId", "severity");

CREATE INDEX "edefter_findings_sessionId_category_idx"
  ON "edefter_findings"("sessionId", "category");

ALTER TABLE "edefter_voucher_lines"
  ADD CONSTRAINT "edefter_voucher_lines_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "edefter_control_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "edefter_findings"
  ADD CONSTRAINT "edefter_findings_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "edefter_control_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
