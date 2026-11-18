import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrganization, createUser, db, loggedIn, setupServer, type Client } from './helpers'

// Sem YTDLP_ENABLED: o envio por link fica desligado.
await setupServer()

let orgId: string
let editor: Client

beforeAll(async () => {
  orgId = (await createOrganization()).id
  editor = await loggedIn(
    await createUser({
      prefix: 'nolink',
      memberships: [{ organizationId: orgId, role: 'editor' }],
    }),
  )
})

afterAll(async () => {
  await db.$disconnect()
})

describe('link desligado', () => {
  it('link com YTDLP desligado responde 422 e GET /api/config esconde o link', async () => {
    const res = await editor.request(`/api/orgs/${orgId}/sources/link`, {
      method: 'POST',
      body: {
        title: 'Link',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        rights: { basis: 'own', accepted: true },
      },
    })
    expect(res.status).toBe(422)
    expect(await db.source.count({ where: { organizationId: orgId } })).toBe(0)
    const cfg = await editor.request('/api/config')
    expect(cfg.body).toEqual({ linkUploadEnabled: false })
  })

  it('GET /api/config exige sessão', async () => {
    const anon = await new (editor.constructor as new () => Client)().request('/api/config')
    expect(anon.status).toBe(401)
  })
})
