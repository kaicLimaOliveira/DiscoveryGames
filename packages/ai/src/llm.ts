import Anthropic from '@anthropic-ai/sdk'
import type { LlmUsage } from './pricing.js'

export interface StructuredRequest {
  model: string
  /** Instruções fixas; vão no prefixo do prompt, junto de `cachedContext`. */
  system: string
  /** Regras de rede, guia de voz etc. Recebe o `cache_control` (fim do prefixo em cache). */
  cachedContext: string
  /** Parte variável (transcrição, sinais): vai depois do prefixo em cache. */
  userText: string
  images: Array<{ mediaType: 'image/jpeg'; base64: string }>
  jsonSchema: object
  maxTokens: number
  effort?: 'low' | 'medium'
}

export interface StructuredResult {
  status: 'ok' | 'refused'
  /** `null` quando `status === 'refused'`. */
  json: unknown
  usage: LlmUsage
  latencyMs: number
  model: string
}

export interface LlmProvider {
  readonly provider: string
  generateStructured(req: StructuredRequest): Promise<StructuredResult>
}

/** Subconjunto do cliente do SDK usado aqui (injetável nos testes). */
export interface AnthropicLike {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>
  }
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

/**
 * Mensagem fixa em pt-BR com status e tipo do erro; nunca repassa o texto do SDK
 * (pode ecoar a chave) nem anexa o erro original como `cause`.
 */
function wrapError(err: unknown, apiKey: string): LlmError {
  const e = (err ?? {}) as { status?: unknown; error?: { error?: { type?: unknown } } }
  const status = typeof e.status === 'number' ? e.status : undefined
  const rawType = e.error?.error?.type
  const type = typeof rawType === 'string' && /^[a-z_]{1,40}$/.test(rawType) ? rawType : undefined
  const overloaded = status === 529 || type === 'overloaded_error'
  // Sem status = falha de rede/timeout/conexão: vale repetir.
  const retryable = overloaded || status === undefined || status === 429 || status >= 500
  const detalhe = [status !== undefined ? `HTTP ${status}` : 'sem resposta (rede)', type]
    .filter(Boolean)
    .join(', ')
  const msg = `Falha na chamada ao Claude (${detalhe}).`
  return new LlmError(apiKey ? msg.split(apiKey).join('[redigido]') : msg, retryable, status)
}

export function createAnthropicProvider(opts: {
  apiKey: string
  client?: AnthropicLike
}): LlmProvider {
  const client: AnthropicLike =
    opts.client ?? (new Anthropic({ apiKey: opts.apiKey }) as unknown as AnthropicLike)

  return {
    provider: 'anthropic',
    async generateStructured(req) {
      const started = Date.now()
      let res: Anthropic.Message
      try {
        res = await client.messages.create({
          model: req.model,
          max_tokens: req.maxTokens,
          // Prefixo estável com cache_control; o que varia vai só na mensagem do usuário.
          system: [
            { type: 'text', text: req.system },
            { type: 'text', text: req.cachedContext, cache_control: { type: 'ephemeral' } },
          ],
          output_config: {
            ...(req.effort ? { effort: req.effort } : {}),
            format: { type: 'json_schema', schema: req.jsonSchema as Record<string, unknown> },
          },
          messages: [
            {
              role: 'user',
              content: [
                ...req.images.map((i) => ({
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: i.mediaType,
                    data: i.base64,
                  },
                })),
                { type: 'text' as const, text: req.userText },
              ],
            },
          ],
        })
      } catch (err) {
        throw wrapError(err, opts.apiKey)
      }

      const usage: LlmUsage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      }
      const latencyMs = Date.now() - started

      if (res.stop_reason === 'refusal') {
        return { status: 'refused', json: null, usage, latencyMs, model: res.model }
      }
      if (res.stop_reason === 'max_tokens') {
        throw new LlmError('Resposta do Claude truncada (limite de tokens).', false)
      }
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        throw new LlmError('Resposta do Claude não é JSON válido.', false)
      }
      return { status: 'ok', json, usage, latencyMs, model: res.model }
    },
  }
}
