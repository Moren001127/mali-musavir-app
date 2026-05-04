-- İşletme Hesap Özeti — çeyreklik karşılaştırmalı + stok hareketi + geçici vergi matrahı.
-- TAMAMI MANUEL — Mihsap, e-arşiv vs. hiçbir kaynaktan otomatik çekilmez.

CREATE TABLE IF NOT EXISTS "isletme_hesap_ozetleri" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "tenantId"        TEXT NOT NULL,
  "taxpayerId"      TEXT NOT NULL,
  "yil"             INTEGER NOT NULL,
  "donem"           INTEGER NOT NULL,                -- 1=Q1, 2=Q2, 3=Q3, 4=Q4

  -- Satış / Gelir (manuel)
  "satisHasilati"   DECIMAL(15,2) NOT NULL DEFAULT 0,  -- Dönem içi satışlar (KDV hariç)
  "digerGelir"      DECIMAL(15,2) NOT NULL DEFAULT 0,  -- Diğer gelirler

  -- Mal & Stok hareketi (manuel)
  "malAlisi"        DECIMAL(15,2) NOT NULL DEFAULT 0,  -- Dönem içi satın alınan mal bedeli
  "donemBasiStok"   DECIMAL(15,2) NOT NULL DEFAULT 0,  -- Önceki çeyreğin kalan stoğu (Q1 için manuel)
  "kalanStok"       DECIMAL(15,2) NOT NULL DEFAULT 0,  -- Sayım sonucu (manuel)
  -- Türetilen alanlar (servis tarafında hesaplanır):
  "toplamStok"      DECIMAL(15,2) NOT NULL DEFAULT 0,  -- = donemBasiStok + malAlisi
  "satilanMalMaliyeti" DECIMAL(15,2) NOT NULL DEFAULT 0,  -- = toplamStok - kalanStok
  "netSatislar"     DECIMAL(15,2) NOT NULL DEFAULT 0,  -- = (satisHasilati + digerGelir) - satilanMalMaliyeti

  -- Gider (manuel)
  "donemIciGiderler" DECIMAL(15,2) NOT NULL DEFAULT 0,

  -- Kar / Zarar (türetilen)
  "donemKari"       DECIMAL(15,2) NOT NULL DEFAULT 0,  -- = netSatislar - donemIciGiderler

  -- Geçici Vergi
  "gecmisYilZarari" DECIMAL(15,2) NOT NULL DEFAULT 0,  -- Manuel
  "gecVergiMatrahi" DECIMAL(15,2) NOT NULL DEFAULT 0,  -- = max(0, donemKari - gecmisYilZarari)
  "hesaplananGecVergi" DECIMAL(15,2) NOT NULL DEFAULT 0,  -- = gecVergiMatrahi * 0.15
  "oncekiOdenenGecVergi" DECIMAL(15,2) NOT NULL DEFAULT 0,  -- Manuel
  "odenecekGecVergi" DECIMAL(15,2) NOT NULL DEFAULT 0,  -- = max(0, hesaplananGecVergi - oncekiOdenenGecVergi)

  -- Not
  "not"             TEXT,

  -- Kilit
  "locked"          BOOLEAN NOT NULL DEFAULT FALSE,
  "lockedAt"        TIMESTAMP(3),
  "lockedBy"        TEXT,
  "lockNote"        TEXT,

  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"       TEXT,

  CONSTRAINT "isletme_hesap_ozetleri_taxpayerId_fkey"
    FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "isletme_hesap_ozetleri_tenantId_taxpayerId_yil_donem_key"
  ON "isletme_hesap_ozetleri"("tenantId", "taxpayerId", "yil", "donem");

CREATE INDEX IF NOT EXISTS "isletme_hesap_ozetleri_tenantId_yil_idx"
  ON "isletme_hesap_ozetleri"("tenantId", "yil");

CREATE INDEX IF NOT EXISTS "isletme_hesap_ozetleri_taxpayerId_yil_donem_idx"
  ON "isletme_hesap_ozetleri"("taxpayerId", "yil", "donem");
