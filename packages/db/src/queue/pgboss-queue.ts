import { PgBoss } from 'pg-boss'
import {
  QUEUES,
  type JobQueue,
  type QueueName,
  type SendOptions,
  type SqlExecutor,
} from '@central/shared'
import type { Tx } from '../client.js'

/** Adapts a Prisma interactive-transaction client to the executor pg-boss accepts via `db`. */
export function sqlExecutorFor(tx: Tx): SqlExecutor {
  return {
    async executeSql(text, values) {
      const rows = await tx.$queryRawUnsafe<unknown[]>(text, ...(values ?? []))
      return { rows }
    },
  }
}

/** Dedup window for sends carrying a singletonKey. */
const SINGLETON_WINDOW_SECONDS = 3600

export interface PgBossQueue extends JobQueue {
  work<T>(
    name: QueueName,
    handler: (job: { id: string; data: T }) => Promise<void>,
    opts?: { concurrency?: number },
  ): Promise<void>
  stop(): Promise<void>
  ping(): Promise<void>
}

export async function createPgBossQueue(opts: {
  connectionString: string
  role: 'web' | 'worker'
}): Promise<PgBossQueue> {
  const isWorker = opts.role === 'worker'
  const boss = new PgBoss({
    connectionString: opts.connectionString,
    schema: 'pgboss',
    // web: no maintenance/cron loops and no schema migrations (worker owns them).
    supervise: isWorker,
    schedule: isWorker,
    migrate: isWorker,
  })
  boss.on('error', () => {
    // Surfaced by failing calls; the listener keeps pg-boss errors from crashing the process.
  })
  await boss.start()
  try {
    for (const name of Object.values(QUEUES)) await boss.createQueue(name)
  } catch (err) {
    await boss.stop({ graceful: false })
    throw err
  }

  return {
    send(name, data, sendOpts?: SendOptions) {
      return boss.send(name, data, {
        ...(sendOpts?.db ? { db: sendOpts.db } : {}),
        // pg-boss only dedupes a singletonKey inside a time slot (singletonSeconds) on standard queues.
        ...(sendOpts?.singletonKey
          ? { singletonKey: sendOpts.singletonKey, singletonSeconds: SINGLETON_WINDOW_SECONDS }
          : {}),
        ...(sendOpts?.startAfter ? { startAfter: sendOpts.startAfter } : {}),
      })
    },
    async work<T>(
      name: QueueName,
      handler: (job: { id: string; data: T }) => Promise<void>,
      workOpts?: { concurrency?: number },
    ) {
      await boss.work<T>(name, { localConcurrency: workOpts?.concurrency ?? 1 }, async (jobs) => {
        for (const job of jobs) await handler({ id: job.id, data: job.data })
      })
    },
    async stop() {
      await boss.stop({ graceful: true, close: true, timeout: 10_000 })
    },
    async ping() {
      await boss.getDb().executeSql('select 1')
    },
  }
}
