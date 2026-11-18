import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase } from '@central/db/testing'
import type { Storage } from '@central/storage'
import type { Actor } from '../../src/authz/roles.js'
import { ForbiddenError, NotFoundError, ValidationError } from '../../src/errors.js'
import {
  createPartnerCreatorService,
  type PartnerCreatorService,
} from '../../src/cutter/partner-creator-service.js'
import { makeActor, MIB, putTo, resetDb, startMinio } from './helpers.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
let minio: Awaited<ReturnType<typeof startMinio>> | undefined
let storage: Storage
let svc: PartnerCreatorService
let orgA: string
let orgB: string
let adminA: Actor
let adminB: Actor
let editorA: Actor

beforeAll(async () => {
  ;[db, minio] = await Promise.all([startTestDatabase(), startMinio()])
  storage = minio.storage
}, 180_000)
afterAll(async () => {
  await db?.stop()
  await minio?.stop()
})

beforeEach(async () => {
  const p = db!.prisma
  await resetDb(p)
  svc = createPartnerCreatorService({ db: p, storage })
  orgA = (await p.organization.create({ data: { name: 'A', slug: 'a' } })).id
  orgB = (await p.organization.create({ data: { name: 'B', slug: 'b' } })).id
  adminA = await makeActor(p, 'a@x.com', orgA, 'admin')
  adminB = await makeActor(p, 'b@x.com', orgB, 'admin')
  editorA = await makeActor(p, 'e@x.com', orgA, 'editor')
})

async function upload(key: string, bytes: number): Promise<string> {
  await putTo(
    await storage.presignPut(key, 'application/pdf'),
    new Uint8Array(bytes),
    'application/pdf',
  )
  return key
}

describe('partner-creator-service', () => {
  it('CRUD por admin com auditoria', async () => {
    const key = await upload(`orgs/${orgA}/evidence/doc1`, 1024)
    const created = await svc.create(adminA, orgA, {
      name: ' Canal Parceiro ',
      channels: ['https://youtube.com/@parceiro', ' ', 'https://youtube.com/@parceiro'],
      authorizationKey: key,
      notes: 'contrato até 2027',
    })
    expect(created).toMatchObject({
      name: 'Canal Parceiro',
      channels: ['https://youtube.com/@parceiro'],
      authorizationKey: key,
      authorizationUrl: null,
      notes: 'contrato até 2027',
    })
    expect(await svc.list(adminA, orgA)).toHaveLength(1)
    expect(await svc.list(adminB, orgB)).toHaveLength(0)

    const updated = await svc.update(adminA, orgA, created.id, {
      name: 'Novo nome',
      authorizationUrl: 'https://drive.example.com/autorizacao',
      authorizationKey: null,
    })
    expect(updated).toMatchObject({
      name: 'Novo nome',
      authorizationUrl: 'https://drive.example.com/autorizacao',
      authorizationKey: null,
    })

    await svc.remove(adminA, orgA, created.id)
    expect(await svc.list(adminA, orgA)).toHaveLength(0)
    const actions = (
      await db!.prisma.auditLog.findMany({
        where: { organizationId: orgA },
        orderBy: [{ at: 'asc' }, { id: 'asc' }],
      })
    ).map((a) => a.action)
    expect(actions).toEqual([
      'partner_creator.create',
      'partner_creator.update',
      'partner_creator.remove',
    ])
  })

  it('editor lista os parceiros, mas recebe ForbiddenError ao alterar', async () => {
    const created = await svc.create(adminA, orgA, { name: 'X', channels: [] })
    expect((await svc.list(editorA, orgA)).map((p) => p.id)).toEqual([created.id])
    await expect(svc.update(editorA, orgA, created.id, { name: 'Y' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(svc.remove(editorA, orgA, created.id)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(svc.create(editorA, orgA, { name: 'X', channels: [] })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('outra organização: update e remove lançam NotFoundError', async () => {
    const created = await svc.create(adminA, orgA, { name: 'X', channels: [] })
    await expect(svc.update(adminB, orgB, created.id, { name: 'Y' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(svc.remove(adminB, orgB, created.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(svc.update(adminA, orgB, created.id, { name: 'Y' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('anexo acima de 10 MiB ou com chave de outra organização é recusado', async () => {
    const big = await upload(`orgs/${orgA}/evidence/grande`, 10 * MIB + 1)
    await expect(
      svc.create(adminA, orgA, { name: 'X', channels: [], authorizationKey: big }),
    ).rejects.toBeInstanceOf(ValidationError)

    const alheia = await upload(`orgs/${orgB}/evidence/doc`, 100)
    await expect(
      svc.create(adminA, orgA, { name: 'X', channels: [], authorizationKey: alheia }),
    ).rejects.toBeInstanceOf(ValidationError)

    await expect(
      svc.create(adminA, orgA, {
        name: 'X',
        channels: [],
        authorizationKey: `orgs/${orgA}/evidence/inexistente`,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    const created = await svc.create(adminA, orgA, { name: 'X', channels: [] })
    await expect(
      svc.update(adminA, orgA, created.id, { authorizationKey: alheia }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await db!.prisma.partnerCreator.count()).toBe(1)
  })

  it('valida nome e URL de autorização', async () => {
    await expect(svc.create(adminA, orgA, { name: '  ', channels: [] })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(
      svc.create(adminA, orgA, { name: 'X', channels: [], authorizationUrl: 'http://a.com' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})
