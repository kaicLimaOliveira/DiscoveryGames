/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  LlmError,
  SELECT_CLIPS_PROMPT,
  postValidate,
  selectClips,
  selectClipsInputHash,
  type CandidateOut,
  type LlmProvider,
  type SelectClipsInput,
  type StructuredRequest,
  type StructuredResult,
} from '../src/index.js'
import { SELECT_CLIPS_PROMPT_TEXT } from '../src/select-clips.js'

const usage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }

const cand = (startSec: number, endSec: number, hookScore: number, extra = {}): CandidateOut => ({
  startSec,
  endSec,
  hookScore,
  reason: 'Gancho forte.',
  title: 'Título',
  layout: 'face',
  hashtags: ['jogos', 'humor'],
  captions: {
    instagram: { caption: 'legenda' },
    facebook: { caption: 'legenda' },
    tiktok: { caption: 'legenda' },
    youtube: { title: 'Título', description: 'descrição' },
  },
  ...extra,
})

const baseInput = (over: Partial<SelectClipsInput> = {}): SelectClipsInput => ({
  durationMs: 600_000,
  language: 'pt-BR',
  params: { targetMin: 1, targetMax: 3, minSec: 30, maxSec: 90 },
  org: { name: 'Org', tags: ['games'], voiceGuide: 'Fale como amigo.' },
  transcript: {
    text: 'olá mundo',
    words: [
      { w: 'olá', s: 1, e: 1.5 },
      { w: 'mundo', s: 12, e: 12.5 },
    ],
  },
  signals: { loudPeaksSec: [5], sceneCutsSec: [20], motion: [{ startSec: 0, score: 0.4 }] },
  frames: [{ atSec: 10, base64: 'AAAA' }],
  ...over,
})

function fakeLlm(responses: Array<StructuredResult | LlmError>) {
  const calls: StructuredRequest[] = []
  const llm: LlmProvider = {
    provider: 'fake',
    async generateStructured(req) {
      calls.push(req)
      const r = responses[calls.length - 1]
      if (!r) throw new Error('sem resposta programada')
      if (r instanceof LlmError) throw r
      return r
    },
  }
  return { llm, calls }
}
const ok = (candidates: unknown): StructuredResult => ({
  status: 'ok',
  json: { candidates },
  usage,
  latencyMs: 5,
  model: 'claude-opus-5-5',
})
const invalid: StructuredResult = {
  status: 'invalid',
  json: undefined,
  error: 'truncada',
  usage,
  latencyMs: 5,
  model: 'claude-opus-5-5',
}
const opts = { model: 'claude-opus-5-5' }

describe('postValidate', () => {
  it('descarta fora da duração, fora da faixa e sobreposto, e corta em targetMax', () => {
    const input = baseInput({ params: { targetMin: 1, targetMax: 2, minSec: 30, maxSec: 90 } })
    const out = postValidate(
      [
        cand(-5, 40, 99), // início negativo
        cand(570, 610, 98), // passa da duração
        cand(100, 110, 97), // curto demais
        cand(100, 200, 96), // longo demais
        cand(10.04, 50.06, 80), // ok (arredonda para 10 e 50.1)
        cand(20, 55, 70), // sobrepõe 30/35 > 50% com o de nota 80
        cand(200, 240, 60), // ok
        cand(300, 340, 50), // ok, mas passa de targetMax
      ],
      input,
    )
    expect(out.map((c) => [c.startSec, c.endSec, c.hookScore])).toEqual([
      [10, 50.1, 80],
      [200, 240, 60],
    ])
  })

  it('mantém sobreposição de até 50% da duração do menor', () => {
    const out = postValidate([cand(0, 40, 90), cand(20, 60, 80)], baseInput())
    expect(out).toHaveLength(2)
  })
})

