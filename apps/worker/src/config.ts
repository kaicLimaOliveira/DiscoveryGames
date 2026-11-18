import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { llmCostUsd } from '@central/ai'
import { baseEnvSchema, emptyAsUnset, storageEnvSchema } from '@central/shared'

const optionalKey = z.preprocess(emptyAsUnset, z.string().min(1).optional())

/** O modelo precisa ter preço cadastrado: sem isso o custo de cada chamada não seria lançado. */
function hasPrice(model: string): boolean {
  try {
    llmCostUsd(model, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    return true
  } catch {
    return false
  }
}

/**
 * Configuração do worker. As chaves de IA são opcionais: sem elas o worker sobe e a análise
 * termina em `failed` com "Integração de IA não configurada.".
 */
export const workerEnvSchema = baseEnvSchema.extend(storageEnvSchema.shape).extend({
  ANTHROPIC_API_KEY: optionalKey,
  GROQ_API_KEY: optionalKey,
  AI_MODEL: z.preprocess(
    emptyAsUnset,
    z.string().min(1).default('claude-opus-5-5').refine(hasPrice, 'modelo sem preço cadastrado'),
  ),
  SCRATCH_DIR: z.preprocess(
    emptyAsUnset,
    z.string().min(1).default(join(tmpdir(), 'central-scratch')),
  ),
  // Download por link (Task 10).
  YTDLP_ENABLED: z
    .preprocess(emptyAsUnset, z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  YTDLP_PATH: optionalKey,
})

export type WorkerEnv = z.infer<typeof workerEnvSchema>
