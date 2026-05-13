-- LucaFetchJob retry policy — DENİZ patrol direkt iptal etmeden önce 2 retry.
-- nextRetryAt geldiğinde patrol işi tekrar pending'e alır (exponential backoff).

ALTER TABLE "luca_fetch_jobs"
  ADD COLUMN "retryCount"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextRetryAt" TIMESTAMP(3);