describe('selectClips', () => {
  it('repete quando o JSON é inválido e aceita a segunda resposta', async () => {
    const { llm, calls } = fakeLlm([ok([{ startSec: 'x' }]), ok([cand(10, 50, 80)])])
    const r = await selectClips(llm, baseInput(), opts)
    expect(calls).toHaveLength(2)
    expect(r.runs.map((x) => x.status)).toEqual(['invalid_output', 'ok'])
    expect(r.runs.every((x) => x.costUsd > 0)).toBe(true)
    expect(r.candidates).toHaveLength(1)
    expect(r.inputHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('trata resposta invalid do provedor como tentativa falha e repete', async () => {
    const { llm } = fakeLlm([invalid, ok([cand(10, 50, 80)])])
    const r = await selectClips(llm, baseInput(), opts)
    expect(r.runs.map((x) => x.status)).toEqual(['invalid_output', 'ok'])
    expect(r.runs[0]!.costUsd).toBeGreaterThan(0)
    expect(r.runs[0]!.error).toBe('truncada')
  })

  it('com 3 respostas sem candidato válido devolve [] e 3 runs', async () => {
    const { llm } = fakeLlm([ok([cand(0, 5, 90)]), ok([]), ok([cand(0, 5, 90)])])
    const r = await selectClips(llm, baseInput(), opts)
    expect(r.candidates).toEqual([])
    expect(r.runs).toHaveLength(3)
    expect(r.runs.every((x) => x.status === 'invalid_output')).toBe(true)
  })

  it('com recusa para na primeira tentativa', async () => {
    const refused: StructuredResult = {
      status: 'refused',
      json: null,
      usage,
      latencyMs: 1,
      model: 'claude-opus-5-5',
    }
    const { llm, calls } = fakeLlm([refused, ok([cand(10, 50, 80)])])
    const r = await selectClips(llm, baseInput(), opts)
    expect(calls).toHaveLength(1)
    expect(r.runs[0]!.status).toBe('refused')
    expect(r.candidates).toEqual([])
  })

  it('LlmError retryable repete; não retryable encerra', async () => {
    const a = fakeLlm([new LlmError('x', true, 529), ok([cand(10, 50, 80)])])
    const r1 = await selectClips(a.llm, baseInput(), opts)
    expect(r1.runs.map((x) => x.status)).toEqual(['error', 'ok'])
    expect(r1.runs[0]!.costUsd).toBe(0)
    const b = fakeLlm([new LlmError('x', false, 400), ok([cand(10, 50, 80)])])
    const r2 = await selectClips(b.llm, baseInput(), opts)
    expect(b.calls).toHaveLength(1)
    expect(r2.runs.map((x) => x.status)).toEqual(['error'])
    expect(r2.candidates).toEqual([])
  })

  it('respeita maxAttempts', async () => {
    const { llm, calls } = fakeLlm([invalid, invalid, invalid])
    const r = await selectClips(llm, baseInput(), { ...opts, maxAttempts: 2 })
    expect(calls).toHaveLength(2)
    expect(r.runs).toHaveLength(2)
  })

  it('transcrição vazia não quebra e o texto do usuário diz que não há fala', async () => {
    const { llm, calls } = fakeLlm([ok([cand(10, 50, 80)])])
    const input = baseInput({ transcript: { text: '', words: [] } })
    const r = await selectClips(llm, input, opts)
    expect(r.candidates).toHaveLength(1)
    expect(calls[0]!.userText).toMatch(/sem fala/i)
  })

  it('agrupa a transcrição em linhas [mm:ss] a cada ~10 s e envia quadros, modelo e effort', async () => {
    const { llm, calls } = fakeLlm([ok([cand(10, 50, 80)])])
    await selectClips(llm, baseInput(), opts)
    const req = calls[0]!
    expect(req.userText).toContain('[00:01] olá')
    expect(req.userText).toContain('[00:12] mundo')
    expect(req.images).toEqual([{ mediaType: 'image/jpeg', base64: 'AAAA' }])
    expect(req.model).toBe('claude-opus-5-5')
    expect(req.effort).toBe('medium')
    expect(req.maxTokens).toBeLessThanOrEqual(16000)
    expect(req.system).toBe(SELECT_CLIPS_PROMPT_TEXT)
    expect(req.cachedContext).toContain('Fale como amigo.')
  })

  it('inputHash é estável para a mesma entrada e muda com a versão do prompt ou o modelo', () => {
    const a = selectClipsInputHash(baseInput(), 'claude-opus-5-5')
    expect(selectClipsInputHash(baseInput(), 'claude-opus-5-5')).toBe(a)
    expect(selectClipsInputHash(baseInput(), 'outro-modelo')).not.toBe(a)
    expect(selectClipsInputHash(baseInput({ language: 'en' }), 'claude-opus-5-5')).not.toBe(a)
    expect(
      selectClipsInputHash(
        baseInput({ frames: [{ atSec: 10, base64: 'BBBB' }] }),
        'claude-opus-5-5',
      ),
    ).not.toBe(a)
    expect(
      selectClipsInputHash(baseInput(), 'claude-opus-5-5', SELECT_CLIPS_PROMPT.version + 1),
    ).not.toBe(a)
  })

  it('o jsonSchema enviado exige os campos do candidato e não leva restrições não suportadas', async () => {
    const { llm, calls } = fakeLlm([ok([cand(10, 50, 80)])])
    await selectClips(llm, baseInput(), opts)
    const schema = calls[0]!.jsonSchema as any
    const item = schema.properties.candidates.items
    expect(item.required).toEqual(
      expect.arrayContaining(['startSec', 'hookScore', 'layout', 'captions']),
    )
    const text = JSON.stringify(schema)
    for (const k of [
      'maxLength',
      'minLength',
      'maxItems',
      'minItems',
      'minimum',
      'maximum',
      'uniqueItems',
      '$schema',
    ])
      expect(text).not.toContain(`"${k}"`)
  })

  it('o prompt embutido é idêntico a prompts/select-clips/v1.md', () => {
    const file = readFileSync(
      new URL('../prompts/select-clips/v1.md', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(SELECT_CLIPS_PROMPT_TEXT).toBe(file)
    expect(SELECT_CLIPS_PROMPT).toEqual({ id: 'select-clips', version: 1 })
  })
})

describe('candidateOutSchema', () => {
  it('aplica os limites das redes e hashtags', async () => {
    const { candidateOutSchema } = await import('../src/select-clips.js')
    expect(candidateOutSchema.safeParse(cand(1, 2, 3)).success).toBe(true)
    expect(candidateOutSchema.safeParse(cand(1, 2, 3, { hookScore: 101 })).success).toBe(false)
    expect(candidateOutSchema.safeParse(cand(1, 2, 3, { reason: 'x'.repeat(201) })).success).toBe(
      false,
    )
    expect(candidateOutSchema.safeParse(cand(1, 2, 3, { hashtags: ['A', 'a'] })).success).toBe(
      false,
    )
    expect(candidateOutSchema.safeParse(cand(1, 2, 3, { hashtags: ['#a'] })).success).toBe(false)
    expect(
      candidateOutSchema.safeParse(
        cand(1, 2, 3, { hashtags: Array.from({ length: 9 }, (_, i) => `h${i}`) }),
      ).success,
    ).toBe(false)
  })
})
