-- CreateEnum
CREATE TYPE "RightsBasis" AS ENUM ('own', 'authorized', 'cc_license', 'clipper_program', 'none');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('upload', 'youtube_link');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('awaiting_upload', 'queued', 'downloading', 'probing', 'transcribing', 'analyzing', 'ready', 'failed', 'blocked_budget');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('suggested', 'accepted', 'rejected', 'rendered');

-- CreateEnum
CREATE TYPE "ReframeLayout" AS ENUM ('face', 'center', 'game_facecam', 'blur_fit');

-- CreateEnum
CREATE TYPE "MediaAssetKind" AS ENUM ('original');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('ok', 'invalid_output', 'refused', 'error');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('llm', 'transcription');

-- CreateTable
CREATE TABLE "PartnerCreator" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channels" TEXT[],
    "authorizationUrl" TEXT,
    "authorizationKey" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PartnerCreator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "originalUrl" TEXT,
    "status" "SourceStatus" NOT NULL DEFAULT 'awaiting_upload',
    "statusDetail" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "rightsBasis" "RightsBasis" NOT NULL,
    "partnerCreatorId" UUID,
    "params" JSONB NOT NULL,
    "uploadKey" TEXT,
    "uploadId" TEXT,
    "uploadSizeBytes" BIGINT,
    "mediaAssetId" UUID,
    "signals" JSONB,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RightsDeclaration" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "basis" "RightsBasis" NOT NULL,
    "creatorName" TEXT,
    "evidenceUrl" TEXT,
    "evidenceKey" TEXT,
    "licenseType" TEXT,
    "sourceUrl" TEXT,
    "programUrl" TEXT,
    "partnerCreatorId" UUID,
    "declaredById" UUID,
    "declaredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RightsDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "MediaAssetKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "probe" JSONB NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "hasAudio" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "sourceId" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "words" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "costUsd" DECIMAL(12,6) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("sourceId")
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceId" UUID,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "output" JSONB,
    "status" "AiRunStatus" NOT NULL,
    "error" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostLedger" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "category" "CostCategory" NOT NULL,
    "provider" TEXT NOT NULL,
    "units" DECIMAL(14,4) NOT NULL,
    "unitType" TEXT NOT NULL,
    "costUsd" DECIMAL(12,6) NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CostLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipCandidate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "aiRunId" UUID,
    "rank" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "suggestedStartMs" INTEGER NOT NULL,
    "suggestedEndMs" INTEGER NOT NULL,
    "hookScore" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "captions" JSONB NOT NULL,
    "hashtags" TEXT[],
    "layout" "ReframeLayout" NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'suggested',
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClipCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerCreator_organizationId_idx" ON "PartnerCreator"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Source_mediaAssetId_key" ON "Source"("mediaAssetId");

-- CreateIndex
CREATE INDEX "Source_organizationId_createdAt_idx" ON "Source"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "RightsDeclaration_sourceId_declaredAt_idx" ON "RightsDeclaration"("sourceId", "declaredAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");

-- CreateIndex
CREATE INDEX "MediaAsset_organizationId_sha256_idx" ON "MediaAsset"("organizationId", "sha256");

-- CreateIndex
CREATE INDEX "AiRun_task_inputHash_promptVersion_model_idx" ON "AiRun"("task", "inputHash", "promptVersion", "model");

-- CreateIndex
CREATE INDEX "CostLedger_organizationId_occurredAt_idx" ON "CostLedger"("organizationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CostLedger_refType_refId_unitType_key" ON "CostLedger"("refType", "refId", "unitType");

-- CreateIndex
CREATE INDEX "ClipCandidate_sourceId_rank_idx" ON "ClipCandidate"("sourceId", "rank");

-- AddForeignKey
ALTER TABLE "PartnerCreator" ADD CONSTRAINT "PartnerCreator_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_partnerCreatorId_fkey" FOREIGN KEY ("partnerCreatorId") REFERENCES "PartnerCreator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsDeclaration" ADD CONSTRAINT "RightsDeclaration_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLedger" ADD CONSTRAINT "CostLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipCandidate" ADD CONSTRAINT "ClipCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipCandidate" ADD CONSTRAINT "ClipCandidate_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipCandidate" ADD CONSTRAINT "ClipCandidate_aiRunId_fkey" FOREIGN KEY ("aiRunId") REFERENCES "AiRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Restrições que o Prisma não expressa.
ALTER TABLE "ClipCandidate" ADD CONSTRAINT "ClipCandidate_hookScore_check" CHECK ("hookScore" BETWEEN 0 AND 100);
ALTER TABLE "ClipCandidate" ADD CONSTRAINT "ClipCandidate_range_check" CHECK ("endMs" > "startMs");
