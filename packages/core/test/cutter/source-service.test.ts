import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPgBossQueue, type PgBossQueue } from '@central/db'
import { startTestDatabase } from '@central/db/testing'
import type { Storage } from '@central/storage'
import type { Actor } from '../../src/authz/roles.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../src/errors.js'
import { createSourceService, type SourceService } from '../../src/cutter/source-service.js'
import { makeActor, MIB, putTo, resetDb, startMinio } from './helpers.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
let minio: Awaited<ReturnType<typeof startMinio>> | undefined
let queue: PgBossQueue | undefined
let storage: Storage
let svc: SourceService
let orgA: string
let orgB: string
let editorA: Actor
let approverA: Actor
let viewerA: Actor
let editorB: Actor

const PART = 5 * MIB
const OWN = { basis: 'own' as const, accepted: true }
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

beforeAll(async () => {
  ;[db, minio] = await Promise.all([startTestDatabase(), startMinio()])
  storage = minio.storage
  queue = await createPgBossQueue({ connectionString: db.url, role: 'worker' })
}, 180_000)
afterAll(async () => {
  await queue?.stop()
  await db?.stop()
  await minio?.stop()
})

beforeEach(async () => {
  const p = db!.prisma
  await resetDb(p)
  svc = createSourceService({ db: p, storage, queue: queue!, partBytes: PART })
  orgA = (
    await p.organization.create({
      data: {
        name: 'A',
        slug: 'a',
        locale: 'en-US',
        clipDefaults: { targetMin: 3, targetMax: 6, minSec: 20, maxSec: 60 },
      },
    })
  ).id
  orgB = (await p.organization.create({ data: { name: 'B', slug: 'b' } })).id
  editorA = await makeActor(p, 'e@x.com', orgA, 'editor')
  approverA = await makeActor(p, 'ap@x.com', orgA, 'approver')
  viewerA = await makeActor(p, 'v@x.com', orgA, 'viewer')
  editorB = await makeActor(p, 'eb@x.com', orgB, 'editor')
})

async function jobs(name: string, sourceId?: string): Promise<number> {
  const rows = await db!.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `select count(*) as n from pgboss.job where name = $1 and ($2::text is null or data->>'sourceId' = $2)`,
    name,
    sourceId ?? null,
  )
  return Number(rows[0]!.n)
}

const uploadInput = (over: Record<string, unknown> = {}) => ({
  title: 'Live de sexta',
  fileName: 'live.mp4',
  sizeBytes: 2 * PART,
  contentType: 'video/mp4',
  rights: OWN,
  ...over,
})

/** Cria a fonte e envia as partes pelas URLs pré-assinadas, como o navegador. */
async function uploadParts(sizes: number[], declared = sizes.reduce((a, b) => a + b, 0)) {
  const created = await svc.createUpload(editorA, orgA, uploadInput({ sizeBytes: declared }))
  const urls = await svc.presignParts(
    editorA,
    orgA,
    created.source.id,
    sizes.map((_, i) => i + 1),
  )
  const parts = []
  for (const [i, u] of urls.entries()) {
    parts.push({ partNumber: u.partNumber, etag: await putTo(u.url, new Uint8Array(sizes[i]!)) })
  }
  return { created, parts }
}

