import { z } from 'zod'
import {
  AppError,
  AuthError,
  PermanentError,
  RateLimitError,
  TransientError,
  UnknownOutcomeError,
} from '@central/shared'
import type { PlatformAdapter, PublishContext, PublishProgress } from '../types'

export type FakeFailKind = 'transient' | 'rate_limit' | 'auth' | 'permanent' | 'unknown_outcome'

export interface FakeOptions {
  /** Número de passos de publicação (padrão 3). */
  steps?: number
  /** Falha injetada no passo `step` (base 1), `times` vezes (padrão 1) por instância. */
  failAt?: { step: number; kind: FakeFailKind; times?: number }
  /** Mapa idempotencyKey -> externalId; injetável para simular retomada com outra instância. */
  published?: Map<string, string>
  /** Contagem de publicações reais por idempotencyKey; injetável. Valor > 1 indica duplicata. */
  publishCount?: Map<string, number>
  /** Se 'inconclusive', reconcile sempre devolve `inconclusive`. */
  reconcileResult?: 'inconclusive'
}

/**
 * Formato do progress do fake: `{ step: number }`, com a quantidade de passos concluídos.
 * Progress sem `step` válido equivale a 0; `step` além do total é tratado como concluído.
 */
function stepsDone(progress: PublishProgress): number {
  const s = progress['step']
  return typeof s === 'number' && Number.isInteger(s) && s > 0 ? s : 0
}

function failure(kind: FakeFailKind, step: number): Error {
  const msg = `Falha simulada (${kind}) no passo ${step}`
  switch (kind) {
    case 'transient':
      return new TransientError(msg)
    case 'rate_limit':
      return new RateLimitError(msg, 1000)
    case 'auth':
      return new AuthError(msg)
    case 'permanent':
      return new PermanentError(msg)
    case 'unknown_outcome':
      return new UnknownOutcomeError(msg)
  }
}

export function createFakeAdapter(
  opts: FakeOptions = {},
): PlatformAdapter & { published: Map<string, string>; publishCount: Map<string, number> } {
  const steps = opts.steps ?? 3
  if (opts.failAt && (opts.failAt.step < 1 || opts.failAt.step > steps)) {
    throw new RangeError(`failAt.step deve estar entre 1 e ${steps}`)
  }
  const published = opts.published ?? new Map<string, string>()
  const publishCount = opts.publishCount ?? new Map<string, number>()
  const doPublish = (ctx: PublishContext) => {
    published.set(ctx.idempotencyKey, externalIdOf(ctx))
    publishCount.set(ctx.idempotencyKey, (publishCount.get(ctx.idempotencyKey) ?? 0) + 1)
  }
  const failures = new Map<number, number>()
  const externalIdOf = (ctx: PublishContext) => `fake_${ctx.idempotencyKey}`

  return {
    id: 'fake',
    mode: 'api',
    published,
    publishCount,
    capabilities: () => ({
      formats: ['reel', 'short', 'video', 'carousel', 'image'],
      supportsNativeSchedule: false,
      uploadModes: ['bytes'],
      metrics: ['views', 'likes'],
    }),
    videoConstraints: () => ({
      maxDurationSec: 180,
      aspectRatios: ['9:16'],
      containers: ['mp4'],
      videoCodecs: ['h264'],
      audioCodecs: ['aac'],
      source: { url: 'fake://', checkedAt: '2026-11-15T00:00:00.000Z' },
    }),
    textRules: () => ({ captionMax: 2200, unit: 'chars', required: ['caption'] }),
    optionsSchema: () => z.object({}).passthrough(),
    async preflight() {},
    async publishStep(ctx, progress) {
      const step = stepsDone(progress) + 1
      if (step > steps) {
        if (!published.has(ctx.idempotencyKey)) {
          throw new PermanentError('Progress indica conclusão, mas nada foi publicado')
        }
        return { progress: { step: steps }, done: true, externalId: externalIdOf(ctx) }
      }
      const fail = opts.failAt
      const isLast = step === steps
      if (fail && fail.step === step) {
        const count = failures.get(step) ?? 0
        if (count < (fail.times ?? 1)) {
          failures.set(step, count + 1)
          // Timeout após sucesso: a publicação de fato acontece antes do erro.
          if (fail.kind === 'unknown_outcome' && isLast) {
            doPublish(ctx)
          }
          throw failure(fail.kind, step)
        }
      }
      if (isLast) {
        doPublish(ctx)
        return { progress: { step }, done: true, externalId: externalIdOf(ctx) }
      }
      return { progress: { step }, done: false }
    },
    async reconcile(ctx) {
      if (opts.reconcileResult === 'inconclusive') return { status: 'inconclusive' }
      const externalId = published.get(ctx.idempotencyKey)
      return externalId ? { status: 'found', externalId } : { status: 'not_found' }
    },
    async fetchMetrics(_account, externalIds) {
      const known = new Set(published.values())
      return externalIds.map((externalId) =>
        known.has(externalId)
          ? { externalId, views: 100, likes: 10, raw: { fake: true } }
          : { externalId, views: null, likes: null, raw: null },
      )
    },
    classifyError(err) {
      if (err instanceof AppError) return err
      return new TransientError(err instanceof Error ? err.message : String(err), { cause: err })
    },
  }
}
