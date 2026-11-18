import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TranscriberError, createGroqTranscriber } from '../src/index.js'

const KEY = 'gsk_segredo_123'
const dir = mkdtempSync(join(tmpdir(), 'ai-test-'))
const mk = (name: string) => {
  const p = join(dir, name)
  writeFileSync(p, Buffer.from('audio'))
  return p
}
const ok = (words: unknown, extra: object = {}) =>
  new Response(JSON.stringify({ text: 'oi mundo', duration: 2, words, ...extra }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
const WORDS = [
  { word: 'oi', start: 0.5, end: 1.0 },
  { word: 'mundo', start: 1.0, end: 1.5 },
]
const noSleep = async () => {}
const fail = (s: number) => () => new Response('x', { status: s })

function make(responses: Array<() => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let i = 0
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = responses[Math.min(i++, responses.length - 1)]!
    return r()
  }) as typeof fetch
  return { fetchFn, calls }
}

describe('createGroqTranscriber', () => {
  it('transcribe envia modelo, idioma pt e granularidade word', async () => {
    const { fetchFn, calls } = make([() => ok(WORDS)])
    const t = createGroqTranscriber({ apiKey: KEY, fetch: fetchFn, sleep: noSleep })
    await t.transcribe([{ path: mk('a.ogg'), offsetMs: 0 }], 'pt-BR')
    const form = calls[0]!.init!.body as FormData
    expect(calls[0]!.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(form.get('model')).toBe('whisper-large-v3-turbo')
    expect(form.get('language')).toBe('pt')
    expect(form.get('response_format')).toBe('verbose_json')
    expect(form.get('timestamp_granularities[]')).toBe('word')
    expect(form.get('file')).toBeInstanceOf(Blob)
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
  })

  it('transcribe soma offsets dos blocos', async () => {
    const { fetchFn } = make([() => ok(WORDS), () => ok(WORDS)])
    const t = createGroqTranscriber({ apiKey: KEY, fetch: fetchFn, sleep: noSleep })
    const r = await t.transcribe(
      [
        { path: mk('a.ogg'), offsetMs: 0 },
        { path: mk('b.ogg'), offsetMs: 600_000 },
      ],
      'pt-BR',
    )
    expect(r.words[1]!.s).toBe(1000)
    expect(r.words[3]!.s).toBe(601_000)
    expect(r.words[3]!.e).toBe(601_500)
    expect(r.durationSec).toBe(602)
    expect(r.text).toBe('oi mundo oi mundo')
    expect(r.language).toBe('pt')
  })

  it('transcribe repete em 429 e 503 e desiste depois de maxRetries', async () => {
    const a = make([fail(429), fail(503), () => ok(WORDS)])
    const t = createGroqTranscriber({ apiKey: KEY, fetch: a.fetchFn, sleep: noSleep })
    const r = await t.transcribe([{ path: mk('a.ogg'), offsetMs: 0 }], 'pt')
    expect(r.words).toHaveLength(2)
    expect(a.calls).toHaveLength(3)

    const b = make([fail(503), fail(429), fail(503), fail(503), () => ok(WORDS)])
    const t2 = createGroqTranscriber({
      apiKey: KEY,
      fetch: b.fetchFn,
      maxRetries: 3,
      sleep: noSleep,
    })
    const err = await t2.transcribe([{ path: mk('a.ogg'), offsetMs: 0 }], 'pt').catch((e) => e)
    expect(err).toBeInstanceOf(TranscriberError)
    expect(err.retryable).toBe(true)
    expect(err.code).toBe('HTTP')
    expect(b.calls).toHaveLength(3)
  })

  it('erro de rede é repetido e vira NETWORK', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const t = createGroqTranscriber({ apiKey: KEY, fetch: fetchFn, sleep: noSleep })
    const err = await t.transcribe([{ path: mk('a.ogg'), offsetMs: 0 }], 'pt').catch((e) => e)
    expect(err.code).toBe('NETWORK')
    expect(err.retryable).toBe(true)
  })

  it('transcribe não repete em 400 e a mensagem não contém a chave', async () => {
    const a = make([() => new Response(`bad key ${KEY}`, { status: 400 })])
    const t = createGroqTranscriber({ apiKey: KEY, fetch: a.fetchFn, sleep: noSleep })
    const err = await t.transcribe([{ path: mk('a.ogg'), offsetMs: 0 }], 'pt').catch((e) => e)
    expect(err).toBeInstanceOf(TranscriberError)
    expect(err.status).toBe(400)
    expect(err.retryable).toBe(false)
    expect(err.message).not.toContain(KEY)
    expect(a.calls).toHaveLength(1)
  })

  it('resposta sem words rejeita com NO_WORD_TIMESTAMPS', async () => {
    const { fetchFn } = make([() => ok(undefined)])
    const t = createGroqTranscriber({ apiKey: KEY, fetch: fetchFn, sleep: noSleep })
    const err = await t.transcribe([{ path: mk('a.ogg'), offsetMs: 0 }], 'pt').catch((e) => e)
    expect(err.code).toBe('NO_WORD_TIMESTAMPS')
    expect(err.retryable).toBe(false)
  })

  it('palavra sem start rejeita com NO_WORD_TIMESTAMPS', async () => {
    const { fetchFn } = make([() => ok([{ word: 'oi', end: 1 }])])
    const t = createGroqTranscriber({ apiKey: KEY, fetch: fetchFn, sleep: noSleep })
    const err = await t.transcribe([{ path: mk('a.ogg'), offsetMs: 0 }], 'pt').catch((e) => e)
    expect(err.code).toBe('NO_WORD_TIMESTAMPS')
    expect(err.retryable).toBe(false)
  })

  it('200 com corpo que não é JSON falha sem repetir (HTTP, não NETWORK)', async () => {
    const a = make([() => new Response('<html>', { status: 200 })])
    const t = createGroqTranscriber({ apiKey: KEY, fetch: a.fetchFn, sleep: noSleep })
    const err = await t.transcribe([{ path: mk('a.ogg'), offsetMs: 0 }], 'pt').catch((e) => e)
    expect(err.code).toBe('HTTP')
    expect(err.status).toBe(200)
    expect(err.retryable).toBe(false)
    expect(a.calls).toHaveLength(1)
  })

  it('vídeo sem fala (words vazio) é sinal, não erro', async () => {
    const { fetchFn } = make([() => ok([], { text: '' })])
    const t = createGroqTranscriber({ apiKey: KEY, fetch: fetchFn, sleep: noSleep })
    const r = await t.transcribe([{ path: mk('a.ogg'), offsetMs: 0 }], 'pt')
    expect(r.words).toEqual([])
    expect(r.text).toBe('')
  })

  it('respeita retry-after', async () => {
    const waits: number[] = []
    const a = make([
      () => new Response('x', { status: 429, headers: { 'retry-after': '2' } }),
      () => ok(WORDS),
    ])
    const t = createGroqTranscriber({
      apiKey: KEY,
      fetch: a.fetchFn,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })
    await t.transcribe([{ path: mk('a.ogg'), offsetMs: 0 }], 'pt')
    expect(waits).toEqual([2000])
  })
})
