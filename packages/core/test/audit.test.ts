import { afterAll, beforeAll, expect, it } from 'vitest'
import { startTestDatabase } from '@central/db/testing'
import { writeAudit } from '../src/audit.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db?.stop())

it('grava linha com diff JSON', async () => {
  const p = db!.prisma
  await writeAudit(p, {
    action: 'user.create',
    entityType: 'User',
    entityId: 'e1',
    diff: { a: 1 },
    ip: '1.2.3.4',
  })
  const row = await p.auditLog.findFirstOrThrow({ where: { entityId: 'e1' } })
  expect(row).toMatchObject({
    action: 'user.create',
    entityType: 'User',
    diff: { a: 1 },
    ip: '1.2.3.4',
  })
})

it('diff ausente fica null', async () => {
  const p = db!.prisma
  await writeAudit(p, { action: 'x', entityType: 'T', entityId: 'e2' })
  const row = await p.auditLog.findFirstOrThrow({ where: { entityId: 'e2' } })
  expect(row.diff).toBeNull()
})

it('dentro de transação revertida não deixa linha', async () => {
  const p = db!.prisma
  await expect(
    p.$transaction(async (tx) => {
      await writeAudit(tx, { action: 'x', entityType: 'T', entityId: 'rolled' })
      throw new Error('rollback')
    }),
  ).rejects.toThrow('rollback')
  expect(await p.auditLog.count({ where: { entityId: 'rolled' } })).toBe(0)
})
