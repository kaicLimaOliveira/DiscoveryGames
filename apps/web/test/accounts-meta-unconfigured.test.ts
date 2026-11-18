import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrganization, createUser, db, loggedIn, setupServer, type Client } from './helpers'

await setupServer()

let orgId: string
let admin: Client

beforeAll(async () => {
  orgId = (await createOrganization()).id
  admin = await loggedIn(
    await createUser({
      prefix: 'nometa',
      memberships: [{ organizationId: orgId, role: 'admin' }],
      totp: true,
    }),
  )
})

afterAll(async () => {
  await db.$disconnect()
})

describe('Meta não configurada', () => {
  it('discover e connect respondem 503', async () => {
    for (const [path, body] of [
      ['discover', { token: 't' }],
      ['connect', { token: 't', pageId: 'p' }],
    ] as const) {
      const res = await admin.request(`/api/orgs/${orgId}/accounts/meta/${path}`, {
        method: 'POST',
        body,
      })
      expect(res.status).toBe(503)
      expect((res.body as { message: string }).message).toBe(
        'Integração com a Meta não configurada.',
      )
    }
  })

  it('youtube/start redireciona ao /accounts com mensagem fixa (503 não vira JSON cru)', async () => {
    const res = await admin.request(`/api/orgs/${orgId}/accounts/youtube/start`)
    expect(res.status).toBe(302)
    const loc = res.headers.get('location') ?? ''
    expect(loc.startsWith(`/orgs/${orgId}/accounts?error=`)).toBe(true)
    expect(new URL(loc, 'http://x').searchParams.get('error')).toBe(
      'Integração com o Google não configurada.',
    )
  })
})
