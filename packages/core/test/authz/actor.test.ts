import { afterAll, beforeAll, expect, it } from 'vitest'
import { startTestDatabase } from '@central/db/testing'
import { loadActor } from '../../src/authz/actor.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db?.stop())

it('carrega papel global, memberships e sessionVersion', async () => {
  const p = db!.prisma
  const organization = await p.organization.create({ data: { name: 'B', slug: 'b' } })
  const user = await p.user.create({
    data: {
      email: 'a@x.com',
      name: 'A',
      passwordHash: 'h',
      sessionVersion: 3,
      memberships: { create: { organizationId: organization.id, role: 'approver' } },
    },
  })
  expect(await loadActor(p, user.id)).toEqual({
    userId: user.id,
    globalRole: 'member',
    memberships: [{ organizationId: organization.id, role: 'approver' }],
    sessionVersion: 3,
  })
})

it('usuário disabled retorna null', async () => {
  const p = db!.prisma
  const user = await p.user.create({
    data: { email: 'd@x.com', name: 'D', passwordHash: 'h', status: 'disabled' },
  })
  expect(await loadActor(p, user.id)).toBeNull()
})

it('usuário inexistente retorna null', async () => {
  expect(await loadActor(db!.prisma, '00000000-0000-7000-8000-000000000000')).toBeNull()
})
