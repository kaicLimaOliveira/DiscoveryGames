import { baseEnvSchema, cryptoEnvSchema, loadConfig, storageEnvSchema } from '@central/shared'
import { z } from 'zod'

export const webEnvSchema = baseEnvSchema
  .extend(storageEnvSchema.shape)
  .extend(cryptoEnvSchema.shape)
  .extend({
    APP_ORIGIN: z.url().transform((v) => new URL(v).origin),
    // Consumida pelo nuxt-auth-utils para selar o cookie; validada aqui para falhar cedo.
    NUXT_SESSION_PASSWORD: z.string().min(32),
    TOTP_ISSUER: z.string().min(1).default('Central de Conteúdo'),
    // Atrás do Caddy o IP do cliente vem em X-Forwarded-For.
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })

export type WebConfig = z.infer<typeof webEnvSchema>

let cached: WebConfig | undefined

/** Configuração do web validada uma vez (erro lista só os nomes das variáveis). */
export function useWebConfig(): WebConfig {
  cached ??= loadConfig(webEnvSchema)
  return cached
}
