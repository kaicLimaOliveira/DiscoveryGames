import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrganization, createUser, db, loggedIn, setupServer, Client } from './helpers'

const uid = () => randomUUID().replaceAll('-', '').slice(0, 12)

const SECRETS = { refresh: 'REFRESH_TOKEN_SECRET', access: 'ACCESS_TOKEN_SECRET' }
const channels = {
  ok: `UC${uid()}`,
  conflict: `UC${uid()}`,
  perm: `UC${uid()}`,
  scope: `UC${uid()}`,
}
const revoked: string[] = []

/** `code` → canal devolvido pelo "Google" falso. */
const codeToChannel: Record<string, string> = {
  code_ok: channels.ok,
  code_conflict: channels.conflict,
  code_perm: channels.perm,
  code_scope: channels.scope,
}

const google: Server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  let raw = ''
  req.on('data', (c: Buffer) => (raw += c.toString()))
  req.on('end', () => {
    const form = new URLSearchParams(raw)
    if (url.pathname === '/token') {
      const code = form.get('code') ?? ''
      if (code === 'code_norefresh') return send(200, { access_token: SECRETS.access, scope: 'x' })
      if (!codeToChannel[code]) return send(400, { error: 'invalid_grant' })
      if (code === 'code_scope') {
        return send(200, {
          access_token: `${SECRETS.access}:${codeToChannel[code]}`,
          refresh_token: SECRETS.refresh,
          scope: 'https://www.googleapis.com/auth/youtube.readonly',
        })
      }
      return send(200, {
        access_token: `${SECRETS.access}:${codeToChannel[code]}`,
        refresh_token: SECRETS.refresh,
        scope:
          'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      })
    }
    if (url.pathname === '/revoke') {
      revoked.push(form.get('token') ?? '')
      return send(200, {})
    }
    if (url.pathname === '/youtube/v3/channels') {
      const id = (req.headers.authorization ?? '').split(':')[1]
      return send(200, { items: id ? [{ id, snippet: { title: `Canal ${id}` } }] : [] })
    }
    send(404, {})
  })
})
await new Promise<void>((r) => google.listen(0, '127.0.0.1', r))
const { port } = google.address() as AddressInfo
await setupServer({
  // O build do Nitro assume production; as URLs base só valem com NODE_ENV=test.
  NODE_ENV: 'test',
  GOOGLE_OAUTH_CLIENT_ID: 'client-id-de-teste',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret-de-teste',
  GOOGLE_OAUTH_BASE_URL: `http://127.0.0.1:${port}`,
  YOUTUBE_API_BASE_URL: `http://127.0.0.1:${port}`,
})

let orgA: string
let orgB: string
const clients = {} as Record<'adminA' | 'adminB' | 'viewerA', Client>

beforeAll(async () => {
  orgA = (await createOrganization()).id
  orgB = (await createOrganization()).id
  const [adminA, adminB, viewerA] = await Promise.all([
    createUser({
      prefix: 'yta',
      memberships: [{ organizationId: orgA, role: 'admin' }],
      totp: true,
    }),
    createUser({
      prefix: 'ytb',
      memberships: [{ organizationId: orgB, role: 'admin' }],
      totp: true,
    }),
    createUser({ prefix: 'ytv', memberships: [{ organizationId: orgA, role: 'viewer' }] }),
  ])
  clients.adminA = await loggedIn(adminA)
  clients.adminB = await loggedIn(adminB)
  clients.viewerA = await loggedIn(viewerA)
})

afterAll(async () => {
  await new Promise((r) => google.close(r))
  await db.$disconnect()
})

const start = (c: Client, org: string) => c.request(`/api/orgs/${org}/accounts/youtube/start`)
const callback = (c: Client, query: Record<string, string>) =>
  c.request(`/api/oauth/youtube/callback?${new URLSearchParams(query)}`)
const location = (r: { headers: Headers }) => r.headers.get('location') ?? ''
const errorOf = (loc: string) => new URL(loc, 'http://x').searchParams.get('error') ?? undefined

async function begin(c: Client, org: string): Promise<string> {
  const res = await start(c, org)
  expect(res.status).toBe(302)
  return new URL(location(res)).searchParams.get('state')!
}

