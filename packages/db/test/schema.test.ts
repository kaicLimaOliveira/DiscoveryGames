import { afterAll, beforeAll, expect, it } from 'vitest'
import { startTestDatabase } from '../src/testing.js'

let db: Awaited<ReturnType<typeof startTestDatabase>>
beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db.stop())

it('gera uuid v7 e timestamps', async () => {
  const b = await db.prisma.brand.create({ data: { name: 'B', slug: 'b' } })
  expect(b.id[14]).toBe('7')
  expect(b.timezone).toBe('America/Sao_Paulo')
  expect(b.createdAt).toBeInstanceOf(Date)
})
it('Setting global é único mesmo com brandId nulo', async () => {
  await db.prisma.setting.create({ data: { key: 'k', value: 1 } })
  await expect(db.prisma.setting.create({ data: { key: 'k', value: 2 } })).rejects.toThrow()
})
it('BrandMember tem PK composta', async () => {
  const u = await db.prisma.user.create({
    data: { email: 'a@x.com', name: 'A', passwordHash: 'h' },
  })
  const b = await db.prisma.brand.create({ data: { name: 'C', slug: 'c' } })
  await db.prisma.brandMember.create({ data: { brandId: b.id, userId: u.id, role: 'editor' } })
  await expect(
    db.prisma.brandMember.create({ data: { brandId: b.id, userId: u.id, role: 'viewer' } }),
  ).rejects.toThrow()
})
