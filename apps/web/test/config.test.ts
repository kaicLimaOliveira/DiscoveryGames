import { loadConfig } from '@central/shared'
import { describe, expect, it } from 'vitest'
import { webEnvSchema } from '../server/utils/config'

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
})
