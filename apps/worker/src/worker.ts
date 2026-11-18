import type { Logger } from 'pino'
import type { LlmProvider, Transcriber } from '@central/ai'
import { createPgBossQueue, createPrisma } from '@central/db'
import { ffmpegPath } from '@central/media'
import { createLogger, QUEUES } from '@central/shared'
import type { Storage } from '@central/storage'
import {
  createSourceAnalyzeHandler,
  MAX_DURATION_MS,
  type SourceAnalyzeJob,
} from './handlers/source-analyze.js'
import {
  createSourceDownloadHandler,
  MAX_DOWNLOAD_BYTES,
  type SourceDownloadJob,
} from './handlers/source-download.js'
import {
  createSourceDeadLetterHandler,
  type SourceDeadLetterJob,
} from './handlers/source-dead-letter.js'
import { createEchoHandler } from './handlers/system.js'
import { startHeartbeat } from './heartbeat.js'
import { STALE_SCRATCH_MS, sweepStaleScratch } from './scratch.js'

/** Intervalo da varredura do scratch (sobras de jobs mortos). */
const SCRATCH_SWEEP_MS = 30 * 60 * 1000

export interface WorkerConfig {
  databaseUrl: string
  heartbeatMs?: number
  /** Idade mínima das sobras apagadas do scratch (padrão STALE_SCRATCH_MS; só os testes mudam). */
  staleScratchMs?: number
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
  /** Liga a fila `source.download` (YTDLP_ENABLED); desligada por padrão. */
  ytdlpEnabled: boolean
  ytdlpPath: string
  /** Argumentos antes dos do yt-dlp (só os testes). */
  ytdlpArgs: string[]
}

export async function startWorker(
  cfg: WorkerConfig,
  deps: Partial<WorkerDeps> = {},
): Promise<{ stop(): Promise<void> }> {
  const logger = cfg.logger ?? createLogger({ name: 'worker' })
  const db = createPrisma(cfg.databaseUrl)
  let queue: Awaited<ReturnType<typeof createPgBossQueue>> | undefined
  let heartbeat: ReturnType<typeof startHeartbeat> | undefined
  let sweepTimer: ReturnType<typeof setInterval> | undefined
  const sweep = async (root: string) => {
    try {
      const removed = await sweepStaleScratch(root, cfg.staleScratchMs ?? STALE_SCRATCH_MS)
      if (removed.length) logger.warn({ removed }, 'sobras do scratch apagadas')
    } catch (err) {
      logger.error({ err }, 'falha ao varrer o scratch')
    }
  }
  try {
    // Sobras de um worker que caiu (vídeos de GB): na subida e depois periodicamente.
    const scratchRoot = deps.scratchRoot
    if (scratchRoot) {
      await sweep(scratchRoot)
      sweepTimer = setInterval(() => void sweep(scratchRoot), SCRATCH_SWEEP_MS)
      sweepTimer.unref()
    }
    // role 'worker' instala/migra o schema pgboss: este processo sobe antes de qualquer web.
    queue = await createPgBossQueue({
      connectionString: cfg.databaseUrl,
      role: 'worker',
      onError: (err) => logger.error({ err }, 'pg-boss error'),
    })
    await queue.work(QUEUES.systemEcho, createEchoHandler(logger))
    // Jobs de fonte que esgotaram os retries: a fonte vira `failed` (o usuário pode tentar de novo).
    await queue.work<SourceDeadLetterJob['data']>(
      QUEUES.sourceDeadLetter,
      createSourceDeadLetterHandler({ db, queue, logger }),
    )
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
      // Download por link atrás da chave: um por vez; erro do yt-dlp vira `failed` sem retry (o
      // retry do pg-boss só cobre queda do worker ou expiração).
      if (deps.ytdlpEnabled) {
        await queue.work<SourceDownloadJob['data']>(
          QUEUES.sourceDownload,
          createSourceDownloadHandler({
            db,
            storage: deps.storage,
            queue,
            ytdlpPath: deps.ytdlpPath ?? 'yt-dlp',
            ...(deps.ytdlpArgs ? { ytdlpArgs: deps.ytdlpArgs } : {}),
            ffmpegPath: ffmpegPath(),
            scratchRoot: deps.scratchRoot,
            maxDurationMs: deps.maxDurationMs ?? MAX_DURATION_MS,
            maxBytes: MAX_DOWNLOAD_BYTES,
            logger,
          }),
          { concurrency: 1 },
        )
      } else {
        logger.info('YTDLP_ENABLED desligado: fila source.download não será consumida')
      }
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
    clearInterval(sweepTimer)
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
        clearInterval(sweepTimer)
        await heartbeat?.stop()
        await queue?.stop()
        await db.$disconnect()
        logger.info('worker stopped')
      })()
      return stopping
    },
  }
}
