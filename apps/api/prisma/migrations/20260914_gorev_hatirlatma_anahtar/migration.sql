-- 2026-09-14 Görev motoru: hatırlatma olay anahtarı (aynı olay iki kez gitmesin)
ALTER TABLE "task_reminder_logs" ADD COLUMN IF NOT EXISTS "olayAnahtari" TEXT;
CREATE INDEX IF NOT EXISTS "task_reminder_logs_taskId_olayAnahtari_idx" ON "task_reminder_logs"("taskId", "olayAnahtari");
