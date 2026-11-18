import { AppError } from '@central/shared'
import { expect, it } from 'vitest'
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidTotpError,
  LastAdminError,
  NotFoundError,
  TooManyAttemptsError,
  ValidationError,
} from '../src/errors.js'

it('cada erro tem código estável e é DomainError/AppError', () => {
  const list: Array<[DomainError, string]> = [
    [new InvalidCredentialsError(), 'INVALID_CREDENTIALS'],
    [new TooManyAttemptsError(5000), 'TOO_MANY_ATTEMPTS'],
    [new InvalidTotpError(), 'INVALID_TOTP'],
    [new ForbiddenError(), 'FORBIDDEN'],
    [new ConflictError(), 'CONFLICT'],
    [new LastAdminError(), 'LAST_ADMIN'],
    [new ValidationError('x'), 'VALIDATION'],
    [new NotFoundError(), 'NOT_FOUND'],
  ]
  for (const [e, code] of list) {
    expect(e.code).toBe(code)
    expect(e).toBeInstanceOf(DomainError)
    expect(e).toBeInstanceOf(AppError)
    expect(e.message.length).toBeGreaterThan(0)
  }
  expect(new TooManyAttemptsError(5000).retryAfterMs).toBe(5000)
})
