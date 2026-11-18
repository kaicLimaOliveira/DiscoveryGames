import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase } from '@central/db/testing'
import type { Storage } from '@central/storage'
import type { Actor } from '../../src/authz/roles.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../src/errors.js'
import {
  createCandidateService,
  type CandidateService,
} from '../../src/cutter/candidate-service.js'
import { makeActor, putTo, resetDb, startMinio } from './helpers.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
let minio: Awaited<ReturnType<typeof startMinio>> | undefined
let storage: Storage
let svc: CandidateService
let orgA: string
let orgB: string
let editorA: Actor
let viewerA: Actor
let editorB: Actor
let sourceA: string
let sourceA2: string

const DURATION = 600_000

beforeAll(async () => {
  ;[db, minio] = await Promise.all([startTestDatabase(), startMinio()])
  storage = minio.storage
}, 180_000)
afterAll(async () => {
  await db?.stop()
  await minio?.stop()
})

async function makeSource(orgId: string, title: string, storageKey: string): Promise<string> {
  const p = db!.prisma
  const asset = await p.mediaAsset.create({
    data: {
      organizationId: orgId,
      kind: 'original',
      storageKey,
      sha256: 'abc',
      sizeBytes: 10n,
      mimeType: 'video/mp4',
      probe: {},
      durationMs: DURATION,
      hasAudio: true,
    },
  })
  const source = await p.source.create({
    data: {
      organizationId: orgId,
      kind: 'upload',
      title,
      status: 'ready',
      rightsBasis: 'own',
      params: {},
      mediaAssetId: asset.id,
    },
  })
  return source.id
}

async function makeCandidate(
  orgId: string,
  sourceId: string,
  rank: number,
  over: Record<string, unknown> = {},
) {
  return db!.prisma.clipCandidate.create({
    data: {
      organizationId: orgId,
      sourceId,
      rank,
      startMs: 10_000,
      endMs: 50_000,
      suggestedStartMs: 10_000,
      suggestedEndMs: 50_000,
      hookScore: 80,
      reason: 'Momento forte',
      title: `Corte ${rank}`,
      captions: { instagram: 'x' },
      hashtags: ['a'],
      layout: 'face',
      ...over,
    },
  })
}

beforeEach(async () => {
  const p = db!.prisma
  await resetDb(p)
  svc = createCandidateService({ db: p, storage })
  orgA = (await p.organization.create({ data: { name: 'A', slug: 'a' } })).id
  orgB = (await p.organization.create({ data: { name: 'B', slug: 'b' } })).id
  editorA = await makeActor(p, 'e@x.com', orgA, 'editor')
  viewerA = await makeActor(p, 'v@x.com', orgA, 'viewer')
  editorB = await makeActor(p, 'eb@x.com', orgB, 'editor')
  sourceA = await makeSource(orgA, 'S1', `orgs/${orgA}/sources/s1/original.mp4`)
  sourceA2 = await makeSource(orgA, 'S2', `orgs/${orgA}/sources/s2/original.mp4`)
})

