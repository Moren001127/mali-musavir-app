-- KDV Beyanname için Luca mizan snapshot tablosu.
-- Mizan modülünden BAĞIMSIZ — geçici vergi mizanı KDV beyanını ilgilendirmez.
-- Her mükellef × dönem için bir kayıt; hamMizan Json'da TÜM hesap satırları durur.
-- Frontend sadece KDV ile ilgili olanları (190/191/391 + 600/601/602/610/611/612 + 153/770 vb.) gösterir.

CREATE TABLE IF NOT EXISTS "kdv_luca_snapshots" (
  "id"                TEXT NOT NULL PRIMARY KEY,
  "tenantId"          TEXT NOT NULL,
  "taxpayerId"        TEXT NOT NULL,
  "donem"             TEXT NOT NULL,
  "cekildiAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cekenUserId"       TEXT,
  "fetchJobId"        TEXT,
  "hamMizan"          JSONB NOT NULL,
  "toplamHesapAdet"   INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "kdv_luca_snapshots_taxpayerId_fkey"
    FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "kdv_luca_snapshots_tenantId_taxpayerId_donem_key"
  ON "kdv_luca_snapshots"("tenantId", "taxpayerId", "donem");

CREATE INDEX IF NOT EXISTS "kdv_luca_snapshots_tenantId_taxpayerId_cekildiAt_idx"
  ON "kdv_luca_snapshots"("tenantId", "taxpayerId", "cekildiAt");
