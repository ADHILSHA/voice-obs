-- CreateEnum
CREATE TYPE "TestCaseStatus" AS ENUM ('NOT_TESTED', 'PASSED', 'FAILED');

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "expectedResult" TEXT NOT NULL,
    "status" "TestCaseStatus" NOT NULL DEFAULT 'NOT_TESTED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_agentId_key_key" ON "TestCase"("agentId", "key");
