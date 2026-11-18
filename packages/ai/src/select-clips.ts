import { createHash } from 'node:crypto'
import { z } from 'zod'
import { LlmError, type LlmProvider } from './llm.js'
import { llmCostUsd, type LlmUsage } from './pricing.js'
import { SELECT_CLIPS_V1_TEXT } from './prompts/select-clips-v1.js'

export const SELECT_CLIPS_PROMPT = { id: 'select-clips', version: 1 } as const
/** Texto de prompts/select-clips/v1.md, embutido (o bundle do worker não carrega o arquivo). */
export const SELECT_CLIPS_PROMPT_TEXT = SELECT_CLIPS_V1_TEXT

const MAX_TOKENS = 16000

/** Mesma forma de `Signals` de @central/media (evita dependência de pacote só por tipo). */
export interface SignalsInput {
  loudPeaksSec: number[]
  sceneCutsSec: number[]
  motion: Array<{ startSec: number; score: number }>
}

const countHashtags = (text: string) => (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length

// Limites por rede: docs/07-integracoes. ❓ Facebook: sem limite documentado; 2200 é teto nosso.
export const candidateOutSchema = z
  .object({
    startSec: z.number().min(0),
    endSec: z.number().min(0),
    hookScore: z.number().min(0).max(100),
    reason: z.string().max(200),
    title: z.string().max(100),
    layout: z.enum(['face', 'center', 'game_facecam', 'blur_fit']),
    hashtags: z
      .array(z.string().regex(/^[^#\s]+$/, 'sem # e sem espaços'))
      .max(8)
      .refine((h) => new Set(h.map((x) => x.toLowerCase())).size === h.length, 'hashtag repetida'),
    captions: z.object({
      instagram: z.object({ caption: z.string().max(2200) }),
      facebook: z.object({ caption: z.string().max(2200) }),
      tiktok: z.object({ caption: z.string().max(2200) }),
      youtube: z.object({ title: z.string().max(100), description: z.string().max(5000) }),
    }),
  })
  .refine(
    (c) => countHashtags(c.captions.instagram.caption) + c.hashtags.length <= 30,
    'Instagram aceita no máximo 30 hashtags',
  )

export type CandidateOut = z.infer<typeof candidateOutSchema>

const responseSchema = z.object({ candidates: z.array(candidateOutSchema) })

// A saída estruturada da Anthropic não aceita estas palavras-chave do JSON Schema
// (minimum/maximum, min/maxLength, min/maxItems, uniqueItems, pattern...). Os limites
// continuam valendo no zod, que valida a resposta; só saem do esquema enviado ao modelo
// (as regras também estão escritas no prompt e no contexto).
const UNSUPPORTED = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'pattern',
  'multipleOf',
])
function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip)
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([k]) => !UNSUPPORTED.has(k))
        .map(([k, v]) => [k, strip(v)]),
    )
  }
  return node
}
const jsonSchema = strip(z.toJSONSchema(responseSchema)) as object

export interface SelectClipsInput {
  durationMs: number
  language: string
  params: { targetMin: number; targetMax: number; minSec: number; maxSec: number }
  org: { name: string; tags: string[]; voiceGuide: string }
  transcript: { text: string; words: Array<{ w: string; s: number; e: number }> }
  signals: SignalsInput
  frames: Array<{ atSec: number; base64: string }>
}

export interface SelectClipsRun {
  status: 'ok' | 'invalid_output' | 'refused' | 'error'
  usage: LlmUsage
  costUsd: number
  latencyMs: number
  error?: string
  output?: unknown
}

