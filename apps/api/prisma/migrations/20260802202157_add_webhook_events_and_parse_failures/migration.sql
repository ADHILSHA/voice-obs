-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "redactionMap" TEXT;

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GhlParseFailure" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "rawBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GhlParseFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEvent_locationId_receivedAt_idx" ON "WebhookEvent"("locationId", "receivedAt");

-- CreateIndex
CREATE INDEX "GhlParseFailure_locationId_createdAt_idx" ON "GhlParseFailure"("locationId", "createdAt");
