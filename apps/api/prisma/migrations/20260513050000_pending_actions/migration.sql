-- FAZ 2 — Merkezi onay kuyruğu (PendingAction)
-- Tek tablo, tek UI, tek audit. AI ekiplerin write/dışa-iletim eylemleri buraya düşer,
-- kullanıcı /panel/onay-kuyrugu sayfasından onaylar/reddeder.

CREATE TABLE "pending_actions" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "source"             TEXT NOT NULL,
  "sourceRef"          TEXT,
  "type"               TEXT NOT NULL,
  "title"              TEXT NOT NULL,
  "summary"            TEXT NOT NULL,
  "payload"            JSONB NOT NULL,
  "riskLevel"          TEXT NOT NULL DEFAULT 'low',
  "requestedByAgent"   TEXT,
  "requestedByUserId"  TEXT,
  "requestedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"             TEXT NOT NULL DEFAULT 'pending',
  "reviewedByUserId"   TEXT,
  "reviewedAt"         TIMESTAMP(3),
  "reviewNote"         TEXT,
  "appliedAt"          TIMESTAMP(3),
  "errorMessage"       TEXT,
  "expiresAt"          TIMESTAMP(3),

  CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pending_actions_tenantId_status_idx" ON "pending_actions"("tenantId", "status");
CREATE INDEX "pending_actions_source_sourceRef_idx" ON "pending_actions"("source", "sourceRef");
CREATE INDEX "pending_actions_requestedAt_idx" ON "pending_actions"("requestedAt");
