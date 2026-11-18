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
  // Uma análise e um download por fonte; o limite global de 1 por vez é a concorrência do worker.
  [QUEUES.sourceAnalyze]: 'exclusive',
  [QUEUES.sourceDownload]: 'exclusive',
  [QUEUES.sourceDeadLetter]: 'standard',
}

/** Subconjunto das opções de fila do pg-boss 12.38.2 (`QueueOptions` + `deadLetter`) que usamos. */
export interface QueueSettings {
  expireInSeconds?: number
  heartbeatSeconds?: number
  retryLimit?: number
  retryDelay?: number
  retryBackoff?: boolean
  deadLetter?: QueueName
}

/**
 * Jobs longos (vídeo de até 2 h): expiração de 3 h; heartbeat de 60 s (o `work()` do pg-boss o
 * renova sozinho a cada 30 s), então um worker morto libera o job em ~1 min em vez de 3 h;
 * 2 retries com espera exponencial a partir de 60 s (uma queda curta da Groq/Anthropic não
 * queima as tentativas em segundos). Esgotados os retries, o job vai para a fila de mortos,
 * que marca a fonte como `failed` (worker).
 */
const LONG_JOB: QueueSettings = {
  expireInSeconds: 10_800,
  heartbeatSeconds: 60,
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: QUEUES.sourceDeadLetter,
}

/** Opções por fila, ao lado de `QUEUE_POLICIES`; filas ausentes usam os padrões do pg-boss. */
export const QUEUE_OPTIONS: Partial<Record<QueueName, QueueSettings>> = {
  [QUEUES.sourceAnalyze]: LONG_JOB,
  [QUEUES.sourceDownload]: LONG_JOB,
}

/** Estados do pg-boss em que o job ainda vai rodar (ou está rodando). */
const PENDING_STATES = new Set(['created', 'retry', 'active'])

export interface PgBossQueue extends JobQueue {
  work<T>(
    name: QueueName,
    handler: (job: { id: string; data: T }) => Promise<void>,
    opts?: { concurrency?: number },
  ): Promise<void>
  stop(): Promise<void>
  ping(): Promise<void>
  /** Há job `created`, `retry` ou `active` com esta `singletonKey` em alguma das filas? */
  hasPendingJob(names: QueueName[], singletonKey: string): Promise<boolean>
}

export async function createPgBossQueue(opts: {
  connectionString: string
  role: 'web' | 'worker'
  /** Receives pg-boss background 'error' events. Defaults to console.error (never swallowed). */
  onError?: (err: Error) => void
  /** Test-only hook: extra queues (outside QUEUES) created in order with the given policy/options. */
  extraQueues?: Array<{
    name: string
    policy: QueuePolicy
    options?: Omit<QueueSettings, 'deadLetter'> & { deadLetter?: string }
  }>
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
    // A fila de mortos precisa existir antes das filas que apontam para ela.
    const names = Object.values(QUEUES).sort(
      (a, b) => Number(!!QUEUE_OPTIONS[a]?.deadLetter) - Number(!!QUEUE_OPTIONS[b]?.deadLetter),
    )
    for (const name of names) {
      const options = QUEUE_OPTIONS[name]
      await boss.createQueue(name, { policy: QUEUE_POLICIES[name], ...options })
      // createQueue não altera uma fila que já existe: updateQueue leva as opções aos bancos já
      // implantados (a política não muda depois de criada).
      if (options) await boss.updateQueue(name, options)
    }
    for (const q of opts.extraQueues ?? []) {
      await boss.createQueue(q.name, { policy: q.policy, ...q.options })
    }
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
    async hasPendingJob(names, singletonKey) {
      for (const name of names) {
        const jobs = await boss.findJobs(name, { key: singletonKey })
        if (jobs.some((j) => PENDING_STATES.has(j.state))) return true
      }
      return false
    },
  }
}
