-- CreateEnum
CREATE TYPE "AuthMode" AS ENUM ('OAUTH', 'PIT');

-- CreateEnum
CREATE TYPE "ScorecardSource" AS ENUM ('GENERATED', 'TEMPLATE', 'MANUAL');

-- CreateEnum
CREATE TYPE "CriterionCategory" AS ENUM ('GOAL', 'DATA_CAPTURE', 'KNOWLEDGE', 'CONTAINMENT', 'COMPLIANCE', 'CONVERSATIONAL');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EvalMethod" AS ENUM ('DETERMINISTIC', 'LLM');

-- CreateEnum
CREATE TYPE "TurnRole" AS ENUM ('AGENT', 'CALLER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('PASS', 'PARTIAL', 'FAIL', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "RootCause" AS ENUM ('MISSING_INSTRUCTION', 'AMBIGUOUS_INSTRUCTION', 'KNOWLEDGE_GAP', 'FLOW_ORDERING', 'GUARDRAIL_MISSING', 'CALLER_SIDE');

-- CreateEnum
CREATE TYPE "RecStatus" AS ENUM ('OPEN', 'APPLIED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ActionReason" AS ENUM ('HUMAN_REQUESTED', 'HIGH_INTENT_LOST', 'COMPLIANCE_MISS', 'KNOWLEDGE_GAP');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "companyId" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "authMode" "AuthMode" NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "syncCursor" TIMESTAMP(3),

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "ghlAgentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "promptSnapshot" TEXT NOT NULL,
    "promptFetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scorecard" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" "ScorecardSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Criterion" (
    "id" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "CriterionCategory" NOT NULL,
    "severity" "Severity" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "method" "EvalMethod" NOT NULL,
    "deterministicRule" JSONB,

    CONSTRAINT "Criterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "ghlCallId" TEXT NOT NULL,
    "direction" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "endedReason" TEXT,
    "actionsTriggered" JSONB NOT NULL,
    "recordingUrl" TEXT,
    "contactRef" TEXT,
    "summary" TEXT,
    "extractedData" JSONB,
    "isTrialCall" BOOLEAN NOT NULL DEFAULT false,
    "isAgentDeleted" BOOLEAN NOT NULL DEFAULT false,
    "translation" JSONB,
    "rawPayload" JSONB NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turn" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "role" "TurnRole" NOT NULL,
    "text" TEXT NOT NULL,
    "startMs" INTEGER,

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "scorecardVersion" INTEGER NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "healthScore" DOUBLE PRECISION NOT NULL,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionResult" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "criterionKey" TEXT NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidenceTurns" INTEGER[],
    "rationale" TEXT NOT NULL,
    "rootCause" "RootCause",

    CONSTRAINT "CriterionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "criterionKey" TEXT NOT NULL,
    "rootCause" "RootCause" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "promptDiff" JSONB NOT NULL,
    "affectedCalls" INTEGER NOT NULL,
    "affectedPct" DOUBLE PRECISION NOT NULL,
    "severity" "Severity" NOT NULL,
    "evidenceCallIds" TEXT[],
    "status" "RecStatus" NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "baselineRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "reason" "ActionReason" NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "ActionStatus" NOT NULL,
    "assignee" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Installation_locationId_key" ON "Installation"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_locationId_ghlAgentId_key" ON "Agent"("locationId", "ghlAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_agentId_version_key" ON "Scorecard"("agentId", "version");

-- CreateIndex
CREATE INDEX "Call_agentId_startedAt_idx" ON "Call"("agentId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Call_locationId_ghlCallId_key" ON "Call"("locationId", "ghlCallId");

-- CreateIndex
CREATE UNIQUE INDEX "Turn_callId_idx_key" ON "Turn"("callId", "idx");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_callId_inputHash_key" ON "Evaluation"("callId", "inputHash");

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Criterion" ADD CONSTRAINT "Criterion_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "Scorecard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionResult" ADD CONSTRAINT "CriterionResult_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
