-- İki adımlı doğrulama (TOTP) + hesap bazlı giriş kilidi.
-- Hepsi additive/nullable veya sabit default → mevcut satırlar etkilenmez,
-- PostgreSQL 11+ için tablo yeniden yazılmaz (metadata-only, hızlı).
ALTER TABLE "users" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "users" ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "lockedUntil" TIMESTAMP(3);
