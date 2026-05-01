-- Evrak yenileme uyarıları için Document modeline alanlar ekle.
-- expiresAt: belgenin geçerlilik son tarihi (NULL = süresiz)
-- reminderDays: bitime kaç gün kala uyar (default 30)
-- notes: serbest açıklama

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "expiresAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reminderDays"  INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "notes"         TEXT;

CREATE INDEX IF NOT EXISTS "documents_expiresAt_idx" ON "documents"("expiresAt");
