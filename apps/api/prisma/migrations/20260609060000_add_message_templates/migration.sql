-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ad" TEXT NOT NULL,
    "kanal" TEXT NOT NULL DEFAULT 'BOTH',
    "kategori" TEXT NOT NULL DEFAULT 'genel',
    "emailSubject" TEXT,
    "body" TEXT NOT NULL,
    "attachPdf" BOOLEAN NOT NULL DEFAULT false,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "autoEvent" TEXT,
    "sirano" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_templates_tenantId_kategori_idx" ON "message_templates"("tenantId", "kategori");
