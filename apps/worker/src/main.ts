import { createAnthropicProvider, createGroqTranscriber } from '@central/ai'
import { createLogger, loadConfig } from '@central/shared'
import { createStorage } from '@central/storage'
import { workerEnvSchema } from './config.js'
import { startWorker } from './worker.js'

async function main(): Promise<void> {
  const config = loadConfig(workerEnvSchema)
  const logger = createLogger({ name: 'worker', level: config.LOG_LEVEL })

  if (config.SENTRY_DSN) {
    const Sentry = await import('@sentry/node')
    Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV })
  }

  // Sem as chaves o worker sobe; a análise termina em failed "Integração de IA não configurada.".
  const transcriber = config.GROQ_API_KEY
    ? createGroqTranscriber({ apiKey: config.GROQ_API_KEY })
    : null
  const llm = config.ANTHROPIC_API_KEY
    ? createAnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY })
    : null
  if (!transcriber || !llm) logger.warn('integração de IA não configurada (chaves ausentes)')

  const worker = await startWorker(
    { databaseUrl: config.DATABASE_URL, logger },
    {
      storage: createStorage(config),
      transcriber,
      llm,
      model: config.AI_MODEL,
      scratchRoot: config.SCRATCH_DIR,
      ytdlpEnabled: config.YTDLP_ENABLED,
      ytdlpPath: config.YTDLP_PATH ?? 'yt-dlp',
    },
  )

  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'shutting down')
    worker.stop().then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error({ err }, 'shutdown failed')
        process.exit(1)
      },
    )
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
