import type { z } from 'zod'

export type PlatformId = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'fake'
export type PublicationFormat = 'reel' | 'short' | 'video' | 'carousel' | 'image'
export type PublishProgress = Record<string, unknown>

export interface PublishContext {
  publicationId: string
  idempotencyKey: string
  account: { id: string; externalId: string }
  format: PublicationFormat
  caption: string
  title?: string
  mediaPath?: string
  options: Record<string, unknown>
}

export interface PublishStepResult {
  progress: PublishProgress
  done: boolean
  externalId?: string
  externalUrl?: string
}

export type ReconcileResult =
  | { status: 'found'; externalId: string; externalUrl?: string }
  | { status: 'not_found' }
  | { status: 'inconclusive' }

export interface VideoConstraints {
  minDurationSec?: number
  maxDurationSec: number
  aspectRatios: string[]
  maxSizeBytes?: number
  containers: string[]
  videoCodecs: string[]
  audioCodecs: string[]
  source: { url: string; checkedAt: string }
}

export interface TextRules {
  captionMax?: number
  titleMax?: number
  unit: 'chars' | 'bytes'
  maxHashtags?: number
  required: Array<'caption' | 'title'>
}

export interface PlatformAdapter {
  id: PlatformId
  mode: 'api' | 'manual'
  capabilities(account: PublishContext['account']): {
    formats: PublicationFormat[]
    supportsNativeSchedule: boolean
    uploadModes: Array<'bytes' | 'url'>
    metrics: string[]
  }
  videoConstraints(format: PublicationFormat): VideoConstraints
  textRules(format: PublicationFormat): TextRules
  optionsSchema(format: PublicationFormat): z.ZodTypeAny
  oauth?: {
    authorizeUrl(state: string, codeChallenge?: string): string
    exchange(code: string, codeVerifier?: string): Promise<unknown>
    refresh(cred: unknown): Promise<unknown>
    revoke(cred: unknown): Promise<void>
  }
  preflight(ctx: PublishContext): Promise<void>
  publishStep(ctx: PublishContext, progress: PublishProgress): Promise<PublishStepResult>
  reconcile(ctx: PublishContext, progress: PublishProgress): Promise<ReconcileResult>
  fetchMetrics(
    account: PublishContext['account'],
    externalIds: string[],
  ): Promise<
    Array<{ externalId: string; views: number | null; likes: number | null; raw: unknown }>
  >
  classifyError(err: unknown): Error
  // Fase 5/9: listConnectableAccounts, healthCheck, fetchAccountMetrics, quotaState
}
