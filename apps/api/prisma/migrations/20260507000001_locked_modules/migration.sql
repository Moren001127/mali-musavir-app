-- Kilitli modul tablosu
CREATE TABLE "locked_modules" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "lockedBy" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rebaselined" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "locked_modules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "locked_modules_path_key" ON "locked_modules"("path");
CREATE INDEX "locked_modules_active_idx" ON "locked_modules"("active");