export interface SelectClipsResult {
  candidates: CandidateOut[]
  runs: SelectClipsRun[]
  inputHash: string
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

export function selectClipsInputHash(
  input: SelectClipsInput,
  model: string,
  promptVersion: number = SELECT_CLIPS_PROMPT.version,
): string {
  const frames = input.frames.map((f) => ({ atSec: f.atSec, sha256: sha256(f.base64) }))
  return sha256(canonical({ input: { ...input, frames }, model, promptVersion }))
}

const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Linhas `[mm:ss] texto`, uma por janela de ~10 s. */
function transcriptLines(words: SelectClipsInput['transcript']['words']): string {
  const buckets = new Map<number, { start: number; words: string[] }>()
  for (const w of [...words].sort((a, b) => a.s - b.s)) {
    const key = Math.floor(w.s / 10)
    const b = buckets.get(key) ?? { start: w.s, words: [] }
    b.words.push(w.w)
    buckets.set(key, b)
  }
  return [...buckets.values()].map((b) => `[${mmss(b.start)}] ${b.words.join(' ')}`).join('\n')
}

const list = (xs: number[], max = 60) =>
  xs.length === 0
    ? 'nenhum'
    : xs
        .slice(0, max)
        .map((x) => `${mmss(x)} (${x.toFixed(1)}s)`)
        .join(', ')

function buildCachedContext(input: SelectClipsInput): string {
  const { params, org } = input
  return [
    `Organização: ${org.name}`,
    `Tags: ${org.tags.length ? org.tags.join(', ') : 'nenhuma'}`,
    `Guia de voz: ${org.voiceGuide || 'não informado'}`,
    `Idioma dos textos: ${input.language}`,
    `Quantidade de cortes: de ${params.targetMin} a ${params.targetMax}`,
    `Duração de cada corte: de ${params.minSec} a ${params.maxSec} segundos`,
    'Limites por rede: Instagram legenda até 2200 caracteres e até 30 hashtags no total; TikTok legenda até 2200; Facebook legenda até 2200; YouTube título até 100 e descrição até 5000.',
    'Limites do candidato: reason até 200 caracteres; title até 100; hashtags até 8; hookScore de 0 a 100.',
  ].join('\n')
}

function buildUserText(input: SelectClipsInput): string {
  const lines = transcriptLines(input.transcript.words)
  const motion = [...input.signals.motion]
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .sort((a, b) => a.startSec - b.startSec)
  const motionText = motion.length
    ? motion.map((m) => `${m.startSec.toFixed(0)}s: ${m.score.toFixed(2)}`).join(', ')
    : 'nenhum'
  return [
    `Duração do vídeo: ${(input.durationMs / 1000).toFixed(1)} segundos.`,
    `Picos de volume: ${list(input.signals.loudPeaksSec)}`,
    `Cortes de cena: ${list(input.signals.sceneCutsSec)}`,
    `Movimento (maiores, início: nota): ${motionText}`,
    `Quadros enviados (na ordem), em: ${
      input.frames.length ? input.frames.map((f) => mmss(f.atSec)).join(', ') : 'nenhum'
    }`,
    '',
    'Transcrição:',
    lines || 'Vídeo sem fala: não há transcrição. Use os sinais e os quadros.',
  ].join('\n')
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function postValidate(cands: CandidateOut[], input: SelectClipsInput): CandidateOut[] {
  const { minSec, maxSec, targetMax } = input.params
  const durationSec = input.durationMs / 1000
  const kept: CandidateOut[] = []
  const valid = cands
    .filter((c) => {
      const d = c.endSec - c.startSec
      return c.startSec >= 0 && c.endSec <= durationSec && d >= minSec && d <= maxSec
    })
    .map((c) => ({ ...c, startSec: round1(c.startSec), endSec: round1(c.endSec) }))
    .sort((a, b) => b.hookScore - a.hookScore)
  for (const c of valid) {
    const overlapsTooMuch = kept.some((k) => {
      const overlap = Math.min(c.endSec, k.endSec) - Math.max(c.startSec, k.startSec)
      const smaller = Math.min(c.endSec - c.startSec, k.endSec - k.startSec)
      return overlap > 0.5 * smaller
    })
    if (!overlapsTooMuch) kept.push(c)
  }
  return kept.slice(0, targetMax)
}

const ZERO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

export async function selectClips(
  llm: LlmProvider,
  input: SelectClipsInput,
  opts: { model: string; maxAttempts?: number },
): Promise<SelectClipsResult> {
  const maxAttempts = opts.maxAttempts ?? 3
  const inputHash = selectClipsInputHash(input, opts.model)
  const runs: SelectClipsRun[] = []
  const request = {
    model: opts.model,
    system: SELECT_CLIPS_PROMPT_TEXT,
    cachedContext: buildCachedContext(input),
    userText: buildUserText(input),
    images: input.frames.map((f) => ({ mediaType: 'image/jpeg' as const, base64: f.base64 })),
    jsonSchema,
    maxTokens: MAX_TOKENS,
    effort: 'medium' as const,
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res
    try {
      res = await llm.generateStructured(request)
    } catch (err) {
      if (!(err instanceof LlmError)) throw err
      runs.push({
        status: 'error',
        usage: { ...ZERO_USAGE },
        costUsd: 0,
        latencyMs: 0,
        error: err.message,
      })
      if (err.retryable) continue
      break
    }
    const base = {
      usage: res.usage,
      costUsd: llmCostUsd(opts.model, res.usage),
      latencyMs: res.latencyMs,
    }
    if (res.status === 'refused') {
      runs.push({ status: 'refused', ...base })
      break
    }
    if (res.status === 'invalid') {
      runs.push({ status: 'invalid_output', ...base, error: res.error ?? 'Resposta inutilizável.' })
      continue
    }
    const parsed = responseSchema.safeParse(res.json)
    if (!parsed.success) {
      runs.push({
        status: 'invalid_output',
        ...base,
        error: 'A resposta não segue o esquema esperado.',
        output: res.json,
      })
      continue
    }
    const candidates = postValidate(parsed.data.candidates, input)
    if (candidates.length === 0) {
      runs.push({
        status: 'invalid_output',
        ...base,
        error: 'Nenhum candidato válido após a validação.',
        output: res.json,
      })
      continue
    }
    runs.push({ status: 'ok', ...base, output: res.json })
    return { candidates, runs, inputHash }
  }
  return { candidates: [], runs, inputHash }
}
