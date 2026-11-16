import { z } from 'zod'
import { ConfigError } from './errors'

export function loadConfig<S extends z.ZodTypeAny>(
  schema: S,
  env: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(env)
  if (!result.success) {
    const keys: string[] = []
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? '(config)')
      if (!keys.includes(key)) keys.push(key)
    }
    throw new ConfigError(keys)
  }
  return result.data
}

/** Variável opcional: string vazia (ex.: `VAR: ${VAR:-}` no compose) vale como não definida. */
export const emptyAsUnset = (v: unknown) => (v === '' ? undefined : v)

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().min(1).default('info'),
  DATABASE_URL: z.url(),
  SENTRY_DSN: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
})

export const storageEnvSchema = z.object({
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default('auto'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
})

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

export const cryptoEnvSchema = z.object({
  APP_ENCRYPTION_KEYS: z.string().transform((raw, ctx) => {
    const keys = new Map<number, Buffer>()
    const fail = () => {
      ctx.addIssue({ code: 'custom', message: 'formato inválido' })
      return z.NEVER
    }
    if (raw.trim() === '') return fail()
    for (const entry of raw.split(',')) {
      const sep = entry.indexOf(':')
      if (sep < 0) return fail()
      const versionText = entry.slice(0, sep).trim()
      const material = entry.slice(sep + 1).trim()
      if (!/^[1-9]\d*$/.test(versionText)) return fail()
      const version = Number(versionText)
      if (!Number.isSafeInteger(version) || keys.has(version)) return fail()
      if (!BASE64.test(material)) return fail()
      const buf = Buffer.from(material, 'base64')
      if (buf.length !== 32) return fail()
      keys.set(version, buf)
    }
    return keys
  }),
})
