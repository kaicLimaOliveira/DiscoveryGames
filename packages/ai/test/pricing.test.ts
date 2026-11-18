import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_FRAME_TOKENS,
  ANALYSIS_OUTPUT_TOKENS,
  ANALYSIS_OVERHEAD_TOKENS,
  ANALYSIS_TOKENS_PER_MIN,
  PRICES,
  estimateAnalysisCostUsd,
  llmCostUsd,
  transcriptionCostUsd,
} from '../src/index.js'

describe('transcriptionCostUsd', () => {
  it('uma hora custa US$ 0,04', () => {
    expect(transcriptionCostUsd([3600])).toBe(0.04)
  })
  it('cobra no mínimo 10 s por bloco', () => {
    expect(transcriptionCostUsd([5])).toBeCloseTo((0.04 * 10) / 3600, 12)
  })
})

describe('llmCostUsd', () => {
  const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  it('calcula entrada, saída e cache', () => {
    expect(llmCostUsd('claude-opus-5-5', { ...zero, inputTokens: 1_000_000 })).toBe(4)
    expect(llmCostUsd('claude-opus-5-5', { ...zero, outputTokens: 1_000_000 })).toBe(20)
    expect(llmCostUsd('claude-opus-5-5', { ...zero, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.4)
    expect(llmCostUsd('claude-opus-5-5', { ...zero, cacheWriteTokens: 1_000_000 })).toBe(5)
  })
  it('modelo desconhecido lança', () => {
    expect(() => llmCostUsd('modelo-x', zero)).toThrow()
  })
})

describe('estimateAnalysisCostUsd', () => {
  it('soma transcrição e Claude pelas constantes exportadas', () => {
    const tokensIn =
      Math.ceil(60 * ANALYSIS_TOKENS_PER_MIN) +
      40 * ANALYSIS_FRAME_TOKENS +
      ANALYSIS_OVERHEAD_TOKENS
    const claude =
      (tokensIn * PRICES['claude-opus-5-5'].inPerMTok +
        ANALYSIS_OUTPUT_TOKENS * PRICES['claude-opus-5-5'].outPerMTok) /
      1_000_000
    const groq = (3600 / 3600) * PRICES['whisper-large-v3-turbo'].perHour
    expect(estimateAnalysisCostUsd(3_600_000, 40)).toBeCloseTo(claude + groq, 10)
  })
})
