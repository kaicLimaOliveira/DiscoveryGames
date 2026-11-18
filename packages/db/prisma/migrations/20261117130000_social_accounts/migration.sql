-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('instagram', 'facebook', 'youtube', 'tiktok');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'needs_reauth');

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "credentialEnc" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dailyLimit" INTEGER,
    "connectedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccount_organizationId_idx" ON "SocialAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_platform_externalId_key" ON "SocialAccount"("platform", "externalId");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
