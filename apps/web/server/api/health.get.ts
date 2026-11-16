import { readHeartbeat } from '@central/db'
import { useServices } from '../utils/services'

const CHECK_TIMEOUT_MS = 2_000
const WORKER_MAX_AGE_MS = 90_000

/** Executa o check com timeout próprio; qualquer falha vira `null` (sem expor a mensagem). */
async function bounded<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)
  })
  try {
    return { ok: true, value: await Promise.race([fn(), timeout]) }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

export default defineEventHandler(async (event) => {
  const { db, storage } = useServices()

  const [postgres, storageCheck, worker] = await Promise.all([
    (async () => {
      const started = performance.now()
      const r = await bounded(() => db.$queryRaw`SELECT 1`)
      return { ok: r.ok, latencyMs: Math.round(performance.now() - started) }
    })(),
    bounded(() => storage.ping()).then((r) => ({ ok: r.ok })),
    bounded(() => readHeartbeat(db, 'worker')).then((r) => {
      const at = r.ok ? r.value : null
      return {
        ok: at !== null && Date.now() - at.getTime() <= WORKER_MAX_AGE_MS,
        lastSeenAt: at ? at.toISOString() : null,
      }
    }),
  ])

  const allOk = postgres.ok && storageCheck.ok && worker.ok
  if (!allOk)
    event.context.log?.warn({ postgres, storage: storageCheck, worker }, 'health degraded')
  setResponseStatus(event, allOk ? 200 : 503)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return {
    status: allOk ? 'ok' : 'degraded',
    checks: { postgres, storage: storageCheck, worker },
  }
})
