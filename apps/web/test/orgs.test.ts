import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Client,
  createOrganization,
  createUser,
  db,
  loggedIn,
  setupServer,
  type TestUser,
} from './helpers'

await setupServer()

let orgA: string
let orgB: string
let target: TestUser
const clients = {} as Record<'viewer' | 'editor' | 'orgAdmin' | 'admin', Client>

beforeAll(async () => {
  orgA = (await createOrganization()).id
  orgB = (await createOrganization()).id
  target = await createUser({
    prefix: 'alvo',
    memberships: [{ organizationId: orgA, role: 'viewer' }],
  })
  const [viewer, editor, orgAdmin, admin] = await Promise.all([
    createUser({ prefix: 'viewer', memberships: [{ organizationId: orgA, role: 'viewer' }] }),
    createUser({ prefix: 'editor', memberships: [{ organizationId: orgA, role: 'editor' }] }),
    createUser({
      prefix: 'orgadmin',
      memberships: [{ organizationId: orgA, role: 'admin' }],
      totp: true,
    }),
    createUser({ prefix: 'admin', role: 'admin', totp: true }),
  ])
  clients.viewer = await loggedIn(viewer)
  clients.editor = await loggedIn(editor)
  clients.orgAdmin = await loggedIn(orgAdmin)
  clients.admin = await loggedIn(admin)
})

afterAll(async () => {
  await db.$disconnect()
})

describe('autenticação e permissões em /api/orgs', () => {
  it('sem sessão → 401', async () => {
    const anon = new Client()
    expect((await anon.request('/api/orgs')).status).toBe(401)
    expect((await anon.request('/api/orgs', { method: 'POST', body: { name: 'X' } })).status).toBe(
      401,
    )
    expect((await anon.request(`/api/orgs/${orgA}`)).status).toBe(401)
    expect((await anon.request(`/api/orgs/${orgA}`, { method: 'PATCH', body: {} })).status).toBe(
      401,
    )
  })

  it('viewer dá PATCH na própria organização → 403', async () => {
    const res = await clients.viewer.request(`/api/orgs/${orgA}`, {
      method: 'PATCH',
      body: { name: 'Nome novo' },
    })
    expect(res.status).toBe(403)
  })

  it('membro da organização A acessa a B → 404 (GET e PATCH)', async () => {
    expect((await clients.viewer.request(`/api/orgs/${orgB}`)).status).toBe(404)
    const patch = await clients.orgAdmin.request(`/api/orgs/${orgB}`, {
      method: 'PATCH',
      body: { name: 'Invasao' },
    })
    expect(patch.status).toBe(404)
    const row = await db.organization.findUniqueOrThrow({ where: { id: orgB } })
    expect(row.name).not.toBe('Invasao')
  })

  it('não admin dá POST /api/orgs → 403', async () => {
    for (const c of [clients.viewer, clients.orgAdmin]) {
      const res = await c.request('/api/orgs', { method: 'POST', body: { name: 'Nova' } })
      expect(res.status).toBe(403)
    }
  })

  it('PUT/DELETE de membros continuam só para admin global', async () => {
    for (const c of [clients.viewer, clients.editor, clients.orgAdmin]) {
      const put = await c.request(`/api/orgs/${orgA}/members/${target.id}`, {
        method: 'PUT',
        body: { role: 'editor' },
      })
      expect(put.status).toBe(403)
      const del = await c.request(`/api/orgs/${orgA}/members/${target.id}`, { method: 'DELETE' })
      expect(del.status).toBe(403)
    }
  })
})

