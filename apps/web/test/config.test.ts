import { loadConfig } from '@central/shared'
import { describe, expect, it } from 'vitest'
import { metaConfig, webEnvSchema } from '../server/utils/config'

const base = {
  DATABASE_URL: 'postgres://u:p@h:5432/d',
  APP_ORIGIN: 'http://localhost',
  NUXT_SESSION_PASSWORD: 'x'.repeat(32),
  APP_ENCRYPTION_KEYS: '1:ZmljdGl0aW91cy1kZXYta2V5LW5vdC1zZWNyZXQtMDA=',
  S3_BUCKET: 'b',
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY_ID: 'a',
  S3_SECRET_ACCESS_KEY: 's',
}

describe('webEnvSchema', () => {
  it('TOTP_ISSUER e TRUST_PROXY vazios (compose) valem como não definidos', () => {
    const c = loadConfig(webEnvSchema, { ...base, TOTP_ISSUER: '', TRUST_PROXY: '' })
    expect(c.TOTP_ISSUER).toBe('Central de Conteúdo')
    expect(c.TRUST_PROXY).toBe(false)
  })
  it('respeita valores definidos', () => {
    const c = loadConfig(webEnvSchema, { ...base, TOTP_ISSUER: 'Minha', TRUST_PROXY: 'true' })
    expect(c.TOTP_ISSUER).toBe('Minha')
    expect(c.TRUST_PROXY).toBe(true)
  })

  describe('metaConfig', () => {
    const meta = { META_APP_ID: '123', META_APP_SECRET: 'segredo', META_GRAPH_VERSION: 'v21.0' }
    const load = (extra: Record<string, string>) => loadConfig(webEnvSchema, { ...base, ...extra })

    it('só vale com os três META_* (vazios contam como ausentes)', () => {
      expect(metaConfig(load({}))).toBeNull()
      expect(metaConfig(load({ ...meta, META_GRAPH_VERSION: '' }))).toBeNull()
      expect(metaConfig(load({ ...meta, META_APP_ID: '' }))).toBeNull()
      expect(metaConfig(load(meta))).toEqual({
        appSecret: 'segredo',
        graphVersion: 'v21.0',
        baseUrl: undefined,
      })
    })
    it('META_GRAPH_VERSION precisa ter o formato vN.N', () => {
      expect(() => load({ ...meta, META_GRAPH_VERSION: '21' })).toThrow()
      expect(() => load({ ...meta, META_GRAPH_VERSION: 'v21' })).toThrow()
    })
    it('META_GRAPH_BASE_URL vale fora de produção e é ignorada com NODE_ENV=production', () => {
      const url = 'http://127.0.0.1:9999'
      expect(metaConfig(load({ ...meta, META_GRAPH_BASE_URL: url }))?.baseUrl).toBe(url)
      const prod = load({ ...meta, META_GRAPH_BASE_URL: url, NODE_ENV: 'production' })
      expect(metaConfig(prod)?.baseUrl).toBeUndefined()
    })
  })
})
