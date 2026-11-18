import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import {
  LlmError,
  TranscriberError,
  type LlmProvider,
  type StructuredResult,
  type Transcriber,
} from '@central/ai'
import type { Db } from '@central/db'
import { startTestDatabase } from '@central/db/testing'
import { sha256File } from '@central/media'
import { makeVideo } from '@central/media/testing'
import { createLogger } from '@central/shared'
import { createStorage, type Storage } from '@central/storage'
import { createSourceAnalyzeHandler } from '../src/handlers/source-analyze.js'

// Mesma imagem fixada por digest de packages/storage e packages/core.
const MINIO_IMAGE =
  'cgr.dev/chainguard/minio@sha256:18c8fa28697b25e0f34c6faae171079e88a03efb8e76a21d3b5d07b4e3cbef3e'
const MODEL = 'claude-opus-5-5'

let pg: Awaited<ReturnType<typeof startTestDatabase>> | undefined
let minio: StartedMinioContainer | undefined
let storage: Storage
let db: Db
let videoDir: string
let scratchRoot: string
let speech: string
let silent: string

beforeAll(async () => {
  ;[pg, minio] = await Promise.all([startTestDatabase(), new MinioContainer(MINIO_IMAGE).start()])
  db = pg.prisma
  const cfg = {
    S3_ENDPOINT: minio.getConnectionUrl(),
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'test',
    S3_ACCESS_KEY_ID: minio.getUsername(),
    S3_SECRET_ACCESS_KEY: minio.getPassword(),
    S3_FORCE_PATH_STYLE: true,
  }
  const admin = new S3Client({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.S3_ACCESS_KEY_ID, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY },
  })
  await admin.send(new CreateBucketCommand({ Bucket: 'test' }))
  admin.destroy()
  storage = createStorage(cfg)
  videoDir = await mkdtemp(join(tmpdir(), 'central-worker-videos-'))
  speech = await makeVideo(videoDir, { seconds: 4, audio: 'tone' })
  silent = await makeVideo(videoDir, { seconds: 4, audio: 'none' })
}, 180_000)

