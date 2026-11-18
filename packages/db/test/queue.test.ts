import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { PgBoss } from 'pg-boss'
import { QUEUES, type QueueName } from '@central/shared'
import { createPgBossQueue, sqlExecutorFor, type PgBossQueue } from '../src/queue/pgboss-queue.js'
import { startTestDatabase } from '../src/testing.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
const queues: PgBossQueue[] = []
beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(async () => {
  for (const q of queues) await q.stop()
  await db?.stop()
})

async function newQueue(
  role: 'web' | 'worker' = 'worker',
  extra: Partial<Parameters<typeof createPgBossQueue>[0]> = {},
): Promise<PgBossQueue> {
  const q = await createPgBossQueue({ connectionString: db!.url, role, ...extra })
  queues.push(q)
  return q
}

it('job enviado dentro da transação some no rollback', async () => {
  const q = await newQueue()
  await expect(
    db!.prisma.$transaction(async (tx) => {
      await tx.organization.create({ data: { name: 'R', slug: 'r' } })
      await q.send(QUEUES.systemEcho, { tag: 'rollback-1' }, { db: sqlExecutorFor(tx) })
      throw new Error('rollback')
    }),
  ).rejects.toThrow('rollback')
  expect(await db!.prisma.organization.count({ where: { slug: 'r' } })).toBe(0)
  const rows = await db!.prisma.$queryRawUnsafe<unknown[]>(
    `select 1 from pgboss.job where name = 'system.echo' and data->>'tag' = 'rollback-1'`,
  )
  expect(rows).toHaveLength(0)
})

it('job enviado na transação confirmada é processado', async () => {
  const q = await newQueue()
  const seen = new Promise<object>((res) => {
    void q.work<object>(QUEUES.systemEcho, async (j) => res(j.data))
  })
  await db!.prisma.$transaction(async (tx) =>
    q.send(QUEUES.systemEcho, { n: 2 }, { db: sqlExecutorFor(tx) }),
  )
  await expect(seen).resolves.toEqual({ n: 2 })
})

it('singletonKey deduplica em fila exclusive e libera após conclusão', async () => {
  const q = await newQueue('worker', {
    extraQueues: [{ name: 'test.exclusive', policy: 'exclusive' }],
  })
  const name = 'test.exclusive' as QueueName
  const first = await q.send(name, { n: 3 }, { singletonKey: 'k1' })
  const second = await q.send(name, { n: 3 }, { singletonKey: 'k1' })
  expect(first).toEqual(expect.any(String))
  expect(second).toBeNull()

  const done = new Promise<void>((res) => {
    void q.work<object>(name, async () => res())
  })
  await done
  await vi.waitFor(async () => {
    expect(await q.send(name, { n: 4 }, { singletonKey: 'k1' })).toEqual(expect.any(String))
  })
})

it('sends sem chave na fila standard não deduplicam', async () => {
  const q = await newQueue('web')
  const later = new Date(Date.now() + 3_600_000)
  const a = await q.send(QUEUES.systemEcho, { tag: 'nodedupe' }, { startAfter: later })
  const b = await q.send(QUEUES.systemEcho, { tag: 'nodedupe' }, { startAfter: later })
  expect(a).toEqual(expect.any(String))
  expect(b).toEqual(expect.any(String))
  expect(a).not.toBe(b)
})

it('job com startAfter não é processado antes da hora', async () => {
  const q = await newQueue()
  const tag = 'startafter'
  const start = Date.now()
  const at = await new Promise<number>((res) => {
    void q.work<{ tag?: string }>(QUEUES.systemEcho, async (j) => {
      if (j.data.tag === tag) res(Date.now())
    })
    void q.send(QUEUES.systemEcho, { tag }, { startAfter: new Date(start + 2_000) })
  })
  expect(at - start).toBeGreaterThanOrEqual(1_900)
})

it('erros emitidos pelo pg-boss chegam em onError', async () => {
  const errors: Error[] = []
  await newQueue('web', { onError: (e) => errors.push(e) })
  await db!.prisma.$executeRawUnsafe(
    `select pg_terminate_backend(pid) from pg_stat_activity where pid <> pg_backend_pid() and application_name like 'pgboss%'`,
  )
  await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0), { timeout: 10_000 })
})

it('ping funciona pelo pg-boss', async () => {
  const q = await newQueue('web')
  await expect(q.ping()).resolves.toBeUndefined()
})

it('source.analyze e source.download recebem expiração, heartbeat, retry e fila de mortos (inclusive em banco já implantado)', async () => {
  const legacy = new PgBoss({
    connectionString: db!.url,
    schema: 'pgboss',
    supervise: false,
    schedule: false,
  })
  await legacy.start()
  try {
    // Banco "antigo": as filas existem com os padrões do pg-boss (createQueue não as alteraria).
    for (const name of [QUEUES.sourceAnalyze, QUEUES.sourceDownload]) {
      if (!(await legacy.getQueue(name))) await legacy.createQueue(name, { policy: 'exclusive' })
      await legacy.updateQueue(name, {
        expireInSeconds: 900,
        heartbeatSeconds: null,
        retryDelay: 0,
        retryBackoff: false,
        deadLetter: null,
      })
    }
    expect(await legacy.getQueue(QUEUES.sourceAnalyze)).toMatchObject({
      expireInSeconds: 900,
      heartbeatSeconds: null,
    })

    await newQueue('worker')
    for (const name of [QUEUES.sourceAnalyze, QUEUES.sourceDownload]) {
      expect(await legacy.getQueue(name)).toMatchObject({
        policy: 'exclusive',
        expireInSeconds: 10_800,
        heartbeatSeconds: 60,
        retryLimit: 2,
        retryDelay: 60,
        retryBackoff: true,
        deadLetter: QUEUES.sourceDeadLetter,
      })
    }
    expect(await legacy.getQueue(QUEUES.sourceDeadLetter)).toMatchObject({ policy: 'standard' })
  } finally {
    await legacy.stop({ graceful: false })
  }
})

it('hasPendingJob vê job criado com a chave e ignora job concluído', async () => {
  const q = await newQueue('worker', {
    extraQueues: [{ name: 'test.pending', policy: 'exclusive' }],
  })
  const name = 'test.pending' as QueueName
  expect(await q.hasPendingJob([name], 'p1')).toBe(false)
  await q.send(name, { n: 1 }, { singletonKey: 'p1' })
  expect(await q.hasPendingJob([QUEUES.systemEcho, name], 'p1')).toBe(true)
  expect(await q.hasPendingJob([name], 'p2')).toBe(false)
  const done = new Promise<void>((res) => {
    void q.work<object>(name, async () => res())
  })
  await done
  await vi.waitFor(async () => expect(await q.hasPendingJob([name], 'p1')).toBe(false))
})

it('job que esgota os retries vai para a fila de mortos com o mesmo payload', async () => {
  const q = await newQueue('worker', {
    extraQueues: [
      { name: 'test.dead', policy: 'standard' },
      {
        name: 'test.dying',
        policy: 'exclusive',
        options: { retryLimit: 1, retryDelay: 1, deadLetter: 'test.dead' },
      },
    ],
  })
  let runs = 0
  await q.work<object>('test.dying' as QueueName, async () => {
    runs++
    throw new Error('falha')
  })
  const dead = new Promise<object>((res) => {
    void q.work<object>('test.dead' as QueueName, async (j) => res(j.data))
  })
  await q.send('test.dying' as QueueName, { sourceId: 's1' }, { singletonKey: 's1' })
  await expect(dead).resolves.toEqual({ sourceId: 's1' })
  expect(runs).toBe(2)
}, 30_000)
