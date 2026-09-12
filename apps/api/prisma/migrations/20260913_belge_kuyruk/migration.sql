-- FATURA MERKEZİ — KALICI BELGE İŞ KUYRUĞU (2026-09-13)
--
-- Bellek-içi uploadOcrQueue (classify / ai-read) her deploy'da siliniyordu; sahip classify-pending ve
-- ai-read-batch uçlarıyla elle yeniden dolduruyordu. Sınıflandırma ve AI okuma işleri artık bu tabloda
-- durur, BelgeKuyrukService 5 sn'lik işçi tikiyle alır (bayat kilit 15 dk, en fazla 3 deneme).
--   kind     : CLASSIFY | AI_READ
--   status   : PENDING | RUNNING | DONE | FAILED
--   priority : 0 arka plan · 3 ithal/okuma sonrası · 5 gece · 10 sahip isteği
--
-- GÜVENLİK: yalnızca YENİ TABLO oluşturulur; mevcut hiçbir tabloya/indekse DOKUNULMAZ (yalnız CREATE ... IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "invoice_processing_jobs" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "taxpayerId" TEXT,
  "documentId" TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "priority"   INTEGER NOT NULL DEFAULT 0,
  "status"     TEXT NOT NULL DEFAULT 'PENDING',
  "attempts"   INTEGER NOT NULL DEFAULT 0,
  "lastError"  TEXT,
  "lockedBy"   TEXT,
  "lockedAt"   TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt"  TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "invoice_processing_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "invoice_processing_jobs_tenantId_status_priority_createdAt_idx"
  ON "invoice_processing_jobs" ("tenantId", "status", "priority", "createdAt");

CREATE INDEX IF NOT EXISTS "invoice_processing_jobs_documentId_status_idx"
  ON "invoice_processing_jobs" ("documentId", "status");
