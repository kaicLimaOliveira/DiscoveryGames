import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Client,
  PASSWORD,
  createBrand,
  createUser,
  db,
  loggedIn,
  setupServer,
  uniqueEmail,
  type TestUser,
} from './helpers'

await setupServer()

let brandId: string
let target: TestUser
const clients: Record<'viewer' | 'editor' | 'approver' | 'admin', Client> = {} as never

beforeAll(async () => {
  brandId = (await createBrand()).id
  target = await createUser({ prefix: 'alvo' })
  const [viewer, editor, approver, admin] = await Promise.all([
    createUser({ prefix: 'viewer', memberships: [{ brandId, role: 'viewer' }] }),
    createUser({ prefix: 'editor', memberships: [{ brandId, role: 'editor' }] }),
    createUser({ prefix: 'approver', memberships: [{ brandId, role: 'approver' }], totp: true }),
    createUser({ prefix: 'admin', role: 'admin', totp: true }),
  ])
  clients.viewer = await loggedIn(viewer)
  clients.editor = await loggedIn(editor)
  clients.approver = await loggedIn(approver)
  clients.admin = await loggedIn(admin)
})

afterAll(async () => {
  await db.$disconnect()
})

interface Route {
  name: string
  method: string
  path: () => string
  body?: () => unknown
}

const ROUTES: Route[] = [
  { name: 'GET brands', method: 'GET', path: () => '/api/admin/brands' },
  { name: 'GET users', method: 'GET', path: () => '/api/admin/users' },
  {
    name: 'POST users',
    method: 'POST',
    path: () => '/api/admin/users',
    body: () => ({ email: uniqueEmail('novo'), name: 'Novo Usuário', password: PASSWORD }),
  },
  {
    name: 'PATCH users/:id',
    method: 'PATCH',
    path: () => `/api/admin/users/${target.id}`,
    body: () => ({ name: 'Alvo Renomeado' }),
  },
  {
    name: 'PUT brands/:brandId/members/:userId',
    method: 'PUT',
    path: () => `/api/admin/brands/${brandId}/members/${target.id}`,
    body: () => ({ role: 'viewer' }),
  },
  {
    name: 'DELETE brands/:brandId/members/:userId',
    method: 'DELETE',
    path: () => `/api/admin/brands/${brandId}/members/${target.id}`,
  },
]

describe('matriz de permissões em /api/admin/**', () => {
  for (const route of ROUTES) {
    for (const role of ['viewer', 'editor', 'approver'] as const) {
      it(`${route.name}: ${role} → 403`, async () => {
        const res = await clients[role].request(route.path(), {
          method: route.method,
          body: route.body?.(),
        })
        expect(res.status).toBe(403)
      })
    }

    it(`${route.name}: admin → 2xx`, async () => {
      const res = await clients.admin.request(route.path(), {
        method: route.method,
        body: route.body?.(),
      })
      expect(res.status).toBeGreaterThanOrEqual(200)
      expect(res.status).toBeLessThan(300)
    })

    it(`${route.name}: sem cookie → 401`, async () => {
      const res = await new Client().request(route.path(), {
        method: route.method,
        body: route.body?.(),
      })
      expect(res.status).toBe(401)
    })
  }
})

