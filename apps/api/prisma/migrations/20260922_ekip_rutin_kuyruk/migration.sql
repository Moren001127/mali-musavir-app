-- 2026-09-22 EKİP "İş düzeni" (PLAN/20 §D): rutin (zamanlı görev kalıbı) + kuyruk (sıralı koşu listesi)
-- Repo kalıbı: IF NOT EXISTS (tekrar koşarsa hata vermez); FK bilerek yok (mevcut modellere dokunulmaz).

-- Rutin: Muzaffer Bey'in Ekip ekranından açtığı zamanlı görev kalıbı (ör. "KDV kontrolü — kontrol bekleyenler")
CREATE TABLE IF NOT EXISTS "ekip_rutinler" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "ad"          TEXT NOT NULL,
    "ajanId"      TEXT NOT NULL,
    "sablon"      TEXT NOT NULL,
    "kapsam"      TEXT NOT NULL,
    "taxpayerIds" JSONB,
    "zaman"       JSONB NOT NULL,
    "gunlukTavan" INTEGER NOT NULL DEFAULT 8,
    "dryRun"      BOOLEAN NOT NULL DEFAULT true,
    "aktif"       BOOLEAN NOT NULL DEFAULT false,
    "sonKosuAt"   TIMESTAMP(3),
    "sonSonuc"    JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ekip_rutinler_pkey" PRIMARY KEY ("id")
);

-- Kuyruk: rutinden (kaynak 'rutin') ya da toplu görevden (kaynak 'toplu') gelen sıralı koşu listesi
CREATE TABLE IF NOT EXISTS "ekip_kuyruklar" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "ad"        TEXT NOT NULL,
    "ajanId"    TEXT NOT NULL,
    "sablon"    TEXT NOT NULL,
    "dryRun"    BOOLEAN NOT NULL DEFAULT true,
    "kaynak"    TEXT NOT NULL,
    "rutinId"   TEXT,
    "durum"     TEXT NOT NULL DEFAULT 'bekliyor',
    "ogeler"    JSONB NOT NULL,
    "aktifIsId" TEXT,
    "olusturan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bitisAt"   TIMESTAMP(3),

    CONSTRAINT "ekip_kuyruklar_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ekip_rutinler_tenantId_aktif_idx" ON "ekip_rutinler"("tenantId", "aktif");
CREATE INDEX IF NOT EXISTS "ekip_kuyruklar_tenantId_durum_idx" ON "ekip_kuyruklar"("tenantId", "durum");
CREATE INDEX IF NOT EXISTS "ekip_kuyruklar_tenantId_rutinId_createdAt_idx" ON "ekip_kuyruklar"("tenantId", "rutinId", "createdAt");
