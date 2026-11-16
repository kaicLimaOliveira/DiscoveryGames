import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Client,
  PASSWORD,
  createBrand,
  createUser,
  db,
  loggedIn,
  nextTotpCode,
  setupServer,
  uniqueEmail,
  uniqueIp,
  type TestUser,
} from './helpers'
import { Secret, TOTP } from 'otpauth'

await setupServer()

let brandId: string
let editor: TestUser
let approver: TestUser
let admin: TestUser

beforeAll(async () => {
  brandId = (await createBrand()).id
  editor = await createUser({ prefix: 'editor', memberships: [{ brandId, role: 'editor' }] })
  approver = await createUser({
    prefix: 'approver',
    memberships: [{ brandId, role: 'approver' }],
    totp: true,
  })
  admin = await createUser({ prefix: 'admin', role: 'admin', totp: true })
})

afterAll(async () => {
  await db.$disconnect()
})

describe('login', () => {
  it('editor entra com stage full', async () => {
    const client = new Client()
    const res = await client.login(editor.email, editor.password)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ stage: 'full' })
    expect(client.cookie).toBeTruthy()
  })

  it('senha errada → 401 com mensagem genérica', async () => {
    const res = await new Client().login(editor.email, 'senha-errada-qualquer')
    expect(res.status).toBe(401)
    expect((res.body as { message: string }).message).toBe('E-mail ou senha inválidos')
  })

  it('e-mail inexistente → mesma resposta 401', async () => {
    const res = await new Client().login(uniqueEmail('ninguem'), PASSWORD)
    expect(res.status).toBe(401)
    expect((res.body as { message: string }).message).toBe('E-mail ou senha inválidos')
  })

  it('corpo inválido → 422', async () => {
    const res = await new Client().request('/api/auth/login', {
      method: 'POST',
      body: { email: 123 },
      ip: uniqueIp(),
    })
    expect(res.status).toBe(422)
  })

  it('seis falhas → 429 com Retry-After', async () => {
    const ip = uniqueIp()
    const email = uniqueEmail('alvo')
    const client = new Client()
    for (let i = 0; i < 5; i++) {
      const res = await client.login(email, 'senha-errada-qualquer', ip)
      expect(res.status).toBe(401)
    }
    const blocked = await client.login(email, 'senha-errada-qualquer', ip)
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('POST com Origin de outro site → 403', async () => {
    const res = await new Client().request('/api/auth/login', {
      method: 'POST',
      body: { email: editor.email, password: editor.password },
      origin: 'https://evil.example',
    })
    expect(res.status).toBe(403)
  })

  it('POST sem Origin → 403', async () => {
    const res = await new Client().request('/api/auth/login', {
      method: 'POST',
      body: { email: editor.email, password: editor.password },
      origin: null,
    })
    expect(res.status).toBe(403)
  })
})

