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
  'password',
  'cookie',
  'totpSecret',
] as const

// Profundidade máxima (níveis de objeto/array) em que chaves sensíveis e strings são limpas;
// o que estiver mais fundo passa sem redação por chave.
const MAX_DEPTH = 4

// Comparação sem caixa e sem `_`/`-` (accessToken, access_token, ACCESS-TOKEN...). Os paths do
// pino não aceitam isso, então a redação por chave roda também no scrub recursivo.
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, '')
const SENSITIVE_KEYS = new Set(
  [
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'idToken',
    'secret',
    'clientSecret',
    'appSecret',
    'authorization',
    'cookie',
    'setCookie',
    'apiKey',
    'codeVerifier',
    'credential',
    'credentialEnc',
    'totpSecret',
  ].map(normalizeKey),
)

// `code` (OAuth) só é segredo em objetos com formato de requisição; um `*.code` genérico
// apagaria códigos de erro (ECONNREFUSED, P2002) de `err.code`.
const REQUEST_PARENTS = ['query', 'body', 'params'] as const
const CODE_PATHS: string[] = REQUEST_PARENTS.flatMap((parent) =>
  Array.from({ length: MAX_DEPTH }, (_, i) => `${'*.'.repeat(i)}${parent}.code`),
)

// Top level plus wildcard prefixes up to MAX_DEPTH levels of nesting.
export const REDACT_PATHS: string[] = SECRET_NAMES.flatMap((name) => [
  name,
  ...Array.from({ length: MAX_DEPTH }, (_, i) => `${'*.'.repeat(i + 1)}${name}`),
]).concat(CODE_PATHS)

const CENSOR = '[REDACTED]'
const SIGNATURE_RE = /(X-Amz-Signature=)[^&\s"']*/gi

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

const TOKEN_PARAM_RE =
  /((?:access_token|refresh_token|client_secret|code_verifier|appsecret_proof)=)[^&\s"']*/gi
const BEARER_RE = /(Bearer\s+)[^\s"',;]+/gi

function scrubString(value: string): string {
  return value
    .replace(SIGNATURE_RE, `$1${CENSOR}`)
    .replace(TOKEN_PARAM_RE, `$1${CENSOR}`)
    .replace(BEARER_RE, `$1${CENSOR}`)
}

function scrub(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrubString(value)
  if (depth > 0 && Array.isArray(value)) return value.map((v) => scrub(v, depth - 1))
  if (depth > 0 && isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(normalizeKey(k)) ? CENSOR : scrub(v, depth - 1)
    }
    return out
  }
  // pino's redact traversal breaks on some exotic instances (e.g. URL); their
  // JSON form is what would be serialized anyway, so hand over that instead.
  if (value !== null && typeof value === 'object' && !(value instanceof Error)) {
    const toJSON = (value as { toJSON?: unknown }).toJSON
    if (typeof toJSON === 'function') return scrub((toJSON as () => unknown).call(value), depth)
  }
  return value
}

function scrubArg(a: unknown): unknown {
  return typeof a === 'string' ? scrubString(a) : a
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
    serializers: {
      err: (err: unknown) => {
        const out = pino.stdSerializers.err(err as Error) as unknown as Record<string, unknown>
        // o resultado do serializer tem protótipo próprio; copiar para objeto simples para o scrub percorrer
        return scrub({ ...out }, MAX_DEPTH)
      },
    },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a, i) => (i > 0 || typeof a === 'string' ? scrubArg(a) : a))
        method.apply(this, scrubbed as unknown as Parameters<typeof method>)
      },
    },
    formatters: {
      // strings and sensitive keys down to MAX_DEPTH levels of the log object
      log: (obj) => scrub(obj, MAX_DEPTH) as Record<string, unknown>,
    },
  }
  return opts.destination ? pino(options, opts.destination) : pino(options)
}

export function withContext(logger: pino.Logger, ctx: LogContext): pino.Logger {
  return logger.child(ctx)
}
