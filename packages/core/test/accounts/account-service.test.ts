import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startTestDatabase } from '@central/db/testing'
import { createCipher } from '@central/shared'
import type { Actor } from '../../src/authz/roles.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../src/errors.js'
import { createAccountService, type AccountService } from '../../src/accounts/account-service.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
let svc: AccountService
let orgA: string
let orgB: string
let adminA: Actor
let adminB: Actor
let viewerA: Actor

const cipher = createCipher(new Map([[1, Buffer.alloc(32, 7)]]))
const GHOST = '00000000-0000-7000-8000-000000000000'

beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db?.stop())

beforeEach(async () => {
  const p = db!.prisma
  await p.auditLog.deleteMany()
  await p.socialAccount.deleteMany()
  await p.organizationMember.deleteMany()
  await p.user.deleteMany()
  await p.organization.deleteMany()
  svc = createAccountService({ db: p, cipher })
  orgA = (await p.organization.create({ data: { name: 'A', slug: 'a' } })).id
  orgB = (await p.organization.create({ data: { name: 'B', slug: 'b' } })).id
  const u = async (email: string) =>
    (await p.user.create({ data: { email, name: email, passwordHash: 'x' } })).id
  adminA = {
    userId: await u('a@x.com'),
    globalRole: 'member',
    memberships: [{ organizationId: orgA, role: 'admin' }],
  }
  adminB = {
    userId: await u('b@x.com'),
    globalRole: 'member',
    memberships: [{ organizationId: orgB, role: 'admin' }],
  }
  viewerA = {
    userId: await u('v@x.com'),
    globalRole: 'member',
    memberships: [{ organizationId: orgA, role: 'viewer' }],
  }
})

const input = (over: Record<string, unknown> = {}) => ({
  platform: 'youtube' as const,
  externalId: 'UC123',
  displayName: 'Canal',
  credential: { refresh_token: 'segredo-super-secreto' },
  scopes: ['a', 'b'],
  ...over,
})

