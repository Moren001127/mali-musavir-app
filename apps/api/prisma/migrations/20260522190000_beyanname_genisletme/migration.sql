-- v1.37.1: Beyanname türlerini Hattat tarzı genişletme
-- TaxpayerBeyanConfig'e 13 yeni opsiyonel alan ekleniyor (geriye uyumlu)

ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "kdv4Period"        TEXT;
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "kdv9015Period"     TEXT;
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "gelirGeciciPeriod" TEXT;
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "kurumGeciciPeriod" TEXT;
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "otv1Period"        TEXT;
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "otv3aPeriod"       TEXT;
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "otv3bPeriod"       TEXT;
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "otv4Period"        TEXT;
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "muhtasar2Period"   TEXT;
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "turizmPeriod"      TEXT;
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "konaklamaEnabled"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "oivEnabled"        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "taxpayer_beyan_configs" ADD COLUMN "gmsiEnabled"       BOOLEAN NOT NULL DEFAULT false;
