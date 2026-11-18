import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrganization, createUser, db, loggedIn, setupServer, Client } from './helpers'

const uid = () => randomUUID().replaceAll('-', '').slice(0, 12)

/** Páginas servidas pelo "Graph" falso. IDs únicos por execução. */
const pages = {
  withIg: { id: `pg${uid()}`, ig: `ig${uid()}` },
  noIg: { id: `pg${uid()}` },
  conflict: { id: `pg${uid()}`, ig: `ig${uid()}` },
}
const SECRETS = { page: 'PAGE_TOKEN_SECRET_VALUE', good: 'TOKEN_OK', bad: 'TOKEN_BAD' }
const seenProofs: Array<string | null> = []

let orgA: string
let orgB: string
const clients = {} as Record<'adminA' | 'adminB' | 'viewerA', Client>

function page(p: { id: string; ig?: string }) {
  return {
    id: p.id,
    name: `Página ${p.id}`,
    access_token: SECRETS.page,
    ...(p.ig ? { instagram_business_account: { id: p.ig, username: `user_${p.ig}` } } : {}),
  }
}

const graph: Server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  seenProofs.push(url.searchParams.get('appsecret_proof'))
  if (url.pathname !== '/v21.0/me/accounts') return send(404, {})
  const token = url.searchParams.get('access_token')
  if (token === SECRETS.bad) {
    return send(400, { error: { code: 190, type: 'OAuthException', message: 'x' } })
  }
  if (token !== SECRETS.good) return send(500, {})
  send(200, { data: [page(pages.withIg), page(pages.noIg), page(pages.conflict)] })
})
await new Promise<void>((r) => graph.listen(0, '127.0.0.1', r))
const { port } = graph.address() as AddressInfo
await setupServer({
  // O build do Nitro assume production; META_GRAPH_BASE_URL só vale fora dele.
  NODE_ENV: 'test',
  META_APP_ID: '1234',
  META_APP_SECRET: 'app-secret-de-teste',
  META_GRAPH_VERSION: 'v21.0',
  META_GRAPH_BASE_URL: `http://127.0.0.1:${port}`,
})

beforeAll(async () => {
  orgA = (await createOrganization()).id
  orgB = (await createOrganization()).id
  const [adminA, adminB, viewerA] = await Promise.all([
    createUser({
      prefix: 'metaa',
      memberships: [{ organizationId: orgA, role: 'admin' }],
      totp: true,
    }),
    createUser({
      prefix: 'metab',
      memberships: [{ organizationId: orgB, role: 'admin' }],
      totp: true,
    }),
    createUser({ prefix: 'metav', memberships: [{ organizationId: orgA, role: 'viewer' }] }),
  ])
  clients.adminA = await loggedIn(adminA)
  clients.adminB = await loggedIn(adminB)
  clients.viewerA = await loggedIn(viewerA)
})

afterAll(async () => {
  await new Promise((r) => graph.close(r))
  await db.$disconnect()
})

const discover = (c: Client, org: string, token: string) =>
  c.request(`/api/orgs/${org}/accounts/meta/discover`, { method: 'POST', body: { token } })
const connect = (c: Client, org: string, body: Record<string, unknown>) =>
  c.request(`/api/orgs/${org}/accounts/meta/connect`, { method: 'POST', body })

