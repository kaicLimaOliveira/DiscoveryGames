import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrganization, createUser, db, loggedIn, setupServer, type Client } from './helpers'

await setupServer()

let orgA: string
let orgB: string
const clients = {} as Record<'viewerA' | 'adminA' | 'adminB', Client>

const handle = () => `h${randomUUID().replaceAll('-', '').slice(0, 12)}`

beforeAll(async () => {
  orgA = (await createOrganization()).id
  orgB = (await createOrganization()).id
  const [viewerA, adminA, adminB] = await Promise.all([
    createUser({ prefix: 'viewer', memberships: [{ organizationId: orgA, role: 'viewer' }] }),
    createUser({
      prefix: 'admina',
      memberships: [{ organizationId: orgA, role: 'admin' }],
      totp: true,
    }),
    createUser({
      prefix: 'adminb',
      memberships: [{ organizationId: orgB, role: 'admin' }],
      totp: true,
    }),
  ])
  clients.viewerA = await loggedIn(viewerA)
  clients.adminA = await loggedIn(adminA)
  clients.adminB = await loggedIn(adminB)
})

afterAll(async () => {
  await db.$disconnect()
})

describe('contas vinculadas', () => {
  it('GET lista sem expor credencial; viewer lê mas não vincula (403)', async () => {
    const h = handle()
    const created = await clients.adminA.request(`/api/orgs/${orgA}/accounts/tiktok`, {
      method: 'POST',
      body: { handle: `@${h}` },
    })
    expect(created.status).toBe(201)
    await db.socialAccount.updateMany({
      where: { externalId: h },
      data: { credentialEnc: 'v1.segredo' },
    })

    const res = await clients.viewerA.request(`/api/orgs/${orgA}/accounts`)
    expect(res.status).toBe(200)
    const body = res.body as { accounts: Array<{ externalId: string }> }
    expect(body.accounts.map((a) => a.externalId)).toContain(h)
    expect(JSON.stringify(body)).not.toContain('credential')
    expect(JSON.stringify(body)).not.toContain('segredo')

    const denied = await clients.viewerA.request(`/api/orgs/${orgA}/accounts/tiktok`, {
      method: 'POST',
      body: { handle: handle() },
    })
    expect(denied.status).toBe(403)
  })

  it('organização B não vê nem altera contas da A (404)', async () => {
    const h = handle()
    await clients.adminA.request(`/api/orgs/${orgA}/accounts/tiktok`, {
      method: 'POST',
      body: { handle: h },
    })
    const account = await db.socialAccount.findFirstOrThrow({ where: { externalId: h } })
    expect((await clients.adminB.request(`/api/orgs/${orgA}/accounts`)).status).toBe(404)
    const del = await clients.adminB.request(`/api/orgs/${orgB}/accounts/${account.id}`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(404)
    // admin da A, pelo caminho da A, apontando a conta correta: ok; pelo caminho errado: 404
    const wrongPath = await clients.adminA.request(`/api/orgs/${orgB}/accounts/${account.id}`, {
      method: 'DELETE',
    })
    expect(wrongPath.status).toBe(404)
    expect(await db.socialAccount.count({ where: { id: account.id } })).toBe(1)
  })

  it('admin da A não apaga conta da B pelo caminho da A (404) e a conta permanece', async () => {
    const created = await clients.adminB.request(`/api/orgs/${orgB}/accounts/tiktok`, {
      method: 'POST',
      body: { handle: handle() },
    })
    expect(created.status).toBe(201)
    const accountId = (created.body as { id: string }).id
    const del = await clients.adminA.request(`/api/orgs/${orgA}/accounts/${accountId}`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(404)
    expect(await db.socialAccount.count({ where: { id: accountId, organizationId: orgB } })).toBe(1)
  })

  it('TikTok duplicado entre organizações → 409', async () => {
    const h = handle()
    const first = await clients.adminA.request(`/api/orgs/${orgA}/accounts/tiktok`, {
      method: 'POST',
      body: { handle: h },
    })
    expect(first.status).toBe(201)
    const second = await clients.adminB.request(`/api/orgs/${orgB}/accounts/tiktok`, {
      method: 'POST',
      body: { handle: h },
    })
    expect(second.status).toBe(409)
    expect((second.body as { message: string }).message).toBe(
      'Esta conta já está vinculada a outra organização.',
    )
  })

  it('handle inválido → 422', async () => {
    const res = await clients.adminA.request(`/api/orgs/${orgA}/accounts/tiktok`, {
      method: 'POST',
      body: { handle: 'a' },
    })
    expect(res.status).toBe(422)
  })

  it('PATCH dailyLimit 5 → 200 e DELETE → 204', async () => {
    const h = handle()
    const created = await clients.adminA.request(`/api/orgs/${orgA}/accounts/tiktok`, {
      method: 'POST',
      body: { handle: h },
    })
    const id = (created.body as { id: string }).id
    const patch = await clients.adminA.request(`/api/orgs/${orgA}/accounts/${id}`, {
      method: 'PATCH',
      body: { dailyLimit: 5 },
    })
    expect(patch.status).toBe(200)
    expect((patch.body as { dailyLimit: number }).dailyLimit).toBe(5)
    const bad = await clients.adminA.request(`/api/orgs/${orgA}/accounts/${id}`, {
      method: 'PATCH',
      body: { dailyLimit: 0 },
    })
    expect(bad.status).toBe(422)

    const del = await clients.adminA.request(`/api/orgs/${orgA}/accounts/${id}`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(204)
    expect(await db.socialAccount.count({ where: { id } })).toBe(0)
  })
})
