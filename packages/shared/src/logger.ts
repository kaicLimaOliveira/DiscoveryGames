import pino from 'pino'

export type LogContext = {
  requestId?: string
  jobId?: string
  contentId?: string
  publicationId?: string
  platform?: string
  userId?: string
}

const SECRET_NAMES = [
  'authorization',
  'access_token',
  'refresh_token',
  'client_secret',
  'code',
  'password',
  'cookie',
  'totpSecret',
] as const

const MAX_DEPTH = 4

// Top level plus wildcard prefixes up to MAX_DEPTH levels of nesting.
export const REDACT_PATHS: string[] = SECRET_NAMES.flatMap((name) => [
  name,
  ...Array.from({ length: MAX_DEPTH }, (_, i) => `${'*.'.repeat(i + 1)}${name}`),
])

const CENSOR = '[REDACTED]'
const SIGNATURE_RE = /(X-Amz-Signature=)[^&\s"']*/gi

function scrub(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return value.replace(SIGNATURE_RE, `$1${CENSOR}`)
  if (depth > 0 && value !== null && typeof value === 'object' && !(value instanceof Error)) {
    if (Array.isArray(value)) return value.map((v) => scrub(v, depth - 1))
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, depth - 1)
    return out
  }
  return value
}

export function createLogger(opts: {
  name: string
  level?: string
  destination?: pino.DestinationStream
}): pino.Logger {
  const options: pino.LoggerOptions = {
    name: opts.name,
    level: opts.level ?? 'info',
    redact: { paths: REDACT_PATHS, censor: CENSOR },
    formatters: {
      // strings at first and second level of the log object
      log: (obj) => scrub(obj, 2) as Record<string, unknown>,
    },
  }
  return opts.destination ? pino(options, opts.destination) : pino(options)
}

export function withContext(logger: pino.Logger, ctx: LogContext): pino.Logger {
  return logger.child(ctx)
}
