import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { applyRemainingMigrations, startTestDatabase } from '../src/testing.js'

const IDENTITY = '20261116001301_identity'
const ORG = '00000000-0000-7000-8000-000000000001'
const USER = '00000000-0000-7000-8000-000000000002'

let db: Awaited<ReturnType<typeof startTestDatabase>>
let client: pg.Client

beforeAll(async () => {
  db = await startTestDatabase({ upTo: IDENTITY })
  client = new pg.Client({ connectionString: db.url })
  await client.connect()
  await client.query(
    `INSERT INTO "User" (id, email, name, "passwordHash", "updatedAt") VALUES ($1, 'u@x.com', 'U', 'h', now())`,
    [USER],
  )
  await client.query(
    `INSERT INTO "Brand" (id, name, slug, "voiceGuide", "updatedAt") VALUES ($1, 'Marca', 'marca', '{"tom":"leve"}', now())`,
    [ORG],
  )
  await client.query(
    `INSERT INTO "BrandMember" ("brandId", "userId", role, "updatedAt") VALUES ($1, $2, 'approver', now())`,
    [ORG, USER],
  )
  await client.query(
    `INSERT INTO "Setting" (id, "brandId", key, value, "updatedAt") VALUES ('00000000-0000-7000-8000-000000000003', $1, 'k', '1', now())`,
    [ORG],
  )
  await client.query(
    `INSERT INTO "AuditLog" (id, "brandId", action, "entityType", "updatedAt") VALUES ('00000000-0000-7000-8000-000000000004', $1, 'a', 'e', now())`,
    [ORG],
  )
  await applyRemainingMigrations(db.url, [IDENTITY])
}, 120_000)
afterAll(async () => {
  await client.end()
  await db.stop()
})

it('preserva a organização com id, nome e slug e aplica os padrões', async () => {
  const o = await db.prisma.organization.findUniqueOrThrow({ where: { id: ORG } })
  expect(o.name).toBe('Marca')
  expect(o.slug).toBe('marca')
  expect(Number(o.aiMonthlyBudgetUsd)).toBe(50)
  expect(o.clipDefaults).toEqual({ targetMin: 5, targetMax: 10, minSec: 30, maxSec: 90 })
  expect(o.retention).toEqual({ sourceDays: 30, unusedSourceDays: 14, clipDays: 90 })
  expect(o.creditTemplate).toBe('Créditos: {creator}')
  expect(o.tags).toEqual([])
  expect(o.fixedHashtags).toEqual([])
  expect(typeof o.voiceGuide).toBe('string')
})
it('preserva membros, configurações e auditoria', async () => {
  const m = await db.prisma.organizationMember.findFirstOrThrow({ where: { organizationId: ORG } })
  expect(m.role).toBe('approver')
  expect(m.userId).toBe(USER)
  expect((await db.prisma.setting.findFirstOrThrow()).organizationId).toBe(ORG)
  expect((await db.prisma.auditLog.findFirstOrThrow()).organizationId).toBe(ORG)
})
it('mantém o índice único (organizationId, key) com NULLS NOT DISTINCT', async () => {
  await db.prisma.setting.create({ data: { key: 'g', value: 1 } })
  await expect(db.prisma.setting.create({ data: { key: 'g', value: 2 } })).rejects.toThrow()
  await expect(
    db.prisma.setting.create({ data: { organizationId: ORG, key: 'k', value: 2 } }),
  ).rejects.toThrow()
})
