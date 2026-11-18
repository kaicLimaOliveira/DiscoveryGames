import { afterAll, beforeAll, expect, it } from 'vitest'
import { startTestDatabase } from '../src/testing.js'

let db: Awaited<ReturnType<typeof startTestDatabase>>
beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db.stop())

it('gera uuid v7 e timestamps', async () => {
  const b = await db.prisma.organization.create({ data: { name: 'B', slug: 'b' } })
  expect(b.id[14]).toBe('7')
  expect(b.timezone).toBe('America/Sao_Paulo')
  expect(b.createdAt).toBeInstanceOf(Date)
})
it('Setting global é único mesmo com organizationId nulo', async () => {
  await db.prisma.setting.create({ data: { key: 'k', value: 1 } })
  await expect(db.prisma.setting.create({ data: { key: 'k', value: 2 } })).rejects.toThrow()
})
it('OrganizationMember tem PK composta', async () => {
  const u = await db.prisma.user.create({
    data: { email: 'a@x.com', name: 'A', passwordHash: 'h' },
  })
  const b = await db.prisma.organization.create({ data: { name: 'C', slug: 'c' } })
  await db.prisma.organizationMember.create({
    data: { organizationId: b.id, userId: u.id, role: 'editor' },
  })
  await expect(
    db.prisma.organizationMember.create({
      data: { organizationId: b.id, userId: u.id, role: 'viewer' },
    }),
  ).rejects.toThrow()
})
it('Organization tem os padrões de configuração', async () => {
  const o = await db.prisma.organization.create({ data: { name: 'D', slug: 'd' } })
  expect(o.tags).toEqual([])
  expect(o.voiceGuide).toBe('')
  expect(o.fixedHashtags).toEqual([])
  expect(o.creditTemplate).toBe('Créditos: {creator}')
  expect(o.captionStyle).toEqual({})
  expect(o.clipDefaults).toEqual({ targetMin: 5, targetMax: 10, minSec: 30, maxSec: 90 })
  expect(o.retention).toEqual({ sourceDays: 30, unusedSourceDays: 14, clipDays: 90 })
  expect(Number(o.aiMonthlyBudgetUsd)).toBe(50)
})
