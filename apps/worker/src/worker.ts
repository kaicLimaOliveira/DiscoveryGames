import type { Logger } from 'pino'
import { createPgBossQueue, createPrisma } from '@central/db'
import { createLogger, QUEUES } from '@central/shared'
import { createEchoHandler } from './handlers/system.js'
import { startHeartbeat } from './heartbeat.js'

export interface WorkerConfig {
  databaseUrl: string
  heartbeatMs?: number
  logger?: Logger
}

export async function startWorker(cfg: WorkerConfig): Promise<{ stop(): Promise<void> }> {
  const logger = cfg.logger ?? createLogger({ name: 'worker' })
  const db = createPrisma(cfg.databaseUrl)
  let queue: Awaited<ReturnType<typeof createPgBossQueue>> | undefined
  let heartbeat: ReturnType<typeof startHeartbeat> | undefined
  try {
    // role 'worker' instala/migra o schema pgboss: este processo sobe antes de qualquer web.
    queue = await createPgBossQueue({
      connectionString: cfg.databaseUrl,
      role: 'worker',
      onError: (err) => logger.error({ err }, 'pg-boss error'),
    })
    await queue.work(QUEUES.systemEcho, createEchoHandler(logger))
    heartbeat = startHeartbeat({
      db,
      name: 'worker',
      intervalMs: cfg.heartbeatMs ?? 30_000,
      logger,
    })
  } catch (err) {
    await heartbeat?.stop()
    await queue?.stop().catch(() => undefined)
    await db.$disconnect()
    throw err
  }
  logger.info('worker started')

  let stopping: Promise<void> | undefined
  return {
    stop() {
      stopping ??= (async () => {
        await heartbeat?.stop()
        await queue?.stop()
        await db.$disconnect()
        logger.info('worker stopped')
      })()
      return stopping
    },
  }
}
