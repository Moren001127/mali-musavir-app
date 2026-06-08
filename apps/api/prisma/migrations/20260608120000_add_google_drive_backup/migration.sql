-- Google Drive yedekleme: per-tenant OAuth hesabı + yedek kütüğü + klasör önbelleği + iş ilerlemesi.
-- Tamamen eklemeli (CREATE TABLE) — mevcut veriye dokunmaz.

-- GoogleDriveAccount
CREATE TABLE IF NOT EXISTS "google_drive_accounts" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "email" TEXT,
  "encryptedRefreshToken" TEXT NOT NULL,
  "accessToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "scope" TEXT,
  "rootFolderId" TEXT,
  "rootFolderName" TEXT NOT NULL DEFAULT 'FATURALAR',
  "connectedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "google_drive_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "google_drive_accounts_tenantId_key"
  ON "google_drive_accounts"("tenantId");

-- DriveBackup (mükerrer engeli — kalıcı kütük)
CREATE TABLE IF NOT EXISTS "drive_backups" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "mihsapId" TEXT NOT NULL,
  "mukellefId" TEXT,
  "donem" TEXT,
  "faturaTuru" TEXT,
  "driveFileId" TEXT NOT NULL,
  "driveFolderId" TEXT,
  "filePath" TEXT,
  "fileName" TEXT,
  "sizeBytes" INTEGER,
  "backedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "drive_backups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "drive_backups_tenantId_mihsapId_key"
  ON "drive_backups"("tenantId", "mihsapId");
CREATE INDEX IF NOT EXISTS "drive_backups_tenantId_mukellefId_donem_idx"
  ON "drive_backups"("tenantId", "mukellefId", "donem");

-- DriveFolder (klasör id önbelleği)
CREATE TABLE IF NOT EXISTS "drive_folders" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "driveFolderId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "drive_folders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "drive_folders_tenantId_path_key"
  ON "drive_folders"("tenantId", "path");

-- DriveBackupJob (ilerleme takibi)
CREATE TABLE IF NOT EXISTS "drive_backup_jobs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "mukellefId" TEXT,
  "donem" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "totalCount" INTEGER NOT NULL DEFAULT 0,
  "backedUpCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "errorMsg" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "drive_backup_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "drive_backup_jobs_tenantId_createdAt_idx"
  ON "drive_backup_jobs"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "drive_backup_jobs_tenantId_status_idx"
  ON "drive_backup_jobs"("tenantId", "status");
