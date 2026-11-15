import { describe, it, expect } from 'vitest'
import { loadConfig, baseEnvSchema, cryptoEnvSchema, ConfigError } from '../src'

const key = (b: number) => Buffer.alloc(32, b).toString('base64')

describe('loadConfig', () => {
  it('aplica padrões', () => {
    const c = loadConfig(baseEnvSchema, { DATABASE_URL: 'postgres://u:p@h:5432/d' })
    expect(c.NODE_ENV).toBe('development')
    expect(c.LOG_LEVEL).toBe('info')
  })
  it('lista nomes inválidos sem vazar valores', () => {
    try {
      loadConfig(baseEnvSchema, { DATABASE_URL: 'segredo-nao-url' })
      expect.fail()
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).keys).toEqual(['DATABASE_URL'])
      expect((e as Error).message).not.toContain('segredo-nao-url')
    }
  })
  it('APP_ENCRYPTION_KEYS vira mapa versão→chave de 32 bytes', () => {
    const c = loadConfig(cryptoEnvSchema, { APP_ENCRYPTION_KEYS: `1:${key(1)},2:${key(2)}` })
    expect([...c.APP_ENCRYPTION_KEYS.keys()]).toEqual([1, 2])
    expect(c.APP_ENCRYPTION_KEYS.get(2)!.length).toBe(32)
  })
  it.each(['', '1:abc', `x:${key(1)}`, `1:${key(1)},1:${key(2)}`])(
    'rejeita APP_ENCRYPTION_KEYS=%j',
    (v) => {
      expect(() => loadConfig(cryptoEnvSchema, { APP_ENCRYPTION_KEYS: v })).toThrow(ConfigError)
    },
  )
})
