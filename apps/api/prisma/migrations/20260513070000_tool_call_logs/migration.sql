-- Tool call audit log — her tool çağrısının kalıcı kaydı.
-- Mesaj JSON içindeki toolCalls UI içindir; bu tablo gerçek denetim.

CREATE TABLE "tool_call_logs" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "caller"      TEXT NOT NULL,
  "callerRef"   TEXT,
  "agent"       TEXT,
  "tool"        TEXT NOT NULL,
  "input"       JSONB NOT NULL,
  "ok"          BOOLEAN NOT NULL,
  "durationMs"  INTEGER NOT NULL,
  "resultSize"  INTEGER,
  "errorMsg"    TEXT,
  "ts"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tool_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tool_call_logs_tenantId_ts_idx" ON "tool_call_logs"("tenantId", "ts");
CREATE INDEX "tool_call_logs_tenantId_tool_idx" ON "tool_call_logs"("tenantId", "tool");
CREATE INDEX "tool_call_logs_tenantId_caller_callerRef_idx" ON "tool_call_logs"("tenantId", "caller", "callerRef");
