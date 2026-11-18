import {
  baseEnvSchema,
  cryptoEnvSchema,
  emptyAsUnset,
  loadConfig,
  storageEnvSchema,
} from '@central/shared'
import { z } from 'zod'

export const webEnvSchema = baseEnvSchema
  .extend(storageEnvSchema.shape)
  .extend(cryptoEnvSchema.shape)
  .extend({
    APP_ORIGIN: z.url().transform((v) => new URL(v).origin),
    // Consumida pelo nuxt-auth-utils para selar o cookie; validada aqui para falhar cedo.
    NUXT_SESSION_PASSWORD: z.string().min(32),
    TOTP_ISSUER: z.preprocess(emptyAsUnset, z.string().min(1).default('Central de Conteúdo')),
    // Atrás do Caddy o IP do cliente vem em X-Forwarded-For.
    TRUST_PROXY: z.preprocess(
      emptyAsUnset,
      z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    ),
    // Meta: a integração só vale com as três definidas; sem valor padrão para a versão.
    META_APP_ID: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
    META_APP_SECRET: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
    META_GRAPH_VERSION: z.preprocess(
      emptyAsUnset,
      z
        .string()
        .regex(/^v\d+\.\d+$/)
        .optional(),
    ),
    // SÓ PARA TESTES: host alternativo da Graph API. Só vale com NODE_ENV=test.
    META_GRAPH_BASE_URL: z.preprocess(emptyAsUnset, z.url().optional()),
    // Google/YouTube: a integração só vale com as duas credenciais definidas.
    GOOGLE_OAUTH_CLIENT_ID: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
    GOOGLE_OAUTH_CLIENT_SECRET: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
    // SÓ PARA TESTES: hosts alternativos do Google. Só valem com NODE_ENV=test.
    GOOGLE_OAUTH_BASE_URL: z.preprocess(emptyAsUnset, z.url().optional()),
    YOUTUBE_API_BASE_URL: z.preprocess(emptyAsUnset, z.url().optional()),
  })

export type WebConfig = z.infer<typeof webEnvSchema>

export interface MetaConfig {
  appSecret: string
  graphVersion: string
  baseUrl?: string
}

/** Configuração da Meta, ou `null` se faltar qualquer um dos três `META_*`. */
export function metaConfig(config: WebConfig): MetaConfig | null {
  const { META_APP_ID, META_APP_SECRET, META_GRAPH_VERSION } = config
  if (!META_APP_ID || !META_APP_SECRET || !META_GRAPH_VERSION) return null
  return {
    appSecret: META_APP_SECRET,
    graphVersion: META_GRAPH_VERSION,
    baseUrl: config.NODE_ENV === 'test' ? config.META_GRAPH_BASE_URL : undefined,
  }
}

export interface GoogleConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  oauthBaseUrl?: string
  apiBaseUrl?: string
}

/** Configuração do Google, ou `null` se faltar o client id ou o secret. */
export function googleConfig(config: WebConfig): GoogleConfig | null {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET } = config
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) return null
  const isTest = config.NODE_ENV === 'test'
  return {
    clientId: GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: `${config.APP_ORIGIN}/api/oauth/youtube/callback`,
    oauthBaseUrl: isTest ? config.GOOGLE_OAUTH_BASE_URL : undefined,
    apiBaseUrl: isTest ? config.YOUTUBE_API_BASE_URL : undefined,
  }
}

let cached: WebConfig | undefined

/** Configuração do web validada uma vez (erro lista só os nomes das variáveis). */
export function useWebConfig(): WebConfig {
  cached ??= loadConfig(webEnvSchema)
  return cached
}
