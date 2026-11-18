import { mkdir, mkdtemp, readdir, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createSourceService } from '@central/core'
import { createPgBossQueue, readHeartbeat } from '@central/db'
import { startTestDatabase } from '@central/db/testing'
import { createLogger, QUEUES } from '@central/shared'
import type { Storage } from '@central/storage'
import { MSG } from '../src/handlers/source-analyze.js'
import { startWorker } from '../src/worker.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db?.stop())

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor<T>(fn: () => Promise<T | undefined | false>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > deadline) throw new Error('waitFor timeout')
    await sleep(100)
  }
}

function capture() {
  const lines: string[] = []
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk))
      cb()
    },
  })
  return { lines, logger: createLogger({ name: 'worker-test', destination }) }
}

it('heartbeat avança, system.echo é logado com jobId e o heartbeat para após stop()', async () => {
  const { lines, logger } = capture()
  const worker = await startWorker({ databaseUrl: db!.url, heartbeatMs: 200, logger })
  let stopped = false
  try {
    const first = await waitFor(() => readHeartbeat(db!.prisma, 'worker'))
    await sleep(1000)
    const later = await readHeartbeat(db!.prisma, 'worker')
    expect(later!.getTime()).toBeGreaterThan(first.getTime())

    const web = await createPgBossQueue({ connectionString: db!.url, role: 'web' })
    let jobId: string
    try {
      jobId = (await web.send(QUEUES.systemEcho, { hello: 'world' }))!
    } finally {
      await web.stop()
    }
    expect(jobId).toBeTruthy()
    const line = await waitFor(async () =>
      lines.find((l) => l.includes(jobId) && l.includes('"msg":"echo"')),
    )
    expect(line).toContain(jobId)

    await worker.stop()
    stopped = true
    const afterStop = await readHeartbeat(db!.prisma, 'worker')
    await sleep(700)
    expect(await readHeartbeat(db!.prisma, 'worker')).toEqual(afterStop)
  } finally {
    if (!stopped) await worker.stop()
  }
}, 60_000)

/** Storage falso: só o `head` (o retry confere que o original ainda existe). */
const fakeStorage = { head: async () => ({ contentType: 'video/mp4' }) } as unknown as Storage

async function seedSource(status: 'queued' | 'analyzing') {
  const p = db!.prisma
  const org = await p.organization.create({
    data: { name: 'W', slug: `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  const source = await p.source.create({
    data: {
      organizationId: org.id,
      kind: 'upload',
      title: 'Partida',
      status,
      rightsBasis: 'own',
      params: { targetMin: 1, targetMax: 3, minSec: 1, maxSec: 3, language: 'pt-BR' },
      uploadKey: `orgs/${org.id}/sources/x/original.mp4`,
    },
  })
  return { orgId: org.id, sourceId: source.id }
}

async function sendAsWeb(name: (typeof QUEUES)[keyof typeof QUEUES], sourceId: string) {
  const web = await createPgBossQueue({ connectionString: db!.url, role: 'web' })
  try {
    return await web.send(name, { sourceId }, { singletonKey: sourceId })
  } finally {
    await web.stop()
  }
}

it('startWorker consome source.analyze de ponta a ponta e limpa sobras antigas do scratch na subida', async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), 'central-worker-scratch-'))
  const old = join(scratchRoot, 'job-morto')
  const fresh = join(scratchRoot, 'job-atual')
  await mkdir(join(old, 'frames'), { recursive: true })
  await mkdir(fresh)
  const past = new Date(Date.now() - 5 * 60 * 60 * 1000)
  await utimes(old, past, past)

  const { sourceId } = await seedSource('queued')
  const worker = await startWorker(
    { databaseUrl: db!.url, heartbeatMs: 200, logger: capture().logger },
    // Sem transcriber/LLM o handler encerra em failed "Integração de IA não configurada.".
    { storage: fakeStorage, scratchRoot, transcriber: null, llm: null },
  )
  try {
    expect(await readdir(scratchRoot)).toEqual(['job-atual'])
    expect(await sendAsWeb(QUEUES.sourceAnalyze, sourceId)).toBeTruthy()
    const row = await waitFor(async () => {
      const s = await db!.prisma.source.findUniqueOrThrow({ where: { id: sourceId } })
      return s.status === 'failed' && s
    })
    expect(row.statusDetail).toBe(MSG.notConfigured)
  } finally {
    await worker.stop()
    await rm(scratchRoot, { recursive: true, force: true })
  }
}, 60_000)

it('job que esgotou os retries cai na fila de mortos: fonte em andamento vira failed e o retry volta a funcionar', async () => {
  const p = db!.prisma
  const { orgId, sourceId } = await seedSource('analyzing')
  const user = await p.user.create({
    data: { email: `w-${Date.now()}@x.com`, name: 'w', passwordHash: 'x' },
  })
  const worker = await startWorker({
    databaseUrl: db!.url,
    heartbeatMs: 200,
    logger: capture().logger,
  })
  try {
    // O pg-boss copia para a fila de mortos o payload do job que esgotou os retries.
    await sendAsWeb(QUEUES.sourceDeadLetter, sourceId)
    const row = await waitFor(async () => {
      const s = await p.source.findUniqueOrThrow({ where: { id: sourceId } })
      return s.status === 'failed' && s
    })
    expect(row.statusDetail).toBe(MSG.transient)

    const web = await createPgBossQueue({ connectionString: db!.url, role: 'web' })
    try {
      const svc = createSourceService({ db: p, storage: fakeStorage, queue: web })
      const actor = {
        userId: user.id,
        globalRole: 'member' as const,
        memberships: [{ organizationId: orgId, role: 'editor' as const }],
      }
      await expect(svc.retry(actor, orgId, sourceId)).resolves.toMatchObject({ status: 'queued' })
    } finally {
      await web.stop()
    }
  } finally {
    await worker.stop()
  }
}, 60_000)

it('fila de mortos não mexe na fonte que já tem outro job pendente', async () => {
  const p = db!.prisma
  const { sourceId } = await seedSource('analyzing')
  // Job de análise ainda na fila (startAfter no futuro): o worker não o pega.
  const web = await createPgBossQueue({ connectionString: db!.url, role: 'web' })
  try {
    await web.send(
      QUEUES.sourceAnalyze,
      { sourceId },
      { singletonKey: sourceId, startAfter: new Date(Date.now() + 3_600_000) },
    )
    const deadId = await web.send(QUEUES.sourceDeadLetter, { sourceId })
    const worker = await startWorker({
      databaseUrl: db!.url,
      heartbeatMs: 200,
      logger: capture().logger,
    })
    try {
      await waitFor(async () => {
        const rows = await p.$queryRaw<Array<{ state: string }>>`
          SELECT state::text FROM pgboss.job WHERE id = ${deadId}::uuid`
        return rows[0]?.state === 'completed'
      })
    } finally {
      await worker.stop()
    }
  } finally {
    await web.stop()
  }
  expect((await p.source.findUniqueOrThrow({ where: { id: sourceId } })).status).toBe('analyzing')
})
