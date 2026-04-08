UPDATE "kdv_control_sessions" SET "type" = 'KDV_191' WHERE "type" = 'ALIS';
UPDATE "kdv_control_sessions" SET "type" = 'KDV_391' WHERE "type" = 'SATIS';

ALTER TABLE "kdv_control_sessions"
  DROP CONSTRAINT IF EXISTS "kdv_control_sessions_taxpayerId_fkey";

ALTER TABLE "kdv_control_sessions"
  ADD CONSTRAINT "kdv_control_sessions_taxpayerId_fkey"
  FOREIGN KEY ("taxpayerId") REFERENCES "taxpayers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
