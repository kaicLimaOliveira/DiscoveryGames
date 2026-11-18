import { afterAll, beforeAll, expect, it } from 'vitest'
import { startTestDatabase } from '../src/testing.js'

let db: Awaited<ReturnType<typeof startTestDatabase>>
beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db?.stop())

let seq = 0
async function novaOrg() {
  seq += 1
  return db.prisma.organization.create({
    data: { name: `Org ${seq}`, slug: `org-cortador-${seq}` },
  })
}
const params = { targetMin: 5, targetMax: 10, minSec: 30, maxSec: 90, language: 'pt-BR' }

async function novaFonte(organizationId: string) {
  return db.prisma.source.create({
    data: { organizationId, kind: 'upload', title: 'Vídeo', rightsBasis: 'own', params },
  })
}
function candidato(organizationId: string, sourceId: string, over: object = {}) {
  return {
    organizationId,
    sourceId,
    rank: 1,
    startMs: 1000,
    endMs: 40_000,
    suggestedStartMs: 1000,
    suggestedEndMs: 40_000,
    hookScore: 80,
    reason: 'Gancho forte',
    title: 'Título',
    captions: {},
    hashtags: [],
    layout: 'center' as const,
    ...over,
  }
}

it('cria fonte com declaração, asset, transcrição e candidato encadeados', async () => {
  const org = await novaOrg()
  const source = await novaFonte(org.id)
  await db.prisma.rightsDeclaration.create({ data: { sourceId: source.id, basis: 'own' } })
  const asset = await db.prisma.mediaAsset.create({
    data: {
      organizationId: org.id,
      kind: 'original',
      storageKey: `orig/${source.id}`,
      sha256: 'abc',
      sizeBytes: 123n,
      mimeType: 'video/mp4',
      probe: {},
      durationMs: 60_000,
      hasAudio: true,
    },
  })
  await db.prisma.source.update({ where: { id: source.id }, data: { mediaAssetId: asset.id } })
  await db.prisma.transcript.create({
    data: {
      sourceId: source.id,
      language: 'pt',
      text: 'olá',
      words: [{ w: 'olá', s: 0, e: 500 }],
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      durationSec: 60,
      costUsd: '0.001',
    },
  })
  await db.prisma.clipCandidate.create({ data: candidato(org.id, source.id) })
  const full = await db.prisma.source.findUnique({
    where: { id: source.id },
    include: { rightsDeclarations: true, mediaAsset: true, transcript: true, candidates: true },
  })
  expect(full?.rightsDeclarations).toHaveLength(1)
  expect(full?.mediaAsset?.id).toBe(asset.id)
  expect(full?.transcript?.language).toBe('pt')
  expect(full?.candidates).toHaveLength(1)
})

it('CostLedger recusa lançamento duplicado', async () => {
  const org = await novaOrg()
  const data = {
    organizationId: org.id,
    category: 'llm' as const,
    provider: 'anthropic',
    units: '100',
    unitType: 'tokens',
    costUsd: '0.01',
    refType: 'ai_run',
    refId: 'r1',
  }
  await db.prisma.costLedger.create({ data })
  await expect(db.prisma.costLedger.create({ data })).rejects.toMatchObject({ code: 'P2002' })
})

it('ClipCandidate recusa hookScore fora de 0..100 e fim <= início', async () => {
  const org = await novaOrg()
  const source = await novaFonte(org.id)
  await expect(
    db.prisma.clipCandidate.create({ data: candidato(org.id, source.id, { hookScore: 101 }) }),
  ).rejects.toThrow()
  await expect(
    db.prisma.clipCandidate.create({
      data: candidato(org.id, source.id, { startMs: 5000, endMs: 5000 }),
    }),
  ).rejects.toThrow()
})

it('apagar a organização apaga fontes, candidatos e criadores parceiros', async () => {
  const org = await novaOrg()
  const source = await novaFonte(org.id)
  await db.prisma.clipCandidate.create({ data: candidato(org.id, source.id) })
  await db.prisma.partnerCreator.create({ data: { organizationId: org.id, name: 'Parceiro' } })
  await db.prisma.organization.delete({ where: { id: org.id } })
  const where = { organizationId: org.id }
  expect(await db.prisma.source.count({ where })).toBe(0)
  expect(await db.prisma.clipCandidate.count({ where })).toBe(0)
  expect(await db.prisma.partnerCreator.count({ where })).toBe(0)
})
