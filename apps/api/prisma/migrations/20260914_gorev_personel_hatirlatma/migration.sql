-- 2026-09-14 Görev hatırlatması: ofis personeline de hatırlat + kullanıcı WhatsApp telefonu
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "hatirlatUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
