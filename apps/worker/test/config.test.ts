import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadConfig } from '@central/shared'
import { workerEnvSchema } from '../src/config.js'

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
}

it('padrões: sem chaves de IA, modelo claude-opus-5-5, scratch no tmpdir, yt-dlp desligado', () => {
  const cfg = loadConfig(workerEnvSchema, { ...base, ANTHROPIC_API_KEY: '', GROQ_API_KEY: '' })
  expect(cfg.ANTHROPIC_API_KEY).toBeUndefined()
  expect(cfg.GROQ_API_KEY).toBeUndefined()
  expect(cfg.AI_MODEL).toBe('claude-opus-5-5')
  expect(cfg.SCRATCH_DIR).toBe(join(tmpdir(), 'central-scratch'))
  expect(cfg.YTDLP_ENABLED).toBe(false)
})

it('exige o storage e recusa modelo sem preço cadastrado', () => {
  expect(() => loadConfig(workerEnvSchema, { DATABASE_URL: base.DATABASE_URL })).toThrow()
  expect(() => loadConfig(workerEnvSchema, { ...base, AI_MODEL: 'modelo-x' })).toThrow()
  const cfg = loadConfig(workerEnvSchema, {
    ...base,
    SCRATCH_DIR: '/scratch',
    YTDLP_ENABLED: 'true',
  })
  expect(cfg.SCRATCH_DIR).toBe('/scratch')
  expect(cfg.YTDLP_ENABLED).toBe(true)
})
