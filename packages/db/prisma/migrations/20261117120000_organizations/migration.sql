-- Renomeia Brand para Organization preservando os dados (somente RENAME).

-- Enum
ALTER TYPE "BrandRole" RENAME TO "OrganizationRole";

-- Tabelas
ALTER TABLE "Brand" RENAME TO "Organization";
ALTER TABLE "BrandMember" RENAME TO "OrganizationMember";

-- Colunas
ALTER TABLE "OrganizationMember" RENAME COLUMN "brandId" TO "organizationId";
ALTER TABLE "Setting" RENAME COLUMN "brandId" TO "organizationId";
ALTER TABLE "AuditLog" RENAME COLUMN "brandId" TO "organizationId";

-- Chaves primárias (renomear a constraint renomeia o índice que a sustenta)
ALTER TABLE "Organization" RENAME CONSTRAINT "Brand_pkey" TO "Organization_pkey";
ALTER TABLE "OrganizationMember" RENAME CONSTRAINT "BrandMember_pkey" TO "OrganizationMember_pkey";

-- Chaves estrangeiras
ALTER TABLE "OrganizationMember" RENAME CONSTRAINT "BrandMember_brandId_fkey" TO "OrganizationMember_organizationId_fkey";
ALTER TABLE "OrganizationMember" RENAME CONSTRAINT "BrandMember_userId_fkey" TO "OrganizationMember_userId_fkey";
ALTER TABLE "Setting" RENAME CONSTRAINT "Setting_brandId_fkey" TO "Setting_organizationId_fkey";
ALTER TABLE "AuditLog" RENAME CONSTRAINT "AuditLog_brandId_fkey" TO "AuditLog_organizationId_fkey";

-- Índices (inclui o único manual com NULLS NOT DISTINCT)
ALTER INDEX "Brand_slug_key" RENAME TO "Organization_slug_key";
ALTER INDEX "AuditLog_brandId_at_idx" RENAME TO "AuditLog_organizationId_at_idx";
ALTER INDEX "Setting_brandId_key_key" RENAME TO "Setting_organizationId_key_key";

-- voiceGuide: Json -> texto. Guarda o texto do JSON quando não for o objeto vazio padrão.
ALTER TABLE "Organization" ALTER COLUMN "voiceGuide" DROP DEFAULT;
ALTER TABLE "Organization" ALTER COLUMN "voiceGuide" TYPE TEXT
  USING (CASE WHEN "voiceGuide" = '{}'::jsonb THEN '' ELSE "voiceGuide"::text END);
ALTER TABLE "Organization" ALTER COLUMN "voiceGuide" SET DEFAULT '';

-- Novos campos de configuração
ALTER TABLE "Organization"
  ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "fixedHashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "creditTemplate" TEXT NOT NULL DEFAULT 'Créditos: {creator}',
  ADD COLUMN "captionStyle" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "clipDefaults" JSONB NOT NULL DEFAULT '{"targetMin":5,"targetMax":10,"minSec":30,"maxSec":90}',
  ADD COLUMN "retention" JSONB NOT NULL DEFAULT '{"sourceDays":30,"unusedSourceDays":14,"clipDays":90}';

-- Orçamento de IA deixa de ser opcional (padrão 50)
UPDATE "Organization" SET "aiMonthlyBudgetUsd" = 50 WHERE "aiMonthlyBudgetUsd" IS NULL;
ALTER TABLE "Organization" ALTER COLUMN "aiMonthlyBudgetUsd" SET DEFAULT 50;
ALTER TABLE "Organization" ALTER COLUMN "aiMonthlyBudgetUsd" SET NOT NULL;
