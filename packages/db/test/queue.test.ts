import { afterAll, beforeAll, expect, it } from 'vitest'
import { QUEUES } from '@central/shared'
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

async function newQueue(role: 'web' | 'worker' = 'worker'): Promise<PgBossQueue> {
  const q = await createPgBossQueue({ connectionString: db!.url, role })
  queues.push(q)
  return q
}

it('job enviado dentro da transação some no rollback', async () => {
  const q = await newQueue()
  await expect(
    db!.prisma.$transaction(async (tx) => {
      await tx.brand.create({ data: { name: 'R', slug: 'r' } })
      await q.send(QUEUES.systemEcho, { n: 1 }, { db: sqlExecutorFor(tx) })
      throw new Error('rollback')
    }),
  ).rejects.toThrow('rollback')
  expect(await db!.prisma.brand.count({ where: { slug: 'r' } })).toBe(0)
  const rows = await db!.prisma.$queryRawUnsafe<unknown[]>(
    `select 1 from pgboss.job where name = 'system.echo'`,
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

it('singletonKey deduplica', async () => {
  const q = await newQueue('web')
  const first = await q.send(
    QUEUES.systemEcho,
    { n: 3 },
    { singletonKey: 'k1', startAfter: new Date(Date.now() + 3_600_000) },
  )
  const second = await q.send(
    QUEUES.systemEcho,
    { n: 3 },
    { singletonKey: 'k1', startAfter: new Date(Date.now() + 3_600_000) },
  )
  expect(first).toEqual(expect.any(String))
  expect(second).toBeNull()
})

it('ping funciona pelo pg-boss', async () => {
  const q = await newQueue('web')
  await expect(q.ping()).resolves.toBeUndefined()
})
