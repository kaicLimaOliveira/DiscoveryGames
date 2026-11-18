import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createOrganization,
  createUser,
  db,
  env,
  loggedIn,
  setupServer,
  type ApiResponse,
  type Client,
} from './helpers'

// O link do YouTube fica ligado aqui; o caso "desligado" está em sources-link-disabled.test.ts.
await setupServer({ YTDLP_ENABLED: 'true' })

let orgA: string
let orgB: string
const clients = {} as Record<'viewerA' | 'editorA' | 'approverA' | 'adminA' | 'editorB', Client>
/** Corpo bruto de toda resposta do arquivo, para varrer vazamento de segredo. */
const seen: string[] = []

async function call(
  client: Client,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<ApiResponse> {
  const res = await client.request(path, opts)
  seen.push(JSON.stringify(res.body))
  return res
}

const OWN = { basis: 'own', accepted: true } as const

async function createSource(client: Client, org: string, sizeBytes = 1024) {
  const res = await call(client, `/api/orgs/${org}/sources`, {
    method: 'POST',
    body: {
      title: 'Live de teste',
      fileName: 'live.mp4',
      sizeBytes,
      contentType: 'video/mp4',
      rights: OWN,
    },
  })
  return res
}

async function seedCandidate(organizationId: string, sourceId: string) {
  return db.clipCandidate.create({
    data: {
      organizationId,
      sourceId,
      rank: 1,
      startMs: 0,
      endMs: 30_000,
      suggestedStartMs: 0,
      suggestedEndMs: 30_000,
      hookScore: 80,
      reason: 'Gancho forte.',
      title: 'Corte',
      captions: {},
      hashtags: [],
      layout: 'center',
    },
  })
}

async function seedSource(organizationId: string) {
  const asset = await db.mediaAsset.create({
    data: {
      organizationId,
      kind: 'original',
      storageKey: `orgs/${organizationId}/sources/${randomUUID()}/original.mp4`,
      sha256: randomBytes(32).toString('hex'),
      sizeBytes: 1024n,
      mimeType: 'video/mp4',
      probe: {},
      durationMs: 120_000,
      hasAudio: true,
    },
  })
  return db.source.create({
    data: {
      organizationId,
      mediaAssetId: asset.id,
      kind: 'upload',
      title: 'Fonte semeada',
      status: 'ready',
      rightsBasis: 'own',
      params: { targetMin: 5, targetMax: 10, minSec: 30, maxSec: 90, language: 'pt-BR' },
    },
  })
}

beforeAll(async () => {
  orgA = (await createOrganization()).id
  orgB = (await createOrganization()).id
  const [viewerA, editorA, approverA, adminA, editorB] = await Promise.all([
    createUser({ prefix: 'viewer', memberships: [{ organizationId: orgA, role: 'viewer' }] }),
    createUser({ prefix: 'editor', memberships: [{ organizationId: orgA, role: 'editor' }] }),
    createUser({
      prefix: 'approver',
      memberships: [{ organizationId: orgA, role: 'approver' }],
      totp: true,
    }),
    createUser({
      prefix: 'admin',
      memberships: [{ organizationId: orgA, role: 'admin' }],
      totp: true,
    }),
    createUser({ prefix: 'editorb', memberships: [{ organizationId: orgB, role: 'editor' }] }),
  ])
  clients.viewerA = await loggedIn(viewerA)
  clients.editorA = await loggedIn(editorA)
  clients.approverA = await loggedIn(approverA)
  clients.adminA = await loggedIn(adminA)
  clients.editorB = await loggedIn(editorB)
})

afterAll(async () => {
  await db.$disconnect()
})

describe('fontes: upload multipart', () => {
  it('editor cria fonte, envia as partes pelas URLs devolvidas, completa e vê status queued', async () => {
    const created = await createSource(clients.editorA, orgA)
    expect(created.status).toBe(201)
    const { source, partSize, partCount } = created.body as {
      source: { id: string; status: string }
      partSize: number
      partCount: number
    }
    expect(source.status).toBe('awaiting_upload')
    expect(partCount).toBe(1)
    expect(partSize).toBeGreaterThan(0)

    // Com o tamanho padrão de parte (64 MiB) só dá para exercitar 1 parte sem enviar 64 MiB.
    const presigned = await call(clients.editorA, `/api/orgs/${orgA}/sources/${source.id}/parts`, {
      method: 'POST',
      body: { partNumbers: [1] },
    })
    expect(presigned.status).toBe(200)
    const [part] = (presigned.body as { parts: Array<{ partNumber: number; url: string }> }).parts
    const put = await fetch(part!.url, { method: 'PUT', body: randomBytes(1024) })
    expect(put.status).toBe(200)
    const etag = put.headers.get('etag')!
    expect(etag).toBeTruthy()

    const done = await call(clients.editorA, `/api/orgs/${orgA}/sources/${source.id}/complete`, {
      method: 'POST',
      body: { parts: [{ partNumber: 1, etag }] },
    })
    expect(done.status).toBe(200)
    expect((done.body as { status: string }).status).toBe('queued')

    const got = await call(clients.editorA, `/api/orgs/${orgA}/sources/${source.id}`)
    expect(got.status).toBe(200)
    expect((got.body as { status: string }).status).toBe('queued')
    const list = await call(clients.viewerA, `/api/orgs/${orgA}/sources`)
    expect(list.status).toBe(200)
    expect((list.body as { sources: Array<{ id: string }> }).sources.map((s) => s.id)).toContain(
      source.id,
    )
  })

  it('DELETE abandona um envio não concluído (204)', async () => {
    const created = await createSource(clients.editorA, orgA)
    const id = (created.body as { source: { id: string } }).source.id
    const res = await call(clients.editorA, `/api/orgs/${orgA}/sources/${id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
    expect(await db.source.count({ where: { id } })).toBe(0)
  })

  it('evidence-upload devolve chave e URL; tipo inválido responde 422', async () => {
    const ok = await call(clients.editorA, `/api/orgs/${orgA}/evidence-upload`, {
      method: 'POST',
      body: { contentType: 'application/pdf' },
    })
    expect(ok.status).toBe(200)
    expect((ok.body as { key: string }).key).toContain(`orgs/${orgA}/evidence/`)
    const bad = await call(clients.editorA, `/api/orgs/${orgA}/evidence-upload`, {
      method: 'POST',
      body: { contentType: 'text/html' },
    })
    expect(bad.status).toBe(422)
  })
})

describe('fontes: link', () => {
  it('fonte com rights none por link responde 422 e nenhuma fonte é criada', async () => {
    const before = await db.source.count({ where: { organizationId: orgA } })
    const res = await call(clients.editorA, `/api/orgs/${orgA}/sources/link`, {
      method: 'POST',
      body: {
        title: 'Link sem direitos',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        rights: { basis: 'none' },
      },
    })
    expect(res.status).toBe(422)
    expect(JSON.stringify(res.body)).toContain('Link sem direitos')
    expect(await db.source.count({ where: { organizationId: orgA } })).toBe(before)
  })

  it('link com direitos e YTDLP ligado cria a fonte (201) e GET /api/config informa o link', async () => {
    const res = await call(clients.editorA, `/api/orgs/${orgA}/sources/link`, {
      method: 'POST',
      body: {
        title: 'Link próprio',
        url: 'https://youtu.be/dQw4w9WgXcQ',
        rights: OWN,
      },
    })
    expect(res.status).toBe(201)
    expect((res.body as { status: string }).status).toBe('queued')
    const cfg = await call(clients.viewerA, '/api/config')
    expect(cfg.body).toEqual({ linkUploadEnabled: true })
  })
})

describe('candidatos', () => {
  it('viewer lista e vê candidatos, mas decision responde 403', async () => {
    const source = await seedSource(orgA)
    const candidate = await seedCandidate(orgA, source.id)
    const list = await call(clients.viewerA, `/api/orgs/${orgA}/sources/${source.id}/candidates`)
    expect(list.status).toBe(200)
    expect((list.body as { candidates: Array<{ id: string }> }).candidates[0]!.id).toBe(
      candidate.id,
    )
    const decision = await call(
      clients.viewerA,
      `/api/orgs/${orgA}/candidates/${candidate.id}/decision`,
      { method: 'POST', body: { decision: 'accept' } },
    )
    expect(decision.status).toBe(403)
  })

  it('editor aceita um candidato (200)', async () => {
    const source = await seedSource(orgA)
    const candidate = await seedCandidate(orgA, source.id)
    const res = await call(
      clients.editorA,
      `/api/orgs/${orgA}/candidates/${candidate.id}/decision`,
      { method: 'POST', body: { decision: 'accept' } },
    )
    expect(res.status).toBe(200)
    expect((res.body as { status: string }).status).toBe('accepted')
  })

  it('membro da org A recebe 404 em GET, rights, decision e PATCH de candidato da org B', async () => {
    const sourceB = await seedSource(orgB)
    const candidateB = await seedCandidate(orgB, sourceB.id)
    const c = clients.approverA
    const results = await Promise.all([
      call(c, `/api/orgs/${orgA}/sources/${sourceB.id}`),
      call(c, `/api/orgs/${orgA}/sources/${sourceB.id}/candidates`),
      call(c, `/api/orgs/${orgA}/sources/${sourceB.id}/rights`, {
        method: 'PUT',
        body: OWN,
      }),
      call(c, `/api/orgs/${orgA}/candidates/${candidateB.id}/decision`, {
        method: 'POST',
        body: { decision: 'reject' },
      }),
      call(c, `/api/orgs/${orgA}/candidates/${candidateB.id}`, {
        method: 'PATCH',
        body: { startMs: 0, endMs: 20_000 },
      }),
      // E pela URL da org B: não é membro, também 404.
      call(c, `/api/orgs/${orgB}/sources/${sourceB.id}`),
    ])
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404])
    const after = await db.clipCandidate.findUniqueOrThrow({ where: { id: candidateB.id } })
    expect(after.status).toBe('suggested')
    expect(after.endMs).toBe(30_000)
  })

  it('PATCH de candidato com 2 s responde 422 com mensagem', async () => {
    const source = await seedSource(orgA)
    const candidate = await seedCandidate(orgA, source.id)
    const res = await call(clients.editorA, `/api/orgs/${orgA}/candidates/${candidate.id}`, {
      method: 'PATCH',
      body: { startMs: 0, endMs: 2000 },
    })
    expect(res.status).toBe(422)
    expect((res.body as { message: string }).message).toMatch(/\S/)
  })

  it('PATCH válido ajusta início e fim (200)', async () => {
    const source = await seedSource(orgA)
    const candidate = await seedCandidate(orgA, source.id)
    const res = await call(clients.editorA, `/api/orgs/${orgA}/candidates/${candidate.id}`, {
      method: 'PATCH',
      body: { startMs: 1000, endMs: 25_000 },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ startMs: 1000, endMs: 25_000 })
  })
})

describe('direitos', () => {
  it('rights.put por editor 403; por aprovador 200 com histórico de 2 declarações', async () => {
    const created = await createSource(clients.editorA, orgA)
    const id = (created.body as { source: { id: string } }).source.id
    const licensed = {
      basis: 'cc_license',
      sourceUrl: 'https://example.com/video',
      licenseType: 'CC BY 4.0',
    }
    const denied = await call(clients.editorA, `/api/orgs/${orgA}/sources/${id}/rights`, {
      method: 'PUT',
      body: licensed,
    })
    expect(denied.status).toBe(403)
    const ok = await call(clients.approverA, `/api/orgs/${orgA}/sources/${id}/rights`, {
      method: 'PUT',
      body: licensed,
    })
    expect(ok.status).toBe(200)
    const body = ok.body as { rightsBasis: string; rightsHistory: Array<{ basis: string }> }
    expect(body.rightsBasis).toBe('cc_license')
    expect(body.rightsHistory.map((h) => h.basis)).toEqual(['cc_license', 'own'])
  })
})

describe('criadores parceiros', () => {
  it('admin cadastra, edita e remove; editor não cadastra (403); viewer lista (200)', async () => {
    const body = { name: 'Criador', channels: ['https://youtube.com/@criador'] }
    const denied = await call(clients.editorA, `/api/orgs/${orgA}/partner-creators`, {
      method: 'POST',
      body,
    })
    expect(denied.status).toBe(403)
    const created = await call(clients.adminA, `/api/orgs/${orgA}/partner-creators`, {
      method: 'POST',
      body,
    })
    expect(created.status).toBe(201)
    const id = (created.body as { id: string }).id
    const patched = await call(clients.adminA, `/api/orgs/${orgA}/partner-creators/${id}`, {
      method: 'PATCH',
      body: { notes: 'Autorizou por e-mail.' },
    })
    expect(patched.status).toBe(200)
    const list = await call(clients.viewerA, `/api/orgs/${orgA}/partner-creators`)
    expect(list.status).toBe(200)
    expect(
      (list.body as { partnerCreators: Array<{ id: string }> }).partnerCreators.map((p) => p.id),
    ).toContain(id)
    const removed = await call(clients.adminA, `/api/orgs/${orgA}/partner-creators/${id}`, {
      method: 'DELETE',
    })
    expect(removed.status).toBe(204)
  })
})

describe('orçamento e segredos', () => {
  it('budget.get devolve spentUsd e budgetUsd', async () => {
    const res = await call(clients.viewerA, `/api/orgs/${orgA}/budget`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      spentUsd: expect.any(Number),
      budgetUsd: expect.any(Number),
      alert: expect.any(Boolean),
      blocked: expect.any(Boolean),
    })
  })

  it('nenhuma resposta contém S3_SECRET_ACCESS_KEY', () => {
    const secret = env.S3_SECRET_ACCESS_KEY!
    expect(secret.length).toBeGreaterThan(0)
    expect(seen.length).toBeGreaterThan(5)
    // No ambiente de teste o MinIO usa a mesma string como usuário e senha; o id da chave
    // aparece legitimamente em `X-Amz-Credential` das URLs assinadas (o segredo nunca vai nelas).
    const keyId = env.S3_ACCESS_KEY_ID!
    for (const body of seen) {
      expect(body.replaceAll(`X-Amz-Credential=${keyId}`, '')).not.toContain(secret)
    }
  })
})