describe('candidate-service', () => {
  it('list devolve na ordem de rank e só da fonte pedida', async () => {
    await makeCandidate(orgA, sourceA, 2)
    await makeCandidate(orgA, sourceA, 1)
    await makeCandidate(orgA, sourceA2, 1)
    const out = await svc.list(viewerA, orgA, sourceA)
    expect(out.map((c) => c.rank)).toEqual([1, 2])
    expect(out[0]).toMatchObject({ title: 'Corte 1', status: 'suggested', decidedAt: null })
  })

  it('accept e depois reject mudam o status e auditam; rendered recusa com ConflictError', async () => {
    const p = db!.prisma
    const c = await makeCandidate(orgA, sourceA, 1)
    const accepted = await svc.decide(editorA, orgA, c.id, 'accept')
    expect(accepted.status).toBe('accepted')
    expect(accepted.decidedAt).toBeInstanceOf(Date)
    // Idempotente: repetir não duplica a auditoria.
    await svc.decide(editorA, orgA, c.id, 'accept')
    const rejected = await svc.decide(editorA, orgA, c.id, 'reject')
    expect(rejected.status).toBe('rejected')
    const row = await p.clipCandidate.findUniqueOrThrow({ where: { id: c.id } })
    expect(row.decidedById).toBe(editorA.userId)
    const actions = (await p.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (a) => a.action,
    )
    expect(actions).toEqual(['candidate.accept', 'candidate.reject'])

    const r = await makeCandidate(orgA, sourceA, 2, { status: 'rendered' })
    await expect(svc.decide(editorA, orgA, r.id, 'accept')).rejects.toBeInstanceOf(ConflictError)
    await expect(
      svc.adjust(editorA, orgA, r.id, { startMs: 0, endMs: 30_000 }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('viewer não decide nem ajusta (ForbiddenError)', async () => {
    const c = await makeCandidate(orgA, sourceA, 1)
    await expect(svc.decide(viewerA, orgA, c.id, 'accept')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      svc.adjust(viewerA, orgA, c.id, { startMs: 0, endMs: 30_000 }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('adjust valida limites: fim além da duração, 2 s e 181 s recusados; 3 s aceito', async () => {
    const c = await makeCandidate(orgA, sourceA, 1)
    const bad = (startMs: number, endMs: number) =>
      expect(svc.adjust(editorA, orgA, c.id, { startMs, endMs })).rejects.toBeInstanceOf(
        ValidationError,
      )
    await bad(DURATION - 10_000, DURATION + 1)
    await bad(0, 2_000)
    await bad(0, 181_000)
    await bad(-1, 10_000)
    await bad(5_000, 5_000)
    await bad(1.5, 10_000)
    await expect(
      svc.adjust(editorA, orgA, c.id, { startMs: 0, endMs: 10_000, title: ' ' }),
    ).rejects.toBeInstanceOf(ValidationError)
    const ok = await svc.adjust(editorA, orgA, c.id, { startMs: 1_000, endMs: 4_000 })
    expect(ok).toMatchObject({ startMs: 1_000, endMs: 4_000 })
    const max = await svc.adjust(editorA, orgA, c.id, { startMs: 0, endMs: 180_000 })
    expect(max.endMs).toBe(180_000)
    const end = await svc.adjust(editorA, orgA, c.id, {
      startMs: DURATION - 30_000,
      endMs: DURATION,
    })
    expect(end.endMs).toBe(DURATION)
  })

  it('adjust preserva suggestedStartMs/suggestedEndMs e audita antes e depois', async () => {
    const p = db!.prisma
    const c = await makeCandidate(orgA, sourceA, 1)
    const out = await svc.adjust(editorA, orgA, c.id, {
      startMs: 12_000,
      endMs: 40_000,
      layout: 'center',
      title: '  Novo título ',
    })
    expect(out).toMatchObject({
      startMs: 12_000,
      endMs: 40_000,
      suggestedStartMs: 10_000,
      suggestedEndMs: 50_000,
      layout: 'center',
      title: 'Novo título',
    })
    const audit = await p.auditLog.findFirstOrThrow({ where: { action: 'candidate.adjust' } })
    expect(audit).toMatchObject({ organizationId: orgA, entityId: c.id, userId: editorA.userId })
    expect(audit.diff).toEqual({
      before: { startMs: 10_000, endMs: 50_000, layout: 'face', title: 'Corte 1' },
      after: { startMs: 12_000, endMs: 40_000, layout: 'center', title: 'Novo título' },
    })
  })

  it('candidato de outra organização: decide, adjust e list lançam NotFoundError', async () => {
    const c = await makeCandidate(orgA, sourceA, 1)
    await expect(svc.decide(editorB, orgB, c.id, 'accept')).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      svc.adjust(editorB, orgB, c.id, { startMs: 0, endMs: 30_000 }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(svc.list(editorB, orgB, sourceA)).rejects.toBeInstanceOf(NotFoundError)
    await expect(svc.playerUrl(editorB, orgB, sourceA)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('playerUrl devolve URL que responde 200 com Content-Disposition inline', async () => {
    const key = `orgs/${orgA}/sources/s1/original.mp4`
    const put = await storage.presignPut(key, 'video/mp4')
    await putTo(put, new Uint8Array(1024), 'video/mp4')
    const before = Date.now()
    const out = await svc.playerUrl(viewerA, orgA, sourceA)
    expect(out.expiresAt.getTime()).toBeGreaterThan(before + 3_500_000)
    const res = await fetch(out.url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(/^inline/)
  })

  it('playerUrl sem asset lança NotFoundError', async () => {
    const s = await db!.prisma.source.create({
      data: { organizationId: orgA, kind: 'upload', title: 'x', rightsBasis: 'own', params: {} },
    })
    await expect(svc.playerUrl(viewerA, orgA, s.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})
