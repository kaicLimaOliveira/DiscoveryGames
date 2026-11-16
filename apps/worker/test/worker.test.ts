import { Writable } from 'node:stream'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createPgBossQueue, readHeartbeat } from '@central/db'
import { startTestDatabase } from '@central/db/testing'
import { createLogger, QUEUES } from '@central/shared'
import { startWorker } from '../src/worker.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db?.stop())

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor<T>(fn: () => Promise<T | undefined | false>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > deadline) throw new Error('waitFor timeout')
    await sleep(100)
  }
}

function capture() {
  const lines: string[] = []
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk))
      cb()
    },
  })
  return { lines, logger: createLogger({ name: 'worker-test', destination }) }
}

it('heartbeat avança, system.echo é logado com jobId e o heartbeat para após stop()', async () => {
  const { lines, logger } = capture()
  const worker = await startWorker({ databaseUrl: db!.url, heartbeatMs: 200, logger })
  let stopped = false
  try {
    const first = await waitFor(() => readHeartbeat(db!.prisma, 'worker'))
    await sleep(1000)
    const later = await readHeartbeat(db!.prisma, 'worker')
    expect(later!.getTime()).toBeGreaterThan(first.getTime())

    const web = await createPgBossQueue({ connectionString: db!.url, role: 'web' })
    let jobId: string
    try {
      jobId = (await web.send(QUEUES.systemEcho, { hello: 'world' }))!
    } finally {
      await web.stop()
    }
    expect(jobId).toBeTruthy()
    const line = await waitFor(async () =>
      lines.find((l) => l.includes(jobId) && l.includes('"msg":"echo"')),
    )
    expect(line).toContain(jobId)

    await worker.stop()
    stopped = true
    const afterStop = await readHeartbeat(db!.prisma, 'worker')
    await sleep(700)
    expect(await readHeartbeat(db!.prisma, 'worker')).toEqual(afterStop)
  } finally {
    if (!stopped) await worker.stop()
  }
}, 60_000)
