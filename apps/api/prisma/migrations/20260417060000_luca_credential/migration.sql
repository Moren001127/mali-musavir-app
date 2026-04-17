-- Luca kimlik bilgisi (AES-GCM ile şifrelenmiş)
CREATE TABLE "luca_credentials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uyeNo" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "encryptedCookies" TEXT,
    "cookiesExpiresAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "luca_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "luca_credentials_tenantId_key" ON "luca_credentials"("tenantId");
