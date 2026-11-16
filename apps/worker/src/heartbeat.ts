import type { Logger } from 'pino'
import { recordHeartbeat, type Db } from '@central/db'

export function startHeartbeat(opts: {
  db: Db
  name: string
  intervalMs: number
  logger: Logger
}): { stop(): Promise<void> } {
  let inflight: Promise<void> = Promise.resolve()
  const tick = () => {
    inflight = inflight
      .then(() => recordHeartbeat(opts.db, opts.name))
      .catch((err: unknown) => {
        opts.logger.error({ err }, 'heartbeat failed')
      })
  }
  tick()
  const timer = setInterval(tick, opts.intervalMs)
  return {
    async stop() {
      clearInterval(timer)
      await inflight
    },
  }
}
