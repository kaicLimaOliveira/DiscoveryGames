/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'
import {
  LlmError,
  buildAnthropicClient,
  createAnthropicProvider,
  type AnthropicLike,
} from '../src/index.js'

const KEY = 'sk-ant-segredo-123'
const req = {
  model: 'claude-opus-5-5',
  system: 'SISTEMA',
  cachedContext: 'REGRAS',
  userText: 'TRANSCRICAO',
  images: [
    { mediaType: 'image/jpeg' as const, base64: 'AAAA' },
    { mediaType: 'image/jpeg' as const, base64: 'BBBB' },
  ],
  jsonSchema: { type: 'object', properties: { a: { type: 'string' } } },
  maxTokens: 4000,
  effort: 'low' as const,
}
const message = (over: object = {}) => ({
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: '{"a":"b"}' }],
  usage: {
    input_tokens: 10,
    output_tokens: 20,
    cache_read_input_tokens: 300,
    cache_creation_input_tokens: 400,
  },
  ...over,
})
const clientWith = (impl: (p: unknown) => Promise<unknown>) => {
  const create = vi.fn(impl)
  return { create, client: { messages: { create } } as unknown as AnthropicLike }
}
const httpError = (status: number, msg = 'falhou', type = 'api_error') =>
  Object.assign(new Error(msg), { status, error: { error: { type, message: msg } } })

describe('createAnthropicProvider', () => {
  it('generateStructured monta system com cache_control, imagens em base64 e o schema na requisição', async () => {
    const { create, client } = clientWith(async () => message())
    await createAnthropicProvider({ apiKey: KEY, client }).generateStructured(req)
    const p = create.mock.calls[0]![0] as Record<string, any>
    expect(p.model).toBe('claude-opus-5-5')
    expect(p.max_tokens).toBe(4000)
    expect(p.system).toEqual([
      { type: 'text', text: 'SISTEMA' },
      { type: 'text', text: 'REGRAS', cache_control: { type: 'ephemeral' } },
    ])
    expect(p.output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: req.jsonSchema },
    })
    const content = p.messages[0].content
    expect(p.messages[0].role).toBe('user')
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
    })
    expect(content[1].source.data).toBe('BBBB')
    expect(content[2]).toEqual({ type: 'text', text: 'TRANSCRICAO' })
    expect(JSON.stringify(content)).not.toContain('cache_control')
  })

  it('omite effort quando não informado', async () => {
    const { create, client } = clientWith(async () => message())
    await createAnthropicProvider({ apiKey: KEY, client }).generateStructured({
      ...req,
      effort: undefined,
    })
    const p = create.mock.calls[0]![0] as Record<string, any>
    expect(p.output_config).toEqual({ format: { type: 'json_schema', schema: req.jsonSchema } })
  })

  it('devolve json parseado e usage com tokens de cache', async () => {
    const { client } = clientWith(async () => message())
    const r = await createAnthropicProvider({ apiKey: KEY, client }).generateStructured(req)
    expect(r.status).toBe('ok')
    expect(r.json).toEqual({ a: 'b' })
    expect(r.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 300,
      cacheWriteTokens: 400,
    })
    expect(r.model).toBe('claude-opus-5-5')
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('usage nulo de cache vira 0', async () => {
    const { client } = clientWith(async () =>
      message({
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        },
      }),
    )
    const r = await createAnthropicProvider({ apiKey: KEY, client }).generateStructured(req)
    expect(r.usage.cacheReadTokens).toBe(0)
    expect(r.usage.cacheWriteTokens).toBe(0)
  })

  it('stop_reason refusal vira status refused sem lançar', async () => {
    const { client } = clientWith(async () => message({ stop_reason: 'refusal', content: [] }))
    const r = await createAnthropicProvider({ apiKey: KEY, client }).generateStructured(req)
    expect(r.status).toBe('refused')
    expect(r.json).toBeNull()
    expect(r.usage.inputTokens).toBe(10)
  })

  it('max_tokens, parada inesperada, sem texto e JSON inválido viram status invalid com usage', async () => {
    const casos = [
      message({ stop_reason: 'max_tokens' }),
      message({ stop_reason: 'model_context_window_exceeded' }),
      message({ stop_reason: 'pause_turn' }),
      message({ content: [] }),
      message({ content: [{ type: 'text', text: 'não é json' }] }),
    ]
    for (const m of casos) {
      const { client } = clientWith(async () => m)
      const r = await createAnthropicProvider({ apiKey: KEY, client }).generateStructured(req)
      expect(r.status).toBe('invalid')
      expect(r.json).toBeUndefined()
      expect(r.error).toEqual(expect.any(String))
      expect(r.usage).toEqual({
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 300,
        cacheWriteTokens: 400,
      })
      expect(r.model).toBe('claude-opus-5-5')
    }
  })

  it('o cliente real é criado com maxRetries 2 e timeout de 5 min', () => {
    const c = buildAnthropicClient(KEY)
    expect(c.maxRetries).toBe(2)
    expect(c.timeout).toBe(300_000)
  })

  it('erro 529/overloaded vira LlmError retryable; 400 vira não retryable', async () => {
    const run = (e: unknown) =>
      createAnthropicProvider({
        apiKey: KEY,
        client: clientWith(async () => Promise.reject(e)).client,
      }).generateStructured(req)
    await expect(run(httpError(529, 'Overloaded', 'overloaded_error'))).rejects.toMatchObject({
      retryable: true,
    })
    await expect(run(httpError(429))).rejects.toMatchObject({ retryable: true })
    await expect(run(httpError(408))).rejects.toMatchObject({ retryable: true })
    await expect(run(httpError(409))).rejects.toMatchObject({ retryable: true })
    await expect(run(httpError(503))).rejects.toMatchObject({ retryable: true })
    await expect(run(new Error('ECONNRESET'))).rejects.toMatchObject({ retryable: true })
    await expect(run(httpError(400))).rejects.toMatchObject({ retryable: false })
    await expect(run(httpError(401))).rejects.toMatchObject({ retryable: false })
    await expect(run(httpError(400))).rejects.toBeInstanceOf(LlmError)
  })

  it('a mensagem do LlmError não contém a apiKey', async () => {
    const e = Object.assign(new Error(`invalid x-api-key ${KEY}`), {
      status: 401,
      error: { error: { type: 'authentication_error', message: `bad key ${KEY}` } },
      headers: { 'x-api-key': KEY },
    })
    const p = createAnthropicProvider({
      apiKey: KEY,
      client: clientWith(async () => Promise.reject(e)).client,
    })
    const err = (await p.generateStructured(req).catch((x) => x)) as LlmError
    expect(err).toBeInstanceOf(LlmError)
    expect(err.message).not.toContain(KEY)
    expect(err.message).toContain('401')
    expect((err as { cause?: unknown }).cause).toBeUndefined()
    expect(JSON.stringify(err)).not.toContain(KEY)
  })
})
