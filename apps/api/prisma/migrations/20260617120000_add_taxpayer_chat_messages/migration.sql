-- CreateTable
CREATE TABLE "taxpayer_chat_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taxpayerId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "taxpayer_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "taxpayer_chat_messages_taxpayerId_createdAt_idx" ON "taxpayer_chat_messages"("taxpayerId", "createdAt");

-- CreateIndex
CREATE INDEX "taxpayer_chat_messages_tenantId_createdAt_idx" ON "taxpayer_chat_messages"("tenantId", "createdAt");
