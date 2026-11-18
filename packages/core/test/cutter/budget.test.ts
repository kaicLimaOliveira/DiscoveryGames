import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startTestDatabase } from '@central/db/testing'
import type { Actor } from '../../src/authz/roles.js'
import { NotFoundError } from '../../src/errors.js'
import {
  checkBudget,
  createBudgetService,
  monthSpendUsd,
  recordCost,
} from '../../src/cutter/budget.js'
import { makeActor, resetDb } from './helpers.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
let orgId: string
let otherOrg: string
let viewer: Actor

beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db?.stop())

beforeEach(async () => {
  const p = db!.prisma
  await resetDb(p)
  orgId = (await p.organization.create({ data: { name: 'A', slug: 'a', aiMonthlyBudgetUsd: 10 } }))
    .id
  otherOrg = (await p.organization.create({ data: { name: 'B', slug: 'b' } })).id
  viewer = await makeActor(p, 'v@x.com', orgId, 'viewer')
})

let seq = 0
const entry = (costUsd: number, over: Record<string, unknown> = {}) => ({
  organizationId: orgId,
  category: 'llm' as const,
  provider: 'anthropic',
  units: 1000,
  unitType: 'input_tokens',
  costUsd,
  refType: 'ai_run',
  refId: `run-${++seq}`,
  ...over,
})

describe('budget', () => {
  it('monthSpendUsd soma só o mês-calendário UTC corrente da organização', async () => {
    const p = db!.prisma
    const now = new Date('2026-11-18T12:00:00Z')
    const base = { category: 'llm' as const, provider: 'x', units: 1, unitType: 'u', refType: 'r' }
    await p.costLedger.createMany({
      data: [
        { ...base, organizationId: orgId, costUsd: 1.5, refId: 'a', occurredAt: now },
        {
          ...base,
          organizationId: orgId,
          costUsd: 2,
          refId: 'b',
          occurredAt: new Date('2026-11-01T00:00:00Z'),
        },
        {
          ...base,
          organizationId: orgId,
          costUsd: 100,
          refId: 'c',
          occurredAt: new Date('2026-10-31T23:59:59.999Z'),
        },
        {
          ...base,
          organizationId: orgId,
          costUsd: 100,
          refId: 'd',
          occurredAt: new Date('2026-12-01T00:00:00Z'),
        },
        { ...base, organizationId: otherOrg, costUsd: 100, refId: 'e', occurredAt: now },
      ],
    })
    expect(await monthSpendUsd(p, orgId, now)).toBeCloseTo(3.5, 6)
    expect(await monthSpendUsd(p, orgId, new Date('2026-09-10T00:00:00Z'))).toBe(0)
  })

  it('checkBudget bloqueia quando spent + estimate > budget', async () => {
    const p = db!.prisma
    await recordCost(p, entry(8))
    expect(await checkBudget(p, orgId, 2)).toEqual({ allowed: true, spentUsd: 8, budgetUsd: 10 })
    expect(await checkBudget(p, orgId, 2.01)).toEqual({
      allowed: false,
      spentUsd: 8,
      budgetUsd: 10,
    })
  })

  it('recordCost repetido não duplica', async () => {
    const p = db!.prisma
    const e = entry(1)
    await recordCost(p, e)
    await recordCost(p, e)
    expect(await p.costLedger.count()).toBe(1)
    expect(await monthSpendUsd(p, orgId)).toBe(1)
  })

  it('recordCost propaga erros que não são de duplicidade', async () => {
    await expect(
      recordCost(db!.prisma, entry(1, { organizationId: '00000000-0000-7000-8000-000000000000' })),
    ).rejects.toThrow()
  })

  it('cruzar 80% grava um só budget.alert mesmo com dois lançamentos seguidos', async () => {
    const p = db!.prisma
    const logger = { warn: vi.fn() }
    await recordCost(p, entry(7), { logger })
    expect(await p.auditLog.count({ where: { action: 'budget.alert' } })).toBe(0)
    await recordCost(p, entry(1), { logger })
    await recordCost(p, entry(1), { logger })
    const alerts = await p.auditLog.findMany({ where: { action: 'budget.alert' } })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      organizationId: orgId,
      diff: { spentUsd: 8, budgetUsd: 10 },
    })
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('recordCost dentro de uma transação usa a transação do chamador', async () => {
    const p = db!.prisma
    await p.$transaction(async (tx) => {
      await recordCost(tx, entry(9))
    })
    expect(await p.auditLog.count({ where: { action: 'budget.alert' } })).toBe(1)
  })

  it('budgetStatus informa alerta e bloqueio e exige acesso', async () => {
    const p = db!.prisma
    const svc = createBudgetService({ db: p })
    expect(await svc.budgetStatus(viewer, orgId)).toEqual({
      spentUsd: 0,
      budgetUsd: 10,
      alert: false,
      blocked: false,
    })
    await recordCost(p, entry(8))
    expect(await svc.budgetStatus(viewer, orgId)).toMatchObject({ alert: true, blocked: false })
    await recordCost(p, entry(2))
    expect(await svc.budgetStatus(viewer, orgId)).toMatchObject({
      spentUsd: 10,
      alert: true,
      blocked: true,
    })
    await expect(svc.budgetStatus(viewer, otherOrg)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('orçamento zero bloqueia e não alerta sem gasto', async () => {
    const p = db!.prisma
    await p.organization.update({ where: { id: orgId }, data: { aiMonthlyBudgetUsd: 0 } })
    const svc = createBudgetService({ db: p })
    expect(await svc.budgetStatus(viewer, orgId)).toMatchObject({ alert: false, blocked: true })
    expect((await checkBudget(p, orgId, 0.01)).allowed).toBe(false)
  })
})
