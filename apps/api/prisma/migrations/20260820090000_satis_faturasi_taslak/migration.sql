-- SATIS FATURASI TASLAGI — "Fatura Kes" (2026-08-20)
--
-- Mukellef adina kesilecek satis faturasinin hazirlik kaydi. Bu tablodaki kayit
-- RESMI BELGE DEGILDIR:
--   TASLAK      -> yalniz bizde, hicbir yere gonderilmedi (onizleme)
--   GIB_TASLAK  -> GIB e-Arsiv portalinda taslak olusturuldu (silinebilir, resmi degil)
--   KESILDI     -> kesinlestirildi, resmi belge
--   IPTAL       -> vazgecildi / taslak silindi
--
-- GUVENLIK: yalnizca YENI TABLO olusturulur. Mevcut hicbir tabloya/indekse
-- DOKUNULMAZ (2026-08-20 sabahi DROP INDEX iceren migration uretimi ~10 dk
-- kesintiye yol acmisti; o yuzden burada sadece CREATE ... IF NOT EXISTS var).

CREATE TABLE IF NOT EXISTS "sales_invoice_drafts" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "taxpayerId"     TEXT NOT NULL,
  "kanal"          TEXT NOT NULL DEFAULT 'GIB_EARSIV',
  "durum"          TEXT NOT NULL DEFAULT 'TASLAK',
  "aliciVkn"       TEXT NOT NULL,
  "aliciUnvan"     TEXT NOT NULL,
  "aliciAdres"     TEXT,
  "aliciVd"        TEXT,
  "aliciEposta"    TEXT,
  "faturaTarihi"   TIMESTAMP(3) NOT NULL,
  "aciklama"       TEXT NOT NULL,
  "miktar"         DECIMAL(14,3) NOT NULL DEFAULT 1,
  "birim"          TEXT NOT NULL DEFAULT 'ADET',
  "matrah"         DECIMAL(14,2) NOT NULL,
  "kdvOrani"       INTEGER NOT NULL DEFAULT 20,
  "kdvTutari"      DECIMAL(14,2) NOT NULL,
  "toplam"         DECIMAL(14,2) NOT NULL,
  "paraBirimi"     TEXT NOT NULL DEFAULT 'TRY',
  "gibBelgeId"     TEXT,
  "faturaNo"       TEXT,
  "ettn"           TEXT,
  "gorselHtml"     TEXT,
  "hata"           TEXT,
  "kaynak"         TEXT NOT NULL DEFAULT 'PORTAL',
  "komutMetni"     TEXT,
  "idempotencyKey" TEXT,
  "createdBy"      TEXT,
  "onaylayan"      TEXT,
  "onayZamani"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_invoice_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_invoice_drafts_tenantId_idempotencyKey_key"
  ON "sales_invoice_drafts" ("tenantId", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "sales_invoice_drafts_tenantId_taxpayerId_createdAt_idx"
  ON "sales_invoice_drafts" ("tenantId", "taxpayerId", "createdAt");

CREATE INDEX IF NOT EXISTS "sales_invoice_drafts_tenantId_durum_idx"
  ON "sales_invoice_drafts" ("tenantId", "durum");
