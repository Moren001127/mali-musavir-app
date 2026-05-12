-- Office budget tracking for Cari Kasa.

CREATE TABLE IF NOT EXISTS "office_budget_categories" (
  "id"        TEXT PRIMARY KEY,
  "tenantId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  "color"     TEXT NOT NULL DEFAULT '#d4b876',
  "icon"      TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "office_budget_entries" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "categoryId"    TEXT NOT NULL,
  "date"          TIMESTAMP(3) NOT NULL,
  "period"        TEXT NOT NULL,
  "type"          TEXT NOT NULL,
  "amount"        DECIMAL(14, 2) NOT NULL,
  "description"   TEXT,
  "paymentMethod" TEXT,
  "documentNo"    TEXT,
  "source"        TEXT NOT NULL DEFAULT 'MANUAL',
  "isRecurring"   BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "office_budget_plans" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "categoryId"    TEXT NOT NULL,
  "period"        TEXT NOT NULL,
  "plannedAmount" DECIMAL(14, 2) NOT NULL,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "office_budget_categories_tenantId_name_type_key"
  ON "office_budget_categories"("tenantId", "name", "type");
CREATE INDEX IF NOT EXISTS "office_budget_categories_tenantId_type_idx"
  ON "office_budget_categories"("tenantId", "type");
CREATE INDEX IF NOT EXISTS "office_budget_categories_tenantId_isActive_idx"
  ON "office_budget_categories"("tenantId", "isActive");

CREATE INDEX IF NOT EXISTS "office_budget_entries_tenantId_period_idx"
  ON "office_budget_entries"("tenantId", "period");
CREATE INDEX IF NOT EXISTS "office_budget_entries_tenantId_type_idx"
  ON "office_budget_entries"("tenantId", "type");
CREATE INDEX IF NOT EXISTS "office_budget_entries_categoryId_date_idx"
  ON "office_budget_entries"("categoryId", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "office_budget_plans_tenantId_categoryId_period_key"
  ON "office_budget_plans"("tenantId", "categoryId", "period");
CREATE INDEX IF NOT EXISTS "office_budget_plans_tenantId_period_idx"
  ON "office_budget_plans"("tenantId", "period");
CREATE INDEX IF NOT EXISTS "office_budget_plans_categoryId_period_idx"
  ON "office_budget_plans"("categoryId", "period");

DO $$ BEGIN
  ALTER TABLE "office_budget_categories" ADD CONSTRAINT "office_budget_categories_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "office_budget_entries" ADD CONSTRAINT "office_budget_entries_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "office_budget_entries" ADD CONSTRAINT "office_budget_entries_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "office_budget_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "office_budget_plans" ADD CONSTRAINT "office_budget_plans_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "office_budget_plans" ADD CONSTRAINT "office_budget_plans_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "office_budget_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