describe('source-service: upload', () => {
  it('createUpload cria fonte, declaração e auditoria; params vêm da organização', async () => {
    const p = db!.prisma
    const out = await svc.createUpload(
      editorA,
      orgA,
      uploadInput({ sizeBytes: 2 * PART + 1, params: { maxSec: 45 } }),
    )
    expect(out.partSize).toBe(PART)
    expect(out.partCount).toBe(3)
    expect(out.uploadId).toEqual(expect.any(String))
    expect(out.source).toMatchObject({
      title: 'Live de sexta',
      kind: 'upload',
      status: 'awaiting_upload',
      rightsBasis: 'own',
      candidateCounts: { suggested: 0, accepted: 0, rejected: 0, rendered: 0 },
    })
    const row = await p.source.findUniqueOrThrow({ where: { id: out.source.id } })
    expect(row.params).toEqual({
      targetMin: 3,
      targetMax: 6,
      minSec: 20,
      maxSec: 45,
      language: 'en-US',
    })
    expect(row.uploadKey).toBe(`orgs/${orgA}/sources/${row.id}/original.mp4`)
    expect(row.uploadId).toBe(out.uploadId)
    expect(row.uploadSizeBytes).toBe(BigInt(2 * PART + 1))
    expect(row.createdById).toBe(editorA.userId)
    const decl = await p.rightsDeclaration.findMany({ where: { sourceId: row.id } })
    expect(decl).toHaveLength(1)
    expect(decl[0]).toMatchObject({ basis: 'own', declaredById: editorA.userId })
    const audit = await p.auditLog.findFirstOrThrow({ where: { action: 'source.create' } })
    expect(audit).toMatchObject({ organizationId: orgA, entityId: row.id, userId: editorA.userId })
    expect(audit.diff).toMatchObject({ rights: { basis: 'own', accepted: true } })
  })

  it('extensão segue o content-type', async () => {
    const p = db!.prisma
    for (const [ct, ext] of [
      ['video/quicktime', '.mov'],
      ['video/webm', '.webm'],
      ['video/x-matroska', '.mkv'],
    ] as const) {
      const out = await svc.createUpload(editorA, orgA, uploadInput({ contentType: ct }))
      const row = await p.source.findUniqueOrThrow({ where: { id: out.source.id } })
      expect(row.uploadKey).toMatch(new RegExp(`/original\\${ext}$`))
    }
  })

  it('createUpload recusa 4 GiB + 1 byte e content-type de imagem', async () => {
    await expect(
      svc.createUpload(editorA, orgA, uploadInput({ sizeBytes: 4 * 1024 ** 3 + 1 })),
    ).rejects.toThrow(new ValidationError('Arquivo acima de 4 GB.'))
    await expect(
      svc.createUpload(editorA, orgA, uploadInput({ contentType: 'image/png' })),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      svc.createUpload(editorA, orgA, uploadInput({ sizeBytes: 0 })),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      svc.createUpload(editorA, orgA, uploadInput({ title: ' ' })),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      svc.createUpload(editorA, orgA, uploadInput({ params: { minSec: 90, maxSec: 30 } })),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await db!.prisma.source.count()).toBe(0)
  })

  it('createUpload aceita duração mínima de 3 s e recusa 2 s', async () => {
    const ok = await svc.createUpload(
      editorA,
      orgA,
      uploadInput({ params: { minSec: 3, maxSec: 30 } }),
    )
    expect(ok.source.id).toBeTruthy()
    await expect(
      svc.createUpload(editorA, orgA, uploadInput({ params: { minSec: 2, maxSec: 30 } })),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('createUpload exige content.edit', async () => {
    await expect(svc.createUpload(viewerA, orgA, uploadInput())).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(svc.createUpload(editorB, orgA, uploadInput())).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('upload completo por URLs pré-assinadas vai para queued e envia source.analyze', async () => {
    const { created, parts } = await uploadParts([PART, PART])
    const view = await svc.completeUpload(editorA, orgA, created.source.id, parts)
    expect(view.status).toBe('queued')
    expect(await storage.head(`orgs/${orgA}/sources/${created.source.id}/original.mp4`)).toEqual(
      expect.objectContaining({ sizeBytes: 2 * PART }),
    )
    expect(await jobs('source.analyze', created.source.id)).toBe(1)
  })

  it('completeUpload duas vezes é idempotente e envia um só job', async () => {
    const { created, parts } = await uploadParts([PART, PART])
    await svc.completeUpload(editorA, orgA, created.source.id, parts)
    const again = await svc.completeUpload(editorA, orgA, created.source.id, parts)
    expect(again.status).toBe('queued')
    expect(await jobs('source.analyze', created.source.id)).toBe(1)
    await expect(svc.presignParts(editorA, orgA, created.source.id, [1])).rejects.toBeInstanceOf(
      ConflictError,
    )
  })

  it('completeUpload com tamanho diferente do declarado aborta, marca failed e lança ValidationError', async () => {
    const { created, parts } = await uploadParts([PART, 1024], 2 * PART)
    await expect(
      svc.completeUpload(editorA, orgA, created.source.id, parts),
    ).rejects.toBeInstanceOf(ValidationError)
    const row = await db!.prisma.source.findUniqueOrThrow({ where: { id: created.source.id } })
    expect(row.status).toBe('failed')
    expect(row.statusDetail).toEqual(expect.any(String))
    expect(await storage.head(row.uploadKey!)).toBeNull()
    expect(await jobs('source.analyze')).toBe(0)
  })

  it('completeUpload com partes inválidas lança ValidationError e mantém a fonte aguardando', async () => {
    const { created } = await uploadParts([PART, PART])
    await expect(
      svc.completeUpload(editorA, orgA, created.source.id, [{ partNumber: 1, etag: '"x"' }]),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(svc.completeUpload(editorA, orgA, created.source.id, [])).rejects.toBeInstanceOf(
      ValidationError,
    )
    const row = await db!.prisma.source.findUniqueOrThrow({ where: { id: created.source.id } })
    expect(row.status).toBe('awaiting_upload')
  })

  it('presignParts valida os números das partes', async () => {
    const out = await svc.createUpload(editorA, orgA, uploadInput())
    const id = out.source.id
    await expect(svc.presignParts(editorA, orgA, id, [0])).rejects.toBeInstanceOf(ValidationError)
    await expect(svc.presignParts(editorA, orgA, id, [3])).rejects.toBeInstanceOf(ValidationError)
    await expect(svc.presignParts(editorA, orgA, id, [1.5])).rejects.toBeInstanceOf(ValidationError)
    await expect(
      svc.presignParts(
        editorA,
        orgA,
        id,
        Array.from({ length: 101 }, () => 1),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(svc.presignParts(editorA, orgA, id, [])).rejects.toBeInstanceOf(ValidationError)
    await expect(svc.presignParts(editorB, orgB, id, [1])).rejects.toBeInstanceOf(NotFoundError)
  })

  it('abandonUpload aborta o multipart e apaga a fonte', async () => {
    const { created } = await uploadParts([PART])
    await svc.abandonUpload(editorA, orgA, created.source.id)
    expect(await db!.prisma.source.count()).toBe(0)
    expect(await db!.prisma.rightsDeclaration.count()).toBe(0)
    expect(await db!.prisma.auditLog.count({ where: { action: 'source.abandon_upload' } })).toBe(1)
  })

  it('abandonUpload fora de awaiting_upload é ConflictError', async () => {
    const { created, parts } = await uploadParts([PART])
    await svc.completeUpload(editorA, orgA, created.source.id, parts)
    await expect(svc.abandonUpload(editorA, orgA, created.source.id)).rejects.toBeInstanceOf(
      ConflictError,
    )
  })
})

describe('source-service: evidência', () => {
  it('presignEvidenceUpload devolve chave da organização e URL que aceita o tipo assinado', async () => {
    const { key, url } = await svc.presignEvidenceUpload(editorA, orgA, 'application/pdf')
    expect(key).toMatch(new RegExp(`^orgs/${orgA}/evidence/[0-9a-f-]{36}$`))
    await putTo(url, new Uint8Array(100), 'application/pdf')
    const out = await svc.createUpload(
      editorA,
      orgA,
      uploadInput({ rights: { basis: 'authorized', creatorName: 'Fulano', evidenceKey: key } }),
    )
    expect(out.source.rightsBasis).toBe('authorized')
  })

  it('presignEvidenceUpload recusa text/html', async () => {
    await expect(svc.presignEvidenceUpload(editorA, orgA, 'text/html')).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(svc.presignEvidenceUpload(viewerA, orgA, 'image/png')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('declaração authorized com evidenceKey inexistente lança ValidationError', async () => {
    await expect(
      svc.createUpload(
        editorA,
        orgA,
        uploadInput({
          rights: {
            basis: 'authorized',
            creatorName: 'Fulano',
            evidenceKey: `orgs/${orgA}/evidence/nao-existe`,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await db!.prisma.source.count()).toBe(0)
  })

  it('declaração com parceiro autorizado herda nome e evidência', async () => {
    const partner = await db!.prisma.partnerCreator.create({
      data: {
        organizationId: orgA,
        name: 'Parceiro',
        channels: [],
        authorizationUrl: 'https://drive.example.com/a',
      },
    })
    const out = await svc.createUpload(
      editorA,
      orgA,
      uploadInput({ rights: { basis: 'authorized', partnerCreatorId: partner.id } }),
    )
    const detail = await svc.get(viewerA, orgA, out.source.id)
    expect(detail.rightsHistory[0]).toMatchObject({
      basis: 'authorized',
      creatorName: 'Parceiro',
      evidenceUrl: 'https://drive.example.com/a',
    })
    const row = await db!.prisma.source.findUniqueOrThrow({ where: { id: out.source.id } })
    expect(row.partnerCreatorId).toBe(partner.id)

    // Parceiro de outra organização não é encontrado.
    const alheio = await db!.prisma.partnerCreator.create({
      data: { organizationId: orgB, name: 'B', channels: [], authorizationUrl: 'https://b.com' },
    })
    await expect(
      svc.createUpload(
        editorA,
        orgA,
        uploadInput({ rights: { basis: 'authorized', partnerCreatorId: alheio.id } }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('source-service: link', () => {
  it('createFromLink com none lança antes de criar fonte ou job', async () => {
    await expect(
      svc.createFromLink(
        editorA,
        orgA,
        { title: 'x', url: YT, rights: { basis: 'none' } },
        { linkEnabled: true },
      ),
    ).rejects.toThrow(
      new ValidationError(
        'Link sem direitos não é baixado. Declare os direitos ou envie o arquivo.',
      ),
    )
    expect(await db!.prisma.source.count()).toBe(0)
    expect(await db!.prisma.rightsDeclaration.count()).toBe(0)
    expect(await db!.prisma.auditLog.count()).toBe(0)
    expect(await jobs('source.download')).toBe(0)
  })

  it('createFromLink desativado lança e URL fora do YouTube lança', async () => {
    await expect(
      svc.createFromLink(
        editorA,
        orgA,
        { title: 'x', url: YT, rights: OWN },
        { linkEnabled: false },
      ),
    ).rejects.toThrow(new ValidationError('Envio por link desativado. Envie o arquivo MP4.'))
    for (const url of [
      'https://vimeo.com/123',
      'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/playlist?list=abc',
    ]) {
      await expect(
        svc.createFromLink(editorA, orgA, { title: 'x', url, rights: OWN }, { linkEnabled: true }),
      ).rejects.toBeInstanceOf(ValidationError)
    }
    expect(await db!.prisma.source.count()).toBe(0)
  })

  it('createFromLink cria em queued e envia source.download', async () => {
    for (const url of [
      YT,
      'https://youtu.be/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
    ]) {
      const view = await svc.createFromLink(
        editorA,
        orgA,
        { title: 'Vídeo', url, rights: OWN, params: { targetMax: 8 } },
        { linkEnabled: true },
      )
      expect(view).toMatchObject({ kind: 'youtube_link', status: 'queued', rightsBasis: 'own' })
      expect(await jobs('source.download', view.id)).toBe(1)
      const detail = await svc.get(viewerA, orgA, view.id)
      expect(detail.originalUrl).toBe(url)
      expect(detail.params).toMatchObject({ targetMin: 3, targetMax: 8, language: 'en-US' })
    }
  })
})

describe('source-service: leitura, direitos e retry', () => {
  it('list traz as mais recentes primeiro com contagem de candidatos', async () => {
    const p = db!.prisma
    const a = await svc.createUpload(editorA, orgA, uploadInput({ title: 'primeira' }))
    const b = await svc.createUpload(editorA, orgA, uploadInput({ title: 'segunda' }))
    await svc.createUpload(editorB, orgB, uploadInput({ title: 'outra org' }))
    const cand = (status: 'suggested' | 'accepted', rank: number) => ({
      organizationId: orgA,
      sourceId: a.source.id,
      rank,
      startMs: 0,
      endMs: 30_000,
      suggestedStartMs: 0,
      suggestedEndMs: 30_000,
      hookScore: 50,
      reason: 'r',
      title: 't',
      captions: {},
      hashtags: [],
      layout: 'center' as const,
      status,
    })
    await p.clipCandidate.createMany({
      data: [cand('suggested', 1), cand('suggested', 2), cand('accepted', 3)],
    })
    const list = await svc.list(viewerA, orgA)
    expect(list.map((s) => s.title)).toEqual(['segunda', 'primeira'])
    expect(list[1]!.candidateCounts).toEqual({
      suggested: 2,
      accepted: 1,
      rejected: 0,
      rendered: 0,
    })
    expect(list[0]!.id).toBe(b.source.id)
  })

  it('get inclui o asset (duração) e o histórico', async () => {
    const p = db!.prisma
    const out = await svc.createUpload(editorA, orgA, uploadInput())
    const asset = await p.mediaAsset.create({
      data: {
        organizationId: orgA,
        kind: 'original',
        storageKey: `orgs/${orgA}/sources/${out.source.id}/original.mp4`,
        sha256: 'x',
        sizeBytes: 10n,
        mimeType: 'video/mp4',
        probe: {},
        durationMs: 61_000,
        hasAudio: true,
      },
    })
    await p.source.update({ where: { id: out.source.id }, data: { mediaAssetId: asset.id } })
    const detail = await svc.get(viewerA, orgA, out.source.id)
    expect(detail.durationMs).toBe(61_000)
    expect(detail.rightsHistory).toHaveLength(1)
    expect(detail.rightsHistory[0]!.declaredBy).toBe('e@x.com')
  })

  it('changeRights por editor é ForbiddenError; por aprovador grava nova declaração e preserva a anterior', async () => {
    const p = db!.prisma
    const out = await svc.createUpload(editorA, orgA, uploadInput())
    await expect(
      svc.changeRights(editorA, orgA, out.source.id, { basis: 'none' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      svc.changeRights(approverA, orgA, out.source.id, { basis: 'clipper_program' }),
    ).rejects.toBeInstanceOf(ValidationError)

    const detail = await svc.changeRights(approverA, orgA, out.source.id, {
      basis: 'clipper_program',
      programUrl: 'https://programa.com/regras',
    })
    expect(detail.rightsBasis).toBe('clipper_program')
    expect(detail.rightsHistory.map((h) => h.basis)).toEqual(['clipper_program', 'own'])
    expect(detail.rightsHistory[0]).toMatchObject({
      programUrl: 'https://programa.com/regras',
      declaredBy: 'ap@x.com',
    })
    expect(await p.rightsDeclaration.count({ where: { sourceId: out.source.id } })).toBe(2)
    const audit = await p.auditLog.findFirstOrThrow({ where: { action: 'source.rights_change' } })
    expect(audit).toMatchObject({ userId: approverA.userId, entityId: out.source.id })
    expect(audit.diff).toMatchObject({ from: 'own', to: 'clipper_program' })
  })

  it('retry só a partir de failed ou blocked_budget', async () => {
    const p = db!.prisma
    const { created, parts } = await uploadParts([PART])
    const id = created.source.id
    await expect(svc.retry(editorA, orgA, id)).rejects.toBeInstanceOf(ConflictError)
    await svc.completeUpload(editorA, orgA, id, parts)
    await expect(svc.retry(editorA, orgA, id)).rejects.toBeInstanceOf(ConflictError)
    // Libera o job anterior para a fila exclusive aceitar o reenvio.
    await p.$executeRawUnsafe(`delete from pgboss.job where name = 'source.analyze'`)

    await p.source.update({
      where: { id },
      data: { status: 'failed', statusDetail: 'erro', attempts: 3 },
    })
    const view = await svc.retry(editorA, orgA, id)
    expect(view).toMatchObject({ status: 'queued', statusDetail: null })
    expect((await p.source.findUniqueOrThrow({ where: { id } })).attempts).toBe(0)
    expect(await jobs('source.analyze', id)).toBe(1)
    await expect(svc.retry(viewerA, orgA, id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('retry com job anterior ainda na fila lança ConflictError e não muda o status', async () => {
    const p = db!.prisma
    const { created, parts } = await uploadParts([PART])
    const id = created.source.id
    await svc.completeUpload(editorA, orgA, id, parts)
    expect(await jobs('source.analyze', id)).toBe(1)
    await p.source.update({ where: { id }, data: { status: 'failed', attempts: 2 } })
    await expect(svc.retry(editorA, orgA, id)).rejects.toThrow(
      new ConflictError('Já existe um processamento em andamento para esta fonte.'),
    )
    const row = await p.source.findUniqueOrThrow({ where: { id } })
    expect(row).toMatchObject({ status: 'failed', attempts: 2 })
    expect(await p.auditLog.count({ where: { action: 'source.retry' } })).toBe(0)
    expect(await jobs('source.analyze', id)).toBe(1)
  })

  it('completeUpload com job já existente para a fonte desfaz a ida para queued', async () => {
    const p = db!.prisma
    const { created, parts } = await uploadParts([PART])
    const id = created.source.id
    await queue!.send('source.analyze', { sourceId: id }, { singletonKey: id })
    await expect(svc.completeUpload(editorA, orgA, id, parts)).rejects.toBeInstanceOf(ConflictError)
    expect((await p.source.findUniqueOrThrow({ where: { id } })).status).toBe('awaiting_upload')
  })

  it('retry de link sem asset reenvia o download; de blocked_budget também', async () => {
    const p = db!.prisma
    const view = await svc.createFromLink(
      editorA,
      orgA,
      { title: 'x', url: YT, rights: OWN },
      { linkEnabled: true },
    )
    await p.$executeRawUnsafe(`delete from pgboss.job`)
    await p.source.update({ where: { id: view.id }, data: { status: 'blocked_budget' } })
    await svc.retry(editorA, orgA, view.id)
    expect(await jobs('source.download', view.id)).toBe(1)
    expect(await jobs('source.analyze', view.id)).toBe(0)
  })

  it('retry de link já baixado (original no storage, sem asset) reenvia a análise, não o download', async () => {
    const p = db!.prisma
    const view = await svc.createFromLink(
      editorA,
      orgA,
      { title: 'x', url: YT, rights: OWN },
      { linkEnabled: true },
    )
    await p.$executeRawUnsafe(`delete from pgboss.job`)
    const key = `orgs/${orgA}/sources/${view.id}/original.mp4`
    await putTo(await storage.presignPut(key, 'video/mp4'), new Uint8Array(16), 'video/mp4')
    await p.source.update({
      where: { id: view.id },
      data: { status: 'failed', statusDetail: 'erro', uploadKey: key },
    })
    await svc.retry(editorA, orgA, view.id)
    expect(await jobs('source.analyze', view.id)).toBe(1)
    expect(await jobs('source.download', view.id)).toBe(0)
  })

  it('retry de link com uploadKey cujo arquivo sumiu volta ao download', async () => {
    const p = db!.prisma
    const view = await svc.createFromLink(
      editorA,
      orgA,
      { title: 'x', url: YT, rights: OWN },
      { linkEnabled: true },
    )
    await p.$executeRawUnsafe(`delete from pgboss.job`)
    await p.source.update({
      where: { id: view.id },
      data: { status: 'failed', uploadKey: `orgs/${orgA}/sources/${view.id}/sumiu.mp4` },
    })
    await svc.retry(editorA, orgA, view.id)
    expect(await jobs('source.download', view.id)).toBe(1)
    expect(await jobs('source.analyze', view.id)).toBe(0)
  })

  it('retry de upload cujo arquivo sumiu lança ValidationError', async () => {
    const p = db!.prisma
    const { created, parts } = await uploadParts([PART, 1024], 2 * PART)
    await expect(svc.completeUpload(editorA, orgA, created.source.id, parts)).rejects.toThrow()
    await expect(svc.retry(editorA, orgA, created.source.id)).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect((await p.source.findUniqueOrThrow({ where: { id: created.source.id } })).status).toBe(
      'failed',
    )
  })

  it('outra organização: get e changeRights lançam NotFoundError', async () => {
    const out = await svc.createUpload(editorA, orgA, uploadInput())
    const adminB = await makeActor(db!.prisma, 'adb@x.com', orgB, 'admin')
    await expect(svc.get(adminB, orgB, out.source.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      svc.changeRights(adminB, orgB, out.source.id, { basis: 'none' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(svc.retry(adminB, orgB, out.source.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(svc.abandonUpload(adminB, orgB, out.source.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      svc.completeUpload(adminB, orgB, out.source.id, [{ partNumber: 1, etag: 'x' }]),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(svc.get(adminB, orgA, out.source.id)).rejects.toBeInstanceOf(NotFoundError)
    expect((await p_source(out.source.id)).rightsBasis).toBe('own')
  })
})

function p_source(id: string) {
  return db!.prisma.source.findUniqueOrThrow({ where: { id } })
}
