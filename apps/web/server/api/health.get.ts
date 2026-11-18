import { readHeartbeat } from '@central/db'
import { useServices } from '../utils/services'

const CHECK_TIMEOUT_MS = 2_000
const WORKER_MAX_AGE_MS = 90_000

type CheckResult<T> = { ok: true; value: T } | { ok: false; err: unknown }

/** Executa o check com timeout próprio; a causa da falha fica só no log do servidor. */
async function bounded<T>(fn: () => Promise<T>): Promise<CheckResult<T>> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`check excedeu ${CHECK_TIMEOUT_MS} ms`)),
      CHECK_TIMEOUT_MS,
    )
  })
  try {
    return { ok: true, value: await Promise.race([fn(), timeout]) }
  } catch (err) {
    return { ok: false, err }
  } finally {
    clearTimeout(timer)
  }
}

export default defineEventHandler(async (event) => {
  const { db, storage } = useServices()
  const log = event.context.log ?? useServices().logger

  const started = performance.now()
  const [pg, s3, hb] = await Promise.all([
    bounded(() => db.$queryRaw`SELECT 1`).then((r) => ({
      r,
      latencyMs: Math.round(performance.now() - started),
    })),
    bounded(() => storage.ping()),
    bounded(() => readHeartbeat(db, 'worker')),
  ])

  const at = hb.ok ? hb.value : null
  const checks = {
    postgres: { ok: pg.r.ok, latencyMs: pg.latencyMs },
    storage: { ok: s3.ok },
    worker: {
      ok: at !== null && Date.now() - at.getTime() <= WORKER_MAX_AGE_MS,
      lastSeenAt: at ? at.toISOString() : null,
    },
  }

  // Causas só no log (a resposta nunca traz mensagens internas).
  if (!pg.r.ok) log.warn({ err: pg.r.err, check: 'postgres' }, 'health check failed')
  if (!s3.ok) log.warn({ err: s3.err, check: 'storage' }, 'health check failed')
  if (!hb.ok) log.warn({ err: hb.err, check: 'worker' }, 'health check failed')
  else if (!checks.worker.ok) {
    log.warn({ check: 'worker', lastSeenAt: checks.worker.lastSeenAt }, 'worker heartbeat stale')
  }

  const allOk = checks.postgres.ok && checks.storage.ok && checks.worker.ok
  setResponseStatus(event, allOk ? 200 : 503)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { status: allOk ? 'ok' : 'degraded', checks }
})
