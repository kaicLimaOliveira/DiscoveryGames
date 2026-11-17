import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { recordHeartbeat } from '@central/db'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Client, db, env, setupServer } from './helpers'

await setupServer()

interface Health {
  status: 'ok' | 'degraded'
  checks: {
    postgres: { ok: boolean; latencyMs: number }
    storage: { ok: boolean }
    worker: { ok: boolean; lastSeenAt: string | null }
  }
}

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
})

async function health(): Promise<{ status: number; body: Health }> {
  const res = await new Client().request('/api/health')
  return { status: res.status, body: res.body as Health }
}

beforeEach(async () => {
  await recordHeartbeat(db, 'worker')
})

afterAll(async () => {
  s3.destroy()
  await db.$disconnect()
})

describe('GET /api/health', () => {
  it('tudo de pé com heartbeat recente → 200', async () => {
    const { status, body } = await health()
    expect(status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.checks.postgres.ok).toBe(true)
    expect(typeof body.checks.postgres.latencyMs).toBe('number')
    expect(body.checks.storage).toEqual({ ok: true })
    expect(body.checks.worker.ok).toBe(true)
    expect(Date.parse(body.checks.worker.lastSeenAt!)).not.toBeNaN()
  })

  it('gancho x-test-fault é inerte sem WEB_TEST_FAULT (produção)', async () => {
    const res = await new Client().request('/api/health', { headers: { 'x-test-fault': '1' } })
    expect(res.status).toBe(200)
  })

  it('sem heartbeat → 503 com checks.worker.ok === false', async () => {
    await db.heartbeat.deleteMany({ where: { name: 'worker' } })
    const { status, body } = await health()
    expect(status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.checks.worker).toEqual({ ok: false, lastSeenAt: null })
  })

  it('heartbeat com mais de 90 s → 503', async () => {
    await recordHeartbeat(db, 'worker', new Date(Date.now() - 120_000))
    const { status, body } = await health()
    expect(status).toBe(503)
    expect(body.checks.worker.ok).toBe(false)
  })

  it('bucket inexistente → 503 com checks.storage.ok === false, sem mensagem interna', async () => {
    await s3.send(new DeleteBucketCommand({ Bucket: env.S3_BUCKET }))
    try {
      const { status, body } = await health()
      expect(status).toBe(503)
      expect(body.checks.storage).toEqual({ ok: false })
      expect(body.checks.postgres.ok).toBe(true)
      expect(body.checks.worker.ok).toBe(true)
    } finally {
      await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }))
    }
  })
})