describe('segundo fator', () => {
  it('approver em totp_pending não acessa a API; após verify segue a matriz normal', async () => {
    const client = new Client()
    const res = await client.login(approver.email, approver.password)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ stage: 'totp_pending' })

    const pending = await client.request('/api/admin/users')
    expect([401, 403]).toContain(pending.status)

    const bad = await client.request('/api/auth/totp/verify', {
      method: 'POST',
      body: { code: '000000' },
    })
    expect(bad.status).toBe(400)

    const code = await nextTotpCode(approver.id, approver.totpSecret!)
    const ok = await client.request('/api/auth/totp/verify', { method: 'POST', body: { code } })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ stage: 'full' })

    // approver não é admin global: matriz normal → 403 (não 401).
    const after = await client.request('/api/admin/users')
    expect(after.status).toBe(403)
  })

  it('admin em totp_pending recebe 403; após verify acessa /api/admin/users', async () => {
    const client = new Client()
    const res = await client.login(admin.email, admin.password)
    expect(res.body).toEqual({ stage: 'totp_pending' })
    expect((await client.request('/api/admin/users')).status).toBe(403)

    const code = await nextTotpCode(admin.id, admin.totpSecret!)
    const ok = await client.request('/api/auth/totp/verify', { method: 'POST', body: { code } })
    expect(ok.status).toBe(200)
    expect((await client.request('/api/admin/users')).status).toBe(200)
  })

  it('totp/verify só é aceito em totp_pending', async () => {
    const client = await loggedIn(editor)
    const res = await client.request('/api/auth/totp/verify', {
      method: 'POST',
      body: { code: '123456' },
    })
    expect(res.status).toBe(403)
  })

  it('admin sem 2FA: totp_enroll → enroll-start → enroll-confirm → full', async () => {
    const fresh = await createUser({ prefix: 'admin-novo', role: 'admin' })
    const client = new Client()
    const res = await client.login(fresh.email, fresh.password)
    expect(res.body).toEqual({ stage: 'totp_enroll' })
    expect((await client.request('/api/admin/users')).status).toBe(403)

    const start = await client.request('/api/auth/totp/enroll-start', { method: 'POST' })
    expect(start.status).toBe(200)
    const uri = (start.body as { uri: string }).uri
    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    expect(Object.keys(start.body as object)).toEqual(['uri'])

    // O segredo pendente fica só em `secure` (servidor), nunca na sessão pública.
    const session = await client.request('/api/_auth/session')
    expect(JSON.stringify(session.body)).not.toContain('pendingTotpSecret')
    expect(JSON.stringify(session.body)).not.toContain('secure')

    const secret = new URL(uri).searchParams.get('secret')!
    const totp = new TOTP({
      secret: Secret.fromBase32(secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    })
    const wrong = await client.request('/api/auth/totp/enroll-confirm', {
      method: 'POST',
      body: { code: totp.generate() === '000000' ? '111111' : '000000' },
    })
    expect(wrong.status).toBe(400)

    const confirm = await client.request('/api/auth/totp/enroll-confirm', {
      method: 'POST',
      body: { code: totp.generate() },
    })
    expect(confirm.status).toBe(200)
    expect(confirm.body).toEqual({ stage: 'full' })
    expect((await client.request('/api/admin/users')).status).toBe(200)
  })

  it('enroll-start não é aceito em totp_pending', async () => {
    const client = new Client()
    await client.login(approver.email, approver.password)
    const res = await client.request('/api/auth/totp/enroll-start', { method: 'POST' })
    expect(res.status).toBe(403)
  })
})

describe('sessão', () => {
  it('sem cookie → 401', async () => {
    expect((await new Client().request('/api/admin/users')).status).toBe(401)
  })

  it('logout invalida a sessão', async () => {
    const client = await loggedIn(editor)
    const res = await client.request('/api/auth/logout', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(client.cookie).toBeUndefined()
    expect((await client.request('/api/admin/users')).status).toBe(401)
  })

  it('regravar a sessão renova a expiração de 12 h (base das 12 h deslizantes)', async () => {
    const client = new Client()
    await client.login(admin.email, admin.password)
    const firstExpiry = client.cookieExpires()
    expect(firstExpiry - Date.now()).toBeGreaterThan(11.9 * 3600_000)
    await new Promise((r) => setTimeout(r, 2_100))
    const code = await nextTotpCode(admin.id, admin.totpSecret!)
    await client.request('/api/auth/totp/verify', { method: 'POST', body: { code } })
    expect(client.cookieExpires() - firstExpiry).toBeGreaterThanOrEqual(2_000)
  })

  it('troca de senha: a sessão A continua e a sessão B passa a receber 401', async () => {
    const user = await createUser({ prefix: 'troca', memberships: [{ brandId, role: 'editor' }] })
    const a = await loggedIn(user)
    const b = await loggedIn(user)
    expect((await b.request('/api/admin/users')).status).toBe(403)

    const wrong = await a.request('/api/auth/password', {
      method: 'POST',
      body: { current: 'senha-errada-qualquer', next: 'nova-senha-muito-forte' },
    })
    expect(wrong.status).toBe(401)

    const short = await a.request('/api/auth/password', {
      method: 'POST',
      body: { current: user.password, next: 'curta' },
    })
    expect(short.status).toBe(422)

    const res = await a.request('/api/auth/password', {
      method: 'POST',
      body: { current: user.password, next: 'nova-senha-muito-forte' },
    })
    expect(res.status).toBe(200)

    expect((await a.request('/api/admin/users')).status).toBe(403)
    expect((await b.request('/api/admin/users')).status).toBe(401)
  })
})

describe('cabeçalhos', () => {
  it('respostas trazem cabeçalhos de segurança e x-request-id', async () => {
    const res = await new Client().request('/api/admin/users')
    expect(res.status).toBe(401)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('strict-transport-security')).toContain('max-age=')
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('x-request-id recebido é devolvido', async () => {
    const res = await new Client().request('/api/health', {
      headers: { 'x-request-id': 'req-teste-123' },
    })
    expect(res.headers.get('x-request-id')).toBe('req-teste-123')
  })
})
