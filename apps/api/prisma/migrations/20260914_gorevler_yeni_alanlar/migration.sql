-- GÖREVLER & NOTLAR — yeniden tasarım alanları (2026-09-14)
--
-- tasks.kaynak         : MANUEL | WHATSAPP | BANKA | EKIP | AI | TAKVIM — kaydı kim açtı (süzgeç + rozet)
-- tasks.tur            : GOREV | NOT — not: vadesiz, sabitlenebilir kısa kayıt
-- tasks.pinned         : sabitlenmiş (liste başında)
-- tasks.ekipIsId       : "Ekibe ver" ile açılan Koordinatör koşusunun iş dosyası (agent_commands.id)
-- tasks.notifyWhatsapp : hatırlatma varsayılanı WhatsApp (motor Faz 2'de; şimdilik yalnız alan)
-- tasks.notifyPush     : hatırlatma varsayılanı telefon push (motor Faz 2'de; şimdilik yalnız alan)
-- tasks.taxCalendarId  : vergi takviminden (tax_calendar.id) üretilen görev
--
-- GÜVENLİK: yalnızca "tasks" tablosuna YENİ kolon eklenir (ADD COLUMN IF NOT EXISTS + varsayılan);
-- mevcut kolon/indeks DEĞİŞMEZ, başka tabloya DOKUNULMAZ. Tek seferlik UPDATE'ler yalnız kaynak='MANUEL'
-- kalmış eski kayıtları etiketler (yeniden koşarsa değişiklik yapmaz).

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "kaynak"         TEXT    NOT NULL DEFAULT 'MANUEL';
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "tur"            TEXT    NOT NULL DEFAULT 'GOREV';
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "pinned"         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ekipIsId"       TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "notifyPush"     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "taxCalendarId"  TEXT;

-- Eski kayıtlarda kaynak türetme (tek seferlik):
--   tags içinde 'whatsapp'      → WHATSAPP (eski WhatsApp botu görevleri; bot artık görev açmıyor)
--   tags içinde 'ai-moren-ofis' → AI       (Moren Ofis öneri görevleri)
--   category 'BANKA' + başlık '… banka ekstresi' → BANKA (banka-takip.service görevleri)
UPDATE "tasks" SET "kaynak" = 'WHATSAPP'
 WHERE "kaynak" = 'MANUEL' AND 'whatsapp' = ANY("tags");

UPDATE "tasks" SET "kaynak" = 'AI'
 WHERE "kaynak" = 'MANUEL' AND 'ai-moren-ofis' = ANY("tags");

UPDATE "tasks" SET "kaynak" = 'BANKA'
 WHERE "kaynak" = 'MANUEL' AND "category" = 'BANKA' AND "title" ILIKE '% banka ekstresi';
