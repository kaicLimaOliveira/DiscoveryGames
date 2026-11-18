import type { Logger } from 'pino'
import type { LlmProvider, Transcriber } from '@central/ai'
import { createPgBossQueue, createPrisma } from '@central/db'
import { createLogger, QUEUES } from '@central/shared'
import type { Storage } from '@central/storage'
import { createSourceAnalyzeHandler, type SourceAnalyzeJob } from './handlers/source-analyze.js'
import { createEchoHandler } from './handlers/system.js'
import { startHeartbeat } from './heartbeat.js'

export interface WorkerConfig {
  databaseUrl: string
  heartbeatMs?: number
  logger?: Logger
}

/** Dependências da análise; sem `storage` a fila `source.analyze` não é consumida. */
export interface WorkerDeps {
  storage: Storage
  transcriber: Transcriber | null
  llm: LlmProvider | null
  model: string
  scratchRoot: string
  maxDurationMs: number
}

export async function startWorker(
  cfg: WorkerConfig,
  deps: Partial<WorkerDeps> = {},
): Promise<{ stop(): Promise<void> }> {
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
    if (deps.storage && deps.scratchRoot) {
      // Uma análise por vez (limite global de entrada).
      await queue.work<SourceAnalyzeJob['data']>(
        QUEUES.sourceAnalyze,
        createSourceAnalyzeHandler({
          db,
          storage: deps.storage,
          transcriber: deps.transcriber ?? null,
          llm: deps.llm ?? null,
          model: deps.model ?? 'claude-opus-5-5',
          scratchRoot: deps.scratchRoot,
          ...(deps.maxDurationMs !== undefined ? { maxDurationMs: deps.maxDurationMs } : {}),
          logger,
        }),
        { concurrency: 1 },
      )
    } else {
      logger.warn('storage não configurado: fila source.analyze não será consumida')
    }
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
