import { AppError } from '@central/shared'

export class DomainError extends AppError {}

export class InvalidCredentialsError extends DomainError {
  constructor(message = 'E-mail ou senha inválidos.', options?: ErrorOptions) {
    super('INVALID_CREDENTIALS', message, options)
  }
}

export class TooManyAttemptsError extends DomainError {
  readonly retryAfterMs: number

  constructor(retryAfterMs: number, message = 'Muitas tentativas. Tente novamente mais tarde.') {
    super('TOO_MANY_ATTEMPTS', message)
    this.retryAfterMs = retryAfterMs
  }
}

export class InvalidTotpError extends DomainError {
  constructor(message = 'Código de verificação inválido.', options?: ErrorOptions) {
    super('INVALID_TOTP', message, options)
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Você não tem permissão para esta ação.', options?: ErrorOptions) {
    super('FORBIDDEN', message, options)
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'Conflito com o estado atual do recurso.', options?: ErrorOptions) {
    super('CONFLICT', message, options)
  }
}

export class LastAdminError extends DomainError {
  constructor(message = 'Não é possível remover o último administrador.', options?: ErrorOptions) {
    super('LAST_ADMIN', message, options)
  }
}

export class ValidationError extends DomainError {
  constructor(message = 'Dados inválidos.', options?: ErrorOptions) {
    super('VALIDATION', message, options)
  }
}
