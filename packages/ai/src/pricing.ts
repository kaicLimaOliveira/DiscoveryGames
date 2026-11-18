// Preços em US$. Referência 2026 (docs/09 e docs/04), confirmar na página oficial.
export const PRICES = {
  'claude-opus-5-5': { inPerMTok: 4, outPerMTok: 20, cacheReadPerMTok: 0.4, cacheWritePerMTok: 5 },
  'whisper-large-v3-turbo': { perHour: 0.04, minBilledSec: 10 },
} as const

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export function llmCostUsd(model: string, usage: LlmUsage): number {
  const price = model === 'claude-opus-5-5' ? PRICES[model] : undefined
  if (!price) throw new Error(`Modelo sem preço cadastrado: ${model}`)
  return (
    (usage.inputTokens * price.inPerMTok +
      usage.outputTokens * price.outPerMTok +
      usage.cacheReadTokens * price.cacheReadPerMTok +
      usage.cacheWriteTokens * price.cacheWritePerMTok) /
    1_000_000
  )
}

/** Cada bloco é cobrado com o mínimo de 10 s da Groq. */
export function transcriptionCostUsd(chunkDurationsSec: number[]): number {
  const { perHour, minBilledSec } = PRICES['whisper-large-v3-turbo']
  const billedSec = chunkDurationsSec.reduce((sum, d) => sum + Math.max(d, minBilledSec), 0)
  return (billedSec / 3600) * perHour
}

// Premissas da estimativa de uma análise (entrada do Claude).
export const ANALYSIS_TOKENS_PER_MIN = 200
export const ANALYSIS_FRAME_TOKENS = 450
export const ANALYSIS_OVERHEAD_TOKENS = 3000
export const ANALYSIS_OUTPUT_TOKENS = 4000

/** Estimativa antes de analisar: transcrição da duração inteira + uma chamada do Claude. */
export function estimateAnalysisCostUsd(durationMs: number, frameCount: number): number {
  const minutes = durationMs / 60_000
  const inputTokens =
    Math.ceil(minutes * ANALYSIS_TOKENS_PER_MIN) +
    frameCount * ANALYSIS_FRAME_TOKENS +
    ANALYSIS_OVERHEAD_TOKENS
  const claude = llmCostUsd('claude-opus-5-5', {
    inputTokens,
    outputTokens: ANALYSIS_OUTPUT_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  })
  return claude + transcriptionCostUsd([durationMs / 1000])
}
