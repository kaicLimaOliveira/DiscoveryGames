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

export type QueuePolicy = 'standard' | 'short' | 'exclusive' | 'stately'

/**
 * pg-boss policy per queue. `singletonKey` only dedupes on keyed policies:
 * `exclusive` = one queued-or-active job per key, `short` = one queued job per key.
 * The future `publish` queue will be `exclusive`.
 */
export const QUEUE_POLICIES: Record<QueueName, QueuePolicy> = {
  [QUEUES.systemEcho]: 'standard',
}

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
  /** Receives pg-boss background 'error' events. Defaults to console.error (never swallowed). */
  onError?: (err: Error) => void
  /** Test-only hook: extra queues (outside QUEUES) created with the given policy. */
  extraQueues?: Array<{ name: string; policy: QueuePolicy }>
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
  const onError = opts.onError ?? ((err: Error) => console.error('[pg-boss]', err))
  boss.on('error', onError)
  await boss.start()
  try {
    for (const name of Object.values(QUEUES)) {
      await boss.createQueue(name, { policy: QUEUE_POLICIES[name] })
    }
    for (const q of opts.extraQueues ?? []) await boss.createQueue(q.name, { policy: q.policy })
  } catch (err) {
    await boss.stop({ graceful: false })
    throw err
  }

  return {
    send(name, data, sendOpts?: SendOptions) {
      return boss.send(name, data, {
        ...(sendOpts?.db ? { db: sendOpts.db } : {}),
        ...(sendOpts?.singletonKey ? { singletonKey: sendOpts.singletonKey } : {}),
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