describe('conexão YouTube', () => {
  it('start redireciona ao Google com state e code_challenge e grava o state', async () => {
    const res = await start(clients.adminA, orgA)
    expect(res.status).toBe(302)
    const url = new URL(location(res))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const state = url.searchParams.get('state')!
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/oauth\/youtube\/callback$/)
    const row = await db.oAuthState.findUnique({ where: { id: state } })
    expect(row?.organizationId).toBe(orgA)
    expect(row?.provider).toBe('youtube')
  })

  it('start: viewer 403, outra organização 404, sem sessão 401', async () => {
    expect((await start(clients.viewerA, orgA)).status).toBe(403)
    expect((await start(clients.adminB, orgA)).status).toBe(404)
    expect((await start(new Client(), orgA)).status).toBe(401)
  })

  it('callback feliz cria a conta com credencial cifrada e redireciona', async () => {
    const state = await begin(clients.adminA, orgA)
    const res = await callback(clients.adminA, { code: 'code_ok', state })
    expect(res.status).toBe(302)
    expect(location(res)).toBe(`/orgs/${orgA}/accounts?connected=youtube`)
    const row = await db.socialAccount.findFirstOrThrow({
      where: { platform: 'youtube', externalId: channels.ok },
    })
    expect(row.organizationId).toBe(orgA)
    expect(row.displayName).toBe(`Canal ${channels.ok}`)
    expect(row.credentialEnc).toBeTruthy()
    expect(row.credentialEnc).not.toContain(SECRETS.refresh)
    expect(row.scopes).toEqual([
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ])
    expect(await db.oAuthState.count({ where: { id: state } })).toBe(0)
  })

  it('state reutilizado redireciona com erro e não cria segunda conta', async () => {
    const state = await begin(clients.adminA, orgA)
    await callback(clients.adminA, { code: 'code_ok', state })
    const again = await callback(clients.adminA, { code: 'code_ok', state })
    expect(again.status).toBe(302)
    expect(location(again).startsWith('/orgs?error=')).toBe(true)
    expect(errorOf(location(again))).toBe(
      'Autorização expirada ou inválida. Tente conectar de novo.',
    )
    expect(await db.socialAccount.count({ where: { externalId: channels.ok } })).toBe(1)
  })

  it('error=access_denied redireciona com mensagem fixa e não cria nada', async () => {
    const before = await db.socialAccount.count({ where: { organizationId: orgA } })
    const state = await begin(clients.adminA, orgA)
    const res = await callback(clients.adminA, { error: 'access_denied', state })
    expect(res.status).toBe(302)
    expect(location(res).startsWith(`/orgs/${orgA}/accounts?error=`)).toBe(true)
    expect(errorOf(location(res))).toBe('Você não autorizou o acesso no Google.')
    expect(location(res)).not.toContain(state)
    expect(await db.socialAccount.count({ where: { organizationId: orgA } })).toBe(before)
    expect(await db.oAuthState.count({ where: { id: state } })).toBe(0)
  })

  it('state criado por outro usuário redireciona com erro', async () => {
    const state = await begin(clients.adminA, orgA)
    const res = await callback(clients.adminB, { code: 'code_ok', state })
    expect(res.status).toBe(302)
    expect(location(res).startsWith('/orgs?error=')).toBe(true)
    expect(location(res)).not.toContain(state)
  })

  it('callback sem state redireciona com erro', async () => {
    const res = await callback(clients.adminA, { code: 'code_ok' })
    expect(res.status).toBe(302)
    expect(location(res).startsWith('/orgs?error=')).toBe(true)
  })

  it('canal já vinculado em outra organização redireciona com o conflito', async () => {
    await db.socialAccount.create({
      data: {
        organizationId: orgB,
        platform: 'youtube',
        externalId: channels.conflict,
        displayName: 'outro',
      },
    })
    const state = await begin(clients.adminA, orgA)
    const res = await callback(clients.adminA, { code: 'code_conflict', state })
    expect(res.status).toBe(302)
    expect(location(res).startsWith(`/orgs/${orgA}/accounts?error=`)).toBe(true)
    expect(errorOf(location(res))).toBe('Esta conta já está vinculada a outra organização.')
    expect(
      await db.socialAccount.count({
        where: { externalId: channels.conflict, organizationId: orgA },
      }),
    ).toBe(0)
  })

  it('falha no Google (code inválido ou sem refresh_token) não grava e não ecoa o code', async () => {
    for (const code of ['code_invalido_SEGREDO', 'code_norefresh']) {
      const state = await begin(clients.adminA, orgA)
      const res = await callback(clients.adminA, { code, state })
      expect(res.status).toBe(302)
      expect(location(res).startsWith(`/orgs/${orgA}/accounts?error=`)).toBe(true)
      expect(location(res)).not.toContain('SEGREDO')
      expect(location(res)).not.toContain(state)
    }
  })

  it('callback sem sessão redireciona ao login sem ecoar code nem state', async () => {
    const state = await begin(clients.adminA, orgA)
    const res = await callback(new Client(), { code: 'CODE_SEGREDO', state })
    expect(res.status).toBe(302)
    expect(location(res).startsWith('/login?error=')).toBe(true)
    expect(errorOf(location(res))).toBe('Sua sessão expirou. Entre e conecte o YouTube de novo.')
    expect(location(res)).not.toContain(state)
    expect(location(res)).not.toContain('CODE_SEGREDO')
    expect(JSON.stringify(res.body)).not.toContain(state)
    expect(JSON.stringify(res.body)).not.toContain('CODE_SEGREDO')
  })

  it('erro inesperado (500) no callback também redireciona sem ecoar', async () => {
    // NUL no state faz o Postgres rejeitar a consulta: erro não tratado dentro da rota.
    const res = await callback(clients.adminA, { code: 'CODE_SEGREDO', state: 'a SEGREDO_STATE' })
    expect(res.status).toBe(302)
    expect(location(res).startsWith('/orgs?error=')).toBe(true)
    expect(location(res)).not.toContain('SEGREDO')
    expect(JSON.stringify(res.body ?? '')).not.toContain('SEGREDO')
  })

  it('corpo de erro de /api/** não ecoa a query', async () => {
    const res = await clients.adminA.request('/api/nao-existe?secret=VALOR_SECRETO')
    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body)).not.toContain('VALOR_SECRETO')
    const anon = await new Client().request('/api/orgs?secret=VALOR_SECRETO')
    expect(anon.status).toBe(401)
    expect(JSON.stringify(anon.body)).not.toContain('VALOR_SECRETO')
  })

  it('conflito e escopo faltando revogam a concessão e não gravam', async () => {
    const before = revoked.length
    const state = await begin(clients.adminA, orgA)
    // channels.conflict já está vinculado em outra organização (teste anterior).
    await callback(clients.adminA, { code: 'code_conflict', state })
    expect(revoked.length).toBe(before + 1)
    expect(revoked.at(-1)).toBe(SECRETS.refresh)

    const s2 = await begin(clients.adminA, orgA)
    const res = await callback(clients.adminA, { code: 'code_scope', state: s2 })
    expect(errorOf(location(res))).toBe(
      'Autorize todas as permissões pedidas (envio e leitura do YouTube) para conectar o canal.',
    )
    expect(revoked.length).toBe(before + 2)
    expect(await db.socialAccount.count({ where: { externalId: channels.scope } })).toBe(0)
  })

  it('callback re-confere accounts.manage: perdeu a permissão depois do start', async () => {
    // State de um viewer (sem accounts.manage), como se a permissão tivesse sido perdida.
    const viewer = await db.user.findFirstOrThrow({
      where: { memberships: { some: { organizationId: orgA, role: 'viewer' } } },
    })
    const state = `perm_${uid()}`
    await db.oAuthState.create({
      data: {
        id: state,
        provider: 'youtube',
        organizationId: orgA,
        userId: viewer.id,
        codeVerifier: 'v'.repeat(43),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    const res = await callback(clients.viewerA, { code: 'code_perm', state })
    expect(res.status).toBe(302)
    expect(location(res).startsWith(`/orgs/${orgA}/accounts?error=`)).toBe(true)
    expect(errorOf(location(res))).toBe('Você não tem permissão para esta ação.')
    expect(await db.socialAccount.count({ where: { externalId: channels.perm } })).toBe(0)
  })

  it('DELETE de conta do YouTube revoga o refresh token no Google', async () => {
    const account = await db.socialAccount.findFirstOrThrow({
      where: { platform: 'youtube', externalId: channels.ok },
    })
    const before = revoked.length
    const res = await clients.adminA.request(`/api/orgs/${orgA}/accounts/${account.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
    expect(revoked.length).toBe(before + 1)
    expect(revoked.at(-1)).toBe(SECRETS.refresh)
    expect(await db.socialAccount.count({ where: { id: account.id } })).toBe(0)
  })
})
