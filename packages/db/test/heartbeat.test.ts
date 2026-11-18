import { afterAll, beforeAll, expect, it } from 'vitest'
import { readHeartbeat, recordHeartbeat } from '../src/heartbeat.js'
import { startTestDatabase } from '../src/testing.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db?.stop())

it('upsert: segunda gravação sobrescreve a primeira', async () => {
  const t1 = new Date('2026-01-01T00:00:00Z')
  const t2 = new Date('2026-01-01T00:01:00Z')
  await recordHeartbeat(db!.prisma, 'worker', t1)
  expect(await readHeartbeat(db!.prisma, 'worker')).toEqual(t1)
  await recordHeartbeat(db!.prisma, 'worker', t2)
  expect(await readHeartbeat(db!.prisma, 'worker')).toEqual(t2)
})
it('nome inexistente retorna null', async () => {
  expect(await readHeartbeat(db!.prisma, 'nada')).toBeNull()
})