afterAll(async () => {
  await pg?.stop()
  await minio?.stop()
  if (videoDir) await rm(videoDir, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.clipCandidate.deleteMany()
  await db.costLedger.deleteMany()
  await db.aiRun.deleteMany()
  await db.transcript.deleteMany()
  await db.source.deleteMany()
  await db.mediaAsset.deleteMany()
  await db.auditLog.deleteMany()
  await db.organization.deleteMany()
  scratchRoot = await mkdtemp(join(tmpdir(), 'central-scratch-test-'))
})

const silentLogger = () =>
  createLogger({
    name: 'analyze-test',
    destination: new Writable({ write: (_c, _e, cb) => cb() }),
  })

type FakeTranscriber = Transcriber & { calls: number }
type FakeLlm = LlmProvider & { calls: number }

function fakeTranscriber(fail?: (call: number) => Error | undefined): FakeTranscriber {
  const t: FakeTranscriber = {
    provider: 'groq',
    model: 'whisper-large-v3-turbo',
    calls: 0,
    async transcribe(_chunks, language) {
      t.calls++
      const err = fail?.(t.calls)
      if (err) throw err
      return {
        language: language.split('-')[0]!,
        text: 'olha só que jogada incrível',
        words: [
          { w: 'olha', s: 0, e: 300 },
          { w: 'só', s: 300, e: 600 },
          { w: 'que', s: 600, e: 900 },
          { w: 'jogada', s: 1000, e: 1500 },
          { w: 'incrível', s: 1500, e: 2200 },
        ],
        durationSec: 4,
      }
    },
  }
  return t
}

function candidate(startSec: number, endSec: number, hookScore = 80) {
  return {
    startSec,
    endSec,
    hookScore,
    reason: 'Jogada forte com reação.',
    title: 'Que jogada!',
    layout: 'center',
    hashtags: ['games', 'clip'],
    captions: {
      instagram: { caption: 'Que jogada!' },
      facebook: { caption: 'Que jogada!' },
      tiktok: { caption: 'Que jogada!' },
      youtube: { title: 'Que jogada!', description: 'Corte do vídeo.' },
    },
  }
}

const USAGE = { inputTokens: 2000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }

function fakeLlm(
  respond: (call: number) => StructuredResult | Error = () => ({
    status: 'ok',
    json: { candidates: [candidate(0.5, 2.5, 90), candidate(2, 3.5, 60)] },
    usage: USAGE,
    latencyMs: 10,
    model: MODEL,
  }),
): FakeLlm {
  const l: FakeLlm = {
    provider: 'anthropic',
    calls: 0,
    async generateStructured() {
      l.calls++
      const r = respond(l.calls)
      if (r instanceof Error) throw r
      return r
    },
  }
  return l
}

async function seed(opts: { file: string; budget?: number }) {
  const org = await db.organization.create({
    data: {
      name: 'Org Teste',
      slug: `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tags: ['games'],
      voiceGuide: 'Tom animado.',
      ...(opts.budget !== undefined ? { aiMonthlyBudgetUsd: opts.budget } : {}),
    },
  })
  const key = `orgs/${org.id}/sources/${Date.now()}/original.mp4`
  await storage.uploadFile(key, opts.file, 'video/mp4')
  const source = await db.source.create({
    data: {
      organizationId: org.id,
      kind: 'upload',
      title: 'Partida',
      status: 'queued',
      rightsBasis: 'own',
      params: { targetMin: 1, targetMax: 3, minSec: 1, maxSec: 3, language: 'pt-BR' },
      uploadKey: key,
    },
  })
  return { orgId: org.id, sourceId: source.id, key }
}

function handlerWith(deps: {
  transcriber?: Transcriber | null
  llm?: LlmProvider | null
  maxDurationMs?: number
}) {
  return createSourceAnalyzeHandler({
    db,
    storage,
    transcriber: deps.transcriber === undefined ? fakeTranscriber() : deps.transcriber,
    llm: deps.llm === undefined ? fakeLlm() : deps.llm,
    model: MODEL,
    scratchRoot,
    ...(deps.maxDurationMs !== undefined ? { maxDurationMs: deps.maxDurationMs } : {}),
    logger: silentLogger(),
  })
}

let jobSeq = 0
const job = (sourceId: string) => ({ id: `job-${++jobSeq}`, data: { sourceId } })

it('vídeo com fala: probe, transcrição, sinais, IA e candidatos; status ready', async () => {
  const { sourceId, key } = await seed({ file: speech })
  const transcriber = fakeTranscriber()
  const llm = fakeLlm()
  await handlerWith({ transcriber, llm })(job(sourceId))

  const source = await db.source.findUniqueOrThrow({
    where: { id: sourceId },
    include: { mediaAsset: true, transcript: true },
  })
  expect(source.status).toBe('ready')
  expect(source.statusDetail).toBeNull()
  expect(source.signals).not.toBeNull()
  const originalSha = await sha256File(speech)
  expect(source.mediaAsset?.sha256).toBe(originalSha)
  expect(source.mediaAsset?.storageKey).toBe(key)
  expect(source.mediaAsset?.hasAudio).toBe(true)
  expect(source.mediaAsset?.durationMs).toBeGreaterThan(3500)
  expect(source.transcript?.provider).toBe('groq')
  expect(source.transcript?.text).toContain('jogada')
  expect(transcriber.calls).toBe(1)
  expect(llm.calls).toBe(1)

  const ledger = await db.costLedger.findMany({ where: { refId: { not: '' } } })
  expect(ledger.filter((l) => l.category === 'transcription')).toHaveLength(1)
  expect(ledger.filter((l) => l.category === 'llm')).toHaveLength(1)
  const runs = await db.aiRun.findMany({ where: { sourceId } })
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({ status: 'ok', task: 'select_clips', promptVersion: 1 })

  const cands = await db.clipCandidate.findMany({ where: { sourceId }, orderBy: { rank: 'asc' } })
  expect(cands).toHaveLength(2)
  expect(cands[0]).toMatchObject({
    rank: 1,
    startMs: 500,
    endMs: 2500,
    suggestedStartMs: 500,
    suggestedEndMs: 2500,
    hookScore: 90,
    status: 'suggested',
    aiRunId: runs[0]!.id,
  })
  expect(cands[1]!.rank).toBe(2)

  // Original intacto no storage.
  const back = join(scratchRoot, 'back.mp4')
  await storage.downloadToFile(key, back)
  expect(await sha256File(back)).toBe(originalSha)
})

it('vídeo sem áudio não chama o transcriber e gera candidatos', async () => {
  const { sourceId } = await seed({ file: silent })
  const transcriber = fakeTranscriber()
  const llm = fakeLlm()
  await handlerWith({ transcriber, llm })(job(sourceId))

  const source = await db.source.findUniqueOrThrow({
    where: { id: sourceId },
    include: { transcript: true, mediaAsset: true },
  })
  expect(source.status).toBe('ready')
  expect(source.mediaAsset?.hasAudio).toBe(false)
  expect(transcriber.calls).toBe(0)
  expect(source.transcript).toMatchObject({ provider: 'none', text: '' })
  expect(source.transcript?.costUsd.toNumber()).toBe(0)
  expect(await db.costLedger.count({ where: { category: 'transcription' } })).toBe(0)
  expect(await db.clipCandidate.count({ where: { sourceId } })).toBe(2)
})

it('retomada depois de falha na IA não repete transcrição nem custo', async () => {
  const { sourceId } = await seed({ file: speech })
  const transcriber = fakeTranscriber()
  let execution = 1
  // 1ª execução do handler: toda chamada falha com erro retryable (sobrecarga).
  const llm = fakeLlm(() =>
    execution === 1
      ? new LlmError('Falha na chamada ao Claude (HTTP 529).', true, 529)
      : {
          status: 'ok',
          json: { candidates: [candidate(0.5, 2.5, 90)] },
          usage: USAGE,
          latencyMs: 10,
          model: MODEL,
        },
  )

  const handler = handlerWith({ transcriber, llm })
  await expect(handler(job(sourceId))).rejects.toBeInstanceOf(LlmError)
  let source = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(source.status).toBe('analyzing')
  expect(source.attempts).toBe(1)

  execution = 2
  await handler(job(sourceId))
  source = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(source.status).toBe('ready')
  expect(transcriber.calls).toBe(1)
  expect(await db.costLedger.count({ where: { category: 'transcription' } })).toBe(1)
  expect(await db.clipCandidate.count({ where: { sourceId } })).toBe(1)
})

it('segunda execução com a mesma entrada usa o cache de AiRun', async () => {
  const { sourceId } = await seed({ file: speech })
  const llm = fakeLlm()
  const handler = handlerWith({ llm })
  await handler(job(sourceId))
  const first = await db.clipCandidate.findMany({ where: { sourceId } })
  expect(first).toHaveLength(2)

  // R-c: o retry() do serviço recusa a partir de `ready`; voltamos a `queued` direto no banco.
  await db.source.update({ where: { id: sourceId }, data: { status: 'queued' } })
  await handler(job(sourceId))

  expect(llm.calls).toBe(1)
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(source.status).toBe('ready')
  const again = await db.clipCandidate.findMany({ where: { sourceId }, orderBy: { rank: 'asc' } })
  expect(again).toHaveLength(2)
  expect(again[0]!.startMs).toBe(500)
  expect(await db.aiRun.count()).toBe(1)
  expect(await db.costLedger.count({ where: { category: 'llm' } })).toBe(1)
})

it('orçamento esgotado: blocked_budget sem chamar transcriber nem LLM', async () => {
  const { sourceId } = await seed({ file: speech, budget: 0.01 })
  const transcriber = fakeTranscriber()
  const llm = fakeLlm()
  await handlerWith({ transcriber, llm })(job(sourceId))

  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(source.status).toBe('blocked_budget')
  expect(source.statusDetail).toBe(
    'Orçamento de IA do mês esgotado. Aumente o orçamento ou aguarde o próximo mês.',
  )
  expect(transcriber.calls).toBe(0)
  expect(llm.calls).toBe(0)
  expect(await db.costLedger.count()).toBe(0)
})

it('IA sem candidatos válidos: failed com mensagem e custo registrado', async () => {
  const { sourceId } = await seed({ file: speech })
  // Fora da duração do vídeo: a pós-validação descarta tudo.
  const llm = fakeLlm(() => ({
    status: 'ok',
    json: { candidates: [candidate(10, 12)] },
    usage: USAGE,
    latencyMs: 10,
    model: MODEL,
  }))
  await handlerWith({ llm })(job(sourceId))

  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(source.status).toBe('failed')
  expect(source.statusDetail).toBe(
    'A IA não encontrou trechos válidos. Tente de novo ou ajuste a faixa de duração.',
  )
  const runs = await db.aiRun.findMany({ where: { sourceId } })
  expect(runs.length).toBe(llm.calls)
  expect(runs.every((r) => r.status === 'invalid_output')).toBe(true)
  const llmCosts = await db.costLedger.findMany({ where: { category: 'llm' } })
  expect(llmCosts).toHaveLength(runs.length)
  expect(llmCosts.every((c) => c.costUsd.toNumber() > 0)).toBe(true)
  expect(new Set(llmCosts.map((c) => c.refId))).toEqual(new Set(runs.map((r) => r.id)))
  expect(await db.clipCandidate.count({ where: { sourceId } })).toBe(0)
})

it('vídeo acima do limite: failed sem custo', async () => {
  const { sourceId } = await seed({ file: speech })
  const transcriber = fakeTranscriber()
  const llm = fakeLlm()
  await handlerWith({ transcriber, llm, maxDurationMs: 1000 })(job(sourceId))

  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(source.status).toBe('failed')
  expect(source.statusDetail).toBe('Vídeo acima de 2 h.')
  expect(transcriber.calls).toBe(0)
  expect(llm.calls).toBe(0)
  expect(await db.costLedger.count()).toBe(0)
})

it('três falhas transitórias seguidas: failed', async () => {
  const { sourceId } = await seed({ file: speech })
  const transcriber = fakeTranscriber(
    () => new TranscriberError('A transcrição falhou (HTTP 503).', 'HTTP', true, 503),
  )
  const handler = handlerWith({ transcriber })

  await expect(handler(job(sourceId))).rejects.toBeInstanceOf(TranscriberError)
  await expect(handler(job(sourceId))).rejects.toBeInstanceOf(TranscriberError)
  // Terceira falha: marca failed e termina o job normalmente (o retry do usuário pode enfileirar).
  await expect(handler(job(sourceId))).resolves.toBeUndefined()

  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(source.status).toBe('failed')
  expect(source.attempts).toBe(3)
  expect(source.statusDetail).toBe('Falha temporária repetida. Tente de novo.')
  expect(await db.costLedger.count()).toBe(0)
})

it('scratch é apagado mesmo com falha', async () => {
  const { sourceId } = await seed({ file: speech })
  const transcriber = fakeTranscriber(
    () => new TranscriberError('A transcrição falhou (HTTP 503).', 'HTTP', true, 503),
  )
  await expect(handlerWith({ transcriber })(job(sourceId))).rejects.toThrow()
  expect(await readdir(scratchRoot)).toEqual([])

  // Falha definitiva (não lança) também limpa.
  await db.source.update({ where: { id: sourceId }, data: { status: 'queued', attempts: 0 } })
  const fatal = fakeTranscriber(
    () => new TranscriberError('A transcrição falhou (HTTP 400).', 'HTTP', false, 400),
  )
  await handlerWith({ transcriber: fatal })(job(sourceId))
  expect((await db.source.findUniqueOrThrow({ where: { id: sourceId } })).status).toBe('failed')
  expect(await readdir(scratchRoot)).toEqual([])
})

it('sem chaves de IA: failed "Integração de IA não configurada." sem lançar', async () => {
  const { sourceId } = await seed({ file: speech })
  await handlerWith({ transcriber: null, llm: null })(job(sourceId))
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(source.status).toBe('failed')
  expect(source.statusDetail).toBe('Integração de IA não configurada.')
})

it('fonte fora dos estados retomáveis é ignorada', async () => {
  const { sourceId } = await seed({ file: speech })
  await db.source.update({ where: { id: sourceId }, data: { status: 'ready' } })
  const llm = fakeLlm()
  await handlerWith({ llm })(job(sourceId))
  expect((await db.source.findUniqueOrThrow({ where: { id: sourceId } })).status).toBe('ready')
  expect(llm.calls).toBe(0)
})

it('retry do usuário com transcrição pronta e orçamento esgotado: blocked_budget sem chamar a IA', async () => {
  const { orgId, sourceId } = await seed({ file: speech })
  // 1ª análise: a IA não acha trechos válidos (custo lançado, transcrição guardada).
  const llm = fakeLlm(() => ({
    status: 'ok',
    json: { candidates: [candidate(10, 12)] },
    usage: USAGE,
    latencyMs: 10,
    model: MODEL,
  }))
  const transcriber = fakeTranscriber()
  const handler = handlerWith({ transcriber, llm })
  await handler(job(sourceId))
  expect((await db.source.findUniqueOrThrow({ where: { id: sourceId } })).status).toBe('failed')
  expect(await db.transcript.count({ where: { sourceId } })).toBe(1)
  const llmCalls = llm.calls

  // Orçamento esgotado pelo gasto já lançado; o usuário clica "Tentar de novo" (retry → queued).
  const spent = await db.costLedger.aggregate({
    where: { organizationId: orgId },
    _sum: { costUsd: true },
  })
  await db.organization.update({
    where: { id: orgId },
    data: { aiMonthlyBudgetUsd: spent._sum.costUsd!.toNumber() },
  })
  await db.source.update({
    where: { id: sourceId },
    data: { status: 'queued', statusDetail: null, attempts: 0 },
  })
  await handler(job(sourceId))

  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(source.status).toBe('blocked_budget')
  expect(llm.calls).toBe(llmCalls)
  expect(transcriber.calls).toBe(1)
})

it('retomada pelo pg-boss de uma análise em andamento não é bloqueada pelo orçamento', async () => {
  const { orgId, sourceId } = await seed({ file: speech })
  let execution = 1
  const llm = fakeLlm(() =>
    execution === 1
      ? new LlmError('Falha na chamada ao Claude (HTTP 529).', true, 529)
      : {
          status: 'ok',
          json: { candidates: [candidate(0.5, 2.5, 90)] },
          usage: USAGE,
          latencyMs: 10,
          model: MODEL,
        },
  )
  const handler = handlerWith({ llm })
  await expect(handler(job(sourceId))).rejects.toBeInstanceOf(LlmError)
  // Orçamento zerado no meio: a análise em andamento (status analyzing) termina.
  await db.organization.update({ where: { id: orgId }, data: { aiMonthlyBudgetUsd: 0 } })
  execution = 2
  await handler(job(sourceId))
  expect((await db.source.findUniqueOrThrow({ where: { id: sourceId } })).status).toBe('ready')
})

it('reanálise mantém aceitos e rejeitados e numera os novos sugeridos depois deles', async () => {
  const { sourceId } = await seed({ file: speech })
  const handler = handlerWith({})
  await handler(job(sourceId))
  const first = await db.clipCandidate.findMany({ where: { sourceId }, orderBy: { rank: 'asc' } })
  expect(first.map((c) => c.rank)).toEqual([1, 2])
  await db.clipCandidate.update({ where: { id: first[0]!.id }, data: { status: 'accepted' } })
  await db.clipCandidate.update({ where: { id: first[1]!.id }, data: { status: 'rejected' } })

  await db.source.update({ where: { id: sourceId }, data: { status: 'queued' } })
  await handler(job(sourceId))

  const all = await db.clipCandidate.findMany({ where: { sourceId }, orderBy: { rank: 'asc' } })
  expect(all.map((c) => [c.rank, c.status])).toEqual([
    [1, 'accepted'],
    [2, 'rejected'],
    [3, 'suggested'],
    [4, 'suggested'],
  ])
})