describe('administração de usuários', () => {
  it('GET /api/admin/users não expõe segredos', async () => {
    const res = await clients.admin.request('/api/admin/users')
    expect(res.status).toBe(200)
    const users = (res.body as { users: Array<Record<string, unknown>> }).users
    expect(users.length).toBeGreaterThan(0)
    const text = JSON.stringify(res.body)
    for (const key of ['passwordHash', 'totpSecretEnc', 'totpLastUsedStep']) {
      expect(text).not.toContain(key)
    }
    expect(users.find((u) => u.id === target.id)).toMatchObject({ email: target.email })
  })

  it('POST cria o usuário (201) e grava auditoria', async () => {
    const email = uniqueEmail('criado')
    const res = await clients.admin.request('/api/admin/users', {
      method: 'POST',
      body: { email, name: 'Criado', password: PASSWORD, globalRole: 'member' },
    })
    expect(res.status).toBe(201)
    const id = (res.body as { id: string }).id
    const audit = await db.auditLog.findFirst({ where: { action: 'user.created', entityId: id } })
    expect(audit).not.toBeNull()
  })

  it('POST normaliza o e-mail (trim + minúsculas)', async () => {
    const email = uniqueEmail('norm')
    const res = await clients.admin.request('/api/admin/users', {
      method: 'POST',
      body: { email: `  ${email.toUpperCase()} `, name: 'Norm', password: PASSWORD },
    })
    expect(res.status).toBe(201)
    const user = await db.user.findUniqueOrThrow({ where: { id: (res.body as { id: string }).id } })
    expect(user.email).toBe(email)
  })

  it('POST com e-mail duplicado → 409', async () => {
    const res = await clients.admin.request('/api/admin/users', {
      method: 'POST',
      body: { email: target.email, name: 'Dup', password: PASSWORD },
    })
    expect(res.status).toBe(409)
  })

  it('POST com senha curta → 422', async () => {
    const res = await clients.admin.request('/api/admin/users', {
      method: 'POST',
      body: { email: uniqueEmail('curta'), name: 'Curta', password: 'curta' },
    })
    expect(res.status).toBe(422)
  })

  it('PATCH com id inválido → 422', async () => {
    const res = await clients.admin.request('/api/admin/users/nao-e-uuid', {
      method: 'PATCH',
      body: { name: 'X' },
    })
    expect(res.status).toBe(422)
  })

  it('PUT com papel inválido → 422', async () => {
    const res = await clients.admin.request(`/api/admin/brands/${brandId}/members/${target.id}`, {
      method: 'PUT',
      body: { role: 'dono' },
    })
    expect(res.status).toBe(422)
  })

  it('PUT grava o vínculo e DELETE o remove', async () => {
    const put = await clients.admin.request(`/api/admin/brands/${brandId}/members/${target.id}`, {
      method: 'PUT',
      body: { role: 'editor' },
    })
    expect(put.status).toBe(204)
    const member = await db.brandMember.findUnique({
      where: { brandId_userId: { brandId, userId: target.id } },
    })
    expect(member?.role).toBe('editor')

    const del = await clients.admin.request(`/api/admin/brands/${brandId}/members/${target.id}`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(204)
    const gone = await db.brandMember.findUnique({
      where: { brandId_userId: { brandId, userId: target.id } },
    })
    expect(gone).toBeNull()
  })

  it('usuário desativado com sessão ativa recebe 401 na próxima requisição', async () => {
    const victim = await createUser({
      prefix: 'desativado',
      memberships: [{ brandId, role: 'editor' }],
    })
    const session = await loggedIn(victim)
    expect((await session.request('/api/admin/users')).status).toBe(403)

    const res = await clients.admin.request(`/api/admin/users/${victim.id}`, {
      method: 'PATCH',
      body: { status: 'disabled' },
    })
    expect(res.status).toBe(204)

    expect((await session.request('/api/admin/users')).status).toBe(401)
    expect(session.cookie).toBeUndefined()
  })

  it('promoção a approver durante a sessão revoga o cookie (novo login exige 2FA)', async () => {
    const editor = await createUser({
      prefix: 'promovido',
      memberships: [{ brandId, role: 'editor' }],
    })
    const session = await loggedIn(editor)
    expect((await session.request('/api/admin/users')).status).toBe(403)

    const res = await clients.admin.request(`/api/admin/brands/${brandId}/members/${editor.id}`, {
      method: 'PUT',
      body: { role: 'approver' },
    })
    expect(res.status).toBe(204)
    expect((await session.request('/api/admin/users')).status).toBe(401)

    const relogin = await new Client().login(editor.email, editor.password)
    expect(relogin.body).toEqual({ stage: 'totp_enroll' })
  })

  it('promoção a admin global durante a sessão → 401, não 200', async () => {
    const editor = await createUser({
      prefix: 'promovido-admin',
      memberships: [{ brandId, role: 'editor' }],
    })
    const session = await loggedIn(editor)
    const res = await clients.admin.request(`/api/admin/users/${editor.id}`, {
      method: 'PATCH',
      body: { globalRole: 'admin' },
    })
    expect(res.status).toBe(204)
    expect((await session.request('/api/admin/users')).status).toBe(401)
  })

  it('desativar e reativar não revive o cookie antigo', async () => {
    const user = await createUser({
      prefix: 'reativado',
      memberships: [{ brandId, role: 'editor' }],
    })
    const old = await loggedIn(user)
    for (const status of ['disabled', 'active']) {
      const res = await clients.admin.request(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: { status },
      })
      expect(res.status).toBe(204)
    }
    expect((await old.request('/api/admin/users')).status).toBe(401)
    // Um novo login funciona normalmente.
    expect((await (await loggedIn(user)).request('/api/admin/users')).status).toBe(403)
  })
})

describe('GET /api/admin/brands', () => {
  it('lista marcas com id, name e slug', async () => {
    const res = await clients.admin.request('/api/admin/brands')
    expect(res.status).toBe(200)
    const brands = (res.body as { brands: Array<Record<string, unknown>> }).brands
    const found = brands.find((b) => b.id === brandId)
    expect(found).toBeDefined()
    expect(Object.keys(found!).sort()).toEqual(['id', 'name', 'slug'])
  })
})
