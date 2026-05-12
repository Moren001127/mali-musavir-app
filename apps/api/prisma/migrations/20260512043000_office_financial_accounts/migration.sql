-- Account ledger support for Cari Kasa & Tahsilat.

CREATE TABLE IF NOT EXISTS "office_financial_accounts" (
  "id"              TEXT PRIMARY KEY,
  "tenantId"        TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "type"            TEXT NOT NULL,
  "color"           TEXT NOT NULL DEFAULT '#d4b876',
  "openingBalance"  DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "openingDate"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sortOrder"       INTEGER NOT NULL DEFAULT 0,
  "isActive"        BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "office_account_transfers" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "fromAccountId" TEXT NOT NULL,
  "toAccountId"   TEXT NOT NULL,
  "date"          TIMESTAMP(3) NOT NULL,
  "period"        TEXT NOT NULL,
  "amount"        DECIMAL(14, 2) NOT NULL,
  "description"   TEXT,
  "documentNo"    TEXT,
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "office_budget_entries"
ADD COLUMN IF NOT EXISTS "accountId" TEXT;

ALTER TABLE "cari_hareketler"
ADD COLUMN IF NOT EXISTS "accountId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "office_financial_accounts_tenantId_name_key"
  ON "office_financial_accounts"("tenantId", "name");
CREATE INDEX IF NOT EXISTS "office_financial_accounts_tenantId_type_idx"
  ON "office_financial_accounts"("tenantId", "type");
CREATE INDEX IF NOT EXISTS "office_financial_accounts_tenantId_isActive_idx"
  ON "office_financial_accounts"("tenantId", "isActive");

CREATE INDEX IF NOT EXISTS "office_account_transfers_tenantId_period_idx"
  ON "office_account_transfers"("tenantId", "period");
CREATE INDEX IF NOT EXISTS "office_account_transfers_fromAccountId_date_idx"
  ON "office_account_transfers"("fromAccountId", "date");
CREATE INDEX IF NOT EXISTS "office_account_transfers_toAccountId_date_idx"
  ON "office_account_transfers"("toAccountId", "date");

CREATE INDEX IF NOT EXISTS "office_budget_entries_tenantId_accountId_idx"
  ON "office_budget_entries"("tenantId", "accountId");
CREATE INDEX IF NOT EXISTS "cari_hareketler_tenantId_accountId_idx"
  ON "cari_hareketler"("tenantId", "accountId");

DO $$ BEGIN
  ALTER TABLE "office_financial_accounts" ADD CONSTRAINT "office_financial_accounts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "office_account_transfers" ADD CONSTRAINT "office_account_transfers_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "office_account_transfers" ADD CONSTRAINT "office_account_transfers_fromAccountId_fkey"
    FOREIGN KEY ("fromAccountId") REFERENCES "office_financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "office_account_transfers" ADD CONSTRAINT "office_account_transfers_toAccountId_fkey"
    FOREIGN KEY ("toAccountId") REFERENCES "office_financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "office_budget_entries" ADD CONSTRAINT "office_budget_entries_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "office_financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cari_hareketler" ADD CONSTRAINT "cari_hareketler_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "office_financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
