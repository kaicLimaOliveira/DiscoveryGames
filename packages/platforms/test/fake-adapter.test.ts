import { describe, expect, it } from 'vitest'
import {
  AuthError,
  PermanentError,
  RateLimitError,
  TransientError,
  UnknownOutcomeError,
} from '@central/shared'
import { createFakeAdapter, type PublishContext, type PublishProgress } from '../src'

const ctx: PublishContext = {
  publicationId: 'pub1',
  idempotencyKey: 'key1',
  account: { id: 'acc1', externalId: 'ext1' },
  format: 'reel',
  caption: 'legenda',
  options: {},
}

describe('fake adapter', () => {
  it('publica em N passos com progress acumulado e externalId estável', async () => {
    const a = createFakeAdapter({ steps: 3 })
    let p: PublishProgress = {}
    let r
    for (let i = 0; i < 3; i++) {
      r = await a.publishStep(ctx, p)
      expect(r.done).toBe(i === 2)
      p = r.progress
    }
    expect(r!.done).toBe(true)
    expect(r!.externalId).toBe(`fake_${ctx.idempotencyKey}`)
    expect(a.published.size).toBe(1)
    // repetir após concluído é determinístico
    const again = await a.publishStep(ctx, p)
    expect(again.done).toBe(true)
    expect(again.externalId).toBe(`fake_${ctx.idempotencyKey}`)
    expect(a.published.size).toBe(1)
  })

  it('retomar a partir do progress não repete passos já feitos', async () => {
    const published = new Map<string, string>()
    const a1 = createFakeAdapter({ steps: 3, published })
    const r1 = await a1.publishStep(ctx, {})
    expect(r1.progress).toEqual({ step: 1 })
    expect(published.size).toBe(0)
    const a2 = createFakeAdapter({ steps: 3, published })
    const r2 = await a2.publishStep(ctx, r1.progress)
    expect(r2.progress).toEqual({ step: 2 })
    const r3 = await a2.publishStep(ctx, r2.progress)
    expect(r3.done).toBe(true)
    expect(published.size).toBe(1)
    expect(a1.published).toBe(published)
  })

  it.each([
    ['transient', TransientError],
    ['rate_limit', RateLimitError],
    ['auth', AuthError],
    ['permanent', PermanentError],
    ['unknown_outcome', UnknownOutcomeError],
  ])('falha %s no passo configurado', async (kind, Cls) => {
    const a = createFakeAdapter({ failAt: { step: 2, kind: kind as never } })
    const r1 = await a.publishStep(ctx, {})
    await expect(a.publishStep(ctx, r1.progress)).rejects.toBeInstanceOf(Cls)
    await expect(a.publishStep(ctx, r1.progress)).resolves.toBeTruthy() // times=1
  })

  it('times controla quantas falhas ocorrem no passo', async () => {
    const a = createFakeAdapter({ failAt: { step: 1, kind: 'transient', times: 2 } })
    await expect(a.publishStep(ctx, {})).rejects.toBeInstanceOf(TransientError)
    await expect(a.publishStep(ctx, {})).rejects.toBeInstanceOf(TransientError)
    await expect(a.publishStep(ctx, {})).resolves.toMatchObject({ progress: { step: 1 } })
  })

  it('unknown_outcome no último passo publica de fato; reconcile encontra', async () => {
    const a = createFakeAdapter({ steps: 2, failAt: { step: 2, kind: 'unknown_outcome' } })
    const r1 = await a.publishStep(ctx, {})
    expect(await a.reconcile(ctx, r1.progress)).toEqual({ status: 'not_found' })
    await expect(a.publishStep(ctx, r1.progress)).rejects.toBeInstanceOf(UnknownOutcomeError)
    expect(await a.reconcile(ctx, r1.progress)).toMatchObject({
      status: 'found',
      externalId: `fake_${ctx.idempotencyKey}`,
    })
  })

  it('classifyError mantém erros de domínio e trata desconhecido como Transient', () => {
    const a = createFakeAdapter()
    const auth = new AuthError('x')
    expect(a.classifyError(auth)).toBe(auth)
    const original = new Error('boom')
    const c = a.classifyError(original)
    expect(c).toBeInstanceOf(TransientError)
    expect(c.cause).toBe(original)
    expect(a.classifyError('texto')).toBeInstanceOf(TransientError)
  })

  it('metrics: números para publicados e null para desconhecidos', async () => {
    const a = createFakeAdapter({ steps: 1 })
    const r = await a.publishStep(ctx, {})
    const out = await a.fetchMetrics(ctx.account, [r.externalId!, 'nope'])
    expect(typeof out[0]!.views).toBe('number')
    expect(typeof out[0]!.likes).toBe('number')
    expect(out[1]).toMatchObject({ externalId: 'nope', views: null, likes: null })
  })

  it('caminho normal publica uma vez; retry cego após unknown_outcome duplica de forma observável', async () => {
    const ok = createFakeAdapter({ steps: 1 })
    await ok.publishStep(ctx, {})
    expect(ok.publishCount.get(ctx.idempotencyKey)).toBe(1)

    const a = createFakeAdapter({ steps: 2, failAt: { step: 2, kind: 'unknown_outcome' } })
    const r1 = await a.publishStep(ctx, {})
    await expect(a.publishStep(ctx, r1.progress)).rejects.toBeInstanceOf(UnknownOutcomeError)
    await a.publishStep(ctx, r1.progress) // sem reconcile
    expect(a.publishCount.get(ctx.idempotencyKey)).toBe(2)
  })

  it('progress concluído sem publicação real é erro permanente', async () => {
    const a = createFakeAdapter({ steps: 3, published: new Map() })
    await expect(a.publishStep(ctx, { step: 3 })).rejects.toBeInstanceOf(PermanentError)
  })

  it('rejeita failAt fora de 1..steps', () => {
    expect(() => createFakeAdapter({ steps: 2, failAt: { step: 3, kind: 'auth' } })).toThrow(
      RangeError,
    )
    expect(() => createFakeAdapter({ failAt: { step: 0, kind: 'auth' } })).toThrow(RangeError)
  })

  it('reconcileResult inconclusive', async () => {
    const a = createFakeAdapter({ reconcileResult: 'inconclusive' })
    expect(await a.reconcile(ctx, {})).toEqual({ status: 'inconclusive' })
  })

  it('expõe capacidades, regras e constraints', async () => {
    const a = createFakeAdapter()
    expect(a.id).toBe('fake')
    expect(a.mode).toBe('api')
    expect(a.capabilities(ctx.account).formats).toContain('reel')
    const vc = a.videoConstraints('reel')
    expect(vc.maxDurationSec).toBe(180)
    expect(vc.aspectRatios).toEqual(['9:16'])
    expect(vc.source.url).toBe('fake://')
    expect(a.textRules('reel').required).toEqual(['caption'])
    expect(a.optionsSchema('reel').safeParse({}).success).toBe(true)
    await expect(a.preflight(ctx)).resolves.toBeUndefined()
  })
})
