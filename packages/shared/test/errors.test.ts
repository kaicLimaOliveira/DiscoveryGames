import { expect, it } from 'vitest'
import {
  AppError,
  AuthError,
  ConfigError,
  PermanentError,
  PolicyError,
  RateLimitError,
  TransientError,
  UnknownOutcomeError,
} from '../src/errors'

it('RateLimitError carrega retryAfterMs e é AppError', () => {
  const e = new RateLimitError('x', 5000)
  expect(e.retryAfterMs).toBe(5000)
  expect(e).toBeInstanceOf(AppError)
  expect(e).toBeInstanceOf(Error)
  expect(e.code).toBe('RATE_LIMIT')
})

it.each([
  [TransientError, 'TransientError', 'TRANSIENT'],
  [AuthError, 'AuthError', 'AUTH'],
  [PermanentError, 'PermanentError', 'PERMANENT'],
  [PolicyError, 'PolicyError', 'POLICY'],
  [UnknownOutcomeError, 'UnknownOutcomeError', 'UNKNOWN_OUTCOME'],
])('%s: name, code, instanceof e cause', (Cls, name, code) => {
  const cause = new Error('raiz')
  const e = new Cls('msg', { cause })
  expect(e.name).toBe(name)
  expect(e.code).toBe(code)
  expect(e.message).toBe('msg')
  expect(e.cause).toBe(cause)
  expect(e).toBeInstanceOf(Cls)
  expect(e).toBeInstanceOf(AppError)
})

it('ConfigError mantém keys, mensagem e código', () => {
  const e = new ConfigError(['A', 'B'])
  expect(e.keys).toEqual(['A', 'B'])
  expect(e.message).toBe('Configuração inválida: A, B')
  expect(e.name).toBe('ConfigError')
  expect(e.code).toBe('CONFIG_INVALID')
  expect(e).toBeInstanceOf(AppError)
})
