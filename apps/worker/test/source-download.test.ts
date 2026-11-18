import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { createPgBossQueue } from '@central/db'
import type { Db } from '@central/db'
import { startTestDatabase } from '@central/db/testing'
import { ffmpegPath } from '@central/media'
import { makeVideo } from '@central/media/testing'
import { createLogger, QUEUES, type JobQueue } from '@central/shared'
import { createStorage, type Storage } from '@central/storage'
import { createSourceDownloadHandler } from '../src/handlers/source-download.js'

// Mesma imagem fixada por digest dos outros testes com MinIO.
const MINIO_IMAGE =
  'cgr.dev/chainguard/minio@sha256:18c8fa28697b25e0f34c6faae171079e88a03efb8e76a21d3b5d07b4e3cbef3e'
// O yt-dlp falso é um script node: o handler recebe `ytdlpPath` = node e `ytdlpArgs` = [script].
const FAKE = fileURLToPath(new URL('./fake-ytdlp.mjs', import.meta.url))

let pg: Awaited<ReturnType<typeof startTestDatabase>> | undefined
let minio: StartedMinioContainer | undefined
let queue: Awaited<ReturnType<typeof createPgBossQueue>>
let storage: Storage
let db: Db
let workDir: string
let scratchRoot: string
let video: string
let callLog: string

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
  queue = await createPgBossQueue({ connectionString: pg.url, role: 'worker' })
  workDir = await mkdtemp(join(tmpdir(), 'central-download-test-'))
  video = await makeVideo(workDir, { seconds: 3, audio: 'tone' })
}, 180_000)

afterAll(async () => {
  await queue?.stop()
  await pg?.stop()
  await minio?.stop()
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.source.deleteMany()
  await db.organization.deleteMany()
  scratchRoot = await mkdtemp(join(tmpdir(), 'central-scratch-test-'))
  callLog = join(workDir, `calls-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
  process.env.FAKE_YTDLP_LOG = callLog
  process.env.FAKE_YTDLP_VIDEO = video
  process.env.FAKE_YTDLP_MODE = 'ok'
  process.env.FAKE_YTDLP_DURATION = '4'
})

afterEach(async () => {
  for (const k of ['LOG', 'VIDEO', 'MODE', 'DURATION']) delete process.env[`FAKE_YTDLP_${k}`]
  await rm(scratchRoot, { recursive: true, force: true })
})

const silentLogger = () =>
  createLogger({
    name: 'download-test',
    destination: new Writable({ write: (_c, _e, cb) => cb() }),
  })

async function seed(rightsBasis: 'own' | 'none' = 'own') {
  const org = await db.organization.create({
    data: {
      name: 'Org Teste',
      slug: `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  })
  const source = await db.source.create({
    data: {
      organizationId: org.id,
      kind: 'youtube_link',
      title: 'Link',
      originalUrl: 'https://www.youtube.com/watch?v=abc',
      status: 'queued',
      rightsBasis,
      params: { targetMin: 1, targetMax: 3, minSec: 1, maxSec: 3, language: 'pt-BR' },
    },
  })
  return { orgId: org.id, sourceId: source.id }
}

const handler = (q: JobQueue = queue) =>
  createSourceDownloadHandler({
    db,
    storage,
    queue: q,
    ytdlpPath: process.execPath,
    ytdlpArgs: [FAKE],
    ffmpegPath: ffmpegPath(),
    scratchRoot,
    maxDurationMs: 2 * 60 * 60 * 1000,
    maxBytes: 4 * 1024 ** 3,
    logger: silentLogger(),
  })

const calls = async () =>
  (await readFile(callLog, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as string[])

const queuedJobs = async (sourceId: string) =>
  db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM pgboss.job WHERE name = ${QUEUES.sourceAnalyze} AND data->>'sourceId' = ${sourceId}`

it('link válido: baixa, sobe ao storage e enfileira a análise', async () => {
  const { orgId, sourceId } = await seed()
  await handler()({ id: 'job-1', data: { sourceId } })

  const row = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  const key = `orgs/${orgId}/sources/${sourceId}/original.mp4`
  expect(row.status).toBe('queued')
  expect(row.uploadKey).toBe(key)
  expect(row.statusDetail).toBeNull()
  expect((await storage.head(key))?.contentType).toBe('video/mp4')
  expect(await queuedJobs(sourceId)).toHaveLength(1)

  const [meta, download] = await calls()
  expect(meta).toContain('--dump-single-json')
  for (const args of [meta, download]) {
    expect(args).toEqual(expect.arrayContaining(['--ignore-config', '--no-cache-dir']))
  }
  expect(download).toEqual(
    expect.arrayContaining(['--no-playlist', '--merge-output-format', 'mp4']),
  )
  expect(download).toContain(ffmpegPath())
  // O scratch do job foi apagado.
  expect(await readdir(scratchRoot)).toEqual([])
})

it('duração acima do limite: failed sem baixar', async () => {
  process.env.FAKE_YTDLP_DURATION = String(2 * 60 * 60 + 1)
  const { sourceId } = await seed()
  await handler()({ id: 'job-2', data: { sourceId } })

  const row = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(row.status).toBe('failed')
  expect(row.statusDetail).toBe('Vídeo acima de 2 h.')
  const all = await calls()
  expect(all).toHaveLength(1)
  expect(all[0]).toContain('--dump-single-json')
  expect(await queuedJobs(sourceId)).toHaveLength(0)
})

it('yt-dlp sai com erro: failed com a mensagem que pede o MP4', async () => {
  process.env.FAKE_YTDLP_MODE = 'fail'
  const { sourceId } = await seed()
  await handler()({ id: 'job-3', data: { sourceId } })

  const row = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(row.status).toBe('failed')
  expect(row.statusDetail).toBe('Não foi possível baixar pelo link. Envie o arquivo MP4.')
  expect(await queuedJobs(sourceId)).toHaveLength(0)
})

it('fonte reclassificada para none antes do job: failed sem chamar o yt-dlp', async () => {
  const { sourceId } = await seed('none')
  await handler()({ id: 'job-4', data: { sourceId } })

  const row = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(row.status).toBe('failed')
  expect(await calls()).toHaveLength(0)
})

it('análise já enfileirada para a fonte: failed com mensagem de conflito, sem trocar o uploadKey', async () => {
  const { sourceId } = await seed()
  const refusing = { send: async () => null } as unknown as JobQueue
  await handler(refusing)({ id: 'job-5', data: { sourceId } })

  const row = await db.source.findUniqueOrThrow({ where: { id: sourceId } })
  expect(row.status).toBe('failed')
  expect(row.statusDetail).toBe('Já existe um processamento em andamento para esta fonte.')
  expect(row.uploadKey).toBeNull()
})
