-- Akıllı Bildirim: kısa belge linkleri (mesajlardaki uzun presigned URL yerine)
CREATE TABLE IF NOT EXISTS "short_links" (
    "token" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "short_links_pkey" PRIMARY KEY ("token")
);
CREATE INDEX IF NOT EXISTS "short_links_tenantId_idx" ON "short_links"("tenantId");
