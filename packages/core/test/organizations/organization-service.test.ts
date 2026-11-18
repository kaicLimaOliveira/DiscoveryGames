import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase } from '@central/db/testing'
import type { Actor } from '../../src/authz/roles.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../src/errors.js'
import {
  createOrganizationService,
  type OrganizationService,
} from '../../src/organizations/organization-service.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
let svc: OrganizationService

let globalAdmin: Actor
const GHOST = '00000000-0000-7000-8000-000000000000'

beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db?.stop())

beforeEach(async () => {
  const p = db!.prisma
  await p.auditLog.deleteMany()
  await p.organizationMember.deleteMany()
  await p.user.deleteMany()
  await p.organization.deleteMany()
  svc = createOrganizationService({ db: p })
  globalAdmin = {
    userId: await makeUser('root@x.com'),
    globalRole: 'admin',
    memberships: [],
  }
})

async function makeUser(email: string): Promise<string> {
  const u = await db!.prisma.user.create({ data: { email, name: email, passwordHash: 'x' } })
  return u.id
}

function memberOf(
  userId: string,
  organizationId: string,
  role: 'viewer' | 'editor' | 'approver' | 'admin',
): Actor {
  return { userId, globalRole: 'member', memberships: [{ organizationId, role }] }
}

describe('organization-service', () => {
  it('admin global cria organização com slug derivado', async () => {
    const adminId = await makeUser('a@x.com')
    const org = await svc.create(
      { ...globalAdmin, userId: adminId },
      { name: 'Academia Força Total' },
    )
    expect(org.slug).toBe('academia-forca-total')
    expect(org.aiMonthlyBudgetUsd).toBe(50)
    expect(org.timezone).toBe('America/Sao_Paulo')
  })

  it('create exige admin global', async () => {
    const o = await svc.create(globalAdmin, { name: 'Base' })
    const actor = memberOf(await makeUser(`u${Math.random()}@x.com`), o.id, 'admin')
    await expect(svc.create(actor, { name: 'Outra' })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('slug repetido gera ConflictError', async () => {
    await svc.create(globalAdmin, { name: 'Games' })
    await expect(svc.create(globalAdmin, { name: 'Outro', slug: 'games' })).rejects.toBeInstanceOf(
      ConflictError,
    )
    await expect(svc.create(globalAdmin, { name: 'Games' })).rejects.toThrow(
      'Já existe uma organização com este identificador.',
    )
  })

  it('create rejeita fuso inválido e nome vazio', async () => {
    await expect(
      svc.create(globalAdmin, { name: 'X', timezone: 'Marte/Olympus' }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(svc.create(globalAdmin, { name: '   ' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('membro só lista as próprias organizações', async () => {
    const a = await svc.create(globalAdmin, { name: 'Alfa' })
    await svc.create(globalAdmin, { name: 'Beta' })
    const c = await svc.create(globalAdmin, { name: 'Gama' })
    expect((await svc.list(globalAdmin)).map((o) => o.name)).toEqual(['Alfa', 'Beta', 'Gama'])
    const actor: Actor = {
      userId: await makeUser('m@x.com'),
      globalRole: 'member',
      memberships: [
        { organizationId: c.id, role: 'viewer' },
        { organizationId: a.id, role: 'viewer' },
      ],
    }
    expect((await svc.list(actor)).map((o) => o.name)).toEqual(['Alfa', 'Gama'])
  })

  it('get de organização alheia lança NotFoundError', async () => {
    const a = await svc.create(globalAdmin, { name: 'Alfa' })
    const b = await svc.create(globalAdmin, { name: 'Beta' })
    const actor = memberOf(await makeUser(`u${Math.random()}@x.com`), a.id, 'viewer')
    expect((await svc.get(actor, a.id)).id).toBe(a.id)
    await expect(svc.get(actor, b.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(svc.get(globalAdmin, GHOST)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('update exige settings.manage', async () => {
    const o = await svc.create(globalAdmin, { name: 'Alfa' })
    await expect(
      svc.update(memberOf(await makeUser(`u${Math.random()}@x.com`), o.id, 'editor'), o.id, {
        name: 'Novo',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    const adminId = await makeUser('oa@x.com')
    const updated = await svc.update(memberOf(adminId, o.id, 'admin'), o.id, { name: 'Novo' })
    expect(updated.name).toBe('Novo')
  })

  it('update de organização alheia lança NotFoundError', async () => {
    const a = await svc.create(globalAdmin, { name: 'Alfa' })
    const b = await svc.create(globalAdmin, { name: 'Beta' })
    await expect(
      svc.update(memberOf(await makeUser(`u${Math.random()}@x.com`), a.id, 'admin'), b.id, {
        name: 'X',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('update normaliza tags', async () => {
    const o = await svc.create(globalAdmin, { name: 'Alfa' })
    const updated = await svc.update(globalAdmin, o.id, {
      tags: ['#Games', 'games', 'PS5'],
      fixedHashtags: ['#Foo', 'foo'],
    })
    expect(updated.tags).toEqual(['games', 'ps5'])
    expect(updated.fixedHashtags).toEqual(['foo'])
  })

  it('update rejeita valores inválidos', async () => {
    const o = await svc.create(globalAdmin, { name: 'Alfa' })
    const ok = { targetMin: 5, targetMax: 10, minSec: 30, maxSec: 90 }
    const bad = [
      { clipDefaults: { ...ok, minSec: 100, maxSec: 90 } },
      { clipDefaults: { ...ok, targetMin: 11 } },
      { clipDefaults: { ...ok, targetMax: 21 } },
      { clipDefaults: { ...ok, minSec: 10 } },
      { clipDefaults: { ...ok, maxSec: 181 } },
      { aiMonthlyBudgetUsd: -1 },
      { aiMonthlyBudgetUsd: 10_001 },
      { timezone: 'Marte/Olympus' },
      { tags: Array.from({ length: 31 }, (_, i) => `t${i}`) },
      { tags: ['x'.repeat(51)] },
      { name: '' },
    ]
    for (const patch of bad) {
      await expect(svc.update(globalAdmin, o.id, patch)).rejects.toBeInstanceOf(ValidationError)
    }
  })

  it('update grava auditoria com diff', async () => {
    const o = await svc.create(globalAdmin, { name: 'Alfa' })
    const adminId = await makeUser('d@x.com')
    await svc.update({ ...globalAdmin, userId: adminId }, o.id, {
      name: 'Beta',
      aiMonthlyBudgetUsd: 80,
    })
    const log = await db!.prisma.auditLog.findFirstOrThrow({
      where: { action: 'organization.updated', entityId: o.id },
    })
    expect(log).toMatchObject({ entityType: 'organization', organizationId: o.id, userId: adminId })
    expect(log.diff).toEqual({
      name: { from: 'Alfa', to: 'Beta' },
      aiMonthlyBudgetUsd: { from: 50, to: 80 },
    })
    expect(
      await db!.prisma.auditLog.count({
        where: { action: 'organization.created', entityId: o.id },
      }),
    ).toBe(1)
  })
})
