import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createStorage } from '../src/index.js'

// minio/minio saiu do Docker Hub; imagem Chainguard fixada por digest.
const MINIO_IMAGE =
  'cgr.dev/chainguard/minio@sha256:18c8fa28697b25e0f34c6faae171079e88a03efb8e76a21d3b5d07b4e3cbef3e'

let container: StartedMinioContainer | undefined
let cfg: Parameters<typeof createStorage>[0]

beforeAll(async () => {
  container = await new MinioContainer(MINIO_IMAGE).start()
  cfg = {
    S3_ENDPOINT: container.getConnectionUrl(),
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'test',
    S3_ACCESS_KEY_ID: container.getUsername(),
    S3_SECRET_ACCESS_KEY: container.getPassword(),
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
}, 120_000)
afterAll(() => container?.stop())

it('ping resolve com bucket existente', async () => {
  await expect(createStorage(cfg).ping()).resolves.toBeUndefined()
})

it('ping rejeita com bucket inexistente', async () => {
  await expect(createStorage({ ...cfg, S3_BUCKET: 'inexistente' }).ping()).rejects.toThrow()
})

it('ping rejeita com credenciais inválidas sem vazar o segredo', async () => {
  const bad = { ...cfg, S3_SECRET_ACCESS_KEY: 'segredo-errado-xyz' }
  const err = await createStorage(bad)
    .ping()
    .then(
      () => null,
      (e: unknown) => e as Error,
    )
  expect(err).toBeInstanceOf(Error)
  expect(String(err?.message)).not.toContain('segredo-errado-xyz')
})