describe('GET /api/orgs', () => {
  it('admin global vê todas; membro só as suas; resposta com id, name e slug', async () => {
    const all = await clients.admin.request('/api/orgs')
    expect(all.status).toBe(200)
    const list = (all.body as { organizations: Array<Record<string, unknown>> }).organizations
    expect(list.map((o) => o.id)).toEqual(expect.arrayContaining([orgA, orgB]))
    expect(Object.keys(list[0]!).sort()).toEqual(['id', 'name', 'slug'])

    const mine = await clients.viewer.request('/api/orgs')
    const own = (mine.body as { organizations: Array<{ id: string }> }).organizations
    expect(own.map((o) => o.id)).toEqual([orgA])
  })

  it('GET /api/orgs/[orgId] devolve as configurações; id inválido → 422', async () => {
    const res = await clients.viewer.request(`/api/orgs/${orgA}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: orgA, aiMonthlyBudgetUsd: 50, locale: 'pt-BR' })
    expect((await clients.viewer.request('/api/orgs/nao-e-uuid')).status).toBe(422)
    expect((await clients.admin.request(`/api/orgs/${randomUUID()}`)).status).toBe(404)
  })
})

describe('POST /api/orgs', () => {
  it('cria com slug derivado (201) e repetido → 409', async () => {
    const name = `GamerDoido${randomUUID().slice(0, 8)}`
    const res = await clients.admin.request('/api/orgs', { method: 'POST', body: { name } })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name, slug: name.toLowerCase() })
    const dup = await clients.admin.request('/api/orgs', { method: 'POST', body: { name } })
    expect(dup.status).toBe(409)
  })

  it('corpo inválido → 422', async () => {
    const res = await clients.admin.request('/api/orgs', { method: 'POST', body: {} })
    expect(res.status).toBe(422)
    const tz = await clients.admin.request('/api/orgs', {
      method: 'POST',
      body: { name: 'Fuso', timezone: 'Marte/Olympus' },
    })
    expect(tz.status).toBe(422)
  })
})

describe('PATCH /api/orgs/[orgId]', () => {
  it('admin da organização altera tags normalizadas', async () => {
    const res = await clients.orgAdmin.request(`/api/orgs/${orgA}`, {
      method: 'PATCH',
      body: { tags: ['#Games', 'games', 'PS5'] },
    })
    expect(res.status).toBe(200)
    expect((res.body as { tags: string[] }).tags).toEqual(['games', 'ps5'])
  })

  it('valores inválidos → 422', async () => {
    const res = await clients.orgAdmin.request(`/api/orgs/${orgA}`, {
      method: 'PATCH',
      body: { clipDefaults: { targetMin: 5, targetMax: 10, minSec: 100, maxSec: 90 } },
    })
    expect(res.status).toBe(422)
    const unknown = await clients.orgAdmin.request(`/api/orgs/${orgA}`, {
      method: 'PATCH',
      body: { slug: 'outro' },
    })
    expect(unknown.status).toBe(422)
  })
})

describe('PUT/DELETE /api/orgs/[orgId]/members/[userId]', () => {
  it('PUT devolve 204 e invalida a sessão do alvo; DELETE remove; inexistente → 404', async () => {
    const victim = await createUser({
      prefix: 'promovido',
      memberships: [{ organizationId: orgA, role: 'viewer' }],
    })
    const before = await db.user.findUniqueOrThrow({ where: { id: victim.id } })
    const session = await loggedIn(victim)

    const put = await clients.admin.request(`/api/orgs/${orgA}/members/${victim.id}`, {
      method: 'PUT',
      body: { role: 'editor' },
    })
    expect(put.status).toBe(204)
    const after = await db.user.findUniqueOrThrow({ where: { id: victim.id } })
    expect(after.sessionVersion).toBeGreaterThan(before.sessionVersion)
    expect((await session.request('/api/orgs')).status).toBe(401)

    const del = await clients.admin.request(`/api/orgs/${orgA}/members/${victim.id}`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(204)
    expect(
      await db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgA, userId: victim.id } },
      }),
    ).toBeNull()

    const ghost = await clients.admin.request(`/api/orgs/${orgA}/members/${randomUUID()}`, {
      method: 'PUT',
      body: { role: 'viewer' },
    })
    expect(ghost.status).toBe(404)
  })
})
