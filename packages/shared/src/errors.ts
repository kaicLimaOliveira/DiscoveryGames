export interface ErrorOptions {
  cause?: unknown
}

export class AppError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

export class TransientError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('TRANSIENT', message, options)
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterMs: number

  constructor(message: string, retryAfterMs: number, options?: ErrorOptions) {
    super('RATE_LIMIT', message, options)
    this.retryAfterMs = retryAfterMs
  }
}

export class AuthError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('AUTH', message, options)
  }
}

export class PermanentError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('PERMANENT', message, options)
  }
}

export class PolicyError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('POLICY', message, options)
  }
}

export class UnknownOutcomeError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('UNKNOWN_OUTCOME', message, options)
  }
}

export class ConfigError extends AppError {
  readonly keys: string[]

  constructor(keys: string[], options?: ErrorOptions) {
    super('CONFIG_INVALID', `Configuração inválida: ${keys.join(', ')}`, options)
    this.keys = keys
  }
}
