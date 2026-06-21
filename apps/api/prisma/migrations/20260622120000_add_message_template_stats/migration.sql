-- Mesaj Şablonları: favori + kullanım istatistiği alanları
-- favori: galeride sabitlenen sık kullanılanlar
-- kullanimSayisi / sonKullanim: test + gerçek gönderim sayacı (UI'da istatistik kutusu)
-- Idempotent: yeniden uygulansa da güvenli (P3009 self-heal).
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "favori" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "kullanimSayisi" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "sonKullanim" TIMESTAMP(3);