describe('conexão Meta', () => {
  it('discover lista Páginas sem expor access_token e envia appsecret_proof', async () => {
    const res = await discover(clients.adminA, orgA, SECRETS.good)
    expect(res.status).toBe(200)
    const body = res.body as { pages: Array<{ pageId: string; instagram: unknown }> }
    expect(body.pages.map((p) => p.pageId)).toContain(pages.withIg.id)
    expect(body.pages.find((p) => p.pageId === pages.noIg.id)?.instagram).toBeNull()
    expect(JSON.stringify(res.body)).not.toContain(SECRETS.page)
    expect(JSON.stringify(res.body)).not.toContain('access_token')
    expect(seenProofs.at(-1)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('connect cria 2 contas (FB + IG) com credencial cifrada', async () => {
    const res = await connect(clients.adminA, orgA, {
      token: SECRETS.good,
      pageId: pages.withIg.id,
    })
    expect(res.status).toBe(201)
    expect(JSON.stringify(res.body)).not.toContain(SECRETS.page)
    const rows = await db.socialAccount.findMany({
      where: { organizationId: orgA, externalId: { in: [pages.withIg.id, pages.withIg.ig] } },
    })
    expect(rows.map((r) => r.platform).sort()).toEqual(['facebook', 'instagram'])
    for (const r of rows) {
      expect(r.credentialEnc).toBeTruthy()
      expect(r.credentialEnc).not.toContain(SECRETS.page)
    }
    expect(rows.find((r) => r.platform === 'instagram')?.displayName).toBe(
      `@user_${pages.withIg.ig}`,
    )
  })

  it('Página sem IG: 422 sem confirmação; com confirmação cria só o Facebook', async () => {
    const denied = await connect(clients.adminA, orgA, {
      token: SECRETS.good,
      pageId: pages.noIg.id,
    })
    expect(denied.status).toBe(422)
    expect((denied.body as { message: string }).message).toBe(
      'Esta Página não tem Instagram vinculado. Confirme para vincular só o Facebook.',
    )
    expect(await db.socialAccount.count({ where: { externalId: pages.noIg.id } })).toBe(0)

    const ok = await connect(clients.adminA, orgA, {
      token: SECRETS.good,
      pageId: pages.noIg.id,
      includeFacebookWithoutInstagram: true,
    })
    expect(ok.status).toBe(201)
    expect(await db.socialAccount.count({ where: { externalId: pages.noIg.id } })).toBe(1)
  })

  it('IG já vinculado em outra organização → 409 e nenhuma conta (nem a do FB)', async () => {
    await db.socialAccount.create({
      data: {
        organizationId: orgB,
        platform: 'instagram',
        externalId: pages.conflict.ig,
        displayName: '@outro',
      },
    })
    const res = await connect(clients.adminA, orgA, {
      token: SECRETS.good,
      pageId: pages.conflict.id,
    })
    expect(res.status).toBe(409)
    expect(await db.socialAccount.count({ where: { externalId: pages.conflict.id } })).toBe(0)
    expect(
      await db.socialAccount.count({
        where: { externalId: pages.conflict.ig, organizationId: orgA },
      }),
    ).toBe(0)
  })

  it('token inválido → 422; Página desconhecida → 422', async () => {
    const bad = await discover(clients.adminA, orgA, SECRETS.bad)
    expect(bad.status).toBe(422)
    expect((bad.body as { message: string }).message).toBe('Token da Meta inválido ou expirado.')
    const badConnect = await connect(clients.adminA, orgA, { token: SECRETS.bad, pageId: 'x' })
    expect(badConnect.status).toBe(422)
    const unknown = await connect(clients.adminA, orgA, { token: SECRETS.good, pageId: 'nope' })
    expect(unknown.status).toBe(422)
  })

  it('falha da Meta (5xx) → 502', async () => {
    const res = await discover(clients.adminA, orgA, 'TOKEN_QUALQUER')
    expect(res.status).toBe(502)
    expect((res.body as { message: string }).message).toBe('A Meta não respondeu. Tente de novo.')
  })

  it('autorização: viewer 403; outra organização 404; sem sessão 401', async () => {
    expect((await discover(clients.viewerA, orgA, SECRETS.good)).status).toBe(403)
    const viewerConnect = await connect(clients.viewerA, orgA, {
      token: SECRETS.good,
      pageId: pages.withIg.id,
    })
    expect(viewerConnect.status).toBe(403)
    expect((await discover(clients.adminB, orgA, SECRETS.good)).status).toBe(404)
    expect((await discover(new Client(), orgA, SECRETS.good)).status).toBe(401)
  })

  it('corpo inválido → 422', async () => {
    const res = await clients.adminA.request(`/api/orgs/${orgA}/accounts/meta/discover`, {
      method: 'POST',
      body: {},
    })
    expect(res.status).toBe(422)
  })
})