describe('account-service', () => {
  it('linkTiktok normaliza @ e caixa', async () => {
    const a = await svc.linkTiktok(adminA, orgA, ' @GamerDoido ')
    expect(a.externalId).toBe('gamerdoido')
    expect(a.displayName).toBe('@gamerdoido')
    expect(a.platform).toBe('tiktok')
  })

  it('linkTiktok rejeita handle inválido', async () => {
    await expect(svc.linkTiktok(adminA, orgA, 'a')).rejects.toBeInstanceOf(ValidationError)
    await expect(svc.linkTiktok(adminA, orgA, 'nome com espaço')).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('linkTiktok exige accounts.manage (403) e oculta organização alheia (404)', async () => {
    await expect(svc.linkTiktok(viewerA, orgA, 'abc')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(svc.linkTiktok(adminB, orgA, 'abc')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('mesma conta em outra organização gera ConflictError e não altera nada', async () => {
    const first = await svc.upsertLinked(adminA, orgA, input())
    const before = await db!.prisma.socialAccount.findUniqueOrThrow({ where: { id: first.id } })
    await expect(
      svc.upsertLinked(adminB, orgB, input({ credential: { refresh_token: 'outro' } })),
    ).rejects.toThrow(new ConflictError('Esta conta já está vinculada a outra organização.'))
    const after = await db!.prisma.socialAccount.findUniqueOrThrow({ where: { id: first.id } })
    expect(after).toEqual(before)
    expect(await db!.prisma.socialAccount.count()).toBe(1)
  })

  it('corrida na unique (platform, externalId) vira ConflictError', async () => {
    const results = await Promise.allSettled([
      svc.upsertLinked(adminA, orgA, input()),
      svc.upsertLinked(adminB, orgB, input()),
    ])
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError)
  })

  it('upsertLinked na mesma organização reconecta e reativa', async () => {
    const first = await svc.upsertLinked(adminA, orgA, input())
    await db!.prisma.socialAccount.update({
      where: { id: first.id },
      data: { status: 'needs_reauth' },
    })
    const again = await svc.upsertLinked(
      adminA,
      orgA,
      input({ credential: { refresh_token: 'novo' }, scopes: ['c'] }),
    )
    expect(again.id).toBe(first.id)
    expect(again.status).toBe('active')
    expect(again.scopes).toEqual(['c'])
    expect(await svc.readCredential(orgA, first.id)).toEqual({ refresh_token: 'novo' })
  })

  it('upsertLinked aceita transação e faz rollback junto', async () => {
    await expect(
      db!.prisma.$transaction(async (tx) => {
        await svc.upsertLinked(adminA, orgA, input(), { tx })
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    expect(await db!.prisma.socialAccount.count()).toBe(0)
    expect(await db!.prisma.auditLog.count()).toBe(0)
  })

  it('credencial é cifrada e list nunca a expõe', async () => {
    const a = await svc.upsertLinked(adminA, orgA, input())
    const row = await db!.prisma.socialAccount.findUniqueOrThrow({ where: { id: a.id } })
    expect(row.credentialEnc).toBeTruthy()
    expect(row.credentialEnc).not.toContain('segredo-super-secreto')
    const list = await svc.list(viewerA, orgA)
    expect(Object.keys(list[0]!).sort()).toEqual(
      [
        'createdAt',
        'dailyLimit',
        'displayName',
        'externalId',
        'id',
        'platform',
        'scopes',
        'status',
      ].sort(),
    )
    expect(await svc.readCredential(orgA, a.id)).toEqual({ refresh_token: 'segredo-super-secreto' })
  })

  it('list só traz contas da organização', async () => {
    await svc.upsertLinked(adminA, orgA, input())
    await svc.linkTiktok(adminB, orgB, 'outra')
    expect((await svc.list(adminA, orgA)).map((a) => a.externalId)).toEqual(['UC123'])
    await expect(svc.list(adminB, orgA)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('conta de outra organização gera NotFoundError em setDailyLimit, disconnect e readCredential', async () => {
    const a = await svc.upsertLinked(adminA, orgA, input())
    await expect(svc.setDailyLimit(adminB, orgB, a.id, 3)).rejects.toBeInstanceOf(NotFoundError)
    await expect(svc.disconnect(adminB, orgB, a.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(svc.readCredential(orgB, a.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(svc.readCredential(orgA, GHOST)).rejects.toBeInstanceOf(NotFoundError)
    expect(await db!.prisma.socialAccount.count()).toBe(1)
  })

  it('disconnect remove mesmo se revoke falhar e audita sem credencial', async () => {
    const a = await svc.upsertLinked(adminA, orgA, input())
    const revoke = vi.fn().mockRejectedValue(new Error('falha'))
    await svc.disconnect(adminA, orgA, a.id, revoke)
    expect(revoke).toHaveBeenCalledWith({ refresh_token: 'segredo-super-secreto' })
    expect(await db!.prisma.socialAccount.count()).toBe(0)
    const logs = await db!.prisma.auditLog.findMany({ where: { entityType: 'social_account' } })
    expect(logs.map((l) => l.action).sort()).toEqual([
      'social_account.disconnected',
      'social_account.linked',
    ])
    expect(JSON.stringify(logs)).not.toContain('segredo-super-secreto')
    expect(JSON.stringify(logs)).not.toContain('credential')
    // pode reconectar em outra organização depois
    await expect(svc.upsertLinked(adminB, orgB, input())).resolves.toBeTruthy()
  })

  it('setDailyLimit valida faixa', async () => {
    const a = await svc.upsertLinked(adminA, orgA, input())
    await expect(svc.setDailyLimit(adminA, orgA, a.id, 0)).rejects.toBeInstanceOf(ValidationError)
    await expect(svc.setDailyLimit(adminA, orgA, a.id, 1001)).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(svc.setDailyLimit(adminA, orgA, a.id, 1.5)).rejects.toBeInstanceOf(ValidationError)
    expect((await svc.setDailyLimit(adminA, orgA, a.id, 5)).dailyLimit).toBe(5)
    expect((await svc.setDailyLimit(adminA, orgA, a.id, null)).dailyLimit).toBeNull()
    await expect(svc.setDailyLimit(viewerA, orgA, a.id, 5)).rejects.toBeInstanceOf(ForbiddenError)
  })
})
