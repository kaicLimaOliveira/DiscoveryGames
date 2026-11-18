import { baseEnvSchema, createLogger, loadConfig } from '@central/shared'
import { startWorker } from './worker.js'

async function main(): Promise<void> {
  const config = loadConfig(baseEnvSchema)
  const logger = createLogger({ name: 'worker', level: config.LOG_LEVEL })

  if (config.SENTRY_DSN) {
    const Sentry = await import('@sentry/node')
    Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV })
  }

  const worker = await startWorker({ databaseUrl: config.DATABASE_URL, logger })

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
