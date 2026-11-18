import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

export interface TranscriptWord {
  w: string
  s: number
  e: number
}

/** Palavras em ms absolutos (já somado o `offsetMs` de cada bloco). */
export interface TranscriptResult {
  language: string
  text: string
  words: TranscriptWord[]
  durationSec: number
}

export interface Transcriber {
  readonly provider: string
  readonly model: string
  transcribe(
    chunks: Array<{ path: string; offsetMs: number }>,
    language: string,
  ): Promise<TranscriptResult>
}

export class TranscriberError extends Error {
  constructor(
    message: string,
    readonly code: 'HTTP' | 'NO_WORD_TIMESTAMPS' | 'NETWORK',
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'TranscriberError'
  }
}

export interface GroqTranscriberOptions {
  apiKey: string
  /** Só para testes (`NODE_ENV === 'test'`): substitui `https://api.groq.com/openai/v1`. */
  baseUrl?: string
  fetch?: typeof fetch
  /** Total de tentativas por bloco (padrão 3). */
  maxRetries?: number
  /** Só para testes: substitui a espera entre tentativas. */
  sleep?: (ms: number) => Promise<void>
}

const GROQ_BASE = 'https://api.groq.com/openai/v1'
const GROQ_MODEL = 'whisper-large-v3-turbo'
const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_MS = 30_000

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface GroqVerboseResponse {
  text?: unknown
  duration?: unknown
  words?: unknown
}

export function createGroqTranscriber(opts: GroqTranscriberOptions): Transcriber {
  const fetchFn = opts.fetch ?? fetch
  const sleep = opts.sleep ?? defaultSleep
  const attempts = Math.max(1, opts.maxRetries ?? 3)
  const base = (process.env.NODE_ENV === 'test' && opts.baseUrl) || GROQ_BASE

  async function requestChunk(path: string, language: string): Promise<GroqVerboseResponse> {
    const bytes = await readFile(path)
    let last: TranscriberError | undefined
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // O FormData é refeito a cada tentativa: o corpo não pode ser reutilizado.
      const form = new FormData()
      form.set('file', new Blob([new Uint8Array(bytes)], { type: 'audio/ogg' }), basename(path))
      form.set('model', GROQ_MODEL)
      form.set('language', language.split('-')[0]!.toLowerCase())
      // ❓ A página da Groq é inconsistente sobre `timestamp_granularities[]` exigir
      // `verbose_json` ou aceitar `json`. Usamos `verbose_json` e, se a resposta vier sem
      // `words`, falhamos com NO_WORD_TIMESTAMPS em vez de inventar tempos.
      form.set('response_format', 'verbose_json')
      form.set('timestamp_granularities[]', 'word')

      let retryAfterMs: number | undefined
      try {
        const res = await fetchFn(`${base}/audio/transcriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${opts.apiKey}` },
          body: form,
        })
        if (res.ok) return (await res.json()) as GroqVerboseResponse
        const retryable = res.status === 429 || res.status >= 500
        // Corpo da resposta não entra na mensagem: pode ecoar credenciais.
        last = new TranscriberError(
          `A transcrição falhou (HTTP ${res.status}).`,
          'HTTP',
          retryable,
          res.status,
        )
        const header = Number(res.headers.get('retry-after'))
        if (Number.isFinite(header) && header > 0) retryAfterMs = header * 1000
        if (!retryable) throw last
      } catch (err) {
        if (err instanceof TranscriberError) {
          if (!err.retryable) throw err
        } else {
          last = new TranscriberError('Falha de rede ao transcrever.', 'NETWORK', true)
        }
      }
      if (attempt < attempts) {
        const backoff = BACKOFF_BASE_MS * 2 ** (attempt - 1)
        await sleep(Math.min(retryAfterMs ?? backoff, BACKOFF_MAX_MS))
      }
    }
    throw last!
  }

  return {
    provider: 'groq',
    model: GROQ_MODEL,
    async transcribe(chunks, language) {
      const lang = language.split('-')[0]!.toLowerCase()
      const words: TranscriptWord[] = []
      const texts: string[] = []
      let durationSec = 0
      for (const chunk of chunks) {
        const body = await requestChunk(chunk.path, language)
        if (!Array.isArray(body.words)) {
          throw new TranscriberError(
            'A resposta da transcrição veio sem tempos por palavra.',
            'NO_WORD_TIMESTAMPS',
            false,
          )
        }
        let lastEnd = 0
        for (const item of body.words as Array<{ word: string; start: number; end: number }>) {
          words.push({
            w: item.word,
            s: Math.round(item.start * 1000) + chunk.offsetMs,
            e: Math.round(item.end * 1000) + chunk.offsetMs,
          })
          lastEnd = Math.max(lastEnd, item.end)
        }
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (text) texts.push(text)
        const chunkDuration = typeof body.duration === 'number' ? body.duration : lastEnd
        durationSec = Math.max(durationSec, chunk.offsetMs / 1000 + chunkDuration)
      }
      return { language: lang, text: texts.join(' '), words, durationSec }
    },
  }
}
